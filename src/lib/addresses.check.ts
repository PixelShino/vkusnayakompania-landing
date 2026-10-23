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
