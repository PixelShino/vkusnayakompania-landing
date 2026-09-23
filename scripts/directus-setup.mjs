// Directus one-time setup: editor role, builder user with a static token,
// the "rebuild site" flow. Idempotent: re-running creates nothing twice.
// Разовая настройка Directus: роль редактора, сборщик со статическим токеном,
// Flow пересборки. Идемпотентен: повторный запуск ничего не дублирует.
//
// Run / Запуск:
//   DIRECTUS_URL=http://localhost:8055 DIRECTUS_ADMIN_TOKEN=… node scripts/directus-setup.mjs
// Optional / Необязательно: REBUILD_HOOK_URL, REBUILD_HOOK_SECRET

const BASE = process.env.DIRECTUS_URL ?? 'http://localhost:8055';
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
const HOOK_URL = process.env.REBUILD_HOOK_URL ?? 'http://127.0.0.1:9000/hooks/rebuild';
const HOOK_SECRET = process.env.REBUILD_HOOK_SECRET ?? '';
if (!TOKEN) throw new Error('DIRECTUS_ADMIN_TOKEN обязателен');

const api = async (method, path, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : (await r.json()).data;
};
const findOne = async (path, filter) =>
  (await api('GET', `${path}?filter=${encodeURIComponent(JSON.stringify(filter))}&limit=1`))[0];

// editors manage these freely / редактор правит свободно
const CONTENT = ['afisha', 'promos', 'menus', 'cakes', 'places_files'];
// editors may only update these / редактор только меняет, не создаёт и не удаляет
const SINGLE = ['settings', 'home', 'places', 'directions'];
const ALL = ['create', 'read', 'update', 'delete'];

// 1. policy + role «Редактор»
let policy = await findOne('/policies', { name: { _eq: 'Редактор' } });
if (!policy) {
  policy = await api('POST', '/policies', { name: 'Редактор', icon: 'edit', app_access: true, admin_access: false });
  console.log('+ policy Редактор');
}
let role = await findOne('/roles', { name: { _eq: 'Редактор' } });
if (!role) {
  role = await api('POST', '/roles', { name: 'Редактор', icon: 'edit', policies: [{ policy: policy.id }] });
  console.log('+ role Редактор');
}

// 2. permissions of the editor policy / права редактора
const existing = await api('GET', `/permissions?filter[policy][_eq]=${policy.id}&limit=-1`);
const has = (collection, action) => existing.some((p) => p.collection === collection && p.action === action);
const perms = [];
const add = (collection, action, fields = ['*']) => {
  if (!has(collection, action)) perms.push({ policy: policy.id, collection, action, fields });
};
for (const c of CONTENT) for (const a of ALL) add(c, a);
for (const c of SINGLE) {
  add(c, 'read');
  // the direction key drives the card buttons; editors must not change it
  // ключ направления определяет кнопки карточки, редактору его менять нельзя
  add(c, 'update', c === 'directions' ? ['title', 'text', 'photo', 'place', 'sort'] : ['*']);
}
for (const a of ALL) add('directus_files', a);
for (const a of ['create', 'read', 'update']) add('directus_folders', a);
if (perms.length) {
  await api('POST', '/permissions', perms);
  console.log(`+ ${perms.length} permissions Редактор`);
}

// 3. builder: read-only policy, role, user with a static token
//    сборщик: политика только на чтение, роль, пользователь со статическим токеном
let bpolicy = await findOne('/policies', { name: { _eq: 'Сборщик' } });
if (!bpolicy) {
  bpolicy = await api('POST', '/policies', { name: 'Сборщик', icon: 'build', app_access: false, admin_access: false });
  console.log('+ policy Сборщик');
}
const bexisting = await api('GET', `/permissions?filter[policy][_eq]=${bpolicy.id}&limit=-1`);
const bperms = [...CONTENT, ...SINGLE, 'directus_files']
  .filter((c) => !bexisting.some((p) => p.collection === c))
  .map((c) => ({ policy: bpolicy.id, collection: c, action: 'read', fields: ['*'] }));
if (bperms.length) {
  await api('POST', '/permissions', bperms);
  console.log(`+ ${bperms.length} permissions Сборщик`);
}
let brole = await findOne('/roles', { name: { _eq: 'Сборщик' } });
if (!brole) {
  brole = await api('POST', '/roles', { name: 'Сборщик', icon: 'build', policies: [{ policy: bpolicy.id }] });
  console.log('+ role Сборщик');
}
let builder = await findOne('/users', { email: { _eq: 'builder@vkus-com.ru' } });
if (!builder) {
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  builder = await api('POST', '/users', {
    email: 'builder@vkus-com.ru', first_name: 'Сборщик', last_name: 'сайта', role: brole.id, status: 'active', token,
  });
  console.log(`+ user builder@vkus-com.ru\nDIRECTUS_TOKEN=${token}\n  (сохранить в .env сайта, больше не покажется)`);
}

// 4. flow «Пересборка сайта»: any content change → POST to the rebuild hook
//    Flow: любое изменение контента → POST на вебхук пересборки
let flow = await findOne('/flows', { name: { _eq: 'Пересборка сайта' } });
if (!flow) {
  flow = await api('POST', '/flows', {
    name: 'Пересборка сайта', icon: 'published_with_changes', color: '#6F7546', status: 'active',
    description: 'После любого изменения контента дёргает вебхук на VPS, тот собирает сайт заново',
    trigger: 'event', accountability: 'all',
    options: {
      type: 'action',
      scope: ['items.create', 'items.update', 'items.delete'],
      collections: [...CONTENT, ...SINGLE, 'directus_files'],
    },
  });
  const op = await api('POST', '/operations', {
    flow: flow.id, name: 'Дёрнуть вебхук', key: 'rebuild', type: 'request', position_x: 19, position_y: 1,
    options: {
      method: 'POST',
      url: HOOK_URL,
      headers: [{ header: 'X-Hook-Secret', value: HOOK_SECRET }, { header: 'Content-Type', value: 'application/json' }],
      body: '{"reason":"{{$trigger.event}}"}',
    },
  });
  await api('PATCH', `/flows/${flow.id}`, { operation: op.id });
  console.log('+ flow Пересборка сайта');
}

// 5. project: name, colour and Russian UI, the sign-in page included
//    проект: имя, цвет и русский интерфейс, включая страницу входа
await api('PATCH', '/settings', {
  project_name: 'Вкусная компания', project_descriptor: 'Админка сайта', project_color: '#6F7546', default_language: 'ru-RU',
});
console.log('= проект: имя и русский язык');

console.log('setup: готово');
