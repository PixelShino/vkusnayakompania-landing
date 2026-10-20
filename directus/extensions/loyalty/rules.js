/**
 * The rules of «Вкусные баллы» for the server: the same pure functions as
 * `src/lib/loyalty.ts` on the site, in plain JavaScript (the container runs
 * the extension as is, without a build). `src/lib/loyalty.check.ts` runs the
 * same cases through both files, so a rule changed in one and not the other
 * fails `pnpm test`.
 * Правила «Вкусных баллов» для сервера: те же чистые функции, что
 * `src/lib/loyalty.ts` сайта, на простом JavaScript (контейнер запускает
 * расширение как есть, без сборки). `src/lib/loyalty.check.ts` гоняет одни и
 * те же случаи через оба файла: правило, изменённое в одном и не изменённое в
 * другом, роняет `pnpm test`.
 */

export const DEFAULT_TIERS = [
  { name: '1', from: 0, percent: 3 },
  { name: '2', from: 10000, percent: 5 },
  { name: '3', from: 30000, percent: 7 },
];

export const DEFAULT_PROGRAM = {
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

const whole = (value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && value !== null && value !== '' ? Math.min(max, Math.max(min, n)) : fallback;
};

export const cleanTiers = (raw) => {
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

export const toProgram = (raw) => {
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

export const tierFor = (spent, tiers) => {
  const ladder = cleanTiers(tiers);
  let index = 0;
  for (let i = 0; i < ladder.length; i += 1) if (spent >= ladder[i].from) index = i;
  const tier = ladder[index];
  const next = ladder[index + 1] ?? null;
  const left = next ? Math.max(0, next.from - spent) : 0;
  const progress = next ? Math.min(1, Math.max(0, (spent - tier.from) / (next.from - tier.from))) : 1;
  return { tier, index, next, left, progress };
};

export const accrualFor = (paid, percent) => Math.max(0, Math.floor((Math.max(0, paid) * percent) / 100));

export const maxSpend = ({ total, balance, sharePercent, discount = 0 }) =>
  Math.max(0, Math.min(Math.floor(balance), Math.floor((Math.max(0, total - discount) * sharePercent) / 100)));

export const birthdayDiscountFor = (total, percent) => Math.max(0, Math.floor((total * percent) / 100));

export const dayOf = (iso) => new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE }).format(new Date(iso));

export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export const expiryFor = (day, ttlDays) => (ttlDays > 0 ? addDays(day, ttlDays) : null);

const leap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export const birthdayWindow = (birthday, today, days) => {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}/.test(String(birthday))) return null;
  birthday = String(birthday);
  const month = Number(birthday.slice(5, 7));
  const date = Number(birthday.slice(8, 10));
  const year = Number(today.slice(0, 4));
  let best = null;
  for (const y of [year - 1, year, year + 1]) {
    const d = month === 2 && date === 29 && !leap(y) ? 28 : date;
    const day = `${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const distance = daysBetween(day, today);
    if (!best || Math.abs(distance) < Math.abs(best.distance)) best = { day, year: y, distance };
  }
  const { day, year: occurrence, distance } = best;
  return {
    day,
    year: occurrence,
    distance,
    inWindow: Math.abs(distance) <= days,
    from: addDays(day, -days),
    until: addDays(day, days),
    burns: addDays(day, days + 1),
  };
};

export const ledger = (txs, today) => {
  const sorted = [...txs].sort((a, b) => (a.date === b.date ? (a.id ?? 0) - (b.id ?? 0) : a.date < b.date ? -1 : 1));
  const lots = [];
  let debt = 0;
  for (const tx of sorted) {
    const day = dayOf(tx.date);
    if (tx.amount > 0) {
      const lot = { id: tx.id, type: tx.type, day, amount: tx.amount, left: tx.amount, expires: tx.expires ?? null };
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
  const soon = new Map();
  for (const lot of alive) if (lot.expires) soon.set(lot.expires, (soon.get(lot.expires) ?? 0) + lot.left);
  return {
    available: Math.max(0, alive.reduce((sum, lot) => sum + lot.left, 0) - debt),
    book: txs.reduce((sum, tx) => sum + tx.amount, 0),
    debt,
    burnt,
    expiring: [...soon.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, amount]) => ({ day, amount })),
  };
};

export const expiriesDue = (txs, today) =>
  ledger(txs, today).burnt.map((lot) => ({
    type: 'expire',
    amount: -lot.left,
    comment: `Сгорели баллы от ${lot.day.split('-').reverse().join('.')}`,
  }));

export const reconcileOrder = (order, applied, percent) => {
  const spent = applied.filter((tx) => tx.type === 'spend' || (tx.type === 'refund' && tx.amount > 0)).reduce((sum, tx) => sum + tx.amount, 0);
  const earned = applied.filter((tx) => tx.type === 'accrual' || (tx.type === 'refund' && tx.amount < 0)).reduce((sum, tx) => sum + tx.amount, 0);
  const out = [];
  const wantSpent = order.status === 'cancelled' ? 0 : -Math.max(0, Math.floor(order.bonus_spent ?? 0));
  if (wantSpent !== spent) {
    const amount = wantSpent - spent;
    out.push(
      amount > 0
        ? { type: 'refund', amount, comment: 'Заказ отменён — баллы вернулись' }
        : { type: 'spend', amount, comment: 'Оплата заказа баллами' },
    );
  }
  if (order.status === 'done' && earned <= 0) {
    const paid = order.to_pay ?? order.total ?? 0;
    const amount = accrualFor(paid, percent) - earned;
    if (amount > 0) out.push({ type: 'accrual', amount, comment: `${percent}\u00a0% от ${new Intl.NumberFormat('ru-RU').format(paid)}\u00a0₽` });
  } else if (order.status !== 'done' && earned > 0) {
    out.push({ type: 'refund', amount: -earned, comment: 'Заказ отменён — начисление снято' });
  }
  return out;
};
