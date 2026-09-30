// Directus → src/data/fixture.json + src/data/fixture-files/.
// The fixture feeds `pnpm dev` and tests when Directus is not reachable.
// Directus → фикстура: JSON с контентом и папка файлов. Кормит `pnpm dev`
// и тесты, когда Directus недоступен.
//
// Run / Запуск: pnpm fixture  (needs DIRECTUS_URL, DIRECTUS_TOKEN in .env)
import fs from 'node:fs/promises';
import { loadEnv } from './env.mjs';
import { QUERIES, docTarget, fileExt } from './queries.mjs';

loadEnv();
const BASE = process.env.DIRECTUS_URL;
const TOKEN = process.env.DIRECTUS_TOKEN;
if (!BASE || !TOKEN) throw new Error('нужны DIRECTUS_URL и DIRECTUS_TOKEN в .env');

const get = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${await r.text()}`);
  return (await r.json()).data;
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
// the documents: policy, offer and menu files / документы: политика, оферта и файлы меню
const docs = new Set(
  [fixture.settings?.policy_file, fixture.settings?.offer_file, ...fixture.menus.map((m) => m.file)]
    .filter(Boolean)
    .map((f) => f.id),
);

await fs.rm('src/data/fixture-files', { recursive: true, force: true });
await fs.mkdir('src/data/fixture-files', { recursive: true });
for (const f of files.values()) {
  // documents land under the name the page links to; photos keep their extension
  // документы ложатся под именем, на которое ссылается страница; фото со своим расширением
  const { name, asset } = docs.has(f.id) ? docTarget(f) : { name: `${f.id}.${fileExt(f)}`, asset: `/assets/${f.id}` };
  const r = await fetch(`${BASE}${asset}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`asset ${f.id} → ${r.status}`);
  await fs.writeFile(`src/data/fixture-files/${name}`, Buffer.from(await r.arrayBuffer()));
}
await fs.writeFile('src/data/fixture.json', JSON.stringify(fixture, null, 2) + '\n');
console.log(`fixture: ${Object.keys(QUERIES).length} коллекций, ${files.size} файлов`);
