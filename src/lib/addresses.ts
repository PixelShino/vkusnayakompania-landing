/**
 * The guest's saved addresses — «Дом», «Работа», a label of his own — kept on
 * the guest in Directus (`directus_users.addresses`, written only by the
 * `guest-auth` routes) and offered in the cart and the account. Pure rules
 * here; the server keeps the same ones in
 * `directus/extensions/guest-auth/addresses.js`, `addresses.check.ts` compares.
 * Сохранённые адреса гостя — «Дом», «Работа», своя метка — хранятся у гостя в
 * Directus (`directus_users.addresses`, пишут только маршруты `guest-auth`) и
 * предлагаются в корзине и в кабинете. Здесь чистые правила; у сервера те же
 * в `directus/extensions/guest-auth/addresses.js`, `addresses.check.ts` сверяет.
 */
import { APT_MAX, addressLine, aptPart, type AptKey } from './order.ts';

export type SavedAddress = {
  /** 8 знаков, выдаёт сервер */
  id: string;
  label: string;
  /** улица и дом — то, что видит геокодер */
  address: string;
  flat: string | null;
  entrance: string | null;
  floor: string | null;
  intercom: string | null;
};

export type AddressInput = { label?: string; address?: string; flat?: string; entrance?: string; floor?: string; intercom?: string };
export type AddressField = 'label' | 'address' | AptKey;

export const MAX_ADDRESSES = 5;
export const ADDRESS_MAX = { label: 24, address: 200, ...APT_MAX } as const;
export const ADDRESS_MIN = { address: 5 } as const;
/** Метки, которые предлагаются первыми; дальше своя. */
export const LABEL_PRESETS = ['Дом', 'Работа'] as const;
export const LIMIT_MESSAGE = `Сохранено ${MAX_ADDRESSES} адресов — удалите ненужный в кабинете`;

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * What the form refuses before sending — the same words as the server.
 * От чего форма отказывается до отправки — те же слова, что у сервера.
 */
export const addressErrors = (input: AddressInput): Partial<Record<AddressField, string>> => {
  const errors: Partial<Record<AddressField, string>> = {};
  const label = clean(input.label);
  if (!label) errors.label = 'Как назвать адрес: Дом, Работа…';
  else if (label.length > ADDRESS_MAX.label) errors.label = `Не длиннее ${ADDRESS_MAX.label} знаков`;
  const address = clean(input.address);
  if (address.length < ADDRESS_MIN.address) errors.address = 'Укажите улицу и дом';
  else if (address.length > ADDRESS_MAX.address) errors.address = `Не длиннее ${ADDRESS_MAX.address} знаков`;
  for (const key of ['flat', 'entrance', 'floor', 'intercom'] as const) {
    if (clean(input[key]).length > ADDRESS_MAX[key]) errors[key] = `Не длиннее ${ADDRESS_MAX[key]} знаков`;
  }
  return errors;
};

/** The address as it is stored: trimmed, the parts without their repeated words. / Как хранится: без лишних пробелов и повторов слов. */
export const cleanAddress = (input: AddressInput): Omit<SavedAddress, 'id'> => ({
  label: clean(input.label).slice(0, ADDRESS_MAX.label),
  address: clean(input.address).slice(0, ADDRESS_MAX.address),
  flat: aptPart('flat', input.flat),
  entrance: aptPart('entrance', input.entrance),
  floor: aptPart('floor', input.floor),
  intercom: aptPart('intercom', input.intercom),
});

/** «ул. Ленина, 1» + «12» → «ул ленина 1|12»: по этому ключу адрес считается тем же. */
export const addressKey = (address: string | null | undefined, flat: string | null | undefined) =>
  `${clean(address).toLowerCase().replace(/[.,;«»"']/g, '').replace(/\s+/g, ' ')}|${clean(flat).toLowerCase()}`;

export const sameSaved = (a: Pick<SavedAddress, 'address' | 'flat'>, b: Pick<SavedAddress, 'address' | 'flat'>) =>
  addressKey(a.address, a.flat) === addressKey(b.address, b.flat);

/** «Дом», then «Работа», then «Адрес 3». / Сначала «Дом», потом «Работа», потом «Адрес 3». */
export const defaultLabel = (list: Pick<SavedAddress, 'label'>[]) => {
  const taken = new Set(list.map((a) => a.label.toLowerCase()));
  for (const preset of LABEL_PRESETS) if (!taken.has(preset.toLowerCase())) return preset;
  return `Адрес ${list.length + 1}`;
};

/** Одна строка для глаз: «проспект Ленина, 1, кв. 12, подъезд 2». */
export const savedLine = (a: Pick<SavedAddress, 'address' | 'flat' | 'entrance' | 'floor' | 'intercom'>) =>
  addressLine({ address: a.address, address_flat: a.flat, address_entrance: a.entrance, address_floor: a.floor, address_intercom: a.intercom });

/** Что из сохранённого адреса попадает в поля формы корзины. / Что подставляется в поля корзины. */
export const toCheckoutFields = (a: SavedAddress) => ({
  address: a.address,
  flat: a.flat ?? '',
  entrance: a.entrance ?? '',
  floor: a.floor ?? '',
  intercom: a.intercom ?? '',
});
