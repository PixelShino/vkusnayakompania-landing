// Directus → src/data/fixture.json + src/data/fixture-files/.
// The fixture feeds `pnpm dev` and tests when Directus is not reachable.
// Directus → фикстура: JSON с контентом и папка файлов. Кормит `pnpm dev`
// и тесты, когда Directus недоступен.
//
// Run / Запуск: pnpm fixture  (needs DIRECTUS_URL, DIRECTUS_TOKEN in .env)
import fs from 'node:fs/promises';
import { loadEnv } from './env.mjs';
import { OPTIONAL, QUERIES, docTarget, fileExt } from './queries.mjs';

loadEnv();
const BASE = process.env.DIRECTUS_URL;
const TOKEN = process.env.DIRECTUS_TOKEN;
if (!BASE || !TOKEN) throw new Error('нужны DIRECTUS_URL и DIRECTUS_TOKEN в .env');

const get = async (path, optional = false) => {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  // the catalog may be absent from the schema: the fixture then has none
  // каталога может не быть в схеме — тогда его нет и в фикстуре
  if (!r.ok && optional) return [];
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${await r.text()}`);
  return (await r.json()).data;
};

const fixture = { exportedAt: new Date().toISOString() };
for (const [key, path] of Object.entries(QUERIES)) fixture[key] = await get(path, OPTIONAL.has(key));

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

// Dish photos go into git by the hundred: a 600 px copy is enough for the
// fixture's cards and dialog and keeps the repository light. The fixture then
// states the copy's size, so the page cuts nothing it does not have.
// Фото блюд ложатся в git сотнями: копии 600 px фикстуре хватает на карточки
// и окно блюда, а репозиторий остаётся лёгким. Фикстура при этом называет
// размер копии, чтобы страница не резала того, чего нет.
const DISH_SIDE = 600;
const dishes = new Set((fixture.products ?? []).map((p) => p.photo?.id).filter(Boolean));
const FORMAT = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' };
// The catering photos come from the old site at up to 2560 px and 400-800 KB
// a frame: 1600 px is more than any of its frames asks for, and a JPEG is
// re-encoded even at its own size (500 px frames weighed 400 KB). Cut-outs in
// PNG/WebP keep their transparency and are only shrunk when too large.
// Фото кейтеринга пришли со старого сайта до 2560 px и по 400-800 КБ на кадр:
// 1600 px больше, чем просит любой его кадр, а JPEG пережимается и в своём
// размере (кадры в 500 px весили по 400 КБ). Вырезки в PNG/WebP сохраняют
// прозрачность и ужимаются, только если велики.
const CATERING_SIDE = 1600;
const cateringPhotos = new Set(
  [
    fixture.catering_page?.hero_image,
    fixture.catering_page?.request_image,
    ...(fixture.catering_page?.gallery ?? []).map((g) => g.directus_files_id),
    ...(Array.isArray(fixture.catering_formats) ? fixture.catering_formats : []).map((f) => f.photo),
  ]
    .filter(Boolean)
    .map((f) => f.id),
);
// the side to shrink a file to, or 0 to take it as it is
// до какой стороны ужать файл, или 0 — брать как есть
const shrinkTo = (f) => {
  if (!FORMAT[fileExt(f)]) return 0;
  const side = Math.max(f.width ?? 0, f.height ?? 0);
  if (dishes.has(f.id)) return side > DISH_SIDE ? DISH_SIDE : 0;
  if (cateringPhotos.has(f.id)) return side > CATERING_SIDE || FORMAT[fileExt(f)] === 'jpg' ? CATERING_SIDE : 0;
  return 0;
};

await fs.rm('src/data/fixture-files', { recursive: true, force: true });
await fs.mkdir('src/data/fixture-files', { recursive: true });
for (const f of files.values()) {
  // documents land under the name the page links to; photos keep their extension
  // документы ложатся под именем, на которое ссылается страница; фото со своим расширением
  const side = docs.has(f.id) ? 0 : shrinkTo(f);
  const quality = dishes.has(f.id) ? 72 : 78;
  const { name, asset } = docs.has(f.id)
    ? docTarget(f)
    : {
        name: `${f.id}.${fileExt(f)}`,
        asset: side
          ? `/assets/${f.id}?width=${side}&height=${side}&fit=inside&withoutEnlargement=true&format=${FORMAT[fileExt(f)]}&quality=${quality}`
          : `/assets/${f.id}`,
      };
  const r = await fetch(`${BASE}${asset}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`asset ${f.id} → ${r.status}`);
  await fs.writeFile(`src/data/fixture-files/${name}`, Buffer.from(await r.arrayBuffer()));
  if (side && Math.max(f.width, f.height) > side) {
    const scale = side / Math.max(f.width, f.height);
    const [width, height] = [Math.round(f.width * scale), Math.round(f.height * scale)];
    // the same file object may sit in several places of the payload: all of them get the new size
    // один и тот же объект файла может лежать в нескольких местах ответа — новый размер получают все
    const patch = (v) => {
      if (Array.isArray(v)) v.forEach(patch);
      else if (v && typeof v === 'object') {
        if (v.id === f.id && v.filename_download) Object.assign(v, { width, height });
        Object.values(v).forEach(patch);
      }
    };
    patch(fixture);
  }
}
await fs.writeFile('src/data/fixture.json', JSON.stringify(fixture, null, 2) + '\n');
console.log(`fixture: ${Object.keys(QUERIES).length} коллекций, ${files.size} файлов`);
