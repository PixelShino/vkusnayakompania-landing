/**
 * Pure rules of the payment extension: kopecks, the receipt basket, the bank's
 * order number and status, the callback signature, the settings with the
 * environment over the admin. No Directus and no network here, so `pnpm test`
 * imports this file next to `src/lib/payment.ts` and holds the money rules of
 * the two equal (`src/lib/payment.check.ts`). The ЮKassa part (the payment
 * body, its receipt, its statuses and notifications) lives here only: the site
 * never builds it, so it has no copy in `payment.ts`.
 * Чистые правила платёжного расширения: копейки, корзина для чека, номер и
 * статус заказа в банке, подпись уведомления, настройки с приоритетом
 * окружения над админкой. Здесь нет ни Directus, ни сети, поэтому `pnpm test`
 * импортирует файл рядом с `src/lib/payment.ts` и держит денежные правила
 * обоих равными (`src/lib/payment.check.ts`). Часть ЮKassa (тело платежа, его
 * чек, статусы и уведомления) живёт только здесь: сайт её не собирает, поэтому
 * копии в `payment.ts` у неё нет.
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

// ── ЮKassa: the payment, its receipt, statuses, notifications ────────────────
// ── ЮKassa: платёж, чек, статусы, уведомления ────────────────────────────────

export const YOOKASSA_API = 'https://api.yookassa.ru/v3/';
export const YOO_DESCRIPTION_MAX = 128;
export const YOO_NAME_MAX = 128;
// a receipt this long is a broken order, not a dinner: it goes as one line
// чек такой длины — сломанный заказ, а не ужин: уходит одной строкой
export const YOO_ITEMS_MAX = 80;

const cleanText = (text, max, fallback) => {
  const clean = String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return fallback;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

/** Копейки → «4650.00»: сумма у ЮKassa — строка с двумя знаками после точки. */
export const yooValue = (kopecks) => {
  const k = Number(kopecks);
  if (!Number.isInteger(k) || k < 0) throw new Error(`сумма ${kopecks} не годится для ЮKassa`);
  return `${Math.floor(k / 100)}.${String(k % 100).padStart(2, '0')}`;
};

/** `{ value: '4650.00' }` или «4650.00» → 465000; не сумма — `null`. */
export const yooKopecks = (amount) => toKopecks(amount && typeof amount === 'object' ? amount.value : amount);

/**
 * The admin keeps the receipt codes of the first bank (Alfa's `taxType`, the
 * FFD codes of the method and the subject); ЮKassa names them its own way.
 * Админка хранит коды чека первого банка (`taxType` Альфы, коды ФФД для
 * способа и предмета расчёта); у ЮKassa они называются по-своему.
 */
/** @type {Record<number, number>} */
export const YOO_VAT = { 0: 1, 1: 2, 2: 3, 6: 4, 10: 7, 12: 8, 14: 11 };
/** @type {Record<number, string>} */
export const YOO_MODE = {
  1: 'full_prepayment',
  2: 'partial_prepayment',
  3: 'advance',
  4: 'full_payment',
  5: 'partial_payment',
  6: 'credit',
  7: 'credit_payment',
};
/** @type {Record<number, string>} */
export const YOO_SUBJECT = { 1: 'commodity', 3: 'job', 4: 'service' };
/** 0 ОСН … 5 патент (админка) → 1 … 6 (`tax_system_code`). */
export const yooTaxSystem = (code) => (Number.isInteger(code) && code >= 0 && code <= 5 ? code + 1 : null);

/** «Торт «Лего»» + вариант и начинка → «Торт «Лего» (2 кг, Сникерс)», не длиннее 128 знаков. */
export const yooItemName = (line) => {
  const extra = [line?.variant, line?.filling].filter((v) => typeof v === 'string' && v.trim()).join(', ');
  const title = String(line?.title ?? '').trim();
  return cleanText(extra && title && !title.includes(extra) ? `${title} (${extra})` : title, YOO_NAME_MAX, 'Позиция заказа');
};

/**
 * Line totals scaled to the sum actually paid: points and the birthday
 * discount make `to_pay` less than the dishes, and the receipt must add up to
 * the payment to the kopeck. Largest remainders get the leftover kopecks, so
 * the result always sums to `amount`.
 * Суммы строк, приведённые к реально оплаченной: баллы и скидка именинника
 * делают `to_pay` меньше суммы блюд, а чек обязан сойтись с платежом до
 * копейки. Оставшиеся копейки получают строки с наибольшими остатками, поэтому
 * итог всегда равен `amount`.
 */
export const spreadAmount = (totals, amount) => {
  const sum = totals.reduce((acc, value) => acc + value, 0);
  if (sum === amount) return [...totals];
  if (!(sum > 0) || !Number.isInteger(amount) || amount < 0) return null;
  const raw = totals.map((value) => (value * amount) / sum);
  const out = raw.map((value) => Math.floor(value));
  let rest = amount - out.reduce((acc, value) => acc + value, 0);
  const byRemainder = raw.map((value, i) => [value - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % byRemainder.length, rest -= 1) out[byRemainder[k][1]] += 1;
  return out;
};

/**
 * The ЮKassa receipt (54-FZ) for the sum paid: a line per dish at the price
 * after points; a line whose total does not divide by its quantity splits in
 * two («2 × 333.33» and «1 × 333.34»). Without usable lines — one line «Заказ …».
 * Чек ЮKassa (54-ФЗ) на оплаченную сумму: строка на блюдо по цене после
 * баллов; строка, сумма которой не делится на количество, делится на две
 * («2 × 333,33» и «1 × 333,34»). Без годных строк — одна строка «Заказ …».
 *
 * @param {Array<Record<string, any>> | null | undefined} lines `orders.items`
 * @param {{ amount: number, vat: number, method: number, subject?: number, taxSystem?: number,
 *   ffd12?: boolean, phone?: string | null, email?: string | null, title: string }} options
 */
export const buildYooReceipt = (lines, options) => {
  const vat = YOO_VAT[options.vat];
  if (!vat) throw new Error(`ставка НДС ${options.vat} не знакома ЮKassa`);
  const base = {
    vat_code: vat,
    payment_mode: YOO_MODE[options.method] ?? 'full_payment',
    payment_subject: YOO_SUBJECT[options.subject ?? 1] ?? 'commodity',
    ...(options.ffd12 === false ? {} : { measure: 'piece' }),
  };
  const item = (description, quantity, unit) => ({ description, quantity, amount: { value: yooValue(unit), currency: 'RUB' }, ...base });

  let parsed = Array.isArray(lines) && lines.length ? [] : null;
  for (const line of Array.isArray(lines) ? lines : []) {
    const price = toKopecks(line?.price);
    const qty = Number(line?.qty);
    if (price === null || !Number.isInteger(qty) || qty < 1) {
      parsed = null;
      break;
    }
    parsed.push({ name: yooItemName(line), qty, total: price * qty });
  }
  const totals = parsed ? spreadAmount(parsed.map((p) => p.total), options.amount) : null;
  let items = totals
    ? parsed
        .flatMap((p, i) => {
          const unit = Math.floor(totals[i] / p.qty);
          const rest = totals[i] - unit * p.qty;
          if (!rest) return [item(p.name, p.qty, unit)];
          return [...(p.qty > rest ? [item(p.name, p.qty - rest, unit)] : []), item(p.name, rest, unit + 1)];
        })
        // a dish the points ate entirely stays off the receipt: a zero line adds nothing
        // блюдо, целиком съеденное баллами, в чек не идёт: нулевая строка ничего не добавляет
        .filter((it) => it.amount.value !== '0.00')
    : [];
  if (!items.length || items.length > YOO_ITEMS_MAX) items = [item(cleanText(options.title, YOO_NAME_MAX, 'Заказ'), 1, options.amount)];

  /** @type {{ items: Array<Record<string, any>>, customer?: { email?: string, phone?: string }, tax_system_code?: number }} */
  const receipt = { items };
  const phone = receiptPhone(options.phone);
  const email = String(options.email ?? '').trim();
  if (phone || email) receipt.customer = { ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
  const tax = yooTaxSystem(options.taxSystem);
  if (tax) receipt.tax_system_code = tax;
  return receipt;
};

/** Сумма чека ЮKassa в копейках: Σ цена × количество — должна совпасть с платежом. */
export const yooReceiptTotal = (receipt) =>
  receipt.items.reduce((sum, it) => sum + (yooKopecks(it.amount) ?? 0) * Number(it.quantity), 0);

/**
 * The body of `POST /v3/payments`: one-stage (`capture: true`), the guest
 * goes to ЮKassa's page and comes back to `returnUrl`; `metadata` ties the
 * payment to the order in our base.
 * Тело `POST /v3/payments`: одностадийный (`capture: true`), гость уходит на
 * страницу ЮKassa и возвращается на `returnUrl`; `metadata` связывает платёж
 * с заказом в нашей базе.
 */
/**
 * @param {{ amount: number, description: string, returnUrl: string, metadata?: Record<string, any>, receipt?: Record<string, any> | null }} input
 */
export const buildYooPayment = ({ amount, description, returnUrl, metadata = {}, receipt = null }) => ({
  amount: { value: yooValue(amount), currency: 'RUB' },
  capture: true,
  confirmation: { type: 'redirect', return_url: returnUrl, locale: 'ru_RU' },
  description: cleanText(description, YOO_DESCRIPTION_MAX, 'Заказ'),
  metadata: Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .slice(0, 16)
      .map(([key, value]) => [key.slice(0, 32), String(value).slice(0, 512)]),
  ),
  ...(receipt ? { receipt } : {}),
});

/** `cancellation_details.reason` — словами для журнала заказа. */
/** @type {Record<string, string>} */
export const YOO_REASONS = {
  '3d_secure_failed': 'не пройдена проверка 3-D Secure',
  call_issuer: 'банк карты отклонил платёж без объяснения',
  canceled_by_merchant: 'платёж отменён магазином',
  card_expired: 'истёк срок действия карты',
  country_forbidden: 'карта выпущена в стране, откуда платежи запрещены',
  expired_on_capture: 'истёк срок списания',
  expired_on_confirmation: 'время на оплату истекло',
  fraud_suspected: 'платёж заблокирован из-за подозрения в мошенничестве',
  general_decline: 'отказ без подробностей',
  identification_required: 'превышены лимиты кошелька без идентификации',
  insufficient_funds: 'на карте не хватает денег',
  internal_timeout: 'технический сбой на стороне ЮKassa',
  invalid_card_number: 'неверный номер карты',
  invalid_csc: 'неверный CVC',
  issuer_unavailable: 'банк карты недоступен',
  payment_method_limit_exceeded: 'исчерпан лимит платежей этим способом',
  payment_method_restricted: 'операции этим способом запрещены',
  permission_revoked: 'отозвано разрешение на автоплатёж',
  unsupported_mobile_operator: 'оператор связи не поддерживается',
};

/**
 * A ЮKassa payment → ours. `succeeded` is money we have (a full refund makes it
 * `refunded`), `canceled` failed, `pending` waits for the guest; a pending
 * payment seen on the way back means the guest left ЮKassa's page unpaid.
 * `waiting_for_capture` (two-stage) never comes with `capture: true`; if it
 * does, the money is only held — still waiting, the provider captures it.
 * Платёж ЮKassa → наш. `succeeded` — деньги у нас (полный возврат делает его
 * `refunded`), `canceled` — не прошёл, `pending` — ждёт гостя; ждущий платёж
 * при возврате гостя значит, что гость ушёл со страницы ЮKassa, не оплатив.
 * `waiting_for_capture` (двухстадийный) при `capture: true` не приходит; если
 * пришёл — деньги только заморожены: ждём, провайдер их спишет.
 */
/**
 * @param {Record<string, any> | null | undefined} payment
 * @returns {Record<string, any>}
 */
export const yooState = (payment) => {
  const status = String(payment?.status ?? '');
  const amount = yooKopecks(payment?.amount) ?? 0;
  const refunded = yooKopecks(payment?.refunded_amount) ?? 0;
  const reason = payment?.cancellation_details?.reason ?? null;
  const common = { amount, refunded, code: status || null, action: reason, test: payment?.test === true, left: false, why: null, note: null };
  if (status === 'succeeded') {
    const full = refunded > 0 && refunded >= amount;
    return { ...common, state: full ? 'refunded' : 'paid' };
  }
  if (status === 'canceled')
    return {
      ...common,
      state: 'failed',
      why: reason === 'expired_on_confirmation' ? 'expired' : 'declined',
      note: reason ? (YOO_REASONS[reason] ?? reason) : null,
    };
  if (status === 'waiting_for_capture') return { ...common, state: 'pending', held: true, note: 'деньги заморожены, ждут списания' };
  return { ...common, state: 'pending', left: status === 'pending' };
};

/**
 * ЮKassa's notification: `{ type: 'notification', event, object }`. The body
 * proves nothing (anyone can post it) — it only names the payment to ask
 * ЮKassa about. A malformed body is `null`; an event we do not handle has no
 * `paymentId` and is answered 200 and left alone.
 * Уведомление ЮKassa: `{ type: 'notification', event, object }`. Тело ничего
 * не доказывает (прислать его может кто угодно) — оно только называет платёж,
 * о котором спросить ЮKassa. Битое тело — `null`; событие, которое мы не
 * обрабатываем, приходит без `paymentId`: ответ 200, и больше ничего.
 */
export const YOO_EVENTS = ['payment.succeeded', 'payment.canceled', 'payment.waiting_for_capture', 'refund.succeeded'];
const YOO_ID = /^[0-9a-z][0-9a-z_-]{7,63}$/i;
export const parseYooNotification = (body) => {
  if (!body || typeof body !== 'object' || body.type !== 'notification') return null;
  const event = typeof body.event === 'string' ? body.event : '';
  const object = body.object && typeof body.object === 'object' ? body.object : null;
  if (!event || !object) return null;
  if (!YOO_EVENTS.includes(event)) return { event, paymentId: null };
  const paymentId = String((event.startsWith('refund.') ? object.payment_id : object.id) ?? '');
  if (!YOO_ID.test(paymentId)) return null;
  return { event, paymentId };
};

/**
 * Where ЮKassa sends notifications from (yookassa.ru/developers/using-api/webhooks).
 * A known address lifts the request limit; the status is asked at ЮKassa anyway.
 * Откуда ЮKassa шлёт уведомления. Известный адрес снимает лимит запросов;
 * статус всё равно спрашивается у ЮKassa.
 */
export const YOOKASSA_IPS = ['185.71.76.0/27', '185.71.77.0/27', '77.75.153.0/25', '77.75.156.11', '77.75.156.35', '77.75.154.128/25', '2a02:5180::/32'];
const ipv4 = (ip) => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return null;
  return parts.reduce((acc, part) => acc * 256 + part, 0);
};
const V4_RANGES = YOOKASSA_IPS.filter((range) => !range.includes(':')).map((range) => {
  const [base, bits = '32'] = range.split('/');
  return { base: ipv4(base), size: 2 ** (32 - Number(bits)) };
});
export const isYooKassaIp = (value) => {
  let ip = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const n = ipv4(ip);
  if (n !== null) return V4_RANGES.some(({ base, size }) => n >= base && n < base + size);
  // 2a02:5180::/32 — the first two groups, never compressed while non-zero
  // 2a02:5180::/32 — первые две группы, ненулевые группы не сжимаются
  return /^2a02:5180(:|$)/.test(ip);
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
  online: 'Картой МИР, Visa или Mastercard на защищённой странице ЮKassa',
  onDelivery: 'Наличными или картой курьеру, на кассе при самовывозе',
  note: 'Онлайн оплачиваются блюда. Платную доставку назовём при звонке и оплатите её курьеру.',
  paid: 'Спасибо! Перезвоним, чтобы подтвердить адрес и время.',
  failed: 'Деньги не списаны. Заказ сохранён — оформлять его заново не нужно.',
};

/**
 * «On the secure page of …» names the provider in force while the admin's
 * field is empty; the stub stands in for the main provider and borrows its words.
 * «На защищённой странице …» называет действующего провайдера, пока поле в
 * админке пустое; заглушка замещает основного провайдера и говорит его словами.
 */
export const ONLINE_TEXTS = {
  yookassa: DEFAULT_TEXTS.online,
  alfa: 'Картой МИР, Visa или Mastercard на защищённой странице Альфа-Банка',
};

// the first is the default: ЮKassa since 20.10.2026, Alfa stays as the other way
// первый — по умолчанию: ЮKassa с 20.10.2026, Альфа остаётся запасным путём
export const PROVIDERS = ['yookassa', 'alfa', 'mock'];
// what an admin may pick as «признак предмета расчёта»: товар, работа, услуга (коды ФФД)
const SUBJECTS = [1, 3, 4];

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
  const wantedProvider = pick(env.PAY_PROVIDER, row.provider, PROVIDERS[0]);
  const provider = PROVIDERS.includes(wantedProvider) ? wantedProvider : PROVIDERS[0];
  const enabledEnv = flag(env.PAY_ENABLED);
  // the stub never takes real money: in production mode it is simply off
  // заглушка не берёт настоящих денег: в боевом режиме она просто выключена
  const stubInProd = provider === 'mock' && mode === 'prod';
  const secretKey = pick(env.PAY_YOOKASSA_SECRET_KEY, row.yookassa_secret_key);
  // a test shop's key («test_…») takes test cards: in production mode a guest
  // could «pay» with 5555 5555 5555 4477, so payments are off
  // ключ тестового магазина («test_…») принимает тестовые карты: в боевом
  // режиме гость «оплатил» бы картой 5555 5555 5555 4477, поэтому оплата выключена
  const testKeyInProd = provider === 'yookassa' && mode === 'prod' && /^test_/i.test(secretKey);
  const gatewayRow = mode === 'prod' ? row.alfa_gateway_prod : row.alfa_gateway_test;
  const texts = {
    online: pick(undefined, row.text_online, ONLINE_TEXTS[provider] ?? DEFAULT_TEXTS.online),
    onDelivery: pick(undefined, row.text_on_delivery, DEFAULT_TEXTS.onDelivery),
    note: pick(undefined, row.text_note, DEFAULT_TEXTS.note),
    paid: pick(undefined, row.text_paid, DEFAULT_TEXTS.paid),
    failed: pick(undefined, row.text_failed, DEFAULT_TEXTS.failed),
  };
  return {
    enabled: (enabledEnv ?? Boolean(row.online_enabled)) && !stubInProd && !testKeyInProd,
    stubInProd,
    testKeyInProd,
    provider,
    mode,
    login: pick(env.PAY_ALFA_LOGIN, row.alfa_login),
    password: pick(env.PAY_ALFA_PASSWORD, row.alfa_password),
    token: pick(env.PAY_ALFA_TOKEN, row.alfa_token),
    gateway: slashed(pick(env.PAY_ALFA_GATEWAY, gatewayRow, GATEWAYS[mode])),
    callbackKey: pick(env.PAY_CALLBACK_KEY, row.callback_key),
    shopId: pick(env.PAY_YOOKASSA_SHOP_ID, row.yookassa_shop_id),
    secretKey,
    // another API address only for a check against a fake ЮKassa, and only in
    // test mode: production always talks to api.yookassa.ru
    // другой адрес API — только для проверки на поддельной ЮKassa и только в
    // тесте: боевой режим всегда говорит с api.yookassa.ru
    yookassaApi: mode === 'test' && has(env.PAY_YOOKASSA_API) ? slashed(String(env.PAY_YOOKASSA_API).trim()) : YOOKASSA_API,
    siteUrl: pick(env.PAY_SITE_URL, row.site_url, '').replace(/\/+$/, ''),
    sessionMinutes: int(row.session_minutes, 20, 5, 60 * 24),
    onDelivery: row.allow_on_delivery !== false,
    receipt: row.receipt_enabled !== false,
    taxSystem: int(row.tax_system, 1, 0, 5),
    vat: int(row.vat, 0, 0, 20),
    receiptMethod: int(row.receipt_method, 4, 1, 7),
    receiptSubject: SUBJECTS.includes(Number(row.receipt_subject)) ? Number(row.receipt_subject) : 1,
    // ФФД 1.2: мера количества кодом (0 — штуки); ФФД 1.05: словом «шт»
    measure: String(row.receipt_ffd ?? '1.2') === '1.05' ? 'шт' : 0,
    texts,
    sources: {
      enabled: enabledEnv !== null ? 'env' : 'admin',
      login: has(env.PAY_ALFA_LOGIN) ? 'env' : has(row.alfa_login) ? 'admin' : 'none',
      password: has(env.PAY_ALFA_PASSWORD) ? 'env' : has(row.alfa_password) ? 'admin' : 'none',
      token: has(env.PAY_ALFA_TOKEN) ? 'env' : has(row.alfa_token) ? 'admin' : 'none',
      callbackKey: has(env.PAY_CALLBACK_KEY) ? 'env' : has(row.callback_key) ? 'admin' : 'none',
      shopId: has(env.PAY_YOOKASSA_SHOP_ID) ? 'env' : has(row.yookassa_shop_id) ? 'admin' : 'none',
      secretKey: has(env.PAY_YOOKASSA_SECRET_KEY) ? 'env' : has(row.yookassa_secret_key) ? 'admin' : 'none',
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
