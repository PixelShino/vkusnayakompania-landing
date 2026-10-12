/**
 * The catering request form: its rules and the request that leaves for
 * Directus. The same rules run on the server (`directus/extensions/request-guard`);
 * here they let the guest fix a mistake before sending. The phone is the
 * cart's (`order.ts`): one mask and one check for every form on the site.
 * Форма заявки на кейтеринг: её правила и заявка, которая уходит в Directus.
 * Те же правила работают на сервере (`directus/extensions/request-guard`);
 * здесь они дают гостю исправить ошибку до отправки. Телефон — как у корзины
 * (`order.ts`): одна маска и одна проверка на все формы сайта.
 */
import { normalizePhone } from './order.ts';
import { plural } from '../data/site.ts';

export const REQUEST_DRAFT_KEY = 'vk-request-v1';
/** те же пределы, что у `request-guard` */
export const REQUEST_LIMITS = { name: 80, address: 200, wishes: 2000, guests: 2000, daysAhead: 730 };

/**
 * Where the party is: one of our halls (`place:<id>`), the guest's own venue
 * or not decided yet. One radio group instead of «hall → which hall».
 * Где праздник: один из наших залов (`place:<id>`), площадка гостя или пока не
 * решено. Одна группа переключателей вместо «зал → какой зал».
 */
export type Where = `place:${number}` | 'offsite' | 'unknown';

export type RequestForm = {
  name: string;
  phone: string;
  /** YYYY-MM-DD; пусто — гость дату не назвал */
  date?: string;
  /** строкой из поля ввода; пусто — не назвал */
  guests?: string;
  /** id формата; пусто — «ещё не решили» */
  format?: number | null;
  where: Where;
  address?: string;
  wishes?: string;
  consent: boolean;
};

export type RequestErrors = Partial<Record<'name' | 'phone' | 'date' | 'guests' | 'consent', string>>;

/** То, что уходит `POST /items/catering_requests`: статус, источник и номер ставит сервер. */
export type RequestPayload = {
  number: string;
  name: string;
  phone: string;
  event_date: string | null;
  guests: number | null;
  format: number | null;
  venue: 'hall' | 'offsite' | 'unknown';
  place: number | null;
  address: string | null;
  wishes: string | null;
  consent: true;
};

const DAY = 86_400_000;
const addDays = (ymd: string, days: number) =>
  new Date(Date.parse(`${ymd}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
/** сегодня в Самаре: «прошлое» для даты считается по точкам, как у сервера */
export const samaraToday = (now = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Samara' }).format(now);
/** самая поздняя дата, которую примет сервер */
export const latestDate = (today: string) => addDays(today, REQUEST_LIMITS.daysAhead);

const guestsOf = (value?: string) => {
  const text = (value ?? '').replace(/\s/g, '');
  if (!text) return null;
  return /^\d+$/.test(text) ? Number(text) : NaN;
};

/** Ошибки формы по полям; пустой объект — можно отправлять. */
export const validateRequest = (form: RequestForm, today = samaraToday()): RequestErrors => {
  const errors: RequestErrors = {};
  if (!form.name.trim()) errors.name = 'Как к вам обращаться?';
  if (!form.phone.replace(/\D/g, '')) errors.phone = 'Нужен телефон: по нему перезвоним';
  else if (!normalizePhone(form.phone)) errors.phone = 'Проверьте номер: 10 цифр после +7';
  if (form.date) {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(form.date) && addDays(form.date, 0) === form.date;
    if (!valid) errors.date = 'Выберите дату в календаре';
    else if (form.date < today) errors.date = 'Эта дата уже прошла';
    else if (form.date > latestDate(today)) errors.date = 'Так далеко вперёд не принимаем — в пределах двух лет';
  }
  const guests = guestsOf(form.guests);
  if (guests !== null && !(Number.isInteger(guests) && guests >= 1 && guests <= REQUEST_LIMITS.guests))
    errors.guests = `Число от 1 до ${REQUEST_LIMITS.guests}`;
  if (!form.consent) errors.consent = 'Без согласия мы не сможем перезвонить';
  return errors;
};

/** Заявка в том виде, в каком она уходит из браузера. */
export const buildRequest = (form: RequestForm, number: string): RequestPayload => {
  const place = form.where.startsWith('place:') ? Number(form.where.slice(6)) : null;
  const venue = place ? 'hall' : form.where === 'offsite' ? 'offsite' : 'unknown';
  const guests = guestsOf(form.guests);
  return {
    number,
    name: form.name.trim().slice(0, REQUEST_LIMITS.name),
    phone: normalizePhone(form.phone) ?? form.phone.trim(),
    event_date: form.date || null,
    guests: guests && Number.isInteger(guests) ? guests : null,
    format: form.format ? Number(form.format) : null,
    venue,
    place,
    address: venue === 'offsite' ? (form.address ?? '').trim().slice(0, REQUEST_LIMITS.address) || null : null,
    wishes: (form.wishes ?? '').trim().slice(0, REQUEST_LIMITS.wishes) || null,
    consent: true,
  };
};

/** «40 гостей» */
export const guestsWord = (n: number) => `${n} ${plural(n, 'гость', 'гостя', 'гостей')}`;

/** «сб, 20 декабря» — дата словами для экрана «Заявка принята». */
export const dateWords = (ymd: string) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long' }).format(
    new Date(`${ymd}T12:00:00Z`),
  );
