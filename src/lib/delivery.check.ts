/**
 * Проверка доставки по зонам: адрес → запрос геокодеру, ответ Photon и
 * Nominatim → дома, точка → зона (на настоящих полигонах из
 * `src/data/delivery-zones.json`), стоимость, минимум, кэш геокодера и то, что
 * `order-guard` пишет в заказ. Сеть не нужна: ответы геокодеров — фикстуры
 * (сняты с photon.komoot.io и nominatim.openstreetmap.org 22.10.2026), `fetch`
 * подменён.
 * Запуск: `pnpm test` (Node читает TypeScript сам).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const geo = await import('../../directus/extensions/delivery/geo.js');
const { createGeocoder, geocoder, USER_AGENT } = await import('../../directus/extensions/delivery/photon.js');

type Row = Record<string, any>;
const rub = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n)} ₽`;
const seed: Row[] = JSON.parse(readFileSync(new URL('../data/delivery-zones.json', import.meta.url), 'utf8'));
const zones = geo.toZones(seed);

// ── адрес: нормализация и запрос ────────────────────────────────────────────
assert.equal(geo.normalizeAddress('  Самара,,  Советской   Армии ,177 '), 'самара, советской армии, 177');
assert.equal(geo.normalizeAddress('Ново-Садовая\n106.'), 'ново-садовая 106', 'перевод строки и точка в конце не мешают');
assert.equal(geo.normalizeAddress(null), '');
assert.equal(geo.normalizeAddress('д'.repeat(500)).length, geo.QUERY_MAX, 'длинная строка режется');
// город не назван — Самара; назван город, посёлок или «обл.» — как есть
assert.equal(geo.geocoderQuery('Советской Армии 177'), 'самара, советской армии 177');
assert.equal(geo.geocoderQuery('Новокуйбышевск, Победы, 1'), 'новокуйбышевск, победы, 1');
assert.equal(geo.geocoderQuery('г. Самара, Ленина 1'), 'г. самара, ленина 1');
assert.equal(geo.geocoderQuery('Смышляевка, Пионерская 1'), 'смышляевка, пионерская 1');
assert.equal(geo.geocoderQuery('пос. Мехзавод, 5 квартал, 2'), 'пос. мехзавод, 5 квартал, 2');
assert.equal(geo.geocoderQuery('Самарская 12'), 'самарская 12', 'улица Самарская — это уже Самара');
const photonUrl = new URL(geo.photonUrl('Советской Армии, 177'));
assert.equal(photonUrl.origin + photonUrl.pathname, 'https://photon.komoot.io/api/');
assert.equal(photonUrl.searchParams.get('q'), 'самара, советской армии, 177');
assert.equal(photonUrl.searchParams.get('bbox'), '49.7,52.9,50.7,53.6', 'рамка Самарской агломерации');
assert.equal(photonUrl.searchParams.get('layer'), 'house');
assert.equal(photonUrl.searchParams.get('lat'), '53.2');
const nominatimUrl = new URL(geo.nominatimUrl('Новокуйбышевск, Победы, 1'));
assert.equal(nominatimUrl.searchParams.get('format'), 'jsonv2');
assert.equal(nominatimUrl.searchParams.get('countrycodes'), 'ru');
assert.equal(nominatimUrl.searchParams.get('bounded'), '1');

// ── ответ Photon ────────────────────────────────────────────────────────────
const feature = (props: Row, lng: number, lat: number) => ({ type: 'Feature', properties: { countrycode: 'RU', country: 'Россия', state: 'Самарская область', ...props }, geometry: { type: 'Point', coordinates: [lng, lat] } });
const SA = { street: 'улица Советской Армии', district: 'Советский район', city: 'Самара', county: 'городской округ Самара', postcode: '443028' };
// «самара, советской армии, 177» — дом, магазин в нём же, улица без номера и тёзка в Армавире
const photonSA = {
  type: 'FeatureCollection',
  features: [
    feature({ osm_key: 'building', osm_value: 'apartments', type: 'house', housenumber: '177', ...SA }, 50.2023888, 53.2224594),
    feature({ osm_key: 'shop', osm_value: 'beverages', type: 'house', name: 'Пивная лавка', housenumber: '177', ...SA }, 50.2018924, 53.2227191),
    feature({ osm_key: 'highway', osm_value: 'secondary', type: 'street', name: 'улица Советской Армии', city: 'Самара' }, 50.2080812, 53.2165822),
    feature({ osm_key: 'building', osm_value: 'house', type: 'house', housenumber: '177', street: 'улица Советской Армии', city: 'Армавир' }, 41.10854, 44.9842),
    feature({ osm_key: 'building', osm_value: 'commercial', type: 'house', housenumber: '177А', ...SA }, 50.2031, 53.2231),
  ],
};
const housesSA = geo.parsePhoton(photonSA);
assert.deepEqual(
  housesSA.map((h: Row) => [h.label, h.city]),
  [
    ['улица Советской Армии, 177', 'Самара'],
    ['улица Советской Армии, 177А', 'Самара'],
  ],
  'Photon: только дома с номером, внутри рамки, магазин по тому же адресу — не второй дом',
);
assert.deepEqual([housesSA[0].lat, housesSA[0].lng], [53.2224594, 50.2023888]);
const photonNovo = {
  features: [
    feature({ osm_key: 'building', osm_value: 'apartments', type: 'house', housenumber: '1', street: 'проспект Победы', district: 'Заводской', city: 'Новокуйбышевск', county: 'городской округ Новокуйбышевск' }, 49.9657686, 53.0988533),
    feature({ osm_key: 'building', osm_value: 'yes', type: 'house', housenumber: '1Б', street: 'проспект Победы', city: 'Новокуйбышевск' }, 49.96319, 53.09968),
  ],
};
// посёлок: дом без улицы — подпись по населённому пункту; город — из `town` или `village`
const photonVillage = { features: [feature({ type: 'house', housenumber: '12', locality: 'Курумоч', village: 'Курумоч' }, 50.03, 53.48)] };
assert.deepEqual(geo.parsePhoton(photonVillage).map((h: Row) => [h.label, h.city]), [['Курумоч, 12', 'Курумоч']]);
for (const broken of [null, {}, { features: 'x' }, { features: [null, { geometry: null }, feature({ housenumber: '1', street: 'x' }, NaN, 53)] }])
  assert.deepEqual(geo.parsePhoton(broken), [], 'битый ответ — пусто, без исключения');

// ── ответ Nominatim (запасной) ───────────────────────────────────────────────
const nominatimSA = [
  {
    place_id: 200925393, osm_type: 'way', osm_id: 1257862554, lat: '53.2224594', lon: '50.2023888', category: 'building', type: 'apartments', addresstype: 'building', name: '',
    display_name: '177, улица Советской Армии, Советский район, Самара, городской округ Самара, Самарская область, Приволжский федеральный округ, 443028, Россия',
    address: { house_number: '177', road: 'улица Советской Армии', suburb: 'Советский район', city: 'Самара', county: 'городской округ Самара', state: 'Самарская область', postcode: '443028', country: 'Россия', country_code: 'ru' },
  },
  {
    place_id: 420281296, osm_type: 'node', lat: '53.2227191', lon: '50.2018924', category: 'shop', type: 'beverages', name: 'Пивная лавка',
    address: { shop: 'Пивная лавка', house_number: '177', road: 'улица Советской Армии', suburb: 'Советский район', city: 'Самара', country_code: 'ru' },
  },
];
assert.deepEqual(geo.parseNominatim(nominatimSA).map((h: Row) => [h.label, h.city, h.lat]), [['улица Советской Армии, 177', 'Самара', 53.2224594]]);
assert.deepEqual(geo.parseNominatim({ error: 'x' }), []);

// ── какой дом — набранный ────────────────────────────────────────────────────
const pick = (address: string, houses: Row[]) => geo.pickHouse(geo.normalizeAddress(address), houses)?.label ?? null;
assert.equal(pick('Советской Армии 177', housesSA), 'улица Советской Армии, 177');
assert.equal(pick('Советской Армии, 177А', housesSA), 'улица Советской Армии, 177А', 'литера — свой дом');
assert.equal(pick('советская армия 177 б', [housesSA[0]]), 'улица Советской Армии, 177', 'нет «177Б» — дом 177');
assert.equal(pick('Советской Армии', housesSA), null, 'без номера дома — не нашли');
assert.equal(pick('Советской Армии 17', housesSA), null, 'номера нет ни у одного дома — не нашли');
assert.equal(pick('Сов. Армии, 177', housesSA), 'улица Советской Армии, 177', 'сокращение улицы');
// мусор Photon превращает в похожую улицу: «самара, ываываыва 12» → «Самарская улица, 12»
const samarskaya = geo.parsePhoton({ features: [feature({ type: 'house', housenumber: '12', street: 'Самарская улица', city: 'Самара' }, 50.0973502, 53.1815743)] });
assert.equal(pick('ываываыва 12', samarskaya), null, 'выдуманная улица — не нашли, хоть Photon и ответил');
assert.equal(pick('Самара, ываываыва 12', samarskaya), null, 'город в адресе — не улица');
assert.equal(pick('Самарская 12', samarskaya), 'Самарская улица, 12');
const partsezd = geo.parsePhoton({
  features: [
    feature({ type: 'house', housenumber: '22', street: 'улица 22-го Партсъезда', city: 'Самара' }, 50.21, 53.22),
    feature({ type: 'house', housenumber: '10', street: 'улица 22-го Партсъезда', city: 'Самара' }, 50.205, 53.215),
  ],
});
assert.equal(pick('ул. 22 Партсъезда, 10', partsezd), 'улица 22-го Партсъезда, 10', 'число в названии улицы — не номер дома');
assert.equal(geo.matchesStreet('новосадовая 106', { street: 'Ново-Садовая улица' }), true, 'дефис не мешает');
assert.deepEqual(
  geo.suggestions(housesSA, 'совет').map((s: Row) => s.label),
  ['улица Советской Армии, 177', 'улица Советской Армии, 177А'],
);
assert.deepEqual(geo.suggestions(samarskaya, 'совет'), [], 'подсказка — только на набранной улице');
assert.deepEqual(Object.keys(geo.suggestions(housesSA)[0]).sort(), ['city', 'label', 'lat', 'lng'], 'подсказка по контракту: подпись, город, координаты');
const many = Array.from({ length: 9 }, (_, i) => ({ label: `улица Ленина, ${i + 1}`, city: 'Самара', street: 'улица Ленина', house: String(i + 1), lat: 53.2, lng: 50.1 }));
assert.equal(geo.suggestions(many, 'ленина').length, geo.SUGGEST_MAX, 'не больше шести подсказок');

// ── зоны: настоящие полигоны ────────────────────────────────────────────────
assert.deepEqual(
  zones.map((z: Row) => [z.id, z.price, z.free_from, z.min_order]),
  [
    [492128, 400, 7000, 1000],
    [492126, 600, 7000, 1000],
    [540164, 1000, 10000, 1000],
    [492131, 1000, 10000, 2500],
    [540159, 2500, 30000, 1000],
    [495935, 4000, 170000, 2500],
  ],
  'шесть зон из src/data/delivery-zones.json по порядку',
);
assert.ok(zones.every((z: Row) => z.name && z.polygon.length >= 3));
const zoneAt = (lng: number, lat: number) => geo.zoneFor([lng, lat], zones);
assert.equal(zoneAt(50.2023888, 53.2224594)?.price, 400, 'Самара, Советской Армии, 177 → 400 ₽');
assert.equal(zoneAt(50.2023888, 53.2224594)?.id, 492128);
assert.equal(zoneAt(49.9657686, 53.0988533)?.price, 4000, 'Новокуйбышевск, Победы, 1 → 4 000 ₽');
assert.equal(zoneAt(50.14899, 53.21717)?.id, 492126, 'Ново-Садовая, 106 → центр, 600 ₽');
assert.equal(zoneAt(49.42, 53.51), null, 'Тольятти — вне всех зон');
assert.equal(zoneAt(50.1664441, 53.1177455), null, 'точка внутри рамки, но вне всех полигонов');
// зоны 540164 (1 000 ₽) и 495935 (4 000 ₽) на настоящей карте заходят друг на друга
const both = [50.016, 53.088] as [number, number];
assert.deepEqual(zones.filter((z: Row) => geo.pointInPolygon(both, z.polygon)).map((z: Row) => z.id).sort(), [495935, 540164]);
assert.equal(geo.zoneFor(both, zones)?.id, 540164, 'на пересечении — зона с меньшей ценой');
// пересечение в чистом виде: порядок в списке не важен, при равной цене — выше в списке
const square = (x: number, y: number, size = 1) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
const cheap = { id: 2, name: 'Дешёвая', price: 300, free_from: null, min_order: 0, sort: 2, polygon: square(1, 1, 2) };
const dear = { id: 1, name: 'Дорогая', price: 900, free_from: null, min_order: 0, sort: 1, polygon: square(0, 0, 2) };
assert.equal(geo.zoneFor([1.5, 1.5], [dear, cheap])?.id, 2);
assert.equal(geo.zoneFor([1.5, 1.5], [cheap, dear])?.id, 2);
assert.equal(geo.zoneFor([0.5, 0.5], [cheap, dear])?.id, 1, 'вне дешёвой — дорогая');
assert.equal(geo.zoneFor([1.5, 1.5], [{ ...dear, price: 300 }, cheap])?.id, 1, 'равная цена — та, что выше в списке');
assert.equal(geo.pointInPolygon([5, 5], square(0, 0, 2)), false);

// строки коллекции → зоны: черновик выпадает, полигон строкой разбирается, битый — выпадает
const rows = geo.toZones([
  { id: 7, name: ' Тест ', price: '500', free_from: null, min_order: null, sort: 2, status: 'published', polygon: JSON.stringify(square(0, 0)) },
  { id: 8, name: 'Выключена', price: 100, status: 'draft', polygon: square(0, 0) },
  { id: 9, name: 'Без границы', price: 100, status: 'published', polygon: [[1, 2]] },
  { id: 10, name: 'GeoJSON', price: 200, free_from: 0, status: 'published', sort: 1, polygon: { type: 'Polygon', coordinates: [square(0, 0)] } },
]);
assert.deepEqual(rows.map((z: Row) => [z.id, z.name, z.price, z.free_from, z.min_order]), [[10, 'GeoJSON', 200, 0, 0], [7, 'Тест', 500, null, 0]]);
assert.deepEqual(geo.publicZone(rows[1]), { id: 7, name: 'Тест', price: 500, free_from: null, min_order: 0 }, 'сайту — без полигона');

// ── стоимость и минимум ─────────────────────────────────────────────────────
const near = zones[0];
assert.equal(geo.deliveryCost(near, 6999), 400);
assert.equal(geo.deliveryCost(near, 7000), 0, 'ровно 7 000 ₽ — уже бесплатно');
assert.equal(geo.deliveryCost(near, 12000), 0);
assert.equal(geo.deliveryCost({ price: 400, free_from: null }, 1_000_000), 400, 'пустое «бесплатно от» — бесплатно не бывает');
assert.equal(geo.deliveryCost({ price: 400, free_from: 0 }, 10), 0, '«бесплатно от 0» — всегда бесплатно');
const far = zones.find((z: Row) => z.id === 492131);
assert.equal(
  geo.minOrderError(far, 1800),
  `Минимальный заказ для доставки по этому адресу — ${rub(2500)}, в корзине ${rub(1800)}. Добавьте блюд или выберите самовывоз.`,
);
assert.equal(geo.minOrderError(far, 2500), null, 'ровно минимум — можно');
assert.equal(geo.minOrderError({ min_order: 0 }, 1), null);

// ── quote: адрес → зона ─────────────────────────────────────────────────────
{
  const asked: string[] = [];
  const answers: Record<string, unknown> = { 'советской армии 177': photonSA, 'новокуйбышевск, победы, 1': photonNovo };
  const geocode = async (text: string) => {
    asked.push(text);
    if (text === 'сбой 5') throw new Error('timeout');
    return geo.parsePhoton(answers[text] ?? { features: [] });
  };
  const sa = await geo.quote('Советской  Армии 177', { zones, geocode });
  assert.deepEqual(sa, {
    found: true,
    address: 'улица Советской Армии, 177, Самара',
    lat: 53.2224594,
    lng: 50.2023888,
    zone: { id: 492128, name: zones[0].name, price: 400, free_from: 7000, min_order: 1000 },
  });
  assert.equal(asked[0], 'советской армии 177', 'геокодер получает нормализованный адрес');
  assert.equal((await geo.quote('Новокуйбышевск, Победы, 1', { zones, geocode })).zone?.price, 4000);
  assert.deepEqual(await geo.quote('Нет такой улицы 5', { zones, geocode }), { found: false });
  const errors: unknown[] = [];
  assert.deepEqual(await geo.quote('сбой 5', { zones, geocode, log: (e: unknown) => errors.push(e) }), { found: false }, 'геокодер упал — не нашли, без исключения');
  assert.equal(errors.length, 1);
  // дом найден, но вне всех зон
  const away = await geo.quote('Советской Армии 177', { zones: [{ ...zones[0], polygon: square(0, 0) }], geocode });
  assert.deepEqual(away, { found: false, outside: true, address: 'улица Советской Армии, 177, Самара', lat: 53.2224594, lng: 50.2023888 });
  const before = asked.length;
  assert.deepEqual(await geo.quote('Советской Армии 177', { zones: [], geocode }), { found: false }, 'зон нет — геокодер не спрашиваем');
  assert.deepEqual(await geo.quote('аб', { zones, geocode }), { found: false });
  assert.equal(asked.length, before);
  // чужой город: сырой запрос без рамки отвечает Тольятти — «вне зон», а не улица Мира в Самаре
  const tolyatti = async () => ({ label: 'улица Мира, 1, Тольятти', lat: 53.51, lng: 49.39 });
  assert.deepEqual(
    await geo.quote('Тольятти, улица Мира, 1', { zones, geocode, geocodeRaw: tolyatti }),
    { found: false, outside: true, address: 'улица Мира, 1, Тольятти', lat: 53.51, lng: 49.39 },
    'другой город → вне зон',
  );
  const near = async () => ({ label: 'улица Советской Армии, 177, Самара', lat: 53.2224594, lng: 50.2023888 });
  assert.equal((await geo.quote('Советской Армии 177', { zones, geocode, geocodeRaw: near })).found, true, 'свой город — как обычно');
  const broken = async () => { throw new Error('photon 503'); };
  assert.equal((await geo.quote('Советской Армии 177', { zones, geocode, geocodeRaw: broken })).found, true, 'сырой запрос упал — решает обычный путь');
  assert.deepEqual(geo.topPlace({ features: [{ geometry: { coordinates: [49.39, 53.51] }, properties: { street: 'улица Мира', housenumber: '1', city: 'Тольятти' } }] }), { label: 'улица Мира, 1, Тольятти', lat: 53.51, lng: 49.39 });
  assert.equal(geo.topPlace({ features: [] }), null);
  assert.match(geo.photonRawUrl('Тольятти, улица Мира, 1'), /q=%D1%82%D0%BE%D0%BB%D1%8C%D1%8F%D1%82%D1%82%D0%B8/, 'сырой запрос без «самара,»');
  assert.doesNotMatch(geo.photonRawUrl('Тольятти, улица Мира, 1'), /bbox/, 'сырой запрос без рамки');
}

// ── геокодер: кэш, запасной Nominatim, заголовки ─────────────────────────────
{
  let clock = 1_000_000;
  const calls: { url: string; init: Row }[] = [];
  let photonDown = false;
  const fakeFetch = async (url: string, init: Row) => {
    calls.push({ url, init });
    const host = new URL(url).host;
    if (host === 'photon.komoot.io' && photonDown) return new Response('busy', { status: 503 });
    const body = host === 'photon.komoot.io' ? photonSA : nominatimSA;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const g = createGeocoder({ fetch: fakeFetch as typeof fetch, now: () => clock, max: 3, gapMs: 0 });
  const first = await g.locate('Самара, Советской Армии, 177');
  assert.equal(first[0].label, 'улица Советской Армии, 177');
  assert.equal(calls[0].init.headers['User-Agent'], USER_AGENT, 'User-Agent: vkus-com.ru (delivery)');
  assert.equal(USER_AGENT, 'vkus-com.ru (delivery)');
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'запрос с тайм-аутом');
  await g.locate('  самара,советской армии ,  177 ');
  await g.search('Самара, Советской Армии, 177');
  assert.equal(calls.length, 1, 'тот же адрес в другом написании, подсказки и расчёт — из одного кэша');
  // одновременные одинаковые запросы — один поход в Photon
  await Promise.all([g.search('ленина 1'), g.search('Ленина 1'), g.locate('ленина  1')]);
  assert.equal(calls.length, 2);
  // сутки — и запись устаревает
  clock += 24 * 60 * 60 * 1000 + 1;
  await g.search('ленина 1');
  assert.equal(calls.length, 3);
  // не больше `max` записей: самая старая уходит первой
  await g.search('адрес 1');
  await g.search('адрес 2');
  assert.equal(g.size(), 3);
  const n = calls.length;
  await g.search('ленина 1');
  assert.equal(calls.length, n, 'свежая запись — из кэша');
  await g.search('адрес 3');
  await g.search('ленина 1');
  assert.equal(calls.length, n + 2, 'вытесненная запись спрашивается заново');
  // Photon лежит: подсказок нет (исключение), расчёт идёт в Nominatim; ошибка не кэшируется
  photonDown = true;
  await assert.rejects(g.search('победы 1'), /503/);
  const fallback = await g.locate('победы 1');
  assert.equal(new URL(calls.at(-1)!.url).host, 'nominatim.openstreetmap.org', 'запасной геокодер — Nominatim');
  assert.equal(fallback[0].label, 'улица Советской Армии, 177');
  assert.equal(g.stats().fallbacks, 1);
  photonDown = false;
  const callsBefore = calls.length;
  await g.search('победы 1');
  assert.equal(calls.length, callsBefore + 1, 'после сбоя Photon спрашивается снова');
  // оба лежат — исключение, `quote` превратит его в «не нашли»
  const dead = createGeocoder({ fetch: (async () => new Response('', { status: 500 })) as typeof fetch, gapMs: 0 });
  await assert.rejects(dead.locate('ленина 1'), /Photon.*Nominatim/);
  assert.deepEqual(await geo.quote('Ленина 1', { zones, geocode: dead.locate }), { found: false });
  // Nominatim — не чаще раза в `gapMs` (на сервере — секунда): очередь длиннее `waitMaxMs` не ждём
  const nominatimAt: number[] = [];
  const slow = createGeocoder({
    fetch: (async (url: string) => {
      if (new URL(url).host === 'photon.komoot.io') return new Response('', { status: 503 });
      nominatimAt.push(Date.now());
      return new Response('[]');
    }) as typeof fetch,
    gapMs: 60,
    waitMaxMs: 130,
  });
  const queued = ['а 1', 'б 2', 'в 3', 'г 4'].map((q) => slow.locate(q).then(() => 'ok', () => 'skip'));
  assert.deepEqual(await Promise.all(queued), ['ok', 'ok', 'ok', 'skip'], 'четвёртый в очереди не ждёт дольше `waitMaxMs`');
  assert.ok(nominatimAt[1] - nominatimAt[0] >= 50 && nominatimAt[2] - nominatimAt[1] >= 50, 'между запросами к Nominatim — пауза');
}

// ── order-guard: что доставка пишет в заказ ─────────────────────────────────
{
  const fakeDb = (tables: Record<string, Row[]>) => (name: string) => {
    let list = [...(tables[name] ?? [])];
    const query = {
      where(match: Row) {
        list = list.filter((row) => Object.entries(match).every(([key, value]) => row[key] === value));
        return query;
      },
      whereIn(column: string, values: unknown[]) {
        list = list.filter((row) => values.includes(row[column]));
        return query;
      },
      select: async () => list,
      first: async () => list[0],
      pluck: async (column: string) => list.map((row) => row[column]),
    };
    return query;
  };
  const database = fakeDb({
    products: [
      { id: 5, title: 'Морс', price: 150, weight: '0,5 л', variants: [], fillings: [], available: true, status: 'published' },
      { id: 6, title: 'Торт', price: 3500, weight: '2 кг', variants: [], fillings: [], available: true, status: 'published' },
    ],
    orders: [],
    places: [{ id: 1 }],
    delivery_zones: seed,
  });
  // Photon в миниатюре: Самара, Новокуйбышевск, «вне зон» (Южный город) и ничего
  const southCity = { features: [feature({ type: 'house', housenumber: '2', street: 'Николаевский проспект', city: 'Южный Город' }, 50.1664441, 53.1177455)] };
  const realFetch = globalThis.fetch;
  let photonCalls = 0;
  globalThis.fetch = (async (url: string) => {
    photonCalls += 1;
    const q = new URL(url).searchParams.get('q') ?? '';
    const body = q.includes('советской армии') ? photonSA : q.includes('победы') ? photonNovo : q.includes('николаевский') ? southCity : { features: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    geocoder.clear();
    const filters: Record<string, (payload: Row, meta: Row, context: Row) => Promise<Row>> = {};
    const actions: Record<string, (meta: Row, context: Row) => Promise<void>> = {};
    const quiet = { warn: () => {}, error: () => {}, info: () => {} };
    const orderGuard = await import('../../directus/extensions/order-guard/index.js');
    orderGuard.default(
      { filter: (event: string, fn: any) => (filters[event] = fn), action: (event: string, fn: any) => (actions[event] = fn) },
      { services: {}, logger: quiet },
    );
    const base: Row = { customer_name: 'Анна', phone: '8 987 955 25 65', fulfillment: 'delivery', consent: true };
    let ip = 0;
    const send = (order: Row) => filters['orders.items.create']({ ...base, ...order }, {}, { accountability: { user: null, ip: `10.0.1.${(ip += 1)}` }, database });

    const small = await send({ address: 'Советской Армии 177', items: [{ product: 5, qty: 10 }] });
    assert.equal(small.total, 1500);
    assert.equal(small.delivery_zone, zones[0].name);
    assert.equal(small.delivery_cost, 400, 'сумма блюд ниже 7 000 ₽ — доставка 400 ₽');
    assert.equal(small.to_pay, 1900, 'к оплате = блюда + доставка');
    assert.equal(small.manager_note, null);

    const big = await send({ address: 'улица Советской Армии, 177, Самара', items: [{ product: 6, qty: 2 }] });
    assert.equal(big.total, 7000);
    assert.equal(big.delivery_cost, 0, 'от 7 000 ₽ — бесплатно');
    assert.equal(big.to_pay, 7000);

    await assert.rejects(
      send({ address: 'Новокуйбышевск, Победы, 1', items: [{ product: 5, qty: 12 }] }),
      (error: any) => error.status === 400 && error.message === `Минимальный заказ для доставки по этому адресу — ${rub(2500)}, в корзине ${rub(1800)}. Добавьте блюд или выберите самовывоз.`,
      'меньше минимума зоны — отказ с русским текстом',
    );
    const novo = await send({ address: 'Новокуйбышевск, Победы, 1', items: [{ product: 6, qty: 1 }] });
    assert.deepEqual([novo.delivery_cost, novo.to_pay], [4000, 7500]);

    const lost = await send({ address: 'Выдуманная улица, 5', items: [{ product: 5, qty: 2 }] });
    assert.deepEqual([lost.delivery_zone, lost.delivery_cost, lost.to_pay], [null, null, 300], 'не нашли — доставка при звонке, к оплате только блюда');
    assert.equal(lost.manager_note, orderGuard.NOTE_NOT_FOUND);
    const outside = await send({ address: 'Южный город, Николаевский проспект, 2', items: [{ product: 5, qty: 2 }] });
    assert.deepEqual([outside.delivery_cost, outside.manager_note], [null, orderGuard.NOTE_OUTSIDE]);

    const pickup = await send({ fulfillment: 'pickup', place: 1, address: 'Советской Армии 177', items: [{ product: 5, qty: 1 }] });
    assert.deepEqual([pickup.delivery_zone, pickup.delivery_cost, pickup.to_pay, pickup.address], [null, 0, 150, null], 'самовывоз — 0 ₽');

    // кэш общий с эндпоинтом: тот же адрес второй раз в Photon не идёт
    const calls = photonCalls;
    await send({ address: 'советской армии  177', items: [{ product: 5, qty: 10 }] });
    assert.equal(photonCalls, calls);

    // зоны в базе нет (схема не применена) — заказ как раньше: стоимость при звонке, без заметки
    const noZones = fakeDb({ products: [{ id: 5, title: 'Морс', price: 150, variants: [], fillings: [], available: true, status: 'published' }], orders: [] });
    const old = await filters['orders.items.create']({ ...base, address: 'Советской Армии 177', items: [{ product: 5, qty: 1 }] }, {}, { accountability: { user: null, ip: '10.0.2.1' }, database: noZones, schema: { collections: { orders: {} } } });
    assert.deepEqual([old.delivery_cost, old.to_pay, old.manager_note], [null, 150, null]);

    // уведомление менеджеру: «Доставка … · зона … · 400 ₽», «Итого (блюда)», «К оплате», тема — к оплате
    assert.equal(orderGuard.deliveryText({ zone: 'Центр', cost: 600 }), `зона «Центр» · ${rub(600)}`);
    assert.equal(orderGuard.deliveryText({ zone: 'Центр', cost: 0, freeFrom: 7000 }), `зона «Центр» · бесплатно (от ${rub(7000)})`);
    assert.equal(orderGuard.deliveryText({ zone: null, cost: null }), 'стоимость назвать при звонке');
    const sent: Row[] = [];
    class NotificationsService {
      async createOne(data: Row) {
        sent.push(data);
      }
    }
    const staff = fakeDb({ directus_roles: [{ id: 'r1', name: 'Administrator' }], directus_users: [{ id: 'u1', role: 'r1', status: 'active' }], delivery_zones: seed });
    const notify: Record<string, any> = {};
    orderGuard.default({ filter: () => {}, action: (event: string, fn: any) => (notify[event] = fn) }, { services: { NotificationsService }, logger: quiet });
    for (const [key, order] of [[1, big], [2, small], [3, lost]] as [number, Row][])
      await notify['orders.items.create']({ key, payload: { ...order, number: `2210-000${key}` } }, { database: staff, schema: {} });
    assert.equal(sent.length, 3);
    assert.match(sent[0].message, new RegExp(`Доставка: улица Советской Армии, 177, Самара · зона «${zones[0].name}» · бесплатно \\(от ${rub(7000)}\\)\\.`));
    assert.match(sent[1].message, new RegExp(`· зона «${zones[0].name}» · ${rub(400)}\\.`));
    assert.match(sent[1].message, new RegExp(`Итого \\(блюда\\): ${rub(1500)}\\nК оплате: \\*\\*${rub(1900)}\\*\\*`));
    assert.equal(sent[1].subject, `Новый заказ 2210-0002 · ${rub(1900)}`, 'тема — к оплате');
    assert.match(sent[2].message, /Доставка: Выдуманная улица, 5 · стоимость назвать при звонке\./);
    assert.match(sent[2].message, new RegExp(orderGuard.NOTE_NOT_FOUND));
  } finally {
    globalThis.fetch = realFetch;
    geocoder.clear();
  }
}

console.log('delivery: ok');
