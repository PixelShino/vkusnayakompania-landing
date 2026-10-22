/**
 * Delivery by zone, the pure part: the address as typed → the geocoder's
 * query, Photon's (and Nominatim's) answer → houses, a point → the zone it
 * falls in, the zone and the dishes → what the delivery costs and whether the
 * order is big enough. No Directus and no network here: `pnpm test` imports
 * this file (`src/lib/delivery.check.ts`), the `delivery` endpoint and the
 * `order-guard` hook import it from the container as is, without a build, so
 * the cart and the order count the same.
 * Доставка по зонам, чистая часть: адрес как набран → запрос геокодеру, ответ
 * Photon (и Nominatim) → дома, точка → зона, в которую она попала, зона и
 * блюда → сколько стоит доставка и хватает ли заказа. Здесь нет ни Directus,
 * ни сети: `pnpm test` импортирует файл (`src/lib/delivery.check.ts`), эндпоинт
 * `delivery` и хук `order-guard` берут его в контейнере как есть, без сборки,
 * поэтому корзина и заказ считают одинаково.
 */

// the Samara agglomeration: a house outside this box is a namesake street in another town
// Самарская агломерация: дом вне этой рамки — улица-тёзка в другом городе
export const AREA = { south: 52.9, north: 53.6, west: 49.7, east: 50.7 };
// Photon ranks results near this point first / Photon ставит выше результаты рядом с этой точкой
export const CENTER = { lat: 53.2, lng: 50.15 };
export const PHOTON_API = 'https://photon.komoot.io/api/';
export const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';
export const SUGGEST_MAX = 6;
export const QUERY_MAX = 200;
// Photon is asked for more than is shown: shops and offices at the same address take places
// у Photon просим больше, чем показываем: магазины и офисы по тому же адресу занимают места
const PHOTON_LIMIT = 15;

const rub = (n) => `${new Intl.NumberFormat('ru-RU').format(n)} ₽`;

// ── the address / адрес ──────────────────────────────────────────────────────

/**
 * «  Самара,,  Советской   Армии ,177 » → «самара, советской армии, 177»: lower
 * case, single spaces, one comma and a space between parts. The geocoder's
 * query and the cache key — so the cart's quote and the order's own check of
 * the same address meet in the cache.
 * Нижний регистр, одиночные пробелы, между частями одна запятая с пробелом.
 * Это и запрос геокодеру, и ключ кэша: расчёт корзины и проверка заказа по
 * тому же адресу встречаются в кэше.
 */
export const normalizeAddress = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .toLowerCase()
    .replace(/\s*,[\s,]*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, '')
    .slice(0, QUERY_MAX)
    .trim();

// a town of the zones or a word that names one; without it the query is a Samara street
// город из зон или слово, которое его называет; без него запрос — улица Самары
const PLACES = [
  'самар', 'новокуйбышевск', 'смышляевк', 'стройкерамик', 'кошелев', 'южный город', 'придорожн', 'николаевк',
  'царевщин', 'курумоч', 'петра дубрав', 'рощинск', 'черноречь', 'воскресенк', 'спиридоновк', 'преображенк',
];
const PLACE_WORDS = new Set(['г', 'город', 'обл', 'область', 'район', 'р-н', 'пос', 'поселок', 'посёлок', 'пгт', 'село', 'деревня', 'снт']);

/** Назван ли в адресе город или посёлок. */
export const hasPlace = (text) => {
  const clean = normalizeAddress(text);
  if (PLACES.some((stem) => new RegExp(`(^|[^а-яё])${stem}`).test(clean))) return true;
  return clean.split(/[^а-яёa-z0-9-]+/).some((word) => PLACE_WORDS.has(word));
};

/** Запрос геокодеру: адрес без города — «самара, …». */
export const geocoderQuery = (text) => {
  const clean = normalizeAddress(text);
  return clean && !hasPlace(clean) ? `самара, ${clean}` : clean;
};

export const photonUrl = (text) => {
  const params = new URLSearchParams({
    q: geocoderQuery(text),
    lang: 'default',
    limit: String(PHOTON_LIMIT),
    lat: String(CENTER.lat),
    lon: String(CENTER.lng),
    bbox: `${AREA.west},${AREA.south},${AREA.east},${AREA.north}`,
    layer: 'house',
  });
  return `${PHOTON_API}?${params}`;
};

/**
 * The same query as typed, no frame and no «самара,» in front: when the guest
 * named another town («Тольятти, улица Мира, 1»), Photon answers with that
 * town, and the frame would have swapped it for a Samara street of the same name.
 * Тот же запрос, как набран, без рамки и без «самара,» впереди: если гость
 * назвал другой город («Тольятти, улица Мира, 1»), Photon ответит этим
 * городом, а рамка подменила бы его одноимённой улицей Самары.
 */
export const photonRawUrl = (text) => {
  const params = new URLSearchParams({
    q: normalizeAddress(text),
    lang: 'default',
    limit: '3',
    lat: String(CENTER.lat),
    lon: String(CENTER.lng),
  });
  return `${PHOTON_API}?${params}`;
};

export const nominatimUrl = (text) => {
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '3',
    countrycodes: 'ru',
    addressdetails: '1',
    'accept-language': 'ru',
    viewbox: `${AREA.west},${AREA.north},${AREA.east},${AREA.south}`,
    bounded: '1',
    q: geocoderQuery(text),
  });
  return `${NOMINATIM_API}?${params}`;
};

// ── the geocoder's answer / ответ геокодера ──────────────────────────────────

export const inArea = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= AREA.south && lat <= AREA.north && lng >= AREA.west && lng <= AREA.east;

const clean = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * One house: «улица Советской Армии, 177» and its town. A result without a
 * house number is a street or a district — its zone is a guess, so it never
 * becomes a house.
 * Один дом: «улица Советской Армии, 177» и его город. Результат без номера
 * дома — улица или район, зона по нему — догадка, поэтому домом он не станет.
 */
const house = ({ street, house: number, city, lat, lng }) => {
  const base = clean(street);
  const no = clean(number);
  if (!base || !no || !inArea(lat, lng)) return null;
  return { label: `${base}, ${no}`, city: clean(city), lat, lng, street: base, house: no };
};

/** Дома без повторов: офисы и магазины по одному адресу — один дом, первый по рейтингу геокодера. */
const unique = (list) => {
  const seen = new Set();
  return list.filter((item) => {
    if (!item) return false;
    const key = `${item.label}|${item.city}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Photon (GeoJSON) → houses inside the area, best first.
 * Photon (GeoJSON) → дома внутри рамки, лучшие первыми.
 * @param {any} json
 */
export const parsePhoton = (json) =>
  unique(
    (Array.isArray(json?.features) ? json.features : []).map((feature) => {
      const p = feature?.properties ?? {};
      const [lng, lat] = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates.map(Number) : [];
      return house({
        // a village house may have no street, only its place
        // у дома в посёлке может не быть улицы, только населённый пункт
        street: p.street || p.locality,
        house: p.housenumber,
        city: p.city || p.town || p.village || p.locality || p.county,
        lat,
        lng,
      });
    }),
  );

/**
 * The geocoder's best guess wherever it is: `{ label, lat, lng }` of the first
 * feature with coordinates, or `null`. Used to notice a foreign town.
 * Лучшая догадка геокодера, где бы она ни была: `{ label, lat, lng }` первого
 * результата с координатами или `null`. Нужна, чтобы заметить чужой город.
 * @param {any} json
 */
export const topPlace = (json) => {
  for (const feature of Array.isArray(json?.features) ? json.features : []) {
    const p = feature?.properties ?? {};
    const [lng, lat] = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates.map(Number) : [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const street = clean(p.street || p.locality || p.name);
    const no = clean(p.housenumber);
    const town = clean(p.city || p.town || p.village || p.locality || p.county);
    const label = [street && no ? `${street}, ${no}` : street, town].filter(Boolean).join(', ');
    return { label: label || 'адрес', lat, lng };
  }
  return null;
};

/**
 * Nominatim (`format=jsonv2&addressdetails=1`) → houses, the same shape as Photon's.
 * Nominatim → дома в том же виде, что у Photon.
 * @param {any} json
 */
export const parseNominatim = (json) =>
  unique(
    (Array.isArray(json) ? json : []).map((item) => {
      const a = item?.address ?? {};
      return house({
        street: a.road || a.pedestrian || a.hamlet,
        house: a.house_number,
        city: a.city || a.town || a.village || a.hamlet || a.county,
        lat: Number(item?.lat),
        lng: Number(item?.lon),
      });
    }),
  );

// words that name the kind of street or the town, not the street itself
// слова, которые называют тип улицы или город, а не саму улицу
const STREET_TYPES = new Set([
  'улица', 'ул', 'проспект', 'просп', 'прт', 'проезд', 'прд', 'переулок', 'пер', 'шоссе', 'бульвар', 'бр', 'площадь', 'пл',
  'набережная', 'наб', 'тупик', 'аллея', 'линия', 'квартал', 'квл', 'микрорайон', 'мкр', 'территория', 'тер', 'просека',
  'спуск', 'дорога', 'въезд', 'массив', 'снт', 'станция', 'дом', 'корпус', 'корп', 'строение', 'стр', 'кв', 'квартира',
  'подъезд', 'этаж',
]);
const TOWN_NAMES = new Set([
  'самара', 'новокуйбышевск', 'смышляевка', 'стройкерамика', 'кошелевпарк', 'придорожный', 'николаевка', 'царевщина',
  'курумоч', 'рощинский', 'черноречье', 'воскресенка', 'спиридоновка', 'преображенка', 'город', 'область', 'обл', 'район',
  'поселок', 'село', 'деревня', 'россия',
]);
const wordsOf = (text) =>
  normalizeAddress(text)
    .replace(/ё/g, 'е')
    .replace(/-/g, '')
    .split(/[^а-яa-z0-9]+/)
    .filter((word) => word.length >= 3 && !/^\d/.test(word) && !STREET_TYPES.has(word) && !TOWN_NAMES.has(word));
const sharedStart = (a, b) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
};

/**
 * Is the geocoder's house on the street the guest typed: one word of the
 * street (without «улица», «проспект»…) starts like a word of the address —
 * «Советской Армии» and «советская армия 177», «Ново-Садовая» and
 * «новосадовая». Photon answers garbage with the nearest likeness (the city
 * «Самара» becomes «Самарская улица»); that answer is no address.
 * Стоит ли дом геокодера на той улице, что набрал гость: одно слово улицы (без
 * «улица», «проспект»…) начинается так же, как слово адреса. На мусор Photon
 * отвечает ближайшим похожим (город «Самара» превращается в «Самарскую
 * улицу»); такой ответ — не адрес.
 */
export const matchesStreet = (address, item) => {
  const typed = wordsOf(address);
  const street = wordsOf(item?.street ?? '');
  return typed.some((a) => street.some((b) => sharedStart(a, b) >= Math.min(4, a.length, b.length)));
};

/**
 * Подсказки для сайта: до шести домов на набранной улице — подпись, город, координаты.
 * @param {any[]} houses
 * @param {string | null} [typed] что набрал гость; без него — все дома
 */
export const suggestions = (houses, typed = null) =>
  (Array.isArray(houses) ? houses : [])
    .filter((item) => typed === null || matchesStreet(typed, item))
    .slice(0, SUGGEST_MAX)
    .map(({ label, city, lat, lng }) => ({ label, city, lat, lng }));

/** «улица Советской Армии, 177, Самара» — адрес, как его понял геокодер. */
export const addressLine = (item) => (item.city ? `${item.label}, ${item.city}` : item.label);

const numbersOf = (text) => [...String(text).matchAll(/(?<!\d)(\d+)(?!\d)/g)].map((m) => m[1]);
const squeeze = (text) => String(text).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '');
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Which of the geocoder's houses is the one typed: it stands on the typed
 * street and its number is in the address («177» — «177»; «212Б» — the house
 * «212Б», failing that «212»). An address without a number, or with one no
 * house has, finds nothing — a neighbour's zone is not the guest's zone.
 * Какой из домов геокодера — набранный: он на набранной улице, и его номер есть
 * в адресе («177» — «177»; «212Б» — дом «212Б», а нет его — «212»). Адрес без
 * номера или с номером, которого нет ни у одного дома, не находит ничего: зона
 * соседа — не зона гостя.
 */
export const pickHouse = (address, houses) => {
  const list = (Array.isArray(houses) ? houses : []).filter((item) => matchesStreet(address, item));
  const numbers = new Set(numbersOf(address));
  if (!numbers.size) return null;
  const flat = squeeze(address);
  const lead = (item) => /^\d+/.exec(item.house)?.[0] ?? null;
  const exact = list.find(
    (item) => numbers.has(lead(item)) && new RegExp(`(?<![0-9])${escapeRe(squeeze(item.house))}(?![0-9a-zа-я])`).test(flat),
  );
  return exact ?? list.find((item) => numbers.has(lead(item))) ?? null;
};

// ── zones / зоны ─────────────────────────────────────────────────────────────

const whole = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** `[[lng, lat], …]` или GeoJSON Polygon → не меньше трёх точек `[lng, lat]`; иначе `null`. */
export const toRing = (raw) => {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value && !Array.isArray(value) && value.type === 'Polygon') value = value.coordinates?.[0];
  if (!Array.isArray(value)) return null;
  const ring = value.map((point) => (Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [NaN, NaN]));
  return ring.length >= 3 && ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)) ? ring : null;
};

/**
 * Rows of `delivery_zones` → zones in force: published, with a name and a
 * polygon. An empty «бесплатно от» is «never free»; an empty minimum — none.
 * Строки `delivery_zones` → действующие зоны: опубликованные, с именем и
 * полигоном. Пустое «бесплатно от» — бесплатно не бывает; пустой минимум — без минимума.
 */
export const toZones = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .filter((row) => row && (row.status ?? 'published') === 'published')
    .map((row) => ({
      id: row.id,
      name: clean(row.name),
      price: whole(row.price) ?? 0,
      free_from: whole(row.free_from),
      min_order: whole(row.min_order) ?? 0,
      sort: Number.isFinite(Number(row.sort)) && row.sort !== null ? Number(row.sort) : 0,
      polygon: toRing(row.polygon),
    }))
    .filter((zone) => zone.name && zone.polygon)
    .sort((a, b) => a.sort - b.sort || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));

/** Что видит сайт: без полигона. */
export const publicZone = ({ id, name, price, free_from, min_order }) => ({ id, name, price, free_from, min_order });

/**
 * Ray casting: is `[lng, lat]` inside the ring. A point exactly on an edge
 * may go either way — zones touch, and the cheaper one wins anyway.
 * Луч: лежит ли `[lng, lat]` внутри кольца. Точка ровно на границе может уйти
 * в любую сторону — зоны соприкасаются, и всё равно побеждает дешёвая.
 */
export const pointInPolygon = ([lng, lat], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Зона точки: из всех, куда она попала, — с самой дешёвой доставкой (при равной — выше в списке). */
export const zoneFor = (point, zones) =>
  (Array.isArray(zones) ? zones : [])
    .filter((zone) => zone.polygon && pointInPolygon(point, zone.polygon))
    .sort((a, b) => a.price - b.price || a.sort - b.sort)[0] ?? null;

/**
 * What the delivery costs: free from the zone's threshold, counted on the
 * dishes before the discount and the points (`orders.total`).
 * Сколько стоит доставка: бесплатно от порога зоны, считая блюда до скидки и
 * баллов (`orders.total`).
 */
export const deliveryCost = (zone, subtotal) =>
  zone.free_from !== null && zone.free_from !== undefined && Number(subtotal) >= zone.free_from ? 0 : zone.price;

/** Отказ, если блюд меньше минимального заказа зоны; иначе `null`. */
export const minOrderError = (zone, subtotal) =>
  zone.min_order > 0 && Number(subtotal) < zone.min_order
    ? `Минимальный заказ для доставки по этому адресу — ${rub(zone.min_order)}, в корзине ${rub(Number(subtotal) || 0)}. Добавьте блюд или выберите самовывоз.`
    : null;

/**
 * The address → the zone. `geocode(text)` gives the houses (Photon, its cache,
 * Nominatim when Photon is down); a geocoder that failed is «not found» — the
 * order is never lost to it.
 * Адрес → зона. `geocode(text)` даёт дома (Photon, его кэш, Nominatim, когда
 * Photon лежит); упавший геокодер — это «не найден»: заказ из-за него не теряется.
 *
 * `geocodeRaw(text)`, when given, is the query as typed with no frame: its best
 * guess outside the area means the guest named another town — «outside», not
 * a Samara street of the same name.
 * `geocodeRaw(text)`, если передан, — запрос как набран, без рамки: его лучшая
 * догадка вне области значит, что гость назвал другой город — «вне зон», а не
 * одноимённая улица Самары.
 *
 * @param {string} address
 * @param {{ zones: Array<Record<string, any>>, geocode: (text: string) => Promise<any[]>,
 *   geocodeRaw?: (text: string) => Promise<{ label: string, lat: number, lng: number } | null>, log?: (error: any) => void }} deps
 * @returns {Promise<{ found: boolean, outside?: boolean, address?: string, lat?: number, lng?: number, zone?: Record<string, any> }>}
 */
export const quote = async (address, { zones, geocode, geocodeRaw = null, log = () => {} }) => {
  const text = normalizeAddress(address);
  if (text.length < 3 || !Array.isArray(zones) || !zones.length) return { found: false };
  if (geocodeRaw) {
    // a failed raw query is no verdict: the usual path decides
    // упавший сырой запрос — не вердикт: решает обычный путь
    const top = await geocodeRaw(text).catch((error) => (log(error), null));
    if (top && !inArea(top.lat, top.lng)) return { found: false, outside: true, address: top.label, lat: top.lat, lng: top.lng };
  }
  let houses;
  try {
    houses = await geocode(text);
  } catch (error) {
    log(error);
    return { found: false };
  }
  const hit = pickHouse(text, houses);
  if (!hit) return { found: false };
  const where = { address: addressLine(hit), lat: hit.lat, lng: hit.lng };
  const zone = zoneFor([hit.lng, hit.lat], zones);
  return zone ? { found: true, ...where, zone: publicZone(zone) } : { found: false, outside: true, ...where };
};
