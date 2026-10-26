/**
 * Проверка клиентской части доставки по зонам: стоимость и минимум зоны,
 * «К оплате», разбор ответов `/delivery/suggest` и `/delivery/quote`, слова
 * строки под адресом и счёта корзины — ровно те, что в
 * `DESIGN-delivery.md`. Правило стоимости то же, что у `order-guard`:
 * `subtotal >= free_from ? 0 : price` по сумме блюд до скидки и баллов.
 * Запуск: `node src/lib/delivery-client.check.ts` (Node читает TypeScript сам).
 */
import assert from 'node:assert/strict';
import * as d from './delivery.ts';
import { addressLine, aptPart, buildOrder, splitDetails, validate, type CheckoutForm } from './order.ts';

const NB = ' ';
const near: d.Zone = { id: 492128, name: 'Рядом с нами — Советский, Промышленный, Октябрьский', price: 400, free_from: 7000, min_order: 1000 };
const nk: d.Zone = { id: 495935, name: 'Новокуйбышевск', price: 4000, free_from: 170000, min_order: 2500 };
const found = (zone: d.Zone, address = 'улица Советской Армии, 177, Самара'): d.QuoteFound => ({ found: true, address, lat: 53.22, lng: 50.2, zone });
const zoneState = (zone: d.Zone, picked = true): d.DeliveryState => ({ kind: 'zone', address: 'улица Советской Армии, 177', quote: found(zone), picked });

// ── стоимость и минимум ─────────────────────────────────────────────────────
assert.equal(d.costFor(1800, near), 400);
assert.equal(d.costFor(6999, near), 400, 'на рубль меньше порога — платно');
assert.equal(d.costFor(7000, near), 0, 'порог включительно: ровно 7 000 ₽ — бесплатно');
assert.equal(d.costFor(1800, nk), 4000);
assert.equal(d.belowMin(999, near), true);
assert.equal(d.belowMin(1000, near), false, 'минимум включительно');
assert.equal(d.belowMin(1800, nk), true);
assert.equal(d.minOrderText(1800, nk), `Минимальный заказ для доставки по этому адресу — 2${NB}500${NB}₽, в${NB}корзине 1${NB}800${NB}₽`);
assert.equal(d.shortText(700), `Доберите ещё 700${NB}₽ — или выберите самовывоз`);

// ── доставка для суммы по состояниям ────────────────────────────────────────
assert.equal(d.deliveryCost({ kind: 'pickup' }, 1800), 0, 'самовывоз — 0');
assert.equal(d.deliveryCost({ kind: 'empty' }, 1800), null);
assert.equal(d.deliveryCost({ kind: 'pending', address: 'x' }, 1800), null);
assert.equal(d.deliveryCost({ kind: 'unknown', address: 'Ленина 1', why: 'notfound' }, 1800), null, 'не нашли — назовём при звонке');
assert.equal(d.deliveryCost({ kind: 'unknown', address: 'Тольятти', why: 'outside' }, 1800), null);
assert.equal(d.deliveryCost(zoneState(near), 1800), 400);
assert.equal(d.deliveryCost(zoneState(near), 7200), 0);

assert.equal(d.blocksOrder(zoneState(nk), 1800), true, 'минимум зоны не добран — отправка закрыта');
assert.equal(d.blocksOrder(zoneState(nk), 2500), false);
assert.equal(d.blocksOrder({ kind: 'pickup' }, 100), false, 'самовывоз снимает запрет');
assert.equal(d.blocksOrder({ kind: 'unknown', address: 'x', why: 'outside' }, 100), false, 'вне зон — отправить можно, менеджер позвонит');
assert.equal(d.shortOfMin(zoneState(nk), 1800), 700);
assert.equal(d.shortOfMin(zoneState(near), 1800), 0);

// ── к оплате = блюда − скидка − баллы + доставка ────────────────────────────
assert.equal(d.payable({ dishes: 1800, delivery: 400 }), 2200);
assert.equal(d.payable({ dishes: 2400, discount: 240, points: 100, delivery: 400 }), 2460);
assert.equal(d.payable({ dishes: 2400, discount: 240, points: 100, delivery: null }), 2060, 'неизвестная доставка в сумму не входит');
assert.equal(d.payable({ dishes: 2400, delivery: 0 }), 2400);
assert.equal(d.payable({ dishes: 300, points: 500, delivery: 400 }), 400, 'баллы не уводят блюда ниже нуля и не трогают доставку');

// ── разбор ответов API ──────────────────────────────────────────────────────
assert.deepEqual(d.parseQuote({ found: true, address: 'улица Советской Армии, 177, Самара', lat: 53.22246, lng: 50.20239, zone: near }), {
  found: true,
  address: 'улица Советской Армии, 177, Самара',
  lat: 53.22246,
  lng: 50.20239,
  zone: near,
});
assert.deepEqual(d.parseQuote({ found: false }), { found: false, outside: false });
assert.deepEqual(d.parseQuote({ found: false, outside: true }), { found: false, outside: true });
assert.deepEqual(d.parseQuote(null), { found: false, outside: false }, 'битый ответ — не нашли');
assert.deepEqual(d.parseQuote({ found: true, zone: { id: 1, name: 'x', price: 'дорого', free_from: 7000 } }), { found: false, outside: false }, 'зона без цены — не нашли, а не 0 ₽');
assert.equal(d.parseZone({ id: 1, name: ' Центр ', price: '600', free_from: 7000, min_order: null })?.min_order, 0, 'пустой минимум — без минимума');
assert.equal(d.parseZone({ id: 1, name: 'x', price: -1, free_from: 7000 }), null);

const items = d.parseSuggestions({
  items: [
    { label: 'улица Советской Армии, 177', city: 'Самара', lat: 53.22246, lng: 50.20239 },
    { label: 'улица Советской Армии, 177', city: 'Самара', lat: 53.22246, lng: 50.20239 },
    { label: '  ', city: 'Самара' },
    null,
    { label: 'улица Победы, 1', city: 'Новокуйбышевск', lat: 53.0995, lng: 49.9478 },
    ...Array.from({ length: 10 }, (_, i) => ({ label: `улица Ленина, ${i + 2}`, city: 'Самара', lat: 53, lng: 50 })),
  ],
});
assert.equal(items.length, d.SUGGEST_MAX, 'не больше шести');
assert.equal(items[0].label, 'улица Советской Армии, 177');
assert.equal(items[1].city, 'Новокуйбышевск', 'повтор и пустая подпись выпали');
assert.deepEqual(d.parseSuggestions({}), []);
assert.deepEqual(d.parseSuggestions('<html>'), []);

// ── адрес из подсказки ──────────────────────────────────────────────────────
assert.equal(d.addressOf({ label: 'улица Советской Армии, 177', city: 'Самара' }), 'улица Советской Армии, 177', 'в Самаре — «улица, дом»');
assert.equal(d.addressOf({ label: 'улица Победы, 1', city: 'Новокуйбышевск' }), 'Новокуйбышевск, улица Победы, 1', 'другой город — впереди, иначе сервер искал бы в Самаре');
assert.equal(d.addressOf({ label: 'Новокуйбышевск, улица Победы, 1', city: 'Новокуйбышевск' }), 'Новокуйбышевск, улица Победы, 1', 'город дважды не пишется');
assert.equal(d.normalizeAddress('  Улица  Советской   Армии, 177 '), 'улица советской армии, 177');
assert.equal(d.normalizeAddress('Пролетарская, 1Ё'), 'пролетарская, 1е');
assert.equal(d.canSuggest('со'), false);
assert.equal(d.canSuggest('сов'), true);
assert.equal(d.canQuote('Сов 1'), true);
assert.equal(d.canQuote('Ле 1'), false, 'как validate(): не короче пяти знаков');
assert.equal(d.hasHouse('Советской Армии'), false);
assert.equal(d.hasHouse('Советской Армии 17'), true);

// ── слова под адресом (тексты ТЗ) ───────────────────────────────────────────
const s400 = d.statusFor(zoneState(near), 1800)!;
assert.equal(s400.text, `Доставка 400${NB}₽ · бесплатно от 7${NB}000${NB}₽`);
assert.equal(s400.money, `400${NB}₽`);
assert.deepEqual(s400.meta, [], 'далеко до порога и адрес из подсказки — тихих строк нет');
assert.equal(s400.warn, undefined);
assert.deepEqual(d.statusFor(zoneState(near), 5800)!.meta, [`До бесплатной доставки — ещё 1${NB}200${NB}₽`], 'до порога рукой подать');
assert.deepEqual(
  d.statusFor({ kind: 'zone', address: 'Сов Армии 177', quote: found(near), picked: false }, 1800)!.meta,
  ['На карте: улица Советской Армии, 177, Самара'],
  'набранный адрес — как его понял поиск',
);
assert.deepEqual(d.statusFor({ kind: 'zone', address: 'Советской Армии 177', quote: found(near), picked: false }, 1800)!.meta, [], 'понят как написан — не повторять');
assert.equal(d.sameAddress('улица Советской Армии, 177', 'улица Советской Армии, 177, Самара'), true);
assert.equal(d.sameAddress('Победы 1', 'улица Победы, 1, Новокуйбышевск'), false, 'другой город — это новость');
assert.equal(d.statusFor(zoneState(near), 7000)!.text, 'Доставка бесплатно');
assert.equal(d.statusFor(zoneState(near), 7000)!.tone, 'free');

const short = d.statusFor(zoneState(nk), 1800)!;
assert.equal(short.text, `Доставка 4${NB}000${NB}₽ · бесплатно от 170${NB}000${NB}₽`);
assert.equal(short.warn, `Минимальный заказ для доставки по этому адресу — 2${NB}500${NB}₽, в${NB}корзине 1${NB}800${NB}₽`);
assert.deepEqual(short.actions, ['catalog', 'pickup']);

assert.equal(
  d.statusFor({ kind: 'unknown', address: 'Ленина 1', why: 'notfound' }, 1800)!.text,
  'Адрес не нашли на карте — стоимость доставки назовём при звонке',
);
const outside = d.statusFor({ kind: 'unknown', address: 'Тольятти', why: 'outside' }, 1800)!;
assert.equal(outside.warn, 'Адрес вне зон доставки — выберите самовывоз или позвоните нам');
assert.deepEqual(outside.actions, ['pickup', 'call']);
assert.equal(d.statusFor({ kind: 'unknown', address: 'x', why: 'error' }, 1800)!.text, 'Не получилось посчитать доставку — назовём стоимость при звонке');
assert.equal(d.statusFor({ kind: 'pending', address: 'x' }, 1800)!.text, 'Считаем доставку…');
assert.equal(d.statusFor({ kind: 'empty' }, 1800), null, 'без адреса — подсказка поля');
assert.equal(d.statusFor({ kind: 'pickup' }, 1800), null);
assert.equal(d.announceFor({ kind: 'pending', address: 'x' }, 1800), '', '«считаем» не объявляется');
assert.equal(d.announceFor(zoneState(nk), 1800), `${short.text}. ${short.warn}`);

// ── строка «Доставка» в счёте ───────────────────────────────────────────────
assert.deepEqual(d.billRow(zoneState(near), 1800), { label: 'Доставка', value: `400${NB}₽`, tone: 'money' });
assert.deepEqual(d.billRow(zoneState(near), 9000), { label: 'Доставка', value: 'бесплатно', tone: 'free' });
assert.deepEqual(d.billRow({ kind: 'unknown', address: 'x', why: 'notfound' }, 1800), { label: 'Доставка', value: 'назовём при звонке', tone: 'quiet' });
assert.deepEqual(d.billRow({ kind: 'pickup' }, 1800), { label: 'Самовывоз', value: `0${NB}₽`, tone: 'money' });
assert.equal(d.billRow({ kind: 'empty' }, 1800).value, 'по адресу');
assert.equal(d.billRow({ kind: 'pending', address: 'x' }, 1800).value, 'считаем…');

assert.equal(d.stateFromQuote('Ленина 1', { found: false, outside: false }).kind, 'unknown');
assert.deepEqual(d.stateFromQuote('Тольятти', { found: false, outside: true }), { kind: 'unknown', address: 'Тольятти', why: 'outside' });

assert.equal(d.CART_NOTE, `Доставка считается по адресу при оформлении, бесплатно от 7${NB}000${NB}₽`);

// ── адрес по пунктам: улица и дом отдельно от квартиры, подъезда, этажа, домофона ──
assert.equal(d.hasAptWords('Самара, проспект Карла Маркса 165Б, кв 12'), true, 'квартира в строке улицы — подсказка про поля ниже');
assert.equal(d.hasAptWords('Советской Армии, 177, подъезд 2'), true);
assert.equal(d.hasAptWords('Советской Армии, 177'), false);
assert.equal(d.hasAptWords('Квартальная, 5'), false, '«кв» внутри названия улицы — не квартира');

assert.equal(aptPart('flat', ' кв. 12 '), '12', 'подпись поля, набранная по привычке, не повторяется');
assert.equal(aptPart('flat', 'офис 305'), 'офис 305', 'офис остаётся офисом');
assert.equal(aptPart('entrance', '2 подъезд'), '2');
assert.equal(aptPart('floor', '5-й этаж'), '5');
assert.equal(aptPart('intercom', 'код домофона 12К'), '12К');
assert.equal(aptPart('flat', '   '), null, 'пустое — null');
assert.equal(aptPart('entrance', '1234567890123'), '1234567890', 'не длиннее предела поля');

const line = { address: 'улица Советской Армии, 177', address_flat: '12', address_entrance: '2', address_floor: '5', address_intercom: '12К' };
assert.equal(addressLine(line), `улица Советской Армии, 177, кв.${NB}12, подъезд${NB}2, этаж${NB}5, домофон${NB}12К`);
assert.equal(addressLine({ address: 'улица Советской Армии, 177', address_flat: 'офис 3' }), 'улица Советской Армии, 177, офис 3');
assert.equal(addressLine({ address: 'Садовая, 212Б', address_flat: null }), 'Садовая, 212Б', 'частный дом — только улица и дом');

// старый черновик с одной строкой «Квартира, подъезд, этаж»
assert.deepEqual(splitDetails('кв. 5, подъезд 2, этаж 3, домофон 5К'), { flat: '5', entrance: '2', floor: '3', intercom: '5К', rest: '' });
assert.deepEqual(splitDetails('кв 45 3 подъезд 7 этаж'), { flat: '45', entrance: '3', floor: '7', intercom: '', rest: '' });
assert.deepEqual(splitDetails('кв 5 подъезд 2 этаж 3'), { flat: '5', entrance: '2', floor: '3', intercom: '', rest: '' });
assert.deepEqual(splitDetails('12'), { flat: '12', entrance: '', floor: '', intercom: '', rest: '' }, 'голое число — квартира');
assert.deepEqual(splitDetails('клиники мед, у входа справа'), { flat: '', entrance: '', floor: '', intercom: '', rest: 'клиники мед, у входа справа' }, 'слова — в комментарий');

// заказ: четыре поля уходят отдельно, у самовывоза — null, старого `address_details` нет
const checkout: CheckoutForm = {
  name: 'Анна',
  phone: '9879552565',
  fulfillment: 'delivery',
  address: 'улица Советской Армии, 177',
  flat: 'кв 12',
  entrance: '2',
  floor: '',
  intercom: '12К',
  when: 'asap',
  consent: true,
};
const sent = buildOrder({ v: 1, lines: [] }, new Map(), checkout, '2310-1000');
assert.deepEqual(
  [sent.address, sent.address_flat, sent.address_entrance, sent.address_floor, sent.address_intercom],
  ['улица Советской Армии, 177', '12', '2', null, '12К'],
);
assert.ok(!('address_details' in sent), 'address_details сайт больше не шлёт');
const taken = buildOrder({ v: 1, lines: [] }, new Map(), { ...checkout, fulfillment: 'pickup', place: 1 }, '2310-1001');
assert.deepEqual([taken.address, taken.address_flat, taken.address_entrance, taken.address_floor, taken.address_intercom], [null, null, null, null, null]);
assert.equal(validate({ ...checkout, address: '' }).address, 'Укажите улицу и дом, куда привезти');
assert.equal(validate({ ...checkout, flat: '', entrance: '', floor: '', intercom: '' }).address, undefined, 'квартира и остальное — необязательны');

// ── точка, «В зале» и почта для чека (26.10.2026) ──────────────────────────
// the venue, «В зале» and the mail for the receipt (26.10.2026)
{
  const order = await import('./order.ts');
  const { priced } = await import('./cart.ts');
  const venue = await import('./venue.ts');
  const { runInNewContext } = await import('node:vm');
  const base: CheckoutForm = { name: 'Анна', phone: '9879552565', fulfillment: 'delivery', address: 'Садовая, 212Б', when: 'asap', consent: true };

  // способ: зал — третий, незнакомое значение радио — доставка
  assert.equal(order.fulfillmentOf('dine_in'), 'dine_in');
  assert.equal(order.fulfillmentOf('pickup'), 'pickup');
  assert.equal(order.fulfillmentOf('teleport'), 'delivery');

  // точка: самовывозу — «откуда», залу — «где сидите», доставке не обязательна
  assert.equal(validate({ ...base, fulfillment: 'pickup' }).place, 'Выберите, откуда заберёте');
  assert.equal(validate({ ...base, fulfillment: 'dine_in' }).place, 'Выберите, где вы сидите');
  assert.equal(validate({ ...base, fulfillment: 'dine_in', place: 2 }).place, undefined);
  assert.equal(validate({ ...base, fulfillment: 'dine_in', place: 2, address: '' }).address, undefined, 'в зале адрес не нужен');
  assert.equal(validate(base).place, undefined, 'доставке точку выбирает каталог, форма её не требует');

  // почта: при онлайн-оплате обязательна, без онлайн-оплаты — как раньше
  assert.equal(validate({ ...base, payment: 'online' }).email, order.EMAIL_NEEDED);
  assert.equal(validate({ ...base, payment: 'online', email: '   ' }).email, order.EMAIL_NEEDED, 'пробелы — не почта');
  assert.equal(validate({ ...base, payment: 'online', email: 'anna@mail.ru' }).email, undefined);
  assert.equal(validate({ ...base, payment: 'online', email: 'anna@gmail.com' }).email !== undefined, true, 'формат и российская почта — как раньше');
  assert.equal(validate({ ...base, payment: null }).email, undefined, 'без онлайн-оплаты почта не нужна');
  assert.deepEqual(Object.keys(validate({ ...base, name: '', payment: 'online' })), ['name', 'email'], 'почта — в порядке полей формы');

  // стол: буквы, цифры, дефис, до десяти знаков; слово «стол» и № не нужны
  for (const [typed, sent] of [
    ['5', '5'],
    [' стол № 5 ', '5'],
    ['Стол5', '5'],
    ['столик 7', '7'],
    ['№12', '12'],
    ['12А', '12А'],
    ['VIP-2', 'VIP-2'],
    ['<b>4</b>', 'b4b'],
    ['12345678901234', '1234567890'],
    ['', null],
    ['---', null],
    ['стол', null],
  ] as const)
    assert.equal(order.tableNumber(typed), sent, `стол: ${JSON.stringify(typed)}`);
  assert.equal(order.tableLine('Садовая, 212Б', '4'), 'В зале: Садовая, 212Б, стол 4');
  assert.equal(order.tableLine('Садовая, 212Б', ' '), 'В зале: Садовая, 212Б', 'без стола — только точка');

  // заказ: точка уходит при любом способе, стол — только у зала и только указанный
  const dishes = new Map([
    [1, { id: 1, slug: 'borsch', title: 'Борщ', price: 390, variants: [], fillings: [], available: true, places: [2] }],
    [2, { id: 2, slug: 'mors', title: 'Морс', price: 150, variants: [], fillings: [], available: true, places: [] }],
    [3, { id: 3, slug: 'bulka', title: 'Булочка', price: 90, variants: [], fillings: [], available: true, places: [1] }],
  ]);
  const cart = { v: 1 as const, lines: [1, 2].map((id) => ({ id, variant: null, filling: null, qty: 1 })) };
  const delivery = order.buildOrder(cart, dishes, { ...base, place: 2 }, '2610-1003');
  assert.equal(delivery.place, 2, 'доставка: точка уходит — сервер сверит с ней блюда');
  assert.ok(!('table' in delivery), 'доставка: стола нет');
  const table = order.buildOrder(cart, dishes, { ...base, fulfillment: 'dine_in', place: 2, table: ' стол № 5 ' }, '2610-1004');
  assert.deepEqual([table.fulfillment, table.place, table.table, table.address, table.address_flat], ['dine_in', 2, '5', null, null]);
  assert.ok(!('table' in order.buildOrder(cart, dishes, { ...base, fulfillment: 'dine_in', place: 2, table: '' }, 'x')), 'зал без номера — ключа нет');
  assert.ok(!('table' in order.buildOrder(cart, dishes, { ...base, fulfillment: 'pickup', place: 2, table: '5' }, 'x')), 'самовывоз: стол из черновика не уходит');

  // корзина и точка: блюдо другой точки названо, но в сумму и заказ не идёт
  const atOne = priced(cart, dishes, 1);
  assert.deepEqual(atOne.elsewhere.map((line) => line.title), ['Борщ']);
  assert.deepEqual([atOne.total, atOne.count, atOne.blocked], [150, 1, false], 'чужое блюдо — не стоп-лист, но и не в сумме');
  assert.deepEqual([priced(cart, dishes, 2).total, priced(cart, dishes, 2).elsewhere.length], [540, 0]);
  assert.equal(priced(cart, dishes).total, 540, 'точка не выбрана (одна точка на сайте) — считается всё');
  const sent = order.buildOrder(cart, dishes, { ...base, place: 1 }, 'x');
  assert.deepEqual(sent.items.map((line) => line.title), ['Морс'], 'в заказ идут только блюда выбранной точки');
  assert.equal(sent.total, 150);

  // разделы: где раздел виден, сколько в нём на каждой точке
  const all = [1, 2];
  assert.deepEqual(venue.sectionPlaces([dishes.get(1)!, dishes.get(1)!], all), [2], 'раздел из одних блюд точки 2');
  assert.deepEqual(venue.sectionPlaces([dishes.get(1)!, dishes.get(2)!], all), [], 'есть блюдо на обеих — раздел везде');
  assert.deepEqual(venue.sectionPlaces([dishes.get(1)!, dishes.get(3)!], all), [], 'блюда обеих точек — раздел везде');
  assert.deepEqual(venue.sectionPlaces([{ places: [9] }], all), [0], 'только несуществующая точка — раздел нигде');
  assert.deepEqual(venue.sectionPlaces([dishes.get(1)!], [1]), [], 'одна точка на сайте — прятать нечего');
  assert.deepEqual(venue.countsAt([...dishes.values()], all), { 1: 2, 2: 2 });
  assert.equal(venue.placesAttr([1, 2]), '1 2');
  assert.equal(venue.placesAttr([]), undefined);
  assert.equal(venue.cookedHere({ places: [2] }, null), true, 'точка не выбрана — готовят');
  assert.equal(venue.cookedHere({}, 1), true, 'нет списка — на всех');

  // имя точки после «на»: Садовая склоняется, Советской Армии — уже в нужном виде
  assert.equal(venue.venueCase('Садовая, 212Б', 'loc'), 'Садовой, 212Б');
  assert.equal(venue.venueCase('Садовая, 212Б', 'acc'), 'Садовую, 212Б');
  assert.equal(venue.venueCase('Советской Армии, 177', 'loc'), 'Советской Армии, 177');
  assert.equal(venue.venueCase('Мичурина, 5', 'acc'), 'Мичурина, 5');
  assert.equal(venue.kindLine('Кондитерская и кафе'), 'кондитерская и кафе');

  // CSS: по правилу на точку; без выбранной точки переключателя нет
  const css = venue.venueCss(all);
  assert.match(css, /:root\[data-venue="1"\] \[data-places\]:not\(\[data-places~="1"\]\)/);
  assert.match(css, /:root\[data-venue="2"\] \.pswitch__seg\{--at:1\}/);
  assert.match(css, /:root:not\(\[data-venue\]\) \.pswitch\{display:none!important\}/);

  // скрипт в <head>: ?place= главнее и запоминается, затем память, затем черновик, затем первая точка
  const head = (search: string, stored: Record<string, string> = {}) => {
    const store = new Map(Object.entries(stored));
    const html = { dataset: {} as Record<string, string> };
    runInNewContext(venue.venueScript(all, order.CHECKOUT_KEY), {
      document: { documentElement: html },
      location: { search },
      URLSearchParams,
      localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) },
    });
    return [html.dataset.venue, store.get(venue.PLACE_KEY)];
  };
  assert.deepEqual(head(''), ['1', undefined], 'первый визит — первая точка');
  assert.deepEqual(head('?place=2&table=5'), ['2', '2'], 'QR-код на столе: точка из адреса и запоминается');
  assert.deepEqual(head('?place=2', { [venue.PLACE_KEY]: '1' }), ['2', '2'], 'адрес главнее запомненного');
  assert.deepEqual(head('?place=7', { [venue.PLACE_KEY]: '2' }), ['2', '2'], 'чужая точка в адресе — запомненная');
  assert.deepEqual(head('', { [order.CHECKOUT_KEY]: JSON.stringify({ place: 2 }) }), ['2', undefined], 'старый черновик самовывоза');
  assert.deepEqual(head('', { [order.CHECKOUT_KEY]: '{oops' }), ['1', undefined], 'битый черновик — первая точка');
  assert.equal(venue.pickPlace(all, null, '', 'x', 2), 2);
  assert.equal(venue.pickPlace(all), 1);
}

console.log('delivery-client: ok');
