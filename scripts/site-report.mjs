// One line for «Публикация сайта» after a build: what on the published site is
// still a placeholder, so the editor sees what is left to replace instead of
// guessing whether an upload went through. Prints nothing when all is real.
// Одна строка для «Публикации сайта» после сборки: что на опубликованном сайте
// ещё стоит заглушкой, чтобы редактор видел, что осталось заменить, а не
// гадал, дошла ли загрузка. Ничего не печатает, когда всё настоящее.
//
// Run / Запуск: node scripts/site-report.mjs (DIRECTUS_URL, DIRECTUS_TOKEN из .env)
import { loadEnv } from './env.mjs';
import { QUERIES } from './queries.mjs';
import { placeholderFile } from '../src/lib/content.ts';

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
].filter(([, n]) => n > 0);

if (left.length) {
  console.log(`Осталось заменить заглушки: ${left.map(([name, n]) => `${name} — ${n}`).join(', ')}.`);
}
