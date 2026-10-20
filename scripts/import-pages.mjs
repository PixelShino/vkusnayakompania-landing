// The site documents (offer, privacy policy, delivery and payment, requisites)
// from src/data/fixture.json into «Документы» of a Directus, by slug. A missing
// document is created; an existing one is left alone — the owner may have
// edited it — unless `--force` asks to overwrite it with the fixture text.
// Документы сайта (оферта, политика, доставка и оплата, реквизиты) из
// src/data/fixture.json в «Документы» Directus, по адресу страницы. Недостающий
// документ заводится; существующий не трогается — владелица могла его
// поправить, — если только `--force` не просит переписать его текстом фикстуры.
//
// Run / Запуск:
//   DIRECTUS_URL=http://127.0.0.1:8055 DIRECTUS_ADMIN_TOKEN=… node scripts/import-pages.mjs --dry-run
//   node scripts/import-pages.mjs            # завести недостающие
//   node scripts/import-pages.mjs --force    # переписать и существующие (правки в админке пропадут)
//   node scripts/import-pages.mjs --only offer,privacy
import fs from 'node:fs';
import { loadEnv } from './env.mjs';

loadEnv();
const BASE = (process.env.DIRECTUS_URL ?? 'http://127.0.0.1:8055').replace(/\/+$/, '');
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
if (!TOKEN) throw new Error('DIRECTUS_ADMIN_TOKEN обязателен');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');
const onlyArg = args.find((arg) => arg.startsWith('--only'));
const ONLY = onlyArg ? (onlyArg.split('=')[1] ?? args[args.indexOf(onlyArg) + 1] ?? '').split(',').filter(Boolean) : null;

const api = async (method, path, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : (await r.json()).data;
};

// the collection comes with `schema apply`; without it there is nowhere to write
// коллекция приходит со `schema apply`; без неё писать некуда
const collections = (await api('GET', '/collections?limit=-1')).map((c) => c.collection);
if (!collections.includes('pages')) {
  throw new Error('нет коллекции «Документы» (pages): сначала schema apply по directus/snapshot.yaml и сброс кеша схемы');
}

const fixture = JSON.parse(fs.readFileSync(new URL('../src/data/fixture.json', import.meta.url), 'utf8'));
const pages = (fixture.pages ?? []).filter((page) => !ONLY || ONLY.includes(page.slug));
if (!pages.length) throw new Error('в фикстуре нет документов (pages)');

// what is written: the text and its card; the id, the save stamp and the
// owner's status choice stay the target's own (`--force` sets the status too)
// что пишется: текст и его карточка; id, отметка сохранения и выбор статуса
// остаются за целевой базой (`--force` ставит и статус)
const fields = ({ slug, title, description, body, revised, sort, status }) => ({ slug, title, description, body, revised, sort, status });

let created = 0;
let updated = 0;
let kept = 0;
for (const page of pages) {
  const [found] = await api('GET', `/items/pages?filter[slug][_eq]=${encodeURIComponent(page.slug)}&fields=id,status,date_updated&limit=1`);
  if (!found) {
    if (!DRY) await api('POST', '/items/pages', fields(page));
    console.log(`+ ${page.slug} «${page.title}»${DRY ? ' (dry-run)' : ''}`);
    created += 1;
  } else if (FORCE) {
    if (!DRY) await api('PATCH', `/items/pages/${found.id}`, fields(page));
    console.log(`= ${page.slug} «${page.title}» переписан текстом фикстуры${DRY ? ' (dry-run)' : ''}`);
    updated += 1;
  } else {
    console.log(`· ${page.slug} уже есть (${found.status}) — не трогаю; переписать: --force`);
    kept += 1;
  }
}
console.log(`import-pages: заведено ${created}, переписано ${updated}, оставлено ${kept}${DRY ? ' — dry-run, ничего не записано' : ''}`);
