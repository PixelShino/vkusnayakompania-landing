/**
 * Проверка разметки Schema.org на фикстуре: граф раскладки и страниц
 * кейтеринга и документов без `undefined`, `null` и пустых строк, у каждого
 * узла есть `@type`, `@id` на странице не повторяются, каждая ссылка
 * `{ "@id" }` ведёт на узел той же страницы, заглушка Max в `sameAs` не
 * попадает, меню-заглушка не попадает в `hasMenu`, ответы FAQ — без тегов.
 * Запуск: `pnpm test`.
 */
import assert from 'node:assert/strict';
import { normalize, type Content, type Raw } from './content.ts';
import { cateringJsonLd, type CateringKind } from './catering-seo.ts';
import {
  breadcrumbId,
  compact,
  homeUrl,
  layoutGraph,
  menusOf,
  orgId,
  orgSameAs,
  placeId,
  stripHtml,
  websiteId,
  type PageSchema,
} from './seo.ts';
import { TWOGIS_BRANCHES_URL, YANDEX_CHAIN_URL, schemaHoursSpec, toSchedule } from '../data/site.ts';
import fixture from '../data/fixture.json' with { type: 'json' };

const content = normalize(fixture as unknown as Raw, () => '/x.jpg', '2026-10-20', () => {});
const site = new URL('https://vkus-com.ru/');
const origin = site.origin;

type Json = Record<string, unknown>;
type Graph = { '@context': string; '@graph': Json[] };

/** Все объекты графа на любой глубине — с путём, чтобы ошибка называла место. */
const walk = (value: unknown, path: string, visit: (value: unknown, path: string) => void) => {
  visit(value, path);
  if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`, visit));
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`, visit);
};

/**
 * Одна страница — несколько блоков JSON-LD (раскладка + свой блок страницы).
 * Правила для всех вместе: значения непустые, у объекта со свойствами есть
 * `@type`, определения `@id` не повторяются, ссылки разрешаются.
 */
const checkPage = (name: string, graphs: Graph[]) => {
  const defined = new Map<string, string>();
  const refs: [string, string][] = [];
  for (const graph of graphs) {
    assert.equal(graph['@context'], 'https://schema.org', `${name}: @context`);
    assert.ok(Array.isArray(graph['@graph']) && graph['@graph'].length > 0, `${name}: пустой @graph`);
    // what reaches the page is the JSON text: compare against it, not the object
    // на страницу попадает текст JSON: сверяем с ним, а не с объектом
    const text = JSON.stringify(graph);
    assert.ok(!/undefined|NaN|\[object Object\]/.test(text), `${name}: в разметке ${text.match(/.{40}(undefined|NaN).{20}/)?.[0]}`);
    walk(JSON.parse(text), name, (value, path) => {
      assert.notEqual(value, null, `${path}: null`);
      if (typeof value === 'string') assert.ok(value.trim() !== '', `${path}: пустая строка`);
      if (Array.isArray(value)) assert.ok(value.length > 0, `${path}: пустой список`);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const node = value as Json;
      const keys = Object.keys(node).filter((key) => key !== '@context' && key !== '@graph');
      if (path === name) return;
      if (keys.length === 1 && keys[0] === '@id') {
        refs.push([String(node['@id']), path]);
        return;
      }
      assert.ok(typeof node['@type'] === 'string' && node['@type'], `${path}: нет @type`);
      if (node['@id'] !== undefined) {
        const id = String(node['@id']);
        assert.ok(!defined.has(id), `${name}: @id ${id} дважды — ${defined.get(id)} и ${path}`);
        defined.set(id, path);
      }
    });
  }
  for (const [id, path] of refs) assert.ok(defined.has(id), `${path}: ссылка на ${id}, а такого узла на странице нет`);
  return defined;
};

const page = (url: string, schema: PageSchema = {}) => ({
  url,
  name: 'Заголовок страницы',
  description: 'Описание страницы',
  image: { url: `${origin}/og.jpg`, width: 1200, height: 630 },
  ...schema,
});
const images = { brand: `${origin}/og.jpg`, byPlace: { '1': `${origin}/_astro/sadovaya.jpg` } };
const logo = { url: `${origin}/_astro/logo.png`, width: 600, height: 261 };
const layout = (c: Content, url: string | null, schema?: PageSchema) =>
  layoutGraph(c, site, { logo, images, page: url ? page(url, schema) : null }) as unknown as Graph;
const nodeOf = (graph: Graph, id: string) => graph['@graph'].find((node) => node['@id'] === id) as Json;

// ── главная: компания, сайт, две точки, страница ─────────────────────────────
const home = layout(content, homeUrl(site));
const homeIds = checkPage('главная', [home]);
assert.deepEqual(
  home['@graph'].map((node) => node['@type']),
  ['Organization', 'WebSite', 'Bakery', 'Restaurant', 'WebPage'],
);
assert.ok(homeIds.has(orgId(origin)) && homeIds.has(websiteId(origin)) && homeIds.has(homeUrl(site)));

const org = nodeOf(home, orgId(origin));
assert.equal(org.name, 'Вкусная компания');
assert.equal(org.legalName, fixture.settings.legal_name);
assert.equal(org.taxID, fixture.settings.inn);
assert.deepEqual(org.identifier, [
  { '@type': 'PropertyValue', propertyID: 'ИНН', value: fixture.settings.inn },
  { '@type': 'PropertyValue', propertyID: 'ОГРНИП', value: fixture.settings.ogrn },
]);
assert.equal('email' in org, false, 'пустая почта не выводится');
assert.equal((org.contactPoint as Json).contactType, 'customer service');
assert.equal((org.logo as Json).url, logo.url);

// sameAs: VK, Telegram, the real Max link (in the fixture since 26.10.2026), сеть на картах
// sameAs: VK, Telegram, настоящая ссылка Max (в фикстуре с 26.10.2026), сеть на картах
assert.match(fixture.settings.max ?? '', /^https:\/\/max\.ru\/join\//, 'в фикстуре настоящая ссылка Max');
const sameAs = org.sameAs as string[];
assert.deepEqual(sameAs, [fixture.settings.vk, fixture.settings.telegram, fixture.settings.max, YANDEX_CHAIN_URL, TWOGIS_BRANCHES_URL]);
// the stub `https://max.ru/` opens no chat and stays out of sameAs
// заглушка `https://max.ru/` чата не открывает и в sameAs не попадает
const stubbed = orgSameAs({ ...content.settings, max: 'https://max.ru/' });
assert.ok(!stubbed.some((href) => href.includes('max.ru')), 'заглушка Max попала в sameAs');
// настоящий канал Max — выводится; пустой VK — нет
const withMax = orgSameAs({ ...content.settings, max: 'https://max.ru/u/abc', vk: '' });
assert.deepEqual(withMax, [fixture.settings.telegram, 'https://max.ru/u/abc', YANDEX_CHAIN_URL, TWOGIS_BRANCHES_URL]);

const site1 = nodeOf(home, websiteId(origin));
assert.deepEqual(site1.publisher, { '@id': orgId(origin) });
assert.equal(site1.inLanguage, 'ru-RU');

const webPage = nodeOf(home, homeUrl(site));
assert.deepEqual(webPage.isPartOf, { '@id': websiteId(origin) });
assert.deepEqual(webPage.about, { '@id': orgId(origin) }, 'главная — об организации');
assert.equal('breadcrumb' in webPage, false, 'у главной нет крошек');

// точки: связь с компанией, свои часы и фото, заказ через каталог
const sadovaya = nodeOf(home, placeId(origin, '1'));
const armii = nodeOf(home, placeId(origin, '2'));
assert.deepEqual(sadovaya.parentOrganization, { '@id': orgId(origin) });
assert.equal(sadovaya.image, images.byPlace['1']);
assert.equal(armii.image, images.brand, 'без своего фото — картинка компании');
assert.equal(sadovaya.currenciesAccepted, 'RUB');
assert.equal(sadovaya.acceptsReservations, true);
assert.equal('aggregateRating' in sadovaya, false, 'оценки с чужих площадок не переносятся');
assert.equal('paymentAccepted' in sadovaya, false);
assert.match(String(sadovaya.description), /^Кафе и кондитерская в одном зале: завтраки с 8:00/, 'описание точки — из её направления');
const action = sadovaya.potentialAction as Json;
assert.equal(action['@type'], 'OrderAction');
assert.equal((action.target as Json).urlTemplate, `${origin}/catalog/`);
assert.deepEqual(action.deliveryMethod, [
  'http://purl.org/goodrelations/v1#DeliveryModeOwnFleet',
  'https://schema.org/OnSitePickup',
]);
// пустой каталог — заказывать негде, действия нет
const noCatalog = layout({ ...content, catalog: { ...content.catalog, count: 0 } }, homeUrl(site));
assert.equal('potentialAction' in nodeOf(noCatalog, placeId(origin, '1')), false);

// menus: stubs stay out of the markup, real files (in the fixture since 26.10.2026) go in
// меню: заглушки в разметку не идут, настоящие файлы (в фикстуре с 26.10.2026) — идут
const stubMenus = {
  ...content,
  menus: content.menus.map((menu) => ({ ...menu, file: { ...menu.file, placeholder: true } })),
};
assert.equal('hasMenu' in nodeOf(layout(stubMenus, homeUrl(site)), placeId(origin, '1')), false, 'меню-заглушка попала в hasMenu');
const realMenus = content;
assert.ok(content.menus.some((menu) => !menu.file.placeholder), 'в фикстуре есть настоящие меню');
const menuGraph = layout(realMenus, homeUrl(site));
checkPage('главная с настоящими меню', [menuGraph]);
const expectedMenus = menusOf(realMenus, realMenus.places[0]).map((menu) => ({
  '@type': 'Menu',
  name: menu.title,
  url: `${origin}${menu.file.href}`,
  dateModified: menu.updated,
}));
assert.ok(expectedMenus.length > 0, 'у Садовой есть настоящее меню');
assert.deepEqual(nodeOf(menuGraph, placeId(origin, '1')).hasMenu, expectedMenus);
// у кондитерской нет своей точки — её меню не приписывается ни одной
const attributed = realMenus.places.map((place) => menusOf(realMenus, place).map((menu) => menu.title));
assert.ok(attributed[0].includes('Меню кафе') && attributed[1].includes('Меню ресторана'), 'меню точек на своих местах');
assert.ok(!attributed.flat().includes('Меню кондитерской'), 'меню кондитерской приписано точке');

// часы: та же неделя в двух форматах
const week = toSchedule(
  (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((day) => ({
    day,
    open: day === 'sun' ? '09:00' : '08:00',
    close: '21:00',
  })),
);
assert.deepEqual(schemaHoursSpec(week), [
  {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    opens: '08:00',
    closes: '21:00',
  },
  { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Sunday'], opens: '09:00', closes: '21:00' },
]);

// ── 404: без WebPage ─────────────────────────────────────────────────────────
const notFound = layout(content, null);
checkPage('404', [notFound]);
assert.ok(!notFound['@graph'].some((node) => String(node['@type']).endsWith('Page')));

// ── документы: CollectionPage и WebPage с крошками, без второго узла ─────────
const docsUrl = `${origin}/docs/`;
const docs = layout(content, docsUrl, {
  type: 'CollectionPage',
  crumbs: [
    { name: 'Главная', url: homeUrl(site) },
    { name: 'Документы', url: docsUrl },
  ],
  fields: {
    about: { '@id': orgId(origin) },
    hasPart: content.pages.map((doc) => ({ '@type': 'WebPage', '@id': `${origin}${doc.href}`, url: `${origin}${doc.href}`, name: doc.title })),
  },
});
checkPage('документы', [docs]);
const collection = nodeOf(docs, docsUrl);
assert.equal(collection['@type'], 'CollectionPage');
assert.deepEqual(collection.breadcrumb, { '@id': breadcrumbId(docsUrl) });
assert.equal(nodeOf(docs, breadcrumbId(docsUrl))['@type'], 'BreadcrumbList');
assert.equal(docs['@graph'].filter((node) => node['@type'] === 'BreadcrumbList').length, 1);

const offerUrl = `${origin}/docs/offer/`;
const offer = layout(content, offerUrl, {
  crumbs: [
    { name: 'Главная', url: homeUrl(site) },
    { name: 'Документы', url: docsUrl },
    { name: 'Публичная оферта', url: offerUrl },
  ],
  fields: { about: { '@id': orgId(origin) }, publisher: { '@id': orgId(origin) }, dateModified: undefined },
});
checkPage('оферта', [offer]);
assert.equal(nodeOf(offer, offerUrl)['@type'], 'WebPage', 'документ — WebPage, не Article');
assert.equal('dateModified' in nodeOf(offer, offerUrl), false, 'пустая дата редакции не выводится');

// ── кейтеринг: раскладка + свой блок страницы на каждой из трёх ───────────────
const cateringUrl: Record<CateringKind, string> = {
  overview: `${origin}/catering/`,
  services: `${origin}/catering/services/`,
  faq: `${origin}/catering/faq/`,
};
for (const kind of ['overview', 'services', 'faq'] as const) {
  const own = cateringJsonLd(content, site, kind, `${origin}/_astro/hero.jpg`) as unknown as Graph;
  checkPage(`кейтеринг ${kind}`, [layout(content, cateringUrl[kind]), own]);
  const crumbs = nodeOf(own, breadcrumbId(cateringUrl[kind]));
  assert.equal(crumbs['@type'], 'BreadcrumbList', `кейтеринг ${kind}: крошки со своим @id`);
  assert.ok(!own['@graph'].some((node) => node['@id'] === cateringUrl[kind]), 'узел страницы — у раскладки');
  const service = nodeOf(own, `${cateringUrl.overview}#service`);
  assert.deepEqual(service.provider, { '@id': orgId(origin) });
  const offers = (service.hasOfferCatalog as Json).itemListElement as Json[];
  for (const item of offers) {
    const spec = item.priceSpecification as Json | undefined;
    if (!spec) continue;
    assert.equal(spec.priceCurrency, 'RUB');
    assert.ok(typeof spec.minPrice === 'number' && spec.minPrice > 0);
    // `unitText` — свойство UnitPriceSpecification, не PriceSpecification
    if ('unitText' in spec) assert.equal(spec['@type'], 'UnitPriceSpecification');
  }
  assert.deepEqual(nodeOf(own, `${cateringUrl.overview}#business`).parentOrganization, { '@id': orgId(origin) });
}
const faq = nodeOf(cateringJsonLd(content, site, 'faq') as unknown as Graph, `${cateringUrl.faq}#faq`);
const questions = faq.mainEntity as Json[];
assert.equal(questions.length, content.catering.questions.length, 'в FAQPage все вопросы страницы');
questions.forEach((question, i) => {
  assert.equal(question.name, content.catering.questions[i].question, 'вопрос целиком, без обрезки');
  const text = String((question.acceptedAnswer as Json).text);
  assert.ok(!/<[a-z/][^>]*>|&[a-z#0-9]+;/i.test(text), `ответ с тегами: ${text.slice(0, 60)}`);
});
// ответ, набранный с тегами, приходит в разметку словами
const tagged = {
  ...content,
  catering: {
    ...content.catering,
    questions: [{ ...content.catering.questions[0], answer: '<p>Да,&nbsp;<b>можно</b>.</p><p>Звоните&#33;</p>' }],
  },
};
const taggedFaq = nodeOf(cateringJsonLd(tagged, site, 'faq') as unknown as Graph, `${cateringUrl.faq}#faq`);
assert.equal(((taggedFaq.mainEntity as Json[])[0].acceptedAnswer as Json).text, 'Да, можно.\nЗвоните!');

// ── помощники ────────────────────────────────────────────────────────────────
assert.equal(stripHtml('<p>Один</p>\n<p>Два<br>три &laquo;четыре&raquo; &amp; &#x41;</p>'), 'Один\nДва\nтри «четыре» & A');
assert.equal(stripHtml('  без тегов  '), 'без тегов');
assert.deepEqual(compact({ a: undefined, b: null, c: '', d: ' ', e: [], f: {}, g: [null, '', 'x'], h: { i: undefined }, j: 0, k: false }), {
  g: ['x'],
  j: 0,
  k: false,
});

console.log('seo: разметка Schema.org в порядке');
