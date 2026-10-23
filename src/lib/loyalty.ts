/**
 * «Вкусные баллы»: the rules of the loyalty programme as pure functions. One
 * point is one rouble. A guest earns a percentage of what an order cost in
 * money, by tier (the sum of all completed orders); may pay part of an order
 * with points; gets points for signing up and around the birthday; points
 * burn after their term, the soonest-burning first. The page reads these to
 * show the balance, the tier and the slider in the cart; the Directus hook
 * (`directus/extensions/loyalty/rules.js`) repeats them to do the real
 * accounting — `loyalty.check.ts` runs the same cases through both.
 * «Вкусные баллы»: правила программы лояльности чистыми функциями. Один балл —
 * один рубль. Гость получает процент от того, что заказ стоил деньгами, по
 * уровню (сумма всех выполненных заказов); может оплатить часть заказа
 * баллами; получает баллы за регистрацию и ко дню рождения; баллы сгорают по
 * сроку, первыми — те, что сгорают раньше. Страница считает по ним баланс,
 * уровень и ползунок в корзине; хук Directus
 * (`directus/extensions/loyalty/rules.js`) повторяет их для настоящего учёта —
 * `loyalty.check.ts` гоняет одни и те же случаи через оба.
 */

export type Tier = { name: string; from: number; percent: number };

export type Program = {
  enabled: boolean;
  name: string;
  signupBonus: number;
  /** дней живут начисленные баллы; 0 — не сгорают */
  ttlDays: number;
  /** какую долю заказа (после скидки) можно оплатить баллами, % */
  maxSharePercent: number;
  tiers: Tier[];
  birthdayBonus: number;
  /** окно дня рождения: ± дней */
  birthdayWindow: number;
  /** скидка именинника на один заказ в окне, %; 0 — нет */
  birthdayDiscount: number;
};

export type TxType = 'signup' | 'birthday' | 'accrual' | 'spend' | 'expire' | 'refund' | 'manual';

/** Одна операция по баллам: как она лежит в `bonus_transactions`. */
export type Tx = {
  id?: number;
  type: TxType;
  amount: number;
  /** когда проведена, ISO */
  date: string;
  /** день, с которого баллы сгорели (YYYY-MM-DD); только у начислений */
  expires?: string | null;
};

export const TX_LABEL: Record<TxType, string> = {
  signup: 'За регистрацию',
  birthday: 'Ко дню рождения',
  accrual: 'За заказ',
  spend: 'Оплата заказа',
  expire: 'Сгорели',
  refund: 'Возврат по заказу',
  manual: 'Начислено вручную',
};

export const DEFAULT_TIERS: Tier[] = [
  { name: '1', from: 0, percent: 3 },
  { name: '2', from: 10000, percent: 5 },
  { name: '3', from: 30000, percent: 7 },
];

export const DEFAULT_PROGRAM: Program = {
  enabled: true,
  name: 'Вкусные баллы',
  signupBonus: 200,
  ttlDays: 365,
  maxSharePercent: 30,
  tiers: DEFAULT_TIERS,
  birthdayBonus: 500,
  birthdayWindow: 3,
  birthdayDiscount: 0,
};

const ZONE = 'Europe/Samara';
const DAY = 86_400_000;

const whole = (value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && value !== null && value !== '' ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Tiers as the admin typed them → a clean ladder: no nameless or duplicate
 * steps, sorted by the threshold, the first one always from 0 ₽ (a guest with
 * no purchases still has a tier and a percentage).
 * Уровни, как их набрали в админке, → чистая лестница: без безымянных и
 * повторяющихся ступеней, по порогу, первая всегда от 0 ₽ (у гостя без покупок
 * тоже есть уровень и процент).
 */
export const cleanTiers = (raw: unknown): Tier[] => {
  const list = (Array.isArray(raw) ? raw : [])
    .map((item) => ({
      name: String(item?.name ?? '').trim(),
      from: whole(item?.from, 0),
      percent: whole(item?.percent, 0, 0, 100),
    }))
    .filter((tier) => tier.name)
    .sort((a, b) => a.from - b.from)
    .filter((tier, i, all) => i === 0 || tier.from !== all[i - 1].from);
  if (!list.length) return DEFAULT_TIERS.map((tier) => ({ ...tier }));
  list[0] = { ...list[0], from: 0 };
  return list;
};

/** Строка «Программы лояльности» из Directus → программа с безопасными значениями. */
export const toProgram = (raw: Record<string, unknown> | null | undefined): Program => {
  if (!raw) return { ...DEFAULT_PROGRAM, tiers: cleanTiers(null) };
  const d = DEFAULT_PROGRAM;
  return {
    enabled: raw.enabled !== false,
    name: String(raw.program_name ?? '').trim() || d.name,
    signupBonus: whole(raw.signup_bonus, d.signupBonus),
    ttlDays: whole(raw.points_ttl_days, d.ttlDays),
    maxSharePercent: whole(raw.max_share_percent, d.maxSharePercent, 0, 100),
    tiers: cleanTiers(typeof raw.tiers === 'string' ? JSON.parse(raw.tiers) : raw.tiers),
    birthdayBonus: whole(raw.birthday_bonus, d.birthdayBonus),
    birthdayWindow: whole(raw.birthday_window_days, d.birthdayWindow, 0, 30),
    birthdayDiscount: whole(raw.birthday_discount_percent, d.birthdayDiscount, 0, 50),
  };
};

/**
 * Where a guest stands: the tier for the sum of purchases, the next one and
 * how much is left to it; `progress` is the share of the way between the two
 * thresholds (1 on the top tier).
 * Где стоит гость: уровень по сумме покупок, следующий и сколько до него
 * осталось; `progress` — доля пути между двумя порогами (1 на верхнем уровне).
 */
export const tierFor = (spent: number, tiers: Tier[]) => {
  const ladder = cleanTiers(tiers);
  let index = 0;
  for (let i = 0; i < ladder.length; i += 1) if (spent >= ladder[i].from) index = i;
  const tier = ladder[index];
  const next = ladder[index + 1] ?? null;
  const left = next ? Math.max(0, next.from - spent) : 0;
  const progress = next ? Math.min(1, Math.max(0, (spent - tier.from) / (next.from - tier.from))) : 1;
  return { tier, index, next, left, progress };
};

/** Баллы за выполненный заказ: процент уровня от оплаченного деньгами, вниз до целого. */
export const accrualFor = (paid: number, percent: number) => Math.max(0, Math.floor((Math.max(0, paid) * percent) / 100));

/**
 * The most points an order may take: no more than the balance and no more
 * than the share of the order left after the birthday discount.
 * Сколько баллов можно списать в заказ: не больше баланса и не больше доли
 * заказа, оставшейся после скидки именинника.
 */
export const maxSpend = ({ total, balance, sharePercent, discount = 0 }: { total: number; balance: number; sharePercent: number; discount?: number }) =>
  Math.max(0, Math.min(Math.floor(balance), Math.floor((Math.max(0, total - discount) * sharePercent) / 100)));

/** Скидка именинника на заказ, ₽: процент от суммы, вниз до целого. */
export const birthdayDiscountFor = (total: number, percent: number) => Math.max(0, Math.floor((total * percent) / 100));

/** День в часовом поясе точек: «2026-10-19». */
export const dayOf = (iso: string | Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE }).format(new Date(iso));

/** День + n дней: «2026-10-19» + 3 → «2026-10-22». */
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Разница дней `b − a` для «YYYY-MM-DD». */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Когда сгорят баллы, начисленные в `day`: через `ttlDays` дней; `null` — не сгорают. */
export const expiryFor = (day: string, ttlDays: number) => (ttlDays > 0 ? addDays(day, ttlDays) : null);

const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * The birthday nearest to `today` and whether today is inside its ±`days`
 * window; the window may cross the new year. A 29 February birthday falls on
 * 28 February in a common year. `burns` is the first day after the window —
 * when the birthday points go.
 * Ближайший к `today` день рождения и попадает ли сегодня в его окно ±`days`;
 * окно может перейти через Новый год. 29 февраля в невисокосный год — 28-е.
 * `burns` — первый день после окна: тогда сгорают баллы ко дню рождения.
 */
export const birthdayWindow = (birthday: string | null | undefined, today: string, days: number) => {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}/.test(birthday)) return null;
  const month = Number(birthday.slice(5, 7));
  const date = Number(birthday.slice(8, 10));
  const year = Number(today.slice(0, 4));
  let best: { day: string; year: number; distance: number } | null = null;
  for (const y of [year - 1, year, year + 1]) {
    const d = month === 2 && date === 29 && !leap(y) ? 28 : date;
    const day = `${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const distance = daysBetween(day, today);
    if (!best || Math.abs(distance) < Math.abs(best.distance)) best = { day, year: y, distance };
  }
  const { day, year: occurrence, distance } = best!;
  return {
    /** этот день рождения: «2026-10-21» */
    day,
    /** год этого дня рождения — за него дарится подарок */
    year: occurrence,
    /** сегодня минус день рождения, дней: −2 — через два дня */
    distance,
    inWindow: Math.abs(distance) <= days,
    from: addDays(day, -days),
    until: addDays(day, days),
    burns: addDays(day, days + 1),
  };
};

export type Lot = { id?: number; type: TxType; day: string; amount: number; left: number; expires: string | null };

/**
 * The ledger behind the balance. Every credit is a lot with its own term;
 * every debit takes from the lots alive on its day, the soonest-burning first
 * (FIFO by the burn date: the birthday points, which live a week, go before a
 * year-old accrual), an `expire` debit takes from the lots already burnt. A
 * debit with nothing to take from leaves a debt the next credit pays off. On
 * `today` the result says what can be spent, what burnt and has not been
 * written off yet, and what is going to burn and when.
 * Книга под балансом. Каждое начисление — партия со своим сроком; каждое
 * списание берёт из партий, живых в его день, сначала сгорающие раньше (FIFO
 * по дню сгорания: баллы ко дню рождения, живущие неделю, уходят раньше
 * годового начисления), списание `expire` берёт из уже сгоревших. Списание,
 * которому не из чего взять, оставляет долг — его гасит следующее начисление.
 * На `today` результат говорит, сколько можно потратить, что сгорело и ещё не
 * списано и что и когда сгорит.
 */
export const ledger = (txs: Tx[], today: string) => {
  const sorted = [...txs].sort((a, b) => (a.date === b.date ? (a.id ?? 0) - (b.id ?? 0) : a.date < b.date ? -1 : 1));
  const lots: Lot[] = [];
  let debt = 0;
  for (const tx of sorted) {
    const day = dayOf(tx.date);
    if (tx.amount > 0) {
      const lot: Lot = { id: tx.id, type: tx.type, day, amount: tx.amount, left: tx.amount, expires: tx.expires ?? null };
      const cover = Math.min(debt, lot.left);
      lot.left -= cover;
      debt -= cover;
      lots.push(lot);
      continue;
    }
    let need = -tx.amount;
    const burnt = tx.type === 'expire';
    const pool = lots
      .filter((lot) => lot.left > 0 && (burnt ? lot.expires !== null && lot.expires <= day : lot.expires === null || lot.expires > day))
      .sort((a, b) => (a.expires ?? '9999-12-31').localeCompare(b.expires ?? '9999-12-31') || a.day.localeCompare(b.day));
    for (const lot of pool) {
      if (!need) break;
      const take = Math.min(need, lot.left);
      lot.left -= take;
      need -= take;
    }
    debt += need;
  }
  const alive = lots.filter((lot) => lot.left > 0 && (lot.expires === null || lot.expires > today));
  const burnt = lots.filter((lot) => lot.left > 0 && lot.expires !== null && lot.expires <= today);
  const soon = new Map<string, number>();
  for (const lot of alive) if (lot.expires) soon.set(lot.expires, (soon.get(lot.expires) ?? 0) + lot.left);
  return {
    /** можно потратить сегодня */
    available: Math.max(0, alive.reduce((sum, lot) => sum + lot.left, 0) - debt),
    /** сумма всех операций, как в выписке */
    book: txs.reduce((sum, tx) => sum + tx.amount, 0),
    debt,
    /** сгоревшие партии, которые ещё не списаны операцией `expire` */
    burnt,
    /** что и когда сгорит: [день, баллов] по возрастанию дня */
    expiring: [...soon.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, amount]) => ({ day, amount })),
  };
};

/** Операции `expire`, которые надо провести на `today`: по одной на сгоревшую партию. */
export const expiriesDue = (txs: Tx[], today: string) =>
  ledger(txs, today).burnt.map((lot) => ({
    type: 'expire' as const,
    amount: -lot.left,
    comment: `Сгорели баллы от ${lot.day.split('-').reverse().join('.')}`,
  }));

export type OrderState = {
  status: string;
  bonus_spent?: number | null;
  to_pay?: number | null;
  total?: number | null;
};

/**
 * What an order should have done to the balance, against what it has: the
 * points it took stay taken unless it is cancelled; the accrual exists only
 * while it is done. Returns the operations that close the gap, so a status
 * switched back and forth, a repeated event or a lost one all end the same.
 * Что заказ должен был сделать с балансом против того, что сделал: списанные
 * баллы остаются списанными, пока он не отменён; начисление есть, только пока
 * он выполнен. Возвращает операции, закрывающие разницу, поэтому статус,
 * переключённый туда-обратно, повторное или потерянное событие дают один итог.
 */
export const reconcileOrder = (order: OrderState, applied: Pick<Tx, 'type' | 'amount'>[], percent: number) => {
  const spent = applied.filter((tx) => tx.type === 'spend' || (tx.type === 'refund' && tx.amount > 0)).reduce((sum, tx) => sum + tx.amount, 0);
  const earned = applied.filter((tx) => tx.type === 'accrual' || (tx.type === 'refund' && tx.amount < 0)).reduce((sum, tx) => sum + tx.amount, 0);
  const out: { type: TxType; amount: number; comment: string }[] = [];
  const wantSpent = order.status === 'cancelled' ? 0 : -Math.max(0, Math.floor(order.bonus_spent ?? 0));
  if (wantSpent !== spent) {
    const amount = wantSpent - spent;
    out.push(
      amount > 0
        ? { type: 'refund', amount, comment: 'Заказ отменён — баллы вернулись' }
        : { type: 'spend', amount, comment: 'Оплата заказа баллами' },
    );
  }
  // points spent on an order close its accrual: a paid-with-points order earns nothing (owner, 23.10.2026)
  // списанные баллы закрывают начисление: заказ, частично оплаченный баллами, баллов не приносит (владелец, 23.10.2026)
  const spentPoints = Math.max(0, Math.floor(order.bonus_spent ?? 0)) > 0;
  if (order.status === 'done' && earned <= 0 && !spentPoints) {
    const paid = order.to_pay ?? order.total ?? 0;
    const amount = accrualFor(paid, percent) - earned;
    if (amount > 0) out.push({ type: 'accrual', amount, comment: `${percent}\u00a0% от ${new Intl.NumberFormat('ru-RU').format(paid)}\u00a0₽` });
  } else if (order.status !== 'done' && earned > 0) {
    out.push({ type: 'refund', amount: -earned, comment: 'Заказ отменён — начисление снято' });
  }
  return out;
};

/** «1 день», «3 дня», «5 дней»: число и слово через неразрывный пробел. */
export const plural = (n: number, one: string, few: string, many: string) => {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  const word = abs > 10 && abs < 20 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return `${new Intl.NumberFormat('ru-RU').format(n)} ${word}`;
};

/** «1 балл», «2 балла», «5 баллов». */
export const points = (n: number) => plural(n, 'балл', 'балла', 'баллов');
