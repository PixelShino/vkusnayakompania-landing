# План: сайт-визитка на Astro + Directus

> **Для исполнителя:** задачи выполняются по порядку, каждая заканчивается
> проверкой и коммитом. Чекбоксы `- [ ]` отмечаются по факту. UI-задачи
> делаются только после загрузки дизайн-скиллов (`impeccable`,
> `make-interfaces-feel-better`, `ui-ux-pro-max`, `frontend-design`, `animate`)
> и заканчиваются скриншотами 390 и 1440, которые смотрит сам исполнитель.

**Цель:** лендинг кондитерской становится визиткой всей «Вкусной компании» с
контентом из Directus и статической сборкой на VPS.

**Архитектура:** Directus (Docker, Postgres) хранит контент и дёргает
пересборку вебхуком. Astro 5 при сборке забирает контент по REST одним
загрузчиком `getContent()`, картинки прогоняет через `astro:assets`, отдаёт
статику. Без Directus работает фикстура. Страница перестраивается в 12 секций
по спеке.

**Стек:** Astro 5.18, TypeScript, Node 24 (TS без флагов), pnpm, Directus
11.17 в Docker, Postgres 16, nginx, `adnanh/webhook`, Яндекс Карты JS API 3.0.

**Спека:** `docs/superpowers/specs/2026-09-03-vizitka-astro-directus-design.md`

## Глобальные ограничения

- `docs/DESIGN.md` — источник правды: палитра из `src/styles/global.css:5-91`,
  Montserrat Variable, радиусы `--r-*`, паттерн «круг → пунктир → пилюля»
  (`.card-top`), кнопки `.btn` 38/42/46 px, брейкпоинты 768 и 1200.
- Никаких форм, лайтбоксов, попапов кроме диалога брони, цен у тортов.
- Motion: `ease-out` на вход, `< 300 мс`, нет `transition: all`, нет
  `ease-in`, `prefers-reduced-motion` оставляет только прозрачность.
- Картинки из Directus только через `<Image>` / `getImage()`; сырой
  `<img src="http…8055/assets…">` запрещён (утечка токена).
- Тесты: `node:assert/strict`, файлы `*.check.ts`, запуск `node file.ts`.
- Коммиты в стиле истории: `type(scope): отглагольное существительное`, тело
  «Задача / Функциональность / Под капотом», трейлер
  `Co-authored-by: Claude <claude@anthropic.com>`. `git push` запрещён.
- Путь проекта с точным регистром `D:\Code\Projects\vkusnayakompania-landing`
  (иначе Astro теряет CSS, см. README).
- Astro остаётся на 5.x.

## Структура файлов

**Создать**

- `directus/docker-compose.yml`, `directus/.env.example`, `directus/.gitignore`,
  `directus/snapshot.yaml` — инстанс и схема.
- `scripts/directus-setup.mjs` — роль «Редактор», пользователь-сборщик со
  статическим токеном, Flow «Пересборка», настройки проекта. Идемпотентен.
- `scripts/export-fixture.mjs` — Directus → `src/data/fixture.json` +
  `src/data/fixture-files/`.
- `scripts/fetch-files.mjs` — PDF и документы из Directus → `public/media/`.
- `src/lib/content.ts` — типы `Content` и загрузчик `getContent()`.
- `src/lib/select.ts` — чистые выборки: текущая афиша, активные акции, меню по
  направлению, группировка акций по адресу.
- `src/lib/select.check.ts`, `src/data/content.check.ts` — проверки.
- `src/components/Directions.astro`, `Afisha.astro`, `Promos.astro`,
  `Menus.astro`, `Gallery.astro`, `Delivery.astro`, `BookingDialog.astro`,
  `StickyBar.astro`.
- `src/scripts/booking-dialog.ts`, `src/scripts/sticky-bar.ts`,
  `src/scripts/yandex-map.ts`, `src/scripts/rail.ts`.
- `deploy/nginx/vkus-com.ru.conf`, `deploy/nginx/admin.vkus-com.ru.conf`,
  `deploy/webhook/hooks.json`, `deploy/build.sh`, `deploy/backup.sh`,
  `deploy/crontab.txt`, `.github/workflows/deploy.yml` (новый).
- `docs/DIRECTUS.md` — установка и эксплуатация.

**Изменить**

- `src/data/site.ts` — данные уходят, остаются функции + `toSchedule()`.
- `src/data/site.check.ts` — тесты `toSchedule()`.
- `src/layouts/BaseLayout.astro` — SEO из `home`, JSON-LD из `places`,
  Метрика, диалог брони.
- `src/pages/index.astro` — новый порядок секций.
- `src/components/Header.astro`, `Hero.astro`, `Cakes.astro`, `Reviews.astro`,
  `Contacts.astro`, `YandexMap.astro`, `Footer.astro`, `Photo.astro`,
  `OpenStatus.astro`.
- `src/scripts/lazy-frame.ts` — починка гонки.
- `src/styles/global.css` — паттерн ленивого кадра, `.sr-only`, `.skip-link`,
  диалог.
- `astro.config.mjs` — `image.remotePatterns`, `site` из env.
- `package.json` — pnpm, скрипты `fixture`, `files`, `setup`.
- `.gitignore` — `public/media/`, `src/data/fixture-files/`, чинится битая
  кодировка комментария.
- `docs/PRODUCT.md`, `docs/DESIGN.md`, `README.md`.

**Удалить**

- `src/components/Bento.astro`, `Sweets.astro`, `Room.astro`,
  `HowToOrder.astro`, `Ecosystem.astro`, `CustomCake.astro`.
- `src/data/catalog.ts` (после переноса тортов).
- `handoff/`, `.github/workflows/deploy.yml` (GH Pages), `package-lock.json`.

---

## Этап 1. Directus: инстанс, схема, роли, данные

### Задача 1.1: Инстанс в Docker и схема

**Файлы:** `directus/docker-compose.yml`, `directus/.env.example`,
`directus/.gitignore`, `directus/snapshot.yaml`.

- [x] **Шаг 1:** compose с `directus/directus:11.17.0` и `postgres:16-alpine`,
  порт только `127.0.0.1:8055`, тома `data/`, `uploads/`, `extensions/`,
  `DEFAULT_LANGUAGE=ru-RU`. Секреты через `.env` (`.env.example` в репо).
- [x] **Шаг 2:** `docker compose up -d`, `GET /server/ping` → `pong`.
- [x] **Шаг 3:** `PATCH /settings` — имя «Вкусная компания», язык `ru-RU`,
  цвет `#6F7546`.
- [x] **Шаг 4:** коллекции по спеке §3 через REST (одноразовый скрипт):
  `settings`, `home` (одиночные), `places`, `places_files`, `directions`,
  `afisha`, `promos`, `menus`, `cakes`; связи файлов и M2O; поле
  `directus_files.alt`. Все подписи и подсказки по-русски, группы полей.
- [x] **Шаг 5:** `GET /schema/snapshot?export=yaml` → `directus/snapshot.yaml`.
- [x] **Шаг 6:** коммит `feat(directus): инстанс и схема контента`.

### Задача 1.2: Настройка ролей, сборщика и Flow скриптом

**Файлы:** `scripts/directus-setup.mjs`, `package.json` (скрипт `setup`).

**Интерфейс:** запуск `DIRECTUS_URL=… DIRECTUS_ADMIN_TOKEN=… node scripts/directus-setup.mjs`;
печатает статический токен сборщика при первом создании. Повторный запуск
ничего не дублирует.

- [x] **Шаг 1:** написать скрипт. Логика по шагам, каждый ищет объект по имени
  и создаёт только отсутствующее:

```js
// scripts/directus-setup.mjs — роль редактора, сборщик, Flow. Идемпотентен.
const BASE = process.env.DIRECTUS_URL ?? 'http://localhost:8055';
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
const HOOK_URL = process.env.REBUILD_HOOK_URL ?? 'http://127.0.0.1:9000/hooks/rebuild';
const HOOK_SECRET = process.env.REBUILD_HOOK_SECRET ?? '';
if (!TOKEN) throw new Error('DIRECTUS_ADMIN_TOKEN обязателен');

const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : (await r.json()).data;
};
const findOne = async (path, filter) => (await api('GET', `${path}?filter=${encodeURIComponent(JSON.stringify(filter))}&limit=1`))[0];

const CONTENT = ['afisha', 'promos', 'menus', 'cakes', 'places_files'];
const SINGLE = ['settings', 'home', 'places', 'directions'];

// 1. policy + role «Редактор»
let policy = await findOne('/policies', { name: { _eq: 'Редактор' } });
if (!policy) policy = await api('POST', '/policies', { name: 'Редактор', app_access: true, admin_access: false, icon: 'edit' });
let role = await findOne('/roles', { name: { _eq: 'Редактор' } });
if (!role) role = await api('POST', '/roles', { name: 'Редактор', icon: 'edit', policies: [{ policy: policy.id }] });

// 2. permissions
const existing = await api('GET', `/permissions?filter[policy][_eq]=${policy.id}&limit=-1`);
const has = (collection, action) => existing.some((p) => p.collection === collection && p.action === action);
const perms = [];
for (const c of CONTENT) for (const action of ['create', 'read', 'update', 'delete']) if (!has(c, action)) perms.push({ policy: policy.id, collection: c, action, fields: ['*'] });
for (const c of SINGLE) for (const action of ['read', 'update']) if (!has(c, action)) perms.push({ policy: policy.id, collection: c, action, fields: c === 'directions' && action === 'update' ? ['title', 'text', 'photo', 'place', 'sort'] : ['*'] });
for (const action of ['create', 'read', 'update', 'delete']) if (!has('directus_files', action)) perms.push({ policy: policy.id, collection: 'directus_files', action, fields: ['*'] });
for (const c of ['directus_folders']) for (const action of ['create', 'read', 'update']) if (!has(c, action)) perms.push({ policy: policy.id, collection: c, action, fields: ['*'] });
if (perms.length) await api('POST', '/permissions', perms);

// 3. builder: read-only policy + user with static token
let bpolicy = await findOne('/policies', { name: { _eq: 'Сборщик' } });
if (!bpolicy) bpolicy = await api('POST', '/policies', { name: 'Сборщик', app_access: false, admin_access: false, icon: 'build' });
const bexisting = await api('GET', `/permissions?filter[policy][_eq]=${bpolicy.id}&limit=-1`);
const bperms = [...CONTENT, ...SINGLE, 'directus_files'].filter((c) => !bexisting.some((p) => p.collection === c)).map((c) => ({ policy: bpolicy.id, collection: c, action: 'read', fields: ['*'] }));
if (bperms.length) await api('POST', '/permissions', bperms);
let brole = await findOne('/roles', { name: { _eq: 'Сборщик' } });
if (!brole) brole = await api('POST', '/roles', { name: 'Сборщик', icon: 'build', policies: [{ policy: bpolicy.id }] });
let builder = await findOne('/users', { email: { _eq: 'builder@vkus-com.ru' } });
if (!builder) {
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  builder = await api('POST', '/users', { email: 'builder@vkus-com.ru', first_name: 'Сборщик', role: brole.id, status: 'active', token });
  console.log(`DIRECTUS_TOKEN (сохранить, больше не покажется): ${token}`);
}

// 4. flow «Пересборка»
let flow = await findOne('/flows', { name: { _eq: 'Пересборка сайта' } });
if (!flow) {
  flow = await api('POST', '/flows', { name: 'Пересборка сайта', icon: 'published_with_changes', status: 'active', trigger: 'event', accountability: 'all',
    options: { type: 'action', scope: ['items.create', 'items.update', 'items.delete'], collections: [...CONTENT, ...SINGLE, 'directus_files'] } });
  const op = await api('POST', '/operations', { flow: flow.id, name: 'Дёрнуть вебхук', key: 'rebuild', type: 'request', position_x: 19, position_y: 1,
    options: { method: 'POST', url: HOOK_URL, headers: [{ header: 'X-Hook-Secret', value: HOOK_SECRET }], body: '{"reason":"{{$trigger.event}}"}' } });
  await api('PATCH', `/flows/${flow.id}`, { operation: op.id });
}
console.log('setup: готово');
```

- [x] **Шаг 2:** запустить локально с админ-токеном, сохранить токен сборщика
  в `.env` проекта (`DIRECTUS_TOKEN`). Повторить запуск: вывод только
  «setup: готово».
- [x] **Шаг 3:** проверить под «Редактором» в браузере: видит 8 коллекций,
  может создать афишу, не может добавить направление.
- [x] **Шаг 4:** коммит `feat(directus): роли, сборщик и пересборка скриптом`.

### Задача 1.3: Перенос данных и фикстура

**Файлы:** `scripts/export-fixture.mjs`, `src/data/fixture.json`,
`src/data/fixture-files/` (в `.gitignore`), `package.json` (скрипт `fixture`).

**Данные для переноса** (одноразовый скрипт вне репо, читает
`src/data/site.ts` и `src/data/catalog.ts` до их изменения):

- `settings` ← `site.phone`, `site.links.*`, `site.shopSections.*`,
  `yandexStats.*`; `metrika_id` пусто; юрлицо пусто.
- `home` ← `site.title` → `seo_title`, `site.description` →
  `seo_description`; `hero_title` «Вкусная компания», `hero_text` из
  `Hero.astro:30-32`; `hero_image` ← `src/assets/hero-tall.jpg`; тексты секций
  из `Cakes.astro:15-18`, `Ecosystem.astro:54-63`, `Contacts.astro:76-77`.
- `places` ← `places[]` (`site.ts:118-142`), `hours` из `schedule` через
  обратное преобразование, `gallery` ← Unsplash-снимки `heroPhotos.room` и
  `roomDetails` (`catalog.ts:60-77`), скачанные в 1600 px.
- `directions` — 5 записей с текстами из `HowToOrder.astro`, `Ecosystem.astro`
  и спеки; `cafe`/`restaurant` привязаны к `places`.
- `cakes` ← `cakes[]` (`catalog.ts:36-49`): `title` ← `name`, `note` ← `meta`,
  `photo` ← Unsplash по id (1200 px), `status: published`. Цены не переносятся.
- `afisha`, `promos`, `menus` — по одной черновой записи-примеру, чтобы
  редактор видел формат. Афиша с постером-заглушкой 1000×1500 (сгенерировать
  однотонный PNG с текстом «Постер»).
- У всех файлов заполнить `title` и `alt`; у плейсхолдеров `title` начинается
  с «[заглушка]».

- [x] **Шаг 1:** написать и запустить одноразовый скрипт переноса; в Directus
  появляется весь контент, картинки видны в медиатеке.
- [x] **Шаг 2:** `scripts/export-fixture.mjs`:

```js
// Directus → src/data/fixture.json + src/data/fixture-files/. Запуск: pnpm fixture
import fs from 'node:fs/promises';
const BASE = process.env.DIRECTUS_URL ?? 'http://localhost:8055';
const TOKEN = process.env.DIRECTUS_TOKEN;
const FILE_FIELDS = 'id,filename_download,title,alt,width,height,type';
const q = (fields, extra = '') => `fields=${fields}&limit=-1${extra}`;
const get = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()).data;
};
const img = (f) => `${f}.${FILE_FIELDS.replaceAll(',', `,${f}.`)}`;
const fixture = {
  settings: await get(`/items/settings?${q(`*,${img('policy_file')},${img('offer_file')}`)}`),
  home: await get(`/items/home?${q(`*,${img('hero_image')},${img('og_image')},${img('app_screenshot')}`)}`),
  places: await get(`/items/places?${q(`*,gallery.id,gallery.sort,gallery.caption,${img('gallery.directus_files_id')}`, '&sort=id')}`),
  directions: await get(`/items/directions?${q(`*,${img('photo')}`, '&sort=sort')}`),
  afisha: await get(`/items/afisha?${q(`*,${img('poster')}`, '&sort=date')}`),
  promos: await get(`/items/promos?${q('*', '&sort=sort')}`),
  menus: await get(`/items/menus?${q(`*,${img('file')}`)}`),
  cakes: await get(`/items/cakes?${q(`*,${img('photo')}`, '&sort=sort')}`),
  exportedAt: new Date().toISOString(),
};
await fs.mkdir('src/data/fixture-files', { recursive: true });
const files = new Map();
const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (v.filename_download && v.id) files.set(v.id, v); Object.values(v).forEach(walk); } };
walk(fixture);
for (const f of files.values()) {
  const ext = f.filename_download.split('.').pop();
  const r = await fetch(`${BASE}/assets/${f.id}?access_token=${TOKEN}`);
  await fs.writeFile(`src/data/fixture-files/${f.id}.${ext}`, Buffer.from(await r.arrayBuffer()));
}
await fs.writeFile('src/data/fixture.json', JSON.stringify(fixture, null, 2) + '\n');
console.log(`fixture: ${files.size} файлов`);
```

- [x] **Шаг 3:** `pnpm fixture` (после переезда на pnpm в 2.1 — до этого
  `node scripts/export-fixture.mjs`) с `DIRECTUS_TOKEN` сборщика: появляется
  `fixture.json` и папка файлов.
- [x] **Шаг 4:** `.gitignore` += `src/data/fixture-files/`, `public/media/`;
  битая строка комментария заменяется на «# скриншоты проверок в корне».
- [x] **Шаг 5:** коммит `feat(content): перенос данных в Directus и фикстура`.

---

## Этап 2. Слой контента в Astro

### Задача 2.1: pnpm и конфиг

**Файлы:** `package.json`, `pnpm-lock.yaml`, `astro.config.mjs`, `.env.example`.

- [x] **Шаг 1:** `pnpm import` → `pnpm-lock.yaml`, удалить
  `package-lock.json`, `pnpm install`, `pnpm build` зелёный.
- [x] **Шаг 2:** `package.json` scripts: `dev`, `build`, `preview`, `check`,
  `test: "node src/data/site.check.ts && node src/lib/select.check.ts && node src/data/content.check.ts"`,
  `fixture: "node scripts/export-fixture.mjs"`,
  `files: "node scripts/fetch-files.mjs"`,
  `setup: "node scripts/directus-setup.mjs"`,
  `prebuild: "node src/data/content.check.ts && node scripts/fetch-files.mjs"`.
- [x] **Шаг 3:** `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const directus = process.env.DIRECTUS_URL ? new URL(process.env.DIRECTUS_URL) : null;

export default defineConfig({
  site: process.env.SITE ?? 'https://vkus-com.ru',
  base: process.env.BASE_PATH,
  integrations: [sitemap()],
  build: { inlineStylesheets: 'always' },
  image: {
    // картинки из Directus тянутся при сборке по адресу с токеном
    remotePatterns: directus ? [{ protocol: directus.protocol.replace(':', ''), hostname: directus.hostname }] : [],
  },
});
```

- [x] **Шаг 4:** `.env.example` в корне: `DIRECTUS_URL=`, `DIRECTUS_TOKEN=`,
  `PUBLIC_YANDEX_MAPS_KEY=`, `SITE=https://vkus-com.ru`.
- [x] **Шаг 5:** коммит `chore(build): переезд на pnpm и картинки из Directus`.

### Задача 2.2: Расписание из строк админки

**Файлы:** `src/data/site.ts`, `src/data/site.check.ts`.

**Интерфейс:** `toSchedule(rows: HoursRow[]): Schedule`, где
`HoursRow = { day: 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'; open: string; close: string }`.
Бросает `Error` с текстом дня, если не хватает дня или закрытие не позже
открытия. Дальше всё как раньше: `hoursRows`, `openState`, `schemaHours`.

- [x] **Шаг 1:** тест в `site.check.ts`:

```ts
// строки админки → кортеж по getDay()
const rows: HoursRow[] = [
  { day: 'mon', open: '08:00', close: '21:00' }, { day: 'tue', open: '08:00', close: '21:00' },
  { day: 'wed', open: '08:00', close: '21:00' }, { day: 'thu', open: '08:00', close: '21:00' },
  { day: 'fri', open: '08:00', close: '21:00' }, { day: 'sat', open: '08:30', close: '21:00' },
  { day: 'sun', open: '09:00', close: '21:00' },
];
assert.deepEqual(toSchedule(rows)[0], ['09:00', '21:00']);
assert.deepEqual(toSchedule(rows)[6], ['08:30', '21:00']);
assert.throws(() => toSchedule(rows.slice(1)), /понедельник/);
assert.throws(() => toSchedule([...rows.slice(0, 6), { day: 'sun', open: '21:00', close: '09:00' }]), /воскресенье/);
```

- [x] **Шаг 2:** запустить, увидеть падение на `toSchedule is not a function`.
- [x] **Шаг 3:** реализация в `site.ts`:

```ts
export type HoursRow = { day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'; open: string; close: string };
const DAY_INDEX: Record<HoursRow['day'], number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_NAME: Record<HoursRow['day'], string> = { mon: 'понедельник', tue: 'вторник', wed: 'среда', thu: 'четверг', fri: 'пятница', sat: 'суббота', sun: 'воскресенье' };
const TIME = /^\d{2}:\d{2}$/;

/** Строки из админки (по одной на день) → кортеж расписания по `getDay()` */
export const toSchedule = (rows: HoursRow[]): Schedule => {
  const out: Hours[] = new Array(7);
  for (const row of rows) {
    if (!TIME.test(row.open) || !TIME.test(row.close) || toMinutes(row.close) <= toMinutes(row.open))
      throw new Error(`часы: ${DAY_NAME[row.day]} — закрытие должно быть позже открытия, формат 08:00`);
    out[DAY_INDEX[row.day]] = [row.open, row.close];
  }
  for (const day of Object.keys(DAY_INDEX) as HoursRow['day'][])
    if (!out[DAY_INDEX[day]]) throw new Error(`часы: нет строки на ${DAY_NAME[day]}`);
  return out as Schedule;
};
```

- [x] **Шаг 4:** `node src/data/site.check.ts` зелёный.
- [x] **Шаг 5:** коммит `feat(hours): расписание из строк админки`.

### Задача 2.3: Выборки контента

**Файлы:** `src/lib/select.ts`, `src/lib/select.check.ts`.

**Интерфейс:**

```ts
export type Dated = { status: string; show_from?: string | null; show_until?: string | null };
/** опубликовано и сегодня внутри окна показа (даты YYYY-MM-DD, границы включительно) */
export const isLive = <T extends Dated>(item: T, today: string) => boolean;
/** текущая афиша: живая, ближайшая по date; нет — null */
export const currentAfisha = <T extends Dated & { date: string }>(items: T[], today: string) => T | null;
/** живые акции в порядке sort, группировка по place: Map<number | null, T[]> */
export const livePromos = <T extends Dated & { sort?: number | null }>(items: T[], today: string) => T[];
export const groupByPlace = <T extends { place?: number | null }>(items: T[]) => Map<number | null, T[]>;
/** опубликованное меню направления, самое свежее по updated; нет — null */
export const menuFor = <T extends { status: string; direction: number; updated: string }>(menus: T[], direction: number) => T | null;
```

- [x] **Шаг 1:** тесты в `select.check.ts`: окно с пустыми границами, граница
  включительно, черновик не живой, афиша выбирает ближайшую будущую, а если
  все прошли — последнюю живую; `menuFor` берёт максимальную `updated`;
  `groupByPlace` кладёт `null` первым.
- [x] **Шаг 2:** запуск → падение на импорте.
- [x] **Шаг 3:** реализация чистыми функциями без зависимостей, сравнение дат
  строками `YYYY-MM-DD`.
- [x] **Шаг 4:** зелёный.
- [x] **Шаг 5:** коммит `feat(content): выборки афиши, акций и меню`.

### Задача 2.4: Загрузчик `getContent()` и проверка контента

**Файлы:** `src/lib/content.ts`, `src/data/content.check.ts`,
`scripts/fetch-files.mjs`.

**Интерфейс (то, чем пользуются компоненты):**

```ts
export type Img = { src: ImageMetadata | string; width: number; height: number; alt: string };
export type Doc = { href: string; title: string }; // href → /media/<id>.pdf
export type Settings = { phone: string; phoneHref: string; telegram: string; max: string; vk?: string;
  shop_url: string; app_ios: string; app_android: string; catering_url: string; catering_services_url?: string;
  shop_cakes_ready?: string; shop_cakes_custom?: string; shop_pastry?: string; shop_breakfasts?: string;
  legal_name?: string; inn?: string; ogrn?: string; legal_address?: string; policy?: Doc; offer?: Doc;
  yandex_score?: string; yandex_award?: string; yandex_ratings?: number; yandex_reviews?: number;
  yandex_highlights: { label: string; percent: number }[]; metrika_id?: string };
export type Home = { hero_image: Img; hero_title: string; hero_text?: string; seo_title: string; seo_description: string;
  og_image?: Img; robots_index: boolean; about_title?: string; about_text?: string; menu_text?: string;
  cakes_title?: string; cakes_text?: string; delivery_title?: string; delivery_text?: string; delivery_note?: string;
  app_screenshot?: Img; contacts_note?: string };
export type Place = { id: number; n: string; name: string; street: string; kind: string; schedule: Schedule;
  lat: number; lng: number; yandex_org: string; rating?: string; gallery: { image: Img; caption?: string }[] };
export type Direction = { id: number; key: 'cafe' | 'restaurant' | 'confectionery' | 'catering' | 'banquets';
  title: string; text: string; photo?: Img; place?: Place };
export type Afisha = { id: number; title: string; poster: Img; date: string; time?: string; place: Place; text?: string; link?: string };
export type Promo = { id: number; title: string; text: string; place?: Place; cta: 'book' | 'order' | 'none' };
export type Menu = { id: number; direction: number; title: string; file: Doc; updated: string };
export type Cake = { id: number; title: string; note?: string; photo: Img };
export type Content = { settings: Settings; home: Home; places: Place[]; directions: Direction[];
  afisha: Afisha | null; promos: Promo[]; menus: Menu[]; cakes: Cake[]; today: string };
export const getContent: () => Promise<Content>; // кешируется на сборку
```

Режим: `DIRECTUS_URL` + `DIRECTUS_TOKEN` → REST с теми же полями, что в
`export-fixture.mjs`; иначе `src/data/fixture.json`, картинки через
`import.meta.glob('../data/fixture-files/*', { eager: true })`. Оба пути
проходят одну функцию `normalize(raw, resolveImage)`. `today` — дата в
`Europe/Samara`. Картинка без `alt` → `Error('alt пуст у файла <title>')`.

- [x] **Шаг 1:** `content.check.ts` на фикстуре: телефон есть, две точки,
  у каждой семь строк часов, `hero_image` есть, `seo_title` ≤ 60,
  `seo_description` ≤ 160, у всех картинок `alt`, у направлений ровно пять
  разных ключей. При падении сообщение называет поле. Для фикстур-файлов:
  если папка пуста — `Error('нет src/data/fixture-files — запусти pnpm fixture')`.
- [x] **Шаг 2:** запуск → падение на импорте `content.ts`.
- [x] **Шаг 3:** `content.ts` (загрузка, нормализация, кеш в переменной модуля).
- [x] **Шаг 4:** `scripts/fetch-files.mjs` — качает в `public/media/<id>.<ext>`
  все PDF из `settings.policy_file`, `settings.offer_file`, `menus.file`;
  в режиме фикстуры копирует из `fixture-files/`.
- [x] **Шаг 5:** `pnpm test` зелёный (все три файла), `pnpm build` с
  `DIRECTUS_URL` и без него.
- [x] **Шаг 6:** коммит `feat(content): загрузчик контента из Directus и фикстуры`.

### Задача 2.5: Переключение существующих компонентов на контент

**Файлы:** `src/pages/index.astro`, `src/layouts/BaseLayout.astro`,
`src/components/Header.astro`, `Hero.astro`, `Reviews.astro`, `Contacts.astro`,
`YandexMap.astro`, `Footer.astro`, `Photo.astro`, `src/data/site.ts`,
`src/data/catalog.ts`.

- [x] **Шаг 1:** `index.astro` получает `const content = await getContent()` и
  передаёт в компоненты пропсами; старые секции пока остаются, но читают из
  `content`. `Photo.astro`: `photo.file` принимает `ImageMetadata | string`,
  для строки обязательны `width`/`height`.
- [x] **Шаг 2:** `BaseLayout.astro`: `title`/`description` из `home`,
  `robots` = `noindex` если `!home.robots_index` или превью-хост, OG из
  `home.og_image` (через `getImage` 1200×630) с фолбэком на `public/og.jpg`,
  JSON-LD из `content.places`, Метрика при `settings.metrika_id`.
- [x] **Шаг 3:** из `site.ts` удалить данные (`site`, `places`, `yandexStats`,
  `nav`, `footerLinks`, `ecosystem`); `catalog.ts` удалить; починить импорты.
  `yandexOrgUrl` → `https://yandex.ru/maps/org/${orgId}/` (без slug; проверить
  `curl -I` на оба id, что редирект ведёт на карточки).
- [x] **Шаг 4:** `pnpm test && pnpm check && pnpm build` зелёные, страница
  выглядит как раньше на 390/1440 (скриншоты, сравнить с
  `docs/screenshots/`).
- [x] **Шаг 5:** коммит `refactor(content): страница читает контент из Directus`.

---

## Этап 3. Каркас страницы

Перед этапом: загрузить дизайн-скиллы. Каждая задача заканчивается
скриншотами 390 и 1440 и осмотром.

### Задача 3.1: Диалог брони

**Файлы:** `src/components/BookingDialog.astro`, `src/scripts/booking-dialog.ts`,
`src/styles/global.css`, `src/layouts/BaseLayout.astro`.

**Интерфейс:** любой элемент с `data-book="Бронь стола"` открывает диалог с
этим заголовком. Диалог один, рендерится в `BaseLayout` перед `</body>`.

- [x] **Шаг 1:** разметка: `<dialog id="book" aria-labelledby="book-title">`,
  заголовок, строка `home.contacts_note`, три ссылки-кнопки: Telegram
  (`settings.telegram`), Max (`settings.max`), «Позвонить»
  (`settings.phoneHref`), кнопка «Закрыть» с `aria-label`. Кнопки —
  `MessengerButtons` + `.btn--secondary`.
- [x] **Шаг 2:** скрипт:

```ts
const dialog = document.getElementById('book') as HTMLDialogElement | null;
const title = dialog?.querySelector<HTMLElement>('#book-title');
if (dialog && title) {
  document.addEventListener('click', (e) => {
    const trigger = (e.target as Element).closest<HTMLElement>('[data-book]');
    if (!trigger) return;
    e.preventDefault();
    title.textContent = trigger.dataset.book || 'Бронь стола';
    dialog.showModal();
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
}
```

- [x] **Шаг 3:** стили: панель снизу на мобильном (`inset-block-end: 0`,
  радиус 24 сверху), по центру на десктопе, `::backdrop` тёплый полупрозрачный;
  вход 200 мс `ease-out` через `@starting-style`, выход 150 мс,
  `prefers-reduced-motion` — только opacity.
- [x] **Шаг 4:** проверка клавиатурой: Tab по трём кнопкам, Escape закрывает,
  фокус возвращается на триггер. Скриншоты.
- [x] **Шаг 5:** коммит `feat(booking): диалог брони через мессенджеры`.

### Задача 3.2: Шапка, навигация и нижняя полоса

**Файлы:** `Header.astro`, `StickyBar.astro`, `src/scripts/sticky-bar.ts`,
`src/lib/nav.ts`.

- [x] **Шаг 1:** `nav.ts`: `navFor(content)` → `[Главная #top, Афиша #afisha
  (если content.afisha), Доставка #delivery, О нас #about, Меню #menu,
  Контакты #contacts]`. Header рендерит один список (десктоп и мобильное меню
  через один фрагмент), кнопки «Забронировать стол» (`data-book`) и
  «Заказать доставку» (`settings.shop_url`), телефон.
- [x] **Шаг 2:** `StickyBar.astro`: две кнопки «Позвонить» и «Заказать
  доставку», `hidden` по умолчанию, скрипт показывает после выхода `#hero` из
  вьюпорта (IntersectionObserver), только `< 768px`. `padding-bottom` у
  `body` на высоту полосы, чтобы не закрывать подвал.
- [x] **Шаг 3:** мобильное меню: фокус-ловушка не нужна, но `body` получает
  `overflow: hidden` при открытом меню.
- [x] **Шаг 4:** скриншоты 390 (меню закрыто/открыто, полоса видна после
  скролла) и 1440. Коммит `feat(header): навигация визитки и нижняя полоса`.

### Задача 3.3: Первый экран

**Файлы:** `Hero.astro`.

- [ ] **Шаг 1:** фото `home.hero_image` на весь экран (мобильный —
  `min-height: 100svh`, десктоп — 82vh), текст поверх градиента снизу: H1
  `home.hero_title` (единственный, без дубля), лид, две кнопки, ниже строка с
  телефоном и две пилюли адресов «Садовая, 212Б · до 21:00» (из
  `openState`), пилюля афиши `content.afisha && «Афиша: title · дата →»`.
- [ ] **Шаг 2:** LCP: `getImage` preload в `BaseLayout` берёт `sizes` из одной
  константы `HERO_SIZES` в `src/lib/hero.ts`, а не дублирует.
- [ ] **Шаг 3:** контраст текста на фото ≥ 4,5:1 за счёт градиента; проверить
  на светлом фото.
- [ ] **Шаг 4:** скриншоты, коммит `feat(hero): первый экран визитки`.

### Задача 3.4: Направления

**Файлы:** `Directions.astro`.

- [x] **Шаг 1:** сетка `#about`: заголовок `home.about_title`, лид
  `home.about_text`; две большие карточки (`cafe`, `restaurant`): фото 16:9,
  адрес `place.name`, `OpenStatus` и часы, кнопки «Забронировать»
  (`data-book="Бронь стола: {place.street}"`), «Приложение» → `#delivery`,
  телефон текстом; три малые (`confectionery`: «Меню» → PDF из `menuFor`,
  «В приложении» → `shop_url`, «Позвонить»; `catering`: «На сайт» →
  `catering_url`, «Позвонить»; `banquets`: «Обсудить банкет»
  `data-book="Банкет"`). Кнопки по ключу — таблица в компоненте, без
  условий в разметке.
- [x] **Шаг 2:** на 390 — колонка, большие карточки с фото сверху; на 1440 —
  2 + 3. Шапка карточек по паттерну `.card-top`.
- [x] **Шаг 3:** скриншоты, коммит `feat(directions): пять направлений компании`.

---

## Этап 4. Секции контента

### Задача 4.1: Афиша

**Файлы:** `Afisha.astro`.

- [x] **Шаг 1:** секция рендерится только при `content.afisha`. Десктоп: две
  колонки, постер `<Image>` в натуральной пропорции (`width: clamp(300px,
  32vw, 480px)`, `--r-xl`), справа кикер «Афиша · {месяц}», H2 title, строка
  «{дата}{, time} · {place.name}», текст, кнопки «Забронировать стол»
  (`data-book`) и «Подробнее» при `link`. Мобильный: постер на всю ширину,
  текст под ним.
- [x] **Шаг 2:** дата по-русски через `Intl.DateTimeFormat('ru-RU', { day:
  'numeric', month: 'long' })`, `<time datetime>`.
- [x] **Шаг 3:** скриншоты, коммит `feat(afisha): секция афиши`.

### Задача 4.2: Акции

**Файлы:** `Promos.astro`.

- [x] **Шаг 1:** `livePromos` + `groupByPlace`; группы: «Обе точки» (null),
  затем по `places`. Карточка: заголовок, текст, кнопка по `cta` (`book` →
  `data-book`, `order` → `shop_url`, `none` → нет), внизу подпись адреса
  `place?.name ?? 'Обе точки'` через `.kicker`. Секция скрыта, если акций нет.
- [x] **Шаг 2:** сетка 1 / 2 / 3 колонки, карточки одинаковой высоты, кнопка
  прижата к низу.
- [x] **Шаг 3:** скриншоты, коммит `feat(promos): акции по адресам`.

### Задача 4.3: Меню

**Файлы:** `Menus.astro`.

- [x] **Шаг 1:** три карточки по направлениям `cafe`, `restaurant`,
  `confectionery`: заголовок направления, «обновлено {updated}» из `menuFor`,
  кнопки «Смотреть меню» (`file.href`, `target=_blank`, `rel=noopener`) и
  «Заказать в приложении» (`shop_url`). Карточка без меню показывает «Меню
  скоро» без кнопки PDF. Лид `home.menu_text`.
- [x] **Шаг 2:** скриншоты, коммит `feat(menu): меню трёх направлений`.

### Задача 4.4: Торты

**Файлы:** `Cakes.astro`.

- [ ] **Шаг 1:** упростить: без фильтров, сетка 2 / 3 / 4 колонки, фото 3:4 с
  подписью `title` и `note` на фото поверх градиента; первые 8 видны, «Показать
  ещё» раскрывает через класс на секции (лимит только в CSS). Кнопки секции:
  «Торт на заказ → написать» (`data-book="Торт на заказ"`) и «Торты в наличии»
  (`shop_cakes_ready ?? shop_url`). Заголовок и текст из `home`.
- [ ] **Шаг 2:** скриншоты, коммит `feat(cakes): витрина работ без цен`.

### Задача 4.5: Доставка и приложение

**Файлы:** `Delivery.astro`, `src/assets/appstore.svg`, `src/assets/googleplay.svg`.

- [x] **Шаг 1:** секция `#delivery` на оливковой панели по образцу карточки
  приложений из старого `Ecosystem.astro:54-63`: заголовок, текст, выгода
  `delivery_note` крупно, кнопки App Store / Google Play (иконки инлайн-SVG
  из assets) и «Открыть магазин». Справа мокап: `app_screenshot` внутри
  CSS-рамки телефона (скруглённый прямоугольник, тёмная рамка 8 px, без
  библиотек), на десктопе наклон `rotate(-6deg)`; без скриншота — рамка не
  рендерится, кнопки остаются.
- [x] **Шаг 2:** скриншоты, коммит `feat(delivery): приложение и магазин с мокапом`.

---

## Этап 5. Галерея и контакты

### Задача 5.1: Галерея по адресам

**Файлы:** `Gallery.astro`, `src/scripts/rail.ts`, `src/styles/global.css`.

- [x] **Шаг 1:** для каждой точки с фото — заголовок `place.name`, `.rail` со
  `scroll-snap`, кадры 4:3 шириной 82vw / 46vw / 31vw, подпись под фото
  (`caption`, иначе `alt` не дублировать — пусто). Стрелки «назад/вперёд»
  (`aria-label`) скроллят на ширину кадра, скрыты на тач-устройствах
  (`@media (hover: none)`). Секция скрыта, если фото нет ни у одной точки.
- [x] **Шаг 2:** `rail.ts`: `[data-rail]` + `[data-rail-prev]`/`[data-rail-next]`,
  `scrollBy({ left: ±card.width, behavior: matchMedia(reduce) ? 'auto' : 'smooth' })`.
- [x] **Шаг 3:** скриншоты, коммит `feat(gallery): ленты фото по адресам`.

### Задача 5.2: Починка ленивого кадра

**Файлы:** `src/scripts/lazy-frame.ts`, `Reviews.astro`.

- [x] **Шаг 1:** воспроизвести: клик «Показать на карте» второй точки → через
  секунду виджет откатывается на первую (`scrollIntoView` будит наблюдатель).
- [x] **Шаг 2:** в обработчике клика `observer?.disconnect()`; в `mount()`
  писать `holder.dataset.src = src`; `start()` монтирует только если кадра ещё
  нет. Ссылка «все отзывы» в `Reviews.astro:124-130` следует за активной
  вкладкой (`data-frame-link`).
- [x] **Шаг 3:** руками в браузере: переключение точек и вкладок отзывов
  держится. Коммит `fix(frames): виджет не откатывается на первую точку`.

### Задача 5.3: Карта на две точки

**Файлы:** `YandexMap.astro`, `src/scripts/yandex-map.ts`, `Contacts.astro`.

- [x] **Шаг 1:** при `PUBLIC_YANDEX_MAPS_KEY`: контейнер `data-map` с
  `data-places={JSON.stringify(places.map(({id,name,lat,lng,yandex_org})=>…))}`;
  скрипт лениво (IntersectionObserver, 400 px) подключает
  `https://api-maps.yandex.ru/v3/?apikey=KEY&lang=ru_RU`, ждёт `ymaps3.ready`,
  создаёт `YMap` c `location: { bounds }` по обеим точкам + `margin`, слои
  `YMapDefaultSchemeLayer`, `YMapDefaultFeaturesLayer`, две `YMapMarker` с
  HTML-меткой (круг `--terracotta` с номером, подпись адреса), клик по метке
  → `yandexOrgUrl`. «Показать на карте» → `map.setLocation({ center, zoom: 16,
  duration: 300 })` и подсветка метки. Без ключа — текущий iframe-виджет с
  починкой из 5.2 и комментарием, что нужен ключ.
- [x] **Шаг 2:** `Contacts.astro`: карточки точек из `content.places`, «Открыть
  в Яндекс Картах» у каждой точки на её `yandex_org`; блок «Написать нам» с
  `contacts_note`.
- [x] **Шаг 3:** если скрипт не загрузился за 8 с — показать ссылки «Открыть в
  Яндекс Картах» вместо карты.
- [x] **Шаг 4:** скриншоты, коммит `feat(map): две точки на карте Яндекса`.

### Задача 5.4: Отзывы и подвал из контента

**Файлы:** `Reviews.astro`, `Footer.astro`.

- [ ] **Шаг 1:** цифры из `settings.yandex_*`, рубрики из
  `yandex_highlights`; при пустой оценке блок цифр скрыт, виджет остаётся.
- [ ] **Шаг 2:** подвал: юрстрока `legal_name · ИНН · ОГРН` (только заполненные),
  ссылки политики и оферты на `/media/…pdf` или скрыты, ссылки на магазин,
  кейтеринг, приложения, VK, Telegram из `settings`.
- [ ] **Шаг 3:** скриншоты, коммит `refactor(footer): отзывы и подвал из админки`.

### Задача 5.5: Сборка страницы

**Файлы:** `src/pages/index.astro`, удаление старых компонентов.

- [ ] **Шаг 1:** порядок: Header → Hero → Directions → Afisha → Promos →
  Menus → Cakes → Gallery → Delivery → Reviews → Contacts → Footer;
  `BookingDialog` и `StickyBar` в `BaseLayout`.
- [ ] **Шаг 2:** удалить `Bento`, `Sweets`, `Room`, `HowToOrder`, `Ecosystem`,
  `CustomCake`, `handoff/`; вычистить неиспользуемый CSS (`.blob` оставить,
  если используется).
- [ ] **Шаг 3:** `pnpm test && pnpm check && pnpm build`; скриншоты всей
  страницы 390 / 834 / 1440; первый прогон полировки по `impeccable audit`.
- [ ] **Шаг 4:** коммит `feat(page): сборка визитки из новых секций`.

---

## Этап 6. Цепочка сборки на VPS

### Задача 6.1: Файлы деплоя

**Файлы:** `deploy/build.sh`, `deploy/backup.sh`, `deploy/crontab.txt`,
`deploy/webhook/hooks.json`, `deploy/nginx/vkus-com.ru.conf`,
`deploy/nginx/admin.vkus-com.ru.conf`.

- [x] **Шаг 1:** `build.sh`:

```bash
#!/usr/bin/env bash
# Сборка сайта в новый релиз и атомарное переключение. Запуск: webhook, cron, Actions.
set -euo pipefail
ROOT=/srv/vkus
SITE=$ROOT/site
RELEASES=$ROOT/releases
LOCK=/tmp/vkus-build.lock
exec 9>"$LOCK"; flock -n 9 || { echo "сборка уже идёт"; exit 0; }
cd "$SITE"
set -a; . "$SITE/.env"; set +a
export PATH="$HOME/.local/share/pnpm:$PATH"
pnpm install --frozen-lockfile --prefer-offline
pnpm build
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$RELEASES"
cp -r dist "$RELEASES/$STAMP"
ln -sfn "$RELEASES/$STAMP" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"
ls -1dt "$RELEASES"/* | tail -n +6 | xargs -r rm -rf
echo "релиз $STAMP"
```

- [x] **Шаг 2:** `hooks.json` для `adnanh/webhook`: id `rebuild`, команда
  `/srv/vkus/site/deploy/build.sh`, триггер по заголовку `X-Hook-Secret`,
  `execute-command` через `systemd-run --unit=vkus-build-$$` или напрямую;
  ответ сразу, сборка в фоне (`"response-message": "принято"`).
- [x] **Шаг 3:** nginx: сайт — `root /srv/vkus/current`, `gzip`/`brotli` если
  есть, `location /_astro/ { expires 1y; add_header Cache-Control "public,
  immutable"; }`, `location /media/ { expires 7d; }`, `error_page 404
  /404.html`; админка — `location /hooks/ { proxy_pass http://127.0.0.1:9000; }`,
  остальное `proxy_pass http://127.0.0.1:8055` с `client_max_body_size 64m` и
  вебсокет-заголовками; оба с certbot-строками.
- [x] **Шаг 4:** `backup.sh` (pg_dump через `docker compose exec -T database`,
  tar `uploads/`, хранить 14 дней) и `crontab.txt`:
  `10 0 * * * /srv/vkus/site/deploy/build.sh` и `30 3 * * *
  /srv/vkus/site/deploy/backup.sh`.
- [x] **Шаг 5:** `bash -n` на скриптах, `nginx -t` недоступен — проверить
  конфиг глазами. Коммит `feat(deploy): сборка релизов на VPS по вебхуку и крону`.

### Задача 6.2: GitHub Actions и превью

**Файлы:** `.github/workflows/deploy.yml`.

- [x] **Шаг 1:** удалить GH Pages workflow; новый: `on: push: branches: [main]`,
  шаг `webfactory/ssh-agent` с `secrets.VPS_SSH_KEY`, затем
  `ssh deploy@$VPS "cd /srv/vkus/site && git pull --ff-only && deploy/build.sh"`.
  Секреты: `VPS_HOST`, `VPS_SSH_KEY`. Пока VPS нет — workflow с `if:
  ${{ secrets.VPS_HOST != '' }}`.
- [x] **Шаг 2:** коммит `feat(ci): выкладка на VPS по пушу в main`.

### Задача 6.3: `docs/DIRECTUS.md`

- [x] **Шаг 1:** пошагово: установка Docker на Ubuntu, клон репо в
  `/srv/vkus/site`, `.env` для Directus и для сайта, `docker compose up -d`,
  `schema apply` из `snapshot.yaml`, `pnpm setup` (роли, сборщик, Flow),
  импорт контента (`pnpm fixture` в обратную сторону не нужен: контент
  заводится руками или переносится дампом), установка `webhook`, nginx,
  certbot, crontab, проверка «опубликовать афишу → сайт обновился». Плюс
  эксплуатация: обновление Directus (смена тега), восстановление из бэкапа,
  где лежат логи.
- [x] **Шаг 2:** коммит `docs(directus): установка и эксплуатация админки`.

---

## Этап 7. Полировка и документация

### Задача 7.1: Два прогона полировки

- [ ] **Шаг 1:** `impeccable audit` по всей странице → список → правки →
  повторный audit. Затем `make-interfaces-feel-better` по деталям: оптика
  иконок, tabular-nums, радиусы, тени.
- [ ] **Шаг 2:** чек: контраст ≥ 4,5:1 всех пар текст/фон (включая текст на
  фото), `focus-visible` везде, `aria-label` на icon-only кнопках, нет
  `transition: all` / `ease-in` / `scale(0)`, reduced-motion, 320 px без
  горизонтального скролла.
- [ ] **Шаг 3:** Lighthouse mobile ≥ 90 perf (`pnpm build && pnpm preview`,
  Chrome DevTools MCP или lighthouse MCP).
- [ ] **Шаг 4:** скриншоты в `docs/screenshots/` обновить, коммит
  `style(landing): полировка визитки`.

### Задача 7.2: Документация

**Файлы:** `docs/PRODUCT.md`, `docs/DESIGN.md`, `README.md`.

- [x] **Шаг 1:** `PRODUCT.md`: «Что это» — визитка компании с пятью
  направлениями; «Кто приходит» + гость ресторана и заказчик банкета;
  принципы остаются (мессенджер вместо формы); «Данные точек» → «Контент в
  Directus»; чеклист клиента: постер, PDF меню, скриншот приложения, ключ
  Карт, VPS, SMTP.
- [ ] **Шаг 2:** `DESIGN.md`: новые паттерны — диалог, постер, карточка акции,
  лента галереи, нижняя полоса, мокап телефона; раздел «Движение» дополнить
  константами из CLAUDE.md.
- [ ] **Шаг 3:** `README.md`: команды pnpm, переменные окружения, локальный
  Directus, фикстура, деплой на VPS, Vercel как превью, ссылка на
  `docs/DIRECTUS.md`; Windows-предупреждение оставить.
- [ ] **Шаг 4:** коммит `docs: документация визитки и Directus`.

### Задача 7.3: Финальная проверка и отчёт

- [ ] `pnpm test && pnpm check && pnpm build` зелёные с Directus и с фикстурой.
- [ ] Под ролью «Редактор»: сменить афишу, добавить акцию, заменить PDF,
  добавить фото в галерею — после `pnpm build` всё на странице.
- [ ] Все чекбоксы плана отмечены, ветка `feature/vizitka-directus` чистая.
- [ ] Отчёт в чат: сделано, решения, отложено, что нужно от клиента;
  дубль в Telegram.
