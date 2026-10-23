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
// written by the `notify` extension on start, not by people
// пишет расширение `notify` при запуске, а не люди
const MACHINE_FIELDS = ['email_state', 'email_ready'];

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

  // 4. the order's notify fields: a missing one goes right after its
  //    neighbour, the fields below move down to make room (only when the field
  //    is new); a tie in `sort` keeps the API order, as the admin form does
  //    поля заказа для оповещений: недостающее встаёт сразу после соседа, поля
  //    ниже сдвигаются, освобождая место (только когда поле новое); при
  //    равном `sort` порядок как в ответе API — так его показывает карточка
  for (const { after, field } of ORDER_FIELDS) {
    const orderFields = await api('GET', `/fields/${ORDERS}`);
    if (orderFields.some((f) => f.field === field.field)) continue;
    const order = orderFields.filter((f) => Number.isFinite(f.meta?.sort)).sort((a, b) => a.meta.sort - b.meta.sort);
    const at = order.findIndex((f) => f.field === after);
    // no neighbour (an install without the payments) — the field goes last
    // соседа нет (установка без оплаты) — поле встаёт в конец
    let sort = order.length ? order[order.length - 1].meta.sort + 1 : 1;
    if (at >= 0) {
      sort = order[at].meta.sort + 1;
      const below = order.slice(at + 1);
      const shift = below.length ? Math.max(0, sort + 1 - below[0].meta.sort) : 0;
      if (shift) await api('PATCH', `/fields/${ORDERS}`, below.map((f) => ({ field: f.field, meta: { sort: f.meta.sort + shift } })));
    }
    await api('POST', `/fields/${ORDERS}`, { ...field, meta: { ...field.meta, sort } });
    console.log(`+ field ${ORDERS}.${field.field}`);
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
