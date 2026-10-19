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
}
