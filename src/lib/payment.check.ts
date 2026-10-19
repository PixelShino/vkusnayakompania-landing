/**
 * Проверка денежной части онлайн-оплаты: копейки, корзина для чека, статусы
 * банка, подпись уведомления, номер заказа в банке — и что сайт
 * (`src/lib/payment.ts`) и расширение (`directus/extensions/pay/core.js`)
 * считают одинаково. Ошибка здесь — это неверная сумма в банке или чек, который
 * касса не примет, поэтому проверяется до выкладки.
 * Запуск: `pnpm test` (Node читает TypeScript сам).
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import * as site from './payment.ts';

const core = await import('../../directus/extensions/pay/core.js');

// ── копейки ──────────────────────────────────────────────────────────────────
for (const [rub, kop] of [
  [1850, 185000],
  [0, 0],
  [99.9, 9990],
  [0.29, 29],
  [1.005, 101],
  ['685', 68500],
] as const) {
  assert.equal(site.toKopecks(rub), kop, `toKopecks(${rub})`);
  assert.equal(core.toKopecks(rub), kop, `core.toKopecks(${rub})`);
}
for (const bad of [-1, 'abc', null, undefined, '', NaN, Infinity, true]) {
  assert.equal(site.toKopecks(bad), null, `toKopecks(${String(bad)}) — не сумма`);
  assert.equal(core.toKopecks(bad), null, `core.toKopecks(${String(bad)}) — не сумма`);
}

// ── корзина для чека ─────────────────────────────────────────────────────────
const lines = [
  { product: 12, title: 'Торт «Лего» (2 кг, Сникерс)', qty: 1, price: 4200 },
  { product: 7, title: 'Морс\nклюквенный  0,5 л', qty: 3, price: 150 },
];
const options = { vat: 0, method: 4, object: 1, phone: '+7 987 955-25-65' };
const bundle = site.buildBundle(lines, options);
assert.deepEqual(bundle, core.buildBundle(lines, options), 'сайт и расширение собирают одну корзину');
assert.equal(bundle.cartItems.items.length, 2);
const [cake, juice] = bundle.cartItems.items;
assert.equal(cake.positionId, '1');
assert.equal(cake.itemPrice, 420000);
assert.equal(cake.itemAmount, 420000);
assert.equal(juice.itemAmount, 45000, 'сумма позиции = цена × количество');
assert.deepEqual(juice.quantity, { value: 3, measure: 0 });
assert.equal(juice.name, 'Морс клюквенный 0,5 л', 'перевод строки и двойной пробел в чек не идут');
assert.equal(cake.itemCode, '12-1');
assert.deepEqual(cake.tax, { taxType: 0 });
assert.deepEqual(cake.itemAttributes.attributes, [
  { name: 'paymentMethod', value: '4' },
  { name: 'paymentObject', value: '1' },
]);
assert.deepEqual(bundle.customerDetails, { phone: '79879552565' }, 'чек — на телефон гостя, цифрами');
assert.equal(site.bundleTotal(bundle), 465000, 'корзина сходится с суммой заказа');
assert.equal(core.bundleTotal(bundle), 465000);
// длинное название режется до 100 знаков с многоточием, пустое получает имя
const long = site.buildBundle([{ title: 'Т'.repeat(140), qty: 1, price: 1 }], options).cartItems.items[0];
assert.equal(long.name.length, 100);
assert.ok(long.name.endsWith('…'));
assert.equal(site.receiptName('   '), 'Позиция заказа');
assert.equal(core.receiptName('   '), 'Позиция заказа');
// без телефона — без `customerDetails`; кривой телефон тоже не уходит
assert.equal(site.buildBundle(lines, { ...options, phone: null }).customerDetails, undefined);
assert.equal(site.buildBundle(lines, { ...options, phone: '12345' }).customerDetails, undefined);
// строку без цены или с дробным количеством в чек не собрать
assert.throws(() => site.buildBundle([{ title: 'x', qty: 1.5, price: 10 }], options));
assert.throws(() => core.buildBundle([{ title: 'x', qty: 1, price: -10 }], options));

// ── статус в банке ───────────────────────────────────────────────────────────
const statuses: [Parameters<typeof site.alfaState>[0], site.BankState][] = [
  [{ orderStatus: 0 }, 'pending'],
  [{ orderStatus: 5 }, 'pending'],
  [{ orderStatus: 1 }, 'paid'],
  [{ orderStatus: 2 }, 'paid'],
  [{ orderStatus: '2' }, 'paid'],
  [{ orderStatus: 3 }, 'failed'],
  [{ orderStatus: 6 }, 'failed'],
  [{ orderStatus: 4 }, 'refunded'],
  // полный возврат виден в суммах, даже если статус ещё «оплачен»
  [{ orderStatus: 2, paymentAmountInfo: { depositedAmount: 185000, refundedAmount: 185000 } }, 'refunded'],
  // частичный возврат — заказ остаётся оплаченным
  [{ orderStatus: 2, paymentAmountInfo: { depositedAmount: 185000, refundedAmount: 50000 } }, 'paid'],
  [{}, 'pending'],
  [{ orderStatus: null }, 'pending'],
];
for (const [response, state] of statuses) {
  assert.equal(site.alfaState(response), state, `alfaState(${JSON.stringify(response)})`);
  assert.equal(core.alfaState(response), state, `core.alfaState(${JSON.stringify(response)})`);
}

// ── подпись уведомления ──────────────────────────────────────────────────────
const callback = { mdOrder: 'a1b2', orderNumber: '1910-4821-57', operation: 'deposited', status: '1', sign_alias: 'k1' };
const source = 'mdOrder;a1b2;operation;deposited;orderNumber;1910-4821-57;status;1;';
assert.equal(site.checksumSource(callback), source, 'параметры по алфавиту, без sign_alias и checksum');
assert.equal(core.checksumSource({ ...callback, checksum: 'X' }), source);
const key = 'secret-key';
const signed = { ...callback, checksum: createHmac('sha256', key).update(source).digest('hex').toUpperCase() };
assert.equal(core.verifyChecksum(signed, key), true, 'верная подпись принимается');
assert.equal(core.verifyChecksum({ ...signed, checksum: signed.checksum.toLowerCase() }, key), true, 'регистр подписи не важен');
assert.equal(core.verifyChecksum({ ...signed, status: '0' }, key), false, 'подменённый статус ломает подпись');
assert.equal(core.verifyChecksum(signed, 'other-key'), false, 'чужой ключ');
assert.equal(core.verifyChecksum(callback, key), false, 'нет подписи — подделка');
// пример из документации шлюза (раздел callback, симметричная подпись): ключ,
// параметры и подпись взяты оттуда как есть
const documented = {
  mdOrder: '06cf5599-3f17-7c86-bdbc-bd7d00a8b38b',
  operation: 'approved',
  orderNumber: '2003',
  status: '1',
  checksum: 'EAF2FB72CAB99FD5067F4BA493DD84F4D79C1589FDE8ED29622F0F07215AA972',
};
assert.equal(core.verifyChecksum(documented, 'ooc7slpvc61k7sf7ma7p4hrefr'), true, 'подпись из документации банка сходится');

// ── номер заказа в банке ─────────────────────────────────────────────────────
assert.equal(site.bankOrderNumber('1910-4821', 57), '1910-4821-57');
assert.equal(site.bankOrderNumber('1910-4821', 57, 2), '1910-4821-57r2');
assert.equal(core.bankOrderNumber('1910-4821-12', 57, 3), '1910-4821-12-57r3');
assert.deepEqual(site.parseBankOrderNumber('1910-4821-57'), { id: 57, attempt: 1 });
assert.deepEqual(core.parseBankOrderNumber('1910-4821-57r2'), { id: 57, attempt: 2 });
assert.deepEqual(core.parseBankOrderNumber('1910-4821-12-57r3'), { id: 57, attempt: 3 });
assert.deepEqual(core.parseBankOrderNumber('1910-4821-12-57'), { id: 57, attempt: 1 }, 'хвост от совпадения номера — не попытка');
assert.equal(site.parseBankOrderNumber('hello'), null);
assert.ok(site.bankOrderNumber('1910-4821-12', 1234567890, 10).length <= 32, 'не длиннее 32 знаков');

// ── настройки: окружение важнее админки, заглушка не работает в бою ──────────
const row = { online_enabled: true, provider: 'alfa', mode: 'test', alfa_login: 'shop-api', alfa_password: 'admin-pass', site_url: 'https://vkus-com.ru/' };
const fromAdmin = core.resolveSettings(row, {});
assert.equal(fromAdmin.enabled, true);
assert.equal(fromAdmin.password, 'admin-pass');
assert.equal(fromAdmin.gateway, 'https://alfa.rbsuat.com/payment/rest/', 'тест по умолчанию — тестовый шлюз');
assert.equal(fromAdmin.siteUrl, 'https://vkus-com.ru');
assert.equal(fromAdmin.sources.password, 'admin');
const fromEnv = core.resolveSettings(row, { PAY_ALFA_PASSWORD: 'env-pass', PAY_MODE: 'prod', PAY_ENABLED: 'false' });
assert.equal(fromEnv.password, 'env-pass', 'пароль из окружения важнее поля');
assert.equal(fromEnv.sources.password, 'env');
assert.equal(fromEnv.mode, 'prod');
assert.equal(fromEnv.enabled, false, 'PAY_ENABLED=false выключает оплату поверх админки');
assert.match(fromEnv.gateway, /^https:\/\/[^/]+alfabank\.ru\/payment\/rest\/$/, 'бой — боевой шлюз');
// число из окружения Directus может прийти числом — остаётся строкой
assert.equal(core.resolveSettings(row, { PAY_ALFA_PASSWORD: 12345 }).password, '12345');
const stub = core.resolveSettings({ ...row, provider: 'mock', mode: 'prod' }, {});
assert.equal(stub.enabled, false, 'заглушка в боевом режиме выключена');
assert.equal(stub.stubInProd, true);
assert.equal(core.resolveSettings({ ...row, provider: 'mock' }, {}).enabled, true, 'заглушка в тесте работает');
assert.equal(core.resolveSettings(null, {}).enabled, false, 'нет записи — оплата выключена');
assert.equal(core.resolveSettings({ ...row, provider: 'evil' }, {}).provider, 'alfa');
// публичная часть не несёт секретов
const shown = JSON.stringify(core.publicConfig(fromAdmin));
for (const secret of ['shop-api', 'admin-pass', 'rbsuat']) assert.ok(!shown.includes(secret), `в /pay/config нет «${secret}»`);

// ── возврат на сайт: только разрешённые адреса, без открытого редиректа ─────
const allowed = ['https://vkus-com.ru', 'https://www.vkus-com.ru'];
assert.deepEqual(core.returnTarget({ origin: 'https://www.vkus-com.ru', path: '/catalog/', allowed }), { site: 'https://www.vkus-com.ru', path: '/catalog/' });
assert.deepEqual(core.returnTarget({ origin: 'https://evil.example', path: '/catalog/', allowed, siteUrl: 'https://vkus-com.ru' }), {
  site: 'https://vkus-com.ru',
  path: '/catalog/',
});
assert.equal(core.returnTarget({ origin: 'https://vkus-com.ru', path: '//evil.example/x', allowed })?.path, '/catalog/');
assert.equal(core.returnTarget({ origin: 'https://vkus-com.ru', path: 'javascript:alert(1)', allowed })?.path, '/catalog/');
assert.equal(core.returnTarget({ origin: null, path: '/', allowed: [], siteUrl: '' }), null);
assert.equal(
  core.resultUrl({ site: 'https://vkus-com.ru', path: '/catalog/' }, 'fail', '1910-4821', 'declined'),
  'https://vkus-com.ru/catalog/?pay=fail&order=1910-4821&why=declined',
);

// ── сторона сайта: возврат, запись, настройки ───────────────────────────────
assert.deepEqual(site.readPayReturn('?pay=ok&order=1910-4821'), { state: 'ok', number: '1910-4821', why: null });
assert.deepEqual(site.readPayReturn('?pay=fail&order=1910-4821-12&why=expired'), { state: 'fail', number: '1910-4821-12', why: 'expired' });
assert.equal(site.readPayReturn('?pay=ok&order=<script>'), null, 'номер только цифрами');
assert.equal(site.readPayReturn('?pay=hack&order=1910-4821'), null);
assert.equal(site.readPayReturn('?pay=fail&order=1910-4821&why=<b>')?.why, null);
assert.equal(site.failReason('expired'), 'Время на оплату истекло.');
assert.equal(site.failReason('что-то'), 'Оплата не прошла.');

const now = Date.UTC(2026, 9, 19, 12);
const record = { number: '1910-4821', phone: '+7 987 955-25-65', total: 4650, lines: [{ title: 'Торт', qty: 1, sum: 4200 }], at: now - 1000, state: 'redirected' };
assert.deepEqual(site.parsePayRecord(JSON.stringify(record), now), record);
assert.equal(site.parsePayRecord(JSON.stringify({ ...record, at: now - site.PAY_KEEP_MS - 1 }), now), null, 'старше двух суток забывается');
assert.equal(site.parsePayRecord(JSON.stringify({ ...record, number: 'x' }), now), null);
assert.equal(site.parsePayRecord('{битый', now), null);
assert.equal(site.parsePayRecord(null, now), null);
assert.equal(site.parsePayRecord(JSON.stringify({ ...record, state: 'чужое' }), now)?.state, 'started');

assert.deepEqual(site.parsePayConfig(null), { online: false, onDelivery: true, test: false, provider: '', texts: site.DEFAULT_TEXTS });
assert.equal(site.parsePayConfig({ online: true, onDelivery: false }).onDelivery, false, 'только онлайн');
assert.equal(site.parsePayConfig({ online: false, onDelivery: false }).onDelivery, true, 'без онлайн «при получении» разрешено всегда');
assert.equal(site.parsePayConfig({ online: true, texts: { paid: '  ' } }).texts.paid, site.DEFAULT_TEXTS.paid, 'пустой текст — по умолчанию');
assert.deepEqual(site.DEFAULT_TEXTS, core.DEFAULT_TEXTS, 'тексты по умолчанию у сайта и сервера одни');

// ── провайдер Альфы: что уходит в шлюз и как читается ответ ─────────────────
// поддельный шлюз на локальном порту отвечает так, как описано в документации
// (register.do → orderId и formUrl, getOrderStatusExtended.do → orderStatus,
// ошибка → errorCode и errorMessage)
{
  const { createServer } = await import('node:http');
  const { alfa, BankError } = await import('../../directus/extensions/pay/providers/alfa.js');
  const seen: Record<string, string>[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(body));
      seen.push({ path: req.url ?? '', type: req.headers['content-type'] ?? '', ...params });
      res.setHeader('Content-Type', 'application/json');
      if (params.userName === 'blocked-api') res.end(JSON.stringify({ errorCode: '5', errorMessage: 'Доступ запрещён' }));
      else if (req.url?.endsWith('register.do'))
        res.end(JSON.stringify({ orderId: '6a1f0b0e-0000-4000-8000-000000000057', formUrl: 'https://alfa.rbsuat.com/payment/merchants/test/payment_ru.html?mdOrder=6a1f' }));
      else res.end(JSON.stringify({ errorCode: '0', orderStatus: 2, actionCode: 0, amount: 465000, orderNumber: '1910-4821-57' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const gateway = `http://127.0.0.1:${port}/payment/rest/`;
  try {
    const bank = alfa({ gateway, login: 'shop-api', password: 'secret', token: '' });
    const page = await bank.register({
      orderNumber: '1910-4821-57',
      amount: 465000,
      description: 'Заказ 1910-4821, Вкусная компания',
      returnUrl: 'https://admin.vkus-com.ru/pay/return?o=57',
      failUrl: 'https://admin.vkus-com.ru/pay/return?o=57',
      bundle,
      taxSystem: 1,
      sessionSeconds: 1200,
      phone: '79879552565',
    });
    assert.equal(page.id, '6a1f0b0e-0000-4000-8000-000000000057');
    assert.match(page.url, /^https:\/\/alfa\.rbsuat\.com\//);
    const sent = seen[0];
    assert.equal(sent.path, '/payment/rest/register.do');
    assert.equal(sent.type, 'application/x-www-form-urlencoded', 'шлюз ждёт форму, не JSON');
    assert.equal(sent.userName, 'shop-api');
    assert.equal(sent.password, 'secret');
    assert.equal(sent.amount, '465000', 'сумма в копейках');
    assert.equal(sent.currency, '643');
    assert.equal(sent.orderNumber, '1910-4821-57');
    assert.equal(sent.sessionTimeoutSecs, '1200');
    assert.equal(sent.taxSystem, '1');
    assert.deepEqual(JSON.parse(sent.orderBundle), bundle, 'корзина уходит JSON-строкой в поле orderBundle');
    assert.equal(sent.returnUrl, 'https://admin.vkus-com.ru/pay/return?o=57');
    const status = await bank.status(page.id);
    assert.equal(status.state, 'paid');
    assert.equal(status.amount, 465000);
    assert.equal(seen[1].path, '/payment/rest/getOrderStatusExtended.do');
    assert.equal(seen[1].orderId, page.id);
    // токен вместо логина и пароля
    await alfa({ gateway, token: 'tok-1', login: 'x', password: 'y' }).status('id');
    assert.equal(seen[2].token, 'tok-1');
    assert.equal(seen[2].userName, undefined);
    // без корзины в чек не уходят ни корзина, ни система налогообложения
    await bank.register({ orderNumber: 'n', amount: 100, description: 'd', returnUrl: 'r', failUrl: 'r', bundle: null, taxSystem: 1, sessionSeconds: 60, phone: '' });
    assert.equal(seen[3].orderBundle, undefined);
    assert.equal(seen[3].taxSystem, undefined);
    // отказ шлюза — ошибка с кодом, проверка доступа называет причину
    await assert.rejects(alfa({ gateway, login: 'blocked-api', password: 'x' }).status('id'), (error: unknown) => error instanceof BankError && error.code === '5');
    const check = await alfa({ gateway, login: 'blocked-api', password: 'x' }).check();
    assert.equal(check.ok, false);
    assert.match(check.message, /логин или пароль не подошли/);
    // шлюз не настроен — ошибка настройки, а не сети
    await assert.rejects(alfa({ gateway, login: '', password: '' }).status('id'), (error: unknown) => error instanceof BankError && error.kind === 'config');
    // шлюз молчит — ошибка сети
    await assert.rejects(alfa({ gateway: 'http://127.0.0.1:9/payment/rest/', login: 'a', password: 'b' }).status('id'), (error: unknown) => error instanceof BankError && error.kind === 'network');
  } finally {
    server.close();
  }
}

// ── заказ с сайта: способ оплаты принимается, итог оплаты — нет ─────────────
{
  type Row = Record<string, unknown>;
  // knex в миниатюре: ровно те цепочки, что зовут хуки
  const fakeDb = (tables: Record<string, Row[]>) => (name: string) => {
    let rows = [...(tables[name] ?? [])];
    const query = {
      where(match: Row) {
        rows = rows.filter((row) => Object.entries(match).every(([key, value]) => row[key] === value));
        return query;
      },
      whereIn(column: string, values: unknown[]) {
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      },
      select: async () => rows,
      first: async () => rows[0],
    };
    return query;
  };
  const database = fakeDb({
    products: [{ id: 5, title: 'Морс', price: 150, weight: '0,5 л', variants: [], fillings: [], available: true, status: 'published' }],
    orders: [],
    places: [],
  });
  const filters: Record<string, (payload: Row, meta: Row, context: Row) => Promise<Row> | Row> = {};
  const register = { filter: (event: string, fn: (typeof filters)[string]) => (filters[event] = fn), action: () => {}, schedule: () => {} };
  const quiet = { warn: () => {}, error: () => {} };
  const orderGuard = await import('../../directus/extensions/order-guard/index.js');
  orderGuard.default(register, { services: {}, logger: quiet });
  const order: Row = {
    number: '1910-4821',
    customer_name: 'Анна',
    phone: '8 987 955 25 65',
    fulfillment: 'delivery',
    address: 'Садовая, 212Б',
    items: [{ product: 5, qty: 2 }],
    total: 300,
    consent: true,
  };
  const guest = { accountability: { user: null, ip: '10.0.0.1' }, database };
  const sent = await filters['orders.items.create']({ ...order, payment_method: 'online', payment_status: 'paid', paid_at: '2026-01-01' }, {}, guest);
  assert.equal(sent.payment_method, 'online', 'order-guard: способ оплаты гостя доходит до заказа');
  assert.equal(sent.payment_status, undefined, 'order-guard: «оплачен» из браузера не принимается');
  assert.equal(sent.paid_at, undefined);
  assert.equal((await filters['orders.items.create']({ ...order, payment_method: 'bitcoin' }, {}, guest)).payment_method, 'on_delivery');
  assert.ok(!('payment_method' in (await filters['orders.items.create'](order, {}, guest))), 'без выбора на сайте — поле не шлётся, работает значение по умолчанию');

  // хук `pay`: итог оплаты пишет только сервер — ни гость, ни редактор
  const pay = (await import('../../directus/extensions/pay/index.js')).default;
  const hooks: typeof filters = {};
  pay.hooks[0].config(
    { filter: (event: string, fn: (typeof filters)[string]) => (hooks[event] = fn), schedule: () => {} },
    { services: {}, database, getSchema: async () => ({}), env: {}, logger: quiet },
  );
  const forged = { status: 'in_work', payment_status: 'paid', payment_id: 'x', paid_at: 'now', payment_log: 'ok', payment_meta: {}, payment_url: 'u', payment_method: 'online' };
  const byEditor = await hooks['orders.items.update'](forged, {}, { accountability: { user: 'editor-id' } });
  assert.deepEqual(byEditor, { status: 'in_work', payment_method: 'online' }, 'редактор меняет статус и способ, но не итог оплаты');
  assert.deepEqual(await hooks['orders.items.create']({ payment_method: 'cash' }, {}, { accountability: { user: null } }), { payment_method: 'on_delivery' });
  assert.deepEqual(await hooks['orders.items.update'](forged, {}, { accountability: null }), forged, 'сам сервер пишет всё');
}

console.log('payment: ok');
