/**
 * Проверка сохранённых адресов в корзине: какой чип выбран, когда предлагать
 * «Сохранить адрес в кабинете», какая метка подсказана и что уходит в
 * `addresses/add`. Запуск: `pnpm test`.
 */
import assert from 'node:assert/strict';
import { MAX_ADDRESSES, type SavedAddress } from './addresses.ts';
import { NEW_ADDRESS, OWN_LABEL, addressToSave, chipFor, chipLine, labelChoice, labelToSave, saveOffer, savedMatch, sentFields, type CheckoutAddress, type SentAddress } from './cart-addresses.ts';

const home: SavedAddress = { id: 'a1b2c3d4', label: 'Дом', address: 'улица Советской Армии, 177', flat: '12', entrance: '2', floor: '5', intercom: '12К' };
const work: SavedAddress = { id: 'e5f6g7h8', label: 'Работа', address: 'улица Молодогвардейская, 151', flat: 'офис 3', entrance: null, floor: '2', intercom: null };
const list = [home, work];
const empty: CheckoutAddress = { address: '', flat: '', entrance: '', floor: '', intercom: '' };
const fields = (patch: Partial<CheckoutAddress>): CheckoutAddress => ({ ...empty, ...patch });
const many = (n: number) => Array.from({ length: n }, (_, i): SavedAddress => ({ ...home, id: `id${i}`, label: `Адрес ${i + 1}`, flat: String(i + 1) }));

// тот же адрес: «кв. 12» в поле — это «12» сохранённого, регистр и знаки не важны
assert.equal(savedMatch(list, { address: 'улица Советской Армии, 177', flat: 'кв. 12' })?.id, home.id);
assert.equal(savedMatch(list, { address: 'Улица советской армии 177', flat: '12' })?.id, home.id);
assert.equal(savedMatch(list, { address: 'улица Молодогвардейская, 151', flat: 'офис 3' })?.id, work.id);
assert.equal(savedMatch(list, { address: 'улица Советской Армии, 177', flat: '14' }), null);
assert.equal(savedMatch(list, { address: 'улица Советской Армии, 177', flat: '' }), null);
assert.equal(savedMatch(list, { address: '  ', flat: '' }), null);
assert.equal(savedMatch([], { address: 'улица Советской Армии, 177', flat: '12' }), null);

// вторая строка чипа: без «улицы», квартира с «кв.» неразрывно, офис как есть
assert.equal(chipLine(home), 'Советской Армии, 177, кв. 12');
assert.equal(chipLine(work), 'Молодогвардейская, 151, офис 3');
assert.equal(chipLine({ address: 'проспект Ленина, 1', flat: null }), 'проспект Ленина, 1');
assert.equal(chipLine({ address: 'ул. Садовая, 212Б', flat: 'кв. 7' }), 'Садовая, 212Б, кв. 7');

// какой чип выбран
assert.equal(chipFor(list, empty), null);
assert.equal(chipFor(list, empty, true), NEW_ADDRESS);
assert.equal(chipFor(list, fields({ address: 'улица Советской Армии, 177', flat: '12', entrance: '2' })), home.id);
// подъезд и домофон не меняют адрес: чип тот же
assert.equal(chipFor(list, fields({ address: 'улица Советской Армии, 177', flat: '12', entrance: '4' })), home.id);
// другая квартира — уже новый адрес, даже если гость выбирал «Дом»
assert.equal(chipFor(list, fields({ address: 'улица Советской Армии, 177', flat: '14' })), NEW_ADDRESS);
assert.equal(chipFor(list, fields({ floor: '3' })), NEW_ADDRESS);
// набранный руками сохранённый адрес сам находит свой чип, «Новый адрес» уступает
assert.equal(chipFor(list, fields({ address: 'улица Молодогвардейская, 151', flat: 'офис 3' }), true), work.id);

// блок «Сохранить адрес»
assert.equal(saveOffer(list, empty), 'none');
assert.equal(saveOffer(list, fields({ address: 'ул.' })), 'none');
assert.equal(saveOffer(list, fields({ address: 'улица Советской Армии, 177', flat: 'кв. 12' })), 'none');
assert.equal(saveOffer(list, fields({ address: 'улица Советской Армии, 179' })), 'offer');
assert.equal(saveOffer([], fields({ address: 'улица Советской Армии, 179' })), 'offer');
assert.equal(saveOffer(many(MAX_ADDRESSES - 1), fields({ address: 'улица Победы, 1' })), 'offer');
assert.equal(saveOffer(many(MAX_ADDRESSES), fields({ address: 'улица Победы, 1' })), 'limit');
// при пяти сохранённых уже сохранённый адрес не вызывает строку о пределе
assert.equal(saveOffer(many(MAX_ADDRESSES), fields({ address: home.address, flat: '3' })), 'none');

// метки: свободные заготовки, выбранная по умолчанию, «Своя» с «Адрес 3»
assert.deepEqual(labelChoice([]), { presets: ['Дом', 'Работа'], chosen: 'Дом', own: '' });
assert.deepEqual(labelChoice([home]), { presets: ['Работа'], chosen: 'Работа', own: '' });
assert.deepEqual(labelChoice([{ label: 'работа' }]), { presets: ['Дом'], chosen: 'Дом', own: '' });
assert.deepEqual(labelChoice(list), { presets: [], chosen: OWN_LABEL, own: 'Адрес 3' });
assert.equal(labelToSave('Работа', 'Дача', list), 'Работа');
assert.equal(labelToSave(OWN_LABEL, '  Дача  ', list), 'Дача');
assert.equal(labelToSave(OWN_LABEL, '   ', list), 'Адрес 3');
assert.equal(labelToSave(OWN_LABEL, '', []), 'Дом');

// что уходит в addresses/add: как ушло в заказе, без пустых пунктов
const sent = (patch: Partial<SentAddress>): SentAddress => ({
  fulfillment: 'delivery',
  address: 'улица Советской Армии, 179',
  address_flat: '7',
  address_entrance: null,
  address_floor: '3',
  address_intercom: null,
  ...patch,
});
assert.deepEqual(sentFields(sent({})), { address: 'улица Советской Армии, 179', flat: '7', entrance: '', floor: '3', intercom: '' });
assert.deepEqual(addressToSave('Дача', sent({}), list), { label: 'Дача', address: 'улица Советской Армии, 179', flat: '7', floor: '3' });
assert.equal(addressToSave('Дача', sent({ fulfillment: 'pickup', address: null }), list), null);
// уже сохранённый адрес не отправляется: сервер переписал бы метку «Дом»
assert.equal(addressToSave('Адрес 3', sent({ address: home.address, address_flat: '12' }), list), null);
assert.equal(addressToSave('Дача', sent({}), many(MAX_ADDRESSES)), null);
assert.equal(addressToSave('', sent({}), list), null);
assert.equal(addressToSave('x'.repeat(25), sent({}), list), null);
assert.equal(addressToSave('Дача', sent({ address: 'ул.' }), list), null);

console.log('адреса в корзине: чип, предложение сохранить, метка и отправка — проверки прошли');
