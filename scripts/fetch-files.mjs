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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadEnv } from './env.mjs';
import { QUERIES, docTarget } from './queries.mjs';

const run = promisify(execFile);

// A print-ready PDF (bleeds, 300 dpi photos) weighs 10–20 MB; on a phone that
// is half a minute. Ghostscript resamples images to 200 dpi and re-encodes them
// as JPEG 85: the text stays vector and sharp, the size drops 10–20×. Without
// `gs` on the machine the file is served as uploaded.
// Печатный PDF (вылеты, фото 300 dpi) весит 10–20 МБ, на телефоне это
// полминуты. Ghostscript пересчитывает картинки в 200 dpi и пережимает их в
// JPEG 85: текст остаётся векторным и резким, вес падает в 10–20 раз. Без `gs`
// на машине файл отдаётся как загружен.
const PDF_KEEP_UNDER = 1_500_000;
const shrinkPdf = async (path) => {
  const { size } = await fs.stat(path);
  if (size <= PDF_KEEP_UNDER) return null;
  const tmp = `${path}.tmp`;
  try {
    await run('gs', [
      '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5',
      '-dPDFSETTINGS=/ebook', '-dColorImageResolution=200', '-dGrayImageResolution=200',
      '-dMonoImageResolution=300', '-dJPEGQ=85', '-dDetectDuplicateImages=true',
      `-sOutputFile=${tmp}`, path,
    ]);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    if (error.code === 'ENOENT') return 'нет ghostscript, файл как есть';
    throw new Error(`ghostscript: ${error.stderr || error.message}`);
  }
  const shrunk = (await fs.stat(tmp)).size;
  if (shrunk >= size) {
    await fs.rm(tmp);
    return null;
  }
  await fs.rename(tmp, path);
  return `${Math.round(size / 1024)} → ${Math.round(shrunk / 1024)} КБ`;
};

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
  const { name, asset } = docTarget(file);
  const dest = `${OUT}/${name}`;
  if (!source && (await fs.access(dest).then(() => true, () => false))) continue;
  if (source) {
    const r = await fetch(`${BASE}${asset}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) throw new Error(`asset ${name} (${file.title ?? file.id}) → ${r.status}`);
    await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
    if (name.endsWith('.pdf')) {
      const note = await shrinkPdf(dest);
      if (note) console.log(`files: ${file.title ?? name} — ${note}`);
    }
  } else {
    await fs.copyFile(`${FIXTURE_FILES}/${name}`, dest).catch(() => {
      throw new Error(`нет файла ${FIXTURE_FILES}/${name} — запусти pnpm fixture`);
    });
  }
  saved += 1;
}
// a document that left the admin, or changed its extension, must not ride into
// the next release under its old address
// документ, который убрали из админки или сменил расширение, не должен уехать
// в следующий релиз под старым адресом
const keep = new Set(files.map((file) => docTarget(file).name));
let removed = 0;
for (const name of await fs.readdir(OUT)) {
  if (keep.has(name)) continue;
  await fs.unlink(`${OUT}/${name}`);
  removed += 1;
}
console.log(
  `files: ${files.length} документов из ${source ? 'Directus' : 'фикстуры'}, скачано ${saved}` +
    (removed ? `, убрано старых ${removed}` : ''),
);
