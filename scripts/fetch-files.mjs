// Documents from Directus → public/media/<id>.<ext>, so the page links to its
// own domain instead of an URL with the token in it. Without Directus the same
// files are copied from the fixture. Directus files are always re-fetched: a
// replaced PDF keeps its id, so a cached copy would go stale; fixture copies are skipped.
// Документы из Directus в public/media/<id>.<ext>: страница ссылается на свой
// домен, а не на адрес с токеном. Без Directus те же файлы копируются из
// фикстуры. Из Directus качаем всегда: заменённый PDF сохраняет id, и кешированная
// копия устарела бы; копии из фикстуры пропускаются, если уже есть.
//
// Run / Запуск: pnpm files (шаг prebuild)
import fs from 'node:fs/promises';
import { loadEnv } from './env.mjs';
import { QUERIES } from './queries.mjs';

loadEnv();
const BASE = process.env.DIRECTUS_URL;
const TOKEN = process.env.DIRECTUS_TOKEN;
const OUT = 'public/media';
const FIXTURE_FILES = 'src/data/fixture-files';

const get = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${await r.text()}`);
  return (await r.json()).data;
};

const source = BASE && TOKEN;
const [settings, menus] = source
  ? await Promise.all([get(QUERIES.settings), get(QUERIES.menus)])
  : await fs
      .readFile('src/data/fixture.json', 'utf8')
      .then(JSON.parse)
      .then((fixture) => [fixture.settings, fixture.menus]);

// policy, offer and every menu PDF; a missing file is just an empty field
// политика, оферта и PDF каждого меню; незаполненное поле — просто пусто
const files = [settings?.policy_file, settings?.offer_file, ...menus.map((m) => m.file)].filter(
  Boolean,
);

await fs.mkdir(OUT, { recursive: true });
let saved = 0;
for (const file of files) {
  const name = `${file.id}.${file.filename_download.split('.').pop().toLowerCase()}`;
  const dest = `${OUT}/${name}`;
  if (!source && (await fs.access(dest).then(() => true, () => false))) continue;
  if (source) {
    const r = await fetch(`${BASE}/assets/${file.id}?access_token=${TOKEN}`);
    if (!r.ok) throw new Error(`asset ${name} (${file.title ?? file.id}) → ${r.status}`);
    await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
  } else {
    await fs.copyFile(`${FIXTURE_FILES}/${name}`, dest).catch(() => {
      throw new Error(`нет файла ${FIXTURE_FILES}/${name} — запусти pnpm fixture`);
    });
  }
  saved += 1;
}
console.log(
  `files: ${files.length} документов из ${source ? 'Directus' : 'фикстуры'}, скачано ${saved}`,
);
