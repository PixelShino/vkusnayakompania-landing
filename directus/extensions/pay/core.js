/**
 * Pure rules of the payment extension: kopecks, the receipt basket, the bank's
 * order number and status, the callback signature, the settings with the
 * environment over the admin. No Directus and no network here, so `pnpm test`
 * imports this file next to `src/lib/payment.ts` and holds the money rules of
 * the two equal (`src/lib/payment.check.ts`).
 * Чистые правила платёжного расширения: копейки, корзина для чека, номер и
 * статус заказа в банке, подпись уведомления, настройки с приоритетом
 * окружения над админкой. Здесь нет ни Directus, ни сети, поэтому `pnpm test`
 * импортирует файл рядом с `src/lib/payment.ts` и держит денежные правила
 * обоих равными (`src/lib/payment.check.ts`).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── money / деньги ───────────────────────────────────────────────────────────

/** Рубли → копейки: 1850 → 185000; отрицательное, пустое или нечисло — `null`. */
export const toKopecks = (rub) => {
  if (rub === null || rub === '' || typeof rub === 'boolean') return null;
  const n = Number(rub);
  if (!Number.isFinite(n) || n < 0) return null;
  // shift the decimal point in the text, not in binary: 1.005 → 100.5 → 101
  // сдвиг запятой в записи числа, а не в двоичном виде: 1,005 → 100,5 → 101
  const shifted = String(n).includes('e') ? n * 100 : Number(`${n}e2`);
  return Math.round(shifted);
};

// ── receipt basket (54-FZ) / корзина для чека (54-ФЗ) ─────────────────────────

export const RECEIPT_NAME_MAX = 100;

export const receiptName = (title) => {
  const clean = String(title ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'Позиция заказа';
  return clean.length > RECEIPT_NAME_MAX ? `${clean.slice(0, RECEIPT_NAME_MAX - 1).trimEnd()}…` : clean;
};

export const receiptPhone = (phone) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return /^7\d{10}$/.test(digits) ? digits : '';
};

/** Корзина для кассы: позиция на строку заказа, копейки, сумма позиции = цена × количество. */
export const buildBundle = (lines, options) => {
  const items = lines.map((line, i) => {
    const price = toKopecks(line.price);
    const qty = Number(line.qty);
    if (price === null || !Number.isInteger(qty) || qty < 1) throw new Error(`строка ${i + 1}: цена или количество не годятся для чека`);
    return {
      positionId: String(i + 1),
      name: receiptName(line.title),
      quantity: { value: qty, measure: options.measure ?? 0 },
      itemAmount: price * qty,
      itemPrice: price,
      itemCode: `${line.product ?? 'item'}-${i + 1}`,
      tax: { taxType: options.vat },
      itemAttributes: {
        attributes: [
          { name: 'paymentMethod', value: String(options.method) },
          { name: 'paymentObject', value: String(options.object) },
        ],
      },
    };
  });
  const bundle = { cartItems: { items } };
  const phone = receiptPhone(options.phone);
  const email = String(options.email ?? '').trim();
  if (phone || email) bundle.customerDetails = { ...(phone ? { phone } : {}), ...(email ? { email } : {}) };
  return bundle;
};

export const bundleTotal = (bundle) => bundle.cartItems.items.reduce((sum, item) => sum + item.itemAmount, 0);

// ── the bank's order number / номер заказа в банке ───────────────────────────

/** «1910-4821-57», повтор — «1910-4821-57r2»: уникален навсегда благодаря id записи. */
export const bankOrderNumber = (number, id, attempt = 1) => `${number}-${id}${attempt > 1 ? `r${attempt}` : ''}`.slice(0, 32);

export const parseBankOrderNumber = (value) => {
  const match = /^\d{4}-\d{4}(?:-\d{2})?-(\d+)(?:r(\d+))?$/.exec(String(value ?? ''));
  if (!match) return null;
  return { id: Number(match[1]), attempt: match[2] ? Number(match[2]) : 1 };
};

// ── the bank's status / статус в банке ───────────────────────────────────────

/** `orderStatus` шлюза → pending | paid | failed | refunded (см. `src/lib/payment.ts`). */
export const alfaState = (response) => {
  const status = Number(response?.orderStatus);
  const info = response?.paymentAmountInfo;
  const refunded = Number(info?.refundedAmount ?? 0);
  const charged = Math.max(Number(info?.depositedAmount ?? 0), Number(info?.approvedAmount ?? 0));
  if (status === 4 || (refunded > 0 && charged > 0 && refunded >= charged)) return 'refunded';
  if (status === 1 || status === 2) return 'paid';
  if (status === 3 || status === 6) return 'failed';
  return 'pending';
};

/** Строка для подписи уведомления: параметры без `checksum` и `sign_alias`, по алфавиту, `имя;значение;`. */
export const checksumSource = (params) =>
  Object.keys(params)
    .filter((key) => key !== 'checksum' && key !== 'sign_alias')
    .sort()
    .map((key) => `${key};${params[key]};`)
    .join('');

/**
 * The callback is the bank's only if its HMAC-SHA256 under our key matches.
 * Compared in constant time; an absent checksum with a key set is a forgery.
 * Уведомление — от банка, только если HMAC-SHA256 на нашем ключе совпал.
 * Сравнение за постоянное время; нет подписи при заданном ключе — подделка.
 */
export const verifyChecksum = (params, key) => {
  const given = String(params?.checksum ?? '').trim().toUpperCase();
  if (!key || !/^[0-9A-F]{64}$/.test(given)) return false;
  const mine = createHmac('sha256', key).update(checksumSource(params), 'utf8').digest('hex').toUpperCase();
  return timingSafeEqual(Buffer.from(mine), Buffer.from(given));
};

// ── phone and number / телефон и номер ───────────────────────────────────────

/** Тот же вид, что у `order-guard`: «8 987 955 25 65» → «+7 987 955-25-65»; null — не номер. */
export const normalizePhone = (value) => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  if (!/^7[3-9]\d{9}$/.test(digits)) return null;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
};

export const isOrderNumber = (value) => /^\d{4}-\d{4}(?:-\d{2})?$/.test(String(value ?? ''));

// ── settings / настройки ─────────────────────────────────────────────────────

// the gateway for a login without a prefix (Alfa's default); an «r-» login
// works on payment.alfabank.ru — the field «Шлюз: бой» in the admin changes it
// шлюз для логина без префикса (по умолчанию у Альфы); логин с «r-» работает на
// payment.alfabank.ru — это меняет поле «Шлюз: бой» в админке
export const GATEWAYS = {
  test: 'https://alfa.rbsuat.com/payment/rest/',
  prod: 'https://pay.alfabank.ru/payment/rest/',
};

export const DEFAULT_TEXTS = {
  online: 'Картой МИР, Visa или Mastercard на защищённой странице Альфа-Банка',
  onDelivery: 'Наличными или картой курьеру, на кассе при самовывозе',
  note: 'Онлайн оплачиваются блюда. Платную доставку назовём при звонке и оплатите её курьеру.',
  paid: 'Спасибо! Перезвоним, чтобы подтвердить адрес и время.',
  failed: 'Деньги не списаны. Заказ сохранён — оформлять его заново не нужно.',
};

const PROVIDERS = ['alfa', 'mock'];

const flag = (value) => {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'да'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', 'нет'].includes(text)) return false;
  return null;
};
const has = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const pick = (envValue, rowValue, fallback = '') => (has(envValue) ? String(envValue).trim() : has(rowValue) ? String(rowValue).trim() : fallback);
const int = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const slashed = (url) => (url.endsWith('/') ? url : `${url}/`);

/**
 * The settings in force: an environment variable `PAY_*` beats the admin's
 * field, so secrets can live outside the database and its backups. `sources`
 * names where each secret came from — for the admin's check, never the value.
 * Действующие настройки: переменная окружения `PAY_*` важнее поля в админке,
 * поэтому секреты можно держать вне базы и её бэкапов. `sources` называет,
 * откуда взят каждый секрет, — для проверки в админке, без самих значений.
 */
/**
 * @param {Record<string, any> | null} [row] запись `payment_settings`
 * @param {Record<string, any>} [env] окружение Directus
 */
export const resolveSettings = (row = {}, env = {}) => {
  row = row ?? {};
  const mode = pick(env.PAY_MODE, row.mode, 'test') === 'prod' ? 'prod' : 'test';
  const wantedProvider = pick(env.PAY_PROVIDER, row.provider, 'alfa');
  const provider = PROVIDERS.includes(wantedProvider) ? wantedProvider : 'alfa';
  const enabledEnv = flag(env.PAY_ENABLED);
  // the stub never takes real money: in production mode it is simply off
  // заглушка не берёт настоящих денег: в боевом режиме она просто выключена
  const stubInProd = provider === 'mock' && mode === 'prod';
  const gatewayRow = mode === 'prod' ? row.alfa_gateway_prod : row.alfa_gateway_test;
  const texts = {
    online: pick(undefined, row.text_online, DEFAULT_TEXTS.online),
    onDelivery: pick(undefined, row.text_on_delivery, DEFAULT_TEXTS.onDelivery),
    note: pick(undefined, row.text_note, DEFAULT_TEXTS.note),
    paid: pick(undefined, row.text_paid, DEFAULT_TEXTS.paid),
    failed: pick(undefined, row.text_failed, DEFAULT_TEXTS.failed),
  };
  return {
    enabled: (enabledEnv ?? Boolean(row.online_enabled)) && !stubInProd,
    stubInProd,
    provider,
    mode,
    login: pick(env.PAY_ALFA_LOGIN, row.alfa_login),
    password: pick(env.PAY_ALFA_PASSWORD, row.alfa_password),
    token: pick(env.PAY_ALFA_TOKEN, row.alfa_token),
    gateway: slashed(pick(env.PAY_ALFA_GATEWAY, gatewayRow, GATEWAYS[mode])),
    callbackKey: pick(env.PAY_CALLBACK_KEY, row.callback_key),
    siteUrl: pick(env.PAY_SITE_URL, row.site_url, '').replace(/\/+$/, ''),
    sessionMinutes: int(row.session_minutes, 20, 5, 60 * 24),
    onDelivery: row.allow_on_delivery !== false,
    receipt: row.receipt_enabled !== false,
    taxSystem: int(row.tax_system, 1, 0, 5),
    vat: int(row.vat, 0, 0, 20),
    receiptMethod: int(row.receipt_method, 4, 1, 7),
    // ФФД 1.2: мера количества кодом (0 — штуки); ФФД 1.05: словом «шт»
    measure: String(row.receipt_ffd ?? '1.2') === '1.05' ? 'шт' : 0,
    texts,
    sources: {
      enabled: enabledEnv !== null ? 'env' : 'admin',
      login: has(env.PAY_ALFA_LOGIN) ? 'env' : has(row.alfa_login) ? 'admin' : 'none',
      password: has(env.PAY_ALFA_PASSWORD) ? 'env' : has(row.alfa_password) ? 'admin' : 'none',
      token: has(env.PAY_ALFA_TOKEN) ? 'env' : has(row.alfa_token) ? 'admin' : 'none',
      callbackKey: has(env.PAY_CALLBACK_KEY) ? 'env' : has(row.callback_key) ? 'admin' : 'none',
    },
  };
};

/** Что видит сайт (`GET /pay/config`): без логинов, ключей и адресов шлюза. */
export const publicConfig = (settings) => ({
  online: settings.enabled,
  onDelivery: settings.enabled ? settings.onDelivery : true,
  test: settings.mode === 'test',
  provider: settings.provider,
  texts: settings.texts,
});

/**
 * Where the guest comes back: the page's own origin when the site is allowed
 * to call us (CORS) or is the configured site, otherwise the configured site.
 * The path must be a plain site path — never an open redirect.
 * Куда вернуть гостя: на источник страницы, если сайту разрешено к нам
 * обращаться (CORS) или он и есть настроенный сайт, иначе на настроенный сайт.
 * Путь — только простой путь сайта: открытого редиректа не будет.
 */
/**
 * @param {{ origin: string | null, path?: unknown, allowed?: string[], siteUrl?: string }} options
 * @returns {{ site: string, path: string } | null}
 */
export const returnTarget = ({ origin, path, allowed = [], siteUrl = '' }) => {
  const list = [...allowed, siteUrl].filter(Boolean).map((url) => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  });
  let site = null;
  try {
    const own = origin ? new URL(origin).origin : null;
    if (own && list.includes(own)) site = own;
  } catch {
    /* a broken Origin is no origin / битый Origin — значит, его нет */
  }
  site ??= siteUrl ? list.at(-1) : list[0] ?? null;
  const safePath = /^\/[\w\-/]*$/.test(String(path ?? '')) && !String(path).startsWith('//') ? String(path) : '/catalog/';
  return site ? { site, path: safePath } : null;
};

/** Итог для адреса возврата на сайт: `?pay=ok&order=…` / `fail&why=…` / `wait`. */
export const resultUrl = ({ site, path }, state, number, why) => {
  const url = new URL(path, site);
  url.searchParams.set('pay', state);
  url.searchParams.set('order', number);
  if (why) url.searchParams.set('why', why);
  return url.toString();
};
