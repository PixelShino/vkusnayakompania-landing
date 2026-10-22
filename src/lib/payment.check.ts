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
assert.equal(core.resolveSettings({ ...row, provider: 'evil' }, {}).provider, 'yookassa', 'незнакомый банк — ЮKassa по умолчанию');
// публичная часть не несёт секретов
const shown = JSON.stringify(core.publicConfig(fromAdmin));
for (const secret of ['shop-api', 'admin-pass', 'rbsuat']) assert.ok(!shown.includes(secret), `в /pay/config нет «${secret}»`);

// ── настройки ЮKassa ────────────────────────────────────────────────────────
{
  const yooRow = { online_enabled: true, mode: 'test', yookassa_shop_id: '123456', yookassa_secret_key: 'test_admin-key' };
  const s = core.resolveSettings(yooRow, {});
  assert.equal(s.provider, 'yookassa', 'без выбора банка — ЮKassa');
  assert.equal(core.resolveSettings({}, {}).provider, 'yookassa');
  assert.equal(s.shopId, '123456');
  assert.equal(s.secretKey, 'test_admin-key');
  assert.deepEqual([s.sources.shopId, s.sources.secretKey], ['admin', 'admin']);
  assert.equal(s.yookassaApi, 'https://api.yookassa.ru/v3/');
  assert.equal(s.enabled, true);
  assert.equal(s.texts.online, 'Картой МИР, Visa или Mastercard на защищённой странице ЮKassa', 'подпись называет ЮKassa');
  assert.match(core.resolveSettings({ ...yooRow, provider: 'alfa' }, {}).texts.online, /Альфа-Банка$/, 'у Альфы — Альфа');
  assert.equal(core.resolveSettings({ ...yooRow, provider: 'mock' }, {}).texts.online, s.texts.online, 'заглушка говорит словами основного банка');
  assert.equal(core.resolveSettings({ ...yooRow, text_online: 'Своими словами' }, {}).texts.online, 'Своими словами', 'текст из админки важнее');
  // окружение важнее админки, число из окружения — строка
  const env = core.resolveSettings(yooRow, { PAY_YOOKASSA_SHOP_ID: 654321, PAY_YOOKASSA_SECRET_KEY: 'live_env-key' });
  assert.equal(env.shopId, '654321');
  assert.equal(env.secretKey, 'live_env-key');
  assert.deepEqual([env.sources.shopId, env.sources.secretKey], ['env', 'env']);
  // ключ тестового магазина в боевом режиме: гость «оплатил» бы тестовой картой — оплата выключена
  const testInProd = core.resolveSettings({ ...yooRow, mode: 'prod' }, {});
  assert.equal(testInProd.testKeyInProd, true);
  assert.equal(testInProd.enabled, false, 'test_-ключ в бою выключает оплату');
  assert.equal(core.resolveSettings({ ...yooRow, mode: 'prod', yookassa_secret_key: 'live_x' }, {}).enabled, true, 'live_-ключ в бою работает');
  // поддельный адрес API — только в тесте
  assert.equal(core.resolveSettings(yooRow, { PAY_YOOKASSA_API: 'http://127.0.0.1:8099/v3' }).yookassaApi, 'http://127.0.0.1:8099/v3/');
  assert.equal(core.resolveSettings({ ...yooRow, mode: 'prod' }, { PAY_YOOKASSA_API: 'http://evil/v3' }).yookassaApi, 'https://api.yookassa.ru/v3/', 'бой — всегда api.yookassa.ru');
  assert.equal(core.resolveSettings({ ...yooRow, receipt_subject: 4 }, {}).receiptSubject, 4);
  assert.equal(core.resolveSettings({ ...yooRow, receipt_subject: 99 }, {}).receiptSubject, 1, 'незнакомый предмет расчёта — товар');
  const yooShown = JSON.stringify(core.publicConfig(env));
  for (const secret of ['654321', 'live_env-key']) assert.ok(!yooShown.includes(secret), `в /pay/config нет «${secret}»`);
}

// ── ЮKassa: суммы, чек, тело платежа ────────────────────────────────────────
{
  assert.equal(core.yooValue(465000), '4650.00');
  assert.equal(core.yooValue(9990), '99.90');
  assert.equal(core.yooValue(5), '0.05');
  assert.throws(() => core.yooValue(10.5), 'дробных копеек не бывает');
  assert.throws(() => core.yooValue(-1));
  assert.equal(core.yooKopecks({ value: '4650.00', currency: 'RUB' }), 465000);
  assert.equal(core.yooKopecks('0.29'), 29);
  assert.equal(core.yooKopecks(undefined), null);
  // коды админки → коды ЮKassa: все ставки из выпадающего списка «НДС» знакомы ЮKassa
  for (const [admin, yoo] of [[0, 1], [1, 2], [10, 7], [12, 8], [2, 3], [14, 11]]) assert.equal(core.YOO_VAT[admin], yoo, `НДС ${admin} → vat_code ${yoo}`);
  assert.deepEqual([core.yooTaxSystem(0), core.yooTaxSystem(1), core.yooTaxSystem(5), core.yooTaxSystem(9)], [1, 2, 6, null]);

  const order = [
    { product: 12, title: 'Торт «Лего»', variant: '2 кг', filling: 'Сникерс', qty: 1, price: 4200 },
    { product: 7, title: 'Морс\nклюквенный  0,5 л', variant: null, filling: null, qty: 3, price: 150 },
  ];
  const opts = { vat: 0, method: 4, subject: 1, taxSystem: 1, ffd12: true, phone: '+7 987 955-25-65', title: 'Заказ 1910-4821' };
  const yooRub = (kopecks: number) => `${Math.floor(kopecks / 100)}.${String(kopecks % 100).padStart(2, '0')}`;
  const full = core.buildYooReceipt(order, { ...opts, amount: 465000 });
  assert.deepEqual(full, {
    items: [
      { description: 'Торт «Лего» (2 кг, Сникерс)', quantity: 1, amount: { value: '4200.00', currency: 'RUB' }, vat_code: 1, payment_mode: 'full_payment', payment_subject: 'commodity', measure: 'piece' },
      { description: 'Морс клюквенный 0,5 л', quantity: 3, amount: { value: '150.00', currency: 'RUB' }, vat_code: 1, payment_mode: 'full_payment', payment_subject: 'commodity', measure: 'piece' },
    ],
    customer: { phone: '79879552565' },
    tax_system_code: 2,
  }, 'цена — за единицу, телефон цифрами, УСН «доходы» — код 2');
  assert.equal(core.yooReceiptTotal(full), 465000);

  // баллы: к оплате 1335 ₽ из 1535 ₽ — скидка раскладывается по строкам, чек сходится до копейки
  const breakfast = [
    { product: 1, title: 'Завтрак с мясной колбаской', qty: 1, price: 685 },
    { product: 3, title: 'Драники из кабачка с яйцом пашот и лососем', qty: 1, price: 850 },
  ];
  const points = core.buildYooReceipt(breakfast, { ...opts, amount: 133500 });
  assert.equal(core.yooReceiptTotal(points), 133500, 'чек равен оплате после баллов');
  assert.deepEqual(points.items.map((it) => it.amount.value), ['595.75', '739.25']);
  // строка, сумма которой не делится на количество, делится на две
  const split = core.buildYooReceipt([{ title: 'Морс', qty: 3, price: 1000 }], { ...opts, amount: 100000 });
  assert.deepEqual(
    split.items.map((it) => [it.quantity, it.amount.value]),
    [[2, '333.33'], [1, '333.34']],
  );
  assert.equal(core.yooReceiptTotal(split), 100000);
  for (const amount of [1, 99, 12345, 133499, 465000, 465001]) {
    const r = core.buildYooReceipt([...order, ...breakfast], { ...opts, amount });
    assert.equal(core.yooReceiptTotal(r), amount, `чек на ${amount} коп. сходится`);
  }
  // доставка — своя строка «Доставка» (услуга), блюда делят остаток; чек сходится до копейки
  const delivered = core.buildYooReceipt(order, { ...opts, amount: 505000, delivery: 400 });
  assert.deepEqual(
    delivered.items.map((it) => [it.description, it.quantity, it.amount.value, it.payment_subject]),
    [
      ['Торт «Лего» (2 кг, Сникерс)', 1, '4200.00', 'commodity'],
      ['Морс клюквенный 0,5 л', 3, '150.00', 'commodity'],
      ['Доставка', 1, '400.00', 'service'],
    ],
    'блюда — по своим ценам, доставка — отдельной строкой с признаком «услуга»',
  );
  assert.deepEqual(delivered.items.at(-1), { description: 'Доставка', quantity: 1, amount: { value: '400.00', currency: 'RUB' }, vat_code: 1, payment_mode: 'full_payment', payment_subject: 'service', measure: 'piece' });
  assert.equal(core.yooReceiptTotal(delivered), 505000);
  // доставка 0 или пусто (назовут при звонке) — чек как раньше
  for (const delivery of [0, null, undefined]) assert.deepEqual(core.buildYooReceipt(order, { ...opts, amount: 465000, delivery }), full, `доставка ${delivery} — без строки`);
  // баллы и доставка: баллы раскладываются только по блюдам, доставка остаётся целой
  const both = core.buildYooReceipt(breakfast, { ...opts, amount: 173500, delivery: 400 });
  assert.deepEqual(both.items.map((it) => it.amount.value), ['595.75', '739.25', '400.00']);
  assert.equal(core.yooReceiptTotal(both), 173500, 'чек = блюда после баллов + доставка');
  for (const amount of [40001, 40099, 52345, 173499, 505000, 505001]) {
    const r = core.buildYooReceipt([...order, ...breakfast], { ...opts, amount, delivery: 400 });
    assert.equal(core.yooReceiptTotal(r), amount, `чек с доставкой на ${amount} коп. сходится`);
    assert.equal(r.items.at(-1)?.description, 'Доставка');
  }
  // баллы съели блюда целиком (или доставка больше суммы) — одна строка «Заказ …»
  for (const amount of [40000, 30000]) {
    const r = core.buildYooReceipt(order, { ...opts, amount, delivery: 400 });
    assert.deepEqual(r.items.map((it) => [it.description, it.quantity, it.amount.value]), [['Заказ 1910-4821', 1, yooRub(amount)]]);
  }
  assert.deepEqual(core.buildYooReceipt(null, { ...opts, amount: 50000, delivery: 400 }).items.map((it) => it.description), ['Заказ 1910-4821'], 'без годных строк — одна строка и с доставкой');
  // сколько доставки внутри «К оплате»: из частей заказа, а не из поля, вписанного после звонка
  assert.equal(core.deliveryInPayment({ total: 1535, discount: 0, bonus_spent: 200, to_pay: 1735, delivery_cost: 400 }), 400);
  assert.equal(core.deliveryInPayment({ total: 1535, discount: 0, bonus_spent: 0, to_pay: 1535, delivery_cost: 600 }), 0, 'менеджер вписал доставку после звонка — в оплате её нет');
  assert.equal(core.deliveryInPayment({ total: 1535, to_pay: null, delivery_cost: 400 }), 0, 'старый заказ без «К оплате»');
  assert.equal(core.deliveryInPayment({ total: 8000, discount: 800, bonus_spent: 0, to_pay: 7200, delivery_cost: 0 }), 0);
  // без годных строк — одна строка «Заказ …» на всю сумму
  for (const broken of [[], null, [{ title: 'x', qty: 1.5, price: 10 }], [{ title: 'x', qty: 1, price: -1 }]]) {
    const r = core.buildYooReceipt(broken, { ...opts, amount: 50000 });
    assert.deepEqual(r.items.map((it) => [it.description, it.quantity]), [['Заказ 1910-4821', 1]]);
    assert.equal(core.yooReceiptTotal(r), 50000);
  }
  // ФФД 1.05 — без меры; почта — в чек; без телефона и почты — без customer
  const old = core.buildYooReceipt(order, { ...opts, amount: 465000, ffd12: false, email: 'anna@example.ru', phone: '' });
  assert.equal(old.items[0].measure, undefined);
  assert.deepEqual(old.customer, { email: 'anna@example.ru' });
  assert.equal(core.buildYooReceipt(order, { ...opts, amount: 465000, phone: null }).customer, undefined);
  assert.equal(core.buildYooReceipt(order, { ...opts, amount: 465000, method: 1, subject: 4 }).items[0].payment_mode, 'full_prepayment');
  assert.equal(core.buildYooReceipt(order, { ...opts, amount: 465000, subject: 4 }).items[0].payment_subject, 'service');
  assert.throws(() => core.buildYooReceipt(order, { ...opts, amount: 465000, vat: 99 }), /НДС/);
  assert.equal(core.yooItemName({ title: 'Т'.repeat(200) }).length, 128, 'наименование не длиннее 128 знаков');

  const body = core.buildYooPayment({
    amount: 133500,
    description: 'Заказ 1910-5341, Вкусная компания',
    returnUrl: 'https://admin.vkus-com.ru/pay/return?o=76&t=abc',
    metadata: { order_id: 76, order_number: '1910-5341', empty: '', none: null },
    receipt: points,
  });
  assert.deepEqual(body.amount, { value: '1335.00', currency: 'RUB' }, 'сумма строкой с копейками');
  assert.equal(body.capture, true, 'одностадийный платёж');
  assert.deepEqual(body.confirmation, { type: 'redirect', return_url: 'https://admin.vkus-com.ru/pay/return?o=76&t=abc', locale: 'ru_RU' });
  assert.deepEqual(body.metadata, { order_id: '76', order_number: '1910-5341' }, 'metadata — строки, пустое не уходит');
  assert.equal(body.receipt, points);
  assert.equal(core.buildYooPayment({ amount: 100, description: 'Д'.repeat(300), returnUrl: 'r' }).description.length, 128);
  assert.equal(core.buildYooPayment({ amount: 100, description: 'd', returnUrl: 'r' }).receipt, undefined, 'без чека — без receipt');
}

// ── ЮKassa: статусы, уведомления, адреса ────────────────────────────────────
{
  const pay = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'p1', status, amount: { value: '1335.00', currency: 'RUB' }, ...extra });
  const cases: [Record<string, unknown>, string, Record<string, unknown>][] = [
    [pay('pending'), 'pending', { left: true, why: null }],
    [pay('waiting_for_capture'), 'pending', { left: false, held: true }],
    [pay('succeeded'), 'paid', { amount: 133500, refunded: 0 }],
    [pay('succeeded', { refunded_amount: { value: '200.00', currency: 'RUB' } }), 'paid', { refunded: 20000 }],
    [pay('succeeded', { refunded_amount: { value: '1335.00', currency: 'RUB' } }), 'refunded', {}],
    [pay('canceled', { cancellation_details: { party: 'yoo_money', reason: 'expired_on_confirmation' } }), 'failed', { why: 'expired', note: 'время на оплату истекло' }],
    [pay('canceled', { cancellation_details: { party: 'payment_network', reason: 'insufficient_funds' } }), 'failed', { why: 'declined', note: 'на карте не хватает денег' }],
    [pay('canceled', { cancellation_details: { party: 'payment_network', reason: 'new_reason' } }), 'failed', { note: 'new_reason' }],
    [{}, 'pending', { left: false }],
  ];
  for (const [payment, state, fields] of cases) {
    const result = core.yooState(payment);
    assert.equal(result.state, state, `yooState(${JSON.stringify(payment)})`);
    for (const [key, value] of Object.entries(fields)) assert.equal(result[key], value, `yooState(${payment.status}).${key}`);
  }
  assert.equal(core.yooState(pay('succeeded', { test: true })).test, true);

  const succeeded = { type: 'notification', event: 'payment.succeeded', object: { id: '22e12f66-000f-5000-8000-18db351245c7', status: 'succeeded' } };
  assert.deepEqual(core.parseYooNotification(succeeded), { event: 'payment.succeeded', paymentId: '22e12f66-000f-5000-8000-18db351245c7' });
  assert.deepEqual(
    core.parseYooNotification({ type: 'notification', event: 'refund.succeeded', object: { id: '216749f7-0016-50be-b000-078d43a63ae4', payment_id: '216749da-000f-50be-b000-096747fad91e' } }),
    { event: 'refund.succeeded', paymentId: '216749da-000f-50be-b000-096747fad91e' },
    'возврат называет свой платёж',
  );
  assert.deepEqual(core.parseYooNotification({ type: 'notification', event: 'payout.succeeded', object: { id: 'po-1' } }), { event: 'payout.succeeded', paymentId: null }, 'чужое событие — пропустить');
  for (const bad of [null, 'x', {}, { type: 'error' }, { ...succeeded, object: null }, { ...succeeded, object: { id: '../../etc' } }, { ...succeeded, object: { id: 'x' } }])
    assert.equal(core.parseYooNotification(bad), null, `битое уведомление ${JSON.stringify(bad)}`);

  for (const ip of ['185.71.76.0', '185.71.76.31', '185.71.77.5', '77.75.153.127', '77.75.156.11', '77.75.156.35', '77.75.154.200', '::ffff:185.71.76.10', '2a02:5180::1', '2A02:5180:0:1::5'])
    assert.equal(core.isYooKassaIp(ip), true, `${ip} — ЮKassa`);
  for (const ip of ['185.71.76.32', '185.71.78.1', '77.75.153.128', '77.75.156.12', '77.75.154.127', '10.0.0.1', '2a02:5181::1', '', null, 'abc', '300.1.1.1'])
    assert.equal(core.isYooKassaIp(ip), false, `${ip} — не ЮKassa`);
}

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

// ── провайдер ЮKassa: что уходит в API и как читается ответ ─────────────────
// поддельная ЮKassa на локальном порту отвечает так, как описано в
// документации (POST /payments → id и confirmation.confirmation_url,
// GET /payments/{id} → status, GET /me → магазин, ошибка → type: error, code)
{
  const { createServer } = await import('node:http');
  const { yookassa } = await import('../../directus/extensions/pay/providers/yookassa.js');
  const { BankError } = await import('../../directus/extensions/pay/providers/alfa.js');
  type Seen = { method: string; path: string; auth: string; key: string; type: string; body: Record<string, any> | null };
  const seen: Seen[] = [];
  const payments = new Map<string, Record<string, unknown>>();
  let failNext = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({
        method: req.method ?? '',
        path: req.url ?? '',
        auth: req.headers.authorization ?? '',
        key: String(req.headers['idempotence-key'] ?? ''),
        type: String(req.headers['content-type'] ?? ''),
        body,
      });
      const send = (status: number, data: unknown) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
      };
      if (failNext > 0) {
        failNext -= 1;
        return send(500, { type: 'error', id: 'e1', code: 'internal_server_error', description: 'Internal server error' });
      }
      const [user] = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString().split(':');
      if (user !== '123456') return send(401, { type: 'error', id: 'e2', code: 'invalid_credentials', description: 'Login or password is incorrect' });
      if (req.method === 'POST' && req.url === '/v3/payments') {
        if (body.amount.value === '0.50') return send(400, { type: 'error', id: 'e3', code: 'invalid_request', description: 'Amount is too small', parameter: 'amount.value' });
        const id = `2e8f${String(payments.size + 1).padStart(4, '0')}-000f-5000-8000-18db351245c7`;
        const payment = { id, status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, test: true, confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${id}` } };
        payments.set(id, payment);
        return send(200, payment);
      }
      const capture = /^\/v3\/payments\/([^/]+)\/capture$/.exec(req.url ?? '');
      if (req.method === 'POST' && capture) {
        const payment = { ...payments.get(capture[1]), status: 'succeeded', paid: true };
        payments.set(capture[1], payment);
        return send(200, payment);
      }
      const get = /^\/v3\/payments\/([^/]+)$/.exec(req.url ?? '');
      if (req.method === 'GET' && get) return payments.has(get[1]) ? send(200, payments.get(get[1])) : send(404, { type: 'error', id: 'e4', code: 'not_found', description: 'Payment not found' });
      if (req.method === 'GET' && req.url === '/v3/me') return send(200, { account_id: '123456', test: true, fiscalization: { enabled: true, provider: 'avanpost' }, status: 'enabled' });
      return send(404, { type: 'error', id: 'e5', code: 'not_found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const settings = { shopId: '123456', secretKey: 'test_secret', yookassaApi: `http://127.0.0.1:${port}/v3/`, mode: 'test' };
  try {
    const bank = yookassa(settings);
    assert.equal(bank.keepsPage, true, 'ждущую страницу ЮKassa выдают снова, а не создают вторую');
    const receipt = { lines: [{ product: 1, title: 'Завтрак', qty: 1, price: 685 }, { product: 3, title: 'Драники', qty: 1, price: 850 }], vat: 0, method: 4, subject: 1, taxSystem: 1, ffd12: true, phone: '+7 987 955-25-65', title: 'Заказ 1910-5341' };
    const page = await bank.register({
      orderNumber: '1910-5341-76',
      amount: 133500,
      description: 'Заказ 1910-5341, Вкусная компания',
      returnUrl: 'https://admin.vkus-com.ru/pay/return?o=76&t=k1',
      receipt,
      metadata: { order_id: 76, order_number: '1910-5341' },
    });
    assert.match(page.id, /^2e8f0001-/);
    assert.match(page.url, /^https:\/\/yoomoney\.ru\/checkout\//);
    assert.equal(page.test, true);
    const sent = seen[0];
    assert.equal(sent.method, 'POST');
    assert.equal(sent.path, '/v3/payments');
    assert.equal(sent.auth, `Basic ${Buffer.from('123456:test_secret').toString('base64')}`, 'Basic shopId:ключ');
    assert.match(sent.key, /^[0-9a-f-]{36}$/, 'у каждого POST свой Idempotence-Key');
    assert.equal(sent.type, 'application/json');
    assert.deepEqual(sent.body?.amount, { value: '1335.00', currency: 'RUB' });
    assert.equal(sent.body?.capture, true);
    assert.equal(sent.body?.confirmation.return_url, 'https://admin.vkus-com.ru/pay/return?o=76&t=k1');
    assert.deepEqual(sent.body?.metadata, { order_id: '76', order_number: '1910-5341', bank_order: '1910-5341-76' });
    assert.equal(core.yooReceiptTotal(sent.body?.receipt), 133500, 'чек в запросе сходится с суммой после баллов');
    assert.equal(sent.body?.receipt.tax_system_code, 2);

    let status = await bank.status(page.id);
    assert.equal(status.state, 'pending');
    assert.equal(status.left, true);
    assert.deepEqual(status.metadata, { order_id: '76', order_number: '1910-5341', bank_order: '1910-5341-76' });
    payments.set(page.id, { ...payments.get(page.id), status: 'succeeded', paid: true });
    status = await bank.status(page.id);
    assert.equal(status.state, 'paid');
    assert.equal(status.amount, 133500);
    assert.equal(status.orderNumber, '1910-5341-76');
    // платёж тестового магазина в боевом режиме — не деньги
    assert.equal((await yookassa({ ...settings, mode: 'prod' }).status(page.id)).state, 'failed');
    // заморожен (двухстадийный) — провайдер списывает сам, с постоянным ключом
    payments.set(page.id, { ...payments.get(page.id), status: 'waiting_for_capture' });
    const before = seen.length;
    assert.equal((await bank.status(page.id)).state, 'paid');
    const captured = seen.slice(before).find((s) => s.path.endsWith('/capture'));
    assert.equal(captured?.key, `capture-${page.id}`);
    // без чека — без receipt
    await bank.register({ orderNumber: 'n', amount: 100, description: 'd', returnUrl: 'r', receipt: null });
    assert.equal(seen.at(-1)?.body?.receipt, undefined);
    // 500 — повтор с тем же ключом идемпотентности, платёж один
    failNext = 1;
    const retried = await bank.register({ orderNumber: 'n2', amount: 100, description: 'd', returnUrl: 'r' });
    const [first, second] = seen.slice(-2);
    assert.equal(first.key, second.key, 'повтор после 500 — тот же Idempotence-Key');
    assert.ok(retried.id);
    // ошибка запроса — с параметром; неверный ключ; не настроено; сеть
    await assert.rejects(bank.register({ orderNumber: 'n3', amount: 50, description: 'd', returnUrl: 'r' }), (error: any) => error instanceof BankError && error.code === 'invalid_request' && /amount\.value/.test(error.message));
    await assert.rejects(bank.status('2e8f9999-000f-5000-8000-18db351245c7'), (error: any) => error.status === 404 && error.code === 'not_found');
    await assert.rejects(yookassa({ ...settings, shopId: '1' }).status(page.id), (error: any) => error.code === 'invalid_credentials' && error.kind === 'bank');
    await assert.rejects(yookassa({ ...settings, shopId: '' }).status(page.id), (error: any) => error.kind === 'config');
    await assert.rejects(yookassa({ ...settings, yookassaApi: 'http://127.0.0.1:9/v3/' }).status(page.id), (error: any) => error.kind === 'network');
    // чек с незнакомой ставкой — ошибка настройки, а не банка
    await assert.rejects(bank.register({ orderNumber: 'n4', amount: 153500, description: 'd', returnUrl: 'r', receipt: { ...receipt, vat: 99 } }), (error: any) => error.kind === 'config');
    // проверка доступа
    const ok = await bank.check();
    assert.equal(ok.ok, true);
    assert.match(ok.message, /Ключ принят, магазин 123456 — тестовый; чеки ЮKassa подключены/);
    assert.equal(ok.fiscal, true);
    const denied = await yookassa({ ...settings, shopId: '1' }).check();
    assert.equal(denied.ok, false);
    assert.match(denied.message, /не подошли/);
  } finally {
    server.close();
  }
}

// ── сервис: уведомления ЮKassa и что они пишут в заказ ──────────────────────
// настоящий `createPayService` на базе в миниатюре и поддельной ЮKassa: тело
// уведомления ничего не решает, решает ответ ЮKassa на GET /payments/{id}
{
  const { createServer } = await import('node:http');
  const { createPayService, PayError } = await import('../../directus/extensions/pay/service.js');
  const api: Record<string, Record<string, unknown>> = {
    P1: { id: 'P1-000f-5000-9000-000000000001', status: 'succeeded', amount: { value: '1535.00', currency: 'RUB' }, metadata: { order_id: '57' } },
    P2: { id: 'P2-000f-5000-9000-000000000002', status: 'succeeded', amount: { value: '1535.00', currency: 'RUB' }, metadata: { order_id: '57' } },
    P4: { id: 'P4-000f-5000-9000-000000000004', status: 'succeeded', amount: { value: '10.00', currency: 'RUB' }, metadata: { order_id: '999' } },
    P5: { id: 'P5-000f-5000-9000-000000000005', status: 'succeeded', amount: { value: '700.00', currency: 'RUB' }, metadata: { order_id: '58' } },
  };
  const byId = (id: string) => Object.values(api).find((p) => p.id === id);
  const server = createServer((req, res) => {
    const id = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
    const payment = byId(id);
    res.setHeader('Content-Type', 'application/json');
    if (!payment) {
      res.statusCode = 404;
      res.end(JSON.stringify({ type: 'error', code: 'not_found' }));
    } else res.end(JSON.stringify(payment));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  type Row = Record<string, any>;
  const tables: Record<string, Row[]> = {
    payment_settings: [{ id: 1, online_enabled: true, provider: 'yookassa', mode: 'test', yookassa_shop_id: '100500', yookassa_secret_key: 'test_k' }],
    orders: [
      { id: 57, number: '1910-4821', customer_name: 'Анна', phone: '+7 987 955-25-65', total: 1535, to_pay: null, payment_status: 'pending', payment_method: 'online', payment_id: api.P2.id, payment_log: '', payment_meta: { provider: 'yookassa', ids: [api.P1.id, api.P2.id] } },
      { id: 58, number: '1910-4822', customer_name: 'Борис', phone: '+7 987 955-25-66', total: 700, to_pay: null, payment_status: 'pending', payment_method: 'online', payment_id: 'P6-other', payment_log: '', payment_meta: { provider: 'yookassa', ids: [api.P5.id, 'P6-other'] } },
    ],
    directus_roles: [{ id: 'r1', name: 'Administrator' }],
    directus_users: [{ id: 'u1', role: 'r1', status: 'active' }],
  };
  const database = (name: string) => {
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
      first: async () => rows[0],
      pluck: async (column: string) => rows.map((row) => row[column]),
    };
    return query;
  };
  const sentNotes: Row[] = [];
  const services = {
    ItemsService: class {
      async updateOne(id: number, patch: Row) {
        Object.assign(tables.orders.find((row) => row.id === id)!, patch);
      }
    },
    NotificationsService: class {
      async createOne(note: Row) {
        sentNotes.push(note);
      }
    },
  };
  const warnings: string[] = [];
  const service = createPayService({
    services,
    database,
    getSchema: async () => ({}),
    env: { PUBLIC_URL: 'https://admin.vkus-com.ru', PAY_YOOKASSA_API: `http://127.0.0.1:${port}/v3/` },
    logger: { warn: (text: string) => warnings.push(text), error: () => {} },
  });
  const notify = (event: string, object: Row) => service.yookassaNotification({ type: 'notification', event, object }, { trusted: true });
  const order = (id: number) => tables.orders.find((row) => row.id === id)!;
  try {
    // тело врёт про сумму и статус — значение имеет только ответ ЮKassa
    assert.deepEqual(await notify('payment.succeeded', { id: api.P2.id, status: 'succeeded', amount: { value: '1.00' } }), { ok: true });
    assert.equal(order(57).payment_status, 'paid');
    assert.equal(order(57).payment_id, api.P2.id);
    assert.match(order(57).payment_log, /оплачено 1\s535 ₽; уведомление ЮKassa \(payment\.succeeded\)$/);
    assert.equal(sentNotes.length, 1, 'администратор получил уведомление об оплате');
    // вторая попытка тоже оплачена — громкая строка в журнале, один раз
    await notify('payment.succeeded', { id: api.P1.id });
    await notify('payment.succeeded', { id: api.P1.id });
    assert.equal(order(57).payment_log.match(/ВНИМАНИЕ: оплачена ещё одна попытка/g)?.length, 1, 'двойная оплата названа один раз');
    assert.equal(order(57).payment_id, api.P2.id, 'номер платежа заказа не меняется');
    assert.equal(sentNotes.length, 1, 'вторая оплата не шлёт второе «оплачен»');
    // частичный возврат: заказ оплачен, сумма возврата — в журнале; повтор не дублирует строку
    api.P2.refunded_amount = { value: '535.00', currency: 'RUB' };
    await notify('refund.succeeded', { id: 'R1-000f-5000-9000-000000000001', payment_id: api.P2.id });
    await notify('refund.succeeded', { id: 'R1-000f-5000-9000-000000000001', payment_id: api.P2.id });
    assert.equal(order(57).payment_status, 'paid');
    assert.equal(order(57).payment_log.match(/частичный возврат: всего вернули 535 ₽/g)?.length, 1);
    api.P2.refunded_amount = { value: '1535.00', currency: 'RUB' };
    await notify('refund.succeeded', { id: 'R2-000f-5000-9000-000000000002', payment_id: api.P2.id });
    assert.equal(order(57).payment_status, 'refunded', 'полный возврат — «Возврат»');
    // заказ находится по metadata, которую вернула ЮKassa, если платёж — не последняя попытка
    await notify('payment.succeeded', { id: api.P5.id });
    assert.equal(order(58).payment_status, 'paid');
    assert.equal(order(58).payment_id, api.P5.id);
    // платёж не наш, платежа нет, тело битое
    assert.deepEqual(await notify('payment.succeeded', { id: api.P4.id }), { ok: true, ignored: 'unknown order' });
    assert.deepEqual(await notify('payment.succeeded', { id: 'P9-000f-5000-9000-000000000009' }), { ok: true, ignored: 'unknown payment' });
    await assert.rejects(service.yookassaNotification({ event: 'payment.succeeded' }), (error: unknown) => error instanceof PayError && error.status === 400);
    // ЮKassa недоступна — 503, ЮKassa повторит
    tables.payment_settings[0].yookassa_shop_id = '';
    await assert.rejects(notify('payment.succeeded', { id: api.P1.id }), (error: unknown) => error instanceof PayError && error.status === 503);
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
