/**
 * Structured data of the catering pages, one builder for all three so the ids
 * agree: the breadcrumbs, the business (`FoodEstablishment`, its halls are the
 * venues the layout already describes), the service the company provides with
 * its formats and «от» prices, and on the questions page — `FAQPage` with every
 * answer as plain text. Only what the page prints goes in; a format without a
 * price has no price here. The page node itself (`WebPage` at the canonical
 * address) is the layout's, so nothing here takes that `@id`.
 * Разметка страниц кейтеринга, один построитель на все три, чтобы
 * идентификаторы совпадали: хлебные крошки, заведение (`FoodEstablishment`,
 * его залы — точки, которые уже описывает раскладка), услуга компании с
 * форматами и ценами «от», а на странице вопросов — `FAQPage` со всеми
 * ответами простым текстом. Только то, что печатает страница: у формата без
 * цены цены нет и здесь. Узел самой страницы (`WebPage` по каноническому
 * адресу) принадлежит раскладке, поэтому здесь этот `@id` не занимается.
 */
import type { Content } from './content.ts';
import type { CateringFormat, CateringQuestion } from './catering.ts';
import { BRAND } from '../data/site.ts';
import { BASE } from './base.ts';
import { CATERING } from './nav.ts';
import { LANG, breadcrumbNode, compact, orgId, placeId, stripHtml, websiteId } from './seo.ts';

export type CateringKind = 'overview' | 'services' | 'faq';

/**
 * A landing page of the section (`src/data/landings-catering.ts`: corporate
 * parties, the banquet hall, the buffet, a birthday): the same builder gives
 * it the crumbs under «Кейтеринг и банкеты», the business, its own `Service`
 * with the formats it prints as offers («от» prices per guest as
 * `UnitPriceSpecification`) and `FAQPage` with the questions it prints.
 * Посадочная страница раздела (`src/data/landings-catering.ts`: корпоративы,
 * банкетный зал, фуршет, день рождения): тот же построитель даёт ей крошки
 * под «Кейтеринг и банкеты», заведение, свою `Service` с форматами страницы
 * как предложениями (цены «от» за гостя — `UnitPriceSpecification`) и
 * `FAQPage` с вопросами, которые она печатает.
 */
export type CateringLanding = {
  /** путь страницы с `BASE`: `/catering/corporate/` */
  path: string;
  crumb: string;
  service: { name: string; type: string };
  description: string;
  formats: CateringFormat[];
  questions: CateringQuestion[];
  /** заголовок блока вопросов на странице */
  faqName: string;
};

const CRUMB: Record<CateringKind, string> = {
  overview: 'Кейтеринг и банкеты',
  services: 'Форматы и цены',
  faq: 'Вопросы и ответы',
};

export const cateringJsonLd = (
  content: Content,
  site: URL,
  kind: CateringKind | 'landing',
  image?: string,
  landing?: CateringLanding,
) => {
  const { catering, settings, places } = content;
  if (kind === 'landing' && !landing) throw new Error('cateringJsonLd: для посадочной нужна её запись (landing)');
  const home = new URL(BASE, site).href;
  const overview = new URL(CATERING, site).href;
  const services = new URL(`${CATERING}services/`, site).href;
  const here =
    kind === 'landing'
      ? new URL(landing!.path, site).href
      : kind === 'overview'
        ? overview
        : kind === 'services'
          ? services
          : new URL(`${CATERING}faq/`, site).href;
  const businessId = `${overview}#business`;
  const serviceId = `${overview}#service`;
  const org = { '@id': orgId(site.origin) };
  const prices = catering.formats.flatMap((format) => (format.price ? [format.price.from] : []));

  const crumbs = breadcrumbNode(here, [
    { name: 'Главная', url: home },
    { name: CRUMB.overview, url: overview },
    ...(kind === 'overview' ? [] : [{ name: kind === 'landing' ? landing!.crumb : CRUMB[kind], url: here }]),
  ]);

  const business = {
    '@type': 'FoodEstablishment',
    '@id': businessId,
    name: `${BRAND.name} — кейтеринг и банкеты`,
    url: overview,
    telephone: settings.phone,
    ...(image && { image }),
    ...(prices.length && { priceRange: `от ${Math.min(...prices)} ₽` }),
    address: { '@type': 'PostalAddress', addressLocality: BRAND.city, addressCountry: 'RU' },
    parentOrganization: org,
    // the halls are the venues the layout marks up as `#place-N`
    // залы — это точки, которые раскладка размечает как `#place-N`
    department: places.map((place) => ({ '@id': placeId(site.origin, place.n) })),
  };

  const service = {
    '@type': 'Service',
    '@id': serviceId,
    name: 'Кейтеринг и банкеты',
    serviceType: ['Кейтеринг', 'Банкеты'],
    description: catering.page?.seo.description ?? catering.page?.heroText,
    url: overview,
    ...(image && { image }),
    provider: org,
    // the questions say so: every district of Samara, Tolyatti, Novokuybyshevsk
    // and any point of the region
    // так говорят вопросы: все районы Самары, Тольятти, Новокуйбышевск и любая
    // точка области
    areaServed: [
      { '@type': 'City', name: BRAND.city },
      { '@type': 'AdministrativeArea', name: 'Самарская область' },
    ],
    ...(catering.formats.length && {
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: 'Форматы банкетов и кейтеринга',
        itemListElement: catering.formats.map((format) => ({
          '@type': 'Offer',
          url: `${services}#${format.slug}`,
          itemOffered: {
            '@type': 'Service',
            name: format.title,
            ...(format.summary && { description: format.summary }),
          },
          // «от 3 500 ₽ за гостя»: the lower bound, and what it is counted per
          // — `unitText` belongs to `UnitPriceSpecification`, not its parent
          // «от 3 500 ₽ за гостя»: нижняя граница и за что она считается —
          // `unitText` есть у `UnitPriceSpecification`, а не у родителя
          ...(format.price && {
            priceSpecification: {
              '@type': format.price.unit ? 'UnitPriceSpecification' : 'PriceSpecification',
              minPrice: format.price.from,
              priceCurrency: 'RUB',
              ...(format.price.unit && { unitText: format.price.unit }),
              ...(format.price.note && { description: format.price.note }),
            },
          }),
        })),
      },
    }),
  };

  // the answer as it reads on the page, in words: no tags in `text`, the whole
  // question in `name`
  // ответ так, как он читается на странице, словами: в `text` без тегов, в
  // `name` — вопрос целиком
  const faq =
    kind === 'faq' && catering.questions.length
      ? [
          {
            '@type': 'FAQPage',
            '@id': `${here}#faq`,
            url: here,
            name: CRUMB.faq,
            inLanguage: LANG,
            isPartOf: { '@id': websiteId(site.origin) },
            ...(catering.page && { about: { '@id': serviceId } }),
            mainEntity: catering.questions.map((item) => ({
              '@type': 'Question',
              name: stripHtml(item.question),
              acceptedAnswer: { '@type': 'Answer', text: stripHtml(item.answer) },
            })),
          },
        ]
      : [];

  // a landing: its own service in place of the section's, the formats it
  // prints as offers, its questions; ids under the page's address
  // посадочная: своя услуга вместо услуги раздела, форматы страницы
  // предложениями, её вопросы; идентификаторы — от адреса страницы
  const landingNodes = kind === 'landing' && landing ? landingGraph(site, here, landing, image) : [];

  return compact({
    '@context': 'https://schema.org',
    '@graph': [
      crumbs,
      ...(catering.page ? (kind === 'landing' ? [business] : [business, service]) : []),
      ...faq,
      ...landingNodes,
    ],
  });
};

const landingGraph = (site: URL, here: string, landing: CateringLanding, image?: string) => {
  const serviceId = `${here}#service`;
  const service = {
    '@type': 'Service',
    '@id': serviceId,
    name: landing.service.name,
    serviceType: landing.service.type,
    description: landing.description,
    url: here,
    ...(image && { image }),
    provider: { '@id': orgId(site.origin) },
    areaServed: [
      { '@type': 'City', name: BRAND.city },
      { '@type': 'AdministrativeArea', name: 'Самарская область' },
    ],
    // only a format with a price is an offer: «по смете» has nothing to offer at
    // в предложения идёт только формат с ценой: у «по смете» нечего предложить
    offers: landing.formats.flatMap((format) =>
      format.price
        ? [
            {
              '@type': 'Offer',
              '@id': `${here}#offer-${format.slug}`,
              name: format.title,
              url: `${here}#format-${format.slug}`,
              ...(format.summary && { description: format.summary }),
              priceCurrency: 'RUB',
              itemOffered: { '@type': 'Service', name: format.title },
              priceSpecification: {
                '@type': format.price.unit ? 'UnitPriceSpecification' : 'PriceSpecification',
                minPrice: format.price.from,
                priceCurrency: 'RUB',
                ...(format.price.unit && { unitText: format.price.unit }),
                ...(format.price.note && { description: format.price.note }),
              },
            },
          ]
        : [],
    ),
  };
  const faq = landing.questions.length
    ? [
        {
          '@type': 'FAQPage',
          '@id': `${here}#faq`,
          url: here,
          name: landing.faqName,
          inLanguage: LANG,
          isPartOf: { '@id': websiteId(site.origin) },
          about: { '@id': serviceId },
          mainEntity: landing.questions.map((item) => ({
            '@type': 'Question',
            name: stripHtml(item.question),
            acceptedAnswer: { '@type': 'Answer', text: stripHtml(item.answer) },
          })),
        },
      ]
    : [];
  return [service, ...faq];
};
