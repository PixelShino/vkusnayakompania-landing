/**
 * Saved addresses in the cart's checkout: which chip the address fields are,
 * whether to offer «Сохранить адрес в кабинете» under them, which label to
 * suggest and what leaves for `guest-auth/addresses/add` after the order.
 * Pure rules over `addresses.ts`; `src/scripts/account-cart.ts` paints them,
 * `cart-addresses.check.ts` checks them.
 * Сохранённые адреса в оформлении корзины: какой чип соответствует полям
 * адреса, предлагать ли под ними «Сохранить адрес в кабинете», какую метку
 * подсказать и что уходит в `guest-auth/addresses/add` после заказа. Чистые
 * правила поверх `addresses.ts`; рисует их `src/scripts/account-cart.ts`,
 * проверяет `cart-addresses.check.ts`.
 */
import { ADDRESS_MIN, LABEL_PRESETS, MAX_ADDRESSES, addressErrors, defaultLabel, sameSaved, type AddressInput, type SavedAddress } from './addresses.ts';
import { aptPart, type OrderPayload } from './order.ts';

/** Адресные поля формы корзины так, как их набрал гость. */
export type CheckoutAddress = { address: string; flat: string; entrance: string; floor: string; intercom: string };

/** Что из отправленного заказа нужно, чтобы сохранить адрес. */
export type SentAddress = Pick<OrderPayload, 'fulfillment' | 'address' | 'address_flat' | 'address_entrance' | 'address_floor' | 'address_intercom'>;

/** Значение радио «Новый адрес» среди чипов. */
export const NEW_ADDRESS = 'new';
/** Значение чипа своей метки в блоке сохранения. */
export const OWN_LABEL = 'own';

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * The saved address the fields are: the same street, house and flat. The
 * field may say «кв. 12» where the saved one says «12» — the flat is read
 * the way the order sends it.
 * Сохранённый адрес, которому соответствуют поля: та же улица, дом и
 * квартира. В поле может стоять «кв. 12», а в сохранённом — «12»: квартира
 * читается так, как её отправит заказ.
 */
export const savedMatch = (list: readonly SavedAddress[], fields: Pick<CheckoutAddress, 'address' | 'flat'>) =>
  clean(fields.address) ? (list.find((a) => sameSaved(a, { address: fields.address, flat: aptPart('flat', fields.flat) })) ?? null) : null;

/**
 * The chip's second line: «улица Советской Армии, 177» + «12» →
 * «Советской Армии, 177, кв. 12». «Улица» says nothing on a chip, the flat
 * tells «Дом» from «Мама» in the same house; «офис 3» stays as saved.
 * Вторая строка чипа: «улица Советской Армии, 177» + «12» →
 * «Советской Армии, 177, кв. 12». «Улица» на чипе ничего не говорит, а
 * квартира отличает «Дом» от «Мамы» в том же доме; «офис 3» остаётся как есть.
 */
export const chipLine = (a: Pick<SavedAddress, 'address' | 'flat'>) => {
  const street = clean(a.address).replace(/^(?:улица|ул\.?)\s+/iu, '');
  const flat = aptPart('flat', a.flat);
  return [street, flat && (/^\p{L}/u.test(flat) ? flat : `кв. ${flat}`)].filter(Boolean).join(', ');
};

/**
 * Which chip is on: the saved address the fields are; «Новый адрес» once the
 * guest asked for it or typed something that is not saved; none while the
 * fields are empty and nothing was asked.
 * Какой чип выбран: сохранённый адрес, которому соответствуют поля; «Новый
 * адрес», если гость его выбрал или набрал то, чего нет в сохранённых;
 * никакой, пока поля пусты и гость ничего не выбирал.
 */
export const chipFor = (list: readonly SavedAddress[], fields: CheckoutAddress, wantsNew = false): string | null => {
  const match = savedMatch(list, fields);
  if (match) return match.id;
  const typed = [fields.address, fields.flat, fields.entrance, fields.floor, fields.intercom].some((value) => clean(value));
  return typed || wantsNew ? NEW_ADDRESS : null;
};

/**
 * Under the courier fields: nothing (no street and house yet, or the address
 * is saved already — `add` would rename it), the tick «Сохранить адрес в
 * кабинете», or the limit line when five are saved.
 * Под полями для курьера: ничего (ещё нет улицы и дома или адрес уже
 * сохранён — `add` переименовал бы его), галочка «Сохранить адрес в
 * кабинете» или строка о пределе, когда сохранено пять.
 */
export const saveOffer = (list: readonly SavedAddress[], fields: CheckoutAddress): 'none' | 'offer' | 'limit' => {
  if (clean(fields.address).length < ADDRESS_MIN.address) return 'none';
  if (savedMatch(list, fields)) return 'none';
  return list.length >= MAX_ADDRESSES ? 'limit' : 'offer';
};

/**
 * The label chips: «Дом» and «Работа» while they are free, then «Своя». The
 * chip that starts on is `defaultLabel`; when both presets are taken it is
 * «Своя» with «Адрес 3» already in its field.
 * Чипы меток: «Дом» и «Работа», пока они свободны, затем «Своя». Сначала
 * выбрана `defaultLabel`; когда обе заняты — «Своя» с «Адрес 3» в поле.
 */
export const labelChoice = (list: readonly Pick<SavedAddress, 'label'>[]) => {
  const taken = new Set(list.map((a) => a.label.toLowerCase()));
  const presets = LABEL_PRESETS.filter((preset) => !taken.has(preset.toLowerCase()));
  const label = defaultLabel([...list]);
  const preset = presets.find((item) => item === label);
  return { presets: [...presets] as string[], chosen: preset ?? OWN_LABEL, own: preset ? '' : label };
};

/** The label to save: the chosen preset, or the guest's own words — empty words fall back to the default. / Метка к сохранению: выбранная или своя; пустая своя — метка по умолчанию. */
export const labelToSave = (chosen: string, own: string, list: readonly Pick<SavedAddress, 'label'>[]) =>
  chosen === OWN_LABEL ? clean(own) || defaultLabel([...list]) : chosen;

/** Поля формы из отправленного заказа: что ушло, то и сохраняем. */
export const sentFields = (sent: SentAddress): CheckoutAddress => ({
  address: sent.address ?? '',
  flat: sent.address_flat ?? '',
  entrance: sent.address_entrance ?? '',
  floor: sent.address_floor ?? '',
  intercom: sent.address_intercom ?? '',
});

/**
 * What leaves for `addresses/add`: the label and the address as the order
 * sent it — or `null` for a pickup, an address already saved (the server
 * would overwrite its label), a full list, or what the rules refuse.
 * Что уходит в `addresses/add`: метка и адрес в том виде, в каком их отправил
 * заказ, — или `null` для самовывоза, уже сохранённого адреса (сервер
 * переписал бы его метку), полного списка или того, что не проходит правила.
 */
export const addressToSave = (label: string, sent: SentAddress, list: readonly SavedAddress[]): AddressInput | null => {
  if (sent.fulfillment !== 'delivery') return null;
  const fields = sentFields(sent);
  if (saveOffer(list, fields) !== 'offer') return null;
  const input: AddressInput = { label: clean(label), address: clean(fields.address) };
  for (const key of ['flat', 'entrance', 'floor', 'intercom'] as const) {
    const value = aptPart(key, fields[key]);
    if (value) input[key] = value;
  }
  return Object.keys(addressErrors(input)).length ? null : input;
};
