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
  answerCallback,
  decideCallback,
  deliver,
  editTelegram,
  editTelegramKeyboard,
  historyLine,
  paidModel,
  parseCallback,
  paymentLine,
  pollTelegram,
  pressedBy,
  relayJob,
  statusLogLine,
  telegramKeyboard,
  telegramMeta,
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
  telegramBases,
  TELEGRAM_API,
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
  const impl = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status < 300, status: next.status, json: async () => next.body };
  };
  return { impl, calls };
};
// the verdict of a call without the extras (`result`, `job`, `code`) / вердикт вызова без подробностей
const core = ({ status, attempts, error }) => ({ status, attempts, error });
const netDown = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });

{
  // network error, network error, success: three tries / два сетевых сбоя и успех — три попытки
  const { impl, calls } = fakeFetch([netDown(), netDown(), { status: 200, body: { ok: true } }]);
  const slept = [];
  const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: async (ms) => slept.push(ms) });
  assert.deepEqual(core(r), { status: 'sent', attempts: 3, error: null });
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
  assert.deepEqual(core(r), { status: 'failed', attempts: 1, error: 'неверный токен бота' });
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
// ── relay with a queue / ретранслятор с очередью ─────────────────────────────
{
  assert.deepEqual(telegramBases({}), [TELEGRAM_API], 'без переменной — напрямую');
  assert.deepEqual(telegramBases({ TELEGRAM_API_BASE: 'http://172.17.0.1:8787/' }), ['http://172.17.0.1:8787', TELEGRAM_API], 'ретранслятор первым, Telegram запасным');
  assert.deepEqual(telegramBases({ TELEGRAM_API_BASE: TELEGRAM_API }), [TELEGRAM_API]);
  const RELAY = 'http://relay:8787';
  const bases = [RELAY, TELEGRAM_API];
  {
    // the relay delivered at once: a normal «sent» / ретранслятор доставил сразу — обычное «отправлено»
    const { impl, calls } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: noSleep, bases });
    assert.deepEqual(core(r), { status: 'sent', attempts: 1, error: null });
    assert.ok(calls[0].url.startsWith(`${RELAY}/bot`), 'ушло в ретранслятор');
  }
  {
    // the relay took it into the queue: «queued», no retries here / взял в очередь — «в очереди», без повторов
    const { impl, calls } = fakeFetch([{ status: 202, body: { ok: true, queued: true, job: 7 } }]);
    const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: noSleep, bases });
    assert.deepEqual(core(r), { status: 'queued', attempts: 1, error: null });
    assert.equal(calls.length, 1);
  }
  {
    // the relay is down: Telegram directly in the same attempt / ретранслятор лежит — сразу напрямую в Telegram
    const { impl, calls } = fakeFetch([netDown(), { status: 200, body: { ok: true } }]);
    const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: noSleep, bases });
    assert.deepEqual(core(r), { status: 'sent', attempts: 1, error: null });
    assert.ok(calls[1].url.startsWith(`${TELEGRAM_API}/bot`), 'запасной путь — Telegram');
  }
  {
    // the tunnel answers 503 for a dead relay: also the direct path / туннель отвечает 503 за мёртвый ретранслятор — тоже напрямую
    const { impl, calls } = fakeFetch([{ status: 503, body: {} }, { status: 200, body: { ok: true } }]);
    const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: noSleep, bases });
    assert.equal(r.status, 'sent');
    assert.equal(calls.length, 2);
  }
  {
    // both down twice, then Telegram answers: three attempts, six calls / оба лежат дважды, потом Telegram отвечает
    const { impl, calls } = fakeFetch([netDown(), netDown(), netDown(), netDown(), netDown(), { status: 200, body: { ok: true } }]);
    const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: noSleep, bases });
    assert.deepEqual(core(r), { status: 'sent', attempts: 3, error: null });
    assert.equal(calls.length, 6);
  }
  {
    // Telegram's own 4xx through the relay is final / 4xx самого Telegram через ретранслятор — окончательно
    const { impl, calls } = fakeFetch([{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }]);
    const r = await sendTelegram({ token: TOKEN, chatId: '1', text: 'x', fetchImpl: impl, sleep: noSleep, bases });
    assert.equal(r.status, 'failed');
    assert.equal(calls.length, 1);
  }
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

// ── the order in Telegram: buttons, presses, history / заказ в Telegram ──────
{
  // the buttons follow the status; a finished order has none; no id — none
  // кнопки по статусу; у выполненного нет; без id — нет
  const flat = (kb) => kb.flat().map((b) => `${b.text}|${b.callback_data}`);
  assert.deepEqual(flat(telegramKeyboard({ id: 15, status: 'new' })), ['▶️ В работу|o:15:in_work', '❌ Отменить|o:15:cancel?']);
  assert.deepEqual(flat(telegramKeyboard({ id: 15, status: 'in_work' })), ['✅ Выполнен|o:15:done', '❌ Отменить|o:15:cancel?']);
  assert.deepEqual(flat(telegramKeyboard({ id: 15, status: 'cancelled' })), ['↩️ Вернуть в работу|o:15:in_work']);
  assert.equal(telegramKeyboard({ id: 15, status: 'done' }), null);
  assert.equal(telegramKeyboard({ status: 'new' }), null);
  assert.deepEqual(flat(telegramKeyboard({ id: 15, status: 'new' }, { confirm: true })), ['Да, отменить заказ|o:15:cancelled', 'Нет, оставить|o:15:keep']);
  assert.ok(telegramKeyboard({ id: 123456789012, status: 'new' }).flat().every((b) => Buffer.byteLength(b.callback_data) <= 64));

  assert.deepEqual(parseCallback('o:15:in_work'), { id: 15, what: 'in_work' });
  assert.deepEqual(parseCallback('o:15:cancel?'), { id: 15, what: 'cancel?' });
  assert.equal(parseCallback('o:15:paid'), null);
  assert.equal(parseCallback('x:15:done'), null);
  assert.equal(parseCallback(undefined), null);

  // what a press does / что делает нажатие
  assert.deepEqual(decideCallback({ status: 'new' }, 'in_work'), { kind: 'set', status: 'in_work', toast: 'Статус: В работе' });
  assert.deepEqual(decideCallback({ status: 'in_work' }, 'done'), { kind: 'set', status: 'done', toast: 'Статус: Выполнен' });
  assert.equal(decideCallback({ status: 'new' }, 'cancel?').kind, 'confirm');
  assert.deepEqual(decideCallback({ status: 'new' }, 'cancelled'), { kind: 'set', status: 'cancelled', toast: 'Статус: Отменён' });
  assert.equal(decideCallback({ status: 'in_work' }, 'keep').kind, 'keep');
  // stale buttons: the order moved on / устаревшие кнопки: заказ ушёл дальше
  assert.deepEqual(decideCallback({ status: 'in_work' }, 'in_work'), { kind: 'toast', toast: 'Заказ уже «В работе»' });
  assert.deepEqual(decideCallback({ status: 'done' }, 'cancelled'), { kind: 'toast', toast: 'Заказ уже выполнен — менять в админке' });
  assert.deepEqual(decideCallback({ status: 'done' }, 'cancel?'), { kind: 'toast', toast: 'Заказ уже «Выполнен»' });
  assert.deepEqual(decideCallback({ status: 'new' }, 'done'), { kind: 'toast', toast: 'Заказ уже «Новый» — менять в админке' });
  assert.deepEqual(decideCallback({ status: 'cancelled' }, 'in_work'), { kind: 'set', status: 'in_work', toast: 'Статус: В работе' });

  assert.equal(pressedBy({ first_name: 'Дмитрий', last_name: 'Голдобин' }), 'Дмитрий Г.');
  assert.equal(pressedBy({ first_name: 'Ирина' }), 'Ирина');
  assert.equal(pressedBy({ username: 'vkus_admin' }), '@vkus_admin');
  assert.equal(pressedBy({}), 'без имени');
}
{
  // the history under the order and the log line on the card / история под заказом и строка журнала в карточке
  const at = '2026-10-23T08:40:00Z'; // 12:40 в Самаре
  const today = new Date('2026-10-23T10:00:00Z');
  assert.equal(historyLine({ status: 'in_work', who: 'Дмитрий Г.', via: 'telegram', at }, today), '▶️ В работе — Дмитрий Г., 12:40');
  assert.equal(historyLine({ status: 'done', who: 'Ирина', via: 'admin', at }, new Date('2026-10-25T10:00:00Z')), '✅ Выполнен — Ирина · админка, 23.10 12:40');
  assert.equal(historyLine({ status: 'cancelled', who: '', via: 'system', at }, today), '❌ Отменён — без имени, 12:40');
  assert.equal(statusLogLine({ status: 'in_work', who: 'Дмитрий Г.', via: 'telegram', at }), '23.10 12:40 — В работе — Дмитрий Г. (Telegram)');
  assert.equal(statusLogLine({ status: 'done', who: 'Ирина', via: 'admin', at }), '23.10 12:40 — Выполнен — Ирина (админка)');

  // the memory on the order: a string from the database or an object, junk ignored
  // память у заказа: строка из базы или объект, мусор пропускается
  assert.deepEqual(telegramMeta({}), { messages: [], history: [] });
  assert.deepEqual(telegramMeta({ telegram_meta: 'не json' }), { messages: [], history: [] });
  assert.deepEqual(telegramMeta({ telegram_meta: JSON.stringify({ messages: [{ chat: '-1', message_id: 7 }, null, { job: 3 }], history: [{ status: 'done' }, {}] }) }), {
    messages: [{ chat: '-1', message_id: 7 }],
    history: [{ status: 'done' }],
  });

  // the payment line: online orders only / строка оплаты: только онлайн
  assert.equal(paymentLine({ payment_status: 'none' }), null);
  assert.equal(paymentLine({}), null);
  assert.equal(paymentLine({ payment_status: 'pending' }), 'Оплата: ⏳ ждём оплату онлайн');
  assert.equal(paymentLine({ payment_status: 'paid', paid_at: at }, today), 'Оплата: 💳 оплачен онлайн, 12:40');
  assert.equal(paymentLine({ payment_status: 'failed' }), 'Оплата: ✗ оплата онлайн не прошла');
  assert.equal(paymentLine({ payment_status: 'refunded' }), 'Оплата: ↩️ оплата возвращена');

  // the whole message with payment, history and buttons / всё сообщение с оплатой, историей и кнопками
  const live = orderModel(
    { ...order, status: 'in_work', payment_status: 'paid', paid_at: at, telegram_meta: { messages: [{ chat: '-1001234567890', message_id: 42 }], history: [{ status: 'in_work', who: 'Дмитрий Г.', via: 'telegram', at }] } },
    { adminUrl: URL, now: today },
  );
  const text = sp(telegramText(live));
  assert.ok(text.includes('Когда: Сегодня к 18:00\nОплата: 💳 оплачен онлайн, 12:40\n'), text);
  assert.ok(text.endsWith('не стучите\n\n▶️ В работе — Дмитрий Г., 12:40\n\n<a href="' + URL + '">Открыть в админке</a>'), text);
  assert.deepEqual(live.keyboard.flat().map((b) => b.callback_data), ['o:15:done', 'o:15:cancel?']);
  assert.ok(sp(emailText(live)).includes('\n\n▶️ В работе — Дмитрий Г., 12:40\n\nОткрыть в админке'));
  // the status notice and the request carry neither / у уведомления о статусе и у заявки ни того ни другого
  assert.equal(statusModel(live, 'done').keyboard, null);
  assert.deepEqual(statusModel(live, 'done').history, []);
  assert.equal(requestModel(request).keyboard, null);
  // the paid reply / ответ об оплате
  const paid = paidModel(live, { ...order, to_pay: 2050 });
  assert.equal(sp(paid.headline), '💳 Заказ №1910-4821 оплачен онлайн — 2 050 ₽');
  assert.equal(sp(telegramText(paid)), '<b>💳 Заказ №1910-4821 оплачен онлайн — 2 050 ₽</b>');
  // the demo has no buttons: it is not an order anyone can move / у примера кнопок нет
  assert.equal(demoModel('order').keyboard, null);
}
{
  // the delivery sends the buttons and remembers the message / рассылка шлёт кнопки и запоминает сообщение
  const live = orderModel({ ...order, status: 'new' }, { adminUrl: URL });
  const { impl, calls } = fakeFetch([{ status: 200, body: { ok: true, result: { message_id: 42 } } }]);
  const { results } = await deliver({ model: live, settings: { ...settings, email_enabled: false }, mail: { ok: false, reason: 'x' }, fetchImpl: impl, sleep: noSleep, now: NOON });
  assert.deepEqual(calls[0].body.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['o:15:in_work', 'o:15:cancel?']);
  assert.equal(calls[0].body.reply_to_message_id, undefined);
  const tg = results.find((r) => r.channel === 'telegram');
  assert.equal(tg.status, 'sent');
  assert.equal(tg.chat, '-1001234567890');
  assert.equal(tg.messageId, 42);
  assert.equal(tg.job, null);
  // through the relay's queue: the ticket instead of the id / через очередь ретранслятора: талон вместо id
  const q = fakeFetch([{ status: 202, body: { ok: true, queued: true, job: 9 } }]);
  const queued = await deliver({ model: live, settings: { ...settings, email_enabled: false }, mail: { ok: false, reason: 'x' }, fetchImpl: q.impl, sleep: noSleep, now: NOON, bases: ['http://relay:8787', TELEGRAM_API] });
  const qt = queued.results.find((r) => r.channel === 'telegram');
  assert.equal(qt.status, 'queued');
  assert.equal(qt.messageId, null);
  assert.equal(qt.job, 9);
  // a reply under the order's message / ответ под сообщением заказа
  const p = fakeFetch([{ status: 200, body: { ok: true, result: { message_id: 43 } } }]);
  const paid = { ...paidModel(live, order), replyTo: { '-1001234567890': 42 } };
  await deliver({ model: paid, settings: { ...settings, email_enabled: false }, mail: { ok: false, reason: 'x' }, fetchImpl: p.impl, sleep: noSleep, now: NOON });
  assert.equal(p.calls[0].body.reply_to_message_id, 42);
  assert.equal(p.calls[0].body.reply_markup, undefined);
  // the status notice goes without buttons / уведомление о статусе — без кнопок
  const st = fakeFetch([{ status: 200, body: { ok: true, result: { message_id: 44 } } }]);
  await deliver({ model: statusModel(live, 'done'), settings: { ...settings, email_enabled: false }, mail: { ok: false, reason: 'x' }, fetchImpl: st.impl, sleep: noSleep, now: NOON });
  assert.equal(st.calls[0].body.reply_markup, undefined);
}
{
  // editing the message: «not modified» is fine, «not found» is a failure / правка сообщения
  const a = fakeFetch([{ status: 200, body: { ok: true, result: { message_id: 42 } } }]);
  const r = await editTelegram({ token: TOKEN, chatId: '-1', messageId: 42, text: 't', keyboard: [[{ text: 'x', callback_data: 'o:1:done' }]], fetchImpl: a.impl, sleep: noSleep });
  assert.equal(r.status, 'sent');
  assert.ok(a.calls[0].url.endsWith('/editMessageText'));
  assert.equal(a.calls[0].body.message_id, 42);
  assert.deepEqual(a.calls[0].body.reply_markup.inline_keyboard[0][0].callback_data, 'o:1:done');
  const b = fakeFetch([{ status: 400, body: { ok: false, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' } }]);
  assert.equal((await editTelegram({ token: TOKEN, chatId: '-1', messageId: 42, text: 't', fetchImpl: b.impl, sleep: noSleep })).status, 'sent');
  const c = fakeFetch([{ status: 400, body: { ok: false, description: 'Bad Request: message to edit not found' } }]);
  const lost = await editTelegram({ token: TOKEN, chatId: '-1', messageId: 42, text: 't', fetchImpl: c.impl, sleep: noSleep });
  assert.equal(lost.status, 'failed');
  assert.match(lost.error, /message to edit not found/);
  // no buttons at all clears the keyboard / без кнопок — клавиатура снимается
  const d = fakeFetch([{ status: 200, body: { ok: true } }]);
  await editTelegram({ token: TOKEN, chatId: '-1', messageId: 42, text: 't', keyboard: null, fetchImpl: d.impl, sleep: noSleep });
  assert.deepEqual(d.calls[0].body.reply_markup, { inline_keyboard: [] });
  // the same buttons again are not an error either / те же кнопки снова — тоже не ошибка
  const same = fakeFetch([{ status: 400, body: { ok: false, description: 'Bad Request: message is not modified' } }]);
  assert.equal((await editTelegramKeyboard({ token: TOKEN, chatId: '-1', messageId: 42, keyboard: [], fetchImpl: same.impl, sleep: noSleep })).status, 'sent');
  assert.ok(same.calls[0].url.endsWith('/editMessageReplyMarkup'));
  // the toast is never retried / ответ на нажатие не повторяется
  const e = fakeFetch([netDown(), netDown()]);
  const toast = await answerCallback({ token: TOKEN, callbackId: 'cb1', text: 'Статус: В работе', fetchImpl: e.impl, sleep: noSleep });
  assert.equal(toast.status, 'failed');
  assert.equal(e.calls.length, 1);
  assert.equal(e.calls[0].body.callback_query_id, 'cb1');
}
{
  // the long poll: presses and the next offset; the relay first, Telegram second
  // долгий опрос: нажатия и следующее смещение; сначала ретранслятор, потом Telegram
  const RELAY = 'http://relay:8787';
  const upd = (id) => ({ update_id: id, callback_query: { id: `cb${id}`, data: 'o:15:in_work', from: { first_name: 'Д' }, message: { message_id: 42, chat: { id: -1 } } } });
  const a = fakeFetch([{ status: 200, body: { ok: true, result: [upd(100), upd(101)] } }]);
  const r = await pollTelegram({ token: TOKEN, offset: null, timeout: 20, fetchImpl: a.impl, bases: [RELAY, TELEGRAM_API] });
  assert.equal(r.error, null);
  assert.equal(r.updates.length, 2);
  assert.equal(r.offset, 102);
  assert.ok(a.calls[0].url.startsWith(`${RELAY}/bot`) && a.calls[0].url.endsWith('/getUpdates'));
  assert.deepEqual(a.calls[0].body, { timeout: 20, allowed_updates: ['callback_query'] });
  // nothing new keeps the offset / без новостей смещение прежнее
  const b = fakeFetch([{ status: 200, body: { ok: true, result: [] } }]);
  const empty = await pollTelegram({ token: TOKEN, offset: 102, fetchImpl: b.impl, bases: [RELAY, TELEGRAM_API] });
  assert.deepEqual([empty.updates, empty.offset, empty.error], [[], 102, null]);
  assert.equal(b.calls[0].body.offset, 102);
  // the relay is down: Telegram directly / ретранслятор лежит — напрямую
  const c = fakeFetch([{ status: 502, body: {} }, { status: 200, body: { ok: true, result: [upd(103)] } }]);
  const direct = await pollTelegram({ token: TOKEN, offset: 102, fetchImpl: c.impl, bases: [RELAY, TELEGRAM_API] });
  assert.equal(direct.offset, 104);
  assert.ok(c.calls[1].url.startsWith(`${TELEGRAM_API}/bot`));
  // another poller holds the bot: 409 is reported, not hidden / бота опрашивает кто-то ещё: 409 виден
  const d = fakeFetch([{ status: 409, body: { ok: false, description: 'Conflict: terminated by other getUpdates request' } }]);
  const conflict = await pollTelegram({ token: TOKEN, offset: 104, fetchImpl: d.impl, bases: [TELEGRAM_API] });
  assert.equal(conflict.code, 409);
  assert.match(conflict.error, /409/);
  assert.equal(conflict.offset, 104);
  // both down: the error names the last leg, no token in it / оба лежат: ошибка без токена
  const e = fakeFetch([netDown(), netDown()]);
  const down = await pollTelegram({ token: TOKEN, offset: 104, fetchImpl: e.impl, bases: [RELAY, TELEGRAM_API] });
  assert.match(down.error, /нет связи с Telegram/);
  assert.ok(!down.error.includes(TOKEN));

  // the queue ticket: done → the id, pending → null, gone → lost; never without a relay
  // талон очереди: готово → id, ждёт → null, пропало → потеряно; без ретранслятора — никогда
  const done = fakeFetch([{ status: 200, body: { id: 9, status: 'done', result: { ok: true, result: { message_id: 77 } } } }]);
  assert.deepEqual(await relayJob({ base: RELAY, token: TOKEN, job: 9, fetchImpl: done.impl }), { messageId: 77 });
  assert.equal(done.calls[0].url, `${RELAY}/bot${TOKEN}/jobs/9`);
  const wait = fakeFetch([{ status: 200, body: { id: 9, status: 'pending', result: null } }]);
  assert.equal(await relayJob({ base: RELAY, token: TOKEN, job: 9, fetchImpl: wait.impl }), null);
  const gone = fakeFetch([{ status: 404, body: { ok: false } }]);
  assert.deepEqual(await relayJob({ base: RELAY, token: TOKEN, job: 9, fetchImpl: gone.impl }), { lost: true });
  const rejected = fakeFetch([{ status: 200, body: { id: 9, status: 'rejected', result: { ok: false } } }]);
  assert.deepEqual(await relayJob({ base: RELAY, token: TOKEN, job: 9, fetchImpl: rejected.impl }), { lost: true });
  const off = fakeFetch([netDown()]);
  assert.equal(await relayJob({ base: RELAY, token: TOKEN, job: 9, fetchImpl: off.impl }), null);
  assert.equal(await relayJob({ base: TELEGRAM_API, token: TOKEN, job: 9, fetchImpl: off.impl }), null);
  assert.equal(off.calls.length, 1);
}

console.log('оповещения: темы, тексты, повторы Telegram, кнопки и опрос нажатий, почта без SMTP — проверки прошли');
