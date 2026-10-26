/**
 * Проверка текста для языковых моделей (`/llms.txt`, `/llms-full.txt`) на
 * фикстуре: заголовок и обязательные разделы, данные точек и реквизиты из
 * админки, цены вида «1 850 ₽», ни `undefined`, ни HTML, ни заглушки Max; в
 * полной версии — каждое блюдо в наличии, каждый вопрос кейтеринга и тексты
 * документов со вставками. Запуск: `pnpm test`.
 */
import assert from 'node:assert/strict';
import { normalize, type Raw, type ResolveImage } from './content.ts';
import { buildLlms, htmlToText, toZones } from './llms.ts';
import fixture from '../data/fixture.json' with { type: 'json' };
import seedZones from '../data/delivery-zones.json' with { type: 'json' };

const SITE = 'https://vkus-com.ru';
const raw = fixture as unknown as Raw;
// картинки тексту не нужны: резолвер отдаёт строку, файлы на диске не требуются
const resolve: ResolveImage = (file) => `/fixture-files/${file.id}`;
const load = (data: Raw) => normalize(data, resolve, '2026-10-23', () => {});
const content = load(raw);
const zones = toZones(seedZones);

const short = buildLlms(content, SITE, { zones });
const full = buildLlms(content, SITE, { zones, full: true });

/** Общие запреты для обеих версий. */
const clean = (text: string, name: string) => {
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), `${name}: файл кончается одним переводом строки`);
  assert.doesNotMatch(text, /undefined|\bnull\b|NaN|\[object /, `${name}: в тексте пустое значение`);
  assert.doesNotMatch(text, /<\/?[a-z][a-z0-9]*\b[^>]*>/i, `${name}: в тексте остался HTML-тег`);
  assert.doesNotMatch(text, /&(?:[a-z]+|#\d+);/i, `${name}: в тексте осталась HTML-сущность`);
  assert.doesNotMatch(text, /\[\[|\]\]/, `${name}: в тексте осталась вставка [[…]]`);
  assert.doesNotMatch(text, /[\u00a0\u202f\u00ad]/, `${name}: неразрывные пробелы и мягкие переносы заменяются обычными`);
  assert.doesNotMatch(text, /\n{3,}/, `${name}: больше одной пустой строки подряд`);
  assert.doesNotMatch(text, /[ \t]$/m, `${name}: пробел в конце строки`);
  // заглушка Max (`https://max.ru/`) чата не открывает — в тексте её нет
  assert.doesNotMatch(text, /https:\/\/max\.ru\/(?!\w)/i, `${name}: заглушка Max попала в текст`);
  assert.doesNotMatch(text, /заглушк/i, `${name}: пометка заглушки попала в текст`);
  // свои слова файла — без восклицаний; в текстах из админки (описания блюд) они остаются как есть
  assert.doesNotMatch(text.split('\n## ')[0], /!/, `${name}: восклицательный знак в описании сайта`);
  // все ссылки Markdown — абсолютные
  for (const [, href] of text.matchAll(/\]\(([^)\s]+)\)/g))
    assert.match(href, /^https:\/\//, `${name}: ссылка «${href}» не абсолютная`);
  // адрес не кончается точкой: читатель принял бы её за часть адреса
  assert.doesNotMatch(text, /https?:\/\/[^\s)]+[.,;]$/m, `${name}: точка или запятая сразу после адреса в конце строки`);
};
clean(short, 'llms.txt');
clean(full, 'llms-full.txt');

// ── llms.txt ───────────────────────────────────────────────────────────────
assert.ok(short.startsWith('# Вкусная компания\n\n> '), 'llms.txt: заголовок H1 и цитата-описание по llmstxt.org');
const sections = [...short.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
for (const name of ['О компании', 'Доставка и каталог', 'Кейтеринг и банкеты', 'Документы', 'Контакты', 'Юридическая информация', 'Optional'])
  assert.ok(sections.includes(name), `llms.txt: нет раздела «${name}»`);
assert.equal(sections.at(-1), 'Optional', 'llms.txt: «Optional» — последний раздел, как велит формат');

// точки, телефоны и часы — из админки
for (const place of content.places) {
  assert.ok(short.includes(place.name), `llms.txt: нет точки «${place.name}»`);
  assert.ok(short.includes(place.phone), `llms.txt: нет телефона точки «${place.name}»`);
  assert.ok(short.includes(`https://yandex.ru/maps/org/${place.yandex_org}/`), `llms.txt: нет карточки точки «${place.name}» в Яндекс Картах`);
}
assert.ok(short.includes('пн–пт 8:00–21:00, сб 8:30–21:00, вс 9:00–21:00'), 'llms.txt: часы Садовой из админки');
assert.ok(short.includes('ежедневно 9:00–22:30'), 'llms.txt: часы Советской Армии из админки');
assert.ok(short.includes(`Телефон: ${content.settings.phone}`), 'llms.txt: общий телефон');
assert.ok(short.includes('[Telegram](https://t.me/vkusnayakompania)'), 'llms.txt: настоящий Telegram выводится');
assert.ok(short.includes('[ВКонтакте](https://vk.ru/vkusnayakompania)'), 'llms.txt: ВКонтакте выводится');
// реквизиты
assert.ok(short.includes(`- ${content.settings.legal_name}`), 'llms.txt: наименование ИП');
assert.ok(short.includes(`ИНН ${content.settings.inn}`), 'llms.txt: ИНН');
assert.ok(short.includes(`ОГРНИП ${content.settings.ogrn}`), 'llms.txt: 15 цифр — ОГРНИП');
// ссылки разделов
for (const path of ['', 'catalog/', 'catering/', 'catering/services/', 'catering/faq/', 'docs/offer/', 'docs/delivery/', 'docs/privacy/', 'docs/requisites/', 'llms-full.txt'])
  assert.ok(short.includes(`](${SITE}/${path})`), `llms.txt: нет ссылки на /${path}`);
// цены «1 250 ₽» — с обычными пробелами, рубль через пробел
assert.ok(short.includes('Доставка боксов — от 1 250 ₽ за бокс'), 'llms.txt: цена формата кейтеринга «от 1 250 ₽ за бокс»');
assert.ok(short.includes('Праздники — от 3 500 ₽ за гостя, 100+ гостей'), 'llms.txt: цена и гости банкета');
assert.ok(short.includes('Кофе-брейк — по смете'), 'llms.txt: формат без цены — «по смете», как на странице');
assert.ok(
  short.includes('- Советский, Промышленный, Октябрьский, Кировский: доставка 400 ₽, бесплатно от 7 000 ₽, минимальный заказ 1 000 ₽'),
  'llms.txt: зона доставки с ценой, порогом и минимумом',
);
// the count follows the fixture: items in stock and the sections that have them
// число идёт за фикстурой: позиции в наличии и разделы, где они есть
const stockLine = /(\d+) позици\S* в (\d+) раздел\S*/.exec(short);
assert.ok(stockLine, 'llms.txt: число блюд и разделов каталога');
const stockCount = Number(stockLine![1]);
assert.ok(stockCount > 0 && stockCount <= content.catalog.count, 'llms.txt: позиций в наличии не больше, чем в каталоге');
assert.doesNotMatch(short, /\d{4} ₽/, 'llms.txt: тысячи отделены пробелом');
assert.ok(Buffer.byteLength(short) < 16_000, `llms.txt: краткая версия разрослась до ${Buffer.byteLength(short)} байт`);
// краткая версия — без каталога и документов целиком
assert.ok(!short.includes('## Каталог доставки') && !short.includes('### 1. Термины'), 'llms.txt: каталог и документы целиком — только в полной версии');

// ── llms-full.txt ──────────────────────────────────────────────────────────
assert.ok(full.startsWith('# Вкусная компания\n\n> '), 'llms-full.txt: тот же заголовок');
for (const name of ['О компании', 'Доставка и каталог', 'Каталог доставки', 'Кейтеринг и банкеты', 'Кейтеринг: вопросы и ответы', 'Документы', 'Контакты', 'Юридическая информация'])
  assert.match(full, new RegExp(`^## ${name}$`, 'm'), `llms-full.txt: нет раздела «${name}»`);
assert.ok(!full.includes('## Optional'), 'llms-full.txt: «Optional» нужен только краткой версии');
assert.ok(full.includes(`Краткая версия этого файла: ${SITE}/llms.txt`), 'llms-full.txt: ссылка на краткую версию');

// каждое блюдо в наличии — со ссылкой на карточку и ценой
for (const category of content.catalog.categories) {
  assert.ok(full.includes(`\n### ${category.title}\n`), `llms-full.txt: нет раздела каталога «${category.title}»`);
  for (const product of category.products.filter((p) => p.available))
    assert.ok(full.includes(`- [${product.title}](${SITE}/catalog/#p-${product.slug}) — `), `llms-full.txt: нет блюда «${product.title}»`);
}
// a festive cake line carries its sizes with prices and the fillings (the figures follow the fixture)
// строка праздничного торта несёт размеры с ценами и начинки (цифры идут за фикстурой)
assert.match(full, /#p-tort[^)]*\) — от \d[\d ]* ₽\.[^\n]*Размеры: [^\n.]*\d кг — \d[\d ]* ₽/, 'llms-full.txt: размеры торта с ценой');
assert.match(full, /#p-tort[^)]*\)[^\n]*Начинки на выбор: \p{Lu}/u, 'llms-full.txt: начинки торта');

// снятое с продажи и черновик в текст не попадают
const [first, second] = raw.products!;
const trimmed = load({
  ...raw,
  products: raw.products!.map((p) => (p.id === first.id ? { ...p, available: false } : p.id === second.id ? { ...p, status: 'draft' } : p)),
});
const fullTrimmed = buildLlms(trimmed, SITE, { zones, full: true });
assert.ok(!fullTrimmed.includes(`[${first.title}]`), 'llms-full.txt: блюдо из стоп-листа не выводится');
assert.ok(!fullTrimmed.includes(`[${second.title}]`), 'llms-full.txt: черновик не выводится');
assert.match(buildLlms(trimmed, SITE, { zones }), new RegExp(`${stockCount - 2} позици\\S* в \\d+ раздел`), 'llms.txt: в счёте только блюда в наличии');

// кейтеринг: каждый формат и каждый вопрос с ответом
for (const format of content.catering.formats) {
  assert.ok(full.includes(`\n### ${format.title}\n`), `llms-full.txt: нет формата «${format.title}»`);
  for (const text of format.includes) assert.ok(full.includes(`- ${text}`), `llms-full.txt: «${format.title}» — нет пункта «${text}»`);
}
for (const question of content.catering.questions) {
  assert.ok(full.includes(`#### ${question.question}\n\n`), `llms-full.txt: нет вопроса «${question.question}»`);
  assert.ok(full.includes(question.answer.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 60)), `llms-full.txt: нет ответа на «${question.question}»`);
}

// документы: заголовок, адрес, разделы, вставки из админки
for (const page of content.pages) {
  assert.match(full, new RegExp(`^## ${page.title}\\n\\nАдрес: ${SITE}${page.href}$`, 'm'), `llms-full.txt: нет документа «${page.title}»`);
  for (const item of page.toc) assert.ok(full.includes(`### ${item.n ? `${item.n}. ` : ''}${item.title}\n`), `llms-full.txt: «${page.title}» — нет раздела «${item.title}»`);
}
assert.ok(full.includes(`- ИНН: ${content.settings.inn}`), 'llms-full.txt: вставка [[реквизиты]] развёрнута');
assert.ok(full.includes('- Telegram: https://t.me/vkusnayakompania'), 'llms-full.txt: вставка [[связь]] развёрнута');
assert.ok(full.includes('Можно заказать и по телефону +7 987 955-25-65.'), 'llms-full.txt: вставка [[телефон]] — номер словами');
assert.ok(
  full.includes('Советский, Промышленный, Октябрьский, Кировский: доставка 400 ₽, бесплатно от 7 000 ₽'),
  'llms-full.txt: строка зоны из документа — «название: условия»',
);
assert.ok(full.includes('[«Реквизиты и контакты»](https://vkus-com.ru/docs/requisites/)'), 'llms-full.txt: ссылка в документе стала абсолютной');
assert.ok(full.includes('каталог доставки vkus-com.ru/catalog/ и личный'), 'llms-full.txt: ссылка, чьи слова — её адрес, осталась словами');
const size = Buffer.byteLength(full);
assert.ok(size < 200_000, `llms-full.txt: ${size} байт — больше 200 КБ`);

// ── Max, меню, пустой сайт, база ───────────────────────────────────────────
const withMax = load({ ...raw, settings: { ...raw.settings, max: 'https://max.ru/u/f9LHodD0cOKmT3' } });
assert.ok(buildLlms(withMax, SITE).includes('[Max](https://max.ru/u/f9LHodD0cOKmT3)'), 'llms.txt: настоящая ссылка Max выводится');

// меню: заглушка не выводится, настоящий файл (в фикстуре с 26.10.2026) — выводится
// a stub is a file that was never replaced: uploaded right after creation, title marked
// заглушка — файл, который не заменяли: загружен сразу после создания, в заголовке пометка
const stubbedMenus = load({
  ...raw,
  menus: raw.menus.map((menu) => ({
    ...menu,
    file: { ...menu.file, title: `[заглушка] ${menu.title}`, created_on: '2026-09-23T10:00:00.000Z', uploaded_on: '2026-09-23T10:00:00.100Z' },
  })),
});
assert.ok(!buildLlms(stubbedMenus, SITE).includes('## Меню'), 'llms.txt: меню-заглушки не выводятся');
assert.match(short, /^## Меню$/m, 'llms.txt: настоящее меню выводится');
assert.match(short, /\]\(https:\/\/vkus-com\.ru\/media\/[0-9a-f-]+\.pdf\): Кафе на Садовой, PDF, обновлено /, 'llms.txt: меню — абсолютная ссылка на PDF');
assert.doesNotMatch(short, /Меню кондитерской/, 'llms.txt: заглушка меню кондитерской не выводится');

// пустой каталог, кейтеринг и документы, без зон — сайт описан тем, что есть
const bare = load({ ...raw, product_categories: [], products: [], catering_page: [], catering_formats: [], catering_faq: [], pages: [] });
for (const [name, text] of [['llms.txt', buildLlms(bare, SITE)], ['llms-full.txt', buildLlms(bare, SITE, { full: true })]] as const) {
  clean(text, `${name} без разделов`);
  assert.ok(!text.includes('## Доставка и каталог') && !text.includes('## Кейтеринг'), `${name}: пустые разделы не выводятся`);
  assert.ok(text.includes('## О компании') && text.includes('## Контакты') && text.includes('## Юридическая информация'), `${name}: о компании, контакты и реквизиты есть всегда`);
}

// превью в подпапке: свои ссылки — от базы
const sub = buildLlms(content, 'https://preview.example/sub', { zones });
assert.ok(sub.includes('](https://preview.example/sub/catalog/)'), 'llms.txt: ссылки строятся от корня сайта вместе с базой');

// ── зоны ───────────────────────────────────────────────────────────────────
assert.equal(zones.length, 6, 'зоны: шесть действующих в посеве');
const ring = [[50, 53], [50.1, 53], [50.1, 53.1]];
assert.deepEqual(
  toZones([
    { name: 'Б', price: 300, free_from: null, min_order: null, sort: 2, polygon: ring },
    { name: 'А', price: '0', free_from: 5000, min_order: 500, sort: 1, polygon: ring },
    { name: 'Выключена', price: 100, free_from: 1, status: 'draft', polygon: ring },
    { name: 'Без границы', price: 100, free_from: 1, polygon: [] },
    { name: '', price: 100 },
    { name: 'Без цены', price: null },
  ]),
  [
    { name: 'А', price: 0, freeFrom: 5000, minOrder: 500 },
    { name: 'Б', price: 300, freeFrom: null, minOrder: 0 },
  ],
  'зоны: только действующие, с именем, ценой и границей, по порядку',
);
const custom = buildLlms(content, SITE, { zones: toZones([{ name: 'Б', price: 300, free_from: null }, { name: 'А', price: 0, free_from: null }]) });
assert.ok(custom.includes('- Б: доставка 300 ₽\n'), 'зоны: без порога — ни слова о бесплатной доставке');
assert.ok(custom.includes('- А: доставка бесплатно\n'), 'зоны: цена 0 — доставка бесплатно');

// ── HTML → текст ───────────────────────────────────────────────────────────
const abs = (href: string) => (href.startsWith('tel:') ? undefined : new URL(href, `${SITE}/`).href);
assert.equal(
  htmlToText(
    '<h2 id="x"><span class="doc-n">1.</span> Термины</h2><p>Текст&nbsp;с&nbsp;&laquo;кавычками&raquo; &#8212; и <a href="/catalog/">каталогом</a>, <a href="tel:+7">+7</a>.</p>' +
      '<ol><li>Один</li><li><strong>Два</strong><br>подробно</li></ol><ul><li>Пункт</li></ul>' +
      '<div class="doc-table"><table><tr><th>Зона</th><th>Цена</th></tr><tr><td>Центр</td><td>600&nbsp;₽</td></tr></table></div><h3>Под</h3><p>Строка<br>вторая</p>',
    3,
    abs,
  ),
  '### 1. Термины\n\nТекст с «кавычками» — и [каталогом](https://vkus-com.ru/catalog/), +7.\n\n1. Один\n2. Два: подробно\n\n- Пункт\n\nЗона | Цена\nЦентр | 600 ₽\n\n#### Под\n\nСтрока\nвторая',
  'HTML → текст: заголовки, сущности, ссылки, списки, таблица, перенос строки',
);

console.log(`llms.txt: ${Buffer.byteLength(short)} байт, llms-full.txt: ${size} байт — разделы, цены, блюда, вопросы и документы на месте, проверки прошли`);
