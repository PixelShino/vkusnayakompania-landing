// IndexNow for Yandex: after a build, the pages that changed since the last
// run are reported in one POST, so the search engine re-reads them within
// minutes instead of waiting for its own crawl. A page is «changed» when the
// hash of its HTML (and its `lastmod`, if the sitemap has one) differs from
// the previous run; a page that left the sitemap or became `noindex` is
// reported too, so it is re-read and dropped. A `noindex` page (the account, a
// preview build) is never sent. The network never fails the build: an error is
// a warning, the state is kept, and the same pages go with the next build.
// IndexNow для Яндекса: после сборки страницы, изменившиеся с прошлого
// запуска, уходят одним POST, и поисковик перечитывает их за минуты, а не ждёт
// своего обхода. Страница «изменилась», если хэш её HTML (и `lastmod`, если он
// есть в карте сайта) отличается от прошлого запуска; страница, пропавшая из
// карты или ставшая `noindex`, тоже уходит — чтобы её перечитали и убрали.
// Страница с `noindex` (кабинет, превью-сборка) не отправляется никогда. Сеть
// сборку не роняет: ошибка — предупреждение, состояние не трогается, и те же
// страницы уйдут со следующей сборкой.
//
// Run / Запуск:
//   node scripts/indexnow.mjs <dist> <site> [--state <file>] [--dry-run]
//   node scripts/indexnow.mjs dist https://vkus-com.ru --dry-run   # список без отправки
// <dist> — the built site; <site> — its public root (`https://vkus-com.ru`).
// The key: `INDEXNOW_KEY` or the file `public/<key>.txt` holding the key
// itself (it is served at `<site>/<key>.txt`, Yandex checks it there).
// The state: `--state` or `<dist>/../.indexnow-state.json`.
// <dist> — собранный сайт; <site> — его публичный корень (`https://vkus-com.ru`).
// Ключ: `INDEXNOW_KEY` или файл `public/<ключ>.txt` с самим ключом внутри (он
// отдаётся по адресу `<site>/<ключ>.txt`, там его и проверяет Яндекс).
// Состояние: `--state` или `<dist>/../.indexnow-state.json`.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENDPOINT = 'https://yandex.com/indexnow';
/** протокол разрешает ключ из латиницы, цифр и дефиса, от 8 до 128 знаков */
const KEY = /^[a-zA-Z0-9-]{8,128}$/;
/** не больше 10 000 адресов в одном запросе */
const MAX_URLS = 10_000;

const PLURAL = new Intl.PluralRules('ru-RU');
/** «1 адрес», «2 адреса», «10 адресов». */
export const addresses = (n) => `${n} ${{ one: 'адрес', few: 'адреса' }[PLURAL.select(n)] ?? 'адресов'}`;

const XML = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_all, name) => XML[name]);

/** `<loc>` и `<lastmod>` каждого `<url>` карты сайта. */
export const parseSitemap = (xml) =>
  [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)]
    .map(([, body]) => ({
      loc: decodeXml(body.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/)?.[1] ?? ''),
      lastmod: body.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/)?.[1],
    }))
    .filter((entry) => entry.loc);

/** Корень сайта: адрес с базой и слэшем на конце, без запроса и якоря. */
export const siteRoot = (site) => {
  const root = new URL(site);
  root.pathname = root.pathname.replace(/\/?$/, '/');
  root.search = '';
  root.hash = '';
  return root;
};

/** Адрес сайта → файл сборки: `/catalog/` → `dist/catalog/index.html`; чужой адрес — `null`. */
export const localPath = (dist, root, loc) => {
  let url;
  try {
    url = new URL(loc);
  } catch {
    return null;
  }
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return null;
  const rel = decodeURIComponent(url.pathname.slice(root.pathname.length));
  if (rel.split('/').includes('..')) return null;
  const file = path.join(dist, rel);
  if (rel === '' || rel.endsWith('/')) return path.join(file, 'index.html');
  if (path.extname(rel)) return file;
  return fs.existsSync(`${file}.html`) ? `${file}.html` : path.join(file, 'index.html');
};

/** Все `<url>` карты: файлы из `sitemap-index.xml`, без него — `sitemap-0.xml`. */
export const readSitemaps = (dist, root) => {
  const index = path.join(dist, 'sitemap-index.xml');
  let files = [];
  if (fs.existsSync(index)) {
    files = [...fs.readFileSync(index, 'utf8').matchAll(/<sitemap>[\s\S]*?<loc>\s*([\s\S]*?)\s*<\/loc>/g)]
      .map(([, loc]) => localPath(dist, root, decodeXml(loc)))
      .filter((file) => file && fs.existsSync(file));
  }
  const zero = path.join(dist, 'sitemap-0.xml');
  if (!files.length && fs.existsSync(zero)) files = [zero];
  return files.flatMap((file) => parseSitemap(fs.readFileSync(file, 'utf8')));
};

/** `<meta name="robots|yandex" content="…noindex…">` в любом порядке атрибутов. */
export const isNoindex = (html) =>
  [...html.matchAll(/<meta\b[^>]*>/gi)].some(
    ([tag]) => /\bname\s*=\s*["']?(?:robots|yandex)["'\s>/]/i.test(tag) && /\bcontent\s*=\s*["'][^"']*\bnoindex\b/i.test(tag),
  );

/** Отпечаток страницы: `lastmod` из карты и хэш HTML. */
export const fingerprint = (html, lastmod) =>
  createHash('sha256').update(`${lastmod ?? ''}\n${html}`).digest('hex').slice(0, 32);

/** Файлы `<ключ>.txt` с самим ключом внутри — так IndexNow подтверждает владельца. */
const keyFiles = (dir) => {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.txt') && KEY.test(name.slice(0, -4)))
      .filter((name) => fs.readFileSync(path.join(dir, name), 'utf8').trim() === name.slice(0, -4))
      .sort()
      .map((name) => name.slice(0, -4));
  } catch {
    return [];
  }
};

/**
 * The key and where Yandex will check it. The key file must be in the build:
 * a key Yandex cannot fetch from the site gets a 403, so it is not sent.
 * Ключ и адрес, где Яндекс его проверит. Файл ключа обязан быть в сборке:
 * ключ, который Яндекс не скачает с сайта, получит 403 — такой не отправляется.
 */
export const findKey = (dist, env = process.env) => {
  const fromEnv = env.INDEXNOW_KEY?.trim();
  if (fromEnv) {
    if (!KEY.test(fromEnv)) return { error: 'INDEXNOW_KEY: ключ — от 8 до 128 латинских букв, цифр и дефисов' };
    return keyFiles(dist).includes(fromEnv)
      ? { key: fromEnv }
      : { error: `INDEXNOW_KEY: в сборке нет файла ${fromEnv}.txt с этим ключом — положите его в public/` };
  }
  const [key] = keyFiles(dist);
  if (key) return { key };
  const inPublic = keyFiles(path.join(dist, '..', 'public'));
  return {
    error: inPublic.length
      ? `файл ключа ${inPublic[0]}.txt есть в public/, но не в сборке ${dist}`
      : 'ключ не найден: нужен public/<ключ>.txt с ключом внутри или INDEXNOW_KEY',
  };
};

const readState = (file, host) => {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    // the state of another host (a preview build) is not this site's past
    // состояние другого хоста (превью) — не прошлое этого сайта
    if (state?.host !== host || !state.pages || typeof state.pages !== 'object') return {};
    // a hand-edited or broken entry is dropped, not fatal
    // запись, поправленная руками или битая, выбрасывается, а не роняет запуск
    return Object.fromEntries(
      Object.entries(state.pages).filter(([url, sig]) => typeof sig === 'string' && URL.canParse(url) && new URL(url).host === host),
    );
  } catch {
    return {};
  }
};

const writeState = (file, host, pages) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ host, updated: new Date().toISOString(), pages }, null, 2)}\n`);
  fs.renameSync(tmp, file);
};

/**
 * What to send: the indexable pages of the build with their fingerprints and,
 * against the previous state, the new or changed ones and the ones gone.
 * Что отправлять: индексируемые страницы сборки с отпечатками и, по сравнению
 * с прошлым состоянием, новые или изменённые и пропавшие.
 */
export const plan = (dist, root, previous) => {
  const pages = {};
  let hidden = 0;
  let missing = 0;
  for (const { loc, lastmod } of readSitemaps(dist, root)) {
    const file = localPath(dist, root, loc);
    if (!file || !fs.existsSync(file)) {
      missing += 1;
      continue;
    }
    const html = fs.readFileSync(file, 'utf8');
    if (isNoindex(html)) {
      hidden += 1;
      continue;
    }
    pages[new URL(loc).href] = fingerprint(html, lastmod);
  }
  const changed = Object.keys(pages).filter((url) => previous[url] !== pages[url]);
  const removed = Object.keys(previous).filter((url) => !(url in pages));
  return { pages, changed, removed, hidden, missing };
};

const HINTS = {
  400: 'неверный запрос',
  403: 'ключ не подтверждён: Яндекс не нашёл файл ключа на сайте',
  422: 'адреса не принадлежат хосту или ключ не совпадает',
  429: 'слишком много запросов, повторю со следующей сборкой',
};

/**
 * One run. Never throws on the network: returns what happened and prints one
 * line «IndexNow: N адресов → код».
 * Один запуск. Из-за сети не бросает: возвращает, что произошло, и печатает
 * строку «IndexNow: N адресов → код».
 */
export const run = async ({
  dist,
  site,
  state,
  dryRun = false,
  fetch = globalThis.fetch,
  env = process.env,
  log = console.log,
  warn = console.warn,
  endpoint = ENDPOINT,
  timeoutMs = 20_000,
}) => {
  const root = siteRoot(site);
  const stateFile = state ?? path.join(dist, '..', '.indexnow-state.json');
  if (!fs.existsSync(dist)) {
    warn(`IndexNow: сборки ${dist} нет — пропускаю`);
    return { status: 'skipped' };
  }
  const previous = readState(stateFile, root.host);
  const { pages, changed, removed, hidden, missing } = plan(dist, root, previous);
  if (!Object.keys(pages).length && !removed.length) {
    log(`IndexNow: индексируемых страниц нет${hidden ? ` (noindex: ${hidden})` : ''} — нечего отправлять`);
    return { status: 'nothing', urls: [] };
  }
  if (missing) warn(`IndexNow: ${addresses(missing)} карты сайта без файла в сборке — пропускаю`);
  const urls = [...changed, ...removed].slice(0, MAX_URLS);
  if (!urls.length) {
    log('IndexNow: изменений нет');
    return { status: 'nothing', urls: [] };
  }
  const { key, error } = findKey(dist, env);
  if (!key) {
    warn(`IndexNow: ${error} — пропускаю`);
    return { status: 'no-key', urls };
  }
  const keyLocation = new URL(`${key}.txt`, root).href;
  const body = { host: root.host, key, keyLocation, urlList: urls };
  const detail = `новых и изменённых ${changed.length}, пропавших ${removed.length}`;

  if (dryRun) {
    log(`IndexNow (проверка, без отправки): ${addresses(urls.length)} (${detail}), ключ ${keyLocation}`);
    for (const url of urls) log(`  ${url}`);
    return { status: 'dry-run', urls, body };
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    warn(`IndexNow: ${addresses(urls.length)} → не отправлено, сеть: ${err?.cause?.code ?? err?.cause?.message ?? err?.message ?? err}; повторю со следующей сборкой`);
    return { status: 'network', urls, body };
  }
  log(`IndexNow: ${addresses(urls.length)} → ${response.status} (${detail})`);
  if (response.status === 200 || response.status === 202) {
    writeState(stateFile, root.host, pages);
    return { status: 'sent', code: response.status, urls, body };
  }
  const text = await response.text().catch(() => '');
  warn(`IndexNow: ${HINTS[response.status] ?? 'ответ не принят'}${text ? ` — ${text.replace(/\s+/g, ' ').trim().slice(0, 300)}` : ''}`);
  return { status: 'rejected', code: response.status, urls, body };
};

/** `<dist> <site> [--state <file>] [--dry-run]` → параметры запуска; ошибка — `null`. */
export const parseArgs = (argv) => {
  const args = { dryRun: false };
  const rest = [];
  let badState = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--state' || argv[i].startsWith('--state=')) {
      const value = argv[i] === '--state' ? argv[++i] : argv[i].slice('--state='.length);
      // `--state` without a file (or followed by another flag) is a mistake, not «default»
      // `--state` без файла (или со следующим флагом) — ошибка, а не «по умолчанию»
      if (!value || value.startsWith('--')) badState = true;
      else args.state = value;
    } else rest.push(argv[i]);
  }
  [args.dist, args.site] = rest;
  if (!args.dist || !args.site || rest.length > 2 || badState) return null;
  try {
    new URL(args.site);
  } catch {
    return null;
  }
  return args;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('использование: node scripts/indexnow.mjs <dist> <site> [--state <file>] [--dry-run]');
    process.exit(2);
  }
  // whatever happens here, the build has already published the site
  // что бы ни случилось здесь, сборка уже опубликовала сайт
  try {
    // INDEXNOW_ENDPOINT — only for checks: a closed local port instead of Yandex
    // INDEXNOW_ENDPOINT — только для проверок: закрытый локальный порт вместо Яндекса
    await run({ ...args, endpoint: process.env.INDEXNOW_ENDPOINT || ENDPOINT });
  } catch (err) {
    console.warn(`IndexNow: сбой — ${err?.message ?? err}`);
  }
  process.exit(0);
}
