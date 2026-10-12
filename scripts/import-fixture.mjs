// Loads src/data/fixture.json (+ fixture-files) into an empty Directus:
// the starter content for a fresh VPS. Existing records are left alone.
// Заливает фикстуру в пустой Directus: стартовый контент для нового VPS.
// Существующие записи не трогает.
//
// Run / Запуск: DIRECTUS_URL=… DIRECTUS_ADMIN_TOKEN=… node scripts/import-fixture.mjs
import fs from 'node:fs';
import { loadEnv } from './env.mjs';

loadEnv();
const BASE = process.env.DIRECTUS_URL ?? 'http://localhost:8055';
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
if (!TOKEN) throw new Error('DIRECTUS_ADMIN_TOKEN обязателен');
const H = { Authorization: `Bearer ${TOKEN}` };

const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { ...H, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : (await r.json()).data;
};
const exists = async (collection, field, value) =>
  (await api('GET', `/items/${collection}?filter[${field}][_eq]=${encodeURIComponent(value)}&limit=1`))[0];

const fixture = JSON.parse(fs.readFileSync('src/data/fixture.json', 'utf8'));

// files: fixture id → new id; reuse by filename so re-runs do not duplicate
// файлы: id фикстуры → новый id; по имени файла, чтобы повтор не дублировал
const fileIds = new Map();
async function file(f) {
  if (!f) return null;
  if (fileIds.has(f.id)) return fileIds.get(f.id);
  const found = await api('GET', `/files?filter[filename_download][_eq]=${encodeURIComponent(f.filename_download)}&limit=1`);
  if (found[0]) { fileIds.set(f.id, found[0].id); return found[0].id; }
  const ext = f.filename_download.split('.').pop().toLowerCase();
  const local = `src/data/fixture-files/${f.id}.${ext}`;
  if (!fs.existsSync(local)) throw new Error(`нет файла ${local} — запусти pnpm fixture там, где есть контент`);
  const fd = new FormData();
  fd.append('title', f.title ?? f.filename_download);
  if (f.alt) fd.append('alt', f.alt);
  fd.append('file', new Blob([fs.readFileSync(local)], { type: f.type ?? 'application/octet-stream' }), f.filename_download);
  const r = await fetch(`${BASE}/files`, { method: 'POST', headers: H, body: fd });
  if (!r.ok) throw new Error(`upload ${f.filename_download} → ${r.status}: ${await r.text()}`);
  const { data } = await r.json();
  fileIds.set(f.id, data.id);
  console.log(`+ файл ${f.filename_download}`);
  return data.id;
}

const strip = ({ id, date_updated, ...rest }) => rest;

// singletons: PATCH creates the row when missing / одиночные: PATCH создаёт запись
const s = fixture.settings;
await api('PATCH', '/items/settings', { ...strip(s), policy_file: await file(s.policy_file), offer_file: await file(s.offer_file) });
const h = fixture.home;
await api('PATCH', '/items/home', { ...strip(h), hero_image: await file(h.hero_image), og_image: await file(h.og_image), app_screenshot: await file(h.app_screenshot) });
console.log('= настройки и главная');

const placeIds = new Map();
for (const p of fixture.places) {
  const { gallery, ...rest } = strip(p);
  const found = await exists('places', 'name', p.name);
  const id = found ? found.id : (await api('POST', '/items/places', rest)).id;
  placeIds.set(p.id, id);
  if (!found) {
    for (const g of gallery ?? []) {
      await api('POST', '/items/places_files', { places_id: id, directus_files_id: await file(g.directus_files_id), sort: g.sort, caption: g.caption });
    }
  }
}
console.log(`= точки: ${placeIds.size}`);

const dirIds = new Map();
for (const d of fixture.directions) {
  const { gallery, ...rest } = strip(d);
  const found = await exists('directions', 'key', d.key);
  const id = found ? found.id : (await api('POST', '/items/directions', { ...rest, photo: await file(d.photo), place: d.place ? placeIds.get(d.place) : null })).id;
  dirIds.set(d.id, id);
  // the gallery goes with a new direction only, as with places: an existing one keeps the editors' photos
  // галерея — только вместе с новым направлением, как у точек: у существующего остаются фото редакторов
  if (!found) {
    for (const g of gallery ?? []) {
      await api('POST', '/items/directions_files', { directions_id: id, directus_files_id: await file(g.directus_files_id), sort: g.sort, caption: g.caption });
    }
  }
}
console.log(`= направления: ${dirIds.size}`);

for (const c of fixture.cakes) {
  if (await exists('cakes', 'title', c.title)) continue;
  await api('POST', '/items/cakes', { ...strip(c), photo: await file(c.photo) });
}
for (const a of fixture.afisha) {
  if (await exists('afisha', 'title', a.title)) continue;
  await api('POST', '/items/afisha', { ...strip(a), poster: await file(a.poster), place: placeIds.get(a.place) });
}
for (const p of fixture.promos) {
  if (await exists('promos', 'title', p.title)) continue;
  await api('POST', '/items/promos', { ...strip(p), place: p.place ? placeIds.get(p.place) : null });
}
for (const m of fixture.menus) {
  if (await exists('menus', 'title', m.title)) continue;
  await api('POST', '/items/menus', { ...strip(m), file: await file(m.file), direction: dirIds.get(m.direction) });
}
// Catering, when the fixture has it and the schema already does: the page only
// while it is still empty (an editor's text is never overwritten), formats by
// slug, steps by title, questions by wording. The usual source is
// `import-catering.mjs` from the old site; this is the way without it.
// Кейтеринг — если он есть в фикстуре и уже есть в схеме: страница только
// пока пустая (текст редактора не перезаписывается), форматы по slug, шаги по
// заголовку, вопросы по формулировке. Обычный источник — `import-catering.mjs`
// со старого сайта; это путь без него.
const cp = fixture.catering_page;
const cateringReady = await api('GET', '/items/catering_page').then(() => true, () => false);
if (cp && !Array.isArray(cp) && cateringReady) {
  const current = await api('GET', '/items/catering_page');
  if (!current?.hero_title) {
    const { gallery, ...rest } = strip(cp);
    await api('PATCH', '/items/catering_page', {
      ...rest,
      hero_image: await file(cp.hero_image),
      request_image: await file(cp.request_image),
    });
    for (const g of gallery ?? []) {
      await api('POST', '/items/catering_page_files', {
        catering_page_id: current?.id ?? 1,
        directus_files_id: await file(g.directus_files_id),
        sort: g.sort,
        caption: g.caption,
      });
    }
  }
  const formatIds = new Map();
  for (const f of fixture.catering_formats ?? []) {
    const found = await exists('catering_formats', 'slug', f.slug);
    formatIds.set(f.id, found ? found.id : (await api('POST', '/items/catering_formats', { ...strip(f), photo: await file(f.photo) })).id);
  }
  for (const step of fixture.catering_steps ?? []) {
    if (await exists('catering_steps', 'title', step.title)) continue;
    await api('POST', '/items/catering_steps', strip(step));
  }
  for (const q of fixture.catering_faq ?? []) {
    if (await exists('catering_faq', 'question', q.question)) continue;
    await api('POST', '/items/catering_faq', { ...strip(q), format: q.format ? (formatIds.get(q.format) ?? null) : null });
  }
  console.log(`= кейтеринг: форматов ${formatIds.size}, вопросов ${(fixture.catering_faq ?? []).length}`);
}
console.log('import: готово');
