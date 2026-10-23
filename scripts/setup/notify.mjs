// Setup for the order alerts and the publication notices: who may see and
// change «Оповещения», who reads the delivery log, and what the builder needs
// to ring the bell after a build. Called once at the end of
// `scripts/directus-setup.mjs`; idempotent like the rest of it.
// Настройка оповещений о заказах и уведомлений о публикации: кто видит и
// меняет «Оповещения», кто читает журнал доставки и что нужно сборщику, чтобы
// после сборки позвонить в колокольчик. Вызывается один раз в конце
// `scripts/directus-setup.mjs`; повторный запуск ничего не дублирует.

// the bot token is a key to the bot: only an administrator sees it
// токен бота — ключ от бота: его видит только администратор
const SECRET_FIELDS = ['telegram_token'];
// written by the `notify` extension, not by people: the mail state on start,
// the chats and topics the bot saw while polling
// пишет расширение `notify`, а не люди: состояние почты при запуске, чаты и
// темы, которые бот видел в опросе
const MACHINE_FIELDS = ['email_state', 'email_ready', 'telegram_seen'];

const SETTINGS = 'notify_settings';
// the chat rows (since 23.10.2026 evening): a forum topic and a third tick.
// `schema apply` does not update `meta.options` of an existing field, so the
// list's sub-fields are PATCHed here; «Заказы» and «Заявки» stay on by
// default, «Неоформленные» is off
// строки чатов (с вечера 23.10.2026): тема форума и третья галочка. `schema
// apply` не обновляет `meta.options` существующего поля, поэтому подполя
// списка правятся здесь PATCH-ем; «Заказы» и «Заявки» по умолчанию включены,
// «Неоформленные» — выключены
const CHATS_META = {
  note:
    'Личный чат или рабочая группа. Бот должен быть добавлен в группу (лучше администратором), а в личке — запущен кнопкой «Старт». ' +
    'Группа с темами: chat_id один, по строке на тему; «Тема (ID)» — из «Чатов и тем, которые видел бот», пусто — General. ' +
    'Галочки независимы: снимите лишние явно.',
  options: {
    addLabel: 'Добавить чат',
    template: '{{label}} · {{chat_id}}',
    fields: [
      { field: 'label', name: 'Подпись', type: 'string', meta: { interface: 'input', width: 'half', options: { placeholder: 'Группа «Заказы»' } } },
      {
        field: 'chat_id',
        name: 'chat_id',
        type: 'string',
        meta: { interface: 'input', width: 'half', required: true, options: { placeholder: '-1001234567890', font: 'monospace', trim: true } },
      },
      {
        field: 'thread_id',
        name: 'Тема (ID)',
        type: 'string',
        meta: {
          interface: 'input',
          width: 'full',
          note: 'Номер темы в группе с темами. Пусто — общий чат (General) или группа без тем.',
          options: { placeholder: 'пусто — General', font: 'monospace', trim: true },
        },
      },
      { field: 'orders', name: 'Заказы', type: 'boolean', schema: { default_value: true }, meta: { interface: 'boolean', width: 'half', options: { label: 'Заказы доставки' } } },
      { field: 'requests', name: 'Заявки', type: 'boolean', schema: { default_value: true }, meta: { interface: 'boolean', width: 'half', options: { label: 'Заявки на кейтеринг' } } },
      {
        field: 'pending',
        name: 'Неоформленные',
        type: 'boolean',
        schema: { default_value: false },
        meta: {
          interface: 'boolean',
          width: 'full',
          note: 'Короткое сообщение «Начал оформление», когда гость пошёл платить онлайн, а банк ещё не подтвердил; потом в нём появится «Оплачен…» или «Не оплачен…».',
          options: { label: 'Неоформленные' },
        },
      },
    ],
  },
};
// the old help sent people to getUpdates in a browser: with the poll running
// that answers «Conflict», so the help now points to the seen list
// старая подсказка посылала в браузер к getUpdates: при работающем опросе там
// «Conflict», поэтому подсказка теперь ведёт к списку виденного
const HELP_TEXT =
  'Как подключить бота. 1) В Telegram откройте @BotFather → /newbot, придумайте имя и адрес бота — BotFather пришлёт токен, вставьте его в «Токен бота», ' +
  'отметьте «Отправлять в Telegram» и сохраните. 2) Добавьте бота в рабочую группу администратором (или нажмите «Старт» в личке с ботом). ' +
  '3) Напишите в группе любое слово — в нужной теме, если темы включены: через несколько секунд чат и тема появятся ниже, в «Чатах и темах, ' +
  'которые видел бот», с chat_id и «Темой (ID)». 4) Добавьте строку в «Чаты» с этими числами и галочками и сохраните. Проверочное сообщение ' +
  'отправляет администратор — см. docs/NOTIFY.md.';
const SEEN_FIELD = {
  field: 'telegram_seen',
  type: 'json',
  meta: {
    interface: 'list',
    special: ['cast-json'],
    readonly: true,
    width: 'full',
    note:
      'Добавьте бота в группу администратором и напишите в нужной теме любое слово — через несколько секунд она появится здесь с chat_id и ' +
      '«Темой (ID)» (обновите страницу). Работает, когда отмечено «Отправлять в Telegram». Бот хранит только названия и номера, не тексты.',
    translations: [{ language: 'ru-RU', translation: 'Чаты и темы, которые видел бот' }],
    options: {
      template: '{{label}}',
      fields: [
        { field: 'title', name: 'Чат', type: 'string', meta: { interface: 'input', width: 'half', readonly: true } },
        { field: 'chat_id', name: 'chat_id', type: 'string', meta: { interface: 'input', width: 'half', readonly: true, options: { font: 'monospace' } } },
        { field: 'topic', name: 'Тема', type: 'string', meta: { interface: 'input', width: 'half', readonly: true } },
        { field: 'thread_id', name: 'Тема (ID)', type: 'string', meta: { interface: 'input', width: 'half', readonly: true, options: { font: 'monospace' } } },
        { field: 'last_seen', name: 'Когда видел', type: 'string', meta: { interface: 'input', width: 'half', readonly: true } },
        { field: 'label', name: 'Строка', type: 'string', meta: { interface: 'input', width: 'full', readonly: true } },
      ],
    },
  },
  schema: {},
};
// the log's events the extension writes since 23.10.2026, named in the admin
// события журнала, которые расширение пишет с 23.10.2026, — по-русски в админке
const LOG_EVENTS = [
  { text: 'Начал оформление', value: 'order_pending' },
  { text: 'Оплата заказа', value: 'order_payment' },
];

const ORDERS = 'orders';
const tr = (text) => [{ language: 'ru-RU', translation: text }];
// the order's notify fields, each right after its neighbour in the form: the
// status journal for people under the payment journal, and the extension's
// own record (the Telegram message ids and the status history) hidden next to
// the payment's
// поля заказа для оповещений, каждое сразу после соседа в карточке: журнал
// статусов для людей — под журналом оплаты, служебная запись расширения (id
// сообщений Telegram и история статусов) — скрытой рядом с записью оплаты
const ORDER_FIELDS = [
  {
    after: 'payment_log',
    field: {
      field: 'status_log',
      type: 'text',
      meta: {
        interface: 'input-multiline',
        readonly: true,
        note: 'Кто и когда менял статус: из админки или кнопкой в Telegram',
        width: 'full',
        translations: tr('Журнал статусов'),
      },
    },
  },
  {
    after: 'payment_meta',
    field: {
      field: 'telegram_meta',
      type: 'json',
      meta: { interface: 'input-code', options: { language: 'JSON' }, special: ['cast-json'], hidden: true, readonly: true, width: 'full' },
    },
  },
];
// what the editor reads and keeps of them where his order rights are a list of
// fields, not «*» (the main setup gives «*»)
// что из них редактор читает и сохраняет там, где его права на заказы —
// список полей, а не «*» (основная настройка даёт «*»)
const EDITOR_ORDER_FIELDS = { read: ['status_log', 'telegram_meta'], update: ['telegram_meta'] };

/**
 * @param {(method: string, path: string, body?: unknown) => Promise<any>} api admin REST call / вызов REST от админа
 * @param {{ editorPolicy: string, builderPolicy: string }} ctx policies created by the main setup / политики из основной настройки
 */
export async function setup(api, { editorPolicy, builderPolicy }) {
  const collections = new Set((await api('GET', '/collections?limit=-1')).map((c) => c.collection));
  if (!collections.has('notify_settings') || !collections.has('notify_log')) {
    console.log('notify: коллекций оповещений нет (schema apply ещё не сделан) — пропускаю');
    return;
  }

  // 0. Telegram topics: the seen list (new, after the help), the chat rows'
  //    sub-fields and the help text (PATCH: `schema apply` keeps old options),
  //    the log's new events. Before the rights: the editor reads the new field
  //    темы Telegram: список виденного (новое поле, после подсказки), подполя
  //    строк чатов и текст подсказки (PATCH: `schema apply` оставляет старые
  //    options), новые события журнала. До прав: редактор читает новое поле
  if (await insertAfter(api, SETTINGS, 'telegram_help', SEEN_FIELD)) console.log(`+ field ${SETTINGS}.telegram_seen`);
  const chats = (await api('GET', `/fields/${SETTINGS}`)).find((f) => f.field === 'telegram_chats');
  if (chats && (stable(chats.meta?.options) !== stable(CHATS_META.options) || chats.meta?.note !== CHATS_META.note)) {
    await api('PATCH', `/fields/${SETTINGS}/telegram_chats`, { meta: CHATS_META });
    console.log(`= field ${SETTINGS}.telegram_chats: «Тема (ID)», «Неоформленные», заметка`);
  }
  const help = (await api('GET', `/fields/${SETTINGS}`)).find((f) => f.field === 'telegram_help');
  // only the old text is replaced: a text the owner rewrote stays / меняется только старый текст: переписанный владельцем остаётся
  if (help && /getUpdates/.test(help.meta?.options?.text ?? '')) {
    await api('PATCH', `/fields/${SETTINGS}/telegram_help`, { meta: { options: { ...help.meta.options, text: HELP_TEXT } } });
    console.log(`= field ${SETTINGS}.telegram_help: chat_id и тема — из «Чатов и тем, которые видел бот»`);
  }
  const event = (await api('GET', '/fields/notify_log')).find((f) => f.field === 'event');
  if (event) {
    const choices = event.meta?.options?.choices ?? [];
    const shown = event.meta?.display_options?.choices ?? [];
    const lacking = LOG_EVENTS.filter((e) => !choices.some((c) => c.value === e.value));
    const unshown = LOG_EVENTS.filter((e) => !shown.some((c) => c.value === e.value));
    if (lacking.length || (event.meta?.display_options && unshown.length)) {
      await api('PATCH', '/fields/notify_log/event', {
        meta: {
          options: { ...event.meta.options, choices: [...choices, ...lacking] },
          ...(event.meta?.display_options ? { display_options: { ...event.meta.display_options, choices: [...shown, ...unshown] } } : {}),
        },
      });
      console.log(`= field notify_log.event: + ${[...new Set([...lacking, ...unshown].map((e) => e.value))].join(', ')}`);
    }
  }

  // 1. editors: settings without the token, the log read-only
  //    редактор: настройки без токена, журнал только на чтение
  const settingsFields = (await api('GET', '/fields/notify_settings'))
    .map((f) => f.field)
    .filter((f) => !SECRET_FIELDS.includes(f));
  const wanted = [
    { collection: 'notify_settings', action: 'read', fields: settingsFields },
    { collection: 'notify_settings', action: 'update', fields: settingsFields.filter((f) => !MACHINE_FIELDS.includes(f)) },
    { collection: 'notify_log', action: 'read', fields: ['*'] },
  ];
  const existing = await api('GET', `/permissions?filter[policy][_eq]=${editorPolicy}&filter[collection][_in]=notify_settings,notify_log&limit=-1`);
  for (const rule of wanted) {
    const found = existing.find((p) => p.collection === rule.collection && p.action === rule.action);
    if (!found) {
      await api('POST', '/permissions', { policy: editorPolicy, ...rule });
      console.log(`+ permission Редактор: ${rule.collection} ${rule.action}`);
    } else if (rule.fields.join() !== (found.fields ?? []).join()) {
      // a field added to the settings later joins the editor's list; the token never does
      // поле, добавленное в настройки позже, входит в список редактора; токен — никогда
      await api('PATCH', `/permissions/${found.id}`, { fields: rule.fields });
      console.log(`= permission Редактор: ${rule.collection} ${rule.action} — поля обновлены`);
    }
  }

  // 2. builder: after a build it tells the editors what went live and the
  //    administrators that a build failed — a notification needs the recipient,
  //    and «who is an administrator» needs the users' role
  //    сборщик: после сборки сообщает редакторам, что вышло на сайт, а
  //    администраторам — что сборка упала; уведомлению нужен получатель, а
  //    «кто администратор» — роль пользователя
  const bexisting = await api(
    'GET',
    `/permissions?filter[policy][_eq]=${builderPolicy}&filter[collection][_in]=directus_notifications,directus_users,directus_roles&limit=-1`,
  );
  const bwanted = [
    { collection: 'directus_notifications', action: 'create', fields: ['recipient', 'subject', 'message', 'collection', 'item'] },
    { collection: 'directus_users', action: 'read', fields: ['id', 'role', 'status'] },
    { collection: 'directus_roles', action: 'read', fields: ['id', 'name'] },
  ];
  for (const rule of bwanted) {
    if (bexisting.some((p) => p.collection === rule.collection && p.action === rule.action)) continue;
    await api('POST', '/permissions', { policy: builderPolicy, ...rule });
    console.log(`+ permission Сборщик: ${rule.collection} ${rule.action}`);
  }

  // 3. the log opens newest first, failures one click away
  //    журнал открывается свежими сверху, ошибки — в одну закладку
  const PRESETS = [
    {
      collection: 'notify_log',
      layout_query: {
        tabular: {
          fields: ['date_created', 'status', 'event', 'channel', 'recipient', 'error', 'order', 'request'],
          sort: ['-date_created'],
          limit: 50,
        },
      },
      layout_options: {
        tabular: { widths: { date_created: 170, status: 130, event: 140, channel: 110, recipient: 230, error: 300, order: 110, request: 110 } },
      },
    },
    { collection: 'notify_log', bookmark: 'Ошибки', icon: 'error', color: '#E35169', filter: { status: { _eq: 'failed' } } },
  ];
  const presetsNow = await api('GET', '/presets?filter[user][_null]=true&filter[role][_null]=true&filter[collection][_eq]=notify_log&limit=-1');
  for (const preset of PRESETS) {
    if (presetsNow.some((p) => (p.bookmark ?? null) === (preset.bookmark ?? null))) continue;
    await api('POST', '/presets', { layout: 'tabular', user: null, role: null, bookmark: null, ...preset });
    console.log(`+ preset notify_log${preset.bookmark ? ` «${preset.bookmark}»` : ''}`);
  }

  // 4. the order's notify fields, each right after its neighbour
  //    поля заказа для оповещений, каждое сразу после соседа
  for (const { after, field } of ORDER_FIELDS) {
    if (await insertAfter(api, ORDERS, after, field)) console.log(`+ field ${ORDERS}.${field.field}`);
  }
  const orderRules = await api('GET', `/permissions?filter[policy][_eq]=${editorPolicy}&filter[collection][_eq]=${ORDERS}&limit=-1`);
  for (const [action, need] of Object.entries(EDITOR_ORDER_FIELDS)) {
    const rule = orderRules.find((p) => p.action === action);
    if (!rule || rule.fields?.includes('*')) continue;
    const lacking = need.filter((f) => !rule.fields?.includes(f));
    if (!lacking.length) continue;
    await api('PATCH', `/permissions/${rule.id}`, { fields: [...(rule.fields ?? []), ...lacking] });
    console.log(`= permission Редактор: ${ORDERS} ${action} + ${lacking.join(', ')}`);
  }
}

/**
 * A missing field goes right after its neighbour, the fields below move down
 * to make room (only when the field is new); a tie in `sort` keeps the API
 * order, as the admin form does. Returns whether the field was created.
 * Недостающее поле встаёт сразу после соседа, поля ниже сдвигаются,
 * освобождая место (только когда поле новое); при равном `sort` порядок как в
 * ответе API — так его показывает форма. Возвращает, создано ли поле.
 */
async function insertAfter(api, collection, after, field) {
  const fields = await api('GET', `/fields/${collection}`);
  if (fields.some((f) => f.field === field.field)) return false;
  const order = fields.filter((f) => Number.isFinite(f.meta?.sort)).sort((a, b) => a.meta.sort - b.meta.sort);
  const at = order.findIndex((f) => f.field === after);
  // no neighbour (an install without it) — the field goes last
  // соседа нет (установка без него) — поле встаёт в конец
  let sort = order.length ? order[order.length - 1].meta.sort + 1 : 1;
  if (at >= 0) {
    sort = order[at].meta.sort + 1;
    const below = order.slice(at + 1);
    const shift = below.length ? Math.max(0, sort + 1 - below[0].meta.sort) : 0;
    if (shift) await api('PATCH', `/fields/${collection}`, below.map((f) => ({ field: f.field, meta: { sort: f.meta.sort + shift } })));
  }
  await api('POST', `/fields/${collection}`, { ...field, meta: { ...field.meta, sort } });
  return true;
}

/** JSON with sorted keys: «the same options» whatever order the API keeps them in. / JSON с упорядоченными ключами. */
function stable(value) {
  return JSON.stringify(value ?? null, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}
