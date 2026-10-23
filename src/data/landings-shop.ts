/**
 * Search landings of the shop and the venues: `/cakes/`, `/desserts/`,
 * `/breakfasts/`, `/menu/`, `/sadovaya/`, `/sovetskoy-armii/`. One registry —
 * the address, title, H1, description and phrases of the semantic core
 * (23.10.2026) — and the builders that turn the content into what a page
 * shows: shelves of dishes from the catalog, the lead, the questions, the
 * venue a page is about, the search markup. Pure: no I/O, so the check runs it
 * on the fixture.
 *
 * The texts promise only what the content says. A number in a title or a
 * description (48 часов, 8:00, 100 гостей, 3 500 ₽) and the words listed in
 * `claims` are looked up in the content at build time; when the admin no longer
 * says it, the page takes the `fallback` and the build log names what went
 * missing — a stale «с 8:00» never reaches the snippet.
 *
 * Посадочные страницы магазина и точек: `/cakes/`, `/desserts/`,
 * `/breakfasts/`, `/menu/`, `/sadovaya/`, `/sovetskoy-armii/`. Один реестр —
 * адрес, title, H1, description и фразы семантического ядра (23.10.2026), — и
 * построители, которые делают из контента то, что показывает страница: полки
 * блюд из каталога, вводный текст, вопросы, точку, о которой страница,
 * разметку для поиска. Чистый модуль: без сети и файлов, проверка гоняет его
 * на фикстуре.
 *
 * Тексты обещают только то, что говорит контент. Число в title или description
 * (48 часов, 8:00, 100 гостей, 3 500 ₽) и слова из `claims` ищутся в контенте
 * на сборке; если админка этого больше не говорит, страница берёт `fallback`,
 * а журнал сборки называет, что пропало, — устаревшее «с 8:00» в сниппет не
 * попадёт.
 */
import type { Content, Place } from '../lib/content.ts';
import { priceLabel, rub, sizeLabel, type CatalogCategory, type Product } from '../lib/catalog.ts';
import { chatLinks } from '../lib/contact-links.ts';
import { BRAND, hoursRows, plural, shortTime } from './site.ts';

// ── the registry / реестр ────────────────────────────────────────────────────

export type ShopKey = 'cakes' | 'desserts' | 'breakfasts' | 'menu' | 'sadovaya' | 'sovetskoy-armii';
export type PlaceKey = 'sadovaya' | 'sovetskoy-armii';

export type ShopLanding = {
  key: ShopKey;
  /** путь без `BASE`, со слэшем на конце */
  path: string;
  /** имя в хлебных крошках и в ссылках с соседних страниц */
  crumb: string;
  /** до 60 знаков */
  title: string;
  h1: string;
  /** 140–160 знаков */
  description: string;
  /** фразы ядра с точной частотой: страница их не печатает, их подключит раскладка */
  keywords: string[];
  /** разделы каталога, из которых собраны полки страницы (slug); у меню — все */
  sections: string[];
  /** вид узла `WebPage` в разметке */
  schemaType: 'CollectionPage' | 'WebPage';
  /** страница точки — какой */
  place?: PlaceKey;
  /** слова, которые title и description обещают; каждое должно быть в контенте */
  claims: string[];
  /** title и description без обещаний, которые могут устареть */
  fallback: { title: string; description: string };
  /** одна строка под ссылкой на страницу с соседних страниц */
  teaser: string;
};

export const SHOP_LANDINGS: ShopLanding[] = [
  {
    key: 'cakes',
    path: '/cakes/',
    crumb: 'Торты на заказ',
    title: `Торты на заказ в Самаре — ${BRAND.name}`,
    h1: 'Торты на заказ в Самаре',
    description:
      'Праздничные, детские и свадебные торты на заказ от кондитерской «Вкусная компания» в Самаре. Готовим за 48 часов, свадебный — за 5 дней. Есть торты в наличии.',
    keywords: [
      'торт на заказ самара',
      'торт на заказ',
      'заказать торт в самаре',
      'заказать торт в самаре на день рождения',
      'свадебные торты в самаре',
      'свадебный торт',
      'торт свадебный цена самара',
      'купить торт в самаре',
      'торты самара',
      'где купить торт в самаре',
      'торт детский',
      'торт на заказ цена',
    ],
    sections: ['prazdnichnye-torty', 'torty-v-nalichii'],
    schemaType: 'CollectionPage',
    claims: ['праздничные торты', 'детск', 'свадеб', 'торты в наличии'],
    fallback: {
      title: `Торты на заказ в Самаре — ${BRAND.name}`,
      description:
        'Праздничные и детские торты на заказ от кондитерской «Вкусная компания» в Самаре: модели с фото, вес, начинки и цены. Есть готовые торты в наличии.',
    },
    teaser: 'Праздничные и детские модели, срок и цены, торты в наличии',
  },
  {
    key: 'desserts',
    path: '/desserts/',
    crumb: 'Десерты и пирожные',
    title: `Корпусные десерты и пирожные в Самаре — ${BRAND.name}`,
    h1: 'Корпусные десерты и пирожные в Самаре',
    description:
      'Корпусные десерты, пирожные, эклеры, макаронс и трюфели из собственного цеха «Вкусной компании». Купить в кафе в Самаре или заказать доставку на дом.',
    keywords: [
      'корпусные десерты самара',
      'корпусные десерты самара где купить',
      'корпусные десерты самара купить',
      'корпусные пирожные самара',
      'десерты самара',
      'корпусные десерты купить',
      'эклеры самара',
      'пирожные самара',
      'макаронс купить',
      'конфеты ручной работы самара',
    ],
    sections: ['pirojnye', 'konfety', 'nabory-pirojnyh-i-konfet'],
    schemaType: 'CollectionPage',
    claims: ['мусс', 'пирожн', 'эклер', 'макаронс', 'трюфел', 'собственного цеха', 'витрин'],
    fallback: {
      title: `Десерты и пирожные в Самаре — ${BRAND.name}`,
      description:
        'Пирожные, конфеты и наборы кондитерской «Вкусная компания» в Самаре: фото, вес и цены. Купить на витрине в кафе или заказать доставку на дом через сайт.',
    },
    teaser: 'Муссовые пирожные, эклеры, макаронс, трюфели и наборы',
  },
  {
    key: 'breakfasts',
    path: '/breakfasts/',
    crumb: 'Завтраки',
    title: `Завтраки в Самаре с 8:00 — ${BRAND.name}`,
    h1: 'Завтраки в Самаре',
    description:
      'Завтраки в Самаре: на Садовой с 8:00 по будням, на Советской Армии с 9:00 и весь день. Сырники, драники, блины, бриошь с лососем. Есть доставка завтраков.',
    keywords: [
      'завтраки в самаре',
      'где позавтракать в самаре',
      'лучшие завтраки в самаре',
      'где вкусно позавтракать в самаре',
      'вкусные завтраки в самаре',
      'ранние завтраки в самаре',
      'где можно позавтракать в самаре',
      'бизнес завтрак самара',
      'завтрак доставка самара',
    ],
    sections: ['zavtraki'],
    schemaType: 'CollectionPage',
    claims: ['сырники', 'драники', 'блины', 'бриошь с лососем', 'завтраки весь день'],
    fallback: {
      title: `Завтраки в Самаре — ${BRAND.name}`,
      description:
        'Завтраки в Самаре в кафе на Садовой и в ресторане на Советской Армии «Вкусной компании»: меню с ценами, часы обеих точек и доставка завтраков по городу.',
    },
    teaser: 'Где и во сколько позавтракать, меню завтраков с ценами',
  },
  {
    key: 'menu',
    path: '/menu/',
    crumb: 'Меню',
    title: `Меню кафе и ресторана в Самаре — ${BRAND.name}`,
    h1: 'Меню «Вкусной компании»',
    description:
      'Меню кафе на Садовой, ресторана на Советской Армии и кондитерской «Вкусная компания» в Самаре: завтраки, горячее, десерты и торты с ценами. Доставка на сайте.',
    keywords: [
      'вкусная компания самара меню',
      'вкусная компания меню',
      'вкусная компания садовая ул 212б меню',
      'вкусная компания самара советская армия меню',
    ],
    sections: [],
    schemaType: 'CollectionPage',
    claims: ['завтрак', 'горячее', 'пирожн', 'торт'],
    fallback: {
      title: `Меню и цены — ${BRAND.name}, Самара`,
      description:
        'Меню «Вкусной компании» в Самаре с ценами и весом: блюда кафе, ресторана и кондитерской по разделам. Заказ с доставкой или самовывозом на сайте.',
    },
    teaser: 'Все блюда по разделам с весом и ценами',
  },
  {
    key: 'sadovaya',
    path: '/sadovaya/',
    crumb: 'Садовая, 212Б',
    title: `Кафе-кондитерская на Садовой, 212Б — ${BRAND.name}`,
    h1: 'Кафе-кондитерская на Садовой, 212Б',
    description:
      'Кафе-кондитерская «Вкусная компания» на Садовой, 212Б в Самаре: завтраки с 8:00, супы и паста, витрина кондитерской. Меню, фото зала, часы работы и отзывы.',
    keywords: [
      'вкусная компания садовая ул 212б',
      'вкусная компания садовая ул 212б фото',
      'вкусная компания садовая ул 212б меню',
      'вкусная компания садовая ул 212б отзывы',
      'вкусная компания самара садовая',
      'кафе на садовой',
    ],
    sections: [],
    schemaType: 'WebPage',
    place: 'sadovaya',
    claims: ['супы и паста', 'витрина кондитерской'],
    fallback: {
      title: `Кафе-кондитерская на Садовой, 212Б — ${BRAND.name}`,
      description:
        'Кафе-кондитерская «Вкусная компания» на Садовой, 212Б в Самаре: часы работы, телефон, фото зала, меню с ценами, маршрут и отзывы гостей на Яндекс Картах.',
    },
    teaser: 'Кафе-кондитерская: часы, фото зала, маршрут и отзывы',
  },
  {
    key: 'sovetskoy-armii',
    path: '/sovetskoy-armii/',
    crumb: 'Советской Армии, 177',
    title: `Ресторан на Советской Армии, 177 — ${BRAND.name}`,
    h1: 'Ресторан на Советской Армии, 177',
    description:
      'Ресторан «Вкусная компания» на Советской Армии, 177 в Самаре: зал на 100 гостей, кухня до 22:30, завтраки весь день, банкеты. Меню, фото, отзывы и маршрут.',
    keywords: [
      'вкусная компания самара советская армия',
      'вкусная компания ул советской армии 177 отзывы',
      'вкусная компания ул советской армии 177 фото',
      'вкусная компания ул советской армии 177',
      'вкусная компания ул советской армии 177 меню',
      'кафе на советской армии в самаре',
      'ресторан на советской армии самара',
    ],
    sections: [],
    schemaType: 'WebPage',
    place: 'sovetskoy-armii',
    claims: ['зал на 100 гостей', 'кухня до 22:30', 'завтраки весь день', 'банкет'],
    fallback: {
      title: `Ресторан на Советской Армии, 177 — ${BRAND.name}`,
      description:
        'Ресторан «Вкусная компания» на Советской Армии, 177 в Самаре: часы работы, телефон, фото залов, меню с ценами, банкеты, маршрут и отзывы на Яндекс Картах.',
    },
    teaser: 'Ресторан: залы, часы, банкеты, маршрут и отзывы',
  },
];

export const landingOf = (key: ShopKey) => SHOP_LANDINGS.find((page) => page.key === key)!;

// ── facts / факты ────────────────────────────────────────────────────────────

const NBSP = /[\u00a0\u202f]/g;
const norm = (text: string) => text.replace(NBSP, ' ').replace(/\s+/g, ' ').toLowerCase();

/**
 * Everything the content says, as one lower-case line: the texts of the home
 * page and the directions, the venues with their hours, the cakes and every
 * dish with its weight and price. A promise of a page is true when it is
 * found here.
 * Всё, что говорит контент, одной строкой в нижнем регистре: тексты главной и
 * направлений, точки с часами, торты и каждое блюдо с весом и ценой. Обещание
 * страницы правдиво, когда оно здесь находится.
 */
export const factCorpus = (content: Content) => {
  const { home, directions, places, cakes, catalog } = content;
  const parts: (string | undefined)[] = [
    home.hero_text,
    home.seo_description,
    home.about_text,
    home.cakes_title,
    home.cakes_text,
    ...directions.flatMap((direction) => [direction.title, direction.text]),
    ...places.flatMap((place) => [
      place.name,
      place.kind,
      place.phone,
      ...hoursRows(place.schedule).map((row) => `${row.days} ${row.hours}`),
      ...place.schedule.flatMap((hours) => hours.map(shortTime)),
    ]),
    ...cakes.flatMap((cake) => [cake.title, cake.note]),
    ...catalog.categories.flatMap((category) => [
      category.title,
      category.description,
      ...category.products.flatMap((product) => [
        product.title,
        product.description,
        product.weight,
        rub(product.price),
        ...product.variants.flatMap((variant) => [variant.name, rub(variant.price)]),
      ]),
    ]),
  ];
  return norm(parts.filter(Boolean).join(' | '));
};

// a number with the word that makes it a promise: «48 часов», «3 500 ₽», «8:00», «100 гостей»
// число со словом, которое делает его обещанием: «48 часов», «3 500 ₽», «8:00», «100 гостей»
const NUMBER =
  /\d{1,3}(?:[ \u00a0]\d{3})+(?:\s?₽)?|\d+(?::\d{2})|\d+(?:,\d+)?(?:\s?(?:₽|кг|г(?!\p{L})|час(?:ов|а)?|дн(?:ей|я)|день|гост(?:ей|я|ь)))?/giu;

/** Числа текста, которых нет в контенте. */
export const unconfirmedNumbers = (text: string, corpus: string) =>
  [...new Set((norm(text).match(NUMBER) ?? []).map((claim) => claim.trim()))].filter((claim) => !corpus.includes(claim));

/**
 * The title, H1 and description a page prints: the registry's when every
 * number and every claimed word is in the content, otherwise the fallback.
 * `missing` lists what was not found — the page logs it.
 * Title, H1 и description, которые печатает страница: из реестра, если каждое
 * число и каждое обещанное слово есть в контенте, иначе запасные. `missing` —
 * что не нашлось; страница пишет это в журнал.
 */
export const seoOf = (page: ShopLanding, content: Content) => {
  const corpus = factCorpus(content);
  const missing = [
    ...unconfirmedNumbers(`${page.title} ${page.h1} ${page.description}`, corpus),
    ...page.claims.filter((claim) => !corpus.includes(norm(claim))),
  ];
  return missing.length
    ? { title: page.fallback.title, h1: page.h1, description: page.fallback.description, missing }
    : { title: page.title, h1: page.h1, description: page.description, missing };
};

// ── sections / разделы ───────────────────────────────────────────────────────

/** Разделы каталога, на которые опираются страницы: slug, а если админка его сменила, — название. */
export const SECTION = {
  festive: { slug: 'prazdnichnye-torty', title: 'Праздничные торты' },
  ready: { slug: 'torty-v-nalichii', title: 'Торты в наличии' },
  pastry: { slug: 'pirojnye', title: 'Пирожные' },
  sweets: { slug: 'konfety', title: 'Конфеты' },
  sets: { slug: 'nabory-pirojnyh-i-konfet', title: 'Наборы пирожных и конфет' },
  breakfasts: { slug: 'zavtraki', title: 'Завтраки' },
} as const;

export const sectionOf = (content: Content, ref: { slug: string; title: string }): CatalogCategory | undefined =>
  content.catalog.categories.find((category) => category.slug === ref.slug) ??
  content.catalog.categories.find((category) => norm(category.title) === norm(ref.title));

const minPrice = (products: Product[]) => Math.min(...products.map((product) => product.price));
const maxPrice = (products: Product[]) =>
  Math.max(...products.map((product) => Math.max(product.price, ...product.variants.map((variant) => variant.price))));

const KIDS = /детск/iu;
const MOUSSE = /мусс/iu;
const WEDDING = /свадеб/iu;

/** Полка страницы: раздел каталога целиком или его часть под своим заголовком. */
export type Shelf = {
  id: string;
  title: string;
  lead?: string;
  products: Product[];
  /** раздел каталога, куда ведёт «Все в каталоге» */
  section: CatalogCategory;
};

/** «1 кг» → 1; «1,5 кг» → 1.5; «800 г» → 0.8 */
const kilos = (text: string | undefined) => {
  const match = /(\d+(?:,\d+)?)\s*(кг|г)(?!\p{L})/iu.exec((text ?? '').replace(NBSP, ' '));
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  return match[2].toLowerCase() === 'кг' ? value : value / 1000;
};
const kiloText = (value: number) => `${String(value).replace('.', ',')}\u00a0кг`;

/** Срок торта на заказ в часах: чаще всего встречающийся в описаниях раздела, иначе из текста главной. */
export const leadHours = (content: Content) => {
  const festive = sectionOf(content, SECTION.festive);
  const counts = new Map<number, number>();
  for (const text of [...(festive?.products.map((product) => product.description) ?? []), content.home.cakes_text]) {
    const match = /(\d+)\s*час/iu.exec(text ?? '');
    if (match) counts.set(Number(match[1]), (counts.get(Number(match[1])) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** «48 часов» → «двое суток»; срок не кратный суткам остаётся в часах */
const ahead = (hours: number) =>
  hours % 24 === 0 && hours <= 72 ? ({ 24: 'сутки', 48: 'двое суток', 72: 'трое суток' } as Record<number, string>)[hours] : hoursPhrase(hours);

const hoursPhrase = (hours: number) => `${hours}\u00a0${plural(hours, 'час', 'часа', 'часов')}`;

/** Предложение текста, в котором есть слово: «Цвет и надпись меняем под повод, остальное как на фото.» */
const sentenceWith = (text: string | undefined, word: RegExp) =>
  (text ?? '')
    .split(/(?<=[.!?])\s+/)
    .find((sentence) => word.test(sentence))
    ?.trim();

/** Свадебный торт из витрины тортов главной: «Свадебный, два яруса» · «от 4 кг · 5 дней». */
export const weddingCake = (content: Content) => content.cakes.find((cake) => WEDDING.test(cake.title));

/** Вес праздничных тортов: от самого лёгкого размера до самого тяжёлого. */
const weightRange = (products: Product[]) => {
  const weights = products
    .flatMap((product) => (product.variants.length ? product.variants.map((variant) => variant.name) : [product.weight]))
    .map(kilos)
    .filter((value): value is number => value !== null);
  return weights.length ? { min: Math.min(...weights), max: Math.max(...weights) } : null;
};

/**
 * The shelves of a page, in the order it shows them. A part that has no dishes
 * is left out; a page whose shelves are all empty is closed from search.
 * Полки страницы в порядке показа. Часть без блюд пропускается; страница, у
 * которой все полки пусты, закрывается от поиска.
 */
export const shelvesOf = (key: ShopKey, content: Content): Shelf[] => {
  const shelves: Shelf[] = [];
  const add = (shelf: Omit<Shelf, 'products'> & { products: Product[] }) => {
    if (shelf.products.length) shelves.push(shelf);
  };
  if (key === 'cakes') {
    const festive = sectionOf(content, SECTION.festive);
    const ready = sectionOf(content, SECTION.ready);
    if (festive) {
      const hours = leadHours(content);
      const range = weightRange(festive.products);
      const fillings = new Set(festive.products.flatMap((product) => product.fillings));
      const grown = festive.products.filter((product) => !KIDS.test(product.title));
      const kids = festive.products.filter((product) => KIDS.test(product.title));
      add({
        id: 'prazdnichnye',
        title: 'Праздничные торты',
        lead: [
          hours && `Каждый — за ${hoursPhrase(hours)}.`,
          range && range.max > range.min && `Вес от ${String(range.min).replace('.', ',')} до ${kiloText(range.max)}.`,
          fillings.size > 0 && 'Размер и начинку выбираете при заказе.',
        ]
          .filter(Boolean)
          .join(' '),
        products: grown,
        section: festive,
      });
      add({
        id: 'detskie',
        title: 'Детские торты',
        lead: `${kids.length}\u00a0${plural(kids.length, 'модель', 'модели', 'моделей')} от ${rub(minPrice(kids))}${
          hours ? `, тоже за ${hoursPhrase(hours)}` : ''
        }.`,
        products: kids,
        section: festive,
      });
    }
    if (ready)
      add({
        id: 'v-nalichii',
        title: 'Торты в наличии',
        lead: `Готовые торты без ожидания: ${ready.products.length}\u00a0${plural(
          ready.products.length,
          'торт',
          'торта',
          'тортов',
        )} от ${rub(minPrice(ready.products))} с доставкой или самовывозом.`,
        products: ready.products,
        section: ready,
      });
  }
  if (key === 'desserts') {
    const pastry = sectionOf(content, SECTION.pastry);
    const sweets = sectionOf(content, SECTION.sweets);
    const sets = sectionOf(content, SECTION.sets);
    if (pastry) {
      const mousse = pastry.products.filter((product) => MOUSSE.test(product.description ?? ''));
      const rest = pastry.products.filter((product) => !mousse.includes(product));
      add({
        id: 'korpusnye',
        title: 'Корпусные десерты',
        lead: `Порционные муссовые пирожные — ${mousse.length}\u00a0${plural(mousse.length, 'вкус', 'вкуса', 'вкусов')} от ${rub(
          minPrice(mousse),
        )}.`,
        products: mousse,
        section: pastry,
      });
      const kinds = [
        'Пирожные',
        rest.some((product) => /эклер/iu.test(product.title)) && 'эклеры',
        rest.some((product) => /макаронс/iu.test(product.title)) && 'макаронс',
      ].filter(Boolean) as string[];
      add({
        id: 'pirozhnye',
        title: kinds.length > 2 ? `${kinds.slice(0, -1).join(', ')} и ${kinds.at(-1)}` : kinds.join(' и '),
        lead: rest.length ? `${rest.length}\u00a0${plural(rest.length, 'позиция', 'позиции', 'позиций')} от ${rub(minPrice(rest))}.` : undefined,
        products: rest,
        section: pastry,
      });
    }
    if (sweets)
      add({
        id: 'konfety',
        title: sweets.products.some((product) => /трюфел/iu.test(product.title)) ? 'Трюфели и конфеты' : sweets.title,
        lead: `${sweets.products.length}\u00a0${plural(sweets.products.length, 'вкус', 'вкуса', 'вкусов')} от ${rub(
          minPrice(sweets.products),
        )}.`,
        products: sweets.products,
        section: sweets,
      });
    if (sets)
      add({
        id: 'nabory',
        title: sets.title,
        lead: `${sets.products.length}\u00a0${plural(sets.products.length, 'набор', 'набора', 'наборов')} от ${rub(minPrice(sets.products))}.`,
        products: sets.products,
        section: sets,
      });
  }
  if (key === 'breakfasts') {
    const breakfasts = sectionOf(content, SECTION.breakfasts);
    if (breakfasts)
      add({
        id: 'menu-zavtrakov',
        title: 'Меню завтраков',
        lead: `${breakfasts.products.length}\u00a0${plural(breakfasts.products.length, 'блюдо', 'блюда', 'блюд')} от ${rub(
          minPrice(breakfasts.products),
        )} до ${rub(maxPrice(breakfasts.products))}. Любое можно заказать с доставкой.`,
        products: breakfasts.products,
        section: breakfasts,
      });
  }
  return shelves;
};

/**
 * Three dishes for the print beside the H1: one from each group in turn (hits
 * first), or spread over a single group — so the print does not repeat the
 * first row of the shelf right under it.
 * Три блюда для оттиска рядом с H1: по одному из каждой группы по очереди
 * (сначала хиты) или вразброс по одной группе — чтобы оттиск не повторял
 * первый ряд полки прямо под ним.
 */
export const printsOf = (groups: Product[][], count = 3): Product[] => {
  const lists = groups
    .map((list) =>
      list
        .filter((product) => product.photo && !product.photo.placeholder)
        .sort((a, b) => Number(b.badges.includes('hit')) - Number(a.badges.includes('hit'))),
    )
    .filter((list) => list.length > 0);
  const out: Product[] = [];
  if (lists.length === 1) {
    const [list] = lists;
    for (let i = 0; i < count && i < list.length; i += 1) out.push(list[Math.floor((i * list.length) / count)]);
  } else
    for (let round = 0; out.length < count; round += 1) {
      const before = out.length;
      for (const list of lists) if (list[round] && out.length < count) out.push(list[round]);
      if (out.length === before) break;
    }
  return [...new Set(out)];
};

// ── venues / точки ───────────────────────────────────────────────────────────

const PLACE_MATCH: Record<PlaceKey, RegExp> = {
  sadovaya: /садов/iu,
  'sovetskoy-armii': /советской\s+армии/iu,
};

export const placeOf = (key: PlaceKey, content: Content): Place | undefined =>
  content.places.find((place) => PLACE_MATCH[key].test(`${place.street} ${place.name}`));

/** Страница точки (путь без `BASE`), если она есть: из строк «Где купить» ведёт на неё. */
export const placePath = (place: Place) =>
  (Object.keys(PLACE_MATCH) as PlaceKey[])
    .filter((key) => PLACE_MATCH[key].test(`${place.street} ${place.name}`))
    .map((key) => landingOf(key).path)[0];

/** Направление точки («Кафе на Садовой», «Ресторан на Советской Армии»): его текст — вводный текст страницы. */
export const directionOf = (place: Place, content: Content) =>
  content.directions.find(
    (direction) => direction.place?.id === place.id && (direction.key === 'cafe' || direction.key === 'restaurant'),
  );

/** Что точка говорит о завтраках: «Завтраки с восьми утра», «Завтраки весь день». */
export const breakfastNote = (place: Place, content: Content) => {
  const text = directionOf(place, content)?.text;
  const part = (text ?? '')
    .split(/[.;,]\s*/)
    .map((piece) => piece.trim())
    .find((piece) => /^завтрак/iu.test(piece));
  return part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : undefined;
};

/** Первое открытие по будням и по выходным: «пн–пт с 8:00, сб с 8:30, вс с 9:00» или «ежедневно с 9:00». */
export const opensText = (place: Place) => {
  const rows = hoursRows(place.schedule);
  return rows
    .map((row) => `${row.days.charAt(0).toLowerCase()}${row.days.slice(1)} с\u00a0${row.hours.split(/\s[—–]\s/)[0]}`)
    .join(', ');
};

/** Часы точки одной фразой: «пн–пт 8:00–21:00, сб 8:30–21:00, вс 9:00–21:00». */
export const hoursText = (place: Place) =>
  hoursRows(place.schedule)
    .map((row) => `${row.days.charAt(0).toLowerCase()}${row.days.slice(1)} ${row.hours.replace(/\s[—–]\s/, '–')}`)
    .join(', ');

/**
 * A venue after «на»: «Садовая, 212Б» → «Садовой, 212Б»; «Советской Армии, 177»
 * stays as it is (the street is in the genitive already).
 * Точка после «на»: «Садовая, 212Б» → «Садовой, 212Б»; «Советской Армии, 177»
 * остаётся как есть (улица уже в родительном).
 */
export const placeAt = (place: Pick<Place, 'name'>) => place.name.replace(/^(\p{L}+?)ая(?=[\s,])/u, '$1ой');

// ── lead / вводный текст ─────────────────────────────────────────────────────

const andList = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
const upperFirst = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/** «Садовой, 212Б и Советской Армии, 177» — после «на» */
const placesList = (content: Content) => andList(content.places.map(placeAt));

/** «в Telegram или Max» — только мессенджеры, которые правда открывают чат; пусто — ни одного. */
const chatsText = (content: Content) => {
  const labels = chatLinks(content.settings).map((link) => link.label);
  return labels.length ? `в ${labels.join(' или ')}` : '';
};

/**
 * The paragraph under the H1, from the content: counts, prices, hours and the
 * venues' own words. Nothing is typed in that the admin cannot change.
 * Абзац под H1 из контента: число блюд, цены, часы и слова самих точек. Ничего,
 * что нельзя поменять в админке, сюда не впечатано.
 */
export const introOf = (key: ShopKey, content: Content): string => {
  const sections = content.catalog.categories;
  if (key === 'cakes') {
    const festive = sectionOf(content, SECTION.festive);
    const ready = sectionOf(content, SECTION.ready);
    const hours = leadHours(content);
    const recolor = sentenceWith(content.home.cakes_text, /надпис/iu);
    return [
      festive &&
        `${festive.products.length}\u00a0${plural(festive.products.length, 'праздничный торт', 'праздничных торта', 'праздничных тортов')} на заказ от ${rub(
          minPrice(festive.products),
        )}${hours ? `, каждый готовим за ${hoursPhrase(hours)}` : ''}.`,
      recolor,
      ready &&
        `Нужен сегодня — ${ready.products.length}\u00a0${plural(ready.products.length, 'торт', 'торта', 'тортов')} в наличии от ${rub(
          minPrice(ready.products),
        )}.`,
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (key === 'desserts') {
    const shelves = shelvesOf('desserts', content);
    const products = shelves.flatMap((shelf) => shelf.products);
    const own = (content.directions.find((d) => d.key === 'confectionery')?.text ?? '')
      .split(/[,.;]\s*/)
      .find((clause) => /цех/iu.test(clause));
    const has = (pattern: RegExp) => products.some((product) => pattern.test(product.title));
    const kinds = [
      shelves.some((shelf) => shelf.id === 'korpusnye') && 'муссовые пирожные',
      has(/эклер/iu) && 'эклеры',
      has(/макаронс/iu) && 'макаронс',
      has(/трюфел/iu) && 'трюфели',
      shelves.some((shelf) => shelf.id === 'nabory') && 'наборы',
    ].filter(Boolean) as string[];
    return [
      products.length &&
        `${products.length}\u00a0${plural(products.length, 'позиция', 'позиции', 'позиций')} от ${rub(minPrice(products))}${
          kinds.length ? `: ${andList(kinds)}` : ''
        }.`,
      own && sentence(upperFirst(own.trim())),
      'Купить можно на витринах кондитерской в обеих точках или с доставкой по Самаре.',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (key === 'breakfasts') {
    const breakfasts = sectionOf(content, SECTION.breakfasts);
    // the first run of days only: «пн–пт с 8:00», «ежедневно с 9:00»; the rest is in «Где позавтракать»
    // только первая группа дней: «пн–пт с 8:00», «ежедневно с 9:00»; остальное — в «Где позавтракать»
    const venues = content.places.map((place) => {
      const note = breakfastNote(place, content);
      return `на ${placeAt(place)} (${opensText(place).split(', ')[0]}${note && /весь день/iu.test(note) ? ', завтраки весь день' : ''})`;
    });
    const dishes = ['сырники', 'драники', 'блины', 'каша', 'омлет', 'бриошь'].filter((word) =>
      breakfasts?.products.some((product) => new RegExp(word.slice(0, -1), 'iu').test(product.title)),
    );
    return [
      `Завтракать можно ${andList(venues)}.`,
      breakfasts &&
        `В меню ${breakfasts.products.length}\u00a0${plural(breakfasts.products.length, 'завтрак', 'завтрака', 'завтраков')}${
          dishes.length ? ` — ${andList(dishes)}` : ''
        }, любой можно заказать с доставкой.`,
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (key === 'menu') {
    const count = content.catalog.count;
    return `${count}\u00a0${plural(count, 'блюдо', 'блюда', 'блюд')} в\u00a0${sections.length}\u00a0${plural(
      sections.length,
      'разделе',
      'разделах',
      'разделах',
    )} — от завтраков до праздничных тортов, с весом и ценами. Всё можно заказать с доставкой по Самаре или забрать самовывозом на ${placesList(
      content,
    )}.`;
  }
  const place = placeOf(key, content);
  return (place && directionOf(place, content)?.text) ?? '';
};

// ── how to order a cake / как заказать торт ─────────────────────────────────

/**
 * The steps of ordering a cake, each from the catalog: how many models, the
 * weights and fillings, the lead time, delivery or pickup. A step whose fact
 * is missing is dropped.
 * Шаги заказа торта, каждый — из каталога: сколько моделей, вес и начинки,
 * срок, доставка или самовывоз. Шаг без своего факта выпадает.
 */
export const cakeSteps = (content: Content) => {
  const festive = sectionOf(content, SECTION.festive);
  if (!festive) return [];
  const hours = leadHours(content);
  const range = weightRange(festive.products);
  const fillings = new Set(festive.products.flatMap((product) => product.fillings));
  const recolor = sentenceWith(content.home.cakes_text, /надпис/iu);
  return [
    {
      title: 'Модель',
      text: `${festive.products.length}\u00a0${plural(festive.products.length, 'торт', 'торта', 'тортов')} с фото и ценой в каталоге.${recolor ? ` ${recolor}` : ''}`,
    },
    (range || fillings.size > 0) && {
      title: 'Размер и начинка',
      text: [
        range && range.max > range.min && `Вес от ${String(range.min).replace('.', ',')} до ${kiloText(range.max)}`,
        fillings.size > 0 && `${fillings.size}\u00a0${plural(fillings.size, 'начинка', 'начинки', 'начинок')}, у каждой модели свой набор`,
      ]
        .filter(Boolean)
        .join(', ')
        .concat('. Цена — за выбранный размер.'),
    },
    hours !== null && {
      title: `За ${hoursPhrase(hours)}`,
      text: `Оформите заказ в каталоге хотя бы за ${ahead(hours)} до праздника.`,
    },
    {
      title: 'Доставка или самовывоз',
      text: `Курьером по Самаре или самовывоз на ${placesList(content)}.`,
    },
  ].filter((step): step is { title: string; text: string } => Boolean(step));
};

// ── questions / вопросы ──────────────────────────────────────────────────────

/** `a` — простой текст: он же идёт в `FAQPage`. `link` — куда дальше со страницы. */
export type ShopFaq = { id: string; q: string; a: string; link?: { href: string; label: string } };

/**
 * The questions of a page, each answered from the content. A question whose
 * fact is missing is left out, never answered with a guess. Links are paths
 * without `BASE`: the page prefixes them.
 * Вопросы страницы, каждый с ответом из контента. Вопрос без своего факта
 * пропускается, а не получает догадку. Ссылки — пути без `BASE`: страница
 * добавляет префикс сама.
 */
export const faqOf = (key: ShopKey, content: Content): ShopFaq[] => {
  const items: (ShopFaq | false | undefined | null | '')[] = [];
  const { settings, places } = content;
  const pickup = `самовывозом на ${placesList(content)}`;
  if (key === 'cakes') {
    const festive = sectionOf(content, SECTION.festive);
    const ready = sectionOf(content, SECTION.ready);
    const hours = leadHours(content);
    const wedding = weddingCake(content);
    const weddingDays = /(\d+)\s*(дн\p{L}*)/iu.exec(wedding?.note ?? '');
    const weddingWeight = /от\s+\d+(?:,\d+)?\s*кг/iu.exec(wedding?.note ?? '');
    const kids = festive?.products.filter((product) => KIDS.test(product.title)) ?? [];
    const fillings = [...new Set(festive?.products.flatMap((product) => product.fillings) ?? [])];
    const recolor = sentenceWith(content.home.cakes_text, /надпис/iu);
    items.push(
      hours !== null && {
        id: 'srok',
        q: 'За сколько заказывать торт?',
        a: `Праздничный торт готовим за ${hoursPhrase(hours)} — оформите заказ хотя бы за ${ahead(hours)} до праздника.${
          wedding && weddingDays
            ? ` Свадебный торт («${wedding.title}») готовим за ${weddingDays[1]}\u00a0${weddingDays[2]}${weddingWeight ? `, вес — ${weddingWeight[0]}` : ''}.`
            : ''
        }`,
      },
      festive && {
        id: 'cena',
        q: 'Сколько стоит торт на заказ?',
        a: `Праздничные торты — от ${rub(minPrice(festive.products))}, цена зависит от модели и веса: в каталоге у каждой модели указаны размеры и цена каждого.${
          ready ? ` Готовые торты в наличии — от ${rub(minPrice(ready.products))}.` : ''
        }`,
        link: { href: `/catalog/#${festive.slug}`, label: 'Праздничные торты в каталоге' },
      },
      fillings.length > 0 && {
        id: 'nachinki',
        q: 'Какие есть начинки?',
        a: `${fillings.length}\u00a0${plural(fillings.length, 'начинка', 'начинки', 'начинок')}: ${andList(fillings)}. У каждой модели свой набор — его видно при заказе в каталоге.`,
      },
      recolor && { id: 'nadpis', q: 'Можно поменять цвет и надпись?', a: recolor },
      kids.length > 0 && {
        id: 'detskie',
        q: 'Делаете детские торты?',
        a: `Да: ${andList(kids.map((product) => product.title.replace(/^(?:детский\s+)?торт\s+(?:детский\s+)?/iu, '')))} — от ${rub(minPrice(kids))}.`,
      },
      ready && {
        id: 'v-nalichii',
        q: 'Можно купить торт сегодня?',
        a: `Да, в разделе «${ready.title}» ${ready.products.length}\u00a0${plural(ready.products.length, 'торт', 'торта', 'тортов')} от ${rub(
          minPrice(ready.products),
        )}. Их можно заказать с доставкой по Самаре или забрать ${pickup}.`,
        link: { href: `/catalog/#${ready.slug}`, label: 'Торты в наличии' },
      },
    );
  }
  if (key === 'desserts') {
    const shelves = shelvesOf('desserts', content);
    const mousse = shelves.find((shelf) => shelf.id === 'korpusnye');
    const all = shelves.flatMap((shelf) => shelf.products);
    const box = all.find((product) => /набор/iu.test(product.description ?? '') && /макаронс/iu.test(product.title));
    const boxSentence = sentenceWith(box?.description, /набор/iu);
    const special = all.filter((product) => /без\s+глютена|безглютен|без\s+сахара/iu.test(`${product.title} ${product.description ?? ''}`));
    items.push(
      mousse && {
        id: 'korpusnye',
        q: 'Какие корпусные десерты у вас есть?',
        a: `Порционные муссовые пирожные: ${andList(mousse.products.map((product) => product.title.replace(/^пирожное\s+/iu, '')))}. Цена от ${rub(
          minPrice(mousse.products),
        )}.`,
      },
      {
        id: 'gde-kupit',
        q: 'Где купить десерты в Самаре?',
        a: `На витрине кондитерской на ${placesList(content)} — что есть сегодня, подскажут по телефону ${settings.phone}. Или закажите на сайте с доставкой по Самаре либо ${pickup}.`,
        link: { href: '/catalog/', label: 'Каталог доставки' },
      },
      boxSentence && { id: 'makarons', q: 'Можно собрать набор макаронс?', a: sentence(boxSentence) },
      special.length > 0 && {
        id: 'bez-glyutena',
        q: 'Есть десерты без глютена или без сахара?',
        a: `Да: ${andList(
          special.map((product) => {
            const what = /без\s+сахара/iu.test(`${product.title} ${product.description}`) ? 'без сахара' : 'без глютена';
            return product.title.toLowerCase().includes(what) ? product.title : `${product.title} — ${what}`;
          }),
        )}.`,
      },
      all.length > 0 && {
        id: 'ceny',
        q: 'Сколько стоят пирожные?',
        a: `${shelves
          .map((shelf) => `${shelf.title} — от ${rub(minPrice(shelf.products))}`)
          .join('; ')}.`,
      },
    );
  }
  if (key === 'breakfasts') {
    const breakfasts = sectionOf(content, SECTION.breakfasts);
    const allDay = places.filter((place) => /весь день/iu.test(breakfastNote(place, content) ?? ''));
    items.push(
      places.length > 0 && {
        id: 'rano',
        q: 'Где позавтракать рано утром?',
        a: `${places.map((place) => `На ${placeAt(place)} — ${opensText(place)}`).join('. ')}.`,
      },
      allDay.length > 0 && {
        id: 'ves-den',
        q: 'До скольки подают завтраки?',
        a: `${allDay.map((place) => `На ${placeAt(place)} завтраки весь день, до закрытия: ${hoursText(place)}`).join('. ')}.`,
      },
      breakfasts && {
        id: 'chto',
        q: 'Что есть на завтрак?',
        a: `${upperFirst(breakfasts.products.slice(0, 6).map((product) => lowerFirst(product.title)).join(', '))}${
          breakfasts.products.length > 6 ? ` и ещё ${breakfasts.products.length - 6}` : ''
        } — всего ${breakfasts.products.length}, от ${rub(minPrice(breakfasts.products))} до ${rub(maxPrice(breakfasts.products))}.`,
      },
      breakfasts && {
        id: 'dostavka',
        q: 'Можно заказать завтрак с доставкой?',
        a: `Да, все завтраки есть в каталоге: доставка по Самаре или ${pickup}.`,
        link: { href: `/catalog/#${breakfasts.slug}`, label: 'Завтраки в каталоге' },
      },
      {
        id: 'bron',
        q: 'Как забронировать стол на завтрак?',
        a: `Позвоните: ${places.map((place) => `${place.name} — ${place.phone}`).join(', ')}${chatsText(content) ? `, или напишите ${chatsText(content)}` : ''}.`,
      },
    );
  }
  if (key === 'menu') {
    items.push(
      {
        id: 'ceny',
        q: 'Где посмотреть меню с ценами?',
        a: `На этой странице: ${content.catalog.count}\u00a0${plural(content.catalog.count, 'блюдо', 'блюда', 'блюд')} по разделам — ${andList(
          content.catalog.categories.map((category) => category.title.toLowerCase()),
        )}. Цены и вес — как в каталоге доставки.`,
      },
      {
        id: 'dostavka',
        q: 'Можно заказать блюда из меню с доставкой?',
        a: `Да, каждое блюдо есть в каталоге: доставка по Самаре или ${pickup}.`,
        link: { href: '/catalog/', label: 'Каталог доставки' },
      },
      {
        id: 'gde',
        q: 'Где находятся кафе и ресторан?',
        a: `${places.map((place) => `${place.kind} — ${place.name}: ${hoursText(place)}, телефон ${place.phone}`).join('. ')}.`,
      },
    );
  }
  if (key === 'sadovaya' || key === 'sovetskoy-armii') {
    const place = placeOf(key, content);
    if (place) {
      const direction = directionOf(place, content);
      const breakfast = breakfastNote(place, content);
      const hall = /зал на\s+(\d+)\s+гост\p{L}*/iu.exec(direction?.text ?? '');
      const banquets = content.directions.find((d) => d.key === 'banquets');
      items.push(
        {
          id: 'chasy',
          q: `Какие часы работы на ${placeAt(place)}?`,
          a: `${hoursText(place).replace(/^./, (c) => c.toUpperCase())}. Телефон ${place.phone}.`,
        },
        breakfast && {
          id: 'zavtraki',
          q: 'Во сколько завтраки?',
          a: `${breakfast}. Открываемся: ${opensText(place)}.`,
          link: { href: '/breakfasts/', label: 'Меню завтраков' },
        },
        hall && {
          id: 'zal',
          q: 'Сколько гостей вмещает зал?',
          a: `${hall[0].replace(/^./, (c) => c.toUpperCase())}.${banquets ? ` ${banquets.text}` : ''}`,
          link: { href: '/catering/', label: 'Банкеты и кейтеринг' },
        },
        {
          id: 'bron',
          q: 'Как забронировать стол?',
          a: `Позвоните ${place.phone}${chatsText(content) ? ` или напишите ${chatsText(content)}` : ''}.`,
        },
        content.catalog.count > 0 && {
          id: 'dostavka',
          q: 'Можно заказать еду с собой или с доставкой?',
          a: `Да, через каталог на сайте: доставка по Самаре или самовывоз на ${placeAt(place)}.`,
          link: { href: '/catalog/', label: 'Каталог доставки' },
        },
      );
    }
  }
  return items.filter((item): item is ShopFaq => Boolean(item));
};

// ── links between the pages / перелинковка ───────────────────────────────────

export type ShopLink = { href: string; title: string; text: string };

const pageLink = (key: ShopKey): ShopLink => {
  const page = landingOf(key);
  return { href: page.path, title: page.crumb, text: page.teaser };
};

const CATALOG_LINK: ShopLink = { href: '/catalog/', title: 'Доставка', text: 'Весь каталог с корзиной: доставка и самовывоз' };
const CATERING_LINK: ShopLink = { href: '/catering/', title: 'Кейтеринг и банкеты', text: 'Банкеты в залах, фуршеты и кофе-брейки' };

/** Соседние страницы: торты ↔ десерты, точки ↔ меню, завтраки ↔ точки; каталог и кейтеринг — везде. */
export const relatedOf = (key: ShopKey): ShopLink[] => {
  const map: Record<ShopKey, ShopLink[]> = {
    cakes: [pageLink('desserts'), CATERING_LINK, pageLink('menu'), CATALOG_LINK],
    desserts: [pageLink('cakes'), pageLink('breakfasts'), pageLink('menu'), CATALOG_LINK],
    breakfasts: [pageLink('sadovaya'), pageLink('sovetskoy-armii'), pageLink('desserts'), CATALOG_LINK],
    menu: [pageLink('sadovaya'), pageLink('sovetskoy-armii'), pageLink('cakes'), CATERING_LINK],
    sadovaya: [pageLink('menu'), pageLink('breakfasts'), pageLink('cakes'), pageLink('desserts'), CATERING_LINK],
    'sovetskoy-armii': [pageLink('menu'), CATERING_LINK, pageLink('breakfasts'), pageLink('cakes')],
  };
  return map[key];
};

// ── search markup / разметка ─────────────────────────────────────────────────

/** Адрес блюда в каталоге: окно блюда открывается по `#p-<slug>` (как у карточки каталога). */
export const dishUrl = (catalogUrl: string, product: Product) => `${catalogUrl}#p-${product.slug}`;

const offerOf = (product: Product, url: string) => {
  const availability = `https://schema.org/${product.available ? 'InStock' : 'OutOfStock'}`;
  return product.variants.length > 1
    ? {
        '@type': 'AggregateOffer',
        priceCurrency: 'RUB',
        lowPrice: Math.min(...product.variants.map((v) => v.price)),
        highPrice: Math.max(...product.variants.map((v) => v.price)),
        offerCount: product.variants.length,
        availability,
        url,
      }
    : { '@type': 'Offer', priceCurrency: 'RUB', price: product.price, availability, url };
};

/**
 * `ItemList` of the page's dishes. A dish keeps the id it has in the catalog
 * (`/catalog/#p-<slug>`): the same thing under the same name on every page.
 * `images` — the card's own copy for each slug, made by the page.
 * `ItemList` блюд страницы. Блюдо сохраняет `@id` каталога
 * (`/catalog/#p-<slug>`): одна и та же вещь под одним именем на всех
 * страницах. `images` — копия карточки для каждого slug, её делает страница.
 */
export const itemListLd = (
  pageUrl: string,
  catalogUrl: string,
  name: string,
  shelves: Shelf[],
  images: Record<string, string | undefined> = {},
) => {
  const products = shelves.flatMap((shelf) => shelf.products.map((product) => ({ product, category: shelf.section.title })));
  return {
    '@type': 'ItemList',
    '@id': `${pageUrl}#list`,
    name,
    numberOfItems: products.length,
    itemListElement: products.map(({ product, category }, i) => {
      const url = dishUrl(catalogUrl, product);
      return {
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          '@id': url,
          name: product.title,
          sku: String(product.id),
          category,
          ...(product.description && { description: product.description }),
          ...(product.weight && { weight: product.weight }),
          ...(images[product.slug] && { image: images[product.slug] }),
          brand: { '@type': 'Brand', name: BRAND.name },
          offers: offerOf(product, url),
        },
      };
    }),
  };
};

/** `Menu` всего каталога: разделы — `MenuSection`, блюда — `MenuItem` с ценой. */
export const menuLd = (pageUrl: string, catalogUrl: string, content: Content) => ({
  '@type': 'Menu',
  '@id': `${pageUrl}#menu`,
  name: `Меню «${BRAND.name}»`,
  inLanguage: 'ru-RU',
  hasMenuSection: content.catalog.categories.map((category) => ({
    '@type': 'MenuSection',
    '@id': `${pageUrl}#${category.slug}`,
    name: category.title,
    hasMenuItem: category.products.map((product) => {
      const url = dishUrl(catalogUrl, product);
      return {
        '@type': 'MenuItem',
        name: product.title,
        url,
        ...(product.description && { description: product.description }),
        offers: offerOf(product, url),
      };
    }),
  })),
});

/** Узел `FAQPage`: ответы простым текстом, как на странице. */
export const faqLd = (pageUrl: string, items: ShopFaq[]) => ({
  '@type': 'FAQPage',
  '@id': `${pageUrl}#faq`,
  mainEntity: items.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
});

// ── for cards / для карточек ─────────────────────────────────────────────────

/**
 * For the page only: a range («пн–пт», «8:00–21:00») does not break at its
 * dash. A word joiner after the dash; the markup keeps the plain text.
 * Только для страницы: диапазон («пн–пт», «8:00–21:00») не рвётся на тире.
 * После тире — соединитель слов; разметка получает простой текст.
 */
export const keepRanges = (text: string) => text.replace(/(\S)–(?=\S)/g, '$1–\u2060');

/** Строка меню: вес или размеры и одна строка описания — не длиннее 90 знаков, по границе слова. */
export const menuLine = (product: Product) => {
  const text = (product.description ?? '').split(/(?<=[.!?])\s+/)[0]?.trim() ?? '';
  const short = text.length <= 90 ? text : `${text.slice(0, 88).replace(/[\s,;:—–-]+\S*$/u, '')}…`;
  return { size: sizeLabel(product), text: upperFirst(short.replace(/\.$/, '')), price: priceLabel(product) };
};
