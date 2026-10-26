/**
 * Проверка личного кабинета: сессия и её срок, сводка кабинета (баланс по
 * книге, уровень, траты месяца, баллы в пути), «Повторить заказ», правила
 * профиля и их паритет с адресом `guest-auth` в Directus, токен, который
 * выдаёт `guest-auth`, — в том виде, который принимает Directus.
 * Запуск: `pnpm test` (Node читает TypeScript сам).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  parseSession,
  profileErrors,
  repeatOrder,
  summarize,
  txTitle,
  displayName,
  relativeDays,
  monthIn,
  dateText,
  dateTimeText,
  tokenExpiry,
  orderCard,
  orderHow,
  orderAnchor,
  payLabel,
  placeText,
  PAY_METHOD,
  PAY_STATUS,
  type Me,
  type Order,
} from './account.ts';
import { RU_MAIL_ERROR } from './email.ts';
import { DEFAULT_PROGRAM } from './loyalty.ts';
import { normalizePhone as sitePhone } from './order.ts';
import { parseCart } from './cart.ts';

const guard = await import('../../directus/extensions/guest-auth/index.js');

// ── токен guest-auth — это токен Directus ─────────────────────────────────
const secret = 'test-secret';
const token = guard.signToken({ id: 'u1', role: 'r1', app_access: false, admin_access: false, session: 's1' }, secret, 3600, Date.parse('2026-10-19T10:00:00Z'));
const [head, body, signature] = token.split('.');
const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
assert.equal(JSON.parse(Buffer.from(head, 'base64url').toString()).alg, 'HS256');
// `verifyAccessJWT` Directus требует издателя `directus` и эти три поля
assert.equal(claims.iss, 'directus');
assert.deepEqual([claims.role, claims.app_access, claims.admin_access, claims.session], ['r1', false, false, 's1']);
assert.equal(claims.exp - claims.iat, 3600);
assert.equal(signature, crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url'));
assert.equal(tokenExpiry(token), Date.parse('2026-10-19T11:00:00Z'));
assert.equal(tokenExpiry('мусор'), 0);

// код хранится отпечатком: разный для разных номеров и кодов
assert.notEqual(guard.hashCode(secret, '+7 987 000-11-22', '1234'), guard.hashCode(secret, '+7 987 000-11-23', '1234'));
assert.equal(guard.hashCode(secret, '+7 987 000-11-22', '1234').length, 64);

// телефон в кабинете тот же, что в заказах: один гость — один номер
for (const raw of ['8 (987) 955 25 65', '+7 987 955-25-65', '9879552565', '79879552565', '+7 (987) 955-25-65', '12345', '+1 202 555 0100']) {
  assert.equal(guard.normalizePhone(raw), sitePhone(raw), raw);
}

// ── сессия ─────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-10-19T10:30:00Z');
const live = parseSession(JSON.stringify({ token, expires: '2026-11-18T10:00:00Z', phone: '+7 987 000-11-22' }), NOW);
assert.equal(live.session?.token, token);
assert.equal(live.expired, false);
// просроченный токен — «сессия закончилась», а не тихая форма входа
const stale = parseSession(JSON.stringify({ token, expires: '2026-11-18T10:00:00Z' }), Date.parse('2026-10-19T12:00:00Z'));
assert.equal(stale.session, null);
assert.equal(stale.expired, true);
assert.deepEqual(parseSession(null), { session: null, expired: false });
assert.deepEqual(parseSession('{битый'), { session: null, expired: false });
assert.deepEqual(parseSession('{"token":""}'), { session: null, expired: false });

// ── сводка кабинета ────────────────────────────────────────────────────────
const order = (id: number, status: string, date: string, total: number, extra = {}) => ({
  id, number: `1910-${1000 + id}`, status, date_created: date, fulfillment: 'pickup' as const, place: 1, address: null,
  desired_time: null, items: [{ product: 1, title: 'Завтрак', variant: null, filling: null, qty: 2, price: 685, sum: 1370 }],
  total, bonus_spent: 0, discount: 0, to_pay: null, bonus_earned: 0, ...extra,
});
const me: Me = {
  today: '2026-10-19',
  program: null,
  profile: {
    id: 'u1', first_name: 'Анна', middle_name: null, last_name: 'Смирнова', phone: '+7 987 000-11-22', birthday: '1990-10-21',
    gender: 'female', recovery_email: null, bonus_balance: 999, total_spent: 0, tier: '1', guest_since: null, birthday_set_at: null,
  },
  orders: [
    order(1, 'done', '2026-09-30T20:30:00Z', 8000, { to_pay: 7700, bonus_spent: 300 }), // 1 октября по Самаре
    order(2, 'done', '2026-08-15T10:00:00Z', 3000),
    order(3, 'in_work', '2026-10-18T10:00:00Z', 2000),
    order(4, 'cancelled', '2026-10-17T10:00:00Z', 5000),
  ],
  transactions: [
    { id: 1, type: 'signup', amount: 200, date_created: '2025-10-01T09:00:00Z', expires_at: '2026-10-01', comment: null, order: null },
    { id: 2, type: 'accrual', amount: 300, date_created: '2026-08-16T09:00:00Z', expires_at: '2026-11-10', comment: null, order: { number: '1910-1002' } },
    { id: 3, type: 'spend', amount: -100, date_created: '2026-02-01T09:00:00Z', expires_at: null, comment: null, order: null },
  ],
};
const sum = summarize(me, DEFAULT_PROGRAM);
// 100 регистрационных сгорели 1 октября и ещё не списаны ночью — их не показываем
assert.equal(sum.balance, 300);
assert.equal(sum.burnSoon, 300);
assert.equal(sum.burnDay, '2026-11-10');
// траты — только выполненные заказы и только деньгами: 7 700 + 3 000
assert.equal(sum.spent, 10700);
assert.equal(sum.level.tier.name, '2');
assert.equal(sum.level.left, 30000 - 10700);
// заказ 30 сентября в 20:30 UTC — уже 1 октября в Самаре, он в тратах октября
assert.equal(sum.monthSpent, 7700);
// в пути: заказ в работе на 2 000 ₽ по 5 % уровня
assert.equal(sum.pending, 100);
assert.equal(sum.birthday?.inWindow, true);
assert.equal(sum.birthday?.distance, -2);

assert.equal(txTitle({ type: 'refund', amount: 300, order: null }), 'Вернулись за отменённый заказ');
assert.equal(txTitle({ type: 'refund', amount: -30, order: null }), 'Начисление за отменённый заказ');
assert.equal(txTitle({ type: 'accrual', amount: 30, order: null }), 'За заказ');
assert.equal(displayName(me.profile), 'Анна');
assert.equal(displayName(me.profile, true), 'Анна Смирнова');
assert.equal(displayName({ first_name: ' ', last_name: null }), null);
assert.equal(relativeDays(-2), 'через 2 дня');
assert.equal(relativeDays(0), 'сегодня');
assert.equal(relativeDays(5), '5 дней назад');
assert.equal(relativeDays(-21), 'через 21 день');
assert.equal(monthIn('2026-10-19'), 'октябре');
assert.equal(dateText('2026-10-21', '2026-10-19'), '21 октября');
assert.equal(dateText('2025-10-01T09:00:00Z', '2026-10-19'), '1 октября 2025');

// ── «Повторить заказ» ──────────────────────────────────────────────────────
const again = repeatOrder({
  items: [
    { product: 1, title: 'Завтрак', variant: null, filling: null, qty: 2, price: 685, sum: 1370 },
    { product: 40, title: 'Торт', variant: '2 кг', filling: 'Прага', qty: 1, price: 4000, sum: 4000 },
  ],
}, parseCart(JSON.stringify({ v: 1, lines: [{ id: 1, variant: null, filling: null, qty: 1 }] })));
assert.deepEqual(again.lines, [
  { id: 1, variant: null, filling: null, qty: 3 },
  { id: 40, variant: '2 кг', filling: 'Прага', qty: 1 },
]);
assert.deepEqual(repeatOrder({ items: null }).lines, []);

// ── профиль: сайт и сервер отказывают одинаково ───────────────────────────
const cases = [
  {},
  { first_name: 'Анна', birthday: '1990-10-21', gender: 'female', recovery_email: 'anna@example.ru' },
  { first_name: 'А'.repeat(61) },
  { birthday: '1990-02-30' },
  { birthday: '21.10.1990' },
  { birthday: '2027-01-01' },
  { birthday: '2024-01-01' },
  { birthday: '1900-01-01' },
  { gender: 'other' },
  { recovery_email: 'anna@' },
  { recovery_email: 'Anna@Example.RU' },
  // только российская почта: Gmail — нет, Яндекс в верхнем регистре — да, пустая — можно
  { recovery_email: 'anna@gmail.com' },
  { recovery_email: 'Anna@YANDEX.RU' },
  { recovery_email: ' anna@mail.ru ' },
  { recovery_email: '' },
] as const;
for (const input of cases) {
  assert.deepEqual(profileErrors(input as never, '2026-10-19'), guard.profileErrors(input, '2026-10-19'), JSON.stringify(input));
}
assert.deepEqual(Object.keys(profileErrors({ birthday: '2027-01-01', recovery_email: 'x' }, '2026-10-19')), ['birthday', 'recovery_email']);
assert.equal(profileErrors({ recovery_email: 'anna@gmail.com' }, '2026-10-19').recovery_email, RU_MAIL_ERROR);
assert.equal(profileErrors({ recovery_email: 'Anna@YANDEX.RU' }, '2026-10-19').recovery_email, undefined);
assert.equal(profileErrors({ recovery_email: '' }, '2026-10-19').recovery_email, undefined);
// кривой адрес — сначала формат, а не «укажите российскую»
assert.equal(profileErrors({ recovery_email: 'anna@' }, '2026-10-19').recovery_email, 'Проверьте адрес: name@mail.ru');

// ── заказ целиком ─────────────────────────────────────────────────────────
{
  const sp = (text: string) => text.replace(/\u00a0/g, ' ');
  const places = [
    { id: 1, name: 'Садовая, 212Б', street: 'Садовая' },
    { id: 2, name: 'Ресторан', street: 'Советской Армии, 177' },
  ];
  const today = '2026-10-23';
  assert.equal(dateTimeText('2026-10-23T09:12:00Z', today), '23 октября, 13:12');
  assert.equal(dateTimeText('2025-09-01T16:30:00Z', today), '1 сентября 2025, 20:30');
  assert.equal(dateTimeText(null, today), '');
  assert.equal(dateTimeText('мусор', today), '');
  assert.equal(orderAnchor('2310-4821'), 'order-2310-4821');
  assert.equal(placeText(places[0]), 'Садовая, 212Б');
  assert.equal(placeText(places[1]), 'Ресторан, Советской Армии, 177');
  assert.equal(placeText(undefined), null);
  assert.deepEqual(Object.keys(PAY_STATUS), ['none', 'pending', 'paid', 'failed', 'refunded']);
  assert.equal(PAY_METHOD.online, 'Онлайн картой');

  const base: Order = {
    id: 31, number: '2310-4821', status: 'in_work', date_created: '2026-10-23T09:12:00Z', fulfillment: 'delivery', place: null,
    address: 'улица Советской Армии, 177', address_flat: 'кв. 12', address_entrance: '2', address_floor: '5', address_intercom: '12К',
    delivery_zone: 'Рядом с нами', delivery_cost: 400, desired_time: 'Сегодня, к 19:00', comment: ' Позвоните за 10 минут ',
    customer_name: 'Анна', phone: '+7 987 955-25-65',
    items: [{ product: 1, title: 'Торт «Прага», 1,5 кг', variant: '1,5 кг', filling: null, qty: 2, price: 2400, sum: 4800 }],
    total: 4800, bonus_spent: 0, discount: 0, to_pay: 5200, bonus_earned: null,
    payment_method: 'online', payment_status: 'paid', payment_test: true, paid_at: '2026-10-23T09:14:30Z',
    history: [{ status: 'new', at: '2026-10-23T09:12:00Z' }, { status: 'in_work', at: '2026-10-23T09:31:00Z' }],
  };
  const card = orderCard(base, places, today);
  // название как есть: размер уже в нём, вариант не повторяется
  assert.deepEqual(card.lines, [{ title: 'Торт «Прага», 1,5 кг', qty: 2, sum: 4800 }]);
  assert.deepEqual(card.bill.map((row) => [row.label, sp(row.value)]), [['Блюда', '4 800 ₽'], ['Доставка', '400 ₽']]);
  assert.deepEqual([card.total.label, card.total.value], ['Оплачено', 5200]);
  assert.equal(card.where.label, 'Куда');
  assert.equal(sp(card.where.value), 'улица Советской Армии, 177, кв. 12, подъезд 2, этаж 5, домофон 12К');
  assert.equal(card.where.note, 'Зона доставки: Рядом с нами');
  assert.equal(card.comment, 'Позвоните за 10 минут');
  assert.equal(card.who, 'Анна · +7 (987) 955-25-65');
  assert.deepEqual(card.pay, { method: 'Онлайн картой', state: 'paid', status: 'Оплачен', at: '23 октября, 13:14', test: true });
  assert.deepEqual(card.history, [
    { status: 'new', label: 'Принят', at: '23 октября, 13:12' },
    { status: 'in_work', label: 'Готовим', at: '23 октября, 13:31' },
  ]);

  // доставка: не посчитана — словами, бесплатно — словом; скидка и баллы — минусом
  const unknown = orderCard({ ...base, delivery_cost: null, payment_status: 'pending', payment_test: false }, places, today);
  assert.deepEqual(unknown.bill[1], { label: 'Доставка', value: 'назовём при звонке', tone: 'quiet' });
  assert.equal(unknown.total.label, 'К оплате');
  assert.deepEqual(unknown.pay, { method: 'Онлайн картой', state: 'pending', status: 'Ждём оплату', at: null, test: false });
  assert.deepEqual(orderCard({ ...base, status: 'done', delivery_cost: undefined }, places, today).bill[1].value, 'по звонку');
  const free = orderCard({ ...base, delivery_cost: 0, discount: 480, bonus_spent: 200, to_pay: 4120 }, places, today);
  assert.deepEqual(free.bill.map((row) => [row.label, sp(row.value), row.tone]), [
    ['Блюда', '4 800 ₽', 'money'],
    ['Доставка', 'бесплатно', 'free'],
    ['Скидка именинника', '−480 ₽', 'minus'],
    ['Баллами', '−200 ₽', 'minus'],
  ]);
  assert.equal(free.total.value, 4120);

  // самовывоз: строки доставки нет, точка с улицей; одна строка «Блюда» над той же суммой не повторяется
  const pickup = orderCard({ ...base, fulfillment: 'pickup', place: 2, delivery_zone: null, delivery_cost: 0, to_pay: 4800 }, places, today);
  assert.deepEqual(pickup.bill, []);
  assert.deepEqual(pickup.total, { label: 'Оплачено', value: 4800 });
  assert.deepEqual(orderCard({ ...base, fulfillment: 'pickup', place: 2, bonus_spent: 300, to_pay: 4500 }, places, today).bill.map((row) => row.label), ['Блюда', 'Баллами']);
  assert.deepEqual(pickup.where, { label: 'Откуда', value: 'Ресторан, Советской Армии, 177', note: null });

  // доставка называет кухню рядом с адресом (с 26.10.2026), зона — после неё
  assert.equal(orderCard({ ...base, place: 1 }, places, today).where.note, 'Готовит: Садовая, 212Б · Зона доставки: Рядом с нами');
  assert.equal(orderCard({ ...base, place: 1, delivery_zone: null }, places, today).where.note, 'Готовит: Садовая, 212Б');
  assert.equal(orderCard({ ...base, place: 99, delivery_zone: null }, places, today).where.note, null, 'неизвестная точка — без строки');
  // «В зале»: где гость, без строки доставки и без адреса
  const hall = orderCard({ ...base, fulfillment: 'dine_in', place: 1, table: '4', delivery_zone: null, delivery_cost: 0, to_pay: 4800 }, places, today);
  assert.deepEqual(hall.where, { label: 'Где', value: 'В зале, Садовая, 212Б, стол 4', note: null });
  assert.deepEqual(hall.bill, []);
  assert.equal(orderCard({ ...base, fulfillment: 'dine_in', place: 1, table: null }, places, today).where.value, 'В зале, Садовая, 212Б');
  assert.equal(orderCard({ ...base, fulfillment: 'dine_in', place: null, table: ' 7 ' }, places, today).where.value, 'В зале, стол 7');
  // строка заказа в списке
  assert.equal(orderHow({ ...base, fulfillment: 'dine_in', place: 1, table: '4' }, places), 'в зале, Садовая, 212Б, стол 4');
  assert.equal(orderHow({ ...base, fulfillment: 'pickup', place: 2 }, places), 'самовывоз, Ресторан');
  assert.equal(sp(orderHow({ ...base, address_flat: null, address_entrance: null, address_floor: null, address_intercom: null }, places)), 'доставка, улица Советской Армии, 177');

  // старый ответ: без пунктов — строка `address_details`, без истории — «Принят» и статус без времени
  const old = orderCard(
    { ...base, status: 'cancelled', address_flat: undefined, address_entrance: undefined, address_floor: undefined, address_intercom: undefined, address_details: 'кв. 7, подъезд 1', delivery_zone: null, history: undefined, payment_method: 'on_delivery', payment_status: 'none', payment_test: false, paid_at: null, to_pay: null, customer_name: null, phone: null, comment: null },
    places,
    today,
  );
  assert.equal(old.where.value, 'улица Советской Армии, 177, кв. 7, подъезд 1');
  assert.equal(old.where.note, null);
  assert.deepEqual(old.history, [
    { status: 'new', label: 'Принят', at: '23 октября, 13:12' },
    { status: 'cancelled', label: 'Отменён', at: null },
  ]);
  assert.deepEqual(old.pay, { method: 'При получении', state: null, status: null, at: null, test: false });
  assert.deepEqual([old.total.label, old.total.value, old.who, old.comment], ['Итого', 4800, null, null]);
  // онлайн-заказ в работе, к оплате не приступали — «Не оплачен»; без способа оплаты строки оплаты нет
  assert.equal(orderCard({ ...base, payment_status: 'none', payment_test: false }, places, today).pay?.status, 'Не оплачен');
  assert.equal(orderCard({ ...base, payment_method: null, payment_status: null, payment_test: null }, places, today).pay, null);
  // история с сервера: «at: null» — без времени
  assert.deepEqual(orderCard({ ...base, history: [{ status: 'new', at: base.date_created }, { status: 'done', at: null }] }, places, today).history.at(-1), { status: 'done', label: 'Выполнен', at: null });
  assert.equal(payLabel({ status: 'cancelled', payment_status: 'refunded' }), 'Итого');
  assert.equal(payLabel({ status: 'new', payment_status: null }), 'К оплате');
  // чек: строка только с почтой гостя; без почты, со старым ответом `/me` и при оплате при получении — нет
  // the receipt: a row only with the guest's mail; none without it, from an older `/me` or paid on delivery
  assert.equal(orderCard({ ...base, email: ' anna@mail.ru ' }, places, today).receipt, 'на почту anna@mail.ru');
  assert.equal(card.receipt, null, 'старый ответ без поля email');
  assert.equal(orderCard({ ...base, email: null }, places, today).receipt, null);
  assert.equal(orderCard({ ...base, email: '   ' }, places, today).receipt, null);
  assert.equal(orderCard({ ...base, email: 'anna@mail.ru', payment_method: 'on_delivery' }, places, today).receipt, null, 'при получении чек ЮKassa не уходит');
}

// ── points × online payment and notifications / баллы × онлайн-оплата и оповещения
// the bank is asked for what is left after points; the managers' message says the same
// банк просят о том, что осталось после баллов; сообщение менеджерам говорит то же
{
  const { payable } = await import('../../directus/extensions/pay/service.js');
  const { orderModel } = await import('../../directus/extensions/notify/lib.js');
  assert.equal(payable({ total: 2320, to_pay: 2120 }), 2120);
  assert.equal(payable({ total: 2320, to_pay: null }), 2320);
  assert.equal(payable({ total: 2320 }), 2320);
  assert.equal(payable({ total: '2320.00', to_pay: '0' }), 0);
  const sold = orderModel({ number: '1910-1546', total: 2320, to_pay: 2120, bonus_spent: 200, discount: 0, items: [] });
  assert.match(sold.total, /^Итого: 2\s320 ₽ · баллами −200 ₽ · к оплате 2\s120 ₽$/);
  const plain = orderModel({ number: '1910-1547', total: 2320, items: [] });
  assert.match(plain.total, /^Итого: 2\s320 ₽$/);
}

console.log('account.check: ok');
