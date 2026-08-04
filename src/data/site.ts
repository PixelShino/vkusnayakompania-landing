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
  legalName: 'Вкусная компания',
  city: 'Самара',
  title: 'Вкусная компания — кондитерская и кухня в Самаре',
  description:
    'Торты на заказ за 48 часов, пирожные и конфеты с собственного цеха, завтраки и обеды в зале. Две точки в Самаре, доставка по городу.',
  // номер подтверждён карточкой организации на Яндекс.Картах
  phone: '+7 987 955-25-65',
  phoneHref: 'tel:+79879552565',
  hours: {
    label: '8:00 — 21:00',
    note: 'Пн–пт с 8:00, сб с 8:30, вс с 9:00 · витрина полная с утра',
    // для JSON-LD
    schema: ['Mo-Fr 08:00-21:00', 'Sa 08:30-21:00', 'Su 09:00-21:00'],
  },
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
  map: {
    center: { lat: 53.1959, lng: 50.1008 },
    zoom: 12,
  },
} as const;

export type Place = {
  n: string;
  addr: string;
  street: string;
  note: string;
  hours: string;
  schemaHours: string[];
  opensAt: string;
  phone: string;
  phoneHref: string;
  status: string;
  lat: number;
  lng: number;
  /** id организации на Яндекс.Картах — им живёт виджет и ссылки «маршрут» */
  yandexOrg: string;
  rating: string;
  ratingCount: number;
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
    hours: 'Пн–пт 8:00 — 21:00 · сб 8:30 · вс 9:00',
    schemaHours: ['Mo-Fr 08:00-21:00', 'Sa 08:30-21:00', 'Su 09:00-21:00'],
    opensAt: 'с восьми',
    phone: site.phone,
    phoneHref: site.phoneHref,
    status: 'Открыто',
    lat: 53.195878,
    lng: 50.100202,
    yandexOrg: '154837147598',
    rating: '4,8',
    ratingCount: 765,
  },
  {
    n: '2',
    addr: 'Советской Армии, 177',
    street: 'Советской Армии',
    note: 'Ресторан и кондитерская',
    hours: 'Ежедневно 9:00 — 22:30',
    schemaHours: ['Mo-Su 09:00-22:30'],
    opensAt: 'с девяти',
    phone: site.phone,
    phoneHref: site.phoneHref,
    status: 'Открыто',
    lat: 53.222568,
    lng: 50.202188,
    yandexOrg: '243452895564',
    rating: '5,0',
    ratingCount: 320,
  },
];

/** Ссылка на карточку точки в Яндекс.Картах (там же кнопка «как добраться») */
export const yandexOrgUrl = (orgId: string) =>
  `https://yandex.ru/maps/org/vkusnaya_kompaniya/${orgId}/`;

export const nav = [
  { label: 'Торты', href: '#cakes' },
  { label: 'Десерты', href: '#sweets' },
  { label: 'Зал', href: '#room' },
  { label: 'Контакты', href: '#contacts' },
];

export const footerLinks = [
  { label: 'Магазин доставки', href: site.links.shop },
  { label: 'Кейтеринг и банкеты', href: site.links.catering },
  { label: 'Приложение', href: '#apps' },
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
