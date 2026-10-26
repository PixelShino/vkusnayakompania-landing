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
  NOT_RU_REASON,
  senderWarning,
  testAddressProblem,
  POLL_UPDATES,
  chatKey,
  deliverPending,
  mergeSeen,
  migrateChats,
  migrationFromUpdate,
  pendingModel,
  pendingOutcomeLine,
  seenFromUpdate,
  telegramCall,
  telegramChats,
  threadOf,
  wants,
  SEEN_LIMIT,
} from '../directus/extensions/notify/lib.js';
import { RULES, emailProblem, payloadProblem, recipientProblems, recipientsError } from '../directus/extensions/email-guard/rules.js';
import { RU_MAIL_ERROR, RU_MAIL_ERROR_ADMIN } from '../directus/extensions/email-guard/domains.js';

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
  assert.equal(pm.facts[0], `Доставка: ${line}`, 'адрес без хвоста про зону');
  assert.ok(!telegramText(pm).includes('Рядом с нами'), 'зона доставки в сообщение не попадает');
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
// a sender off Russian mail is a warning next to the state, never a stop
// отправитель не на российской почте — предупреждение к состоянию, а не запрет
{
  const foreign = mailState({ EMAIL_TRANSPORT: 'smtp', EMAIL_SMTP_HOST: 'x', EMAIL_FROM: 'a@gmail.com' });
  assert.equal(foreign.ok, true, 'чужой отправитель почту не выключает');
  assert.equal(foreign.warning, 'Отправитель EMAIL_FROM не на российской почте: gmail.com');
  assert.equal(mailState({ EMAIL_TRANSPORT: 'smtp', EMAIL_SMTP_HOST: 'x', EMAIL_FROM: 'a@yandex.ru' }).warning, null);
  assert.equal(mailState({ EMAIL_TRANSPORT: 'smtp', EMAIL_SMTP_HOST: 'x', EMAIL_FROM: 'noreply@vkus-com.ru' }).warning, null);
  assert.equal(mailState({ EMAIL_TRANSPORT: 'smtp', EMAIL_SMTP_HOST: 'x' }).warning, null, 'без EMAIL_FROM молчим');
  assert.equal(mailState({ EMAIL_FROM: 'x@outlook.com' }).warning, 'Отправитель EMAIL_FROM не на российской почте: outlook.com', 'и когда почта не настроена');
  assert.equal(senderWarning('Вкусная компания <Zakaz@Mail.RU>'), null);
  assert.equal(senderWarning('"Кухня" <k@icloud.com>'), 'Отправитель EMAIL_FROM не на российской почте: icloud.com');
}

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
  // Russian mail only: a well-formed gmail address is not sent to, mail.ru and vkus-com.ru are
  // только российская почта: по правильному адресу на gmail не шлём, на mail.ru и vkus-com.ru — шлём
  const mails = [];
  const { results, summary } = await deliver({
    model: om,
    settings: { ...settings, telegram_enabled: false, email_recipients: [{ email: 'boss@gmail.com' }, { email: 'kitchen@mail.ru' }, { email: 'zakaz@vkus-com.ru' }] },
    mail: { ok: true },
    sendMail: async (m) => mails.push(m),
    now: NOON,
  });
  assert.deepEqual(mails.map((m) => m.to), ['kitchen@mail.ru', 'zakaz@vkus-com.ru'], 'на gmail письмо даже не пытаемся отправить');
  assert.deepEqual(
    results.map((r) => [r.recipient, r.status, r.error, r.attempts]),
    [
      ['boss@gmail.com', 'failed', NOT_RU_REASON, 0],
      ['kitchen@mail.ru', 'sent', null, 1],
      ['zakaz@vkus-com.ru', 'sent', null, 1],
    ],
  );
  assert.equal(NOT_RU_REASON, 'не российская почта — исправьте в «Оповещениях»');
  assert.equal(summary, 'почта ✓ 2 из 3 · Telegram выключен · 12:05');
  // the only address foreign: the card names the reason / единственный адрес чужой — карточка называет причину
  const lone = await deliver({ model: om, settings: { ...settings, telegram_enabled: false, email_recipients: [{ email: 'a@gmail.com' }] }, mail: { ok: true }, sendMail: async () => assert.fail('не должно уйти'), now: NOON });
  assert.equal(lone.summary, `почта ✗ ${NOT_RU_REASON} · Telegram выключен · 12:05`);
  // a broken address keeps its own reason / кривой адрес — своя причина
  const broken = await deliver({ model: om, settings: { ...settings, telegram_enabled: false, email_recipients: [{ email: 'a@mail' }] }, mail: { ok: true }, sendMail: async () => assert.fail('не должно уйти'), now: NOON });
  assert.equal(broken.results[0].error, 'адрес с ошибкой');
  // POST /notify/test { to }: the same rule / то же правило для адреса проверки
  assert.equal(testAddressProblem('a@gmail.com'), `${RU_MAIL_ERROR_ADMIN}: a@gmail.com`);
  assert.equal(testAddressProblem(' Test@Mail.ru '), null);
  assert.equal(testAddressProblem('zakaz@vkus-com.ru'), null);
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
  assert.deepEqual(flat(telegramKeyboard({ id: 15, status: 'new' })), ['В работу|o:15:in_work', 'Отменить|o:15:cancel?']);
  assert.deepEqual(flat(telegramKeyboard({ id: 15, status: 'in_work' })), ['Выполнен|o:15:done', 'Отменить|o:15:cancel?']);
  assert.deepEqual(flat(telegramKeyboard({ id: 15, status: 'cancelled' })), ['Вернуть в работу|o:15:in_work']);
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
  assert.equal(historyLine({ status: 'in_work', who: 'Дмитрий Г.', via: 'telegram', at }, today), 'В работе — Дмитрий Г., 12:40');
  assert.equal(historyLine({ status: 'done', who: 'Ирина', via: 'admin', at }, new Date('2026-10-25T10:00:00Z')), 'Выполнен — Ирина · админка, 23.10 12:40');
  assert.equal(historyLine({ status: 'cancelled', who: '', via: 'system', at }, today), 'Отменён — без имени, 12:40');
  assert.equal(statusLogLine({ status: 'in_work', who: 'Дмитрий Г.', via: 'telegram', at }), '23.10 12:40 — В работе — Дмитрий Г. (Telegram)');
  assert.equal(statusLogLine({ status: 'done', who: 'Ирина', via: 'admin', at }), '23.10 12:40 — Выполнен — Ирина (админка)');

  // the memory on the order: a string from the database or an object, junk ignored
  // память у заказа: строка из базы или объект, мусор пропускается
  const blank = { messages: [], pending: [], pending_outcome: null, history: [], announced: false };
  assert.deepEqual(telegramMeta({}), blank);
  assert.deepEqual(telegramMeta({ telegram_meta: 'не json' }), blank);
  assert.deepEqual(
    telegramMeta({
      telegram_meta: JSON.stringify({
        messages: [{ chat: '-1', message_id: 7 }, null, { job: 3 }],
        pending: [{ chat: '-1', thread: '2', message_id: 8 }, { thread: '2' }],
        pending_outcome: { kind: 'paid', at: '2026-10-23T08:41:00Z' },
        history: [{ status: 'done' }, {}],
        announced: true,
      }),
    }),
    {
      messages: [{ chat: '-1', message_id: 7 }],
      pending: [{ chat: '-1', thread: '2', message_id: 8 }],
      pending_outcome: { kind: 'paid', at: '2026-10-23T08:41:00Z' },
      history: [{ status: 'done' }],
      announced: true,
    },
  );
  assert.equal(telegramMeta({ telegram_meta: { pending_outcome: { at: 'x' } } }).pending_outcome, null, 'исход без вида — нет исхода');

  // the payment line: online orders only / строка оплаты: только онлайн
  assert.equal(paymentLine({ payment_status: 'none' }), null);
  assert.equal(paymentLine({}), null);
  assert.equal(paymentLine({ payment_status: 'pending' }), 'Оплата: ждём оплату онлайн');
  assert.equal(paymentLine({ payment_status: 'paid', paid_at: at }, today), 'Оплата: оплачен онлайн, 12:40');
  assert.equal(paymentLine({ payment_status: 'failed' }), 'Оплата: оплата онлайн не прошла');
  assert.equal(paymentLine({ payment_status: 'refunded' }), 'Оплата: оплата возвращена');

  // a test-shop payment is marked everywhere: the headline, the payment line, the paid reply
  // оплата тестовым магазином помечена везде: заголовок, строка оплаты, ответ об оплате
  const trial = orderModel({ ...order, status: 'new', payment_status: 'paid', paid_at: at, payment_test: true }, { adminUrl: URL, now: today });
  assert.equal(sp(trial.headline), 'ТЕСТ · Заказ №1910-4821 — 2 450 ₽');
  assert.ok(trial.facts.includes('Оплата: тест · оплачен онлайн, 12:40'), trial.facts.join(' | '));
  assert.equal(orderModel({ ...order, payment_test: false }).headline.startsWith('ТЕСТ'), false);
  // the whole message with payment, history and buttons / всё сообщение с оплатой, историей и кнопками
  const live = orderModel(
    { ...order, status: 'in_work', payment_status: 'paid', paid_at: at, telegram_meta: { messages: [{ chat: '-1001234567890', message_id: 42 }], history: [{ status: 'in_work', who: 'Дмитрий Г.', via: 'telegram', at }] } },
    { adminUrl: URL, now: today },
  );
  const text = sp(telegramText(live));
  assert.ok(text.includes('Когда: Сегодня к 18:00\nОплата: оплачен онлайн, 12:40\n'), text);
  assert.ok(text.endsWith('не стучите\n\nВ работе — Дмитрий Г., 12:40\n\n<a href="' + URL + '">Открыть в админке</a>'), text);
  assert.deepEqual(live.keyboard.flat().map((b) => b.callback_data), ['o:15:done', 'o:15:cancel?']);
  assert.ok(sp(emailText(live)).includes('\n\nВ работе — Дмитрий Г., 12:40\n\nОткрыть в админке'));
  // the status notice and the request carry neither / у уведомления о статусе и у заявки ни того ни другого
  assert.equal(statusModel(live, 'done').keyboard, null);
  assert.deepEqual(statusModel(live, 'done').history, []);
  assert.equal(requestModel(request).keyboard, null);
  // the demo has no buttons: it is not an order anyone can move / у примера кнопок нет
  assert.equal(demoModel('order').keyboard, null);
}
{
  // the delivery sends the buttons and remembers the message / рассылка шлёт кнопки и запоминает сообщение
  const live = orderModel({ ...order, status: 'new' }, { adminUrl: URL });
  const { impl, calls } = fakeFetch([{ status: 200, body: { ok: true, result: { message_id: 42 } } }]);
  const { results } = await deliver({ model: live, settings: { ...settings, email_enabled: false }, mail: { ok: false, reason: 'x' }, fetchImpl: impl, sleep: noSleep, now: NOON });
  assert.deepEqual(calls[0].body.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['o:15:in_work', 'o:15:cancel?']);
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
  assert.deepEqual(a.calls[0].body, { timeout: 20, allowed_updates: ['callback_query', 'message', 'my_chat_member'] });
  assert.deepEqual(POLL_UPDATES, ['callback_query', 'message', 'my_chat_member'], 'опрос слышит и сообщения: чаты, темы, переезд группы');
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

// ── topics, «Неоформленные», a group turned supergroup, the chats the bot saw ──
// ── темы, «Неоформленные», группа-супергруппа, чаты, которые видел бот ───────
{
  const GROUP = '-1003012345678';
  // one supergroup, a topic per kind: General for orders, 4 for requests, 2 for «Неоформленные»
  // одна супергруппа, по теме на вид: General — заказы, 4 — заявки, 2 — «Неоформленные»
  const topics = normalizeSettings({
    telegram_enabled: true,
    telegram_token: TOKEN,
    email_enabled: false,
    telegram_chats: [
      { label: 'Заказы', chat_id: GROUP, thread_id: '', orders: true, requests: false, pending: false },
      { label: 'Заявки', chat_id: GROUP, thread_id: '4', orders: false, requests: true, pending: false },
      { label: 'Неоформленные', chat_id: GROUP, thread_id: '2', orders: false, requests: false, pending: true },
      // the same pair twice, typed differently: one recipient / та же пара другим почерком — один получатель
      { label: 'Дубль', chat_id: ` ${GROUP} `, thread_id: ' 2 ', orders: false, requests: false, pending: true },
      // «1» is General for Telegram: the same pair as the first row / «1» — это General: та же пара, что первая строка
      { label: 'General по ошибке', chat_id: GROUP, thread_id: '1', orders: true, requests: false },
    ],
  });

  // the ticks: «Заказы»/«Заявки» on unless unticked, «Неоформленные» only when ticked
  // галочки: «Заказы»/«Заявки» включены, пока не сняты, «Неоформленные» — только отмеченные
  assert.equal(wants({}, 'pending'), false, 'без галочки «Неоформленные» — нет');
  assert.equal(wants({ pending: true }, 'pending'), true);
  assert.equal(wants({ pending: false, orders: true }, 'pending'), false);
  assert.equal(wants({ pending: 'true' }, 'pending'), false, 'только настоящее true');
  assert.equal(wants({}, 'pending', true), true, 'проверка уходит всем');
  assert.equal(wants({}, 'order'), true, 'строка до галочек получает заказы, как раньше');
  assert.equal(wants({ pending: true }, 'order'), true, 'отсутствие «orders» — по-прежнему «да»');
  assert.equal(wants({ orders: false }, 'order_status'), false);
  assert.equal(wants({}, 'request_status'), true);

  // one recipient per chat+topic / получатель — пара чат+тема
  assert.equal(threadOf(' 4 '), '4');
  assert.equal(threadOf(4), '4');
  assert.equal(threadOf('1'), null, 'General — без темы');
  assert.equal(threadOf(''), null);
  assert.equal(threadOf(null), null);
  assert.equal(chatKey(' -1 ', ''), chatKey('-1', null));
  assert.equal(chatKey('-1', '1'), chatKey('-1'));
  assert.notEqual(chatKey('-1', '2'), chatKey('-1', '4'));
  assert.deepEqual(telegramChats(topics, 'order'), [{ id: GROUP, label: 'Заказы', thread: null }], 'General один раз');
  assert.deepEqual(telegramChats(topics, 'request'), [{ id: GROUP, label: 'Заявки', thread: '4' }]);
  assert.deepEqual(telegramChats(topics, 'pending'), [{ id: GROUP, label: 'Неоформленные', thread: '2' }], 'дубль схлопнут');
  assert.deepEqual(
    telegramChats(topics, 'order', true).map((c) => chatKey(c.id, c.thread)),
    [`${GROUP}|`, `${GROUP}|4`, `${GROUP}|2`],
    'проверка: каждая тема по разу',
  );
  // rows that only name their own tick still get orders and requests: untick them explicitly
  // строки, где названа только своя галочка, получают и заказы, и заявки — снимать явно
  const loose = normalizeSettings({
    telegram_chats: [{ chat_id: GROUP, orders: true }, { chat_id: GROUP, thread_id: '4', requests: true }, { chat_id: GROUP, thread_id: '2', pending: true }],
  });
  assert.equal(telegramChats(loose, 'order').length, 3, 'без orders:false заказ уйдёт во все три темы');
  assert.equal(telegramChats(loose, 'pending').length, 1);

  // the order goes to General without a thread id, the request into topic 4
  // заказ — в General без id темы, заявка — в тему 4
  const live = orderModel({ ...order, status: 'new' }, { adminUrl: URL });
  const o = fakeFetch([{ status: 200, body: { ok: true, result: { message_id: 50 } } }]);
  const sent = await deliver({ model: live, settings: topics, mail: { ok: false, reason: 'x' }, fetchImpl: o.impl, sleep: noSleep, now: NOON });
  assert.equal(o.calls.length, 1);
  assert.equal(o.calls[0].body.chat_id, GROUP);
  assert.ok(!('message_thread_id' in o.calls[0].body), 'General — без message_thread_id');
  assert.equal(sent.summary, 'почта выключена · Telegram ✓ · 12:05');
  assert.deepEqual([sent.results[0].chat, sent.results[0].thread, sent.results[0].messageId], [GROUP, null, 50]);
  const q = fakeFetch([{ status: 200, body: { ok: true, result: { message_id: 51 } } }]);
  const req = await deliver({ model: rm, settings: topics, mail: { ok: false, reason: 'x' }, fetchImpl: q.impl, sleep: noSleep, now: NOON });
  assert.equal(q.calls[0].body.message_thread_id, 4, 'id темы — числом');
  assert.equal(req.results[0].thread, '4');
  assert.equal(req.results[0].recipient, `Заявки (${GROUP}, тема 4)`);
  // a typo in «Тема (ID)» is not quietly turned into General / опечатка в «Теме (ID)» не превращается молча в General
  const typo = fakeFetch([{ status: 400, body: { ok: false, description: 'Bad Request: message thread not found' } }]);
  const bad = await sendTelegram({ token: TOKEN, chatId: GROUP, threadId: '2a', text: 'x', fetchImpl: typo.impl, sleep: noSleep });
  assert.equal(typo.calls[0].body.message_thread_id, '2a');
  assert.equal(bad.error, 'тема не найдена: проверьте «Тему (ID)» и что в группе включены темы');
  const general = fakeFetch([{ status: 200, body: { ok: true } }]);
  await sendTelegram({ token: TOKEN, chatId: GROUP, threadId: '1', text: 'x', fetchImpl: general.impl, sleep: noSleep });
  assert.ok(!('message_thread_id' in general.calls[0].body), '«1» — General, без id');

  // «Начал оформление»: short, no buttons, no emoji / коротко, без кнопок и без эмодзи
  const ADMIN = 'https://admin.vkus-com.ru/admin/content/orders/23';
  const waiting = {
    id: 23,
    number: '1023-4812',
    customer_name: 'Анна <Тест>',
    phone: '+7 919 111-11-11',
    fulfillment: 'delivery',
    address: 'Советской Армии, 177',
    address_flat: '12',
    delivery_zone: 'Рядом с нами',
    items: JSON.stringify([
      { title: 'Торт «Наполеон» (1 кг)', qty: 1, sum: 1500 },
      { title: 'Морс', qty: 2, sum: 300 },
      { title: 'Пирожок', qty: 1, sum: 50 },
    ]),
    total: 1850,
    payment_method: 'online',
    payment_status: 'pending',
    status: 'new',
    source: 'site',
  };
  const pm = pendingModel(waiting, { adminUrl: ADMIN });
  assert.equal(pm.kind, 'pending');
  assert.equal(pm.keyboard, null, 'без кнопок');
  assert.equal(
    sp(telegramText(pm)),
    [
      '<b>Корзина №1023-4812 на 1 850 ₽, ждём оплату</b>',
      'Анна &lt;Тест&gt;, +7 919 111-11-11',
      'Состав: Торт «Наполеон» (1 кг) ×1, Морс ×2, Пирожок ×1',
      'Доставка: Советской Армии, 177, кв. 12',
      '',
      `<a href="${ADMIN}">Открыть в админке</a>`,
    ].join('\n'),
  );
  assert.ok(!/\p{Extended_Pictographic}/u.test(telegramText(pm)), 'ни одного эмодзи');
  // more than three dishes: «и ещё N» / больше трёх блюд — «и ещё N»
  const many = pendingModel({ ...waiting, items: [...JSON.parse(waiting.items), { title: 'Чай', qty: 3 }, { title: 'Кофе', qty: 1 }] });
  assert.equal(many.facts[0], 'Состав: Торт «Наполеон» (1 кг) ×1, Морс ×2, Пирожок ×1 и ещё 2');
  // pickup, the test shop / самовывоз, тестовый магазин
  const trial = pendingModel({ ...waiting, fulfillment: 'pickup', payment_test: true }, { place: 'Садовая' });
  assert.equal(sp(trial.headline), 'ТЕСТ · Корзина №1023-4812 на 1 850 ₽, ждём оплату');
  assert.equal(trial.facts.at(-1), 'Самовывоз: Садовая');
  assert.ok(!/\p{Extended_Pictographic}/u.test(telegramText(trial)));
  // an empty or broken composition: no «Состав» line, nothing breaks / пустой или битый состав
  for (const items of ['[]', null, 'не json', JSON.stringify([null, 5])]) {
    const empty = pendingModel({ ...waiting, items });
    assert.deepEqual(empty.facts, ['Доставка: Советской Армии, 177, кв. 12'], String(items));
  }
  assert.equal(pendingModel({ ...waiting, items: [{ title: '', qty: null }] }).facts[0], 'Состав: блюдо ×1');
  // the outcome line, appended by the edit / строка исхода, которую дописывает правка
  assert.equal(pendingOutcomeLine({ kind: 'paid', at: '2026-10-23T08:41:00Z' }), 'Оплачен в 12:41, ушёл в заказы');
  assert.equal(pendingOutcomeLine({ kind: 'unpaid', at: '2026-10-23T08:50:00Z' }), 'Не оплачен: отменён 12:50');
  assert.equal(pendingOutcomeLine({ kind: 'on_delivery', at: '2026-10-23T08:45:00Z' }), 'Выбрал оплату при получении в 12:45, ушёл в заказы');
  assert.equal(pendingOutcomeLine(null), null);
  assert.equal(pendingOutcomeLine({ kind: 'странное' }), null);
  const paidText = sp(telegramText(pendingModel({ ...waiting, telegram_meta: { pending: [{ chat: GROUP, thread: '2', message_id: 51 }], pending_outcome: { kind: 'paid', at: '2026-10-23T08:41:00Z' } } }, { adminUrl: ADMIN })));
  assert.ok(paidText.startsWith(sp(telegramText(pm)).split('\n\n<a')[0]), 'тот же текст…');
  assert.ok(paidText.endsWith(`\n\nОплачен в 12:41, ушёл в заказы\n\n<a href="${ADMIN}">Открыть в админке</a>`), paidText);

  // «Неоформленные» delivery: topic 2 only, no buttons, the card's tail / рассылка: только тема 2, без кнопок, хвост карточки
  const p = fakeFetch([{ status: 200, body: { ok: true, result: { message_id: 52 } } }]);
  const pend = await deliverPending({ model: pm, settings: topics, fetchImpl: p.impl, sleep: noSleep });
  assert.equal(pend.part, 'Неоформленные ✓');
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].body.chat_id, GROUP);
  assert.equal(p.calls[0].body.message_thread_id, 2);
  assert.equal(p.calls[0].body.reply_markup, undefined);
  assert.deepEqual([pend.results[0].thread, pend.results[0].messageId], ['2', 52]);
  assert.deepEqual(await deliverPending({ model: pm, settings }), { results: [], part: null }, 'галочки нет ни у кого — хвоста нет');
  assert.deepEqual(await deliverPending({ model: pm, settings: { ...topics, telegram_enabled: false } }), { results: [], part: null });
  assert.equal((await deliverPending({ model: pm, settings: { ...topics, telegram_token: '' } })).part, 'Неоформленные ✗ нет токена бота');
  const lostTopic = fakeFetch([{ status: 400, body: { ok: false, description: 'Bad Request: message thread not found' } }]);
  assert.match((await deliverPending({ model: pm, settings: topics, fetchImpl: lostTopic.impl, sleep: noSleep })).part, /^Неоформленные ✗ тема не найдена/);
  const queued = fakeFetch([{ status: 202, body: { ok: true, queued: true, job: 9 } }]);
  const inQueue = await deliverPending({ model: pm, settings: topics, fetchImpl: queued.impl, sleep: noSleep, bases: ['http://relay:8787', TELEGRAM_API] });
  assert.equal(inQueue.part, 'Неоформленные ⏳ в очереди');
  assert.equal(inQueue.results[0].job, 9);

  // the group became a supergroup: once more into the new chat, and say so
  // группа стала супергруппой: ещё раз в новый чат и сказать об этом
  const OLD = '-4001234567';
  const NEW = '-1009876543210';
  const upgraded = (to) => ({ status: 400, body: { ok: false, error_code: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: Number(to) } } });
  const mv = fakeFetch([upgraded(NEW), { status: 200, body: { ok: true, result: { message_id: 5 } } }]);
  const moved = await sendTelegram({ token: TOKEN, chatId: OLD, threadId: '2', text: 'x', fetchImpl: mv.impl, sleep: noSleep });
  assert.equal(moved.status, 'sent');
  assert.equal(moved.migratedTo, NEW);
  assert.equal(moved.result.message_id, 5);
  assert.deepEqual(mv.calls.map((c) => c.body.chat_id), [OLD, NEW]);
  assert.equal(mv.calls[1].body.message_thread_id, 2, 'тема та же');
  // only once: a second upgrade answer is a failure, not a loop / только раз: второй такой ответ — ошибка, не цикл
  const twice = fakeFetch([upgraded(NEW), upgraded('-1001111111111')]);
  const stuck = await sendTelegram({ token: TOKEN, chatId: OLD, text: 'x', fetchImpl: twice.impl, sleep: noSleep });
  assert.equal(stuck.status, 'failed');
  assert.equal(twice.calls.length, 2);
  assert.equal(stuck.error, 'группа стала супергруппой: chat_id сменился');
  assert.equal(stuck.migratedTo, NEW);
  // a plain 400 is not a move; a call without a chat is never moved / обычный 400 — не переезд
  const plain = fakeFetch([{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }]);
  const notMoved = await sendTelegram({ token: TOKEN, chatId: OLD, text: 'x', fetchImpl: plain.impl, sleep: noSleep });
  assert.equal(notMoved.migratedTo, undefined);
  assert.equal(plain.calls.length, 1);
  const noChat = fakeFetch([upgraded(NEW)]);
  const cb = await telegramCall({ token: TOKEN, method: 'answerCallbackQuery', payload: { callback_query_id: 'x' }, fetchImpl: noChat.impl, sleep: noSleep, delays: [] });
  assert.equal(cb.migratedTo, undefined);
  // through the relay the same / через ретранслятор так же
  const viaRelay = fakeFetch([upgraded(NEW), { status: 200, body: { ok: true, result: { message_id: 6 } } }]);
  const relayed = await sendTelegram({ token: TOKEN, chatId: OLD, text: 'x', fetchImpl: viaRelay.impl, sleep: noSleep, bases: ['http://relay:8787', TELEGRAM_API] });
  assert.equal(relayed.migratedTo, NEW);
  assert.ok(viaRelay.calls.every((c) => c.url.startsWith('http://relay:8787/')));
  // an edit follows it too / правка тоже следует за ним
  const ed = fakeFetch([upgraded(NEW), { status: 400, body: { ok: false, description: 'Bad Request: message to edit not found' } }]);
  const edit = await editTelegram({ token: TOKEN, chatId: OLD, messageId: 42, text: 't', fetchImpl: ed.impl, sleep: noSleep });
  assert.equal(edit.migratedTo, NEW);
  assert.match(edit.error, /message to edit not found/);
  // the delivery remembers the new chat and reports the move / рассылка запоминает новый чат и сообщает о переезде
  const dm = fakeFetch([upgraded(NEW), { status: 200, body: { ok: true, result: { message_id: 7 } } }]);
  const oldSettings = normalizeSettings({ telegram_enabled: true, telegram_token: TOKEN, email_enabled: false, telegram_chats: [{ label: 'Заказы', chat_id: OLD }] });
  const dr = await deliver({ model: live, settings: oldSettings, mail: { ok: false, reason: 'x' }, fetchImpl: dm.impl, sleep: noSleep, now: NOON });
  assert.deepEqual([dr.results[0].chat, dr.results[0].migratedFrom, dr.results[0].migratedTo, dr.results[0].recipient], [NEW, OLD, NEW, `Заказы (${NEW})`]);
  assert.equal(dr.summary, 'почта выключена · Telegram ✓ · 12:05');
  // the service messages of both sides / служебные сообщения обеих сторон
  assert.deepEqual(migrationFromUpdate({ update_id: 1, message: { message_id: 9, chat: { id: Number(OLD), type: 'group', title: 'ВК - ЗАКАЗЫ' }, migrate_to_chat_id: Number(NEW) } }), { from: OLD, to: NEW });
  assert.deepEqual(migrationFromUpdate({ update_id: 2, message: { message_id: 1, chat: { id: Number(NEW), type: 'supergroup' }, migrate_from_chat_id: Number(OLD) } }), { from: OLD, to: NEW });
  assert.equal(migrationFromUpdate({ update_id: 3, message: { chat: { id: 1 }, text: 'привет' } }), null);
  assert.equal(migrationFromUpdate({ update_id: 4, callback_query: { id: 'x' } }), null);
  // the settings follow: every row of the old chat, its topic and ticks kept / настройки: все строки старого чата, тема и галочки на месте
  const rows = [{ label: 'Неоформленные', chat_id: OLD, thread_id: '2', pending: true }, { label: 'Лично', chat_id: '546757654' }, { label: 'Заказы', chat_id: ` ${OLD} ` }];
  const mig = migrateChats(rows, OLD, NEW);
  assert.equal(mig.changed, 2);
  assert.deepEqual(mig.rows[0], { label: 'Неоформленные', chat_id: NEW, thread_id: '2', pending: true });
  assert.equal(mig.rows[1], rows[1], 'чужая строка не тронута');
  assert.equal(mig.rows[2].chat_id, NEW);
  assert.deepEqual(migrateChats(rows, '-1', NEW).changed, 0);

  // the chats and topics the bot saw: never what people wrote / чаты и темы, которые видел бот: без текстов людей
  const AT = new Date('2026-10-23T15:00:00Z');
  const forum = { id: Number(NEW), type: 'supergroup', title: 'ВК - ЗАКАЗЫ', is_forum: true };
  const inTopic = {
    update_id: 10,
    message: {
      message_id: 100,
      message_thread_id: 2,
      is_topic_message: true,
      chat: forum,
      from: { id: 5, first_name: 'Дмитрий' },
      text: 'секретный текст гостя',
      reply_to_message: { message_id: 2, message_thread_id: 2, chat: forum, forum_topic_created: { name: 'Неоформленные', icon_color: 7322096 } },
    },
  };
  const seenTopic = seenFromUpdate(inTopic, AT);
  assert.deepEqual(seenTopic, {
    chat_id: NEW,
    title: 'ВК - ЗАКАЗЫ',
    thread_id: '2',
    topic: 'Неоформленные',
    last_seen: AT.toISOString(),
    label: `ВК - ЗАКАЗЫ · тема «Неоформленные» · chat_id ${NEW} · Тема (ID) 2`,
  });
  assert.ok(!JSON.stringify(seenTopic).includes('секретный'), 'текст сообщения не хранится');
  // General: no thread id at all / General: id темы нет вовсе
  const inGeneral = seenFromUpdate({ update_id: 11, message: { message_id: 101, chat: forum, text: 'x' } }, AT);
  assert.deepEqual([inGeneral.thread_id, inGeneral.topic], [null, null]);
  assert.equal(inGeneral.label, `ВК - ЗАКАЗЫ · General, «Тему (ID)» не заполнять · chat_id ${NEW}`);
  // a reply in a plain supergroup carries a thread id, but it is no topic / ответ в обычной супергруппе — не тема
  const reply = seenFromUpdate({ update_id: 12, message: { message_id: 102, message_thread_id: 77, chat: { id: -1002, type: 'supergroup', title: 'Кухня' }, reply_to_message: { message_id: 77 } } }, AT);
  assert.deepEqual([reply.thread_id, reply.label], [null, 'Кухня · chat_id -1002']);
  // a topic is created / создана тема
  assert.equal(seenFromUpdate({ update_id: 13, message: { message_id: 6, message_thread_id: 6, is_topic_message: true, chat: forum, forum_topic_created: { name: 'Кухня' } } }, AT).topic, 'Кухня');
  // the private chat / личный чат
  const direct = seenFromUpdate({ update_id: 14, message: { message_id: 1, chat: { id: 546757654, type: 'private', first_name: 'Дмитрий', last_name: 'Г' }, text: '/start' } }, AT);
  assert.deepEqual([direct.chat_id, direct.title, direct.label], ['546757654', 'Дмитрий Г', 'Дмитрий Г · личный чат · chat_id 546757654']);
  // the bot added to a group counts, removed — not / бота добавили — считается, убрали — нет
  assert.equal(seenFromUpdate({ update_id: 15, my_chat_member: { chat: forum, new_chat_member: { status: 'administrator' } } }, AT).thread_id, null);
  assert.equal(seenFromUpdate({ update_id: 16, my_chat_member: { chat: forum, new_chat_member: { status: 'kicked' } } }, AT), null);
  assert.equal(seenFromUpdate({ update_id: 17, callback_query: { id: 'x' } }, AT), null);

  // the list: one row per pair, a known topic name kept, at most once in 10 s, at most 30
  // список: строка на пару, известное название темы хранится, не чаще раза в 10 с, не больше 30
  const first = mergeSeen([], [seenTopic]);
  assert.deepEqual([first.changed, first.list.length, first.added.length], [true, 1, 1]);
  // a reply inside the topic does not carry its name / ответ внутри темы не несёт её названия
  const later = () => ({ ...inTopic, message: { ...inTopic.message, reply_to_message: { message_id: 100, chat: forum } } });
  const soon = seenFromUpdate(later(), new Date(AT.getTime() + 5_000));
  assert.equal(soon.topic, null);
  const quiet = mergeSeen(first.list, [soon]);
  assert.equal(quiet.changed, false, 'та же тема через 5 с — не писать');
  assert.equal(quiet.list[0].last_seen, AT.toISOString());
  const after = mergeSeen(first.list, [seenFromUpdate(later(), new Date(AT.getTime() + 11_000))]);
  assert.equal(after.changed, true, 'через 11 с — обновить');
  assert.deepEqual([after.list[0].topic, after.list[0].label, after.added.length], ['Неоформленные', seenTopic.label, 0]);
  const renamed = mergeSeen(first.list, [{ ...soon, title: 'ВК - ЗАКАЗЫ (новое имя)' }]);
  assert.equal(renamed.changed, true, 'новое имя чата пишется сразу');
  const crowd = Array.from({ length: SEEN_LIMIT + 5 }, (_, i) =>
    seenFromUpdate({ update_id: 100 + i, message: { message_id: 1, chat: { id: 1000 + i, type: 'private', first_name: `Гость ${i}` } } }, new Date(AT.getTime() + i * 1000)),
  );
  const full = mergeSeen([null, {}, ...first.list], crowd);
  assert.equal(full.list.length, SEEN_LIMIT);
  assert.equal(full.list[0].chat_id, String(1000 + SEEN_LIMIT + 4), 'свежие сверху');
  assert.ok(!full.list.some((e) => e.chat_id === NEW), 'самое давнее вытеснено');
  assert.equal(SEEN_LIMIT, 30);
}

// ── email-guard: Russian mail only / только российская почта ────────────────
{
  // one address: a guest — Russian services; the admin — also vkus-com.ru; empty — clearing, allowed
  // один адрес: гость — российские службы; админка — ещё и vkus-com.ru; пусто — очистка, можно
  assert.equal(emailProblem('anna@gmail.com'), RU_MAIL_ERROR);
  assert.equal(emailProblem(' Anna@Mail.RU '), null);
  assert.equal(emailProblem('anna@yandex.ru'), null);
  assert.equal(emailProblem('anna@vk.com'), null);
  assert.equal(emailProblem('zakaz@vkus-com.ru'), RU_MAIL_ERROR, 'гостю свой домен не предлагается');
  assert.equal(emailProblem('zakaz@vkus-com.ru', { own: true }), null);
  assert.equal(emailProblem('a@outlook.com', { own: true }), RU_MAIL_ERROR_ADMIN);
  assert.equal(emailProblem('anna@mail.ru.evil.com'), RU_MAIL_ERROR, 'поддомен чужого сайта — не mail.ru');
  assert.equal(emailProblem('anna@'), RU_MAIL_ERROR, 'кривой адрес — не российский');
  for (const empty of [null, undefined, '', '   ']) assert.equal(emailProblem(empty), null);

  // the alert recipients: one text per foreign address, an array or a JSON string alike
  // получатели оповещений: по тексту на чужой адрес, массив и строка JSON одинаково
  const list = [{ email: 'a@gmail.com', orders: true }, { email: 'b@mail.ru' }, { email: 'c@vkus-com.ru', label: 'Кухня' }, { email: 'A@gmail.com' }, { email: 'd@icloud.com' }, { email: '' }];
  const want = [`${RU_MAIL_ERROR_ADMIN}: a@gmail.com`, `${RU_MAIL_ERROR_ADMIN}: d@icloud.com`];
  assert.deepEqual(recipientProblems(list), want, 'дубль другим регистром — один раз, пустой — пропущен');
  assert.deepEqual(recipientProblems(JSON.stringify(list)), want);
  assert.deepEqual(recipientProblems([{ email: 'b@mail.ru' }, { email: 'c@vkus-com.ru' }]), []);
  for (const empty of [null, undefined, '', '[]', []]) assert.deepEqual(recipientProblems(empty), []);
  assert.equal(recipientProblems('не JSON').length, 1);
  assert.equal(recipientsError(list), `${RU_MAIL_ERROR_ADMIN}: a@gmail.com, d@icloud.com`);
  assert.equal(recipientsError([{ email: 'b@mail.ru' }]), null);

  // the hook's rules: only the field in the payload is checked, a batch item by item
  // правила хука: проверяется только поле из payload, пачка — по записи
  const rule = (event) => RULES.find((r) => r.events.includes(event));
  assert.deepEqual(RULES.flatMap((r) => r.events).sort(), [
    'notify_settings.items.create', 'notify_settings.items.update', 'settings.items.create', 'settings.items.update', 'users.create', 'users.update',
  ]);
  assert.equal(payloadProblem(rule('users.update'), { recovery_email: 'x@gmail.com' }), RU_MAIL_ERROR);
  assert.equal(payloadProblem(rule('users.update'), { recovery_email: 'x@mail.ru' }), null);
  assert.equal(payloadProblem(rule('users.update'), { recovery_email: null }), null, 'очистка');
  assert.equal(payloadProblem(rule('users.update'), { recovery_email: '' }), null, 'очистка');
  assert.equal(payloadProblem(rule('users.update'), { first_name: 'Анна' }), null, 'поля нет — не трогаем');
  assert.equal(payloadProblem(rule('users.create'), [{ recovery_email: 'x@mail.ru' }, { recovery_email: 'y@outlook.com' }]), RU_MAIL_ERROR);
  assert.equal(payloadProblem(rule('notify_settings.items.update'), { email_recipients: [{ email: 'a@gmail.com' }] }), `${RU_MAIL_ERROR_ADMIN}: a@gmail.com`);
  assert.equal(payloadProblem(rule('notify_settings.items.update'), { email_recipients: '[{"email":"zakaz@vkus-com.ru"}]' }), null);
  assert.equal(payloadProblem(rule('notify_settings.items.update'), { telegram_enabled: true }), null);
  assert.equal(payloadProblem(rule('settings.items.update'), { email: 'x@gmail.com' }), RU_MAIL_ERROR_ADMIN);
  assert.equal(payloadProblem(rule('settings.items.update'), { email: 'info@vkus-com.ru' }), null);
  assert.equal(payloadProblem(rule('settings.items.update'), { email: null }), null);
}

console.log('оповещения: темы, тексты, повторы Telegram, кнопки и опрос нажатий, темы форума и «Неоформленные», переезд группы, виденные чаты, почта без SMTP, только российская почта — проверки прошли');
