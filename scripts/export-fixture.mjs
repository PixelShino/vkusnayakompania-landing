// Directus → src/data/fixture.json + src/data/fixture-files/.
// The fixture feeds `pnpm dev` and tests when Directus is not reachable.
// Directus → фикстура: JSON с контентом и папка файлов. Кормит `pnpm dev`
// и тесты, когда Directus недоступен.
//
// Run / Запуск: pnpm fixture  (needs DIRECTUS_URL, DIRECTUS_TOKEN in .env)
import fs from 'node:fs/promises';
import { loadEnv } from './env.mjs';

loadEnv();
const BASE = process.env.DIRECTUS_URL;
const TOKEN = process.env.DIRECTUS_TOKEN;
if (!BASE || !TOKEN) throw new Error('нужны DIRECTUS_URL и DIRECTUS_TOKEN в .env');

// fields that describe a file; the same list is used by src/lib/content.ts
// поля файла; тот же список использует src/lib/content.ts
export const FILE_FIELDS = ['id', 'filename_download', 'title', 'alt', 'width', 'height', 'type'];
const img = (f) => FILE_FIELDS.map((x) => `${f}.${x}`).join(',');
const q = (fields, extra = '') => `fields=${fields}&limit=-1${extra}`;

const get = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${await r.text()}`);
  return (await r.json()).data;
};

// one request per collection; relations expanded to the fields the site reads
// по запросу на коллекцию; связи раскрыты до полей, которые читает сайт
export const QUERIES = {
  settings: `/items/settings?${q(`*,${img('policy_file')},${img('offer_file')}`)}`,
  home: `/items/home?${q(`*,${img('hero_image')},${img('og_image')},${img('app_screenshot')}`)}`,
  places: `/items/places?${q(`*,gallery.id,gallery.sort,gallery.caption,${img('gallery.directus_files_id')}`, '&sort=id&deep[gallery][_sort]=sort')}`,
  directions: `/items/directions?${q(`*,${img('photo')}`, '&sort=sort')}`,
  afisha: `/items/afisha?${q(`*,${img('poster')}`, '&sort=date')}`,
  promos: `/items/promos?${q('*', '&sort=sort')}`,
  menus: `/items/menus?${q(`*,${img('file')}`)}`,
  cakes: `/items/cakes?${q(`*,${img('photo')}`, '&sort=sort')}`,
};

const fixture = { exportedAt: new Date().toISOString() };
for (const [key, path] of Object.entries(QUERIES)) fixture[key] = await get(path);

// every file object anywhere in the payload is downloaded once by id
// каждый объект файла в ответе скачивается один раз по id
const files = new Map();
const walk = (v) => {
  if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === 'object') {
    if (v.filename_download && v.id) files.set(v.id, v);
    Object.values(v).forEach(walk);
  }
};
walk(fixture);

await fs.rm('src/data/fixture-files', { recursive: true, force: true });
await fs.mkdir('src/data/fixture-files', { recursive: true });
for (const f of files.values()) {
  const ext = f.filename_download.split('.').pop().toLowerCase();
  const r = await fetch(`${BASE}/assets/${f.id}?access_token=${TOKEN}`);
  if (!r.ok) throw new Error(`asset ${f.id} → ${r.status}`);
  await fs.writeFile(`src/data/fixture-files/${f.id}.${ext}`, Buffer.from(await r.arrayBuffer()));
}
await fs.writeFile('src/data/fixture.json', JSON.stringify(fixture, null, 2) + '\n');
console.log(`fixture: ${Object.keys(QUERIES).length} коллекций, ${files.size} файлов`);
