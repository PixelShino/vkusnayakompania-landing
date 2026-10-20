// One line for «Публикация сайта» after a build: what is saved in the admin
// but not on the site (drafts, offers outside their dates) and what on the
// published site is still a placeholder, so the editor sees why a change is
// missing instead of guessing whether an upload went through. Prints nothing
// when all is published and real.
// Одна строка для «Публикации сайта» после сборки: что сохранено в админке, но
// не попало на сайт (черновики, акции вне дат показа), и что на опубликованном
// сайте ещё стоит заглушкой, — чтобы редактор видел, почему правки нет, а не
// гадал, дошла ли загрузка. Ничего не печатает, когда всё опубликовано и настоящее.
//
// Run / Запуск: node scripts/site-report.mjs (DIRECTUS_URL, DIRECTUS_TOKEN из .env)
import { loadEnv } from './env.mjs';
import { QUERIES } from './queries.mjs';
import { placeholderFile } from '../src/lib/content.ts';
import { isLive } from '../src/lib/select.ts';

loadEnv();
const BASE = process.env.DIRECTUS_URL;
const TOKEN = process.env.DIRECTUS_TOKEN;
if (!BASE || !TOKEN) process.exit(0);

const get = async (path) => {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()).data;
};

const [home, directions, afisha, menus, cakes, places] = await Promise.all(
  ['home', 'directions', 'afisha', 'menus', 'cakes', 'places'].map((key) => get(QUERIES[key])),
);
// the catalog may be missing from the schema: then there is nothing to count
// каталога может не быть в схеме — тогда и считать нечего
const products = await get(QUERIES.products).catch(() => []);
// the same for catering: before `schema apply` its collections are not there
// то же для кейтеринга: до `schema apply` его коллекций нет
const [cateringPage, cateringFormats] = await Promise.all([
  get(QUERIES.catering_page).catch(() => null),
  get(QUERIES.catering_formats).catch(() => []),
]);

// read only for the count of drafts below; missing ones count as empty
// нужны только для счёта черновиков ниже; недоступные считаются пустыми
const [promos, categories, faq, pages] = await Promise.all([
  get(QUERIES.promos).catch(() => []),
  get(QUERIES.product_categories).catch(() => []),
  get(QUERIES.catering_faq).catch(() => []),
  get(QUERIES.pages).catch(() => []),
]);

const published = (items) => items.filter((item) => !item.status || item.status === 'published');
const stub = (file) => Boolean(file) && placeholderFile(file);

// label → how many placeholders are still visible in that block
// подпись блока → сколько заглушек в нём ещё видно
const left = [
  ['главная', [home?.hero_image].filter(stub).length],
  ['направления', published(directions).map((d) => d.photo).filter(stub).length],
  ['афиша', published(afisha).map((a) => a.poster).filter(stub).length],
  ['меню', published(menus).map((m) => m.file).filter(stub).length],
  ['торты', published(cakes).map((c) => c.photo).filter(stub).length],
  ['фото точек', places.flatMap((p) => p.gallery ?? []).map((g) => g.directus_files_id).filter(stub).length],
  ['фото направлений', directions.flatMap((d) => d.gallery ?? []).map((g) => g.directus_files_id).filter(stub).length],
  // a dish with no photo at all stands as a plate on the catalog page too
  // блюдо вовсе без фото тоже стоит плашкой на странице каталога
  ['блюда без фото', published(products).filter((p) => !p.photo || stub(p.photo)).length],
  // a catering format without a photo is a plate on /catering/ and on its own spread
  // формат кейтеринга без фото — плашка на /catering/ и на своём развороте
  ['форматы кейтеринга без фото', published(cateringFormats).filter((f) => !f.photo || stub(f.photo)).length],
  [
    'фото кейтеринга',
    [cateringPage?.hero_image, ...(cateringPage?.gallery ?? []).map((g) => g.directus_files_id)].filter(stub).length,
  ],
].filter(([, n]) => n > 0);

const plural = (n, [one, few, many]) => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return many;
  if (n % 10 === 1) return one;
  return [2, 3, 4].includes(n % 10) ? few : many;
};
// «2 блюда («Корпусная малина», «Наполеон»)»: up to three names, so the editor
// finds the very record; more than that is a count
// «2 блюда («Корпусная малина», «Наполеон»)»: до трёх названий — редактор
// находит ту самую запись; больше — только число
const named = (items, words, title) => {
  const names = items.length <= 3 ? items.map(title).filter(Boolean).map((t) => `«${t.length > 40 ? `${t.slice(0, 39)}…` : t}»`) : [];
  return `${items.length} ${plural(items.length, words)}${names.length ? ` (${names.join(', ')})` : ''}`;
};
const title = (item) => item.title ?? item.question ?? null;
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Samara' }).format(new Date());

// a draft is the usual «I added it and it is not on the site»: the status
// defaults to «Черновик» in most collections
// черновик — обычная причина «добавила, а на сайте нет»: в большинстве
// коллекций статус по умолчанию «Черновик»
const drafts = [
  [products, ['блюдо', 'блюда', 'блюд']],
  [categories, ['раздел каталога', 'раздела каталога', 'разделов каталога']],
  [cakes, ['торт', 'торта', 'тортов']],
  [promos, ['акция', 'акции', 'акций']],
  [afisha, ['событие афиши', 'события афиши', 'событий афиши']],
  [menus, ['меню', 'меню', 'меню']],
  [cateringFormats, ['формат кейтеринга', 'формата кейтеринга', 'форматов кейтеринга']],
  [faq, ['вопрос кейтеринга', 'вопроса кейтеринга', 'вопросов кейтеринга']],
  [pages, ['документ', 'документа', 'документов']],
]
  .map(([items, words]) => [items.filter((item) => item.status === 'draft'), words])
  .filter(([items]) => items.length)
  .map(([items, words]) => named(items, words, title));
// published, but today is outside «показывать с / по» — the same rule as the site
// опубликовано, но сегодня вне «показывать с / по» — то же правило, что у сайта
const waiting = [
  [promos, ['акция', 'акции', 'акций']],
  [afisha, ['событие афиши', 'события афиши', 'событий афиши']],
]
  .map(([items, words]) => [items.filter((item) => item.status === 'published' && !isLive(item, today)), words])
  .filter(([items]) => items.length)
  .map(([items, words]) => named(items, words, title));

const lines = [
  drafts.length ? `Не опубликовано, черновики: ${drafts.join(', ')}.` : null,
  waiting.length ? `Вне дат показа: ${waiting.join(', ')}.` : null,
  left.length ? `Осталось заменить заглушки: ${left.map(([name, n]) => `${name} — ${n}`).join(', ')}.` : null,
].filter(Boolean);
if (lines.length) console.log(lines.join(' '));
