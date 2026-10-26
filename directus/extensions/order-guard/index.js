/**
 * Orders from the site's cart. The public role may only create an order and
 * never read one back, so everything the browser sends is checked here before
 * the row is written: the phone is normalised, the lines are rebuilt from the
 * catalog with today's prices, the total is counted on the server, the status
 * and the source are set by us, and one address may not flood the inbox. After
 * the row is written, editors and administrators get a notification in the
 * admin (and a letter, once SMTP is configured).
 *
 * Заказы из корзины сайта. Публичная роль может только создать заказ и не
 * может прочитать его обратно, поэтому всё, что прислал браузер, проверяется
 * здесь до записи: телефон приводится к одному виду, строки собираются заново
 * из каталога по сегодняшним ценам, сумма считается на сервере, статус и
 * источник ставим мы, а один адрес не может завалить заказами. После записи
 * редакторы и администраторы получают уведомление в админке (и письмо, когда
 * настроен SMTP).
 *
 * The rules mirror `src/lib/order.ts` on the site: the form refuses the same
 * things before sending, this hook is the part a script cannot skip.
 * Правила повторяют `src/lib/order.ts` сайта: форма отказывает в том же до
 * отправки, а этот хук — та часть, которую скрипт обойти не может.
 *
 * Delivery (since 22.10.2026): the zone is found by the address on the server
 * (`../delivery/geo.js` and the geocoder of `../delivery/photon.js` — the same
 * rules and the same cache as the cart's `/delivery/quote`), the delivery is
 * priced by the zone, an order below the zone's minimum is refused, and every
 * order gets «К оплате» = dishes − discount − points + delivery.
 * Доставка (с 22.10.2026): зона ищется по адресу на сервере (`../delivery/geo.js`
 * и геокодер `../delivery/photon.js` — те же правила и тот же кэш, что у
 * `/delivery/quote` корзины), стоимость — по зоне, заказ меньше минимума зоны
 * не принимается, а «К оплате» = блюда − скидка − баллы + доставка получает
 * каждый заказ.
 *
 * The address by parts (since 23.10.2026): `address` is the street and the
 * house — the only part the zone is looked up by — and the flat, the entrance,
 * the floor and the intercom code come in `address_flat`, `address_entrance`,
 * `address_floor`, `address_intercom`; the old one-line `address_details` is
 * still taken from an older page.
 * Адрес по пунктам (с 23.10.2026): `address` — улица и дом, только по ним ищется
 * зона, — а квартира, подъезд, этаж и код домофона приходят в `address_flat`,
 * `address_entrance`, `address_floor`, `address_intercom`; старое однострочное
 * `address_details` от старой страницы по-прежнему принимается.
 *
 * The mail for the receipt (since 26.10.2026): `email` is optional; when given
 * it is trimmed, lower-cased and must be a Russian mail service — the list of
 * `../email-guard/domains.js`, the same as the account's. The `pay` extension
 * hands it to ЮKassa as `receipt.customer.email`; empty — the order carries no
 * `email` at all, the receipt goes to the phone.
 * Почта для чека (с 26.10.2026): `email` необязательна; если есть — без
 * пробелов по краям, строчными и только российская почтовая служба (список
 * `../email-guard/domains.js`, тот же, что у кабинета). Расширение `pay`
 * передаёт её ЮKassa как `receipt.customer.email`; пусто — в заказе нет
 * `email` вовсе, чек уходит на телефон.
 *
 * The venues (since 26.10.2026): the menus of the two venues differ, so every
 * dish names where it is cooked (`products.places`, «Готовят на», csv of
 * `places` ids; empty — both). `place` is required for pickup and for an order
 * at a table («В зале», `dine_in`), optional for delivery — there it names the
 * kitchen. A dish the chosen venue does not cook is refused; a delivery without
 * a venue gets the only one that cooks its dishes, or is refused when they come
 * from different venues. The table number (`table`) is optional.
 * Точки (с 26.10.2026): меню на двух точках разное, поэтому у каждого блюда
 * указано, где его готовят (`products.places`, «Готовят на», csv из id
 * `places`; пусто — на обеих). `place` обязателен для самовывоза и для заказа
 * за столиком («В зале», `dine_in`), необязателен для доставки — там он
 * называет кухню. Блюдо, которого выбранная точка не готовит, — отказ;
 * доставка без точки получает единственную, где готовят все её блюда, или
 * отказ, если блюда с разных точек. Номер стола (`table`) необязателен.
 *
 * The mail is required for an online payment (since 26.10.2026): the ЮKassa
 * receipt must reach the guest by mail; the phone stays the second contact.
 * Почта обязательна при онлайн-оплате (с 26.10.2026): чек ЮKassa должен прийти
 * гостю на почту; телефон остаётся вторым контактом.
 *
 * No build step: this file is the extension. / Без сборки: этот файл и есть расширение.
 */
import { deliveryCost, minOrderError, normalizeAddress, quote, toZones } from '../delivery/geo.js';
import { geocoder } from '../delivery/photon.js';
import { ADDRESS_PARTS, addressLine, fulfillmentLine, kitchenLine } from '../notify/lib.js';
import { isRuEmail } from '../email-guard/domains.js';
import { resolveSettings } from '../pay/core.js';

const LIMITS = {
  lines: 40,
  qty: 50,
  name: 80,
  address: 200,
  // the address by parts (since 23.10.2026) / адрес по пунктам (с 23.10.2026)
  address_flat: 20,
  address_entrance: 10,
  address_floor: 10,
  address_intercom: 20,
  // the old one-line «кв., подъезд, этаж»: older pages may still send it
  // старая строка «кв., подъезд, этаж»: её ещё может прислать старая страница
  details: 120,
  when: 80,
  comment: 1000,
  // the mail for the receipt, as the form's `maxlength` and the account
  // почта для чека, как `maxlength` формы и кабинет
  email: 120,
  // the table number of an order in the hall / номер стола у заказа в зале
  table: 10,
};
// one visitor, ten minutes, six orders: enough for a mistake and a retry,
// too few for a script
// один посетитель, десять минут, шесть заказов: хватит на ошибку и повтор,
// мало для скрипта
const RATE = { max: 6, windowMs: 10 * 60 * 1000 };
// who hears about a new order / кто узнаёт о новом заказе
const NOTIFY_ROLES = ['Administrator', 'Редактор'];

// Directus turns an error named `DirectusError` into a proper HTTP answer with
// its status and message; anything else becomes a faceless 500
// Directus превращает ошибку с именем `DirectusError` в ответ со своим статусом
// и текстом; всё остальное становится безликим 500
class OrderError extends Error {
  name = 'DirectusError';
  constructor(message, status = 400, code = 'INVALID_PAYLOAD') {
    super(message);
    this.status = status;
    this.code = code;
    this.extensions = { reason: message };
  }
}

/**
 * «30гр», «1,5кг» → «30 г», «1,5 кг» with a non-breaking space — the same rule
 * as the site's `weightText` (`src/lib/catalog.ts`), so a size typed «1,5кг» in
 * the admin and «1,5 кг» sent by the page are the same size.
 * «30гр», «1,5кг» → «30 г», «1,5 кг» с неразрывным пробелом — то же правило,
 * что `weightText` сайта (`src/lib/catalog.ts`): размер, набранный в админке
 * как «1,5кг», и «1,5 кг» со страницы — один и тот же размер.
 */
export const weightText = (value) =>
  String(value)
    .replace(/(\d)\s*(?:гр|г)\.?(?=$|[\s,;/)])/giu, '$1 г')
    .replace(/(\d)\s*кг\.?(?=$|[\s,;/)])/giu, '$1 кг')
    .replace(/(\d)\s*мл\.?(?=$|[\s,;/)])/giu, '$1 мл')
    .replace(/(\d)\s*л\.?(?=$|[\s,;/)])/giu, '$1 л')
    .replace(/(\d)\s*шт\.?(?=$|[\s,;/)])/giu, '$1 шт.')
    .replace(/(\d),\s+(\d)/g, '$1,$2')
    .trim();

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
// a short part of the address: a number is taken as typed, spaces and line
// breaks fold into one space
// короткий пункт адреса: число принимается как набрано, пробелы и переводы
// строк сворачиваются в один пробел
const part = (value, max) =>
  (typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value : '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
const rub = (n) => `${new Intl.NumberFormat('ru-RU').format(n)} ₽`;

/** «8 (987) 955 25 65» → «+7 987 955-25-65»; null — не российский мобильный/городской */
export const normalizePhone = (value) => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  if (!/^7[3-9]\d{9}$/.test(digits)) return null;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
};

/** «1210-4821»: день, месяц и четыре цифры — короткий номер, который гость назовёт по телефону */
const freshNumber = () => {
  const now = new Date();
  const day = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Samara', day: '2-digit', month: '2-digit' })
    .format(now)
    .replace('.', '');
  return `${day}-${String(Math.floor(1000 + Math.random() * 9000))}`;
};

// a guest signed in on the site (the `guest-auth` extension) carries this role
// гость, вошедший на сайте (расширение `guest-auth`), несёт эту роль
const GUEST_ROLE = 'Гость';

// what the guest reads when the mail for the receipt is refused
// что читает гость, когда почту для чека не приняли
export const EMAIL_ERROR =
  'E-mail для чека: подойдёт российская почта — mail.ru, yandex.ru, rambler.ru, vk.com… Или оставьте поле пустым: чек придёт смской на телефон.';

/**
 * The mail for the receipt as the order keeps it: trimmed, lower case; empty
 * or not a string — `null`; a broken, too long or non-Russian one — `false`.
 * Почта для чека, как её хранит заказ: без пробелов по краям, строчными; пусто
 * или не строка — `null`; кривая, слишком длинная или нероссийская — `false`.
 * @param {unknown} value
 * @returns {string | null | false}
 */
export const receiptEmail = (value) => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) return null;
  return email.length <= LIMITS.email && isRuEmail(email) ? email : false;
};

// an online payment sends the ЮKassa receipt by mail: without it the order is refused
// онлайн-оплата присылает чек ЮKassa на почту: без неё заказ не принимается
export const EMAIL_REQUIRED = 'Укажите почту: на неё придёт чек об оплате.';

// how the guest gets the order: delivery, pickup and, since 26.10.2026, at a table in the hall
// как гость получает заказ: доставка, самовывоз и, с 26.10.2026, за столиком в зале
const FULFILLMENT = ['delivery', 'pickup', 'dine_in'];
// what the guest reads when the venue is not chosen / что читает гость, когда точка не выбрана
const PLACE_REQUIRED = {
  pickup: 'Выберите точку самовывоза.',
  dine_in: 'Выберите точку, в зале которой вы сидите.',
};
export const TABLE_ERROR = 'Номер стола: цифры и буквы, например 4 или 12А.';

/**
 * The table as the order keeps it: «4», «12А», «В-3». «стол 4», «Столик №4» →
 * «4»; empty — `null`; longer than 10 or with other signs — `false`.
 * Стол, как его хранит заказ: «4», «12А», «В-3». «стол 4», «Столик №4» → «4»;
 * пусто — `null`; длиннее 10 знаков или с другими знаками — `false`.
 * @param {unknown} value
 * @returns {string | null | false}
 */
export const tableNumber = (value) => {
  const raw = part(value, 40)
    .replace(/^(?:стол(?:ик)?|table)\.?\s*/iu, '')
    .replace(/^№\s*/u, '')
    .replace(/\s+/g, '');
  if (!raw) return null;
  return raw.length <= LIMITS.table && /^[\p{L}\d-]+$/u.test(raw) ? raw : false;
};

/**
 * The venues that cook a dish, from `products.places`: «1,2» as the database
 * keeps a csv field, `["1","2"]`, `[1, 2]`. Empty or unreadable — `[]`, both
 * venues: the same rule as the site's `placesOf` (`src/lib/catalog.ts`).
 * Точки, где готовят блюдо, из `products.places`: «1,2», как база хранит поле
 * csv, `["1","2"]`, `[1, 2]`. Пусто или не читается — `[]`, обе точки: то же
 * правило, что `placesOf` сайта (`src/lib/catalog.ts`).
 */
export const dishPlaces = (value) => {
  let list = value;
  if (typeof list === 'string') {
    const text = list.trim();
    try {
      list = text.startsWith('[') ? JSON.parse(text) : text.split(',');
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  const ids = list.map((item) => (typeof item === 'number' || typeof item === 'string' ? Number(String(item).trim()) : NaN));
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
};

/**
 * Which venue cooks the order. `place` — the venue the guest chose (null for
 * a delivery without one), `dishes` — `{ title, places }` of every line,
 * `names` — venue id → its name. Returns `{ place }` (a delivery without a
 * venue gets the only one that cooks all its dishes, or stays null when both
 * do) or `{ error }` with the text for the guest.
 * Какая точка готовит заказ. `place` — точка, выбранная гостем (null у
 * доставки без неё), `dishes` — `{ title, places }` каждой строки, `names` —
 * id точки → её название. Возвращает `{ place }` (доставка без точки получает
 * единственную, где готовят все её блюда, или остаётся null, если готовят
 * обе) или `{ error }` с текстом для гостя.
 * @param {number | null} place
 * @param {Array<{ title: string, places: number[] }>} dishes
 * @param {Map<number, string>} names
 * @returns {{ place: number | null, error?: undefined } | { error: string, place?: undefined }}
 */
export const kitchenFor = (place, dishes, names) => {
  const where = (ids) => ids.map((id) => names.get(id) ?? `точка ${id}`).join(' или ');
  const limited = dishes.filter((dish) => dish.places.length);
  if (place) {
    const wrong = limited.find((dish) => !dish.places.includes(place));
    return wrong
      ? { error: `«${wrong.title}» готовят только по адресу ${where(wrong.places)}. Поменяйте точку или уберите блюдо из корзины.` }
      : { place };
  }
  if (!limited.length) return { place: null };
  const common = limited.reduce((ids, dish) => ids.filter((id) => dish.places.includes(id)), limited[0].places);
  if (!common.length) {
    const [first] = limited;
    const other = limited.find((dish) => !dish.places.some((id) => first.places.includes(id))) ?? limited[1];
    return {
      error: `В корзине блюда с разных точек: «${first.title}» готовят по адресу ${where(first.places)}, а «${other.title}» — ${where(other.places)}. Оформите их разными заказами или уберите лишнее.`,
    };
  }
  return { place: common.length === 1 ? common[0] : null };
};

// what the manager reads when the address gave no zone / что читает менеджер, когда зоны по адресу нет
export const NOTE_NOT_FOUND = 'Адрес не найден на карте — стоимость доставки назвать при звонке.';
export const NOTE_OUTSIDE = 'Адрес вне зон доставки — предложить самовывоз или назвать стоимость при звонке.';

/**
 * The delivery line of the manager's notification: «зона «…» · 400 ₽»,
 * «… · бесплатно (от 7 000 ₽)» or «стоимость назвать при звонке».
 * Строка доставки в уведомлении менеджеру.
 * @param {{ zone?: string | null, cost?: number | null, freeFrom?: number | null }} delivery
 */
export const deliveryText = ({ zone, cost, freeFrom = null }) => {
  if (cost === null || cost === undefined) return 'стоимость назвать при звонке';
  const where = zone ? `зона «${zone}» · ` : '';
  if (Number(cost) > 0) return `${where}${rub(Number(cost))}`;
  return `${where}бесплатно${freeFrom ? ` (от ${rub(freeFrom)})` : ''}`;
};

export default ({ filter, action }, { services, logger, emitter = null, database: root = null, env = {} }) => {
  const hits = new Map();
  const isGuest = async (accountability, database) =>
    Boolean(accountability?.user && accountability.role) &&
    (await database('directus_roles').where({ id: accountability.role }).first('name'))?.name === GUEST_ROLE;

  const tooMany = (ip) => {
    if (!ip) return false;
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs);
    recent.push(now);
    hits.set(ip, recent);
    // the map must not grow forever on a public endpoint
    // на публичном адресе карта не должна расти бесконечно
    if (hits.size > 5000) for (const [key, times] of hits) if (now - times.at(-1) > RATE.windowMs) hits.delete(key);
    return recent.length > RATE.max;
  };

  /**
   * Zones in force. Read outside the order's transaction when the hook has
   * its own connection: a missing table must not break the order's write.
   * Действующие зоны. Читаются вне транзакции заказа, если у хука есть своё
   * соединение: отсутствующая таблица не должна ломать запись заказа.
   */
  const zonesNow = async (database, schema) => {
    if (schema?.collections && !schema.collections.delivery_zones) return [];
    try {
      return toZones(await (root ?? database)('delivery_zones').select('id', 'name', 'price', 'free_from', 'min_order', 'polygon', 'sort', 'status'));
    } catch {
      return [];
    }
  };

  // a page that sends the mail before `schema apply` made the column: the mail
  // is dropped (the receipt goes to the phone), the order is not lost; once in the log
  // страница шлёт почту раньше, чем `schema apply` завёл колонку: почта
  // отбрасывается (чек уйдёт на телефон), заказ не теряется; в логе один раз
  let emailColumnWarned = false;
  const emailColumn = (schema) => {
    const fields = schema?.collections?.orders?.fields;
    if (!fields || fields.email) return true;
    if (!emailColumnWarned) {
      emailColumnWarned = true;
      logger.warn('order-guard: в orders нет поля email — почта для чека отброшена. Примените directus/snapshot.yaml (schema apply)');
    }
    return false;
  };

  /**
   * Whether the site takes only online payments: online is on and «on
   * delivery» is off (the `pay` extension's own rule, `resolveSettings`). Then
   * an order without `payment_method` is paid online all the same and needs
   * the mail. Read outside the order's transaction, like the zones.
   * Принимает ли сайт только онлайн-оплату: онлайн включена, «при получении»
   * выключено (правило самого расширения `pay`, `resolveSettings`). Тогда
   * заказ без `payment_method` всё равно платится онлайн и требует почту.
   * Читается вне транзакции заказа, как и зоны.
   */
  const onlineOnly = async (database, schema) => {
    if (schema?.collections && !schema.collections.payment_settings) return false;
    try {
      const settings = resolveSettings(await (root ?? database)('payment_settings').first(), env);
      return settings.enabled && !settings.onDelivery;
    } catch {
      return false;
    }
  };

  // a page that sends the table before `schema apply` made the column: the
  // number goes to the manager's note instead, once in the log
  // страница шлёт стол раньше, чем `schema apply` завёл колонку: номер уходит
  // в заметку менеджера, в логе один раз
  let tableColumnWarned = false;
  const tableColumn = (schema) => {
    const fields = schema?.collections?.orders?.fields;
    if (!fields || fields.table) return true;
    if (!tableColumnWarned) {
      tableColumnWarned = true;
      logger.warn('order-guard: в orders нет поля table — номер стола уходит в заметку менеджера. Примените directus/snapshot.yaml (schema apply)');
    }
    return false;
  };

  filter('orders.items.create', async (payload, _meta, { accountability, database, schema }) => {
    // editors entering a phone order and internal calls pass as they are; a
    // guest signed in on the site is checked like the public and owns the order
    // редактор, вбивающий заказ по телефону, и внутренние вызовы проходят как
    // есть; вошедший на сайте гость проверяется как публичный и владеет заказом
    const customer = (await isGuest(accountability, database)) ? accountability.user : null;
    if (!accountability || (accountability.user && !customer)) return payload;

    if (tooMany(accountability.ip))
      throw new OrderError('Слишком много заказов подряд. Позвоните нам — примем по телефону.', 429, 'REQUESTS_EXCEEDED');

    const name = text(payload.customer_name, LIMITS.name);
    if (!name) throw new OrderError('Укажите имя.');
    const phone = normalizePhone(payload.phone);
    if (!phone) throw new OrderError('Телефон не похож на российский номер.');
    const email = receiptEmail(payload.email);
    if (email === false) throw new OrderError(EMAIL_ERROR);
    // an online payment needs the mail: the receipt goes there (since 26.10.2026)
    // онлайн-оплате нужна почта: туда уходит чек (с 26.10.2026)
    if (!email && (payload.payment_method === 'online' || (await onlineOnly(database, schema)))) throw new OrderError(EMAIL_REQUIRED);
    if (payload.consent !== true) throw new OrderError('Нужно согласие на обработку данных.');

    const fulfillment = FULFILLMENT.includes(payload.fulfillment) ? payload.fulfillment : null;
    if (!fulfillment) throw new OrderError('Выберите, как получить заказ: доставка, самовывоз или в зале.');
    const address = text(payload.address, LIMITS.address);
    if (fulfillment === 'delivery' && address.length < 5) throw new OrderError('Укажите адрес доставки.');
    // the venue: required for pickup and the hall, optional for delivery — but
    // when sent, it must be one of ours
    // точка: обязательна для самовывоза и зала, необязательна для доставки — но
    // если прислана, должна быть нашей
    const names = new Map((await database('places').select('id', 'name')).map((row) => [Number(row.id), row.name]));
    const asked = payload.place === null || payload.place === undefined || payload.place === '' ? null : Number(payload.place);
    let place = Number.isInteger(asked) && names.has(asked) ? asked : null;
    if (!place && PLACE_REQUIRED[fulfillment]) throw new OrderError(PLACE_REQUIRED[fulfillment]);
    if (!place && asked !== null) throw new OrderError('Такой точки нет. Обновите страницу и выберите точку заново.');
    const table = fulfillment === 'dine_in' ? tableNumber(payload.table) : null;
    if (table === false) throw new OrderError(TABLE_ERROR);

    // lines are rebuilt from the catalog: the browser names the dish, the
    // variant and the quantity, the price is ours
    // строки собираются из каталога заново: браузер называет блюдо, вариант
    // и количество, цена — наша
    const lines = Array.isArray(payload.items) ? payload.items : [];
    if (!lines.length) throw new OrderError('Корзина пуста.');
    if (lines.length > LIMITS.lines) throw new OrderError(`В одном заказе до ${LIMITS.lines} позиций.`);
    const ids = [...new Set(lines.map((line) => Number(line?.product)).filter(Number.isInteger))];
    // «Готовят на» only where the schema has it: a missing column inside the
    // order's transaction would break the whole write
    // «Готовят на» — только если оно есть в схеме: отсутствующая колонка в
    // транзакции заказа сломала бы всю запись
    const venues = Boolean(schema?.collections?.products?.fields?.places);
    const rows = ids.length
      ? await database('products')
          .whereIn('id', ids)
          .select('id', 'title', 'price', 'weight', 'variants', 'fillings', 'available', 'status', ...(venues ? ['places'] : []))
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));

    const items = lines.map((line) => {
      const product = byId.get(Number(line?.product));
      const qty = Number(line?.qty);
      if (!product || product.status !== 'published')
        throw new OrderError(`«${text(line?.title, 80) || 'Позиция'}» больше нет в каталоге. Обновите страницу.`);
      if (!product.available) throw new OrderError(`«${product.title}» закончилось. Уберите его из корзины.`);
      if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.qty)
        throw new OrderError(`Количество «${product.title}» — от 1 до ${LIMITS.qty}.`);
      const json = (value) => (typeof value === 'string' ? JSON.parse(value) : value ?? []);
      // only real sizes count: the site folds a single one into the dish price
      // в счёт идут только настоящие размеры: один размер сайт сворачивает в цену блюда
      const variants = json(product.variants).filter((v) => v?.name && Number(v?.price) > 0);
      const wanted = text(line?.variant, 80);
      const variant = wanted ? variants.find((v) => weightText(v.name) === weightText(wanted)) : null;
      if (wanted && !variant) throw new OrderError(`У «${product.title}» нет размера «${wanted}». Обновите страницу.`);
      if (!wanted && variants.length > 1) throw new OrderError(`Выберите размер «${product.title}».`);
      const fillings = json(product.fillings);
      const filling = text(line?.filling, 80) || null;
      if (fillings.length && !fillings.includes(filling)) throw new OrderError(`Выберите начинку «${product.title}».`);
      const price = Number(variant?.price ?? product.price);
      // the line's title carries the choice: «Торт «Лего» (2 кг, Сникерс)» —
      // the admin shows the order as `qty × title — sum`, and its template
      // prints an empty size or filling as «--»; the size and the filling stay
      // in their own fields too
      // название строки несёт выбор: «Торт «Лего» (2 кг, Сникерс)» — админка
      // показывает заказ как `кол-во × название — сумма`, а её шаблон печатает
      // пустой размер или начинку как «--»; размер и начинка остаются и в своих полях
      const size = variant ? weightText(variant.name) : null;
      const choice = [size, fillings.length ? filling : null].filter(Boolean);
      return {
        product: product.id,
        title: choice.length ? `${product.title} (${choice.join(', ')})` : product.title,
        variant: size,
        filling: fillings.length ? filling : null,
        weight: (variant?.weight || product.weight) ? weightText(variant?.weight || product.weight) : null,
        qty,
        price,
        sum: price * qty,
      };
    });
    const total = items.reduce((sum, line) => sum + line.sum, 0);

    // the menus differ per venue: every dish must be cooked where the order is
    // меню на точках разное: каждое блюдо должно готовиться там, где заказ
    const kitchen = kitchenFor(
      place,
      items.map((line) => ({ title: byId.get(line.product).title, places: venues ? dishPlaces(byId.get(line.product).places) : [] })),
      names,
    );
    if (kitchen.error) throw new OrderError(kitchen.error);
    place = kitchen.place;

    // the guest saw the build-time prices; if the admin changed one since, the
    // manager learns it before the call, not from the guest
    // гость видел цены на момент сборки; если в админке их с тех пор поменяли,
    // менеджер узнаёт об этом до звонка, а не от гостя
    const seen = Number(payload.total);
    const note =
      Number.isFinite(seen) && seen !== total
        ? `На сайте гость видел ${rub(seen)}, по текущим ценам ${rub(total)} — уточнить при звонке.`
        : null;

    // Delivery by zone: the zone is found here again, whatever the cart showed.
    // Free from the zone's threshold, counted on the dishes before the discount
    // and the points; below the zone's minimum the order is refused. No zone
    // (the address is not on the map, or outside every zone) — the order goes
    // through, the delivery is priced on the call. Pickup and the hall cost nothing.
    // Доставка по зонам: зона ищется здесь заново, что бы ни показала корзина.
    // Бесплатно от порога зоны, считая блюда до скидки и баллов; меньше минимума
    // зоны — отказ. Нет зоны (адреса нет на карте или он вне всех зон) — заказ
    // проходит, стоимость доставки называют при звонке. Самовывоз и зал — 0 ₽.
    const delivery = { zone: null, cost: fulfillment === 'delivery' ? null : 0, note: null };
    if (fulfillment === 'delivery') {
      const zones = await zonesNow(database, schema);
      if (zones.length) {
        const found = await quote(address, {
          zones,
          geocode: geocoder.locate,
          geocodeRaw: geocoder.locateRaw,
          log: (error) => logger.warn(`order-guard: адрес «${normalizeAddress(address)}» не проверен — ${error.message}`),
        });
        if (found.found) {
          const refused = minOrderError(found.zone, total);
          if (refused) throw new OrderError(refused);
          delivery.zone = found.zone.name;
          delivery.cost = deliveryCost(found.zone, total);
        } else delivery.note = found.outside ? NOTE_OUTSIDE : NOTE_NOT_FOUND;
      }
    }

    // «Вкусные баллы» (the `loyalty` extension) decide how much of the order a
    // signed-in guest pays with points and the birthday discount; without that
    // extension nothing is taken off the total
    // «Вкусные баллы» (расширение `loyalty`) решают, сколько заказа вошедший
    // гость оплачивает баллами, и скидку именинника; без этого расширения из
    // суммы ничего не вычитается
    const loyalty = customer && emitter
      ? await emitter.emitFilter(
          'orders.checkout',
          { customer, total, delivery: delivery.cost ?? 0, requested: payload.bonus_spent, bonus_spent: 0, discount: 0, note: null },
          { collection: 'orders' },
          { database, accountability },
        )
      : null;

    let number = /^\d{4}-\d{4}$/.test(String(payload.number ?? '')) ? payload.number : freshNumber();
    if (await database('orders').where({ number }).first('id')) number = `${number}-${Math.floor(Math.random() * 90 + 10)}`;

    return {
      number,
      status: 'new',
      source: 'site',
      customer_name: name,
      phone,
      // only a filled mail: an empty one stays the column's null, so an order
      // without it goes through even before `pnpm setup` gave the public role
      // the field
      // только заполненная почта: пустая остаётся null колонки, поэтому заказ
      // без неё проходит и до того, как `pnpm setup` дал публичной роли поле
      ...(email && emailColumn(schema) ? { email } : {}),
      fulfillment,
      // pickup and the hall: where; delivery: which kitchen cooks (null — chosen on the call)
      // самовывоз и зал — где; доставка — какая кухня готовит (null — выберут при звонке)
      place,
      // only a filled table, and only where the column is: see `tableColumn`
      // только заполненный стол и только там, где есть колонка: см. `tableColumn`
      ...(table && tableColumn(schema) ? { table } : {}),
      address: fulfillment === 'delivery' ? address : null,
      // the flat, the entrance, the floor, the intercom — only the filled ones:
      // an empty part stays the column's null, so an order from a page without
      // the parts goes through even before `pnpm setup` gave the public role
      // the new fields; pickup — none
      // квартира, подъезд, этаж, домофон — только заполненные: пустой пункт
      // остаётся null колонки, поэтому заказ со страницы без пунктов проходит
      // и до того, как `pnpm setup` дал публичной роли новые поля; у самовывоза — ничего
      ...Object.fromEntries(
        fulfillment === 'delivery'
          ? ADDRESS_PARTS.map(({ field }) => [field, part(payload[field], LIMITS[field])]).filter(([, value]) => value)
          : [],
      ),
      address_details: fulfillment === 'delivery' ? text(payload.address_details, LIMITS.details) || null : null,
      desired_time: text(payload.desired_time, LIMITS.when) || 'Как можно скорее',
      comment: text(payload.comment, LIMITS.comment) || null,
      items,
      total,
      consent: true,
      manager_note: [note, delivery.note, loyalty?.note, table && !tableColumn(schema) ? `Стол: ${table}` : null].filter(Boolean).join('\n') || null,
      // how the guest wants to pay, when the site offered the choice; the rest
      // of `payment_*` (paid or not) is never taken from here — the `pay`
      // extension writes it from the bank's answer
      // как гость хочет платить, если сайт предложил выбор; остальные
      // `payment_*` (оплачен или нет) отсюда не берутся никогда — их пишет
      // расширение `pay` по ответу банка
      ...(payload.payment_method ? { payment_method: payload.payment_method === 'online' ? 'online' : 'on_delivery' } : {}),
      delivery_zone: delivery.zone,
      delivery_cost: delivery.cost,
      // «К оплате» for every order: what the online payment asks and the
      // manager takes; `delivery_cost` null (priced on the call) adds nothing
      // «К оплате» у каждого заказа: столько просит онлайн-оплата и берёт
      // менеджер; `delivery_cost` null (назовут при звонке) ничего не добавляет
      to_pay: total - (loyalty?.discount ?? 0) - (loyalty?.bonus_spent ?? 0) + (delivery.cost ?? 0),
      ...(customer && {
        customer,
        bonus_spent: loyalty?.bonus_spent ?? 0,
        discount: loyalty?.discount ?? 0,
      }),
    };
  });

  action('orders.items.create', async ({ key, payload }, { database, schema }) => {
    try {
      const roles = await database('directus_roles').whereIn('name', NOTIFY_ROLES).pluck('id');
      const users = roles.length
        ? await database('directus_users').whereIn('role', roles).where({ status: 'active' }).pluck('id')
        : [];
      if (!users.length) return;
      const lines = (payload.items ?? []).map((line) => `- ${line.title} × ${line.qty} — ${rub(line.sum ?? 0)}`);
      // «бесплатно (от 7 000 ₽)» needs the zone's threshold; the order keeps only the zone's name
      // «бесплатно (от 7 000 ₽)» нужен порог зоны; в заказе лежит только её имя
      const freeFrom =
        payload.delivery_zone && Number(payload.delivery_cost) === 0
          ? ((await database('delivery_zones').where({ name: payload.delivery_zone }).first('free_from').catch(() => null))?.free_from ?? null)
          : null;
      // an order entered by an editor carries no delivery fields: its line stays as it was
      // у заказа, который вбил редактор, полей доставки нет: его строка остаётся как была
      const priced = 'delivery_cost' in payload || payload.source === 'site';
      // the venue by name: where to pick up or sit, or which kitchen cooks the delivery
      // точка по названию: где забрать или где сидит гость, или какая кухня готовит доставку
      const venue = payload.place
        ? ((await database('places').where({ id: payload.place }).first('name').catch(() => null))?.name ?? null)
        : null;
      // «Доставка: Советской Армии, 177, кв. 12, подъезд 2, этаж 5, домофон 12К · зона …. Готовит: Садовая, 212Б»,
      // «Самовывоз: Садовая, 212Б», «В зале: Садовая, 212Б, стол 4»
      const kitchen = kitchenLine(payload, venue);
      const how =
        payload.fulfillment === 'delivery' || !payload.fulfillment
          ? `Доставка: ${addressLine(payload) || 'адрес не указан'}${
              priced ? ` · ${deliveryText({ zone: payload.delivery_zone, cost: payload.delivery_cost, freeFrom })}` : ''
            }${kitchen ? `. ${kitchen}` : ''}`
          : fulfillmentLine(payload, venue);
      const toPay = payload.to_pay ?? payload.total ?? 0;
      const message = [
        `**${payload.customer_name}**, ${payload.phone}`,
        `${how}. Когда: ${payload.desired_time ?? 'как можно скорее'}.`,
        '',
        ...lines,
        '',
        `Итого (блюда): ${rub(payload.total ?? 0)}`,
        `К оплате: **${rub(toPay)}**`,
        payload.comment ? `\nКомментарий: ${payload.comment}` : '',
        payload.manager_note ? `\n${payload.manager_note}` : '',
      ].join('\n');
      const notifications = new services.NotificationsService({ schema, knex: database });
      for (const recipient of users) {
        await notifications.createOne({
          recipient,
          subject: `Новый заказ ${payload.number ?? key} · ${rub(toPay)}`,
          message,
          collection: 'orders',
          item: String(key),
        });
      }
    } catch (error) {
      // a lost notification must not lose the order: it is already written
      // потерянное уведомление не должно терять заказ: он уже записан
      logger.warn(`order-guard: уведомление о заказе ${key} не создано — ${error.message}`);
    }
  });
};
