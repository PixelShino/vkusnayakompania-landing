/**
 * Structured data of the catering pages, one builder for all three so the ids
 * agree: the breadcrumbs, the business (`FoodEstablishment`, its halls are the
 * venues the layout already describes), the service with its formats and
 * «от» prices, and on the questions page — `FAQPage` with every answer. Only
 * what the page prints goes in; a format without a price has no price here.
 * Разметка страниц кейтеринга, один построитель на все три, чтобы
 * идентификаторы совпадали: хлебные крошки, заведение (`FoodEstablishment`,
 * его залы — точки, которые уже описывает раскладка), услуга с форматами и
 * ценами «от», а на странице вопросов — `FAQPage` со всеми ответами. Только то,
 * что печатает страница: у формата без цены цены нет и здесь.
 */
import type { Content } from './content.ts';
import { BRAND } from '../data/site.ts';
import { BASE } from './base.ts';
import { CATERING } from './nav.ts';

export type CateringKind = 'overview' | 'services' | 'faq';

const CRUMB: Record<CateringKind, string> = {
  overview: 'Кейтеринг и банкеты',
  services: 'Форматы и цены',
  faq: 'Вопросы и ответы',
};

export const cateringJsonLd = (content: Content, site: URL, kind: CateringKind, image?: string) => {
  const { catering, settings, places } = content;
  const home = new URL(BASE, site).href;
  const overview = new URL(CATERING, site).href;
  const services = new URL(`${CATERING}services/`, site).href;
  const here = kind === 'overview' ? overview : kind === 'services' ? services : new URL(`${CATERING}faq/`, site).href;
  const businessId = `${overview}#business`;
  const prices = catering.formats.flatMap((format) => (format.price ? [format.price.from] : []));

  const crumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: home },
      { '@type': 'ListItem', position: 2, name: CRUMB.overview, item: overview },
      ...(kind === 'overview' ? [] : [{ '@type': 'ListItem', position: 3, name: CRUMB[kind], item: here }]),
    ],
  };

  const business = {
    '@type': 'FoodEstablishment',
    '@id': businessId,
    name: `${BRAND.name} — кейтеринг и банкеты`,
    url: overview,
    telephone: settings.phone,
    ...(image && { image }),
    ...(prices.length && { priceRange: `от ${Math.min(...prices)} ₽` }),
    address: { '@type': 'PostalAddress', addressLocality: BRAND.city, addressCountry: 'RU' },
    // the halls are the venues the layout marks up as `#place-N`
    // залы — это точки, которые раскладка размечает как `#place-N`
    department: places.map((place) => ({ '@id': `${site.origin}/#place-${place.n}` })),
  };

  const service = {
    '@type': 'Service',
    '@id': `${overview}#service`,
    name: 'Кейтеринг и банкеты',
    serviceType: 'Кейтеринг',
    provider: { '@id': businessId },
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
          ...(format.price && {
            priceSpecification: {
              '@type': 'PriceSpecification',
              minPrice: format.price.from,
              priceCurrency: 'RUB',
              ...(format.price.unit && { unitText: format.price.unit }),
            },
          }),
        })),
      },
    }),
  };

  const faq =
    kind === 'faq' && catering.questions.length
      ? [
          {
            '@type': 'FAQPage',
            '@id': `${here}#faq`,
            mainEntity: catering.questions.map((item) => ({
              '@type': 'Question',
              name: item.question,
              acceptedAnswer: { '@type': 'Answer', text: item.answer },
            })),
          },
        ]
      : [];

  return {
    '@context': 'https://schema.org',
    '@graph': [crumbs, ...(catering.page ? [business, service] : []), ...faq],
  };
};
