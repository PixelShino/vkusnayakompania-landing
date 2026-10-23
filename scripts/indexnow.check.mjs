/**
 * Check of IndexNow (`scripts/indexnow.mjs`) on a hand-made build in a temp
 * folder with a fake `fetch`: no network, no Yandex.
 * Проверка IndexNow на выдуманной сборке во временной папке с поддельным
 * `fetch`: без сети и без Яндекса.
 *
 * Run / Запуск: `pnpm test` (или node scripts/indexnow.check.mjs)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addresses, findKey, isNoindex, localPath, parseArgs, parseSitemap, run, siteRoot } from './indexnow.mjs';

const KEY = '0123456789abcdef0123456789abcdef';
const SITE = 'https://vkus-com.ru';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-check-'));
const dist = path.join(tmp, 'dist');
const state = path.join(tmp, 'state.json');

const write = (rel, text) => {
  const file = path.join(dist, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const html = (body, noindex = false) =>
  `<!doctype html><html><head><meta charset="utf-8">${noindex ? '<meta content="noindex, nofollow" name="robots">' : ''}</head><body>${body}</body></html>`;
const sitemap = (paths) =>
  write(
    'sitemap-0.xml',
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths
      .map((p) => `<url><loc>${SITE}${p}</loc></url>`)
      .join('')}</urlset>`,
  );

// сборка: главная, каталог, документ с noindex, кабинет вне карты, файл ключа
write('sitemap-index.xml', `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${SITE}/sitemap-0.xml</loc></sitemap></sitemapindex>`);
sitemap(['/', '/catalog/', '/docs/draft/']);
write('index.html', html('Главная'));
write('catalog/index.html', html('Каталог: 121 позиция'));
write('docs/draft/index.html', html('Черновик', true));
write('account/index.html', html('Кабинет', true));
write(`${KEY}.txt`, KEY);
write('robots.txt', 'User-agent: *\nAllow: /\n');
write('llms.txt', '# Вкусная компания\n');

/** Поддельный `fetch`: записывает запросы, отвечает заданным кодом или бросает. */
const fake = (reply = 200) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (reply instanceof Error) throw reply;
    return { status: reply, ok: reply < 300, text: async () => (reply < 300 ? '' : 'Key not valid') };
  };
  fn.calls = calls;
  return fn;
};
const quiet = () => {
  const lines = [];
  return { lines, log: (line) => lines.push(line), warn: (line) => lines.push(`! ${line}`) };
};
const go = async (options = {}) => {
  const out = quiet();
  const fetch = options.fetch ?? fake();
  const result = await run({ dist, site: SITE, state, env: {}, log: out.log, warn: out.warn, ...options, fetch });
  return { ...result, fetch, lines: out.lines };
};

try {
  // ── разбор ───────────────────────────────────────────────────────────────
  assert.deepEqual(parseSitemap('<urlset><url><loc>https://a.ru/x?a=1&amp;b=2</loc><lastmod>2026-10-23</lastmod></url><url><loc> https://a.ru/ </loc></url></urlset>'), [
    { loc: 'https://a.ru/x?a=1&b=2', lastmod: '2026-10-23' },
    { loc: 'https://a.ru/', lastmod: undefined },
  ]);
  const root = siteRoot(SITE);
  assert.equal(localPath(dist, root, `${SITE}/`), path.join(dist, 'index.html'));
  assert.equal(localPath(dist, root, `${SITE}/catalog/`), path.join(dist, 'catalog/index.html'));
  assert.equal(localPath(dist, root, 'https://other.ru/catalog/'), null, 'чужой хост — не файл сборки');
  assert.equal(localPath(dist, siteRoot('https://preview.ru/sub'), 'https://preview.ru/sub/docs/'), path.join(dist, 'docs/index.html'), 'база сайта снимается');
  assert.equal(isNoindex(html('', true)), true);
  assert.equal(isNoindex('<meta name="robots" content="index, follow">'), false);
  assert.equal(isNoindex('<meta name="yandex" content="noindex">'), true);
  assert.equal(isNoindex('<meta name="description" content="noindex в тексте описания">'), false);
  assert.deepEqual(parseArgs(['dist', SITE, '--dry-run', '--state', 's.json']), { dryRun: true, state: 's.json', dist: 'dist', site: SITE });
  assert.equal(parseArgs(['dist']), null, 'без адреса сайта — ошибка');
  assert.equal(parseArgs(['dist', 'не адрес']), null);
  assert.equal(parseArgs(['dist', SITE, '--state']), null, '--state без файла — ошибка');

  assert.deepEqual([1, 2, 5, 11, 21, 22].map(addresses), ['1 адрес', '2 адреса', '5 адресов', '11 адресов', '21 адрес', '22 адреса']);

  // ── ключ ─────────────────────────────────────────────────────────────────
  assert.deepEqual(findKey(dist, {}), { key: KEY }, 'ключ — файл <ключ>.txt с ним же внутри; robots.txt и llms.txt не ключи');
  assert.deepEqual(findKey(dist, { INDEXNOW_KEY: KEY }), { key: KEY });
  assert.match(findKey(dist, { INDEXNOW_KEY: 'ffffffffffffffffffffffffffffffff' }).error, /нет файла/, 'ключ из окружения без файла в сборке не годится');

  // ── первый запуск: всё индексируемое одним запросом ──────────────────────
  let r = await go();
  assert.equal(r.status, 'sent');
  assert.equal(r.fetch.calls.length, 1);
  const [call] = r.fetch.calls;
  assert.equal(call.url, 'https://yandex.com/indexnow');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.deepEqual(call.body, {
    host: 'vkus-com.ru',
    key: KEY,
    keyLocation: `${SITE}/${KEY}.txt`,
    urlList: [`${SITE}/`, `${SITE}/catalog/`],
  }, 'noindex и кабинет вне карты не отправляются');
  assert.ok(r.lines.includes('IndexNow: 2 адреса → 200 (новых и изменённых 2, пропавших 0)'), r.lines.join('\n'));
  assert.ok(fs.existsSync(state), 'после 200 состояние записано');

  // ── без изменений — без запроса ──────────────────────────────────────────
  r = await go();
  assert.equal(r.status, 'nothing');
  assert.equal(r.fetch.calls.length, 0);
  assert.deepEqual(r.lines, ['IndexNow: изменений нет']);

  // ── изменилась одна страница — уходит она одна ───────────────────────────
  write('catalog/index.html', html('Каталог: 122 позиции'));
  r = await go();
  assert.deepEqual(r.body.urlList, [`${SITE}/catalog/`]);

  // ── сеть упала: не бросает, состояние не трогается, адрес уйдёт потом ────
  write('index.html', html('Главная, новая афиша'));
  const before = fs.readFileSync(state, 'utf8');
  r = await go({ fetch: fake(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })) });
  assert.equal(r.status, 'network');
  assert.ok(r.lines.some((line) => line.startsWith('! IndexNow: 1 адрес → не отправлено, сеть: ENOTFOUND')), r.lines.join('\n'));
  assert.equal(fs.readFileSync(state, 'utf8'), before, 'после сбоя сети состояние прежнее');
  // ответ не 200/202 — тоже без записи состояния
  r = await go({ fetch: fake(403) });
  assert.equal(r.status, 'rejected');
  assert.ok(r.lines.includes('IndexNow: 1 адрес → 403 (новых и изменённых 1, пропавших 0)'));
  assert.ok(r.lines.some((line) => line.includes('ключ не подтверждён')));
  assert.equal(fs.readFileSync(state, 'utf8'), before);
  // 202 (ключ ещё проверяется) — адреса приняты
  r = await go({ fetch: fake(202) });
  assert.equal(r.status, 'sent');
  assert.deepEqual(r.body.urlList, [`${SITE}/`]);

  // ── проверка без отправки: список, без запроса и без записи ──────────────
  write('catalog/index.html', html('Каталог: 123 позиции'));
  const kept = fs.readFileSync(state, 'utf8');
  r = await go({ dryRun: true });
  assert.equal(r.status, 'dry-run');
  assert.equal(r.fetch.calls.length, 0);
  assert.ok(r.lines[0].startsWith('IndexNow (проверка, без отправки): 1 адрес '));
  assert.ok(r.lines.includes(`  ${SITE}/catalog/`));
  assert.equal(fs.readFileSync(state, 'utf8'), kept, 'проверка состояние не пишет');

  // ── страница пропала из карты или стала noindex — уходит, чтобы её убрали ─
  sitemap(['/']);
  r = await go();
  assert.deepEqual(r.body.urlList, [`${SITE}/catalog/`], 'пропавшая страница отправляется');
  r = await go();
  assert.equal(r.status, 'nothing', 'пропавшая уходит один раз');

  // ── превью: всё noindex, чужое состояние не считается своим ──────────────
  sitemap(['/', '/catalog/']);
  write('index.html', html('Главная', true));
  write('catalog/index.html', html('Каталог', true));
  r = await go({ site: 'https://preview.example', state: path.join(tmp, 'preview.json') });
  assert.equal(r.status, 'nothing');
  assert.equal(r.fetch.calls.length, 0, 'превью с noindex в Яндекс не уходит');

  // ── битое состояние — как первый запуск, без падения ─────────────────────
  const broken = path.join(tmp, 'broken.json');
  sitemap(['/']);
  write('index.html', html('Главная'));
  fs.writeFileSync(broken, '{ не json');
  r = await go({ state: broken });
  assert.deepEqual(r.body.urlList, [`${SITE}/`], 'нечитаемое состояние — всё заново');
  fs.writeFileSync(broken, JSON.stringify({ host: 'vkus-com.ru', pages: { 'не адрес': 'x', [`${SITE}/old/`]: 42, 'https://other.ru/': 'y' } }));
  r = await go({ state: broken });
  assert.deepEqual(r.body.urlList, [`${SITE}/`], 'битые и чужие записи состояния отброшены');

  // ── нет ключа — пропуск с предупреждением ────────────────────────────────
  write('index.html', html('Главная без ключа'));
  fs.rmSync(path.join(dist, `${KEY}.txt`));
  r = await go();
  assert.equal(r.status, 'no-key');
  assert.equal(r.fetch.calls.length, 0);
  assert.ok(r.lines.some((line) => line.includes('ключ не найден')));
  write(`${KEY}.txt`, KEY);

  // ── запуск из командной строки: ошибка аргументов — 2, проверка — 0 ──────
  const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('./indexnow.mjs', import.meta.url)), ...args], { encoding: 'utf8', env: { ...process.env, INDEXNOW_KEY: '' } });
  assert.equal(cli().status, 2);
  const dry = cli(dist, SITE, '--state', path.join(tmp, 'cli.json'), '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /IndexNow \(проверка, без отправки\): 1 адрес /);
  assert.ok(!fs.existsSync(path.join(tmp, 'cli.json')));
  const absent = cli(path.join(tmp, 'нет'), SITE);
  assert.equal(absent.status, 0, 'нет сборки — предупреждение, не ошибка');
  // настоящий fetch в закрытый порт: сеть упала — код 0, состояние не записано
  const port = await new Promise((done) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: free } = /** @type {import('node:net').AddressInfo} */ (server.address());
      server.close(() => done(free));
    });
  });
  const down = spawnSync(process.execPath, [fileURLToPath(new URL('./indexnow.mjs', import.meta.url)), dist, SITE, '--state', path.join(tmp, 'down.json')], {
    encoding: 'utf8',
    env: { ...process.env, INDEXNOW_KEY: '', INDEXNOW_ENDPOINT: `http://127.0.0.1:${port}/indexnow` },
    timeout: 30_000,
  });
  assert.equal(down.status, 0, down.stderr);
  assert.match(down.stderr, /IndexNow: 1 адрес → не отправлено, сеть: ECONNREFUSED/, down.stderr);
  assert.ok(!fs.existsSync(path.join(tmp, 'down.json')), 'после сбоя сети состояние не записано');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('IndexNow: отбор страниц, ключ, сбой сети и проверка без отправки — проверки прошли');
