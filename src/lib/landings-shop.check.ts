/**
 * Search landings of the shop and the venues (`src/data/landings-shop.ts`) on
 * the fixture: title up to 60 characters, description 140–160, every number
 * and claimed word of the texts found in the content, shelves filled and
 * without repeats, the questions answered in plain text, the markup without
 * empty values and with unique ids, both venues found. And the guard itself:
 * a page whose promise left the admin falls back to the safe texts.
 * Run: `pnpm test`.
 * Посадочные страницы магазина и точек (`src/data/landings-shop.ts`) на
 * фикстуре: title до 60 знаков, description 140–160, каждое число и
 * обещанное слово текстов есть в контенте, полки заполнены и без повторов,
 * ответы на вопросы — простым текстом, разметка без пустых значений и с
 * уникальными `@id`, обе точки находятся. И сама страховка: страница, чьё
 * обещание ушло из админки, берёт запасные тексты. Запуск: `pnpm test`.
 */
import assert from 'node:assert/strict';
import { normalize, type Content, type Raw } from './content.ts';
import {
  SHOP_LANDINGS,
  factCorpus,
  faqLd,
  faqOf,
  introOf,
  itemListLd,
  menuLd,
  menuLine,
  placeAt,
  placeOf,
  placePath,
  relatedOf,
  seoOf,
  shelvesOf,
  unconfirmedNumbers,
  type ShopKey,
} from '../data/landings-shop.ts';
import fixture from '../data/fixture.json' with { type: 'json' };

const content = normalize(fixture as unknown as Raw, () => '/x.jpg', '2026-10-23', () => {});
const corpus = factCorpus(content);
const PAGE = 'https://vkus-com.ru';
const CATALOG = `${PAGE}/catalog/`;

// ── the registry / реестр ───────────────────────────────────────────────────
const paths = new Set<string>();
for (const page of SHOP_LANDINGS) {
  assert.match(page.path, /^\/[a-z-]+\/$/, `${page.key}: путь без BASE, со слэшами`);
  assert.ok(!paths.has(page.path), `${page.path}: путь повторяется`);
  paths.add(page.path);
  for (const [name, title, description] of [
    ['реестр', page.title, page.description],
    ['запасной', page.fallback.title, page.fallback.description],
  ] as const) {
    assert.ok(title.length <= 60, `${page.path} (${name}): title ${title.length} > 60 — «${title}»`);
    assert.ok(
      description.length >= 140 && description.length <= 160,
      `${page.path} (${name}): description ${description.length}, нужно 140–160`,
    );
    assert.ok(title.includes('Вкусная компания'), `${page.path} (${name}): в title нет бренда`);
  }
  assert.ok(page.h1.trim() && page.h1.length <= 60, `${page.path}: H1`);
  assert.ok(page.keywords.length > 0, `${page.path}: нет фраз ядра`);
  assert.ok(page.teaser.trim(), `${page.path}: нет строки для ссылок`);

  // every promise is in the content today / каждое обещание сегодня есть в контенте
  const seo = seoOf(page, content);
  assert.deepEqual(seo.missing, [], `${page.path}: контент не подтверждает ${seo.missing.join(', ')}`);
  assert.equal(seo.title, page.title);
  assert.equal(seo.description, page.description);
  // the fallback promises no number but an address / запасной текст не обещает чисел, кроме адреса
  assert.deepEqual(
    unconfirmedNumbers(`${page.fallback.title} ${page.fallback.description}`, '').filter((n) => !/^(212|177)$/.test(n)),
    [],
    `${page.path}: в запасном тексте числа`,
  );
}

// ── the guard / страховка ───────────────────────────────────────────────────
assert.deepEqual(unconfirmedNumbers('кухня до 22:30, торт за 48 часов, от 3 500 ₽', corpus), []);
assert.deepEqual(unconfirmedNumbers('зал на 140 гостей и торт за 72 часа', corpus), ['140 гостей', '72 часа']);
assert.deepEqual(unconfirmedNumbers('800 г и 1,5 кг', corpus), []);
{
  // the restaurant stops promising a hall of 100+ and the kitchen until 22:30
  // ресторан перестал обещать зал на 100+ гостей и кухню до 22:30
  const changed: Content = {
    ...content,
    directions: content.directions.map((direction) =>
      direction.key === 'restaurant' ? { ...direction, text: 'Семейные обеды и ужины.' } : direction,
    ),
    places: content.places.map((place) =>
      /советской/i.test(place.name)
        ? { ...place, schedule: place.schedule.map(() => ['10:00', '22:00']) as unknown as typeof place.schedule }
        : place,
    ),
  };
  const page = SHOP_LANDINGS.find((p) => p.key === 'sovetskoy-armii')!;
  const seo = seoOf(page, changed);
  assert.ok(seo.missing.includes('100+ гостей') && seo.missing.includes('22:30'), `не заметил: ${seo.missing}`);
  assert.equal(seo.description, page.fallback.description, 'устаревшее описание ушло в сниппет');
}

// ── venues / точки ──────────────────────────────────────────────────────────
const sadovaya = placeOf('sadovaya', content);
const army = placeOf('sovetskoy-armii', content);
assert.ok(sadovaya && army && sadovaya !== army, 'точки не нашлись');
assert.equal(placePath(sadovaya), '/sadovaya/');
assert.equal(placePath(army), '/sovetskoy-armii/');
assert.equal(placeAt(sadovaya), 'Садовой, 212Б');
assert.equal(placeAt(army), 'Советской Армии, 177');

// ── pages / страницы ────────────────────────────────────────────────────────
const TAG = /<[a-z/][^>]*>/i;
const BAD = /undefined|NaN|null|\[object/;
for (const page of SHOP_LANDINGS) {
  const key = page.key as ShopKey;
  const intro = introOf(key, content);
  assert.ok(intro.length > 40 && !BAD.test(intro), `${page.path}: вводный текст «${intro}»`);
  assert.deepEqual(unconfirmedNumbers(intro.replace(/\b\d+ (позиц|блюд|завтрак|разделах|праздничн|тортов|торта|торт)\p{L}*/giu, ''), corpus).filter((n) => !/^\d+$/.test(n)), [], `${page.path}: числа вводного текста`);

  const shelves = shelvesOf(key, content);
  if (['cakes', 'desserts', 'breakfasts'].includes(key)) assert.ok(shelves.length > 0, `${page.path}: нет полок`);
  const slugs = shelves.flatMap((shelf) => shelf.products.map((product) => product.slug));
  assert.equal(new Set(slugs).size, slugs.length, `${page.path}: блюдо на двух полках`);
  for (const shelf of shelves) {
    assert.ok(shelf.products.length > 0, `${page.path}: пустая полка ${shelf.id}`);
    assert.ok(!BAD.test(`${shelf.title} ${shelf.lead ?? ''}`), `${page.path}: полка ${shelf.id}`);
  }

  const faq = faqOf(key, content);
  assert.ok(faq.length >= 3, `${page.path}: вопросов ${faq.length}`);
  assert.equal(new Set(faq.map((item) => item.id)).size, faq.length, `${page.path}: id вопросов повторяются`);
  for (const item of faq) {
    assert.ok(!TAG.test(item.a) && !BAD.test(item.a) && item.a.trim().length > 10, `${page.path}: ответ «${item.a}»`);
    assert.ok(/[.?!»)]$/.test(item.a), `${page.path}: ответ без точки «${item.a}»`);
    if (item.link) assert.match(item.link.href, /^\/[a-z-/#]*$/, `${page.path}: ссылка ${item.link.href}`);
  }

  const related = relatedOf(key);
  assert.ok(related.length >= 3, `${page.path}: мало соседних страниц`);
  assert.ok(!related.some((link) => link.href === page.path), `${page.path}: ссылается на себя`);
  assert.ok(related.some((link) => link.href === '/catalog/' || link.href === '/catering/'), `${page.path}: нет каталога или кейтеринга`);

  // markup / разметка
  const url = `${PAGE}${page.path}`;
  const nodes = [
    ...(shelves.length ? [itemListLd(url, CATALOG, page.h1, shelves)] : []),
    ...(key === 'menu' ? [menuLd(url, CATALOG, content)] : []),
    faqLd(url, faq),
  ];
  const text = JSON.stringify(nodes);
  assert.ok(!/undefined|NaN|null|""/.test(text), `${page.path}: пустое значение в разметке`);
  const ids = [...text.matchAll(/"@id":"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `${page.path}: @id повторяются`);
  assert.ok(!ids.includes(url), `${page.path}: @id страницы занят — он принадлежит раскладке`);
}

// the pages agree with each other / страницы согласны друг с другом
const cakes = shelvesOf('cakes', content);
assert.deepEqual(
  cakes.map((shelf) => shelf.id),
  ['prazdnichnye', 'detskie', 'v-nalichii'],
  'полки тортов',
);
assert.ok(cakes[1].products.every((product) => /детск/i.test(product.title)), 'детские торты — по слову «детский»');
const desserts = shelvesOf('desserts', content);
assert.ok(desserts[0].id === 'korpusnye' && desserts[0].products.every((p) => /мусс/i.test(p.description ?? '')), 'корпусные — муссовые');
assert.ok(menuLd(`${PAGE}/menu/`, CATALOG, content).hasMenuSection.length === content.catalog.categories.length, 'меню: все разделы');
const line = menuLine(content.catalog.categories[0].products[0]);
assert.ok(line.text.length <= 90 && line.price, 'строка меню');


// how to order a cake / как заказать торт
{
  const { cakeSteps } = await import('../data/landings-shop.ts');
  const steps = cakeSteps(content);
  assert.ok(steps.length === 4 && steps.every((step) => step.title && step.text && !BAD.test(step.text)), `шаги заказа торта: ${JSON.stringify(steps)}`);
}

// the cakes showcase of the home page: the very festive section the shelves of /cakes/ are cut from
// витрина тортов главной: тот самый праздничный раздел, из которого режутся полки /cakes/
{
  const { cakeShowcase, sectionOf, SECTION } = await import('../data/landings-shop.ts');
  const { priceLabel } = await import('./catalog.ts');
  const showcase = cakeShowcase(content);
  const festive = sectionOf(content, SECTION.festive);
  assert.ok(showcase && festive, 'витрина тортов: нет раздела «Праздничные торты»');
  assert.equal(showcase.section, festive);
  assert.deepEqual(
    showcase.cakes.map(({ product }) => product.slug),
    festive.products.map((product) => product.slug),
    'витрина тортов — весь раздел каталога в его порядке',
  );
  const shelved = new Set(cakes.filter((shelf) => shelf.section === festive).flatMap((shelf) => shelf.products.map((p) => p.slug)));
  assert.ok(showcase.cakes.every(({ product }) => shelved.has(product.slug)), 'витрина тортов — те же торты, что на полках /cakes/');
  for (const { product, note } of showcase.cakes) {
    const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');
    assert.match(plain(note), /^(\d+(,\d+)? кг( · \d+(,\d+)? кг)*|\d+ размер\p{L}*) · 48 часов$/u, `торт «${product.title}»: подпись «${note}»`);
    assert.match(plain(priceLabel(product)), /^(от )?\d{1,3}( \d{3})* ₽$/, `торт «${product.title}»: цена «${priceLabel(product)}»`);
    assert.ok(product.photo && !product.photo.placeholder, `торт «${product.title}»: в фикстуре нет фото`);
  }
  const without = { ...content, catalog: { ...content.catalog, categories: content.catalog.categories.filter((category) => category !== festive) } };
  assert.equal(cakeShowcase(without), null, 'нет раздела «Праздничные торты» — нет витрины');
}

console.log(`landings-shop: ${SHOP_LANDINGS.length} страниц, вопросы и разметка в порядке`);
