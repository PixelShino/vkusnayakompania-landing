/**
 * Schedule helpers and Yandex Maps links. The content itself lives in Directus
 * and reaches the page through `src/lib/content.ts`.
 * Функции расписания и ссылки на Яндекс Карты. Сам контент лежит в Directus и
 * приходит на страницу через `src/lib/content.ts`.
 */

/** Имя и город: в модели Directus их нет, меняются раз в жизни компании. */
export const BRAND = { name: 'Вкусная компания', city: 'Самара' } as const;

/** Часы одного дня: открытие и закрытие в 24-часовом формате. */
export type Hours = [open: string, close: string];

/** Неделя: индекс — день как в `Date.getDay()` (0 — воскресенье). */
export type Schedule = [Hours, Hours, Hours, Hours, Hours, Hours, Hours];

const DAYS_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const DAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
/** порядок показа — с понедельника, как читает человек */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Подряд идущие дни с одинаковыми часами — в одну группу. */
const groupDays = (schedule: Schedule) =>
  WEEK_ORDER.reduce<{ days: number[]; hours: Hours }[]>((groups, day) => {
    const last = groups.at(-1);
    const hours = schedule[day];
    if (last && last.hours[0] === hours[0] && last.hours[1] === hours[1]) last.days.push(day);
    else groups.push({ days: [day], hours });
    return groups;
  }, []);

/** «08:00» → «8:00» — ведущий ноль нужен схеме, но не человеку */
export const shortTime = (time: string) => time.replace(/^0/, '');

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Расписание строками: `[{ days: 'Пн–пт', hours: '8:00 — 21:00' }, …]` */
export const hoursRows = (schedule: Schedule) => {
  const groups = groupDays(schedule);
  return groups.map(({ days, hours }) => ({
    days:
      groups.length === 1
        ? 'Ежедневно'
        : days.length > 1
          ? `${capitalize(DAYS_RU[days[0]])}–${DAYS_RU[days[days.length - 1]]}`
          : capitalize(DAYS_RU[days[0]]),
    hours: `${shortTime(hours[0])} — ${shortTime(hours[1])}`,
  }));
};

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** Плашка точки в момент `day` (как `Date.getDay()`) и `minutes` от полуночи. */
export const openState = (schedule: Schedule, day: number, minutes: number) => {
  const [open, close] = schedule[day];
  const beforeOpen = minutes < toMinutes(open);
  const isOpen = !beforeOpen && minutes < toMinutes(close);

  return {
    isOpen,
    label: isOpen
      ? `Открыто до ${shortTime(close)}`
      : beforeOpen
        ? `Откроется в ${shortTime(open)}`
        : `Откроется завтра в ${shortTime(schedule[(day + 1) % 7][0])}`,
  };
};

const pluralRules = new Intl.PluralRules('ru-RU');

/** Склонение при числительном: `plural(463, 'отзыв', 'отзыва', 'отзывов')` */
export const plural = (count: number, one: string, few: string, many: string) =>
  ({ one, few, many, other: many, two: few, zero: many })[pluralRules.select(count)];

/** `['Mo-Fr 08:00-21:00', …]` — формат `openingHours` в schema.org */
export const schemaHours = (schedule: Schedule) =>
  groupDays(schedule).map(({ days, hours }) => {
    const name =
      days.length > 1 ? `${DAYS_EN[days[0]]}-${DAYS_EN[days[days.length - 1]]}` : DAYS_EN[days[0]];
    return `${name} ${hours[0]}-${hours[1]}`;
  });

/** Одна строка часов из админки: день недели и время в 24-часовом формате. */
export type HoursRow = {
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  open: string;
  close: string;
};

const DAY_INDEX: Record<HoursRow['day'], number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const DAY_NAME: Record<HoursRow['day'], string> = {
  mon: 'понедельник',
  tue: 'вторник',
  wed: 'среда',
  thu: 'четверг',
  fri: 'пятница',
  sat: 'суббота',
  sun: 'воскресенье',
};
const TIME = /^\d{2}:\d{2}$/;

/**
 * Admin rows (one per day) → schedule tuple indexed like `Date.getDay()`.
 * Строки из админки (по одной на день) → кортеж расписания по `getDay()`.
 */
export const toSchedule = (rows: HoursRow[]): Schedule => {
  const out: Hours[] = new Array(7);
  for (const row of rows) {
    if (!TIME.test(row.open) || !TIME.test(row.close) || toMinutes(row.close) <= toMinutes(row.open))
      throw new Error(
        `часы: ${DAY_NAME[row.day]} — закрытие должно быть позже открытия, формат 08:00`,
      );
    out[DAY_INDEX[row.day]] = [row.open, row.close];
  }
  for (const day of Object.keys(DAY_INDEX) as HoursRow['day'][])
    if (!out[DAY_INDEX[day]]) throw new Error(`часы: нет строки на ${DAY_NAME[day]}`);
  return out as Schedule;
};

/** Официальный виджет отзывов Яндекса */
export const yandexReviewsUrl = (orgId: string) =>
  `https://yandex.ru/maps-reviews-widget/${orgId}?comments`;

// Yandex serves the org card at the slug-less path and points og:url there itself
// Яндекс отдаёт карточку по адресу без slug и сам указывает его в og:url
export const yandexOrgUrl = (orgId: string) => `https://yandex.ru/maps/org/${orgId}/`;

type Point = { lat: number; lng: number };

/**
 * Iframe widget with a pin per venue (`pt`) and no organization card: the org
 * widget knows one card at a time and opens it over the map. Without `focus`
 * the view is centred between the venues, with it — on that venue.
 * Iframe-виджет с меткой на каждую точку (`pt`) и без карточки организации:
 * виджет организации знает одну карточку и раскрывает её поверх карты. Без
 * `focus` центр между точками, с ним — на этой точке.
 */
export const yandexWidgetUrl = (places: Point[], focus?: Point) => {
  const mean = (key: keyof Point) =>
    (places.reduce((sum, point) => sum + point[key], 0) / places.length).toFixed(6);
  const center = focus ? `${focus.lng}%2C${focus.lat}` : `${mean('lng')}%2C${mean('lat')}`;
  const pins = places.map((point) => `${point.lng}%2C${point.lat}%2Cpm2rdm`).join('~');
  return `https://yandex.ru/map-widget/v1/?ll=${center}&z=${focus ? 16 : 12}&pt=${pins}`;
};

/** Маршрут до точки: первый пункт пустой — Яндекс подставит местоположение гостя */
export const yandexRouteUrl = (place: { lat: number; lng: number }) =>
  `https://yandex.ru/maps/?rtext=~${place.lat}%2C${place.lng}&rtt=auto&z=16`;
