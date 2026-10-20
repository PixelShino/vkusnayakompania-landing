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
  address?: string;
  details?: string;
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
  address_details: string | null;
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
    errors.address = 'Улица и дом, куда привезти';
  if (form.fulfillment === 'pickup' && !form.place) errors.place = 'Выберите, откуда заберёте';
  if (form.when === 'later' && !(form.date && form.time)) errors.time = 'Выберите день и время';
  if (!form.consent) errors.consent = 'Без согласия мы не сможем перезвонить';
  return errors;
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
    address_details: delivery ? (form.details ?? '').trim() || null : null,
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
