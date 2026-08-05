/**
 * Единственный источник правды по контактам, ссылкам и мета-данным сайта.
 *
 * В исходном макете эти значения были разбросаны и противоречили друг другу:
 * телефон в шапке жил `+7 987 955-25-65`, а в контактах стоял `+7 (000) 000-00-00`;
 * бенто называло точки «Садовая, 12 · Ново-Садовая, 204», а блок «Как заказать» —
 * «Садовая» и «Советской Армии». Здесь всё сведено в одно место; всё, что ждёт
 * подтверждения клиента, помечено TODO(клиент).
 */

export const site = {
  name: 'Вкусная компания',
  city: 'Самара',
  title: 'Вкусная компания — кондитерская и кухня в Самаре',
  description:
    'Торты на заказ за 48 часов, пирожные и конфеты с собственного цеха, завтраки и обеды в зале. Две точки в Самаре, доставка по городу.',
  // номер подтверждён карточкой организации на Яндекс.Картах
  phone: '+7 987 955-25-65',
  phoneHref: 'tel:+79879552565',
  // Ссылки на действующие ресурсы «Вкусной компании».
  // TODO(клиент): дать ссылку на канал в Max — остальное подтверждено.
  links: {
    telegram: 'https://t.me/vkusnayakompania',
    max: 'https://max.ru/',
    vk: 'https://vk.ru/vkusnayakompania',
    shop: 'https://vkusdostavka.shop/',
    catering: 'https://vkusnayakompania.ru/',
    cateringServices: 'https://vkusnayakompania.ru/services/',
    appIos: 'https://apps.apple.com/app/id6477568088',
    appAndroid:
      'https://play.google.com/store/apps/details?id=com.foodpicasso.cateringvkusnaya&hl=ru',
    privacy: '#',
    offer: '#',
  },
  /** Разделы магазина доставки — на них ведут кнопки секций */
  shopSections: {
    cakesReady: 'https://vkusdostavka.shop/s/torty-v-nalichii_31',
    cakesCustom: 'https://vkusdostavka.shop/s/prazdnichnye-torty_26',
    pastry: 'https://vkusdostavka.shop/s/pirojnye_30',
    sweets: 'https://vkusdostavka.shop/s/konfety_29',
    sets: 'https://vkusdostavka.shop/s/nabory-pirojnyh-i-konfet_33',
    breakfasts: 'https://vkusdostavka.shop/s/zavtraki_1',
  },
} as const;

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

/**
 * Что показывать на плашке точки в конкретный момент.
 * `day` — как в `Date.getDay()`, `minutes` — с полуночи. Время берётся по
 * Самаре и только в браузере, поэтому расчёт вынесен сюда отдельной функцией:
 * так его можно проверить без страницы (`npm test`).
 */
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

/** Одинаковые будни + отдельные суббота и воскресенье. */
const week = (weekday: Hours, sat: Hours, sun: Hours): Schedule => [
  sun,
  weekday,
  weekday,
  weekday,
  weekday,
  weekday,
  sat,
];

export type Place = {
  n: string;
  addr: string;
  street: string;
  note: string;
  schedule: Schedule;
  lat: number;
  lng: number;
  /** id организации на Яндекс.Картах — им живёт виджет и ссылки «маршрут» */
  yandexOrg: string;
  rating: string;
};

// Адреса, координаты, часы и рейтинги сняты с карточек организации на
// Яндекс.Картах (в макете здесь стояли выдуманные адреса и `Lorem ipsum`).
// TODO(клиент): подтвердить часы второй точки и примечания к адресам.
export const places: Place[] = [
  {
    n: '1',
    addr: 'Садовая, 212Б',
    street: 'Садовая',
    note: 'Кондитерская и кухня',
    schedule: week(['08:00', '21:00'], ['08:30', '21:00'], ['09:00', '21:00']),
    lat: 53.195878,
    lng: 50.100202,
    yandexOrg: '154837147598',
    rating: '4,8',
  },
  {
    n: '2',
    addr: 'Советской Армии, 177',
    street: 'Советской Армии',
    note: 'Ресторан и кондитерская',
    schedule: week(['09:00', '22:30'], ['09:00', '22:30'], ['09:00', '22:30']),
    lat: 53.222568,
    lng: 50.202188,
    yandexOrg: '243452895564',
    rating: '5,0',
  },
];

/**
 * Публичные показатели с карточек организации на Яндекс.Картах.
 *
 * Тексты чужих отзывов сюда не переносятся: они принадлежат авторам, а
 * условия Яндекс.Карт запрещают выгружать их в свои сервисы. Сами отзывы
 * страница показывает официальным виджетом (`yandexReviewsUrl`), здесь только
 * цифры — их можно цитировать со ссылкой на источник.
 *
 * TODO(клиент): цифры сняты вручную 5 августа 2026; обновлять раз в квартал.
 */
export const yandexStats = {
  /** средневзвешенное по двум точкам: (4,8 × 765 + 5,0 × 320) / 1085 = 4,86 */
  score: '4,9',
  ratings: 1085,
  reviews: 463,
  award: 'Хорошее место 2026',
  /** доля положительных отзывов по рубрикам — с карточки на Садовой */
  highlights: [
    { label: 'Еда', percent: 87 },
    { label: 'Десерты', percent: 82 },
    { label: 'Персонал', percent: 78 },
    { label: 'Кофе', percent: 71 },
    { label: 'Напитки', percent: 68 },
  ],
};

/** Официальный виджет отзывов Яндекса — единственный легальный способ показать их у себя */
export const yandexReviewsUrl = (orgId: string) =>
  `https://yandex.ru/maps-reviews-widget/${orgId}?comments`;

/** Ссылка на карточку точки в Яндекс.Картах */
export const yandexOrgUrl = (orgId: string) =>
  `https://yandex.ru/maps/org/vkusnaya_kompaniya/${orgId}/`;

/** Iframe-виджет карточки организации — им живёт карта в контактах */
export const yandexWidgetUrl = (place: Pick<Place, 'yandexOrg' | 'lat' | 'lng'>) =>
  `https://yandex.ru/map-widget/v1/org/vkusnaya_kompaniya/${place.yandexOrg}/?ll=${place.lng}%2C${place.lat}&z=16`;

/** Маршрут до точки: первый пункт пустой — Яндекс подставит местоположение гостя */
export const yandexRouteUrl = (place: Pick<Place, 'lat' | 'lng'>) =>
  `https://yandex.ru/maps/?rtext=~${place.lat}%2C${place.lng}&rtt=auto&z=16`;

export const nav = [
  { label: 'Торты', href: '#cakes' },
  { label: 'Десерты', href: '#sweets' },
  { label: 'Зал', href: '#room' },
  { label: 'Контакты', href: '#contacts' },
];

export const footerLinks = [
  { label: 'Магазин доставки', href: site.links.shop },
  { label: 'Кейтеринг и банкеты', href: site.links.catering },
  { label: 'App Store', href: site.links.appIos },
  { label: 'Google Play', href: site.links.appAndroid },
  { label: 'ВКонтакте', href: site.links.vk },
  { label: 'Telegram', href: site.links.telegram },
];

/** Соседние проекты «Вкусной компании» — блок перелинковки */
export const ecosystem = [
  {
    kicker: 'Доставка',
    title: 'Магазин на каждый день',
    text: 'Завтраки, супы, паста, торты в наличии и пирожные — с доставкой по Самаре или самовывозом. Оплата на сайте.',
    href: site.links.shop,
    cta: 'Открыть меню',
    domain: 'vkusdostavka.shop',
    links: [
      { label: 'Торты в наличии', href: site.shopSections.cakesReady },
      { label: 'Пирожные', href: site.shopSections.pastry },
      { label: 'Завтраки', href: site.shopSections.breakfasts },
    ],
  },
  {
    kicker: 'События',
    title: 'Кейтеринг и банкеты',
    text: 'Фуршет, банкет или праздник под ключ: блюда, обслуживание, оформление и программа. Шесть лет и сотни мероприятий.',
    href: site.links.catering,
    cta: 'Смотреть услуги',
    domain: 'vkusnayakompania.ru',
    links: [
      { label: 'Услуги и форматы', href: site.links.cateringServices },
      { label: 'Частые вопросы', href: 'https://vkusnayakompania.ru/faq/' },
    ],
  },
];
