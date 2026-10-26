/**
 * Schema.org of the site: one graph the layout prints on every page — the
 * company (`Organization`), the site (`WebSite`), the venues and the page
 * itself (`WebPage`) — and the builders the pages use to point at them. The
 * ids are fixed addresses, so the blocks of one page and the pages of the
 * site agree: `#org`, `#website`, `#place-N` under the origin, the page under
 * its canonical address, its crumbs under `<address>#breadcrumb`. A page that
 * adds markup of its own (the catalog, catering) must not reuse the canonical
 * address as an `@id`: that node is the layout's. Only what the admin and the
 * pages say goes in — no ratings from other platforms (Google forbids carrying
 * them over), no founding year, no empty values.
 * Разметка Schema.org сайта: один граф, который раскладка печатает на каждой
 * странице, — компания (`Organization`), сайт (`WebSite`), точки и сама
 * страница (`WebPage`), — и построители, которыми страницы на них ссылаются.
 * Идентификаторы — постоянные адреса, поэтому блоки одной страницы и страницы
 * сайта сходятся: `#org`, `#website`, `#place-N` от корня домена, страница —
 * по своему каноническому адресу, её крошки — `<адрес>#breadcrumb`. Страница
 * со своей разметкой (каталог, кейтеринг) не берёт канонический адрес в `@id`:
 * этот узел принадлежит раскладке. В разметку идёт только то, что говорят
 * админка и страницы: без оценок с чужих площадок (Google запрещает их
 * переносить), без «основано в …», без пустых значений.
 */
import type { Content, Menu, Place } from './content.ts';
import { BASE } from './base.ts';
import { chatLinks, isChatLink } from './contact-links.ts';
import {
  BRAND,
  TWOGIS_BRANCHES_URL,
  YANDEX_CHAIN_URL,
  schemaHours,
  schemaHoursSpec,
  yandexOrgUrl,
} from '../data/site.ts';

export const LANG = 'ru-RU';

// ── ids / идентификаторы ─────────────────────────────────────────────────────

/** Компания целиком: юрлицо, соцсети, карточки сети на картах. */
export const orgId = (origin: string) => `${origin}/#org`;
export const websiteId = (origin: string) => `${origin}/#website`;
/** Точка — номер как у метки на карте (`place.n`). */
export const placeId = (origin: string, n: string) => `${origin}/#place-${n}`;
export const breadcrumbId = (url: string) => `${url}#breadcrumb`;

/** Главная сайта: на превью сайт лежит в подкаталоге, поэтому через `BASE`. */
export const homeUrl = (site: URL) => new URL(BASE, site).href;

// ── values / значения ────────────────────────────────────────────────────────

/**
 * Drops what says nothing: `undefined`, `null`, a blank string, an empty list
 * or object — at any depth. A field the admin left empty leaves no `"email":
 * null` and no `"undefined"` in the markup.
 * Убирает то, что ничего не говорит: `undefined`, `null`, пустую строку,
 * пустой список или объект — на любой глубине. Поле, пустое в админке, не
 * оставляет в разметке ни `"email": null`, ни `"undefined"`.
 */
export const compact = <T>(value: T): T => {
  const empty = (item: unknown) =>
    item === undefined ||
    item === null ||
    (typeof item === 'number' && !Number.isFinite(item)) ||
    (typeof item === 'string' && item.trim() === '') ||
    (Array.isArray(item) && item.length === 0) ||
    (typeof item === 'object' && !Array.isArray(item) && Object.keys(item as object).length === 0);
  if (Array.isArray(value)) return value.map((item) => compact(item)).filter((item) => !empty(item)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const clean = compact(item);
      if (!empty(clean)) out[key] = clean;
    }
    return out as T;
  }
  return value;
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  shy: '',
};

/**
 * Plain text out of an editor's rich text: an answer in `FAQPage` carries the
 * words, not the tags. A paragraph or a line break becomes a new line, an
 * entity becomes its character, runs of spaces collapse.
 * Простой текст из текста редактора: ответ в `FAQPage` несёт слова, а не
 * теги. Абзац и перенос строки становятся новой строкой, сущность — своим
 * знаком, подряд идущие пробелы схлопываются.
 */
export const stripHtml = (html: string) =>
  html
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? all;
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();

/** Абсолютный адрес из ссылки сайта (`/docs/offer/`, `/media/…pdf`). */
const absolute = (href: string, site: URL) => new URL(href, site).href;

export type Image = { url: string; width?: number; height?: number };
const imageObject = (image: Image | undefined) =>
  image && { '@type': 'ImageObject', url: image.url, contentUrl: image.url, width: image.width, height: image.height };

const city = () => ({ '@type': 'City', name: BRAND.city });

// ── the company / компания ───────────────────────────────────────────────────

/**
 * Where else the company is itself: VK, the messengers that really open a chat
 * (the `https://max.ru/` placeholder of the admin does not), the chain on
 * Yandex Maps and on 2GIS.
 * Где ещё компания — это она сама: VK, мессенджеры, которые правда открывают
 * чат (заглушка `https://max.ru/` из админки — нет), сеть на Яндекс Картах и в
 * 2ГИС.
 */
export const orgSameAs = (settings: Content['settings']) => [
  // a profile is a path after the domain, the same rule as a chat link
  // профиль — путь после домена, то же правило, что у ссылки на чат
  ...(isChatLink(settings.vk) ? [String(settings.vk).trim()] : []),
  ...chatLinks(settings).map((link) => link.href),
  YANDEX_CHAIN_URL,
  TWOGIS_BRANCHES_URL,
];

/** ИНН — 10 или 12 цифр, ОГРН — 13, ОГРНИП — 15: подпись по длине номера. */
const ogrnLabel = (ogrn: string) => (ogrn.length === 15 ? 'ОГРНИП' : 'ОГРН');

export const orgNode = (content: Content, site: URL, logo?: Image) => {
  const { settings } = content;
  const inn = settings.inn?.trim();
  const ogrn = settings.ogrn?.trim();
  return compact({
    '@type': 'Organization',
    '@id': orgId(site.origin),
    name: BRAND.name,
    legalName: settings.legal_name,
    url: homeUrl(site),
    logo: imageObject(logo),
    telephone: settings.phone,
    email: settings.email,
    areaServed: city(),
    sameAs: orgSameAs(settings),
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: settings.phone,
      email: settings.email,
      contactType: 'customer service',
      availableLanguage: 'ru',
      areaServed: city(),
    },
    taxID: inn,
    identifier: [
      inn && { '@type': 'PropertyValue', propertyID: 'ИНН', value: inn },
      ogrn && { '@type': 'PropertyValue', propertyID: ogrnLabel(ogrn), value: ogrn },
    ],
  });
};

export const websiteNode = (site: URL) => ({
  '@type': 'WebSite',
  '@id': websiteId(site.origin),
  url: homeUrl(site),
  name: BRAND.name,
  inLanguage: LANG,
  publisher: { '@id': orgId(site.origin) },
});

// ── the venues / точки ───────────────────────────────────────────────────────

const isRestaurant = (place: Place) => place.kind.toLowerCase().includes('ресторан');

/**
 * Menus of a venue: those of its directions (the cafe — Садовая, the
 * restaurant — Советской Армии), published, with a real file. A placeholder
 * opens a blank sheet, so the page does not link it and neither does the markup.
 * Меню точки — меню её направлений (кафе — Садовая, ресторан — Советской
 * Армии), опубликованные и с настоящим файлом. Заглушка открывает пустой лист:
 * страница на неё не ссылается, разметка тоже.
 */
export const menusOf = (content: Content, place: Place): Menu[] => {
  const directions = new Set(content.directions.filter((d) => d.place?.id === place.id).map((d) => d.id));
  return content.menus.filter(
    (menu) => menu.status === 'published' && directions.has(menu.direction) && !menu.file.placeholder,
  );
};

/**
 * The catalog opened on one venue: since 26.10.2026 each venue has its own menu
 * and `?place=<id>` picks it (a QR code on a table adds `&table=`). The page
 * is the same, its canonical address stays `/catalog/`.
 * Каталог, открытый на одной точке: с 26.10.2026 у каждой точки своё меню, и
 * `?place=<id>` выбирает её (QR-код на столе добавит `&table=`). Страница та
 * же, канонический адрес остаётся `/catalog/`.
 */
export const placeCatalogUrl = (site: URL, place: Pick<Place, 'id'>) => {
  const url = new URL(`${BASE}catalog/`, site);
  url.searchParams.set('place', String(place.id));
  return url.href;
};

/**
 * An order from the site at one venue: the catalog opened on its menu takes it
 * for delivery by courier, for pickup or at a table in its hall (the offer,
 * «Доставка и оплата»). Schema.org has no delivery method for the hall, so
 * only the courier and pickup are named. `DeliveryModeOwnFleet` in
 * GoodRelations covers couriers of the seller's own or hired.
 * Заказ с сайта на одной точке: каталог, открытый на её меню, принимает его на
 * доставку курьером, на самовывоз или к столику в её зале (оферта, «Доставка и
 * оплата»). Способа получения «в зале» в Schema.org нет, поэтому названы только
 * курьер и самовывоз. `DeliveryModeOwnFleet` в GoodRelations — курьеры
 * продавца, свои или нанятые.
 */
export const orderAction = (site: URL, place: Pick<Place, 'id'>) => ({
  '@type': 'OrderAction',
  target: {
    '@type': 'EntryPoint',
    urlTemplate: placeCatalogUrl(site, place),
    inLanguage: LANG,
    actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'],
  },
  deliveryMethod: ['http://purl.org/goodrelations/v1#DeliveryModeOwnFleet', 'https://schema.org/OnSitePickup'],
});

export type PlaceImages = { brand?: string; byPlace?: Record<string, string | undefined> };

export const placeNodes = (content: Content, site: URL, images: PlaceImages = {}) =>
  content.places.map((place) => {
    const direction = content.directions.find((item) => item.place?.id === place.id);
    const menus = menusOf(content, place);
    return compact({
      // the confectionery bakes, the restaurant feeds: the venues differ in kind
      // кондитерская печёт, ресторан кормит: рубрика у точек разная
      '@type': isRestaurant(place) ? 'Restaurant' : 'Bakery',
      '@id': placeId(site.origin, place.n),
      name: `${BRAND.name} — ${place.name}`,
      // the venue's own words from «Направления»; without them — the site's
      // свои слова точки из «Направлений»; без них — описание сайта
      description: direction?.text ?? content.home.seo_description,
      parentOrganization: { '@id': orgId(site.origin) },
      telephone: place.phone,
      url: homeUrl(site),
      sameAs: [yandexOrgUrl(place.yandex_org)],
      hasMap: yandexOrgUrl(place.yandex_org),
      priceRange: '₽₽',
      servesCuisine: isRestaurant(place) ? ['Европейская', 'Завтраки', 'Десерты'] : ['Кондитерская', 'Завтраки', 'Кофе'],
      address: {
        '@type': 'PostalAddress',
        streetAddress: place.name,
        addressLocality: BRAND.city,
        addressCountry: 'RU',
      },
      geo: { '@type': 'GeoCoordinates', latitude: place.lat, longitude: place.lng },
      image: images.byPlace?.[place.n] ?? images.brand,
      openingHours: schemaHours(place.schedule),
      openingHoursSpecification: schemaHoursSpec(place.schedule),
      hasMenu: [
        ...menus.map((menu) => ({
          '@type': 'Menu',
          name: menu.title,
          url: absolute(menu.file.href, site),
          dateModified: menu.updated,
        })),
        // the venue's own menu in the catalog, with prices and the order (26.10.2026)
        // своё меню точки в каталоге, с ценами и заказом (26.10.2026)
        ...(content.catalog.count > 0 ? [{ '@type': 'Menu', name: 'Меню для заказа на сайте', url: placeCatalogUrl(site, place) }] : []),
      ],
      // «Бронь стола» in the header and on the first screen: by phone or messenger
      // «Бронь стола» в шапке и на первом экране: по телефону или в мессенджере
      acceptsReservations: true,
      currenciesAccepted: 'RUB',
      areaServed: city(),
      ...(content.catalog.count > 0 && { potentialAction: orderAction(site, place) }),
      // без aggregateRating: Google запрещает переносить в разметку оценки
      // с чужих площадок, а собственных отзывов у сайта нет
    });
  });

// ── the page / страница ──────────────────────────────────────────────────────

export type Crumb = { name: string; url: string };

export const breadcrumbNode = (url: string, crumbs: Crumb[]) => ({
  '@type': 'BreadcrumbList',
  '@id': breadcrumbId(url),
  itemListElement: crumbs.map((crumb, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: crumb.name,
    item: crumb.url,
  })),
});

/**
 * What a page tells the layout about itself: the kind of its `WebPage` node,
 * its crumbs (the layout then prints them and links them), extra fields
 * (`about`, `hasPart`, `dateModified`). A page passing this prints no
 * `WebPage` of its own.
 * Что страница сообщает раскладке о себе: вид узла `WebPage`, крошки (тогда
 * раскладка их печатает и связывает со страницей), дополнительные поля
 * (`about`, `hasPart`, `dateModified`). Страница, которая это передаёт, своего
 * `WebPage` не печатает.
 */
export type PageSchema = {
  type?: 'WebPage' | 'CollectionPage' | 'ContactPage' | 'AboutPage' | 'FAQPage';
  crumbs?: Crumb[];
  fields?: Record<string, unknown>;
};

export const webPageNode = (
  site: URL,
  page: { url: string; name: string; description?: string; image?: Image; breadcrumb?: boolean } & PageSchema,
) =>
  compact({
    '@type': page.type ?? 'WebPage',
    '@id': page.url,
    url: page.url,
    name: page.name,
    description: page.description,
    inLanguage: LANG,
    isPartOf: { '@id': websiteId(site.origin) },
    primaryImageOfPage: imageObject(page.image),
    breadcrumb: page.breadcrumb ? { '@id': breadcrumbId(page.url) } : undefined,
    // the page's own fields come last but never replace its id, kind or address
    // свои поля страницы идут последними, но не подменяют её адрес, вид и `@id`
    ...Object.fromEntries(
      Object.entries(page.fields ?? {}).filter(([key]) => !['@type', '@id', 'url', 'isPartOf'].includes(key)),
    ),
  });

/**
 * The layout's graph: the company, the site, the venues and — on a real page,
 * not the 404 — the page with its crumbs. `page.url` is the canonical address.
 * Граф раскладки: компания, сайт, точки и — на настоящей странице, не на 404, —
 * сама страница с крошками. `page.url` — канонический адрес.
 */
export const layoutGraph = (
  content: Content,
  site: URL,
  options: {
    logo?: Image;
    images?: PlaceImages;
    page?: ({ url: string; name: string; description?: string; image?: Image } & PageSchema) | null;
  } = {},
) => {
  const { page } = options;
  const isHome = page?.url === homeUrl(site);
  const crumbs = page?.crumbs?.length ? [breadcrumbNode(page.url, page.crumbs)] : [];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      orgNode(content, site, options.logo),
      websiteNode(site),
      ...placeNodes(content, site, options.images),
      ...(page
        ? [
            webPageNode(site, {
              ...page,
              // the home page is the company's own: it is about the organization
              // главная — страница самой компании: она об организации
              fields: { ...(isHome && { about: { '@id': orgId(site.origin) } }), ...page.fields },
              breadcrumb: crumbs.length > 0,
            }),
            ...crumbs,
          ]
        : []),
    ],
  };
};
