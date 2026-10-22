/**
 * Online payment: the pure rules of the money side, shared by the site and the
 * `directus/extensions/pay` extension. The server is the one that talks to the
 * bank (amount in kopecks, the receipt basket, the bank's order status); the
 * site only reads the public settings, keeps the order it is paying for and
 * shows what the bank said. The extension carries a plain-JS copy of the
 * money rules (`directus/extensions/pay/core.js`); `pnpm test` holds the two
 * equal on the same inputs, as it does for `order.ts` and `order-guard`.
 * Онлайн-оплата: чистые правила денежной части, общие для сайта и расширения
 * `directus/extensions/pay`. С банком говорит сервер (сумма в копейках, корзина
 * для чека, статус заказа в банке); сайт только читает публичные настройки,
 * помнит заказ, который оплачивает, и показывает, что ответил банк. У
 * расширения своя копия денежных правил на чистом JS
 * (`directus/extensions/pay/core.js`); `pnpm test` держит их равными на одних и
 * тех же входах — как `order.ts` и `order-guard`.
 */

export type PayMethod = 'online' | 'on_delivery';
/** none — не начинали, pending — ссылка выдана, paid, failed, refunded */
export type PayStatus = 'none' | 'pending' | 'paid' | 'failed' | 'refunded';

// ── money / деньги ───────────────────────────────────────────────────────────

/**
 * Rubles → kopecks for the bank: 1850 → 185000, 99.9 → 9990. Floating dust is
 * rounded away (0.29 × 100 is 28.999…); a negative, empty or non-number value
 * is `null`, never a zero that would ask the bank for nothing.
 * Рубли → копейки для банка: 1850 → 185000, 99,9 → 9990. Пыль плавающей точки
 * округляется (0,29 × 100 — это 28,999…); отрицательное, пустое или нечисло —
 * `null`, а не ноль, с которым банк попросил бы «ничего».
 */
export const toKopecks = (rub: unknown): number | null => {
  if (rub === null || rub === '' || typeof rub === 'boolean') return null;
  const n = Number(rub);
  if (!Number.isFinite(n) || n < 0) return null;
  // shift the decimal point in the text, not in binary: 1.005 → 100.5 → 101
  // сдвиг запятой в записи числа, а не в двоичном виде: 1,005 → 100,5 → 101
  const shifted = String(n).includes('e') ? n * 100 : Number(`${n}e2`);
  return Math.round(shifted);
};

// ── receipt basket (54-FZ) / корзина для чека (54-ФЗ) ─────────────────────────

/** Строка заказа так, как её хранит `orders.items` (цена в рублях). */
export type ReceiptLine = {
  product?: number | null;
  title: string;
  qty: number;
  price: number;
};

/**
 * What the receipt says besides the lines; codes are the gateway's own.
 * Что чек говорит кроме строк; коды — те, что принимает шлюз.
 * - `vat` — `tax.taxType`: 0 без НДС, 1 — 0 %, 10 — 5 %, 12 — 7 %, 2 — 10 %, 14 — 22 %;
 * - `method` — признак способа расчёта: 1 предоплата 100 %, 4 полный расчёт;
 * - `object` — признак предмета расчёта: 1 товар;
 * - `measure` — мера количества: ФФД 1.2 — код (0 — штуки), ФФД 1.05 — слово «шт».
 */
export type ReceiptOptions = {
  vat: number;
  method: number;
  object: number;
  measure?: number | string;
  phone?: string | null;
  email?: string | null;
};

export type BundleItem = {
  positionId: string;
  name: string;
  quantity: { value: number; measure: number | string };
  itemAmount: number;
  itemPrice: number;
  itemCode: string;
  tax: { taxType: number };
  itemAttributes: { attributes: { name: 'paymentMethod' | 'paymentObject'; value: string }[] };
};

export type OrderBundle = {
  customerDetails?: { phone?: string; email?: string };
  cartItems: { items: BundleItem[] };
};

/** ограничение длины наименования в чеке: ФФД — 128 знаков, шлюз режет на 100 */
export const RECEIPT_NAME_MAX = 100;

/** «Торт «Лего» (2 кг, Сникерс)» без управляющих символов, одной строкой, не длиннее 100 знаков. */
export const receiptName = (title: string) => {
  const clean = String(title ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'Позиция заказа';
  return clean.length > RECEIPT_NAME_MAX ? `${clean.slice(0, RECEIPT_NAME_MAX - 1).trimEnd()}…` : clean;
};

/** «+7 987 955-25-65» → «79879552565»: шлюз ждёт цифры без плюса; не похоже на номер — пусто. */
export const receiptPhone = (phone: string | null | undefined) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return /^7\d{10}$/.test(digits) ? digits : '';
};

/**
 * The basket the gateway hands to the cash register: one item per order line,
 * kopecks everywhere, the line amount exactly price × quantity so the items add
 * up to the amount being paid (the gateway refuses a basket that does not).
 * Корзина, которую шлюз передаёт кассе: позиция на строку заказа, всё в
 * копейках, сумма позиции ровно цена × количество — позиции складываются в
 * сумму оплаты (корзину, которая не сходится, шлюз отклоняет).
 */
export const buildBundle = (lines: ReceiptLine[], options: ReceiptOptions): OrderBundle => {
  const items = lines.map((line, i): BundleItem => {
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
  const bundle: OrderBundle = { cartItems: { items } };
  const phone = receiptPhone(options.phone);
  const email = String(options.email ?? '').trim();
  if (phone || email) bundle.customerDetails = { ...(phone ? { phone } : {}), ...(email ? { email } : {}) };
  return bundle;
};

/** Сумма корзины в копейках — должна совпасть с `amount` запроса. */
export const bundleTotal = (bundle: OrderBundle) => bundle.cartItems.items.reduce((sum, item) => sum + item.itemAmount, 0);

// ── the bank's order number / номер заказа в банке ───────────────────────────

/**
 * The bank wants a new order number for every payment attempt, unique forever
 * (our «1910-4821» comes back next year). The row id makes it unique, the
 * attempt makes a retry possible: «1910-4821-57», «1910-4821-57r2».
 * Банку на каждую попытку оплаты нужен новый номер, уникальный навсегда (наш
 * «1910-4821» вернётся через год). Уникальным его делает id записи, повтор —
 * номер попытки: «1910-4821-57», «1910-4821-57r2» (буква, а не дефис:
 * «1910-4821-12-57» — это номер с хвостом от совпадения «-12» и id 57).
 */
export const bankOrderNumber = (number: string, id: number, attempt = 1) =>
  `${number}-${id}${attempt > 1 ? `r${attempt}` : ''}`.slice(0, 32);

/** Обратно: «1910-4821-57r2» → `{ id: 57, attempt: 2 }`; чужой формат — `null`. */
export const parseBankOrderNumber = (value: string) => {
  const match = /^\d{4}-\d{4}(?:-\d{2})?-(\d+)(?:r(\d+))?$/.exec(String(value ?? ''));
  if (!match) return null;
  return { id: Number(match[1]), attempt: match[2] ? Number(match[2]) : 1 };
};

// ── the bank's status / статус в банке ───────────────────────────────────────

/** Что сайт и админка делают с ответом банка. */
export type BankState = 'pending' | 'paid' | 'failed' | 'refunded';

/**
 * `orderStatus` of the gateway → ours. 0 registered and 5 «3-D Secure in
 * progress» wait; 2 deposited and 1 held (two-stage terminal) are money we
 * have; 3 reversed and 6 declined are a failed payment; 4 is a refund. A full
 * refund shows in `paymentAmountInfo` even when the status lags.
 * `orderStatus` шлюза → наш. 0 «зарегистрирован» и 5 «идёт 3-D Secure» —
 * ждём; 2 «оплачен» и 1 «сумма заблокирована» (двухстадийный терминал) —
 * деньги у нас; 3 «отмена авторизации» и 6 «отклонён» — оплата не прошла; 4 —
 * возврат. Полный возврат виден в `paymentAmountInfo`, даже если статус отстаёт.
 */
export const alfaState = (response: {
  orderStatus?: number | string | null;
  paymentAmountInfo?: { depositedAmount?: number; approvedAmount?: number; refundedAmount?: number } | null;
}): BankState => {
  const status = Number(response?.orderStatus);
  const info = response?.paymentAmountInfo;
  const refunded = Number(info?.refundedAmount ?? 0);
  const charged = Math.max(Number(info?.depositedAmount ?? 0), Number(info?.approvedAmount ?? 0));
  if (status === 4 || (refunded > 0 && charged > 0 && refunded >= charged)) return 'refunded';
  if (status === 1 || status === 2) return 'paid';
  if (status === 3 || status === 6) return 'failed';
  return 'pending';
};

/**
 * The string the gateway signs in a callback: every parameter except
 * `checksum` and `sign_alias`, sorted by name, as `name;value;`. The HMAC of it
 * (SHA-256, the merchant's key, upper-case hex) must equal `checksum`.
 * Строка, которую шлюз подписывает в уведомлении: все параметры, кроме
 * `checksum` и `sign_alias`, по алфавиту имён, парами `имя;значение;`. HMAC от
 * неё (SHA-256, ключ магазина, шестнадцатеричный в верхнем регистре) должен
 * совпасть с `checksum`.
 */
export const checksumSource = (params: Record<string, string>) =>
  Object.keys(params)
    .filter((key) => key !== 'checksum' && key !== 'sign_alias')
    .sort()
    .map((key) => `${key};${params[key]};`)
    .join('');

// ── the site side / сторона сайта ────────────────────────────────────────────

/** Что сайт узнаёт у `GET /pay/config`: включена ли онлайн-оплата и чем её назвать гостю. */
export type PayConfig = {
  online: boolean;
  onDelivery: boolean;
  test: boolean;
  provider: string;
  texts: { online: string; onDelivery: string; note: string; paid: string; failed: string };
};

/**
 * The words while the admin's fields are empty. The server names the provider
 * in force («…ЮKassa» or «…Альфа-Банка»), so these are only the fallback for a
 * broken answer and the markup before `/pay/config` comes.
 * Слова, пока поля в админке пустые. Действующего провайдера называет сервер
 * («…ЮKassa» или «…Альфа-Банка»), поэтому здесь только запас на битый ответ и
 * разметка до прихода `/pay/config`.
 */
export const DEFAULT_TEXTS: PayConfig['texts'] = {
  online: 'Картой МИР, Visa или Mastercard на защищённой странице ЮKassa',
  onDelivery: 'Наличными или картой курьеру, на кассе при самовывозе',
  note: 'Онлайн оплачиваются блюда и доставка. Если адрес не найден на карте, стоимость доставки назовём при звонке.',
  paid: 'Спасибо! Перезвоним, чтобы подтвердить адрес и время.',
  failed: 'Деньги не списаны. Заказ сохранён — оформлять его заново не нужно.',
};

const str = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);

/** Ответ `/pay/config` в безопасный вид: битый или пустой ответ — онлайн выключена, при получении можно. */
export const parsePayConfig = (data: unknown): PayConfig => {
  const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const texts = (raw.texts && typeof raw.texts === 'object' ? raw.texts : {}) as Record<string, unknown>;
  const online = raw.online === true;
  return {
    online,
    // with online off, «on delivery» is the only way and always allowed
    // без онлайн-оплаты «при получении» — единственный путь и разрешён всегда
    onDelivery: online ? raw.onDelivery !== false : true,
    test: raw.test === true,
    provider: typeof raw.provider === 'string' ? raw.provider : '',
    texts: {
      online: str(texts.online, DEFAULT_TEXTS.online),
      onDelivery: str(texts.onDelivery, DEFAULT_TEXTS.onDelivery),
      note: str(texts.note, DEFAULT_TEXTS.note),
      paid: str(texts.paid, DEFAULT_TEXTS.paid),
      failed: str(texts.failed, DEFAULT_TEXTS.failed),
    },
  };
};

/** Куда вернул банк: `?pay=ok|fail|wait&order=1910-4821&why=…`; другой адрес — `null`. */
export type PayReturn = { state: 'ok' | 'fail' | 'wait'; number: string; why: string | null };

export const readPayReturn = (search: string): PayReturn | null => {
  const params = new URLSearchParams(search);
  const state = params.get('pay');
  const number = params.get('order') ?? '';
  if (state !== 'ok' && state !== 'fail' && state !== 'wait') return null;
  if (!/^\d{4}-\d{4}(?:-\d{2})?$/.test(number)) return null;
  const why = params.get('why');
  return { state, number, why: why && /^[a-z_]{1,24}$/.test(why) ? why : null };
};

/** Почему не прошло — словами для гостя; неизвестная причина — общая фраза. */
export const failReason = (why: string | null) =>
  ({
    declined: 'Банк отклонил платёж.',
    expired: 'Время на оплату истекло.',
    cancelled: 'Оплату отменили на странице банка.',
    short: 'Банк подтвердил меньшую сумму, чем в заказе. Позвоните нам — разберёмся.',
    bank: 'Банк сейчас не отвечает.',
  })[why ?? ''] ?? 'Оплата не прошла.';

/**
 * The order being paid, kept on the device between the bank's page and the
 * way back: the number and the phone prove it is ours (`/pay/start` asks for
 * both), the lines and the total let the result screen say what was paid.
 * Заказ, который оплачивается, хранится на устройстве между страницей банка и
 * возвращением: номер и телефон доказывают, что он наш (`/pay/start` просит
 * оба), строки и сумма дают экрану итога сказать, за что заплачено.
 */
export const PAY_KEY = 'vk-pay-v1';
/** сколько хранится незавершённая оплата: дольше гость уже не вернётся к этой вкладке */
export const PAY_KEEP_MS = 48 * 60 * 60 * 1000;

export type PayRecord = {
  number: string;
  phone: string;
  total: number;
  lines: { title: string; qty: number; sum: number }[];
  /**
   * Delivery of this order: rubles (0 — free), `null` — named on the call;
   * absent — pickup or a record from before the zones.
   * Доставка этого заказа: рубли (0 — бесплатно), `null` — назовём при звонке;
   * нет поля — самовывоз или запись времён до зон.
   */
  delivery?: number | null;
  /** когда ушли на страницу банка, мс */
  at: number;
  /** started — запрос ссылки, redirected — ушли в банк, done — итог показан, dismissed — гость закрыл экран */
  state: 'started' | 'redirected' | 'done' | 'dismissed';
};

export const parsePayRecord = (raw: string | null, now: number): PayRecord | null => {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (typeof data.number !== 'string' || !/^\d{4}-\d{4}(?:-\d{2})?$/.test(data.number)) return null;
    if (typeof data.phone !== 'string' || !data.phone) return null;
    const at = Number(data.at);
    if (!Number.isFinite(at) || now - at > PAY_KEEP_MS || at - now > 60_000) return null;
    const lines = Array.isArray(data.lines)
      ? data.lines
          .filter((line: unknown) => line && typeof line === 'object')
          .map((line: Record<string, unknown>) => ({ title: String(line.title ?? ''), qty: Number(line.qty) || 1, sum: Number(line.sum) || 0 }))
          .slice(0, 40)
      : [];
    const state = ['started', 'redirected', 'done', 'dismissed'].includes(data.state) ? data.state : 'started';
    const delivery =
      typeof data.delivery === 'number' && Number.isFinite(data.delivery) && data.delivery >= 0 ? Math.round(data.delivery) : data.delivery === null ? null : undefined;
    return { number: data.number, phone: data.phone, total: Number(data.total) || 0, lines, ...(delivery !== undefined && { delivery }), at, state };
  } catch {
    return null;
  }
};
