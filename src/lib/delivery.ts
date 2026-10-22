/**
 * Delivery by zones, the site's side: the pure rules the cart drawer shows
 * before the order leaves — what the address suggestions and the zone quote
 * of `directus/extensions/delivery` (`GET /delivery/suggest`,
 * `POST /delivery/quote`) mean for the sum. The server is the one that
 * decides: `order-guard` finds the zone by the address again, counts the
 * delivery and checks the zone's minimum; here the guest only sees the same
 * numbers before sending. Words live here too, so the drawer, the «accepted»
 * screen and the checks say the same thing.
 * Доставка по зонам, сторона сайта: чистые правила, которые корзина
 * показывает до отправки заказа, — что подсказки адресов и расчёт зоны
 * расширения `directus/extensions/delivery` (`GET /delivery/suggest`,
 * `POST /delivery/quote`) значат для суммы. Решает сервер: `order-guard` ещё раз
 * находит зону по адресу, считает доставку и проверяет минимум зоны; здесь
 * гость только видит те же числа до отправки. Слова тоже здесь, чтобы корзина,
 * экран «Заказ принят» и проверки говорили одно и то же.
 */
import { rub } from './catalog.ts';

export type Zone = {
  id: number | string;
  /** имя для админки и сайта: «Рядом с нами — Советский, Промышленный, Октябрьский» */
  name: string;
  /** стоимость доставки, ₽ */
  price: number;
  /** с какой суммы блюд доставка бесплатна, ₽ */
  free_from: number;
  /** минимальная сумма блюд для доставки по зоне, ₽ */
  min_order: number;
};

/** Подсказка адреса: «улица Советской Армии, 177», «Самара». */
export type Suggestion = { label: string; city: string; lat: number; lng: number };

export type QuoteFound = { found: true; address: string; lat: number; lng: number; zone: Zone };
export type QuoteMissed = { found: false; outside: boolean };
export type Quote = QuoteFound | QuoteMissed;

/**
 * Free delivery of the near zones («Рядом с нами», «Центр») — for the words
 * shown before any address is known (the cart, the catalog's first screen).
 * The far zones have higher thresholds; the quote by the address names them.
 * Порог бесплатной доставки ближних зон («Рядом с нами», «Центр») — для слов,
 * которые видны до адреса (корзина, первый экран каталога). У дальних зон
 * порог выше, его называет расчёт по адресу.
 */
export const FREE_FROM = 7000;

/** подсказки — от трёх знаков, до шести вариантов, после паузы в наборе 300 мс */
export const SUGGEST_MIN = 3;
export const SUGGEST_MAX = 6;
export const SUGGEST_DEBOUNCE_MS = 300;
/** ручной ввод без выбора подсказки считается после паузы подольше: человек ещё дописывает дом */
export const QUOTE_DEBOUNCE_MS = 1500;
/** город по умолчанию: сервер дописывает его к адресу без города */
export const HOME_CITY = 'Самара';

/** Ключ кэша и сравнения: нижний регистр, «ё» как «е», пробелы схлопнуты. */
export const normalizeAddress = (value: string) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

export const canSuggest = (query: string) => String(query ?? '').trim().length >= SUGGEST_MIN;
/** то же «не короче пяти знаков», что у проверки формы (`validate` в `order.ts`) */
export const canQuote = (address: string) => String(address ?? '').trim().length >= 5;
/** в запросе есть цифра — вероятно, номер дома уже набран */
export const hasHouse = (query: string) => /\d/.test(String(query ?? ''));

// ── answers of the API / ответы API ──────────────────────────────────────────

const money = (value: unknown) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
const coord = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};
const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** Зона из ответа сервера; без цены или порогов — `null`, а не доставка за 0 ₽. */
export const parseZone = (raw: unknown): Zone | null => {
  if (!raw || typeof raw !== 'object') return null;
  const zone = raw as Record<string, unknown>;
  const price = money(zone.price);
  const freeFrom = money(zone.free_from);
  const minOrder = money(zone.min_order) ?? 0;
  if (price === null || freeFrom === null) return null;
  const id = typeof zone.id === 'number' || typeof zone.id === 'string' ? zone.id : '';
  return { id, name: text(zone.name), price, free_from: freeFrom, min_order: minOrder };
};

/** `{ items: [...] }` → до шести подсказок без повторов; битый ответ — пусто. */
export const parseSuggestions = (data: unknown): Suggestion[] => {
  const items = data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items) ? (data as { items: unknown[] }).items : [];
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const label = text(item.label);
    if (!label) continue;
    const city = text(item.city);
    const key = normalizeAddress(`${city}|${label}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: label.slice(0, 160), city: city.slice(0, 60), lat: coord(item.lat), lng: coord(item.lng) });
    if (out.length === SUGGEST_MAX) break;
  }
  return out;
};

/** Ответ `/delivery/quote` в безопасный вид: всё, что не «нашли и знаем зону», — `found: false`. */
export const parseQuote = (data: unknown): Quote => {
  const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const zone = raw.found === true ? parseZone(raw.zone) : null;
  if (zone) return { found: true, address: text(raw.address), lat: coord(raw.lat), lng: coord(raw.lng), zone };
  return { found: false, outside: raw.outside === true };
};

/**
 * The address a suggestion puts into the field and sends to the server: in
 * Samara «улица, дом», elsewhere with the city first — without it the server
 * would look for «улица Победы, 1» in Samara.
 * Адрес, который подсказка ставит в поле и отправляет серверу: в Самаре —
 * «улица, дом», в другом городе — с городом впереди: без него сервер искал бы
 * «улица Победы, 1» в Самаре.
 */
export const addressOf = (suggestion: Pick<Suggestion, 'label' | 'city'>) =>
  !suggestion.city || normalizeAddress(suggestion.city) === normalizeAddress(HOME_CITY) || normalizeAddress(suggestion.label).includes(normalizeAddress(suggestion.city))
    ? suggestion.label
    : `${suggestion.city}, ${suggestion.label}`;

// ── money / деньги ───────────────────────────────────────────────────────────

/** Доставка по зоне: бесплатно от порога, считая сумму блюд до скидки и баллов (как `order-guard`). */
export const costFor = (subtotal: number, zone: Zone) => (subtotal >= zone.free_from ? 0 : zone.price);

/** Сумма блюд меньше минимума зоны: доставку по этому адресу не отправить. */
export const belowMin = (subtotal: number, zone: Zone) => subtotal < zone.min_order;

/** «Минимальный заказ для доставки по этому адресу — 2 500 ₽, в корзине 1 800 ₽» («в» держится за слово неразрывным пробелом) */
export const minOrderText = (subtotal: number, zone: Zone) =>
  `Минимальный заказ для доставки по этому адресу — ${rub(zone.min_order)}, в\u00a0корзине ${rub(subtotal)}`;

/** Подпись под счётом, пока минимум не добран: одна строка, чтобы подвал не рос. */
export const shortText = (short: number) => `Доберите ещё ${rub(short)} — или выберите самовывоз`;

/** Слова адреса без служебных: «улица», «ул», город по умолчанию, знаки. */
const words = (value: string) =>
  normalizeAddress(value)
    .replace(/[.,;]/g, ' ')
    .split(' ')
    .filter((word) => word && !['улица', 'ул', 'г', 'город', normalizeAddress(HOME_CITY)].includes(word))
    .sort()
    .join(' ');

/**
 * The map read the typed address as written — then «на карте: …» would only
 * repeat the field. «Советской Армии 177» and «улица Советской Армии, 177,
 * Самара» are the same house.
 * Поиск по карте понял набранный адрес так, как он написан, — тогда «на карте:
 * …» лишь повторила бы поле. «Советской Армии 177» и «улица Советской Армии,
 * 177, Самара» — один и тот же дом.
 */
export const sameAddress = (typed: string, found: string) => words(typed) === words(found);

/**
 * What the drawer knows about the delivery of this order. `pickup` — no
 * delivery; `empty` — no address yet; `pending` — asking the server; `zone` —
 * the zone is known (`picked`: the address came from a suggestion, the guest
 * has already seen it); `unknown` — the price will be named on the call:
 * the address was not found (`notfound`), is outside every zone (`outside`),
 * the server did not answer (`error`) or the build has no API (`off`).
 * Что корзина знает о доставке этого заказа. `pickup` — доставки нет;
 * `empty` — адреса ещё нет; `pending` — спрашиваем сервер; `zone` — зона
 * известна (`picked`: адрес взят из подсказки, гость его уже видел);
 * `unknown` — стоимость назовём при звонке: адрес не нашёлся (`notfound`), вне
 * всех зон (`outside`), сервер не ответил (`error`) или у сборки нет API (`off`).
 */
export type DeliveryState =
  | { kind: 'pickup' }
  | { kind: 'empty' }
  | { kind: 'pending'; address: string }
  | { kind: 'zone'; address: string; quote: QuoteFound; picked: boolean }
  | { kind: 'unknown'; address: string; why: 'notfound' | 'outside' | 'error' | 'off' };

/** Состояние по ответу сервера на адрес `address`. */
export const stateFromQuote = (address: string, quote: Quote, picked = false): DeliveryState =>
  quote.found ? { kind: 'zone', address, quote, picked } : { kind: 'unknown', address, why: quote.outside ? 'outside' : 'notfound' };

/**
 * The delivery for the sum: a number (0 — free, or pickup), `null` — named on
 * the call or not known yet; such an order pays the dishes online and the
 * delivery separately.
 * Доставка для суммы: число (0 — бесплатно или самовывоз), `null` — назовём при
 * звонке или ещё не знаем; такой заказ онлайн оплачивает блюда, а доставку —
 * отдельно.
 */
export const deliveryCost = (state: DeliveryState, subtotal: number): number | null => {
  if (state.kind === 'pickup') return 0;
  if (state.kind === 'zone') return costFor(subtotal, state.quote.zone);
  return null;
};

/** Отправка закрыта: сумма блюд меньше минимума зоны. Самовывоз снимает запрет. */
export const blocksOrder = (state: DeliveryState, subtotal: number) => state.kind === 'zone' && belowMin(subtotal, state.quote.zone);

/** Сколько не хватает до минимума зоны; 0 — хватает или зоны нет. */
export const shortOfMin = (state: DeliveryState, subtotal: number) =>
  state.kind === 'zone' ? Math.max(0, state.quote.zone.min_order - subtotal) : 0;

/**
 * To pay = dishes − birthday discount − points + delivery. Points and the
 * discount never take the dishes below zero, and never touch the delivery
 * (the same `to_pay` as `order-guard`).
 * К оплате = блюда − скидка именинника − баллы + доставка. Баллы и скидка не
 * уводят блюда ниже нуля и не трогают доставку (тот же `to_pay`, что у
 * `order-guard`).
 */
export const payable = ({ dishes, discount = 0, points = 0, delivery = null }: { dishes: number; discount?: number; points?: number; delivery?: number | null }) =>
  Math.max(0, dishes - discount - points) + (delivery ?? 0);

// ── words / слова ────────────────────────────────────────────────────────────

/** Строка «Доставка» в сумме оформления и на «Заказ принят»: подпись, значение, тон. */
export type BillRow = { label: string; value: string; tone: 'money' | 'free' | 'quiet' };

export const billRow = (state: DeliveryState, subtotal: number): BillRow => {
  switch (state.kind) {
    case 'pickup':
      return { label: 'Самовывоз', value: rub(0), tone: 'money' };
    case 'empty':
      return { label: 'Доставка', value: 'по адресу', tone: 'quiet' };
    case 'pending':
      return { label: 'Доставка', value: 'считаем…', tone: 'quiet' };
    case 'zone': {
      const cost = costFor(subtotal, state.quote.zone);
      return cost ? { label: 'Доставка', value: rub(cost), tone: 'money' } : { label: 'Доставка', value: 'бесплатно', tone: 'free' };
    }
    case 'unknown':
      return { label: 'Доставка', value: 'назовём при звонке', tone: 'quiet' };
  }
};

/** Что гость может сделать прямо из строки о доставке. */
export type StatusAction = 'pickup' | 'catalog' | 'call';

/**
 * What the line under the address says. `text` is the sentence, `money` the
 * part of it set in weight; `meta` quiet lines under it; `warn` a warning
 * with ways out (`actions`). `null` — nothing to say yet (the field's hint stays).
 * Что говорит строка под адресом. `text` — фраза, `money` — её часть, набранная
 * весом; `meta` — тихие строки под ней; `warn` — предупреждение с выходами
 * (`actions`). `null` — пока сказать нечего (остаётся подсказка поля).
 */
export type DeliveryStatus = {
  tone: 'zone' | 'free' | 'quiet' | 'warn' | 'pending';
  text?: string;
  money?: string;
  /** тихие строки под фразой: адрес на карте, сколько до бесплатной доставки */
  meta: string[];
  warn?: string;
  actions: StatusAction[];
};

/** «До бесплатной доставки — ещё 1 200 ₽» показываем, когда до порога рукой подать: от 60 % порога. */
const NEAR_FREE = 0.6;

export const statusFor = (state: DeliveryState, subtotal: number): DeliveryStatus | null => {
  switch (state.kind) {
    case 'pickup':
    case 'empty':
      return null;
    case 'pending':
      return { tone: 'pending', text: 'Считаем доставку…', meta: [], actions: [] };
    case 'zone': {
      const { zone, address } = state.quote;
      const cost = costFor(subtotal, zone);
      const where = !state.picked && address && !sameAddress(state.address, address) ? [`На карте: ${address}`] : [];
      const short = belowMin(subtotal, zone);
      const warn = short ? minOrderText(subtotal, zone) : undefined;
      const actions: StatusAction[] = short ? ['catalog', 'pickup'] : [];
      if (!cost) return { tone: 'free', text: 'Доставка бесплатно', money: 'бесплатно', meta: where, warn, actions };
      const left = zone.free_from - subtotal;
      const near = left > 0 && subtotal >= zone.free_from * NEAR_FREE ? [`До бесплатной доставки — ещё ${rub(left)}`] : [];
      return {
        tone: 'zone',
        text: `Доставка ${rub(cost)} · бесплатно от ${rub(zone.free_from)}`,
        money: rub(cost),
        meta: [...near, ...where],
        warn,
        actions,
      };
    }
    case 'unknown':
      if (state.why === 'outside')
        return { tone: 'warn', warn: 'Адрес вне зон доставки — выберите самовывоз или позвоните нам', meta: [], actions: ['pickup', 'call'] };
      if (state.why === 'notfound')
        return {
          tone: 'quiet',
          text: 'Адрес не нашли на карте — стоимость доставки назовём при звонке',
          meta: ['Проверьте дом или выберите адрес из подсказок'],
          actions: [],
        };
      if (state.why === 'error') return { tone: 'quiet', text: 'Не получилось посчитать доставку — назовём стоимость при звонке', meta: [], actions: [] };
      return { tone: 'quiet', text: 'Стоимость доставки назовём при звонке', meta: [], actions: [] };
  }
};

/** Короткая фраза для живой области: что изменилось с доставкой. */
export const announceFor = (state: DeliveryState, subtotal: number) => {
  const status = statusFor(state, subtotal);
  if (!status || status.tone === 'pending') return '';
  return [status.text, status.warn].filter(Boolean).join('. ');
};

/** Подпись подвала корзины до оформления: доставка считается по адресу. */
export const CART_NOTE = `Доставка считается по адресу при оформлении, бесплатно от ${rub(FREE_FROM)}`;
