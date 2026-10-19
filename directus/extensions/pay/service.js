/**
 * The payment of an order, server side: find the order the guest is paying
 * for, open a payment page at the bank, learn the outcome (the guest's return,
 * the bank's callback, the five-minute check) and write it into the order.
 * Only this file writes `payment_*`; it goes through `ItemsService`, so other
 * hooks see `orders.items.update` with the new `payment_status`.
 * Оплата заказа на стороне сервера: найти заказ, который оплачивает гость,
 * открыть страницу оплаты в банке, узнать итог (возврат гостя, уведомление
 * банка, проверка раз в пять минут) и записать его в заказ. Поля `payment_*`
 * пишет только этот файл; через `ItemsService`, поэтому другие хуки видят
 * `orders.items.update` с новым `payment_status`.
 */
import {
  bankOrderNumber,
  buildBundle,
  bundleTotal,
  isOrderNumber,
  normalizePhone,
  parseBankOrderNumber,
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

const rub = (n) => `${new Intl.NumberFormat('ru-RU').format(n)} ₽`;
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

  const providerFor = (s) => (s.provider === 'mock' ? mock(s, { publicUrl }) : alfa(s));

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

  const notifyPaid = async (order, amount) => {
    try {
      const roles = await database('directus_roles').whereIn('name', NOTIFY_ROLES).pluck('id');
      const users = roles.length ? await database('directus_users').whereIn('role', roles).where({ status: 'active' }).pluck('id') : [];
      const notifications = new services.NotificationsService({ schema: await getSchema(), knex: database });
      for (const recipient of users) {
        await notifications.createOne({
          recipient,
          subject: `Заказ ${order.number} оплачен онлайн · ${rub(amount)}`,
          message: `**${order.customer_name}**, ${order.phone}\n\nОплачено картой на сайте: **${rub(amount)}**. Подтвердите адрес и время — сумму с гостем обсуждать не нужно.`,
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
  const apply = async (order, bankId, result, via) => {
    const was = order.payment_status;
    const total = toKopecks(order.total) ?? 0;
    if (result.state === 'paid' && was !== 'paid' && was !== 'refunded') {
      const paid = result.amount ? result.amount / 100 : order.total;
      const differs = result.amount && result.amount !== total ? ` (в заказе ${rub(order.total)} — сверить)` : '';
      await write(
        order,
        { payment_status: 'paid', payment_method: 'online', paid_at: new Date().toISOString(), payment_id: bankId },
        `оплачено ${rub(paid)}${differs}; ${via}`,
      );
      await notifyPaid(order, paid);
    } else if (result.state === 'refunded' && was !== 'refunded') {
      await write(order, { payment_status: 'refunded' }, `возврат в банке; ${via}`);
    } else if (result.state === 'failed' && was === 'pending' && bankId === order.payment_id) {
      await write(order, { payment_status: 'failed' }, `оплата не прошла${result.note ? `: ${result.note}` : ''}; ${via}`);
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
        if (order.payment_status === 'paid') return { paid: true, number: order.number, total: order.total };
        if (order.payment_status === 'refunded') throw new PayError(409, 'refunded', 'По заказу уже сделан возврат. Позвоните нам.');
        const amount = toKopecks(order.total);
        if (!amount) throw new PayError(409, 'empty', 'В заказе нет суммы для оплаты. Позвоните нам.');

        const meta = json(order.payment_meta, {});
        const provider = providerFor(s);
        // a live page of the bank is handed out again: the same order, the same
        // link — a second tap, a reload or «back» never opens a second payment
        // живая страница банка выдаётся снова: тот же заказ — та же ссылка;
        // второе нажатие, перезагрузка или «назад» не открывают вторую оплату
        if (order.payment_status === 'pending' && order.payment_url && meta.provider === s.provider && meta.until > Date.now() + 60_000) {
          const result = await ask(s, order.payment_id);
          if (result.state === 'paid') {
            await apply(order, order.payment_id, result, 'проверка при повторном переходе');
            return { paid: true, number: order.number, total: order.total };
          }
          if (result.state === 'pending') return { url: order.payment_url, number: order.number, total: order.total, again: true };
          await apply(order, order.payment_id, result, 'проверка при повторном переходе');
        }

        const target = returnTarget({ origin, path, allowed: corsOrigins(env.CORS_ORIGIN), siteUrl: s.siteUrl });
        if (!target || !publicUrl) throw new PayError(500, 'config', 'Оплата на сайте настроена не до конца. Заказ принят — оплатите его при получении.');
        const attempt = (Number(meta.attempt) || 0) + 1;
        if (attempt > MAX_ATTEMPTS) throw new PayError(429, 'attempts', 'Слишком много попыток оплаты. Позвоните нам — поможем.');

        let bundle = null;
        if (s.receipt) {
          try {
            bundle = buildBundle(json(order.items, []), { vat: s.vat, method: s.receiptMethod, object: 1, measure: s.measure, phone: order.phone });
            if (bundleTotal(bundle) !== amount) {
              logger.warn(`pay: корзина заказа ${order.number} не сходится с суммой — чек без позиций`);
              bundle = null;
            }
          } catch (error) {
            logger.warn(`pay: корзина заказа ${order.number} не собрана — ${error.message}`);
            bundle = null;
          }
        }

        const back = `${publicUrl}/pay/return?o=${order.id}`;
        const sessionSeconds = s.sessionMinutes * 60;
        const nextMeta = { ...meta, attempt, provider: s.provider, mode: s.mode, target, ids: [...(meta.ids ?? [])].slice(-19) };
        let page;
        try {
          page = await provider.register({
            orderNumber: bankOrderNumber(order.number, order.id, attempt),
            amount,
            description: `Заказ ${order.number}, Вкусная компания`,
            returnUrl: back,
            failUrl: back,
            bundle,
            taxSystem: s.taxSystem,
            sessionSeconds,
            phone: receiptPhone(order.phone),
          });
        } catch (error) {
          const why = error instanceof BankError ? error.message : String(error?.message ?? error);
          logger.warn(`pay: ссылка на оплату ${order.number} не создана — ${why}`);
          await write(order, { payment_method: 'online', payment_status: 'failed', payment_meta: nextMeta }, `ссылка на оплату не создана: ${why}`);
          throw new PayError(502, 'bank', 'Банк сейчас не отвечает. Заказ принят — попробуйте оплатить через минуту или оплатите при получении.');
        }
        nextMeta.ids.push(page.id);
        nextMeta.until = Date.now() + sessionSeconds * 1000;
        nextMeta.amount = amount;
        await write(
          order,
          { payment_method: 'online', payment_status: 'pending', payment_id: page.id, payment_url: page.url, payment_meta: nextMeta },
          `ссылка на оплату ${rub(order.total)} (${provider.label}, ${MODE[s.mode]}${attempt > 1 ? `, попытка ${attempt}` : ''})`,
        );
        return { url: page.url, number: order.number, total: order.total };
      });
    },

    /** POST /pay/offline: гость передумал платить онлайн — оплата при получении. */
    async offline({ number, phone }) {
      const s = await settings();
      const found = await findOrder(number, phone);
      if (!found) throw new PayError(404, 'not_found', 'Не нашли заказ с этим номером и телефоном. Позвоните нам — разберёмся.');
      return locked(found.id, async () => {
        const order = await orderById(found.id);
        if (order.payment_status === 'paid') return { paid: true, number: order.number, total: order.total };
        if (s.enabled && !s.onDelivery) throw new PayError(409, 'online_only', 'Заказы с сайта сейчас принимаем только с онлайн-оплатой. Позвоните нам — поможем.');
        if (order.payment_method !== 'on_delivery' || order.payment_status !== 'none')
          await write(order, { payment_method: 'on_delivery', payment_status: 'none' }, 'гость выбрал оплату при получении');
        return { offline: true, number: order.number, total: order.total };
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
        await locked(order.id, () => apply(order, order.payment_id, result, 'проверка со страницы сайта'));
      }
      return { number: order.number, status: order.payment_status, method: order.payment_method, total: order.total };
    },

    /**
     * GET /pay/return?o=<id>&orderId=<bank id>: the bank sends the guest back
     * here; the status is asked again (the address alone proves nothing) and
     * the guest goes on to the site with the outcome.
     * Сюда банк возвращает гостя; статус спрашиваем заново (сам адрес ничего
     * не доказывает) и отправляем гостя на сайт с итогом.
     */
    async back({ id, bankId }) {
      const s = await settings();
      const order = await orderById(id);
      const fallback = returnTarget({ origin: null, path: '/catalog/', allowed: corsOrigins(env.CORS_ORIGIN), siteUrl: s.siteUrl });
      if (!order) return fallback ? new URL('/catalog/', fallback.site).toString() : null;
      const meta = json(order.payment_meta, {});
      const target = meta.target ?? fallback;
      // the bank always adds its own order id; without a known one the address
      // was typed by hand, and a stranger learns nothing about order 57
      // банк всегда добавляет свой номер заказа; без знакомого номера адрес
      // набран руками, и посторонний ничего не узнает о заказе 57
      const known = bankId && (bankId === order.payment_id || (meta.ids ?? []).includes(bankId));
      if (!known) return target ? new URL(target.path, target.site).toString() : null;
      const asked = bankId;
      const result = await ask(s, asked);
      await locked(order.id, () => apply(order, asked, result, 'возврат гостя со страницы банка'));
      if (!target) return null;
      if (order.payment_status === 'paid' || result.state === 'paid') return resultUrl(target, 'ok', order.number);
      if (result.state === 'failed' || result.state === 'refunded') return resultUrl(target, 'fail', order.number, whyFailed(result));
      // the bank never gives up an unfinished page on the way back: status 0
      // means the guest left it (the «back to the shop» link); 5 is 3-D Secure
      // банк не отпускает гостя с незавершённой страницы: статус 0 значит, что
      // гость ушёл сам (ссылка «вернуться в магазин»); 5 — идёт 3-D Secure
      if (!result.unreachable && String(result.code) === '0')
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
      await locked(order.id, () => apply(order, bankId, result, `уведомление банка (${params.operation ?? 'без операции'})`));
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
          await apply(order, order.payment_id, result, 'проверка по расписанию');
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
        provider: provider.label,
        mode: MODE[s.mode],
        gateway: s.provider === 'alfa' ? s.gateway : null,
        sources: s.sources,
        publicUrl,
        returnUrl: publicUrl ? `${publicUrl}/pay/return` : null,
        callbackUrl: publicUrl ? `${publicUrl}/pay/callback` : null,
        siteUrl: s.siteUrl || null,
        cors: corsOrigins(env.CORS_ORIGIN),
        receipt: s.receipt ? { taxSystem: s.taxSystem, vat: s.vat, method: s.receiptMethod, ffd: s.measure === 0 ? '1.2' : '1.05' } : null,
        bank,
      };
    },
  };
};
