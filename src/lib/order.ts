/**
 * Checkout: the form's rules and the order that leaves for Directus. The same
 * rules run on the server (`directus/extensions/order-guard`); here they let
 * the guest fix a mistake before sending instead of after a round trip.
 * Оформление: правила формы и заказ, который уходит в Directus. Те же правила
 * работают на сервере (`directus/extensions/order-guard`); здесь они дают гостю
 * исправить ошибку до отправки, а не после круга по сети.
 */
import type { Cart, CartIndex } from './cart.ts';
import { priced } from './cart.ts';

export const CHECKOUT_KEY = 'vk-checkout-v1';

export type Fulfillment = 'delivery' | 'pickup';

export type CheckoutForm = {
  name: string;
  phone: string;
  fulfillment: Fulfillment;
  /** id точки самовывоза */
  place?: number | null;
  /** улица и дом — то, что ищется на карте */
  address?: string;
  /** квартира или офис, подъезд, этаж, код домофона — для курьера, все необязательны */
  flat?: string;
  entrance?: string;
  floor?: string;
  intercom?: string;
  when: 'asap' | 'later';
  /** YYYY-MM-DD */
  date?: string;
  /** HH:MM */
  time?: string;
  comment?: string;
  consent: boolean;
};

export type OrderLine = {
  product: number;
  title: string;
  variant: string | null;
  filling: string | null;
  qty: number;
  price: number;
  sum: number;
};

/** То, что уходит `POST /items/orders`: сервер пересчитает строки и сумму. */
export type OrderPayload = {
  number: string;
  customer_name: string;
  phone: string;
  fulfillment: Fulfillment;
  place: number | null;
  address: string | null;
  address_flat: string | null;
  address_entrance: string | null;
  address_floor: string | null;
  address_intercom: string | null;
  desired_time: string;
  comment: string | null;
  items: OrderLine[];
  total: number;
  consent: true;
};

/** Цифры номера без кода страны: «9879552565»; пусто, если на номер не похоже. */
const local = (value: string) => {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) digits = digits.slice(1);
  return digits.length === 10 ? digits : '';
};

/** «8 987 955 25 65» → «+7 987 955-25-65»; `null` — не российский номер. */
export const normalizePhone = (value: string) => {
  const digits = local(value);
  if (!/^[3-9]\d{9}$/.test(digits)) return null;
  return `+7 ${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
};

/**
 * As-you-type mask: «+7 (987) 955-25-65». A leading 8 or 7 is the country
 * code, anything else starts the number itself; a pasted «+7 987…» lands right.
 * Маска при вводе: «+7 (987) 955-25-65». Первая 8 или 7 — код страны, любая
 * другая цифра начинает сам номер; вставленный «+7 987…» ложится верно.
 */
/**
 * Backspace over a mask character («)», «-», space) used to put it straight
 * back: the digit before it stayed, and the number could not be cleared past
 * the brackets. On a deletion that removed only formatting, the digit before
 * the caret goes too.
 * Backspace по символу маски («)», «-», пробел) возвращал его на место: цифра
 * перед ним оставалась, и номер нельзя было стереть дальше скобок. При удалении,
 * которое убрало только оформление, уходит и цифра перед ним.
 */
export const phoneAfterEdit = (prev: string, next: string, deleting: boolean) => {
  const digits = (value: string) => value.replace(/\D/g, '');
  let raw = next;
  if (deleting && digits(prev).length > 0 && digits(next).length === digits(prev).length)
    raw = next.replace(/\D+$/, '').slice(0, -1);
  return maskPhone(raw);
};

/** Вешает маску на поле: ввод форматируется, удаление проходит сквозь скобки и дефисы. */
export const bindPhoneMask = (input: HTMLInputElement, after?: () => void) => {
  let prev = input.value;
  input.addEventListener('input', (event) => {
    const deleting = Boolean((event as InputEvent).inputType?.startsWith('delete'));
    const masked = phoneAfterEdit(prev, input.value, deleting);
    if (masked !== input.value) input.value = masked;
    prev = masked;
    after?.();
  });
  input.addEventListener('focus', () => {
    if (!input.value) input.value = '+7 ';
    prev = input.value;
  });
};

export const maskPhone = (value: string) => {
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';
  // the field already shows «+7 » when a guest pastes «+7 987…» from contacts:
  // with more than ten digits the number is the last ten, whatever precedes them
  // в поле уже стоит «+7 », когда гость вставляет «+7 987…» из контактов: при
  // более чем десяти цифрах номер — последние десять, что бы ни шло перед ними
  if (digits.length > 10) digits = digits.slice(-10);
  else if (digits[0] === '8' || digits[0] === '7') digits = digits.slice(1);
  let out = '+7';
  if (digits.length) out += ` (${digits.slice(0, 3)}`;
  if (digits.length >= 3) out += ')';
  if (digits.length > 3) out += ` ${digits.slice(3, 6)}`;
  if (digits.length > 6) out += `-${digits.slice(6, 8)}`;
  if (digits.length > 8) out += `-${digits.slice(8, 10)}`;
  return out;
};

export type Errors = Partial<Record<'name' | 'phone' | 'address' | 'place' | 'time' | 'consent', string>>;

/** Ошибки формы по полям; пустой объект — можно отправлять. */
export const validate = (form: CheckoutForm): Errors => {
  const errors: Errors = {};
  if (!form.name.trim()) errors.name = 'Как к вам обращаться?';
  if (!form.phone.replace(/\D/g, '')) errors.phone = 'Нужен телефон: по нему подтвердим заказ';
  else if (!normalizePhone(form.phone)) errors.phone = 'Проверьте номер: 10 цифр после +7';
  if (form.fulfillment === 'delivery' && (form.address ?? '').trim().length < 5)
    errors.address = 'Укажите улицу и дом, куда привезти';
  if (form.fulfillment === 'pickup' && !form.place) errors.place = 'Выберите, откуда заберёте';
  if (form.when === 'later' && !(form.date && form.time)) errors.time = 'Выберите день и время';
  if (!form.consent) errors.consent = 'Поставьте галочку выше — без согласия заказ не отправить';
  return errors;
};

// ── the flat, the entrance, the floor, the intercom / квартира, подъезд, этаж, домофон ──

export type AptKey = 'flat' | 'entrance' | 'floor' | 'intercom';

/** Длина каждого поля — та же, что у `maxlength` в форме и у сервера. */
export const APT_MAX: Record<AptKey, number> = { flat: 20, entrance: 10, floor: 10, intercom: 20 };

// The word a guest types out of habit in a field that already says it:
// «кв. 12» in «Квартира / офис», «2 подъезд» in «Подъезд». Without it the
// manager reads one way of writing for every order, and «кв. кв. 12» never
// appears in the address line. An office keeps its word: it is not a flat.
// Слово, которое гость пишет по привычке в поле, где оно уже написано:
// «кв. 12» в «Квартира / офис», «2 подъезд» в «Подъезде». Без него менеджер
// читает каждый заказ в одной записи, а «кв. кв. 12» не появляется в строке
// адреса. Офис своё слово сохраняет: это не квартира.
const WORD_START = '(?<![\\p{L}\\d])';
const WORD_END = '(?![\\p{L}])';
const APT_WORD: Record<AptKey, RegExp> = {
  flat: new RegExp(`^${WORD_START}(?:кв\\.?|квартира)${WORD_END}\\s*(?:№\\s*)?`, 'iu'),
  entrance: new RegExp(`^${WORD_START}(?:подъезд|под\\.|п\\.)${WORD_END}\\s*(?:№\\s*)?|(?:-?й)?\\s*(?<![\\p{L}])подъезд${WORD_END}\\.?$`, 'iu'),
  floor: new RegExp(`^${WORD_START}(?:этаж|эт\\.?)${WORD_END}\\s*|(?:-?й)?\\s*(?<![\\p{L}])(?:этаж|эт\\.?)${WORD_END}$`, 'iu'),
  intercom: new RegExp(`^${WORD_START}(?:код\\s+домофона|домофон|код|д/ф)${WORD_END}\\s*[:№]?\\s*`, 'iu'),
};

/** Значение поля для заказа: без повтора подписи поля, не длиннее предела, пустое — `null`. */
export const aptPart = (key: AptKey, value: string | undefined | null) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(APT_WORD[key], '')
    .trim()
    .slice(0, APT_MAX[key]) || null;

type AddressParts = {
  address: string | null;
  address_flat?: string | null;
  address_entrance?: string | null;
  address_floor?: string | null;
  address_intercom?: string | null;
};

/**
 * One line for the eyes, the same on «order accepted» and in the account:
 * «улица Советской Армии, 177, кв. 12, подъезд 2, этаж 5, домофон 12К».
 * A flat that starts with a word («офис 3», «пом. 2») stays as typed, the same
 * rule as the manager's notification (`directus/extensions/notify/lib.js`).
 * Одна строка для глаз, одна и та же на «Заказ принят» и в кабинете:
 * «улица Советской Армии, 177, кв. 12, подъезд 2, этаж 5, домофон 12К».
 * Квартира, начатая словом («офис 3», «пом. 2»), остаётся как набрана — то же
 * правило, что в уведомлении менеджеру (`directus/extensions/notify/lib.js`).
 */
export const addressLine = (order: AddressParts) => {
  const flat = aptPart('flat', order.address_flat);
  const entrance = aptPart('entrance', order.address_entrance);
  const floor = aptPart('floor', order.address_floor);
  const intercom = aptPart('intercom', order.address_intercom);
  return [
    (order.address ?? '').trim(),
    flat && (/^\p{L}/u.test(flat) ? flat : `кв. ${flat}`),
    entrance && `подъезд ${entrance}`,
    floor && `этаж ${floor}`,
    intercom && `домофон ${intercom}`,
  ]
    .filter(Boolean)
    .join(', ');
};

const APT_KIND: [AptKey, RegExp][] = [
  ['flat', /^(?:кв\.?|квартира|оф\.?|офис)$/iu],
  ['entrance', /^(?:подъезд|под\.|п\.)$/iu],
  ['floor', /^(?:этаж|эт\.?)$/iu],
  ['intercom', /^(?:домофон|код|д\/ф)$/iu],
];
const kindOf = (word: string | undefined) => (word ? APT_KIND.find(([, label]) => label.test(word))?.[0] : undefined);
/** «12», «12А», «5-й», «45#» — значение, а не слово */
const valueOf = (word: string | undefined) => (word && /^-?\d[\p{L}\d#*/-]*$/u.test(word) ? word.replace(/-?й$/u, '') : '');

/**
 * A draft from before 23.10.2026 kept one line «Квартира, подъезд, этаж».
 * Its labelled pieces — «кв. 12», «2 подъезд», «этаж 5», «домофон 12К», with
 * commas or without — go to their fields, a bare number is the flat, and the
 * words that fit no field go to `rest` for the comment: the guest loses
 * nothing he once typed.
 * Черновик до 23.10.2026 хранил одну строку «Квартира, подъезд, этаж». Её
 * подписанные куски — «кв. 12», «2 подъезд», «этаж 5», «домофон 12К», через
 * запятую или без — уходят в свои поля, голое число — квартира, а слова, не
 * подошедшие ни к одному полю, — в `rest` для комментария: гость не теряет
 * ничего из когда-то набранного.
 */
export const splitDetails = (details: string) => {
  const out: Record<AptKey, string> & { rest: string } = { flat: '', entrance: '', floor: '', intercom: '', rest: '' };
  const rest: string[] = [];
  const put = (key: AptKey, value: string) => {
    if (out[key] || !value || value.length > APT_MAX[key]) return false;
    out[key] = value;
    return true;
  };
  for (const piece of String(details ?? '').split(/[,;]+/)) {
    const words = piece
      .replace(/код\s+домофона/giu, 'домофон')
      .replace(/[:№]/g, ' ')
      // «кв12», «5эт» — label and number apart / подпись и число порознь
      .replace(/(?<![\p{L}])(кв\.?|эт\.?)(?=\d)/giu, '$1 ')
      .replace(/(\d)(?=(?:эт|этаж|подъезд)(?![\p{L}]))/giu, '$1 ')
      .split(/\s+/)
      .filter(Boolean);
    const left: string[] = [];
    // a label takes the number after it («подъезд 2»), a number takes the label
    // after it («2 подъезд»); left to right, so «кв 45 3 подъезд» is two pairs
    // подпись берёт число после себя («подъезд 2»), число — подпись после себя
    // («2 подъезд»); слева направо, поэтому «кв 45 3 подъезд» — две пары
    for (let i = 0; i < words.length; i += 1) {
      const [word, next] = [words[i], words[i + 1]];
      const kind = kindOf(word);
      if (kind && valueOf(next) && put(kind, kind === 'flat' && /^оф/iu.test(word) ? `${word} ${next}` : valueOf(next))) {
        i += 1;
        continue;
      }
      const after = kindOf(next);
      if (!kind && after && valueOf(word) && put(after, after === 'flat' && /^оф/iu.test(next) ? `${next} ${word}` : valueOf(word))) {
        i += 1;
        continue;
      }
      left.push(word);
    }
    if (left.length) rest.push(left.join(' '));
  }
  // an unlabelled number is the flat («12», «12А»); words go to the comment
  // число без подписи — квартира («12», «12А»); слова — в комментарий
  if (rest.length && /^\d[\p{L}\d/-]{0,5}$/u.test(rest[0]) && put('flat', rest[0])) rest.shift();
  out.rest = rest.join(', ');
  return out;
};

const DAY = 86_400_000;
const zone = 'Europe/Samara';
const ymd = (date: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: zone }).format(date);
const hm = (date: Date) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);

/** окно заказов ко времени; точное время менеджер подтверждает при звонке */
export const SLOT_FROM = '09:00';
export const SLOT_TO = '21:00';
/** ближайший слот — не раньше чем через час: кухне нужно время */
const LEAD_MIN = 60;

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/** Слоты по 30 минут на день `date`; сегодня — не раньше чем через час от `now`. */
export const slotsFor = (date: string, now: Date) => {
  const from = minutes(SLOT_FROM);
  const to = minutes(SLOT_TO);
  const earliest = date === ymd(now) ? minutes(hm(now)) + LEAD_MIN : 0;
  const slots: string[] = [];
  for (let t = from; t <= to; t += 30) if (t >= earliest) slots.push(clock(t));
  return slots;
};

/** Дни для «ко времени»: сегодня (если остались слоты) и следующие шесть. */
export const daysFrom = (now: Date) => {
  const days: { value: string; label: string }[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(now.getTime() + i * DAY);
    const value = ymd(date);
    if (i === 0 && !slotsFor(value, now).length) continue;
    const name = new Intl.DateTimeFormat('ru-RU', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'long' }).format(date);
    days.push({ value, label: i === 0 ? `Сегодня, ${name.split(', ')[1] ?? name}` : i === 1 ? `Завтра, ${name.split(', ')[1] ?? name}` : name });
  }
  return days;
};

/** «Как можно скорее» или «пт, 17 октября, к 14:30» — как гость выбрал, словами для менеджера. */
export const desiredTime = (form: CheckoutForm) => {
  if (form.when !== 'later' || !form.date || !form.time) return 'Как можно скорее';
  const date = new Date(`${form.date}T12:00:00+04:00`);
  const day = new Intl.DateTimeFormat('ru-RU', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'long' }).format(date);
  return `${day}, к ${form.time}`;
};

/** «1210-4821»: день, месяц и четыре цифры. `random` — от 0 до 1, как `Math.random()`. */
export const orderNumber = (now: Date, random: number) => {
  const day = new Intl.DateTimeFormat('ru-RU', { timeZone: zone, day: '2-digit', month: '2-digit' }).format(now).replace('.', '');
  return `${day}-${1000 + Math.floor(random * 9000)}`;
};

/**
 * The order as it leaves the browser. Only lines that can be ordered go;
 * titles and prices are for the server's comparison and the manager's eyes —
 * the server rebuilds both from the catalog.
 * Заказ в том виде, в каком он уходит из браузера. Идут только строки, которые
 * можно заказать; названия и цены — для сверки на сервере и глаз менеджера,
 * сервер всё равно собирает их заново из каталога.
 */
export const buildOrder = (cart: Cart, index: CartIndex, form: CheckoutForm, number: string): OrderPayload => {
  const { lines, total } = priced(cart, index);
  const delivery = form.fulfillment === 'delivery';
  return {
    number,
    customer_name: form.name.trim(),
    phone: normalizePhone(form.phone) ?? form.phone.trim(),
    fulfillment: form.fulfillment,
    place: delivery ? null : (form.place ?? null),
    address: delivery ? (form.address ?? '').trim() : null,
    address_flat: delivery ? aptPart('flat', form.flat) : null,
    address_entrance: delivery ? aptPart('entrance', form.entrance) : null,
    address_floor: delivery ? aptPart('floor', form.floor) : null,
    address_intercom: delivery ? aptPart('intercom', form.intercom) : null,
    desired_time: desiredTime(form),
    comment: (form.comment ?? '').trim() || null,
    items: lines
      .filter((line) => line.available)
      .map((line) => ({
        product: line.id,
        title: line.title,
        variant: line.variant,
        filling: line.filling,
        qty: line.qty,
        price: line.price,
        sum: line.sum,
      })),
    total,
    consent: true,
  };
};
