/**
 * «Вкусные баллы»: the accounting behind the guest account. Every movement of
 * points is a row in `bonus_transactions`; the balance, the sum of purchases
 * and the tier on the guest (`directus_users`) are recounted from those rows
 * and from the completed orders, never edited by hand.
 *
 * - sign-up: a new guest gets the welcome points;
 * - checkout (`orders.checkout`, asked by `order-guard` through the extensions'
 *   own emitter): checks the points a guest wants to spend against the balance
 *   and the share of the order, adds the birthday discount;
 * - an order: once written its points are taken, «Выполнен» brings the
 *   accrual by tier, «Отменён» gives back what was taken and takes back what
 *   was given — always by comparing what the order should have done with what
 *   it has (`reconcileOrder`), so repeated or reordered events end the same;
 * - every night: burnt points are written off (soonest-burning first), the
 *   birthday gift arrives once a year inside its window, old sign-in codes go;
 * - an editor may add a manual entry: plus or minus, with a comment.
 *
 * «Вкусные баллы»: учёт за личным кабинетом. Каждое движение баллов — строка в
 * `bonus_transactions`; баланс, сумма покупок и уровень у гостя
 * (`directus_users`) пересчитываются из этих строк и выполненных заказов и
 * руками не правятся.
 *
 * - регистрация: новый гость получает приветственные баллы;
 * - оформление (`orders.checkout`, его спрашивает `order-guard` через
 *   собственный эмиттер расширений): проверяет баллы, которые гость хочет
 *   списать, по балансу и доле заказа, добавляет скидку именинника;
 * - заказ: после записи его баллы списываются, «Выполнен» приносит начисление
 *   по уровню, «Отменён» возвращает списанное и забирает начисленное — всегда
 *   сравнением того, что заказ должен был сделать, с тем, что сделал
 *   (`reconcileOrder`), поэтому повторные и перепутанные события дают один итог;
 * - каждую ночь: сгоревшие баллы списываются (первыми — сгорающие раньше),
 *   подарок ко дню рождения приходит раз в год в своём окне, старые коды
 *   входа удаляются;
 * - редактор может провести операцию вручную: плюс или минус, с комментарием.
 *
 * No build step: this file is the extension. / Без сборки: этот файл и есть расширение.
 */
import {
  birthdayDiscountFor,
  birthdayWindow,
  dayOf,
  expiriesDue,
  expiryFor,
  ledger,
  maxSpend,
  reconcileOrder,
  tierFor,
  toProgram,
} from './rules.js';

const GUEST_ROLE = 'Гость';
const DAY = 86_400_000;

class LoyaltyError extends Error {
  name = 'DirectusError';
  constructor(message, status = 400, code = 'INVALID_PAYLOAD') {
    super(message);
    this.status = status;
    this.code = code;
    this.extensions = { reason: message };
  }
}

const rub = (n) => `${new Intl.NumberFormat('ru-RU').format(n)} ₽`;
/** `date` comes back as a string or a Date at UTC midnight / `date` приходит строкой или Date на полночь UTC */
const asDay = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const ddmm = (day) => day.split('-').reverse().slice(0, 2).join('.');
/** начало дня по Самаре как момент времени: для сравнения с `date_created` */
const samaraMidnight = (day) => new Date(`${day}T00:00:00+04:00`);

export default ({ filter, action, schedule, init }, { database, logger, emitter }) => {
  const today = () => dayOf(new Date());

  const program = async (db = database) => {
    try {
      return toProgram(await db('loyalty_settings').first());
    } catch {
      // the schema is not applied yet: the defaults, nothing breaks
      // схема ещё не применена: значения по умолчанию, ничего не падает
      return toProgram(null);
    }
  };

  let guestRoleId = null;
  const guestRole = async (db = database) => {
    if (!guestRoleId) guestRoleId = (await db('directus_roles').where({ name: GUEST_ROLE }).first('id'))?.id ?? null;
    return guestRoleId;
  };

  const txsOf = async (db, user) =>
    (await db('bonus_transactions').where({ user }).select('id', 'type', 'amount', 'date_created', 'expires_at')).map((row) => ({
      id: row.id,
      type: row.type,
      amount: Number(row.amount),
      date: new Date(row.date_created).toISOString(),
      expires: row.expires_at ? asDay(row.expires_at) : null,
    }));

  /** Провести операции гостю: плюсы получают срок сгорания, если своего нет. */
  const post = async (db, user, list, { order = null, ttlDays }) => {
    for (const tx of list) {
      await db('bonus_transactions').insert({
        user,
        type: tx.type,
        amount: tx.amount,
        order,
        expires_at: tx.amount > 0 ? (tx.expires ?? expiryFor(today(), ttlDays)) : null,
        comment: tx.comment ?? null,
        date_created: new Date(),
      });
    }
  };

  const spentBy = async (db, user, exceptOrder = null) => {
    let query = db('orders').where({ customer: user, status: 'done' });
    if (exceptOrder) query = query.whereNot({ id: exceptOrder });
    const row = await query.select(db.raw('coalesce(sum(coalesce(to_pay, total)), 0) as spent')).first();
    return Number(row?.spent ?? 0);
  };

  /** Баланс, сумма покупок и уровень гостя — заново из операций и заказов. */
  const recount = async (db, user) => {
    if (!user) return;
    const p = await program(db);
    const { available } = ledger(await txsOf(db, user), today());
    const spent = await spentBy(db, user);
    await db('directus_users')
      .where({ id: user })
      .update({ bonus_balance: available, total_spent: spent, tier: tierFor(spent, p.tiers).tier.name });
  };

  /**
   * A guest's ledger is written one job at a time: two orders from two tabs
   * and two settles of one order queue behind a Postgres advisory lock that
   * lives as long as the transaction, so the same points are not spent twice
   * and an order is not accrued twice.
   * Книга гостя пишется по одной работе за раз: два заказа из двух вкладок и
   * два пересчёта одного заказа встают в очередь за advisory-блокировкой
   * Postgres, живущей вместе с транзакцией, — одни баллы не тратятся дважды,
   * заказ не начисляется дважды.
   */
  const withGuest = (db, user, run) =>
    db.transaction(async (trx) => {
      await trx.raw('select pg_advisory_xact_lock(hashtext(?))', [`loyalty:${user}`]);
      return run(trx);
    });

  /** Заказ ↔ баланс: провести недостающие операции и записать начисленное в заказ. */
  const settle = async (db, orderId) => {
    const head = await db('orders').where({ id: orderId }).first('customer');
    if (!head?.customer) return;
    await withGuest(db, head.customer, async (trx) => {
      const order = await trx('orders')
        .where({ id: orderId })
        .first('id', 'number', 'status', 'customer', 'bonus_spent', 'to_pay', 'total', 'discount', 'manager_note');
      if (!order?.customer) return;
      const p = await program(trx);
      const applied = (await trx('bonus_transactions').where({ order: orderId, user: order.customer }).select('type', 'amount')).map((tx) => ({
        type: tx.type,
        amount: Number(tx.amount),
      }));
      // the percent of the tier the guest had before this order
      // процент уровня, который был у гостя до этого заказа
      const percent = tierFor(await spentBy(trx, order.customer, orderId), p.tiers).tier.percent;
      let ops = reconcileOrder(
        { status: order.status, bonus_spent: Number(order.bonus_spent ?? 0), to_pay: order.to_pay ?? null, total: Number(order.total ?? 0) },
        applied,
        percent,
      );
      // a switched-off programme accrues nothing new, but still returns points taken by a cancelled order
      // выключенная программа ничего нового не начисляет, но баллы отменённого заказа возвращает
      if (!p.enabled) ops = ops.filter((op) => op.type === 'refund');
      // The checkout saw the balance before the order existed; under the lock
      // it is read once more. A second order that raced for the same points
      // takes what is left, the rest goes back to the bill, the manager sees why.
      // Оформление видело баланс до того, как заказ появился; под блокировкой он
      // читается ещё раз. Второй заказ, бежавший за теми же баллами, берёт
      // остаток, остальное возвращается в счёт, менеджер видит почему.
      const spend = ops.find((op) => op.type === 'spend');
      if (spend) {
        const { available } = ledger(await txsOf(trx, order.customer), today());
        const want = -spend.amount;
        if (want > available) {
          const got = Math.max(0, Math.floor(available));
          const total = Number(order.total ?? 0);
          const discount = Number(order.discount ?? 0);
          const toPay = Math.max(0, total - discount - got);
          const line = `Баллы: на счёте было ${got} из ${want} запрошенных — списано ${got}, к оплате ${rub(toPay)}.`;
          await trx('orders')
            .where({ id: orderId })
            .update({ bonus_spent: got, to_pay: toPay, manager_note: [order.manager_note, line].filter(Boolean).join('\n') });
          logger.warn(`loyalty: заказ ${order.number} — ${line}`);
          if (got > 0) spend.amount = -got;
          else ops = ops.filter((op) => op !== spend);
        }
      }
      if (ops.length) {
        await post(
          trx,
          order.customer,
          ops.map((op) => ({ ...op, comment: `${op.comment} · заказ ${order.number}` })),
          { order: orderId, ttlDays: p.ttlDays },
        );
        logger.info(`loyalty: заказ ${order.number} — ${ops.map((op) => `${op.type} ${op.amount}`).join(', ')}`);
      }
      const earned = [...applied, ...ops]
        .filter((tx) => tx.type === 'accrual' || (tx.type === 'refund' && tx.amount < 0))
        .reduce((sum, tx) => sum + tx.amount, 0);
      await trx('orders').where({ id: orderId }).update({ bonus_earned: Math.max(0, earned) });
      await recount(trx, order.customer);
    });
  };

  const guard = (what, run) =>
    run().catch((error) => {
      // the order or the guest is already saved; a failed recount is logged and redone at night
      // заказ или гость уже сохранены; несостоявшийся пересчёт пишется в лог и повторяется ночью
      logger.error(`loyalty: ${what} — ${error.message}`);
    });

  // ── checkout: asked by order-guard / оформление: спрашивает order-guard ───
  emitter.onFilter('orders.checkout', async (draft, _meta, context = {}) => {
    if (!draft?.customer) return draft;
    const db = context.database ?? database;
    const p = await program(db);
    if (!p.enabled) return { ...draft, bonus_spent: 0, discount: 0, note: null };
    const t = today();
    const user = await db('directus_users').where({ id: draft.customer }).first('id', 'birthday', 'birthday_set_at');
    const total = Math.max(0, Math.floor(Number(draft.total) || 0));

    let discount = 0;
    if (p.birthdayDiscount > 0 && user?.birthday) {
      const win = birthdayWindow(asDay(user.birthday), t, p.birthdayWindow);
      const early = !user.birthday_set_at || dayOf(user.birthday_set_at) < win?.from;
      if (win?.inWindow && early) {
        // one discounted order per birthday / один заказ со скидкой на день рождения
        const used = await db('orders')
          .where({ customer: draft.customer })
          .where('discount', '>', 0)
          .whereNot({ status: 'cancelled' })
          .where('date_created', '>=', samaraMidnight(win.from))
          .first('id');
        if (!used) discount = birthdayDiscountFor(total, p.birthdayDiscount);
      }
    }

    const requested = Math.max(0, Math.floor(Number(draft.requested) || 0));
    let bonus = 0;
    if (requested > 0) {
      const { available } = ledger(await txsOf(db, draft.customer), t);
      const max = maxSpend({ total, balance: available, sharePercent: p.maxSharePercent, discount });
      if (requested > max)
        throw new LoyaltyError(
          max > 0
            ? `Баллами можно оплатить до ${rub(max)} этого заказа — столько сейчас на счёте и в пределах ${p.maxSharePercent} %. Обновите корзину.`
            : 'Баллы сейчас нельзя списать в этот заказ. Отправьте его без баллов.',
        );
      bonus = requested;
    }
    const parts = [];
    if (discount) parts.push(`скидка именинника ${p.birthdayDiscount} %: ${rub(discount)}`);
    if (bonus) parts.push(`оплачено баллами: ${rub(bonus)}`);
    return {
      ...draft,
      bonus_spent: bonus,
      discount,
      note: parts.length ? `Личный кабинет — ${parts.join(', ')}. К оплате ${rub(total - discount - bonus)}.` : null,
    };
  });

  // ── orders / заказы ─────────────────────────────────────────────────────
  action('orders.items.create', ({ key }) => guard(`заказ ${key}`, () => settle(database, key)));
  action('orders.items.update', ({ keys, payload }) => {
    if (!['status', 'customer', 'bonus_spent', 'to_pay', 'total'].some((field) => field in (payload ?? {}))) return;
    for (const key of keys) guard(`заказ ${key}`, () => settle(database, key));
  });

  // ── guests / гости ──────────────────────────────────────────────────────
  action('users.create', ({ key, payload }) =>
    guard(`гость ${key}`, async () => {
      if (!payload?.role || payload.role !== (await guestRole())) return;
      await withGuest(database, key, async (trx) => {
        const p = await program(trx);
        const had = await trx('bonus_transactions').where({ user: key, type: 'signup' }).first('id');
        if (p.enabled && p.signupBonus > 0 && !had) {
          await post(trx, key, [{ type: 'signup', amount: p.signupBonus, comment: `Добро пожаловать в «${p.name}»` }], { ttlDays: p.ttlDays });
        }
        await recount(trx, key);
      });
    }),
  );

  // A guest types the birthday once: changing it later would be a new gift
  // every week. An editor fixes a typo on request.
  // Гость указывает день рождения один раз: менять его потом — новый подарок
  // каждую неделю. Опечатку по просьбе исправляет редактор.
  filter('users.update', async (payload, meta, { accountability }) => {
    if (!payload || !('birthday' in payload) || !accountability?.user || accountability.admin) return payload;
    if (accountability.role !== (await guestRole())) return payload;
    const rows = await database('directus_users').whereIn('id', meta.keys ?? []).select('birthday');
    const wanted = payload.birthday ? asDay(payload.birthday) : null;
    if (rows.some((row) => row.birthday && asDay(row.birthday) !== wanted))
      throw new LoyaltyError('Дату рождения можно указать один раз. Ошиблись — позвоните нам, исправим.');
    return payload;
  });
  action('users.update', ({ keys, payload }, { accountability }) =>
    guard('дата рождения', async () => {
      if (!payload?.birthday || !accountability?.user || accountability.role !== (await guestRole())) return;
      await database('directus_users').whereIn('id', keys).whereNull('birthday_set_at').update({ birthday_set_at: new Date() });
    }),
  );

  // ── manual entries / ручные операции ────────────────────────────────────
  filter('bonus_transactions.items.create', async (payload, _meta, { accountability }) => {
    if (!accountability?.user) return payload;
    const amount = Math.trunc(Number(payload.amount));
    if (!Number.isFinite(amount) || amount === 0) throw new LoyaltyError('Укажите, сколько баллов начислить (плюс) или списать (минус).');
    if (!payload.user) throw new LoyaltyError('Выберите гостя.');
    const p = await program();
    if (amount < 0) {
      const { available } = ledger(await txsOf(database, payload.user), today());
      if (available + amount < 0) throw new LoyaltyError(`У гостя ${available} баллов — списать больше нельзя.`);
    }
    return {
      ...payload,
      type: 'manual',
      amount,
      expires_at: amount > 0 ? (payload.expires_at ?? expiryFor(today(), p.ttlDays)) : null,
    };
  });
  const touched = new Map();
  filter('bonus_transactions.items.delete', async (keys) => {
    const users = await database('bonus_transactions').whereIn('id', keys).distinct('user').pluck('user');
    touched.set(keys.join(','), users);
    return keys;
  });
  action('bonus_transactions.items.create', ({ payload }) => guard('операция', () => recount(database, payload?.user)));
  action('bonus_transactions.items.update', ({ keys }) =>
    guard('операция', async () => {
      for (const user of await database('bonus_transactions').whereIn('id', keys).distinct('user').pluck('user')) await recount(database, user);
    }),
  );
  action('bonus_transactions.items.delete', ({ keys }) =>
    guard('операция', async () => {
      const users = touched.get(keys.join(',')) ?? [];
      touched.delete(keys.join(','));
      for (const user of users) await recount(database, user);
    }),
  );

  // ── every night / каждую ночь ───────────────────────────────────────────
  let running = false;
  const nightly = async () => {
    if (running) return;
    running = true;
    try {
      const p = await program();
      const t = today();
      const role = await guestRole();
      let burnt = 0;
      let gifts = 0;
      // burnt points: one `expire` per burnt lot, while the programme is on
      // сгоревшие баллы: по операции `expire` на сгоревшую партию, пока программа включена
      const users = await database('bonus_transactions').distinct('user').whereNotNull('user').pluck('user');
      for (const user of users) {
        if (p.enabled) {
          const due = expiriesDue(await txsOf(database, user), t);
          if (due.length) {
            await post(database, user, due, { ttlDays: p.ttlDays });
            burnt += due.reduce((sum, tx) => sum - tx.amount, 0);
          }
        }
        await recount(database, user);
      }
      // the birthday gift: once a year, inside the window, if the date was typed before the window
      // подарок ко дню рождения: раз в год, в окне, если дату указали до начала окна
      if (p.enabled && p.birthdayBonus > 0 && role) {
        const guests = await database('directus_users')
          .where({ role, status: 'active' })
          .whereNotNull('birthday')
          .select('id', 'birthday', 'birthday_set_at', 'birthday_bonus_year');
        for (const guest of guests) {
          const win = birthdayWindow(asDay(guest.birthday), t, p.birthdayWindow);
          if (!win?.inWindow || Number(guest.birthday_bonus_year) === win.year) continue;
          const late = guest.birthday_set_at && dayOf(guest.birthday_set_at) >= win.from;
          await database('directus_users').where({ id: guest.id }).update({ birthday_bonus_year: win.year });
          if (late) continue;
          await post(
            database,
            guest.id,
            [{ type: 'birthday', amount: p.birthdayBonus, expires: win.burns, comment: `С днём рождения! Баллы действуют до ${ddmm(win.until)}` }],
            { ttlDays: p.ttlDays },
          );
          await recount(database, guest.id);
          gifts += 1;
        }
      }
      // sign-in codes live five minutes; two days of them are enough for the limits and a dispute
      // коды входа живут пять минут; двух суток хватает и для лимитов, и для разбора
      const codes = await database('auth_codes').where('date_created', '<', new Date(Date.now() - 2 * DAY)).delete();
      logger.info(`loyalty: ночной проход ${t} — сгорело ${burnt} баллов, подарков ко дню рождения ${gifts}, старых кодов ${codes}`);
    } finally {
      running = false;
    }
  };

  // 21:05 UTC = 01:05 in Samara: after the 00:10 site rebuild, before anyone orders
  // 21:05 UTC = 01:05 по Самаре: после пересборки сайта в 00:10, до первых заказов
  schedule('5 21 * * *', () => nightly().catch((error) => logger.error(`loyalty: ночной проход — ${error.message}`)));
  // a restart catches up what a missed night left: the pass is idempotent
  // перезапуск догоняет пропущенную ночь: проход идемпотентен
  init('app.after', () => {
    setTimeout(() => nightly().catch((error) => logger.warn(`loyalty: проход после запуска — ${error.message}`)), 20_000).unref?.();
  });
};
