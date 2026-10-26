/**
 * Проверка сохранённых адресов: правила формы, метка по умолчанию, тот же
 * адрес, строка для глаз. Серверная половина (`guest-auth/addresses.js`)
 * сверяется в конце файла. Запуск: `pnpm test`.
 */
import assert from 'node:assert/strict';
// addressLine разделяет слово и число неразрывным пробелом; проверки читают его как обычный
const sp = (text: string) => text.replace(/\u00a0/g, ' ');
import { ADDRESS_MAX, LABEL_PRESETS, MAX_ADDRESSES, addressErrors, addressKey, cleanAddress, defaultLabel, sameSaved, savedLine, toCheckoutFields } from './addresses.ts';

assert.equal(MAX_ADDRESSES, 5);
assert.deepEqual([...LABEL_PRESETS], ['Дом', 'Работа']);
assert.deepEqual(ADDRESS_MAX, { label: 24, address: 200, flat: 20, entrance: 10, floor: 10, intercom: 20 });

// правила формы / the form rules
assert.deepEqual(addressErrors({ label: 'Дом', address: 'проспект Ленина, 1' }), {});
assert.deepEqual(addressErrors({ label: '  ', address: 'ул.' }), { label: 'Как назвать адрес: Дом, Работа…', address: 'Укажите улицу и дом' });
assert.equal(addressErrors({ label: 'x'.repeat(25), address: 'Ленина, 10' }).label, 'Не длиннее 24 знаков');
assert.equal(addressErrors({ label: 'Дом', address: 'x'.repeat(201) }).address, 'Не длиннее 200 знаков');
assert.equal(addressErrors({ label: 'Дом', address: 'Ленина, 10', flat: '1'.repeat(21) }).flat, 'Не длиннее 20 знаков');
assert.equal(addressErrors({ label: 'Дом', address: 'Ленина, 10', entrance: '1'.repeat(11) }).entrance, 'Не длиннее 10 знаков');
assert.deepEqual(addressErrors({ label: 'Дом', address: 'Ленина, 10', flat: 'кв. 12', entrance: '2', floor: '5', intercom: '12К' }), {});

// как хранится / as stored
assert.deepEqual(cleanAddress({ label: ' Дом ', address: ' проспект  Ленина, 1 ', flat: 'кв. 12', entrance: '2 подъезд', floor: 'этаж 5', intercom: 'код 45#' }), {
  label: 'Дом',
  address: 'проспект Ленина, 1',
  flat: '12',
  entrance: '2',
  floor: '5',
  intercom: '45#',
});
assert.deepEqual(cleanAddress({ label: 'Офис', address: 'Садовая, 212Б', flat: 'офис 5' }).flat, 'офис 5');
assert.equal(cleanAddress({ label: 'Дом', address: 'Ленина, 1' }).intercom, null);

// тот же адрес / the same address
assert.equal(addressKey(' Проспект Ленина, 1 ', '12'), 'проспект ленина 1|12');
assert.ok(sameSaved({ address: 'проспект Ленина, 1', flat: '12' }, { address: 'Проспект  Ленина 1', flat: '12' }));
assert.ok(!sameSaved({ address: 'проспект Ленина, 1', flat: '12' }, { address: 'проспект Ленина, 1', flat: '13' }));
assert.ok(!sameSaved({ address: 'проспект Ленина, 1', flat: null }, { address: 'проспект Ленина, 1', flat: '12' }));

// метка по умолчанию / the default label
assert.equal(defaultLabel([]), 'Дом');
assert.equal(defaultLabel([{ label: 'дом' }]), 'Работа');
assert.equal(defaultLabel([{ label: 'Дом' }, { label: 'Работа' }]), 'Адрес 3');
assert.equal(defaultLabel([{ label: 'Работа' }]), 'Дом');

const home = { id: 'a1b2c3d4', label: 'Дом', address: 'проспект Ленина, 1', flat: '12', entrance: '2', floor: '5', intercom: '12К' };
assert.equal(sp(savedLine(home)), 'проспект Ленина, 1, кв. 12, подъезд 2, этаж 5, домофон 12К');
assert.equal(sp(savedLine({ ...home, flat: 'офис 5', entrance: null, floor: null, intercom: null })), 'проспект Ленина, 1, офис 5');
assert.deepEqual(toCheckoutFields({ ...home, floor: null }), { address: 'проспект Ленина, 1', flat: '12', entrance: '2', floor: '', intercom: '12К' });

console.log('адреса гостя: правила, метки, тот же адрес, строка — проверки прошли');

// ── сервер: `guest-auth/addresses.js` отказывает и хранит так же, как сайт ──
{
  const server = await import('../../directus/extensions/guest-auth/addresses.js');
  const guard = await import('../../directus/extensions/guest-auth/index.js');
  const { GUEST_ORDER_READ } = await import('../../scripts/setup/account.mjs');
  const { aptPart } = await import('./order.ts');
  const { LIMIT_MESSAGE } = await import('./addresses.ts');

  assert.equal(server.MAX_ADDRESSES, MAX_ADDRESSES);
  assert.deepEqual(server.ADDRESS_MAX, ADDRESS_MAX);
  assert.equal(server.LIMIT_MESSAGE, LIMIT_MESSAGE);

  // те же входы, что выше, — те же ответы / the inputs above, the same answers
  const inputs = [
    { label: 'Дом', address: 'проспект Ленина, 1' },
    { label: '  ', address: 'ул.' },
    { label: 'x'.repeat(25), address: 'Ленина, 10' },
    { label: 'Дом', address: 'x'.repeat(201) },
    { label: 'Дом', address: 'Ленина, 10', flat: '1'.repeat(21) },
    { label: 'Дом', address: 'Ленина, 10', entrance: '1'.repeat(11) },
    { label: 'Дом', address: 'Ленина, 10', flat: 'кв. 12', entrance: '2', floor: '5', intercom: '12К' },
    { label: ' Дом ', address: ' проспект  Ленина, 1 ', flat: 'кв. 12', entrance: '2 подъезд', floor: 'этаж 5', intercom: 'код 45#' },
    { label: 'Офис', address: 'Садовая, 212Б', flat: 'офис 5' },
    { label: 'Дом', address: 'Ленина, 1' },
    {},
  ];
  for (const input of inputs) {
    assert.deepEqual(server.addressErrors(input), addressErrors(input), JSON.stringify(input));
    assert.deepEqual(server.cleanAddress(input), cleanAddress(input), JSON.stringify(input));
  }
  // пункты чистятся одинаково / the parts are cleaned alike
  const parts = { flat: ['кв. 12', 'Квартира №7', 'кв12', 'офис 5', 'пом. 3', ' 12 '], entrance: ['2 подъезд', 'подъезд 2', 'п. 3', '4-й подъезд'], floor: ['этаж 5', '5 этаж', 'эт. 2', '3-й этаж'], intercom: ['код 45#', 'домофон 12К', 'код домофона: 7', 'д/ф 1'] } as const;
  for (const [key, values] of Object.entries(parts))
    for (const value of [...values, '', '   ', 'x'.repeat(40)]) assert.equal(server.aptPart(key, value), aptPart(key as never, value), `${key}: ${value}`);
  assert.equal(server.addressKey(' Проспект Ленина, 1 ', '12'), addressKey(' Проспект Ленина, 1 ', '12'));

  // операции / operations
  let n = 0;
  const ids = { id: () => `a000000${++n}` };
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return { code: (error as { code: string }).code, status: (error as { status: number }).status, message: (error as Error).message, fields: (error as { fields?: unknown }).fields };
    }
    return null;
  };
  let { list, id } = server.applyAddressOp([], { kind: 'add', input: { label: ' Дом ', address: 'проспект Ленина, 1', flat: 'кв. 12', entrance: '2 подъезд' } }, ids);
  assert.equal(id, 'a0000001');
  assert.deepEqual(list, [{ id: 'a0000001', label: 'Дом', address: 'проспект Ленина, 1', flat: '12', entrance: '2', floor: null, intercom: null }]);
  // тот же адрес второй раз не добавляется — обновляет метку и пункты / the same address updates the saved one
  ({ list, id } = server.applyAddressOp(list, { kind: 'add', input: { label: 'Мой дом', address: 'Проспект  Ленина 1', flat: '12', floor: '5' } }, ids));
  assert.equal(id, 'a0000001');
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { id: 'a0000001', label: 'Мой дом', address: 'проспект Ленина, 1', flat: '12', entrance: null, floor: '5', intercom: null });
  // другая квартира — другой адрес / another flat is another address
  ({ list, id } = server.applyAddressOp(list, { kind: 'add', input: { label: 'Мама', address: 'проспект Ленина, 1', flat: '13' } }, ids));
  assert.equal(list.length, 2);
  for (const street of ['Садовая, 1', 'Садовая, 2', 'Садовая, 3']) ({ list } = server.applyAddressOp(list, { kind: 'add', input: { label: 'Работа', address: street } }, ids));
  assert.equal(list.length, 5);
  assert.equal(new Set(list.map((a: { id: string }) => a.id)).size, 5);
  // шестой — отказ; тот же адрес при пяти — по-прежнему обновление / the sixth is refused
  assert.deepEqual(codeOf(() => server.applyAddressOp(list, { kind: 'add', input: { label: 'Дача', address: 'Садовая, 4' } }, ids)), { code: 'ADDRESS_LIMIT', status: 409, message: LIMIT_MESSAGE, fields: undefined });
  assert.equal(server.applyAddressOp(list, { kind: 'add', input: { label: 'Офис', address: 'садовая 3' } }, ids).list[4].label, 'Офис');
  // неправильный адрес — 400 с полями, тексты как у формы / a wrong one — 400 with the form's words
  assert.deepEqual(codeOf(() => server.applyAddressOp([], { kind: 'add', input: { label: '', address: 'ул.' } }, ids)), {
    code: 'INVALID_ADDRESS', status: 400, message: 'Как назвать адрес: Дом, Работа…', fields: addressErrors({ label: '', address: 'ул.' }),
  });
  // правка: только названные поля, пустое стирает / update: only the named fields, empty clears
  const work = list[2].id;
  ({ list } = server.applyAddressOp(list, { kind: 'update', id: work, input: { label: 'Офис', entrance: 'подъезд 3' } }));
  assert.deepEqual(list[2], { id: work, label: 'Офис', address: 'Садовая, 1', flat: null, entrance: '3', floor: null, intercom: null });
  ({ list } = server.applyAddressOp(list, { kind: 'update', id: work, input: { entrance: '' } }));
  assert.equal(list[2].entrance, null);
  assert.equal(codeOf(() => server.applyAddressOp(list, { kind: 'update', id: work, input: { address: 'x' } }))?.code, 'INVALID_ADDRESS');
  // правка в уже сохранённый адрес — отказ, иначе две записи на один адрес / no two entries for one address
  const twin = codeOf(() => server.applyAddressOp(list, { kind: 'update', id: work, input: { address: 'Садовая, 2' } }));
  assert.equal(twin?.code, 'INVALID_ADDRESS');
  assert.match(String((twin?.fields as Record<string, string>)?.address), /уже сохранён/);
  // удаление / remove
  ({ list } = server.applyAddressOp(list, { kind: 'remove', id: work }));
  assert.equal(list.length, 4);
  assert.ok(!list.some((a: { id: string }) => a.id === work));
  for (const op of [{ kind: 'remove', id: work }, { kind: 'update', id: 'nope', input: { label: 'X' } }, { kind: 'remove', id: 42 }])
    assert.deepEqual(codeOf(() => server.applyAddressOp(list, op as never)), { code: 'ADDRESS_NOT_FOUND', status: 404, message: 'Адрес не найден — обновите страницу', fields: undefined });
  // настоящий id — 8 знаков / a real id is 8 characters
  assert.match(String(server.applyAddressOp([], { kind: 'add', input: { label: 'Дом', address: 'Ленина, 1' } }).id), /^[0-9a-f]{8}$/);
  // исходный список не меняется / the list passed in is not changed
  const before = JSON.stringify(list);
  server.applyAddressOp(list, { kind: 'update', id: list[0].id, input: { label: 'Другое' } });
  assert.equal(JSON.stringify(list), before);

  // что лежит в базе → правильный список / what the database holds → a valid list
  assert.deepEqual(server.cleanAddresses(null), []);
  assert.deepEqual(server.cleanAddresses('{битый'), []);
  assert.deepEqual(server.cleanAddresses({ id: 'x' }), []);
  assert.deepEqual(server.cleanAddresses(JSON.stringify(list)), list);
  const junk = [
    null, 'строка', 7, [], { label: 'Без id', address: 'Ленина, 1' }, { id: 'bad id!', label: 'Дом', address: 'Ленина, 1' },
    { id: 'aaaa0001', label: '', address: 'Ленина, 1' }, { id: 'aaaa0002', label: 'Дом', address: 'ул.' },
    { id: 'aaaa0003', label: 'Дом', address: 'Ленина, 1', flat: 'кв. 5', extra: 'лишнее' }, { id: 'aaaa0003', label: 'Повтор id', address: 'Ленина, 2' },
    ...['04', '05', '06', '07', '08'].map((x) => ({ id: `aaaa00${x}`, label: `Адрес ${x}`, address: `Садовая, ${x}` })),
  ];
  const kept = server.cleanAddresses(junk);
  assert.equal(kept.length, 5);
  assert.deepEqual(kept[0], { id: 'aaaa0003', label: 'Дом', address: 'Ленина, 1', flat: '5', entrance: null, floor: null, intercom: null });
  assert.deepEqual(kept.map((a: { id: string }) => a.id), ['aaaa0003', 'aaaa0004', 'aaaa0005', 'aaaa0006', 'aaaa0007']);

  // история статусов заказа / the order's status history
  const created = '2026-10-23T08:00:00.000Z';
  const meta = JSON.stringify({
    messages: [{ chat: '-100', message_id: 5 }],
    history: [
      { status: 'in_work', who: 'Дмитрий', via: 'telegram', at: '2026-10-23T08:05:00.000Z' },
      { status: 'in_work', who: 'Ирина', via: 'admin', at: '2026-10-23T08:06:00.000Z' },
      { status: 'done', who: 'Ирина', via: 'admin', at: '2026-10-23T09:00:00.000Z' },
    ],
  });
  const history = guard.historyFor(meta, created, 'done');
  assert.deepEqual(history, [
    { status: 'new', at: created },
    { status: 'in_work', at: '2026-10-23T08:05:00.000Z' },
    { status: 'done', at: '2026-10-23T09:00:00.000Z' },
  ]);
  assert.ok(!JSON.stringify(history).match(/Дмитрий|Ирина|telegram|admin|who|via/));
  // объект из базы и Date — то же / an object from the database and a Date give the same
  assert.deepEqual(guard.historyFor(JSON.parse(meta), new Date(created), 'done'), history);
  // «Принят» второй раз подряд склеивается с первым / «new» twice in a row is one
  assert.deepEqual(guard.historyFor({ history: [{ status: 'new', who: 'x', via: 'admin', at: '2026-10-23T08:01:00Z' }] }, created, 'new'), [{ status: 'new', at: created }]);
  // заказ до 23.10.2026: следа нет — текущий статус с неизвестным временем / an old order
  assert.deepEqual(guard.historyFor(null, created, 'done'), [{ status: 'new', at: created }, { status: 'done', at: null }]);
  assert.deepEqual(guard.historyFor('', created, 'new'), [{ status: 'new', at: created }]);
  assert.deepEqual(guard.historyFor('{битый', created), [{ status: 'new', at: created }]);

  // гость читает ровно поля кабинета, служебных — нет / the guest reads the account's fields, not the staff's
  assert.deepEqual([...guard.ORDER_FIELDS].sort(), [...GUEST_ORDER_READ].sort());
  assert.ok(guard.LEGACY_ORDER_FIELDS.every((f: string) => guard.CARD_ORDER_FIELDS.includes(f)));
  assert.ok(guard.CARD_ORDER_FIELDS.every((f: string) => guard.ORDER_FIELDS.includes(f)));
  assert.ok(guard.ORDER_FIELDS.includes('email') && !guard.CARD_ORDER_FIELDS.includes('email'), 'почта для чека — только в новом наборе');

  // до `pnpm setup` новое поле отвечает 403: читается набор до него, вплоть до самого старого
  // before `pnpm setup` a newer field is refused with 403: the set before it is read, down to the oldest
  {
    const forbidden = Object.assign(new Error('forbidden'), { code: 'FORBIDDEN', status: 403 });
    const reader = (allowed: string[]) => {
      const asked: string[][] = [];
      return {
        asked,
        readByQuery: async (query: Record<string, unknown>) => {
          const fields = query.fields as string[];
          asked.push(fields);
          if (fields.some((f) => !allowed.includes(f))) throw forbidden;
          return [{ id: 1 }];
        },
      };
    };
    const warned: string[][] = [];
    const full = reader(guard.ORDER_FIELDS);
    assert.deepEqual(await guard.readGuestOrders(full, (f: string[]) => warned.push(f)), [{ id: 1 }]);
    assert.deepEqual(full.asked, [guard.ORDER_FIELDS]);
    assert.equal(warned.length, 0);
    const card = reader(guard.CARD_ORDER_FIELDS);
    await guard.readGuestOrders(card, (f: string[]) => warned.push(f));
    assert.deepEqual(card.asked, [guard.ORDER_FIELDS, guard.CARD_ORDER_FIELDS], 'без права на email — карточка без почты, а не старые поля');
    assert.deepEqual(warned, [guard.ORDER_FIELDS], 'в лог — про отказанный набор');
    const legacy = reader(guard.LEGACY_ORDER_FIELDS);
    await guard.readGuestOrders(legacy);
    assert.deepEqual(legacy.asked, [guard.ORDER_FIELDS, guard.CARD_ORDER_FIELDS, guard.LEGACY_ORDER_FIELDS]);
    await assert.rejects(guard.readGuestOrders(reader([])), (error: any) => error.status === 403, 'и старые поля не дали — ошибка наружу');
    const broken = { readByQuery: async () => { throw new Error('база недоступна'); } };
    await assert.rejects(guard.readGuestOrders(broken), /база недоступна/, 'не 403 — без отката');
  }
  for (const secret of ['status_log', 'telegram_meta', 'manager_note', 'payment_url', 'payment_id', 'payment_log', 'payment_meta', 'notify_result'])
    assert.ok(!GUEST_ORDER_READ.includes(secret) && !guard.ORDER_FIELDS.includes(secret), secret);

  // только российская почта / Russian mail only
  assert.deepEqual(guard.profileErrors({ recovery_email: '' }, '2026-10-19'), {});
  assert.deepEqual(guard.profileErrors({ recovery_email: 'Anna@Mail.RU ' }, '2026-10-19'), {});
  assert.equal(guard.profileErrors({ recovery_email: 'anna@gmail.com' }, '2026-10-19').recovery_email, 'Укажите российскую почту: mail.ru, yandex.ru, rambler.ru, vk.com…');
  assert.equal(guard.profileErrors({ recovery_email: 'anna@' }, '2026-10-19').recovery_email, 'Проверьте адрес: name@mail.ru');

  console.log('адреса гостя: сервер — те же правила, операции, история заказа — проверки прошли');
}
