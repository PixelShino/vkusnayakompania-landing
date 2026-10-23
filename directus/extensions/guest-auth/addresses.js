/**
 * The guest's saved addresses on the server: the same rules as the site's
 * `src/lib/addresses.ts` (`src/lib/addresses.check.ts` runs both on the same
 * inputs) plus the three operations of the `/guest-auth/addresses/*` routes.
 * Pure: no Directus, no network; `index.js` reads and writes
 * `directus_users.addresses` around them.
 * Сохранённые адреса гостя на сервере: те же правила, что у сайта в
 * `src/lib/addresses.ts` (`src/lib/addresses.check.ts` гоняет оба на одних
 * входах), и три операции маршрутов `/guest-auth/addresses/*`. Чистые: без
 * Directus и сети; `index.js` читает и пишет `directus_users.addresses` вокруг них.
 */
import crypto from 'node:crypto';

export const MAX_ADDRESSES = 5;
/** Длина пунктов — та же, что у формы корзины (`APT_MAX` в `src/lib/order.ts`) и у `order-guard`. */
export const APT_MAX = { flat: 20, entrance: 10, floor: 10, intercom: 20 };
export const ADDRESS_MAX = { label: 24, address: 200, ...APT_MAX };
export const ADDRESS_MIN = { address: 5 };
export const LIMIT_MESSAGE = `Сохранено ${MAX_ADDRESSES} адресов — удалите ненужный в кабинете`;

const APT_KEYS = ['flat', 'entrance', 'floor', 'intercom'];
const INPUT_KEYS = ['label', 'address', ...APT_KEYS];

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// The word typed out of habit in a field that already says it — a copy of
// `APT_WORD` in `src/lib/order.ts`; an office keeps its word.
// Слово, набранное по привычке в поле, где оно уже написано, — копия `APT_WORD`
// из `src/lib/order.ts`; офис своё слово сохраняет.
const WORD_START = '(?<![\\p{L}\\d])';
const WORD_END = '(?![\\p{L}])';
const APT_WORD = {
  flat: new RegExp(`^${WORD_START}(?:кв\\.?|квартира)${WORD_END}\\s*(?:№\\s*)?`, 'iu'),
  entrance: new RegExp(`^${WORD_START}(?:подъезд|под\\.|п\\.)${WORD_END}\\s*(?:№\\s*)?|(?:-?й)?\\s*(?<![\\p{L}])подъезд${WORD_END}\\.?$`, 'iu'),
  floor: new RegExp(`^${WORD_START}(?:этаж|эт\\.?)${WORD_END}\\s*|(?:-?й)?\\s*(?<![\\p{L}])(?:этаж|эт\\.?)${WORD_END}$`, 'iu'),
  intercom: new RegExp(`^${WORD_START}(?:код\\s+домофона|домофон|код|д/ф)${WORD_END}\\s*[:№]?\\s*`, 'iu'),
};

/** Пункт адреса: без повтора подписи поля, не длиннее предела, пустой — `null` (как `aptPart` сайта). */
export const aptPart = (key, value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(APT_WORD[key], '')
    .trim()
    .slice(0, APT_MAX[key]) || null;

/**
 * Only the address fields of a request body, as text: a number is read as
 * typed, anything else that is not text — as empty. Missing keys stay missing
 * (an update changes only what it names).
 * Только поля адреса из тела запроса, текстом: число читается как набрано,
 * остальное нетекстовое — как пустое. Отсутствующие ключи так и отсутствуют
 * (правка меняет только названное).
 */
export const addressInput = (body) => {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const key of INPUT_KEYS) {
    if (!(key in body) || body[key] === undefined) continue;
    const value = body[key];
    out[key] = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }
  return out;
};

/** От чего сервер отказывается — те же слова, что у формы (`addressErrors` сайта). */
export const addressErrors = (input) => {
  const errors = {};
  const label = clean(input.label);
  if (!label) errors.label = 'Как назвать адрес: Дом, Работа…';
  else if (label.length > ADDRESS_MAX.label) errors.label = `Не длиннее ${ADDRESS_MAX.label} знаков`;
  const address = clean(input.address);
  if (address.length < ADDRESS_MIN.address) errors.address = 'Укажите улицу и дом';
  else if (address.length > ADDRESS_MAX.address) errors.address = `Не длиннее ${ADDRESS_MAX.address} знаков`;
  for (const key of APT_KEYS) {
    if (clean(input[key]).length > ADDRESS_MAX[key]) errors[key] = `Не длиннее ${ADDRESS_MAX[key]} знаков`;
  }
  return errors;
};

/** Как хранится: без лишних пробелов и повторов слов. */
export const cleanAddress = (input) => ({
  label: clean(input.label).slice(0, ADDRESS_MAX.label),
  address: clean(input.address).slice(0, ADDRESS_MAX.address),
  flat: aptPart('flat', input.flat),
  entrance: aptPart('entrance', input.entrance),
  floor: aptPart('floor', input.floor),
  intercom: aptPart('intercom', input.intercom),
});

/** «ул. Ленина, 1» + «12» → «ул ленина 1|12»: по этому ключу адрес считается тем же. */
export const addressKey = (address, flat) =>
  `${clean(address).toLowerCase().replace(/[.,;«»"']/g, '').replace(/\s+/g, ' ')}|${clean(flat).toLowerCase()}`;

const ID_RE = /^[0-9a-z_-]{1,32}$/i;
/** 8 знаков из `crypto.randomBytes`. */
export const newAddressId = () => crypto.randomBytes(4).toString('hex');

/**
 * What the database holds (a JSON string, an array, null) → a valid list:
 * an entry without an id, with a broken address or a repeated id is dropped,
 * five at most.
 * Что лежит в базе (строка JSON, массив, null) → правильный список: запись без
 * id, с неправильным адресом или повтором id отбрасывается, не больше пяти.
 */
export const cleanAddresses = (raw) => {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  for (const item of list) {
    if (out.length >= MAX_ADDRESSES) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!ID_RE.test(id) || ids.has(id)) continue;
    const input = addressInput(item);
    if (Object.keys(addressErrors(input)).length) continue;
    ids.add(id);
    out.push({ id, ...cleanAddress(input) });
  }
  return out;
};

/** Ошибка операции: `code` и `status` для ответа, `fields` — под какими полями формы её показать. */
const addressError = (code, status, message, fields) => Object.assign(new Error(message), { code, status, ...(fields && { fields }) });
export const ADDRESS_ERROR_CODES = ['INVALID_ADDRESS', 'ADDRESS_LIMIT', 'ADDRESS_NOT_FOUND'];

const refuse = (errors) => {
  const first = Object.values(errors)[0];
  if (first) throw addressError('INVALID_ADDRESS', 400, first, errors);
};

/**
 * One change of the list: add, update or remove; the list itself is not
 * touched — a new one comes back. Adding an address already saved (the same
 * `addressKey`) does not add it twice: the saved one takes the new label and
 * parts and its id comes back. Errors carry `code`: `INVALID_ADDRESS` (400,
 * `fields`), `ADDRESS_LIMIT` (409), `ADDRESS_NOT_FOUND` (404).
 * Одно изменение списка: добавить, поправить, удалить; сам список не меняется —
 * возвращается новый. Добавление уже сохранённого адреса (тот же `addressKey`)
 * не добавляет его второй раз: сохранённый получает новую метку и пункты, и
 * возвращается его id. У ошибок есть `code`: `INVALID_ADDRESS` (400, `fields`),
 * `ADDRESS_LIMIT` (409), `ADDRESS_NOT_FOUND` (404).
 * @param {Array} list сохранённые адреса (`cleanAddresses`)
 * @param {{ kind: 'add', input: object } | { kind: 'update', id: string, input: object } | { kind: 'remove', id: string }} op
 * @param {{ id?: string | (() => string) }} [options] id нового адреса — для проверок
 * @returns {{ list: Array, id?: string }}
 */
export const applyAddressOp = (list, op, { id: makeId = newAddressId } = {}) => {
  const current = cleanAddresses(list);
  const find = (id) => (typeof id === 'string' ? current.findIndex((a) => a.id === id) : -1);

  if (op?.kind === 'add') {
    const input = addressInput(op.input);
    refuse(addressErrors(input));
    const next = cleanAddress(input);
    const key = addressKey(next.address, next.flat);
    const same = current.findIndex((a) => addressKey(a.address, a.flat) === key);
    if (same >= 0) {
      const saved = current[same];
      const updated = { ...saved, label: next.label, flat: next.flat, entrance: next.entrance, floor: next.floor, intercom: next.intercom };
      return { list: current.map((a, i) => (i === same ? updated : a)), id: saved.id };
    }
    if (current.length >= MAX_ADDRESSES) throw addressError('ADDRESS_LIMIT', 409, LIMIT_MESSAGE);
    const taken = new Set(current.map((a) => a.id));
    let id = typeof makeId === 'function' ? makeId() : String(makeId);
    while (taken.has(id) || !ID_RE.test(id)) id = newAddressId();
    return { list: [...current, { id, ...next }], id };
  }

  if (op?.kind === 'update') {
    const at = find(op.id);
    if (at < 0) throw addressError('ADDRESS_NOT_FOUND', 404, 'Адрес не найден — обновите страницу');
    const saved = current[at];
    const merged = { ...saved, ...addressInput(op.input) };
    refuse(addressErrors(merged));
    const next = cleanAddress(merged);
    // two entries for one address would make «add» update only the first
    // две записи на один адрес — и «добавить» обновлял бы только первую
    const key = addressKey(next.address, next.flat);
    const twin = current.find((a, i) => i !== at && addressKey(a.address, a.flat) === key);
    if (twin) refuse({ address: `Этот адрес уже сохранён: «${twin.label}»` });
    return { list: current.map((a, i) => (i === at ? { id: saved.id, ...next } : a)) };
  }

  if (op?.kind === 'remove') {
    const at = find(op.id);
    if (at < 0) throw addressError('ADDRESS_NOT_FOUND', 404, 'Адрес не найден — обновите страницу');
    return { list: current.filter((_, i) => i !== at) };
  }

  throw new TypeError(`applyAddressOp: неизвестная операция ${op?.kind}`);
};
