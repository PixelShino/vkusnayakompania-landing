/**
 * The guest account on the site's side: the saved session, the calls to the
 * `guest-auth` endpoint of Directus, the profile rules and what the account
 * page and the cart show — balance, tier, spending, birthday — counted from
 * one `/guest-auth/me` answer with the rules of `loyalty.ts`. Pure functions
 * and thin fetch wrappers: the page scripts own the DOM, the checks run these.
 * Личный кабинет со стороны сайта: сохранённая сессия, вызовы адреса
 * `guest-auth` в Directus, правила профиля и то, что показывают кабинет и
 * корзина, — баланс, уровень, траты, день рождения, — посчитанное из одного
 * ответа `/guest-auth/me` по правилам `loyalty.ts`. Чистые функции и тонкие
 * обёртки над fetch: DOM у скриптов страниц, проверки гоняют эти функции.
 */
import { add, empty, type Cart } from './cart.ts';
import {
  TX_LABEL,
  birthdayWindow,
  dayOf,
  daysBetween,
  ledger,
  tierFor,
  toProgram,
  type Program,
  type Tx,
  type TxType,
} from './loyalty.ts';

export const SESSION_KEY = 'vk-account-v1';
/** баллы, о сгорании которых предупреждаем заранее, — за столько дней */
export const BURN_WARNING_DAYS = 30;

export type Session = { token: string; expires: string; phone?: string; name?: string | null };

export type Profile = {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  phone: string;
  birthday: string | null;
  gender: 'female' | 'male' | null;
  recovery_email: string | null;
  bonus_balance: number;
  total_spent: number;
  tier: string | null;
  guest_since: string | null;
  birthday_set_at: string | null;
};

export type OrderItem = { product: number; title: string; variant: string | null; filling: string | null; qty: number; price: number; sum: number };

export type Order = {
  id: number;
  number: string;
  status: 'new' | 'in_work' | 'done' | 'cancelled' | string;
  date_created: string;
  fulfillment: 'delivery' | 'pickup';
  place: number | null;
  address: string | null;
  desired_time: string | null;
  items: OrderItem[] | null;
  total: number;
  bonus_spent: number | null;
  discount: number | null;
  to_pay: number | null;
  bonus_earned: number | null;
};

export type RawTx = {
  id: number;
  type: TxType;
  amount: number;
  date_created: string;
  expires_at: string | null;
  comment: string | null;
  order: { number: string } | null;
};

/** Ответ `GET /guest-auth/me`. */
export type Me = {
  profile: Profile;
  orders: Order[];
  transactions: RawTx[];
  program: Record<string, unknown> | null;
  today: string;
};

// ── session / сессия ───────────────────────────────────────────────────────

/** Срок токена из его же полезной нагрузки (`exp`, секунды); 0 — не разобрать. */
export const tokenExpiry = (token: string) => {
  try {
    const part = token.split('.')[1] ?? '';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return Number(json.exp) * 1000 || 0;
  } catch {
    return 0;
  }
};

/**
 * The saved session, or why there is none: `expired` lets the page say «the
 * session has ended» instead of silently showing the sign-in form.
 * Сохранённая сессия или причина, почему её нет: `expired` позволяет странице
 * сказать «сессия закончилась», а не молча показать форму входа.
 */
export const parseSession = (json: string | null | undefined, now = Date.now()): { session: Session | null; expired: boolean } => {
  if (!json) return { session: null, expired: false };
  try {
    const data = JSON.parse(json);
    if (typeof data?.token !== 'string' || !data.token) return { session: null, expired: false };
    const until = tokenExpiry(data.token) || Date.parse(data.expires);
    if (!until || until <= now) return { session: null, expired: true };
    return { session: { token: data.token, expires: String(data.expires ?? ''), phone: data.phone, name: data.name ?? null }, expired: false };
  } catch {
    return { session: null, expired: false };
  }
};

// ── the API / адрес Directus ───────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  retryAfter: number;
  attemptsLeft: number | null;
  constructor(message: string, status: number, code: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = (extra.fields as Record<string, string>) ?? {};
    this.retryAfter = Number(extra.retry_after) || 0;
    this.attemptsLeft = typeof extra.attempts_left === 'number' ? extra.attempts_left : null;
  }
}

/** Сессия больше не действует: вышли на другом устройстве, истекла, гостя заблокировали. */
export const isSignedOut = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || ['TOKEN_EXPIRED', 'INVALID_CREDENTIALS', 'INVALID_TOKEN', 'NOT_SIGNED_IN'].includes(error.code));

const request = async <T>(base: string, path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<{ status: number; data: T }> => {
  let response: Response;
  try {
    response = await fetch(base + path, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(init.token && { Authorization: `Bearer ${init.token}` }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const timeout = (error as Error)?.name === 'TimeoutError';
    throw new ApiError(timeout ? 'Сервер долго не отвечает. Попробуйте ещё раз.' : 'Нет связи с сервером. Проверьте интернет.', 0, timeout ? 'TIMEOUT' : 'NETWORK');
  }
  if (response.status === 204) return { status: 204, data: null as T };
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const first = body?.errors?.[0];
    const extensions = first?.extensions ?? {};
    throw new ApiError(
      extensions.reason ?? (response.status >= 500 ? 'Сервер не ответил как надо. Попробуйте через минуту.' : first?.message ?? 'Не получилось.'),
      response.status,
      extensions.code ?? 'ERROR',
      extensions,
    );
  }
  return { status: response.status, data: body?.data as T };
};

export type Sent = { request: string; channel: 'call' | 'sms' | 'mobile_id'; length: number; expires_in: number; resend_in: number; hint: string; fallback: boolean; debug?: boolean };
export type Verified = { token: string; expires: string; created: boolean };

export const accountApi = (base: string) => ({
  send: (phone: string, channel?: 'sms') => request<Sent>(base, '/guest-auth/send', { method: 'POST', body: { phone, ...(channel && { channel }) } }).then((r) => r.data),
  /** `null` — ждём подтверждения у оператора (мобильная авторизация) */
  verify: async (phone: string, code?: string) => {
    const result = await request<Verified | { pending: true; otp: boolean }>(base, '/guest-auth/verify', { method: 'POST', body: { phone, code } });
    return result.status === 202 ? null : (result.data as Verified);
  },
  me: (token: string) => request<Me>(base, '/guest-auth/me', { token }).then((r) => r.data),
  saveProfile: (token: string, profile: ProfileInput) => request<Profile>(base, '/guest-auth/profile', { method: 'POST', token, body: profile }).then((r) => r.data),
  logout: (token: string) => request<null>(base, '/guest-auth/logout', { method: 'POST', token }).then(() => undefined),
});

// ── profile / профиль ──────────────────────────────────────────────────────

export type ProfileInput = {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  birthday?: string;
  gender?: '' | 'female' | 'male';
  recovery_email?: string;
};

/**
 * What the profile form refuses before sending — the same rules as the
 * server (`directus/extensions/guest-auth`, `profileErrors`).
 * От чего форма профиля отказывается до отправки — те же правила, что у
 * сервера (`directus/extensions/guest-auth`, `profileErrors`).
 */
export const profileErrors = (input: ProfileInput, today: string) => {
  const errors: Partial<Record<keyof ProfileInput, string>> = {};
  for (const [key, max] of [['first_name', 60], ['middle_name', 60], ['last_name', 60]] as const)
    if (String(input[key] ?? '').trim().length > max) errors[key] = `Не длиннее ${max} знаков`;
  const birthday = String(input.birthday ?? '').trim();
  if (birthday) {
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(birthday) &&
      !Number.isNaN(Date.parse(`${birthday}T00:00:00Z`)) &&
      new Date(`${birthday}T00:00:00Z`).toISOString().slice(0, 10) === birthday;
    const age = valid ? Number(today.slice(0, 4)) - Number(birthday.slice(0, 4)) - (today.slice(5) < birthday.slice(5) ? 1 : 0) : -1;
    if (!valid) errors.birthday = 'Дата в виде ДД.ММ.ГГГГ';
    else if (birthday > today) errors.birthday = 'Дата ещё не наступила';
    else if (age < 7 || age > 110) errors.birthday = 'Проверьте год рождения';
  }
  if (input.gender && !['female', 'male'].includes(input.gender)) errors.gender = 'Выберите из списка';
  const email = String(input.recovery_email ?? '').trim();
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) errors.recovery_email = 'Проверьте адрес: name@example.ru';
  return errors;
};

/** «Анна», «Анна Смирнова»; `null` — имени нет. */
export const displayName = (profile: Pick<Profile, 'first_name' | 'last_name'> | null | undefined, full = false) => {
  const first = profile?.first_name?.trim();
  const last = profile?.last_name?.trim();
  if (!first) return last || null;
  return full && last ? `${first} ${last}` : first;
};

// ── what the account shows / что показывает кабинет ────────────────────────

export const ORDER_STATUS: Record<string, string> = {
  new: 'Принят',
  in_work: 'Готовим',
  done: 'Выполнен',
  cancelled: 'Отменён',
};

const toTx = (tx: RawTx): Tx => ({ id: tx.id, type: tx.type, amount: Number(tx.amount), date: tx.date_created, expires: tx.expires_at ? String(tx.expires_at).slice(0, 10) : null });

/** Оплачено деньгами: сумма минус баллы и скидка; у заказа по телефону — вся сумма. */
export const paidOf = (order: Pick<Order, 'to_pay' | 'total'>) => Number(order.to_pay ?? order.total ?? 0);

/**
 * Everything the account page draws from one `/me` answer. The balance is the
 * ledger's, not the stored number: the stored one waits for the night to
 * write off burnt points, the guest should not see points he cannot spend.
 * Всё, что рисует кабинет, из одного ответа `/me`. Баланс — по книге, а не
 * сохранённое число: сохранённое ждёт ночи, чтобы списать сгоревшее, а гость
 * не должен видеть баллы, которые не сможет потратить.
 */
export const summarize = (me: Me, fallback: Program) => {
  const program = me.program ? toProgram(me.program) : fallback;
  const book = ledger(me.transactions.map(toTx), me.today);
  const done = me.orders.filter((order) => order.status === 'done');
  const spent = done.reduce((sum, order) => sum + paidOf(order), 0);
  const month = me.today.slice(0, 7);
  const monthSpent = done.filter((order) => dayOf(order.date_created).startsWith(month)).reduce((sum, order) => sum + paidOf(order), 0);
  const level = tierFor(spent, program.tiers);
  const birthday = birthdayWindow(me.profile.birthday, me.today, program.birthdayWindow);
  const soon = book.expiring.filter((lot) => daysBetween(me.today, lot.day) <= BURN_WARNING_DAYS);
  // points still to come: orders in work are paid in points when they are done
  // баллы в пути: заказы в работе принесут баллы, когда их выполнят
  const pending = me.orders
    .filter((order) => order.status === 'new' || order.status === 'in_work')
    .reduce((sum, order) => sum + Math.floor((paidOf(order) * level.tier.percent) / 100), 0);
  return {
    program,
    balance: book.available,
    expiring: book.expiring,
    burnSoon: soon.reduce((sum, lot) => sum + lot.amount, 0),
    burnDay: soon[0]?.day ?? null,
    spent,
    monthSpent,
    level,
    birthday,
    pending,
    orders: me.orders.length,
  };
};

/** Подпись операции: что это было и к какому заказу. */
export const txTitle = (tx: Pick<RawTx, 'type' | 'amount' | 'order'>) => {
  if (tx.type === 'refund') return tx.amount > 0 ? 'Вернулись за отменённый заказ' : 'Начисление за отменённый заказ';
  if (tx.type === 'manual') return tx.amount > 0 ? 'Подарок от «Вкусной компании»' : 'Списано администратором';
  return TX_LABEL[tx.type] ?? 'Операция';
};

/**
 * «Повторить заказ»: its dishes go into the saved cart (on top of what is
 * there), the catalog page then drops what has left the menu and says so.
 * «Повторить заказ»: блюда заказа ложатся в сохранённую корзину (поверх того,
 * что в ней есть), страница каталога потом убирает то, чего больше нет, и
 * говорит об этом.
 */
export const repeatOrder = (order: Pick<Order, 'items'>, cart: Cart = empty()) =>
  (order.items ?? []).reduce((next, item) => {
    const id = Number(item.product);
    return Number.isInteger(id) && id > 0 ? add(next, id, item.variant ?? null, Math.max(1, Number(item.qty) || 1), item.filling ?? null) : next;
  }, cart);

// ── words / слова ──────────────────────────────────────────────────────────

const ZONE = 'Europe/Samara';
/** «19 октября», а для другого года — «19 октября 2025» */
export const dateText = (iso: string, today: string) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00+04:00`) : new Date(iso);
  const sameYear = dayOf(date).slice(0, 4) === today.slice(0, 4);
  // «2027 г.» loses its «г.»: the date often ends a sentence, and «г..» looked like a typo
  // у «2027 г.» убирается «г.»: дата часто стоит в конце фразы, и «г..» выглядело опечаткой
  return new Intl.DateTimeFormat('ru-RU', { timeZone: ZONE, day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })
    .format(date)
    .replace(/\s*г\.$/, '');
};

/** «октябре» — месяц в предложном падеже для «Траты в октябре». */
export const monthIn = (today: string) =>
  ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'][Number(today.slice(5, 7)) - 1] ?? '';

/** «через 2 дня», «сегодня», «3 дня назад» — до дня рождения. */
export const relativeDays = (distance: number) => {
  const n = Math.abs(distance);
  const word = n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней';
  if (distance === 0) return 'сегодня';
  if (distance === -1) return 'завтра';
  if (distance === 1) return 'вчера';
  return distance < 0 ? `через ${n} ${word}` : `${n} ${word} назад`;
};
