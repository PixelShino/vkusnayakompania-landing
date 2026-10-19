// The bell in the admin after a build: each editor whose saves went into the
// release hears «Ваши правки опубликованы: 2 блюда, 1 точка», and a record left
// as a draft is named right there — «saved but not on the site» is the usual
// «I added it and it is not there». When a build fails, the administrators hear it.
// Колокольчик в админке после сборки: каждый редактор, чьи сохранения вошли в
// релиз, получает «Ваши правки опубликованы: 2 блюда, 1 точка», а запись,
// оставленная черновиком, названа тут же: «сохранено, но не на сайте» — обычная
// причина «добавила, а на сайте нет». Если сборка упала, узнают администраторы.
//
// Run by `deploy/build.sh` / Запускает `deploy/build.sh`:
//   node scripts/build-notify.mjs published <from-iso> <since-iso> <release> [seconds]
//   node scripts/build-notify.mjs failed <since-hh:mm>
// <from-iso> — start of the last build that reached the site, <since-iso> — start
// of this one: everything saved in between is in this release.
// <from-iso> — начало прошлой опубликованной сборки, <since-iso> — начало этой:
// всё сохранённое между ними вошло в этот релиз.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv } from './env.mjs';

loadEnv();
const BASE = process.env.DIRECTUS_URL;
const TOKEN = process.env.DIRECTUS_TOKEN;

// the same collections the watchdog follows (`deploy/watch.sh`): edits there change the site
// те же коллекции, за которыми следит сторож (`deploy/watch.sh`): правки в них меняют сайт
export const SITE_COLLECTIONS = [
  'afisha', 'promos', 'menus', 'cakes', 'places_files', 'directions_files', 'product_categories', 'products',
  'settings', 'home', 'places', 'directions', 'directus_files', 'texts',
  'catering_page', 'catering_page_files', 'catering_formats', 'catering_steps', 'catering_faq',
];

// how a change is named: plural forms, the field with its name, whether it has drafts
// как называется правка: формы множественного числа, поле с названием, есть ли черновики
const KINDS = {
  products: { label: 'Блюда', words: ['блюдо', 'блюда', 'блюд'], title: 'title', status: true },
  product_categories: { label: 'Разделы каталога', words: ['раздел каталога', 'раздела каталога', 'разделов каталога'], title: 'title', status: true },
  cakes: { label: 'Торты', words: ['торт', 'торта', 'тортов'], title: 'title', status: true },
  promos: { label: 'Акции', words: ['акция', 'акции', 'акций'], title: 'title', status: true },
  afisha: { label: 'Афиша', words: ['событие афиши', 'события афиши', 'событий афиши'], title: 'title', status: true },
  menus: { label: 'Меню', words: ['меню', 'меню', 'меню'], title: 'title', status: true },
  places: { label: 'Точки', words: ['точка', 'точки', 'точек'], title: 'name' },
  directions: { label: 'Направления', words: ['направление', 'направления', 'направлений'], title: 'title' },
  catering_formats: { label: 'Форматы кейтеринга', words: ['формат кейтеринга', 'формата кейтеринга', 'форматов кейтеринга'], title: 'title', status: true },
  catering_steps: { label: 'Шаги кейтеринга', words: ['шаг кейтеринга', 'шага кейтеринга', 'шагов кейтеринга'], title: 'title' },
  catering_faq: { label: 'Вопросы кейтеринга', words: ['вопрос кейтеринга', 'вопроса кейтеринга', 'вопросов кейтеринга'], title: 'question', status: true },
  settings: { single: 'настройки сайта' },
  home: { single: 'главная страница' },
  catering_page: { single: 'страница кейтеринга' },
  texts: { single: 'тексты сайта' },
  // gallery rows: counted only when their owner was not edited itself
  // строки галерей: считаются, только если сама запись-владелец не правилась
  places_files: { label: 'Фото точек', words: ['фото точек', 'фото точек', 'фото точек'], parent: 'places' },
  directions_files: { label: 'Фото направлений', words: ['фото направлений', 'фото направлений', 'фото направлений'], parent: 'directions' },
  catering_page_files: { label: 'Фото кейтеринга', words: ['фото кейтеринга', 'фото кейтеринга', 'фото кейтеринга'], parent: 'catering_page' },
  // an upload is part of the record it was attached to; alone it is «a file»
  // загрузка — часть записи, к которой её прикрепили; одна сама по себе — «файл»
  directus_files: { label: 'Файлы', words: ['файл', 'файла', 'файлов'], title: 'title', alone: true },
};

const plural = (n, [one, few, many]) => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return many;
  if (n % 10 === 1) return one;
  return [2, 3, 4].includes(n % 10) ? few : many;
};
const quote = (t) => `«${String(t).length > 40 ? `${String(t).slice(0, 39)}…` : t}»`;

const api = async (method, url, body) => {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`${method} ${url.split('?')[0]} → ${r.status}`);
  return r.status === 204 ? null : (await r.json()).data;
};
const q = (params) => new URLSearchParams(params).toString();

const notify = (recipient, subject, message, collection, item) =>
  api('POST', '/notifications', { recipient, subject, message, collection, item: item === undefined ? undefined : String(item) });

/**
 * What a user changed, as lines for the message and one short phrase for the
 * subject. `rows` — activity rows of this user, `facts` — titles and statuses
 * by collection and id. Pure: `scripts/build-notify.check.mjs` feeds it rows.
 * Что изменил пользователь: строки для сообщения и короткая фраза для темы.
 * `rows` — строки журнала этого пользователя, `facts` — названия и статусы по
 * коллекции и id. Чистая функция: проверка подаёт ей строки.
 */
export const describe = (rows, facts) => {
  const byCollection = new Map();
  for (const row of rows) {
    if (!KINDS[row.collection]) continue;
    const items = byCollection.get(row.collection) ?? new Map();
    // the last action wins: created and then deleted is «deleted»
    // побеждает последнее действие: создано, потом удалено — «удалено»
    items.set(String(row.item), row.action);
    byCollection.set(row.collection, items);
  }
  const touched = [...byCollection.keys()];
  const counts = [];
  const lines = [];
  const drafts = [];
  for (const [collection, items] of byCollection) {
    const kind = KINDS[collection];
    if (kind.parent && touched.includes(kind.parent)) continue;
    if (kind.alone && touched.some((c) => c !== collection)) continue;
    if (kind.single) {
      counts.push(kind.single);
      lines.push(`- ${kind.single[0].toUpperCase()}${kind.single.slice(1)}`);
      continue;
    }
    const known = facts[collection] ?? {};
    const live = [];
    const gone = [];
    for (const [id, action] of items) {
      const fact = known[id];
      if (action === 'delete' || (kind.title && fact === undefined && facts[collection])) gone.push(id);
      else if (kind.status && fact?.status === 'draft') drafts.push({ collection, id, title: fact.title });
      else live.push(fact?.title);
    }
    const n = live.length + gone.length;
    if (!n) continue;
    counts.push(`${n} ${plural(n, kind.words)}`);
    // up to five names, so the editor recognises her change; more is a number
    // до пяти названий — редактор узнаёт свою правку; больше — число
    const names = live.filter(Boolean);
    const parts = [];
    if (names.length && names.length === live.length && names.length <= 5) parts.push(names.map(quote).join(', '));
    else if (live.length) parts.push(String(live.length));
    if (gone.length) parts.push(`удалено — ${gone.length}`);
    lines.push(`- ${kind.label}: ${parts.join('; ')}`);
  }
  return { counts, lines, drafts };
};

const published = async (from, since, release, seconds) => {
  if (!from) {
    console.log('уведомления: нет отметки прошлой публикации — начинаю с этой сборки');
    return;
  }
  const activity = await api(
    'GET',
    `/activity?${q({
      'filter[timestamp][_gt]': from,
      'filter[timestamp][_lte]': since,
      'filter[collection][_in]': SITE_COLLECTIONS.join(','),
      'filter[action][_in]': 'create,update,delete',
      'filter[user][_nnull]': 'true',
      fields: 'user,collection,item,action',
      sort: 'timestamp',
      limit: '-1',
    })}`,
  );
  if (!activity.length) return;

  // titles and statuses of everything touched, one request per collection
  // названия и статусы всего затронутого — по запросу на коллекцию
  const facts = {};
  const ids = new Map();
  for (const row of activity) if (KINDS[row.collection]?.title) ids.set(row.collection, new Set([...(ids.get(row.collection) ?? []), String(row.item)]));
  for (const [collection, set] of ids) {
    const kind = KINDS[collection];
    const fields = ['id', kind.title, kind.status ? 'status' : null].filter(Boolean).join(',');
    const url = collection === 'directus_files' ? '/files' : `/items/${collection}`;
    try {
      const rows = await api('GET', `${url}?${q({ 'filter[id][_in]': [...set].join(','), fields, limit: '-1' })}`);
      facts[collection] = Object.fromEntries(rows.map((r) => [String(r.id), { title: r[kind.title], status: r.status }]));
    } catch {
      // without titles the message still has the counts
      // без названий в сообщении всё равно останутся числа
    }
  }

  const builder = (await api('GET', '/users/me?fields=id').catch(() => null))?.id;
  const byUser = new Map();
  for (const row of activity) if (row.user !== builder) byUser.set(row.user, [...(byUser.get(row.user) ?? []), row]);

  const time = since.slice(11, 16);
  for (const [user, rows] of byUser) {
    const { counts, lines, drafts } = describe(rows, facts);
    if (!counts.length && !drafts.length) continue;
    const draftNames = drafts.map((d) => quote(d.title ?? `№${d.id}`)).join(', ');
    const draftWords = drafts.length === 1 ? 'черновик и на сайт не попал' : 'черновики и на сайт не попали';
    const subject = counts.length
      ? `Ваши правки опубликованы: ${counts.join(', ')}${drafts.length ? ` · не на сайте: ${drafts.length} ${plural(drafts.length, ['черновик', 'черновика', 'черновиков'])}` : ''}`
      : `Сохранено, но не на сайте: ${draftNames} — ${drafts.length === 1 ? 'черновик' : 'черновики'}`;
    const message = [
      `Релиз ${release}${seconds ? `, сборка ${seconds} с` : ''}. На сайте всё, что сохранено до ${time}.`,
      lines.length ? '' : null,
      ...lines,
      drafts.length ? '' : null,
      drafts.length
        ? `**Не на сайте:** ${draftNames} — ${draftWords}. Откройте запись, выберите статус «Опубликовано» и сохраните — сайт обновится сам за минуту.`
        : null,
    ]
      .filter((line) => line !== null)
      .join('\n');
    // a single draft opens that very record. The admin cannot link to a
    // singleton by id (`/content/site_build/1` is «not found»), so otherwise
    // there is no link: the text names the page
    // один черновик — ссылка на саму запись. На одиночную коллекцию админка по
    // id не ссылается (`/content/site_build/1` — «не найдено»), поэтому иначе
    // ссылки нет: страницу называет текст
    const [collection, item] = drafts.length === 1 ? [drafts[0].collection, drafts[0].id] : [undefined, undefined];
    try {
      await notify(user, subject, message, collection, item);
      console.log(`уведомление: ${subject}`);
    } catch (error) {
      console.error(`уведомление не создано: ${error.message}`);
    }
  }
};

// one failure notice per half hour: a broken build after every save must not flood the bell
// одно уведомление о сбое в полчаса: сборка, падающая после каждого сохранения, не должна завалить колокольчик
const FAILED_MARK = path.join(os.tmpdir(), 'vkus-build-failed-notified');
const failed = async (since) => {
  try {
    if (Date.now() - fs.statSync(FAILED_MARK).mtimeMs < 30 * 60_000) return;
  } catch {
    /* no mark yet / отметки ещё нет */
  }
  const admins = await api(
    'GET',
    `/users?${q({ 'filter[role][name][_eq]': 'Administrator', 'filter[status][_eq]': 'active', fields: 'id', limit: '-1' })}`,
  );
  for (const { id } of admins) {
    await notify(
      id,
      'Сборка сайта не удалась',
      `На сайте осталась прежняя версия: правки, сохранённые после ${since}, не опубликованы. ` +
        'Последние строки лога — на странице «Публикация сайта». Следующее сохранение запустит сборку заново.',
    );
  }
  fs.writeFileSync(FAILED_MARK, new Date().toISOString());
  console.log(`уведомление о сбое: администраторов — ${admins.length}`);
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain && BASE && TOKEN) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'published') {
    await published(args[0], args[1], args[2], args[3]);
    // a successful build clears the failure mark: the next failure is news again
    // удачная сборка снимает отметку сбоя: следующий сбой — снова новость
    fs.rmSync(FAILED_MARK, { force: true });
  } else if (mode === 'failed') await failed(args[0]);
  else console.error('node scripts/build-notify.mjs published <from> <since> <release> [seconds] | failed <hh:mm>');
}
