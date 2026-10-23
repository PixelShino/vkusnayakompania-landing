/**
 * Check of the order alerts (`directus/extensions/notify/lib.js`) without
 * Directus and without the network: Telegram is a fake `fetch`, mail a fake
 * sender. No real message leaves the machine.
 * Проверка оповещений о заказах без Directus и без сети: Telegram — подделка
 * `fetch`, почта — подделка отправщика. Ни одного настоящего сообщения.
 *
 * Run / Запуск: `pnpm test` (или node scripts/notify.check.mjs)
 */
import assert from 'node:assert/strict';
import {
  addressLine,
  deliver,
  demoModel,
  emailText,
  fillTemplate,
  mailState,
  normalizeSettings,
  orderModel,
  requestModel,
  scrub,
  sendTelegram,
  statusModel,
  subjectFor,
  telegramText,
} from '../directus/extensions/notify/lib.js';

// a shape no scanner takes for a real bot token: GitHub flagged the previous one
// форма, которую сканер не примет за настоящий токен бота: прошлую GitHub пометил
const TOKEN = '1234:FAKEtokenFORchecksONLYnotREAL';
const NOON = new Date('2026-10-19T08:05:00Z'); // 12:05 в Самаре
const noSleep = async () => {};
// Intl groups thousands with a no-break space; the checks read it as a plain one
// Intl разделяет тысячи неразрывным пробелом; проверки читают его как обычный
const sp = (text) => String(text).replace(/\u00a0/g, ' ');

const order = {
  id: 15,
  number: '1910-4821',
  customer_name: 'Иван <b>Петров</b>',
  phone: '+7 987 955-25-65',
  fulfillment: 'delivery',
  address: 'ул. Ленина, 1',
  address_details: 'кв. 5, домофон 5',
  desired_time: 'Сегодня к 18:00',
  comment: 'Позвоните за час & не стучите',
  items: JSON.stringify([
    { title: 'Торт «Лего» (2 кг, Сникерс)', qty: 1, price: 2000, sum: 2000 },
    { title: 'Морс', qty: 3, price: 150, sum: 450 },
  ]),
  total: 2450,
  source: 'site',
};
const request = {
  id: 4,
  number: '1910-1210',
  name: 'Мария',
  phone: '+7 900 111-22-33',
  event_date: '2026-11-21',
  guests: 40,
  venue: 'offsite',
  address: 'Самара, ул. Мичурина, 15',
  wishes: 'Без орехов',
  source: 'site',
};
const URL = 'https://admin.vkus-com.ru/admin/content/orders/15';

// ── subjects / темы ──────────────────────────────────────────────────────────
const settings = normalizeSettings({
  email_recipients: [
    { email: 'owner@vkus-com.ru', orders: true, requests: true },
    { email: 'Owner@vkus-com.ru', orders: true, requests: true }, // дубль другим регистром
    { email: 'catering@vkus-com.ru', orders: false, requests: true },
  ],
  telegram_enabled: true,
  telegram_token: TOKEN,
  telegram_chats: [{ chat_id: '-1001234567890', label: 'Заказы', orders: true, requests: false }],
});
const om = orderModel(order, { adminUrl: URL });
assert.equal(sp(subjectFor(om, settings)), 'ЗАКАЗ №1910-4821 — 2 450 ₽');
const rm = requestModel(request, { format: 'Фуршет' });
assert.equal(subjectFor(rm, settings), 'ЗАЯВКА №1910-1210 — Фуршет');
assert.equal(subjectFor(requestModel({ ...request, format: null }), settings), 'ЗАЯВКА №1910-1210 — формат не выбран');
// the database hands a `date` over as a Date, the API as a string: the same day
// база отдаёт `date` объектом Date, API — строкой: день один и тот же
assert.deepEqual(requestModel({ ...request, event_date: new Date(2026, 10, 21) }, { format: 'Фуршет' }).facts, rm.facts);
assert.equal(rm.facts[0], 'Дата: сб, 21 ноября');
assert.equal(fillTemplate('{number} {nope}', { number: 1 }), '1 {nope}', 'опечатка в подстановке видна как есть');
assert.equal(sp(subjectFor(demoModel('order', null), settings)), 'ПРОВЕРКА · ЗАКАЗ №ТЕСТ — 2 210 ₽');
assert.equal(
  normalizeSettings({ email_subject_order: '  ' }).email_subject_order,
  'ЗАКАЗ №{number} — {total} ₽',
  'пустая тема — тема по умолчанию',
);

// ── Telegram text: escaped, bold, link, limit / экранирование, ссылка, предел ─
const tg = telegramText(om);
assert.ok(sp(tg).startsWith('<b>Заказ №1910-4821 — 2 450 ₽</b>'), tg);
assert.ok(tg.includes('Иван &lt;b&gt;Петров&lt;/b&gt;'), 'имя гостя экранировано');
assert.ok(tg.includes('Позвоните за час &amp; не стучите'));
assert.ok(tg.includes('Доставка: ул. Ленина, 1, кв. 5, домофон 5'));
assert.ok(tg.includes(`<a href="${URL}">Открыть в админке</a>`));
const huge = telegramText(orderModel({ ...order, comment: 'очень длинно '.repeat(800) }, { adminUrl: URL }));
assert.ok(huge.length <= 4096, `длина ${huge.length}`);
assert.ok(huge.endsWith('</a>'), 'ссылка в админку не отрезана');

// ── the address by parts / адрес по пунктам ──────────────────────────────────
{
  const parts = { address: 'Советской Армии, 177', address_flat: '12', address_entrance: '2', address_floor: '5', address_intercom: '12К' };
  const line = 'Советской Армии, 177, кв. 12, подъезд 2, этаж 5, домофон 12К';
  assert.equal(addressLine(parts), line);
  const pm = orderModel({ ...order, ...parts, address_details: null, delivery_zone: 'Рядом с нами' }, { adminUrl: URL });
  assert.equal(pm.facts[0], `Доставка: ${line} · зона «Рядом с нами»`);
  assert.ok(telegramText(pm).includes(line), 'адрес по пунктам в Telegram');
  assert.ok(emailText(pm).includes(line), 'адрес по пунктам в письме');
  // empty parts are skipped / пустые пункты пропускаются
  assert.equal(addressLine({ address: 'Ленина, 1', address_flat: '', address_entrance: null, address_floor: ' 3 ' }), 'Ленина, 1, этаж 3');
  // a part typed with its own word is not prefixed twice / пункт со своим словом второй раз не подписывается
  assert.equal(
    addressLine({ address: 'Ленина, 1', address_flat: 'офис 305', address_entrance: 'подъезд 3', address_intercom: 'код 45#' }),
    'Ленина, 1, офис 305, подъезд 3, код 45#',
  );
  assert.equal(addressLine({ address: 'Ленина, 1', address_floor: '5 этаж', address_intercom: 'нет домофона' }), 'Ленина, 1, 5 этаж, нет домофона');
  // an order made before the parts: the one line is appended / заказ до пунктов: старая строка дописывается
  assert.equal(addressLine({ address: 'ул. Ленина, 1', address_details: 'кв. 5, домофон 5' }), 'ул. Ленина, 1, кв. 5, домофон 5');
  assert.equal(orderModel({ ...order, address: null, address_details: null }).facts[0], 'Доставка: адрес не указан');
  assert.equal(orderModel({ ...order, ...parts, fulfillment: 'pickup' }, { place: 'Садовая' }).facts[0], 'Самовывоз: Садовая');
}

// ── order-guard: the parts reach the order and the manager / пункты доходят до заказа и менеджера ──
{
  // a knex in miniature: where / whereIn / first / pluck / select over plain rows
  // knex в миниатюре: where / whereIn / first / pluck / select по простым строкам
  const fakeDb = (tables) => (name) => {
    let list = [...(tables[name] ?? [])];
    const query = {
      where(match) {
        list = list.filter((row) => Object.entries(match).every(([key, value]) => row[key] === value));
        return query;
      },
      whereIn(column, values) {
        list = list.filter((row) => values.includes(row[column]));
        return query;
      },
      select: async () => list,
      first: async () => list[0],
      pluck: async (column) => list.map((row) => row[column]),
    };
    return query;
  };
  const sent = [];
  class NotificationsService {
    async createOne(data) {
      sent.push(data);
    }
  }
  const quiet = { warn: () => {}, error: () => {}, info: () => {} };
  const filters = {};
  const actions = {};
  const guard = await import('../directus/extensions/order-guard/index.js');
  guard.default(
    { filter: (event, fn) => (filters[event] = fn), action: (event, fn) => (actions[event] = fn) },
    { services: { NotificationsService }, logger: quiet },
  );
  const database = fakeDb({
    products: [{ id: 5, title: 'Морс', price: 150, weight: null, variants: [], fillings: [], available: true, status: 'published' }],
    orders: [],
    places: [{ id: 1 }],
    directus_roles: [{ id: 'r1', name: 'Administrator' }],
    directus_users: [{ id: 'u1', role: 'r1', status: 'active' }],
  });
  // no `delivery_zones` in the schema: no geocoder, the delivery is priced on the call
  // в схеме нет `delivery_zones`: без геокодера, доставку назовут при звонке
  const schema = { collections: { orders: {} } };
  let ip = 0;
  const send = (extra) =>
    filters['orders.items.create'](
      { customer_name: 'Анна', phone: '8 987 955 25 65', consent: true, fulfillment: 'delivery', items: [{ product: 5, qty: 1 }], ...extra },
      {},
      { accountability: { user: null, ip: `10.0.9.${(ip += 1)}` }, database, schema },
    );
  // an empty part is not sent to the database at all: the column stays null
  // пустой пункт в базу не передаётся вовсе: колонка остаётся null
  const pick = (row) =>
    [row.address, row.address_flat, row.address_entrance, row.address_floor, row.address_intercom, row.address_details].map((v) => v ?? null);

  const full = await send({ address: ' Советской Армии, 177 ', address_flat: ' 12 ', address_entrance: 2, address_floor: '5', address_intercom: '12К' });
  assert.deepEqual(pick(full), ['Советской Армии, 177', '12', '2', '5', '12К', null], 'пункты адреса в заказе, число принято строкой');
  const long = await send({
    address: 'Советской Армии, 177',
    address_flat: 'офис 305, вход со двора, налево',
    address_entrance: 'подъезд номер 22',
    address_floor: '5\n  этаж',
    address_intercom: '1'.repeat(40),
    address_details: 'x'.repeat(200),
  });
  assert.deepEqual(
    pick(long),
    ['Советской Армии, 177', 'офис 305, вход со дв', 'подъезд но', '5 этаж', '1'.repeat(20), 'x'.repeat(120)],
    'длиннее предела — обрезано: 20, 10, 10, 20 и 120 знаков',
  );
  const blank = await send({ address: 'Советской Армии, 177', address_flat: '  ', address_entrance: '', address_floor: null, address_intercom: { x: 1 } });
  assert.deepEqual(pick(blank).slice(1), [null, null, null, null, null], 'пусто и не строка — null');
  const old = await send({ address: 'ул. Ленина, 1', address_details: ' кв. 5, домофон 5 ' });
  assert.deepEqual(pick(old), ['ул. Ленина, 1', null, null, null, null, 'кв. 5, домофон 5'], 'старый формат принимается');
  const pickup = await send({ fulfillment: 'pickup', place: 1, address: 'Советской Армии, 177', address_flat: '12', address_details: 'кв. 5' });
  assert.deepEqual(pick(pickup), [null, null, null, null, null, null], 'самовывоз — адресных полей нет');
  assert.ok(!('address_flat' in pickup) && !('address_flat' in old), 'пустой пункт не попадает в запись — старой странице не нужны новые права');

  for (const [key, row] of [[1, full], [2, old], [3, pickup]])
    await actions['orders.items.create']({ key, payload: { ...row, number: `2310-000${key}` } }, { database, schema: {} });
  assert.equal(sent.length, 3);
  assert.ok(
    sent[0].message.includes('Доставка: Советской Армии, 177, кв. 12, подъезд 2, этаж 5, домофон 12К · стоимость назвать при звонке.'),
    sent[0].message,
  );
  assert.ok(sent[1].message.includes('Доставка: ул. Ленина, 1, кв. 5, домофон 5 · '), sent[1].message);
  assert.ok(sent[2].message.includes('Самовывоз. Когда:'), sent[2].message);
}

// ── mail state / состояние почты ─────────────────────────────────────────────
assert.equal(mailState({}).ok, false);
assert.equal(mailState({ EMAIL_TRANSPORT: 'sendmail' }).reason, 'SMTP не настроен');
assert.equal(mailState({ EMAIL_TRANSPORT: 'smtp', EMAIL_SMTP_HOST: '' }).ok, false);
assert.equal(mailState({ EMAIL_TRANSPORT: 'smtp', EMAIL_SMTP_HOST: 'smtp.yandex.ru', EMAIL_SMTP_PORT: 465 }).ok, true);

// ── a fake Telegram / подделка Telegram ──────────────────────────────────────
const fakeFetch = (answers) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status < 300, status: next.status, json: async () => next.body };
  };
  return { impl, calls };
};
const netDown = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });

{
  // network error, network error, success: three tries / два сетевых сбоя и успех — три попытки
  const { impl, calls } = fakeFetch([netDown(), netDown(), { status: 200, body: { ok: true } }]);
  const slept = [];
  const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: async (ms) => slept.push(ms) });
  assert.deepEqual(r, { status: 'sent', attempts: 3, error: null });
  assert.equal(calls.length, 3);
  assert.deepEqual(slept, [2000, 5000]);
  assert.equal(calls[0].body.parse_mode, 'HTML');
}
{
  // three network errors: gives up, no token in the error / три сбоя — сдаёмся, токена в ошибке нет
  const { impl, calls } = fakeFetch([netDown(), netDown(), netDown()]);
  const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: noSleep });
  assert.equal(r.status, 'failed');
  assert.equal(r.attempts, 3);
  assert.equal(calls.length, 3);
  assert.match(r.error, /нет связи с Telegram \(ECONNRESET\)/);
}
{
  // wrong token: a settings problem, reported at once / неверный токен — ошибка настроек, без повторов
  const { impl, calls } = fakeFetch([{ status: 401, body: { ok: false, error_code: 401, description: 'Unauthorized' } }]);
  const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: noSleep });
  assert.deepEqual(r, { status: 'failed', attempts: 1, error: 'неверный токен бота' });
  assert.equal(calls.length, 1);
}
{
  const { impl } = fakeFetch([{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }]);
  const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: noSleep });
  assert.match(r.error, /чат не найден/);
}
{
  // a 502 is retried like a network error / 502 повторяется, как сетевой сбой
  const { impl, calls } = fakeFetch([{ status: 502, body: {} }, { status: 200, body: { ok: true } }]);
  const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: noSleep });
  assert.equal(r.status, 'sent');
  assert.equal(calls.length, 2);
}
assert.equal(scrub(`GET https://api.telegram.org/bot${TOKEN}/sendMessage`, []), 'GET https://api.telegram.org/bot***/sendMessage');
assert.ok(!scrub(`token ${TOKEN} leaked`, [TOKEN]).includes(TOKEN));

// ── the whole delivery / вся рассылка ────────────────────────────────────────
{
  // no SMTP: letters are «not sent», Telegram works, the order line says so
  // без SMTP: письма «не отправлены», Telegram работает, строка заказа это говорит
  const { impl, calls } = fakeFetch([{ status: 200, body: { ok: true } }]);
  const mails = [];
  const { results, summary } = await deliver({
    model: om,
    settings,
    mail: mailState({ EMAIL_TRANSPORT: 'sendmail' }),
    sendMail: async (m) => mails.push(m),
    fetchImpl: impl,
    sleep: noSleep,
    now: NOON,
  });
  assert.equal(mails.length, 0, 'без SMTP письмо даже не пытаемся отправить');
  assert.deepEqual(
    results.filter((r) => r.channel === 'email').map((r) => [r.recipient, r.status, r.error]),
    [['owner@vkus-com.ru', 'skipped', 'SMTP не настроен']],
    'дубль адреса схлопнут, адрес без галочки «заказы» пропущен',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.chat_id, '-1001234567890');
  assert.equal(summary, 'почта ✗ SMTP не настроен · Telegram ✓ · 12:05');
}
{
  // SMTP on: one letter per address, each with the ЗАКАЗ subject; a request skips the orders-only chat
  // SMTP есть: по письму на адрес с темой ЗАКАЗ; заявка обходит чат «только заказы»
  const mails = [];
  const { impl, calls } = fakeFetch([]);
  const { results, summary } = await deliver({
    model: rm,
    settings,
    mail: { ok: true },
    sendMail: async (m) => mails.push(m),
    fetchImpl: impl,
    sleep: noSleep,
    now: NOON,
  });
  assert.deepEqual(mails.map((m) => m.to), ['owner@vkus-com.ru', 'catering@vkus-com.ru']);
  assert.equal(mails[0].subject, 'ЗАЯВКА №1910-1210 — Фуршет');
  assert.match(mails[0].text, /Где: выезд: Самара, ул\. Мичурина, 15/);
  assert.match(mails[0].html, /<p style="margin:0 0 12px;font-size:19px;font-weight:700">Заявка №1910-1210/);
  assert.equal(calls.length, 0);
  assert.equal(results.length, 2);
  assert.equal(summary, 'почта ✓ 2 адреса · Telegram — нет чатов · 12:05');
}
{
  // one address bounces, wrong token: the card names the cause, never the token
  // один адрес не принят, токен неверный: карточка называет причину, но не токен
  const { impl } = fakeFetch([{ status: 401, body: { ok: false, description: 'Unauthorized' } }]);
  let n = 0;
  const { summary, results } = await deliver({
    model: om,
    settings: { ...settings, email_recipients: [{ email: 'a@vkus-com.ru' }, { email: 'b@vkus-com.ru' }] },
    mail: { ok: true },
    sendMail: async () => {
      if (n++) throw Object.assign(new Error(`Invalid login ${TOKEN}`), { code: 'EAUTH' });
    },
    fetchImpl: impl,
    sleep: noSleep,
    now: NOON,
    secrets: [TOKEN],
  });
  assert.equal(summary, 'почта ✓ 1 из 2 · Telegram ✗ неверный токен бота · 12:05');
  assert.ok(results.every((r) => !String(r.error ?? '').includes(TOKEN)));
}
{
  // switched off and empty / выключено и пусто
  const off = normalizeSettings({ email_enabled: false, telegram_enabled: false });
  assert.equal((await deliver({ model: om, settings: off, mail: { ok: true }, now: NOON })).summary, 'почта выключена · Telegram выключен · 12:05');
  const empty = normalizeSettings({ telegram_enabled: true });
  assert.equal(
    (await deliver({ model: om, settings: empty, mail: { ok: true }, now: NOON })).summary,
    'почта — нет адресов · Telegram ✗ нет токена бота · 12:05',
  );
}
{
  // a status change is one short line / смена статуса — одна короткая строка
  const sm = statusModel(om, 'in_work');
  assert.equal(sp(sm.headline), 'Заказ №1910-4821 — статус «В работе»');
  assert.equal(sp(subjectFor(sm, settings)), 'Заказ №1910-4821 — статус «В работе»');
  assert.equal(sp(telegramText({ ...sm, adminUrl: null })), '<b>Заказ №1910-4821 — статус «В работе»</b>\nИван &lt;b&gt;Петров&lt;/b&gt;, +7 987 955-25-65');
}

console.log('оповещения: темы, тексты, повторы Telegram, почта без SMTP — проверки прошли');
