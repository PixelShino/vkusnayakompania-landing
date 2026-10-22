/**
 * The payment of an order, server side: find the order the guest is paying
 * for, open a payment page at the bank, learn the outcome (the guest's return,
 * the bank's callback, the five-minute check) and write it into the order.
 * Only this file writes `payment_*`; it goes through `ItemsService`, so other
 * hooks see `orders.items.update` with the new `payment_status`. The bank is
 * a provider (`providers/*.js`): ЮKassa by default, Alfa-Bank, the test stub.
 * Оплата заказа на стороне сервера: найти заказ, который оплачивает гость,
 * открыть страницу оплаты в банке, узнать итог (возврат гостя, уведомление
 * банка, проверка раз в пять минут) и записать его в заказ. Поля `payment_*`
 * пишет только этот файл; через `ItemsService`, поэтому другие хуки видят
 * `orders.items.update` с новым `payment_status`. Банк — это провайдер
 * (`providers/*.js`): по умолчанию ЮKassa, ещё Альфа-Банк и тестовая заглушка.
 */
import { randomBytes } from 'node:crypto';
import {
  bankOrderNumber,
  buildBundle,
  bundleTotal,
  deliveryInPayment,
  isOrderNumber,
  normalizePhone,
  parseBankOrderNumber,
  parseYooNotification,
  publicConfig,
  receiptPhone,
  resolveSettings,
  resultUrl,
  returnTarget,
  toKopecks,
  verifyChecksum,
} from './core.js';
import { alfa, BankError } from './providers/alfa.js';
import { mock } from './providers/mock.js';
import { yookassa } from './providers/yookassa.js';

/** an error the guest's page can show as is / ошибка, которую страница гостя покажет как есть */
export class PayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// a payment may start within two days of the order: the «try again» of the
// result screen, not a link to dig up a month later
// оплату можно начать в течение двух суток после заказа: это «попробовать
// ещё раз» экрана итога, а не ссылка, которую откопают через месяц
const START_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const NOTIFY_ROLES = ['Administrator', 'Редактор'];
// a stuck «pending» is retired this long after its page died
// зависшее «ждём оплату» снимается через столько после смерти страницы
const EXPIRE_GRACE_MS = 30 * 60 * 1000;
const LEFT_RECHECK_MS = 1500;

const rub = (n) => `${new Intl.NumberFormat('ru-RU').format(n)} ₽`;

/**
 * What the guest pays: `to_pay` — the dishes less the points and the birthday
 * discount plus the delivery (`order-guard` + `loyalty`; every site order has
 * it since 22.10.2026); an order without it (an older one, a phone order) pays
 * its total.
 * Сколько платит гость: `to_pay` — блюда минус баллы и скидка именинника плюс
 * доставка (`order-guard` + `loyalty`; с 22.10.2026 он есть у каждого заказа с
 * сайта); заказ без него (старый, по телефону) платит свою сумму.
 */
export const payable = (order) =>
  order.to_pay !== null && order.to_pay !== undefined && Number.isFinite(Number(order.to_pay)) ? Number(order.to_pay) : Number(order.total);
const stamp = (date = new Date()) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Samara', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(date)
    .replace(',', '');
const json = (value, fallback) => {
  if (value && typeof value === 'object') return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};
const MODE = { test: 'тест', prod: 'бой' };

/** CORS_ORIGIN Directus: строка через запятую, массив или true — в список адресов */
const corsOrigins = (value) => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
  return [];
};

export const createPayService = ({ services, database, getSchema, env, logger }) => {
  const publicUrl = String(env.PUBLIC_URL ?? '').replace(/\/+$/, '');
  const locks = new Map();

  const settings = async () => {
    let row = null;
    try {
      row = await database('payment_settings').first();
    } catch {
      // the collection is not there yet (schema not applied): payments are off
      // коллекции ещё нет (схема не применена): оплата выключена
    }
    return resolveSettings(row, env);
  };

  const providerFor = (s, id = s.provider) => (id === 'mock' ? mock(s, { publicUrl }) : id === 'yookassa' ? yookassa(s) : alfa(s));

  /** одна оплата заказа за раз: два «Оплатить» подряд не откроют в банке два заказа */
  const locked = async (id, fn) => {
    while (locks.has(id)) await locks.get(id).catch(() => {});
    const run = fn();
    locks.set(id, run);
    try {
      return await run;
    } finally {
      locks.delete(id);
    }
  };

  const items = async () => new services.ItemsService('orders', { schema: await getSchema(), knex: database });
  const write = async (order, patch, line) => {
    const log = line ? `${order.payment_log ? `${order.payment_log}\n` : ''}${stamp()} — ${line}` : undefined;
    await (await items()).updateOne(order.id, { ...patch, ...(log ? { payment_log: log } : {}) });
    Object.assign(order, patch, log ? { payment_log: log } : {});
  };

  /** Заказ по номеру и телефону — так гость доказывает, что заказ его (сайт не читает заказы). */
  const findOrder = async (number, phone) => {
    const norm = normalizePhone(phone);
    if (!norm || !isOrderNumber(number)) return null;
    return (
      (await database('orders')
        .where((q) => q.where('number', number).orWhere('number', 'like', `${number}-__`))
        .andWhere('phone', norm)
        .orderBy('id', 'desc')
        .first()) ?? null
    );
  };

  const orderById = async (id) => (Number.isInteger(id) ? ((await database('orders').where({ id }).first()) ?? null) : null);

  const notifyPaid = async (order, amount, { test = false, short = false } = {}) => {
    try {
      const roles = await database('directus_roles').whereIn('name', NOTIFY_ROLES).pluck('id');
      const users = roles.length ? await database('directus_users').whereIn('role', roles).where({ status: 'active' }).pluck('id') : [];
      const notifications = new services.NotificationsService({ schema: await getSchema(), knex: database });
      for (const recipient of users) {
        await notifications.createOne({
          recipient,
          subject: short
            ? `Заказ ${order.number}: банк подтвердил меньше, чем к оплате — сверьте`
            : `${test ? 'ТЕСТ · ' : ''}Заказ ${order.number} оплачен онлайн · ${rub(amount)}`,
          message: short
            ? `**${order.customer_name}**, ${order.phone}\n\nБанк подтвердил **${rub(amount)}**, а к оплате в заказе **${rub(payable(order))}**. Заказ не отмечен оплаченным: сверьте платёж в кабинете банка и договоритесь с гостем о разнице.`
            : `${test ? '**Тестовый режим оплаты — денег не списано.**\n\n' : ''}**${order.customer_name}**, ${order.phone}\n\nОплачено картой на сайте: **${rub(amount)}**. Подтвердите адрес и время — сумму с гостем обсуждать не нужно.`,
          collection: 'orders',
          item: String(order.id),
        });
      }
    } catch (error) {
      logger.warn(`pay: уведомление об оплате ${order.number} не создано — ${error.message}`);
    }
  };

  /**
   * Write what the bank said. Paid from any attempt counts (a guest may pay an
   * older tab); a failure counts only for the current attempt, so a dead old
   * link cannot spoil a live one.
   * Записать, что сказал банк. Оплата любой попытки засчитывается (гость мог
   * оплатить старую вкладку); неудача — только текущей, чтобы мёртвая старая
   * ссылка не испортила живую.
   */
  const apply = async (order, bankId, result, via, s = null) => {
    const was = order.payment_status;
    const total = toKopecks(payable(order)) ?? 0;
    // the stub and a test shop take no money: the journal and the manager's
    // notification say so, a test «paid» is never mistaken for a real one
    // заглушка и тестовый магазин денег не берут: журнал и уведомление
    // менеджеру говорят об этом, тестовое «оплачено» не спутать с настоящим
    const test = s?.mode === 'test';
    const tag = test ? 'ТЕСТ, денег не списано: ' : '';
    if (result.state === 'paid' && result.amount && result.amount < total && was !== 'paid' && was !== 'refunded') {
      // the bank confirmed less than the order asks (the bill grew after the
      // link was issued, or the amount was tampered with): not «paid» — the
      // manager squares it with the guest, said once per attempt
      // банк подтвердил меньше, чем просит заказ (счёт вырос после выдачи
      // ссылки или сумму подменили): не «оплачен» — менеджер сверяет с гостем,
      // сказано один раз на попытку
      const meta = json(order.payment_meta, {});
      if (!(meta.short ?? []).includes(bankId)) {
        const paid = result.amount / 100;
        await write(
          order,
          { payment_status: 'failed', payment_meta: { ...meta, short: [...(meta.short ?? []), bankId] } },
          `${tag}ВНИМАНИЕ: банк подтвердил ${rub(paid)}, а к оплате ${rub(payable(order))} — заказ не отмечен оплаченным, сверьте платёж ${bankId} в кабинете банка; ${via}`,
        );
        await notifyPaid(order, paid, { test, short: true });
      }
    } else if (result.state === 'paid' && was !== 'paid' && was !== 'refunded') {
      const paid = result.amount ? result.amount / 100 : payable(order);
      const differs = result.amount && result.amount !== total ? ` (в заказе к оплате ${rub(payable(order))} — сверить)` : '';
      await write(
        order,
        { payment_status: 'paid', payment_method: 'online', paid_at: new Date().toISOString(), payment_id: bankId },
        `${tag}оплачено ${rub(paid)}${differs}; ${via}`,
      );
      await notifyPaid(order, paid, { test });
    } else if (result.state === 'paid' && was === 'paid' && bankId !== order.payment_id) {
      // a second attempt paid as well (two tabs): money twice for one order —
      // said once, loudly, for the manager to refund
      // оплачена и вторая попытка (две вкладки): деньги дважды за один заказ —
      // сказать один раз и громко, чтобы менеджер вернул
      const meta = json(order.payment_meta, {});
      if (!(meta.extra ?? []).includes(bankId))
        await write(
          order,
          { payment_meta: { ...meta, extra: [...(meta.extra ?? []), bankId] } },
          `ВНИМАНИЕ: оплачена ещё одна попытка (${bankId}) на ${rub(result.amount ? result.amount / 100 : payable(order))} — заказ оплачен дважды, лишнее верните в кабинете банка; ${via}`,
        );
    } else if (result.state === 'refunded' && was !== 'refunded') {
      await write(order, { payment_status: 'refunded' }, `возврат в банке; ${via}`);
    } else if (result.state === 'failed' && was === 'pending' && bankId === order.payment_id) {
      await write(order, { payment_status: 'failed' }, `оплата не прошла${result.note ? `: ${result.note}` : ''}; ${via}`);
    }
    // a partial refund leaves the order paid; the manager still sees how much went back
    // частичный возврат оставляет заказ оплаченным; менеджер всё равно видит, сколько вернули
    if (result.state === 'paid' && result.refunded > 0 && bankId === order.payment_id) {
      const meta = json(order.payment_meta, {});
      if (meta.refunded !== result.refunded)
        await write(order, { payment_meta: { ...meta, refunded: result.refunded } }, `частичный возврат: всего вернули ${rub(result.refunded / 100)}; ${via}`);
    }
    return order;
  };

  const ask = async (s, bankId) => {
    try {
      return await providerFor(s).status(bankId);
    } catch (error) {
      logger.warn(`pay: статус ${bankId} не получен — ${error.message}`);
      return { state: 'pending', amount: 0, code: null, note: error.message, unreachable: true };
    }
  };

  /** Почему не прошло — ключ для экрана сайта (`failReason`). */
  const whyFailed = (result) => {
    if (result.why) return result.why;
    // -2007: the gateway's «payment page timed out» / -2007 — «истёк срок страницы оплаты»
    if (String(result.action) === '-2007' || /истек|истёк|expired/i.test(String(result.note ?? ''))) return 'expired';
    return 'declined';
  };

  return {
    settings,
    publicConfig: async () => publicConfig(await settings()),

    /** POST /pay/start: ссылка на оплату для заказа, только что оформленного на сайте. */
    async start({ number, phone, origin, path }) {
      const s = await settings();
      if (!s.enabled) throw new PayError(409, 'off', 'Онлайн-оплата сейчас выключена. Заказ принят — оплатите его при получении.');
      const found = await findOrder(number, phone);
      if (!found) throw new PayError(404, 'not_found', 'Не нашли заказ с этим номером и телефоном. Позвоните нам — разберёмся.');
      return locked(found.id, async () => {
        const order = await orderById(found.id);
        if (['cancelled', 'done'].includes(order.status)) throw new PayError(409, 'closed', 'Заказ уже закрыт. Позвоните нам, если хотите его оплатить.');
        if (Date.now() - new Date(order.date_created).getTime() > START_WINDOW_MS)
          throw new PayError(409, 'old', 'Заказ оформлен больше двух суток назад. Позвоните нам — оплатите его при получении.');
        if (order.payment_status === 'paid') return { paid: true, number: order.number, total: payable(order), delivery_cost: order.delivery_cost ?? null };
        if (order.payment_status === 'refunded') throw new PayError(409, 'refunded', 'По заказу уже сделан возврат. Позвоните нам.');
        const amount = toKopecks(payable(order));
        if (!amount) throw new PayError(409, 'empty', 'В заказе нет суммы для оплаты. Позвоните нам.');

        const meta = json(order.payment_meta, {});
        const provider = providerFor(s);
        // a live page of the bank is handed out again: the same order, the same
        // link — a second tap, a reload or «back» never opens a second payment.
        // ЮKassa keeps a page open past our clock and a merchant cannot close
        // it, so its page is asked about even after «failed»
        // живая страница банка выдаётся снова: тот же заказ — та же ссылка;
        // второе нажатие, перезагрузка или «назад» не открывают вторую оплату.
        // ЮKassa держит страницу открытой дольше наших часов, а магазин закрыть
        // её не может, поэтому о ней спрашиваем и после «не прошла»
        const samePage = order.payment_url && order.payment_id && meta.provider === s.provider;
        const live = order.payment_status === 'pending' && meta.until > Date.now() + 60_000;
        const kept = provider.keepsPage && ['pending', 'failed'].includes(order.payment_status);
        if (samePage && (live || kept)) {
          const result = await ask(s, order.payment_id);
          if (result.state === 'paid') {
            await apply(order, order.payment_id, result, 'проверка при повторном переходе', s);
            if (order.payment_status === 'paid') return { paid: true, number: order.number, total: payable(order), delivery_cost: order.delivery_cost ?? null };
            // the bank took less than the order asks: no second payment on top
            // of it — the manager settles the difference by phone
            // банк взял меньше, чем просит заказ: второй платёж сверху не
            // открываем — разницу менеджер решает по телефону
            throw new PayError(409, 'short', 'Банк подтвердил меньшую сумму, чем в заказе. Позвоните нам — разберёмся.');
          }
          if (result.state === 'pending' && (live || !result.unreachable)) {
            if (order.payment_status !== 'pending')
              await write(order, { payment_status: 'pending', payment_method: 'online' }, `та же страница оплаты выдана снова: ${provider.label} её ещё держит`);
            return { url: order.payment_url, number: order.number, total: payable(order), delivery_cost: order.delivery_cost ?? null, again: true };
          }
          await apply(order, order.payment_id, result, 'проверка при повторном переходе', s);
        }

        const target = returnTarget({ origin, path, allowed: corsOrigins(env.CORS_ORIGIN), siteUrl: s.siteUrl });
        if (!target || !publicUrl) throw new PayError(500, 'config', 'Оплата на сайте настроена не до конца. Заказ принят — оплатите его при получении.');
        const attempt = (Number(meta.attempt) || 0) + 1;
        if (attempt > MAX_ATTEMPTS) throw new PayError(429, 'attempts', 'Слишком много попыток оплаты. Позвоните нам — поможем.');

        // Alfa (and the stub's page) take the basket as is and drop it when it
        // does not add up; ЮKassa builds its own receipt from the lines,
        // spreads points over them and puts the delivery on a line of its own,
        // since with its receipts on a payment without one is refused
        // Альфа (и страница заглушки) берут корзину как есть и обходятся без
        // неё, если она не сходится; ЮKassa собирает свой чек из строк,
        // раскладывает баллы по ним и ставит доставку отдельной строкой: с её
        // чеками платёж без чека не примут
        const lines = json(order.items, []);
        let bundle = null;
        if (s.receipt && s.provider !== 'yookassa') {
          try {
            bundle = buildBundle(lines, { vat: s.vat, method: s.receiptMethod, object: s.receiptSubject, measure: s.measure, phone: order.phone });
            if (bundleTotal(bundle) !== amount) {
              logger.warn(`pay: корзина заказа ${order.number} не сходится с суммой — чек без позиций`);
              bundle = null;
            }
          } catch (error) {
            logger.warn(`pay: корзина заказа ${order.number} не собрана — ${error.message}`);
            bundle = null;
          }
        }
        const receipt =
          s.receipt && s.provider === 'yookassa'
            ? {
                lines,
                vat: s.vat,
                method: s.receiptMethod,
                subject: s.receiptSubject,
                taxSystem: s.taxSystem,
                ffd12: s.measure === 0,
                phone: order.phone,
                email: order.email ?? null,
                title: `Заказ ${order.number}`,
                // the delivery inside «К оплате» (not the field as typed later) / доставка внутри «К оплате»
                delivery: deliveryInPayment(order),
              }
            : null;

        // ЮKassa adds nothing to the return address, so the address carries
        // its own unguessable key of the attempt; Alfa and the stub add their
        // order id on top of it
        // ЮKassa ничего не дописывает к адресу возврата, поэтому в адресе свой
        // неугадываемый ключ попытки; Альфа и заглушка дописывают ещё и свой номер
        const key = randomBytes(9).toString('base64url');
        const back = `${publicUrl}/pay/return?o=${order.id}&t=${key}`;
        const sessionSeconds = s.sessionMinutes * 60;
        const nextMeta = {
          ...meta,
          attempt,
          provider: s.provider,
          mode: s.mode,
          target,
          ids: [...(meta.ids ?? [])].slice(-19),
          back: Object.fromEntries(Object.entries(meta.back ?? {}).slice(-19)),
        };
        let page;
        try {
          page = await provider.register({
            orderNumber: bankOrderNumber(order.number, order.id, attempt),
            amount,
            description: `Заказ ${order.number}, Вкусная компания`,
            returnUrl: back,
            failUrl: back,
            bundle,
            receipt,
            taxSystem: s.taxSystem,
            sessionSeconds,
            phone: receiptPhone(order.phone),
            metadata: { order_id: order.id, order_number: order.number },
          });
        } catch (error) {
          const why = error instanceof BankError ? error.message : String(error?.message ?? error);
          logger.warn(`pay: ссылка на оплату ${order.number} не создана — ${why}`);
          await write(order, { payment_method: 'online', payment_status: 'failed', payment_meta: nextMeta }, `ссылка на оплату не создана: ${why}`);
          throw new PayError(502, 'bank', 'Банк сейчас не отвечает. Заказ принят — попробуйте оплатить через минуту или оплатите при получении.');
        }
        nextMeta.ids.push(page.id);
        nextMeta.back[key] = page.id;
        nextMeta.until = Date.now() + sessionSeconds * 1000;
        nextMeta.amount = amount;
        await write(
          order,
          { payment_method: 'online', payment_status: 'pending', payment_id: page.id, payment_url: page.url, payment_meta: nextMeta },
          `ссылка на оплату ${rub(payable(order))} (${provider.label}, ${MODE[s.mode]}${page.test ? ', тестовый магазин' : ''}${attempt > 1 ? `, попытка ${attempt}` : ''})`,
        );
        return { url: page.url, number: order.number, total: payable(order), delivery_cost: order.delivery_cost ?? null };
      });
    },

    /** POST /pay/offline: гость передумал платить онлайн — оплата при получении. */
    async offline({ number, phone }) {
      const s = await settings();
      const found = await findOrder(number, phone);
      if (!found) throw new PayError(404, 'not_found', 'Не нашли заказ с этим номером и телефоном. Позвоните нам — разберёмся.');
      return locked(found.id, async () => {
        const order = await orderById(found.id);
        if (order.payment_status === 'paid') return { paid: true, number: order.number, total: payable(order), delivery_cost: order.delivery_cost ?? null };
        if (s.enabled && !s.onDelivery) throw new PayError(409, 'online_only', 'Заказы с сайта сейчас принимаем только с онлайн-оплатой. Позвоните нам — поможем.');
        if (order.payment_method !== 'on_delivery' || order.payment_status !== 'none')
          await write(order, { payment_method: 'on_delivery', payment_status: 'none' }, 'гость выбрал оплату при получении');
        return { offline: true, number: order.number, total: payable(order) };
      });
    },

    /** POST /pay/status: что с оплатой сейчас; ждущую — уточнить у банка. */
    async status({ number, phone }) {
      const found = await findOrder(number, phone);
      if (!found) throw new PayError(404, 'not_found', 'Не нашли заказ с этим номером и телефоном.');
      const s = await settings();
      const order = await orderById(found.id);
      if (order.payment_status === 'pending' && order.payment_id) {
        const result = await ask(s, order.payment_id);
        // the order is read again under the lock: the snapshot taken before the
        // bank answered may already be a step behind another handler
        // заказ перечитывается под блокировкой: снимок, снятый до ответа банка,
        // мог отстать от другого обработчика на шаг
        await locked(order.id, async () => {
          const fresh = await orderById(order.id);
          if (!fresh) return;
          await apply(fresh, order.payment_id, result, 'проверка со страницы сайта', s);
          Object.assign(order, fresh);
        });
      }
      return { number: order.number, status: order.payment_status, method: order.payment_method, total: payable(order), delivery_cost: order.delivery_cost ?? null };
    },

    /**
     * GET /pay/return?o=<id>&t=<key>[&orderId=<bank id>]: the bank sends the
     * guest back here; the status is asked again (the address alone proves
     * nothing) and the guest goes on to the site with the outcome.
     * Сюда банк возвращает гостя; статус спрашиваем заново (сам адрес ничего
     * не доказывает) и отправляем гостя на сайт с итогом.
     */
    async back({ id, bankId, key }) {
      const s = await settings();
      const order = await orderById(id);
      const fallback = returnTarget({ origin: null, path: '/catalog/', allowed: corsOrigins(env.CORS_ORIGIN), siteUrl: s.siteUrl });
      if (!order) return fallback ? new URL('/catalog/', fallback.site).toString() : null;
      const meta = json(order.payment_meta, {});
      const target = meta.target ?? fallback;
      // the attempt is named by our key in the address (ЮKassa) or by the
      // bank's own order id (Alfa, the stub); without a known one the address
      // was typed by hand, and a stranger learns nothing about order 57
      // попытку называет наш ключ в адресе (ЮKassa) или номер заказа самого
      // банка (Альфа, заглушка); без знакомого адрес набран руками, и
      // посторонний ничего не узнает о заказе 57
      const byKey = key && meta.back && Object.hasOwn(meta.back, key) && typeof meta.back[key] === 'string' ? meta.back[key] : '';
      const asked = bankId || byKey;
      const known = asked && (asked === order.payment_id || (meta.ids ?? []).includes(asked));
      if (!known) return target ? new URL(target.path, target.site).toString() : null;
      let result = await ask(s, asked);
      // ЮKassa's «pending» on the way back is a guest who left — unless the
      // payment is finishing this very second: one more look before saying so
      // `pending` ЮKassa при возвращении — гость ушёл, если только платёж не
      // завершается в эту секунду: ещё один взгляд, прежде чем так сказать
      if (result.left === true && !result.unreachable) {
        await new Promise((resolve) => setTimeout(resolve, LEFT_RECHECK_MS));
        result = await ask(s, asked);
      }
      await locked(order.id, async () => {
        const fresh = await orderById(order.id);
        if (!fresh) return;
        await apply(fresh, asked, result, 'возврат гостя со страницы банка', s);
        Object.assign(order, fresh);
      });
      if (!target) return null;
      if (order.payment_status === 'paid') return resultUrl(target, 'ok', order.number);
      if (result.state === 'paid') return resultUrl(target, 'fail', order.number, 'short');
      if (result.state === 'failed' || result.state === 'refunded') return resultUrl(target, 'fail', order.number, whyFailed(result));
      // the bank never gives up an unfinished page on the way back: Alfa's
      // status 0 or ЮKassa's `pending` means the guest left it («back to the
      // shop»); Alfa's 5 is 3-D Secure still going
      // банк не отпускает гостя с незавершённой страницы: статус 0 у Альфы или
      // `pending` у ЮKassa значит, что гость ушёл сам («вернуться в магазин»);
      // 5 у Альфы — ещё идёт 3-D Secure
      if (!result.unreachable && (result.left ?? String(result.code) === '0'))
        return resultUrl(target, 'fail', order.number, 'cancelled');
      return resultUrl(target, 'wait', order.number);
    },

    /** GET|POST /pay/callback: уведомление банка. Подпись — если задан ключ; статус — всегда у банка. */
    async callback(params) {
      const s = await settings();
      if (s.callbackKey && !verifyChecksum(params, s.callbackKey)) throw new PayError(403, 'checksum', 'bad checksum');
      const bankId = String(params.mdOrder ?? '');
      if (!bankId) throw new PayError(400, 'bad_request', 'no mdOrder');
      let order = (await database('orders').where({ payment_id: bankId }).first()) ?? null;
      if (!order) {
        const parsed = parseBankOrderNumber(params.orderNumber);
        const candidate = parsed ? await orderById(parsed.id) : null;
        if (candidate && json(candidate.payment_meta, {}).ids?.includes(bankId)) order = candidate;
      }
      if (!order) throw new PayError(404, 'not_found', 'unknown order');
      const result = await ask(s, bankId);
      await locked(order.id, async () => {
        const fresh = await orderById(order.id);
        if (fresh) await apply(fresh, bankId, result, `уведомление банка (${params.operation ?? 'без операции'})`, s);
      });
      return { ok: true };
    },

    /**
     * POST /pay/yookassa/webhook: ЮKassa's notification. The body only names
     * the payment; what happened to it is asked at ЮKassa (`GET /payments/{id}`),
     * and the order is found by our payment id or by the `metadata` ЮKassa
     * itself returns — a forged body changes nothing. Repeats are harmless:
     * `apply` writes only a change. A payment ЮKassa does not know, or one
     * that is not ours, is answered 200 and left alone; ЮKassa out of reach —
     * 503, and ЮKassa repeats the notification for 24 hours.
     * Уведомление ЮKassa. Тело только называет платёж; что с ним, спрашиваем у
     * ЮKassa (`GET /payments/{id}`), а заказ ищем по нашему номеру платежа или
     * по `metadata`, которую вернула сама ЮKassa, — поддельное тело ничего не
     * изменит. Повторы безвредны: `apply` пишет только перемену. Платёж,
     * которого ЮKassa не знает или который не наш, — ответ 200 и больше
     * ничего; ЮKassa недоступна — 503, и ЮKassa повторит уведомление в
     * течение суток.
     */
    async yookassaNotification(body, { trusted = false } = {}) {
      const note = parseYooNotification(body);
      if (!note) throw new PayError(400, 'bad_request', 'not a ЮKassa notification');
      if (!note.paymentId) return { ok: true, ignored: note.event };
      const s = await settings();
      let result;
      try {
        result = await providerFor(s, 'yookassa').status(note.paymentId);
      } catch (error) {
        if (error?.status === 404 || error?.code === 'not_found') {
          logger.warn(`pay: уведомление ЮKassa (${note.event}) о платеже ${note.paymentId}, которого ЮKassa не знает${trusted ? '' : ' — адрес отправителя не из списка ЮKassa'}`);
          return { ok: true, ignored: 'unknown payment' };
        }
        logger.warn(`pay: уведомление ЮKassa (${note.event}) о платеже ${note.paymentId} не проверено — ${error?.message ?? error}`);
        throw new PayError(503, 'unavailable', 'payment not verified yet, repeat later');
      }
      let order = (await database('orders').where({ payment_id: note.paymentId }).first()) ?? null;
      if (!order) {
        const id = Number(result.metadata?.order_id);
        const candidate = Number.isInteger(id) ? await orderById(id) : null;
        if (candidate && (json(candidate.payment_meta, {}).ids ?? []).includes(note.paymentId)) order = candidate;
      }
      if (!order) {
        logger.warn(`pay: уведомление ЮKassa (${note.event}) о платеже ${note.paymentId} — такого платежа нет в заказах`);
        return { ok: true, ignored: 'unknown order' };
      }
      await locked(order.id, async () => {
        const fresh = await orderById(order.id);
        await apply(fresh, note.paymentId, result, `уведомление ЮKassa (${note.event})`, s);
      });
      return { ok: true };
    },

    /** Раз в пять минут: ждущие оплаты — у банка, мёртвые ссылки — в «не прошла». */
    async sweep() {
      const s = await settings();
      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const rows = await database('orders').where({ payment_status: 'pending' }).andWhere('date_created', '>', since).limit(50);
      for (const row of rows) {
        await locked(row.id, async () => {
          const order = await orderById(row.id);
          if (order.payment_status !== 'pending' || !order.payment_id) return;
          const meta = json(order.payment_meta, {});
          if (meta.provider && meta.provider !== s.provider) return;
          const result = await ask(s, order.payment_id);
          await apply(order, order.payment_id, result, 'проверка по расписанию', s);
          if (order.payment_status === 'pending' && !result.unreachable && meta.until && Date.now() > meta.until + EXPIRE_GRACE_MS)
            await write(order, { payment_status: 'failed' }, 'время на оплату истекло, гость не оплатил');
        });
      }
      return rows.length;
    },

    /** GET /pay/check (только администратор): действующие настройки без секретов и связь с банком. */
    async check() {
      const s = await settings();
      const provider = providerFor(s);
      let bank;
      try {
        bank = await provider.check();
      } catch (error) {
        bank = { ok: false, message: error.message };
      }
      return {
        enabled: s.enabled,
        stubInProd: s.stubInProd,
        testKeyInProd: s.testKeyInProd,
        providerId: s.provider,
        provider: provider.label,
        mode: MODE[s.mode],
        gateway: s.provider === 'alfa' ? s.gateway : s.provider === 'yookassa' ? s.yookassaApi : null,
        sources: s.sources,
        publicUrl,
        returnUrl: publicUrl ? `${publicUrl}/pay/return` : null,
        callbackUrl: publicUrl ? (s.provider === 'yookassa' ? `${publicUrl}/pay/yookassa/webhook` : `${publicUrl}/pay/callback`) : null,
        siteUrl: s.siteUrl || null,
        cors: corsOrigins(env.CORS_ORIGIN),
        receipt: s.receipt
          ? { taxSystem: s.taxSystem, vat: s.vat, method: s.receiptMethod, subject: s.receiptSubject, ffd: s.measure === 0 ? '1.2' : '1.05' }
          : null,
        bank,
      };
    },
  };
};
