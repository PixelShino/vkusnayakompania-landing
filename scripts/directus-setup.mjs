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
const CONTENT = [
  'afisha', 'promos', 'menus', 'cakes', 'places_files', 'directions_files',
  // the delivery catalog: sections and dishes / каталог доставки: разделы и блюда
  'product_categories', 'products',
  // the catering page: formats, steps, questions and its photos
  // страница кейтеринга: форматы, шаги, вопросы и её фото
  'catering_formats', 'catering_steps', 'catering_faq', 'catering_page_files',
];
// Orders hold names, phones and addresses: editors take and close them (and
// enter phone orders), nobody deletes them — a cancelled order is a status.
// The builder never reads them, the public may only create one.
// В заказах имена, телефоны и адреса: редактор принимает и закрывает их (и
// вбивает заказы по телефону), удалять их не может никто — отмена это статус.
// Сборщик их не читает, публичная роль может только создать.
const ORDERS = 'orders';
const ORDER_FIELDS_PUBLIC = [
  'number', 'customer_name', 'phone', 'fulfillment', 'place', 'address', 'address_details',
  'desired_time', 'comment', 'items', 'total', 'consent',
  // set by the `order-guard` hook, which runs before permissions are checked
  // ставит хук `order-guard`, он работает до проверки прав
  'status', 'source', 'manager_note',
];
// Catering requests hold names, phones and dates: the same rules as orders —
// editors take and close them (and enter requests taken by phone), nobody
// deletes them, the builder never reads them, the public may only create one.
// В заявках на кейтеринг имена, телефоны и даты: правила те же, что у заказов —
// редактор принимает и закрывает их (и вбивает заявки с телефона), удалять не
// может никто, сборщик их не читает, публичная роль может только создать.
const REQUESTS = 'catering_requests';
const REQUEST_FIELDS_PUBLIC = [
  'name', 'phone', 'event_date', 'guests', 'format', 'venue', 'place', 'address', 'wishes', 'consent',
  // set by the `request-guard` hook, which runs before permissions are checked
  // ставит хук `request-guard`, он работает до проверки прав
  'number', 'status', 'source', 'manager_note',
];
// editors may only update these / редактор только меняет, не создаёт и не удаляет
const SINGLE = ['settings', 'home', 'places', 'directions', 'catering_page'];
const ALL = ['create', 'read', 'update', 'delete'];
// the direction key drives the card buttons; editors must not change it.
// `gallery` is the M2M alias: without it the editor sees the photos but cannot add any
// ключ направления определяет кнопки карточки, редактору его менять нельзя.
// `gallery` — алиас M2M: без него редактор видит фото, но добавить не может
const DIRECTION_FIELDS = ['title', 'text', 'photo', 'place', 'sort', 'gallery'];

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
  add(c, 'update', c === 'directions' ? DIRECTION_FIELDS : ['*']);
}
for (const a of ['create', 'read', 'update']) add(ORDERS, a);
for (const a of ['create', 'read', 'update']) add(REQUESTS, a);
for (const a of ALL) add('directus_files', a);
for (const a of ['create', 'read', 'update']) add('directus_folders', a);
// build status is written by the builder, editors only watch it
// статус сборки пишет сборщик, редактор только смотрит
add('site_build', 'read');
if (perms.length) {
  await api('POST', '/permissions', perms);
  console.log(`+ ${perms.length} permissions Редактор`);
}
// an older install has the direction update with a shorter field list: widen it
// в старой инсталляции update направлений с коротким списком полей — дополнить
const dirUpdate = existing.find((p) => p.collection === 'directions' && p.action === 'update');
const dirMissing = dirUpdate?.fields?.includes('*')
  ? []
  : DIRECTION_FIELDS.filter((f) => !dirUpdate?.fields?.includes(f));
if (dirUpdate && dirMissing.length) {
  await api('PATCH', `/permissions/${dirUpdate.id}`, { fields: [...(dirUpdate.fields ?? []), ...dirMissing] });
  console.log(`= permissions Редактор: directions update + ${dirMissing.join(', ')}`);
}

// 3. builder: read-only policy (plus its own build status), role, user with a static token
//    сборщик: политика только на чтение (кроме своего статуса сборки), роль,
//    пользователь со статическим токеном
let bpolicy = await findOne('/policies', { name: { _eq: 'Сборщик' } });
if (!bpolicy) {
  bpolicy = await api('POST', '/policies', { name: 'Сборщик', icon: 'build', app_access: false, admin_access: false });
  console.log('+ policy Сборщик');
}
const bexisting = await api('GET', `/permissions?filter[policy][_eq]=${bpolicy.id}&limit=-1`);
// the watchdog reads the activity log to see whether a change missed a build
// сторож читает журнал действий, чтобы понять, не прошла ли правка мимо сборки
const bperms = [...CONTENT, ...SINGLE, 'directus_files', 'directus_activity']
  .filter((c) => !bexisting.some((p) => p.collection === c))
  .map((c) => ({ policy: bpolicy.id, collection: c, action: 'read', fields: ['*'] }));
// PATCH on an empty singleton creates the row, hence `create`
// PATCH пустого одиночного создаёт запись, поэтому нужен и `create`
for (const action of ['read', 'create', 'update']) {
  if (!bexisting.some((p) => p.collection === 'site_build' && p.action === action)) {
    bperms.push({ policy: bpolicy.id, collection: 'site_build', action, fields: ['*'] });
  }
}
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

// 3a. public: create an order and nothing else. Without read the API answers
//     204 and the visitor never sees anyone's order, his own included. Presets
//     and validation hold even if the `order-guard` hook is not loaded.
//     публичная роль: создать заказ — и только. Без чтения API отвечает 204,
//     и посетитель не видит ничьих заказов, включая свой. Пресеты и проверка
//     держат даже без загруженного хука `order-guard`.
const [publicAccess] = await api('GET', `/access?filter[role][_null]=true&filter[user][_null]=true&limit=1`);
if (!publicAccess) throw new Error('нет публичной политики ($t:public_label)');
const pexisting = await api('GET', `/permissions?filter[policy][_eq]=${publicAccess.policy}&limit=-1`);
const publicOrder = {
  fields: ORDER_FIELDS_PUBLIC,
  presets: { status: 'new', source: 'site' },
  validation: {
    _and: [
      { status: { _eq: 'new' } },
      { source: { _eq: 'site' } },
      { consent: { _eq: true } },
      { customer_name: { _nempty: true } },
      { phone: { _nempty: true } },
    ],
  },
};
const publicRequest = {
  fields: REQUEST_FIELDS_PUBLIC,
  presets: { status: 'new', source: 'site' },
  validation: {
    _and: [
      { status: { _eq: 'new' } },
      { source: { _eq: 'site' } },
      { consent: { _eq: true } },
      { name: { _nempty: true } },
      { phone: { _nempty: true } },
    ],
  },
};
// one rule for orders and catering requests: create with the listed fields,
// anything else for the public is a leak and goes
// одно правило для заказов и заявок: создание с перечисленными полями, любое
// другое право публичной роли — утечка и убирается
for (const [collection, rule] of [
  [ORDERS, publicOrder],
  [REQUESTS, publicRequest],
]) {
  const pcreate = pexisting.find((p) => p.collection === collection && p.action === 'create');
  if (!pcreate) {
    await api('POST', '/permissions', { policy: publicAccess.policy, collection, action: 'create', ...rule });
    console.log(`+ permission Публичная: ${collection} create`);
  } else if (rule.fields.some((f) => !pcreate.fields?.includes(f))) {
    await api('PATCH', `/permissions/${pcreate.id}`, rule);
    console.log(`= permission Публичная: ${collection} create — поля обновлены`);
  }
  for (const p of pexisting.filter((p) => p.collection === collection && p.action !== 'create')) {
    await api('DELETE', `/permissions/${p.id}`);
    console.log(`- permission Публичная: ${collection} ${p.action}`);
  }
}

// 3b. how the lists open: orders newest first with the columns a manager
//     calls from, dishes with a photo; plus a few bookmarks
//     как открываются списки: заказы — свежие сверху, с колонками, по которым
//     менеджер звонит; блюда — с фото; и несколько закладок
const PRESETS = [
  {
    collection: ORDERS,
    layout_query: {
      tabular: {
        fields: ['status', 'number', 'date_created', 'customer_name', 'phone', 'fulfillment', 'total'],
        sort: ['-date_created'],
        limit: 50,
      },
    },
    layout_options: { tabular: { widths: { status: 120, number: 120, date_created: 150, customer_name: 180, phone: 170, fulfillment: 130, total: 110 } } },
  },
  { collection: ORDERS, bookmark: 'Новые', icon: 'fiber_new', color: '#C67139', filter: { status: { _eq: 'new' } } },
  { collection: ORDERS, bookmark: 'В работе', icon: 'pending_actions', color: '#6F7546', filter: { status: { _eq: 'in_work' } } },
  {
    collection: 'products',
    layout_query: {
      tabular: { fields: ['photo', 'title', 'category', 'price', 'weight', 'available', 'status'], sort: ['sort'], limit: 100 },
    },
    layout_options: { tabular: { widths: { photo: 64, title: 300, category: 160, price: 100, weight: 130, available: 100, status: 150 } } },
  },
  { collection: 'products', bookmark: 'Нет в наличии', icon: 'remove_shopping_cart', filter: { available: { _eq: false } } },
  // catering requests: newest first, the columns a manager calls from and
  // plans by; formats with a photo and the price; questions by topic
  // заявки на кейтеринг: свежие сверху, с колонками, по которым менеджер звонит
  // и планирует; форматы — с фото и ценой; вопросы — по темам
  {
    collection: REQUESTS,
    layout_query: {
      tabular: {
        fields: ['status', 'number', 'date_created', 'name', 'phone', 'event_date', 'guests', 'format', 'venue'],
        sort: ['-date_created'],
        limit: 50,
      },
    },
    layout_options: {
      tabular: { widths: { status: 120, number: 110, date_created: 140, name: 170, phone: 160, event_date: 150, guests: 90, format: 170, venue: 140 } },
    },
  },
  { collection: REQUESTS, bookmark: 'Новые', icon: 'fiber_new', color: '#C67139', filter: { status: { _eq: 'new' } } },
  { collection: REQUESTS, bookmark: 'В работе', icon: 'pending_actions', color: '#6F7546', filter: { status: { _in: ['in_work', 'contract'] } } },
  {
    collection: 'catering_formats',
    layout_query: {
      tabular: { fields: ['photo', 'title', 'price_from', 'price_unit', 'guests_to', 'status'], sort: ['sort'], limit: 50 },
    },
    layout_options: { tabular: { widths: { photo: 64, title: 260, price_from: 120, price_unit: 120, guests_to: 110, status: 150 } } },
  },
  {
    collection: 'catering_faq',
    layout_query: { tabular: { fields: ['question', 'topic', 'featured', 'status'], sort: ['sort'], limit: 100 } },
    layout_options: { tabular: { widths: { question: 420, topic: 260, featured: 120, status: 150 } } },
  },
  { collection: 'catering_faq', bookmark: 'На обзорной', icon: 'star', filter: { featured: { _eq: true } } },
];
const presetsNow = await api('GET', `/presets?filter[user][_null]=true&filter[role][_null]=true&limit=-1`);
for (const preset of PRESETS) {
  const same = presetsNow.find((p) => p.collection === preset.collection && (p.bookmark ?? null) === (preset.bookmark ?? null));
  if (same) continue;
  await api('POST', '/presets', { layout: 'tabular', user: null, role: null, bookmark: null, ...preset });
  console.log(`+ preset ${preset.collection}${preset.bookmark ? ` «${preset.bookmark}»` : ''}`);
}

// 4. flow «Пересборка сайта»: any content change → POST to the rebuild hook
//    Flow: любое изменение контента → POST на вебхук пересборки
// items.sort: a reorder by drag-and-drop is not an update, without it the new
// order waited for the nightly build
// items.sort: перетаскивание порядка — не update, без него новый порядок ждал
// ночной сборки
const FLOW_SCOPE = ['items.create', 'items.update', 'items.delete', 'items.sort'];
// orders and catering requests are not here: a new one changes nothing on the site
// заказов и заявок здесь нет: новый заказ или заявка ничего на сайте не меняют
const FLOW_COLLECTIONS = [...CONTENT, ...SINGLE, 'directus_files', 'loyalty_settings'];
let flow = await findOne('/flows', { name: { _eq: 'Пересборка сайта' } });
if (flow && FLOW_SCOPE.some((event) => !flow.options?.scope?.includes(event))) {
  flow.options = { ...flow.options, scope: FLOW_SCOPE };
  await api('PATCH', `/flows/${flow.id}`, { options: flow.options });
  console.log('= flow Пересборка сайта: scope дополнен');
}
// a collection added after the first setup (directions_files) joins the trigger;
// what was added by hand in the admin stays
// коллекция, появившаяся после первой настройки (directions_files), входит в
// триггер; добавленное руками в админке остаётся
const flowMissing = FLOW_COLLECTIONS.filter((c) => !flow?.options?.collections?.includes(c));
if (flow && flowMissing.length) {
  flow.options = { ...flow.options, collections: [...(flow.options.collections ?? []), ...flowMissing] };
  await api('PATCH', `/flows/${flow.id}`, { options: flow.options });
  console.log(`= flow Пересборка сайта: collections + ${flowMissing.join(', ')}`);
}
if (!flow) {
  flow = await api('POST', '/flows', {
    name: 'Пересборка сайта', icon: 'published_with_changes', color: '#6F7546', status: 'active',
    description: 'После любого изменения контента дёргает вебхук на VPS, тот собирает сайт заново',
    trigger: 'event', accountability: 'all',
    options: {
      type: 'action',
      scope: FLOW_SCOPE,
      collections: FLOW_COLLECTIONS,
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

await (await import('./setup/account.mjs')).setup(api, { findOne, ORDER_FIELDS_PUBLIC }); // личный кабинет и «Вкусные баллы»
console.log('setup: готово');
