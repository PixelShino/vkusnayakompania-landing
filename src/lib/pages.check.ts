/**
 * Documents (`/docs/<slug>/`): what reaches the page from the rich text, the
 * inserts, the table of contents, and the four documents the site links to.
 * Run: `pnpm test`.
 * Документы (`/docs/<slug>/`): что доходит до страницы из WYSIWYG, вставки,
 * оглавление и четыре документа, на которые ссылается сайт. Запуск: `pnpm test`.
 */
import assert from 'node:assert/strict';
import { DOC, anchorOf, cleanHtml, docHref, longDate, normalizePages, prepareBody, textParts, type RawPage } from './pages.ts';
import { normalize, type Raw } from './content.ts';
import { plural } from '../data/site.ts';
import fixture from '../data/fixture.json' with { type: 'json' };

const ctx = { phone: '+7 987 955-25-65', phoneHref: 'tel:+79879552565' };
const notes: string[] = [];
const log = (message: string) => notes.push(message);

// ── cleaning / очистка ──────────────────────────────────────────────────────
const dirty = cleanHtml(
  '<p onclick="steal()">Текст</p><script>alert(1)</script><p>&nbsp;</p><a href="javascript:alert(1)">x</a><iframe src="https://evil"></iframe><p><br></p>',
);
assert.ok(!/script|onclick|iframe|javascript:/i.test(dirty), `очистка пропустила опасное: ${dirty}`);
assert.ok(!/<p>(&nbsp;|<br>)<\/p>/.test(dirty), 'пустые абзацы TinyMCE остались');
assert.ok(dirty.includes('<p>Текст</p>'), 'очистка съела обычный текст');

// ── anchors / якоря ─────────────────────────────────────────────────────────
assert.equal(anchorOf('5. Цена и оплата'), '5-tsena-i-oplata');
assert.equal(anchorOf('Доставка по Самаре'), 'dostavka-po-samare');
assert.equal(anchorOf('!!!'), 'razdel');

// ── one body / один текст ───────────────────────────────────────────────────
const body = [
  '<h1>Общие положения</h1>',
  '<p>1.1. Пункт с <a href="/docs/privacy/">ссылкой</a> — и тире.</p>',
  '<h2>2. Оплата</h2>',
  '<p>Звоните [[телефон]] или пишите на vkus-com.ru/catalog/ в любое время, ответим за 5–30 минут.</p>',
  '<p>[[реквизиты]]</p>',
  '<h2>2. Оплата</h2>',
  '<table><tr><td>a</td></tr></table>',
  '<p>&nbsp;[[точки]]&nbsp;</p>',
  '<p>Внутри фразы [[связь]] и [[неизвестно]].</p>',
].join('');
const prepared = prepareBody(body, ctx, 'проверка', log);
assert.deepEqual(
  prepared.toc,
  [
    { id: 'obschie-polozheniya', title: 'Общие положения' },
    { id: '2-oplata', title: 'Оплата', n: '2' },
    { id: '2-oplata-2', title: 'Оплата', n: '2' },
  ],
  'оглавление: h1 стал разделом, номер вынесен, одинаковые заголовки получили разные якоря',
);
assert.deepEqual(
  prepared.segments.map((s) => (s.kind === 'block' ? s.block : 'html')),
  ['html', 'requisites', 'html', 'places', 'html'],
  'вставки-блоки делят текст на части',
);
const html = prepared.segments.map((s) => (s.kind === 'html' ? s.html : '')).join('');
assert.ok(html.includes('<h2 id="obschie-polozheniya">'), 'h1 в тексте не стал h2 с якорем');
assert.ok(html.includes('<span class="doc-n">2.</span> Оплата'), 'номер раздела не выделен');
assert.ok(html.includes('<p class="doc-cl"><span class="doc-cl__n">1.1.</span> Пункт'), 'номер пункта не вынесен');
assert.ok(html.includes('href="/docs/privacy/"'), 'корневая ссылка потеряна');
assert.ok(html.includes('\u00a0— и\u00a0тире'), 'тире не держится за слово');
assert.ok(html.includes(`<a class="tnum" href="${ctx.phoneHref}">${ctx.phone}</a>`), '[[телефон]] не подставлен');
assert.ok(html.includes('<div class="doc-table" role="region" aria-label="Таблица" tabindex="0"><table>'), 'таблица без коробки прокрутки');
assert.ok(!html.includes('[['), 'на странице осталась вставка в скобках');
assert.ok(html.includes('<span class="nw">vkus-com.ru/catalog/</span>'), 'адрес сайта может разорваться на дефисе');
assert.ok(html.includes('<span class="nw">5–30</span>'), 'диапазон чисел может разорваться на тире');
assert.ok(html.includes('пишите на\u00a0<span') && html.includes('в\u00a0любое'), 'короткие слова висят в конце строки');
assert.ok(
  notes.some((n) => n.includes('[[связь]]')) && notes.some((n) => n.includes('[[неизвестно]]')),
  'блок внутри фразы и неизвестная вставка не попали в лог',
);

// ── the list / список ───────────────────────────────────────────────────────
const raw: RawPage[] = [
  { id: 1, status: 'published', sort: 2, slug: 'b', title: 'Б', body: '<p>б</p>', revised: '2026-10-20' },
  { id: 2, status: 'published', sort: 1, slug: 'a', title: 'А', body: '<p>а</p>', date_updated: '2026-10-19T21:30:00.000Z' },
  { id: 3, status: 'draft', sort: 0, slug: 'draft', title: 'Черновик', body: '<p>ч</p>' },
  { id: 4, status: 'archived', sort: 0, slug: 'old', title: 'Архив', body: '<p>а</p>' },
  { id: 5, status: 'published', sort: 3, slug: 'Плохой адрес', title: 'Плохой', body: '<p>п</p>' },
  { id: 6, status: 'published', sort: 4, slug: 'a', title: 'Дубль', body: '<p>д</p>' },
  { id: 7, status: 'published', sort: 5, slug: 'empty', title: 'Пустой', body: '  ' },
];
notes.length = 0;
const list = normalizePages(raw, ctx, log);
assert.deepEqual(list.map((p) => p.slug), ['a', 'b'], 'на сайт: только опубликованные, по порядку, без брака');
assert.equal(list[0].href, '/docs/a/');
assert.equal(list[0].revised, '2026-10-20', 'без даты редакции — день сохранения по Самаре');
assert.equal(notes.length, 3, `брак не записан в лог: ${notes.join(' | ')}`);
assert.deepEqual(normalizePages(null, ctx, log), [], 'без коллекции — пусто, а не ошибка');
assert.equal(docHref(list, 'b'), '/docs/b/');
assert.equal(docHref(list, 'draft'), undefined, 'на черновик ссылок нет');
assert.equal(longDate('2026-10-20'), '20 октября 2026');
assert.deepEqual(
  textParts('Что получает сайт vkus-com.ru, и как.'),
  [
    { text: 'Что получает сайт ', domain: false },
    { text: 'vkus-com.ru', domain: true },
    { text: ', и\u00a0как.', domain: false },
  ],
  'описание: адрес сайта отдельным куском, короткие слова приклеены',
);

// ── the four documents of the fixture / четыре документа фикстуры ───────────
const content = normalize(fixture as unknown as Raw, () => '/x.jpg', '2026-10-20', () => {});
for (const slug of Object.values(DOC)) {
  const page = content.pages.find((p) => p.slug === slug);
  assert.ok(page, `в фикстуре нет опубликованного документа «${slug}»: на него ссылаются подвал, корзина и анкета ЮKassa`);
  assert.ok(page.description, `«${slug}»: нет описания для поиска`);
  assert.ok(page.revised, `«${slug}»: нет даты редакции`);
}
const blocks = (slug: string) =>
  content.pages.find((p) => p.slug === slug)!.segments.flatMap((s) => (s.kind === 'block' ? [s.block] : []));
assert.deepEqual(blocks(DOC.requisites), ['requisites', 'contacts', 'places'], 'реквизиты: ИП, связь и точки из админки');
assert.ok(blocks(DOC.offer).includes('requisites'), 'оферта: нет реквизитов продавца');
assert.ok(blocks(DOC.delivery).includes('places'), 'доставка: нет точек самовывоза');
assert.ok(content.pages.find((p) => p.slug === DOC.offer)!.toc.length >= 4, 'оферта без оглавления');
// the old shop and the app are not on the site (owner's rule of 12.10.2026)
// старого магазина и приложения на сайте нет (правило владельца 12.10.2026)
const allText = JSON.stringify((fixture as unknown as Raw).pages);
assert.ok(!/vkusdostavka|foodpicasso|приложени|app\s?store|google\s?play/i.test(allText), 'в документах упомянуты магазин или приложение');

// consent checkboxes and the footer lead to the pages, not to files
// галочки согласия и подвал ведут на страницы, а не на файлы
assert.equal(content.settings.policy?.href, '/docs/privacy/');
assert.equal(content.settings.policy?.kind, 'page');
assert.equal(content.settings.offer?.href, '/docs/offer/');
const withoutPages = normalize({ ...(fixture as unknown as Raw), pages: null }, () => '/x.jpg', '2026-10-20', () => {});
assert.equal(withoutPages.pages.length, 0);
assert.notEqual(withoutPages.settings.policy?.kind, 'page', 'без документов политика — файл из «Настроек» или ничего');

const sections = content.pages.reduce((n, p) => n + p.toc.length, 0);
console.log(`pages: ок (документов ${content.pages.length}, ${sections} ${plural(sections, 'раздел', 'раздела', 'разделов')})`);
