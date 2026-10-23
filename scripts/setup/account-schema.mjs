// The schema of the guest account and «Вкусные баллы»: collections, fields
// on `directus_users`, `orders` and `promos`, relations and the two settings
// singletons with their defaults. The deploy source is still
// `directus/snapshot.yaml`; this script makes the same schema on a Directus
// where the snapshot does not have it yet (a merge of branches, a fresh local
// instance) and is the readable list of what the account added. Idempotent:
// only what is missing is created, nothing is changed or deleted.
// Схема личного кабинета и «Вкусных баллов»: коллекции, поля у
// `directus_users`, `orders` и `promos`, связи и два синглтона настроек с
// значениями по умолчанию. Источник для выкатки — по-прежнему
// `directus/snapshot.yaml`; скрипт заводит ту же схему там, где снапшота ещё
// нет (слияние веток, свежий локальный Directus), и служит читаемым списком
// того, что добавил кабинет. Идемпотентен: создаёт только недостающее, ничего
// не меняет и не удаляет.
//
// Run / Запуск:
//   DIRECTUS_URL=http://127.0.0.1:8055 DIRECTUS_ADMIN_TOKEN=… node scripts/setup/account-schema.mjs

const BASE = process.env.DIRECTUS_URL ?? 'http://localhost:8055';
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
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

/** Default tiers: by the sum of all purchases. / Уровни по умолчанию: по сумме всех покупок. */
export const DEFAULT_TIERS = [
  { name: 'Знакомый', from: 0, percent: 3 },
  { name: 'Свой', from: 10000, percent: 5 },
  { name: 'Друг дома', from: 30000, percent: 7 },
];

const ru = (translation, singular = translation, plural = translation) => [
  { language: 'ru-RU', translation, singular, plural },
];
const label = (translation) => [{ language: 'ru-RU', translation }];
const choices = (list) => list.map(([value, text, color]) => ({ value, text, ...(color && { color }) }));

/**
 * One field in the admin's own words. `schema` is merged over a nullable
 * column; an alias (divider, notice, O2M) has no column at all.
 * Одно поле словами админки. `schema` ложится поверх колонки, допускающей
 * пусто; у алиаса (разделитель, подсказка, O2M) колонки нет вовсе.
 */
const field = (name, type, meta = {}, schema = {}) => ({
  field: name,
  type,
  meta: {
    interface: 'input',
    width: 'half',
    hidden: false,
    readonly: false,
    required: false,
    ...meta,
    translations: meta.translations ?? (meta.label ? label(meta.label) : null),
    label: undefined,
  },
  schema: type === 'alias' ? null : { is_nullable: true, ...schema },
});
const pk = () => field('id', 'integer', { hidden: true, readonly: true, width: 'full' }, { is_primary_key: true, has_auto_increment: true, is_nullable: false });
const notice = (name, text, icon = 'info') =>
  field(name, 'alias', { interface: 'presentation-notice', special: ['alias', 'no-data'], width: 'full', options: { color: 'info', icon, text } });
const select = (name, list, meta = {}, schema = {}) =>
  field(
    name,
    'string',
    {
      interface: 'select-dropdown',
      options: { choices: choices(list) },
      display: 'labels',
      display_options: { choices: choices(list), showAsDot: false },
      ...meta,
    },
    schema,
  );
const int = (name, meta = {}, schema = {}) => field(name, 'integer', meta, schema);
const bool = (name, meta = {}, schema = {}) =>
  field(name, 'boolean', { interface: 'boolean', special: ['cast-boolean'], display: 'boolean', ...meta }, { is_nullable: false, ...schema });

// ── the account's collections / коллекции кабинета ─────────────────────────
const TRANSACTION_TYPES = [
  ['signup', 'Регистрация', '#6F7546'],
  ['birthday', 'День рождения', '#C67139'],
  ['accrual', 'Начисление за заказ', '#6F7546'],
  ['spend', 'Списание в заказе', '#8C4C24'],
  ['expire', 'Сгорание', '#A79C8A'],
  ['refund', 'Откат по заказу', '#736A58'],
  ['manual', 'Вручную', '#333721'],
];

const COLLECTIONS = [
  {
    collection: 'account',
    meta: {
      icon: 'loyalty',
      sort: 9,
      collapse: 'open',
      note: 'Личный кабинет гостей на сайте: вход по телефону, «Вкусные баллы», уровни, подарок ко дню рождения',
      translations: ru('Личный кабинет'),
    },
    schema: null,
  },
  {
    collection: 'loyalty_settings',
    meta: {
      group: 'account',
      singleton: true,
      icon: 'card_giftcard',
      sort: 1,
      note: 'Сколько баллов дарить и начислять, какую часть заказа можно оплатить баллами, уровни и день рождения',
      translations: ru('Программа лояльности'),
    },
    schema: {},
    fields: [
      pk(),
      notice(
        'loyalty_hint',
        '1 балл = 1 ₽. Баллы начисляются, когда заказ с сайта переведён в «Выполнен», — процентом от суммы блюд по уровню гостя; за заказ, в котором списаны баллы, начисления нет. Отменённый заказ возвращает списанные баллы и забирает начисленные. Начислить или списать вручную — запись в «Операциях по баллам».',
        'loyalty',
      ),
      bool('enabled', { label: 'Программа включена', note: 'Выключено — сайт не показывает баллы, новые не начисляются и не списываются, сгорание на паузе', width: 'half' }, { default_value: true }),
      field('program_name', 'string', { label: 'Название программы', note: 'Так программа называется на сайте', options: { placeholder: 'Вкусные баллы' } }, { default_value: 'Вкусные баллы' }),
      int('signup_bonus', { label: 'Баллы за регистрацию', note: 'Один раз, при первом входе по номеру. 0 — не дарить' }, { default_value: 200 }),
      int('points_ttl_days', { label: 'Срок жизни баллов, дней', note: 'Сколько дней живут начисленные баллы; сгорают первыми самые старые. 0 — не сгорают' }, { default_value: 365 }),
      int(
        'max_share_percent',
        {
          label: 'Оплатить баллами можно до, % заказа',
          note: 'Например, 30: заказ на 2 000 ₽ можно оплатить баллами не больше чем на 600 ₽',
          validation: { _and: [{ max_share_percent: { _gte: 0 } }, { max_share_percent: { _lte: 100 } }] },
          validation_message: 'От 0 до 100',
        },
        { default_value: 30 },
      ),
      field(
        'tiers',
        'json',
        {
          label: 'Уровни',
          width: 'full',
          interface: 'list',
          special: ['cast-json'],
          note: 'Уровень гостя — по сумме всех выполненных заказов с сайта. Процент — сколько баллов возвращается с каждого заказа. Первый уровень — от 0 ₽',
          options: {
            addLabel: 'Добавить уровень',
            template: '{{name}}: от {{from}} ₽ — {{percent}} %',
            fields: [
              { field: 'name', name: 'Название', type: 'string', meta: { interface: 'input', width: 'third', options: { placeholder: 'Свой' } } },
              { field: 'from', name: 'От суммы покупок, ₽', type: 'integer', meta: { interface: 'input', width: 'third' } },
              { field: 'percent', name: 'Баллами, %', type: 'integer', meta: { interface: 'input', width: 'third' } },
            ],
          },
        },
      ),
      field('birthday_divider', 'alias', {
        interface: 'presentation-divider',
        special: ['alias', 'no-data'],
        width: 'full',
        options: { title: 'День рождения', icon: 'cake', inlineTitle: true },
      }),
      int('birthday_bonus', { label: 'Баллы ко дню рождения', note: 'Раз в год, в окне вокруг дня рождения. Действуют до конца окна. 0 — не дарить' }, { default_value: 500 }),
      int('birthday_window_days', { label: 'Окно дня рождения, ± дней', note: '3 — за три дня до и три дня после' }, { default_value: 3 }),
      int(
        'birthday_discount_percent',
        {
          label: 'Скидка именинника, %',
          note: 'Скидка на заказ с сайта в окне дня рождения (только гостям, которые вошли). 0 — без скидки',
          validation: { _and: [{ birthday_discount_percent: { _gte: 0 } }, { birthday_discount_percent: { _lte: 50 } }] },
          validation_message: 'От 0 до 50',
        },
        { default_value: 0 },
      ),
      field('date_updated', 'timestamp', { special: ['date-updated'], hidden: true, readonly: true, interface: 'datetime' }),
    ],
  },
  {
    collection: 'guest_auth_settings',
    meta: {
      group: 'account',
      singleton: true,
      icon: 'phonelink_lock',
      sort: 2,
      note: 'Как гость входит на сайт по номеру: звонок или SMS, тексты подсказок',
      translations: ru('Вход по телефону'),
    },
    schema: {},
    fields: [
      pk(),
      notice(
        'auth_hint',
        'Код приходит через SMS Aero. Ключи лежат на сервере (SMSAERO_EMAIL и SMSAERO_API_KEY), здесь — только способ и тексты. Код живёт 5 минут, на него 5 попыток; повторно запросить можно через минуту, не больше 5 раз в час на номер.',
        'phonelink_lock',
      ),
      bool('enabled', { label: 'Вход на сайте открыт', note: 'Выключено — сайт не отправляет коды, кабинет просит позвонить' }, { default_value: true }),
      select(
        'channel',
        [
          ['call', 'Звонок: код — последние 4 цифры номера'],
          ['sms', 'SMS с кодом'],
          ['mobile_id', 'Мобильная авторизация: подтверждение у оператора, иначе SMS'],
        ],
        { label: 'Как отправлять код', required: true, note: 'Звонок дешевле SMS. Если звонок недоступен, сайт сам отправит SMS' },
        { default_value: 'call', is_nullable: false },
      ),
      bool('fallback_sms', { label: 'Предлагать SMS, если код не пришёл', note: 'Под полем кода появится «Получить код по SMS»' }, { default_value: true }),
      field('sms_sign', 'string', { label: 'Имя отправителя SMS', note: 'Своё имя регистрируется в кабинете SMS Aero. «SMS Aero» — бесплатное, тогда в тексте должно быть название сайта' }, { default_value: 'SMS Aero' }),
      field('sms_text', 'string', { label: 'Текст SMS', width: 'full', note: 'Обязательно {code} — туда встанет код' }, { default_value: 'Код для входа на vkus-com.ru: {code}. Никому его не сообщайте' }),
      field('hint_call', 'text', { label: 'Подсказка при звонке', width: 'full', interface: 'input-multiline', note: '{phone} — номер гостя' }, { default_value: 'Сейчас позвоним на {phone}. Отвечать не нужно — введите последние 4 цифры номера, с которого звонят.' }),
      field('hint_sms', 'text', { label: 'Подсказка при SMS', width: 'full', interface: 'input-multiline' }, { default_value: 'Отправили SMS с кодом на {phone}.' }),
      field('hint_mobile_id', 'text', { label: 'Подсказка при мобильной авторизации', width: 'full', interface: 'input-multiline' }, { default_value: 'Подтвердите вход в запросе, который придёт на {phone}. Если вместо запроса пришло SMS с кодом — введите его здесь.' }),
      field('date_updated', 'timestamp', { special: ['date-updated'], hidden: true, readonly: true, interface: 'datetime' }),
    ],
  },
  {
    collection: 'bonus_transactions',
    meta: {
      group: 'account',
      icon: 'swap_vert',
      sort: 3,
      display_template: '{{amount}} · {{type}}',
      note: 'Все движения «Вкусных баллов». Начислить или списать вручную — новая запись: гость, «Вручную», +/− баллы и комментарий',
      translations: ru('Операции по баллам', 'Операция по баллам', 'Операции по баллам'),
    },
    schema: {},
    fields: [
      pk(),
      field('date_created', 'timestamp', { label: 'Когда', special: ['date-created'], readonly: true, interface: 'datetime', display: 'datetime', display_options: { relative: true } }),
      field('user', 'uuid', {
        label: 'Гость',
        required: true,
        special: ['m2o'],
        interface: 'select-dropdown-m2o',
        options: { template: '{{phone}}', filter: { phone: { _nnull: true } } },
        display: 'related-values',
        display_options: { template: '{{phone}}' },
      }),
      // a manual entry is always «Вручную»: the other types are written by the
    // `loyalty` hook, and the ledger trusts their meaning
    // ручная запись — всегда «Вручную»: остальные типы пишет хук `loyalty`, и
    // книга баллов доверяет их смыслу
    select('type', TRANSACTION_TYPES, { label: 'Что', readonly: true }, { default_value: 'manual', is_nullable: false }),
      int('amount', {
        label: 'Баллы',
        required: true,
        note: 'Плюс — начислить, минус — списать',
        validation: { amount: { _neq: 0 } },
        validation_message: 'Не ноль',
      }, { is_nullable: false }),
      field('order', 'integer', {
        label: 'Заказ',
        special: ['m2o'],
        interface: 'select-dropdown-m2o',
        options: { template: '{{number}} · {{total}} ₽' },
        display: 'related-values',
        display_options: { template: '{{number}}' },
      }),
      field('expires_at', 'date', { label: 'Сгорают', interface: 'datetime', note: 'Пусто — по сроку из «Программы лояльности» (у начислений)' }),
      field('comment', 'string', { label: 'Комментарий', width: 'full', note: 'Гость видит его в истории' }),
      field('user_created', 'uuid', {
        label: 'Провёл',
        special: ['user-created'],
        readonly: true,
        interface: 'select-dropdown-m2o',
        options: { template: '{{first_name}} {{last_name}}' },
        display: 'user',
      }),
    ],
  },
  {
    collection: 'auth_codes',
    meta: {
      group: 'account',
      hidden: true,
      icon: 'password',
      sort: 4,
      note: 'Коды входа: хранится только отпечаток кода. Служебная таблица, чистится сама',
      translations: ru('Коды входа', 'Код входа', 'Коды входа'),
    },
    schema: {},
    fields: [
      field('id', 'uuid', { hidden: true, readonly: true, special: ['uuid'] }, { is_primary_key: true, is_nullable: false }),
      field('date_created', 'timestamp', { special: ['date-created'], readonly: true, interface: 'datetime' }),
      field('phone', 'string', { label: 'Телефон' }, { max_length: 16, is_indexed: true }),
      field('channel', 'string', { label: 'Канал' }, { max_length: 16 }),
      field('code_hash', 'string', { label: 'Отпечаток кода', hidden: true }, { max_length: 128 }),
      field('provider_id', 'string', { label: 'Номер у SMS Aero' }, { max_length: 64 }),
      int('attempts', { label: 'Попыток' }, { default_value: 0, is_nullable: false }),
      field('expires_at', 'timestamp', { label: 'Истекает', interface: 'datetime' }),
      field('used_at', 'timestamp', { label: 'Использован', interface: 'datetime' }),
      field('status', 'string', { label: 'Статус' }, { max_length: 16, default_value: 'sent' }),
      field('ip', 'string', { label: 'IP' }, { max_length: 64, is_indexed: true }),
    ],
  },
];

// ── fields on existing collections / поля существующих коллекций ───────────
const EXTRA_FIELDS = {
  directus_users: [
    field('guest_divider', 'alias', {
      interface: 'presentation-divider',
      special: ['alias', 'no-data'],
      width: 'full',
      options: { title: 'Гость сайта: личный кабинет', icon: 'loyalty', inlineTitle: true },
    }),
    field('phone', 'string', { label: 'Телефон (вход на сайт)', note: 'Номер, по которому гость входит. Один номер — один гость' }, { max_length: 16, is_unique: true }),
    field('guest_since', 'timestamp', { label: 'Гость с', readonly: true, interface: 'datetime', display: 'datetime' }),
    int('bonus_balance', { label: 'Вкусные баллы', readonly: true, note: 'Считается из «Операций по баллам»' }, { default_value: 0, is_nullable: false }),
    field('tier', 'string', { label: 'Уровень', readonly: true }),
    int('total_spent', { label: 'Сумма покупок, ₽', readonly: true, note: 'Выполненные заказы с сайта, деньгами' }, { default_value: 0, is_nullable: false }),
    int('birthday_bonus_year', { label: 'Подарок ко дню рождения — за год', readonly: true }),
    field('birthday', 'date', { label: 'Дата рождения', interface: 'datetime', note: 'Гость указывает сам и один раз; исправить может редактор' }),
    // when the guest typed the birthday: a date typed inside its own window
    // brings no gift this year — otherwise «birthday = today» is a free coupon
    // когда гость указал дату: дата, указанная внутри своего окна, подарка в
    // этом году не приносит — иначе «день рождения = сегодня» был бы купоном
    field('birthday_set_at', 'timestamp', { label: 'Дата рождения указана', readonly: true, interface: 'datetime', display: 'datetime' }),
    field('middle_name', 'string', { label: 'Отчество' }),
    select('gender', [['female', 'Женский'], ['male', 'Мужской']], { label: 'Пол' }),
    field('recovery_email', 'string', { label: 'Email для восстановления', note: 'Настоящая почта гостя. «Email» выше — служебный адрес для входа' }),
    field('bonus_history', 'alias', {
      label: 'Операции по баллам',
      width: 'full',
      special: ['o2m'],
      interface: 'list-o2m',
      // a list, not a table: the table's narrow columns cut the comment and the type chip to «…»
      // список, а не таблица: узкие колонки таблицы режут комментарий и метку типа до «…»
      options: { template: '{{amount}} · {{type}} · {{comment}} · {{date_created}}', enableSelect: false, enableCreate: true, layout: 'list', sort: '-date_created' },
    }),
    field('guest_orders', 'alias', {
      label: 'Заказы гостя',
      width: 'full',
      special: ['o2m'],
      interface: 'list-o2m',
      readonly: true,
      options: {
        template: '{{number}} · {{status}} · {{total}}, баллами {{bonus_spent}}, начислено {{bonus_earned}} · {{date_created}}',
        enableSelect: false,
        enableCreate: false,
        layout: 'list',
        sort: '-date_created',
      },
    }),
  ],
  orders: [
    field('customer', 'uuid', {
      label: 'Гость (личный кабинет)',
      special: ['m2o'],
      interface: 'select-dropdown-m2o',
      options: { template: '{{phone}}', filter: { phone: { _nnull: true } } },
      display: 'related-values',
      display_options: { template: '{{phone}}' },
      note: 'Заказ из кабинета: баллы списываются и начисляются этому гостю. Заказу по телефону можно выбрать гостя — баллы начислятся при «Выполнен»',
    }),
    int('bonus_spent', { label: 'Оплачено баллами, ₽', readonly: true }, { default_value: 0 }),
    int('discount', { label: 'Скидка именинника, ₽', readonly: true }, { default_value: 0 }),
    int('to_pay', { label: 'К оплате, ₽', readonly: true, note: 'Сумма минус баллы и скидка — столько взять с гостя' }),
    int('bonus_earned', { label: 'Начислено баллов', readonly: true, note: 'Появляется, когда заказ выполнен' }, { default_value: 0 }),
  ],
  promos: [
    select(
      'audience',
      [
        ['all', 'Всем — на сайте'],
        ['birthday', 'Именинникам — в личном кабинете'],
      ],
      { label: 'Кому', note: 'Именинникам — акция видна только в личном кабинете гостю, у которого день рождения в окне из «Программы лояльности»' },
      { default_value: 'all' },
    ),
  ],
};

const RELATIONS = [
  { collection: 'bonus_transactions', field: 'user', related_collection: 'directus_users', meta: { one_field: 'bonus_history', one_deselect_action: 'nullify' }, schema: { on_delete: 'CASCADE' } },
  { collection: 'bonus_transactions', field: 'order', related_collection: 'orders', meta: { one_deselect_action: 'nullify' }, schema: { on_delete: 'SET NULL' } },
  { collection: 'bonus_transactions', field: 'user_created', related_collection: 'directus_users', meta: { one_deselect_action: 'nullify' }, schema: { on_delete: 'SET NULL' } },
  { collection: 'orders', field: 'customer', related_collection: 'directus_users', meta: { one_field: 'guest_orders', one_deselect_action: 'nullify' }, schema: { on_delete: 'SET NULL' } },
];

// ── apply / применение ─────────────────────────────────────────────────────
const collections = new Set((await api('GET', '/collections?limit=-1')).map((c) => c.collection));
const fieldsOf = async (collection) => new Set((await api('GET', `/fields/${collection}`)).map((f) => f.field));

for (const { fields = [], ...collection } of COLLECTIONS) {
  if (!collections.has(collection.collection)) {
    await api('POST', '/collections', { ...collection, fields: collection.schema === null ? undefined : fields.filter((f) => f.field === 'id') });
    console.log(`+ collection ${collection.collection}`);
  }
  if (collection.schema === null) continue;
  const have = await fieldsOf(collection.collection);
  for (const [i, f] of fields.entries()) {
    if (have.has(f.field)) {
      if (f.meta) await api('PATCH', `/fields/${collection.collection}/${f.field}`, { meta: { ...f.meta, sort: i + 1 } });
      continue;
    }
    await api('POST', `/fields/${collection.collection}`, { ...f, meta: { ...f.meta, sort: i + 1 } });
    console.log(`+ field ${collection.collection}.${f.field}`);
  }
}
// The guest's block in the user form keeps the order of the list above; on
// `orders` and `promos` the fields join the end of a form other code owns.
// Existing fields get their meta from here as well: a label, a note or a
// template changed in code reaches a running admin on the next setup.
// Блок гостя в карточке пользователя идёт в порядке списка выше; на `orders` и
// `promos` поля встают в конец чужой формы. Уже заведённые поля тоже получают
// meta отсюда: подпись, подсказка или шаблон, изменённые в коде, доходят до
// работающей админки при следующем setup.
const SORT_FROM = { directus_users: 100 };
for (const [collection, fields] of Object.entries(EXTRA_FIELDS)) {
  const have = await fieldsOf(collection);
  for (const [i, f] of fields.entries()) {
    const meta = SORT_FROM[collection] ? { ...f.meta, sort: SORT_FROM[collection] + i } : f.meta;
    if (have.has(f.field)) {
      await api('PATCH', `/fields/${collection}/${f.field}`, { meta });
      continue;
    }
    await api('POST', `/fields/${collection}`, { ...f, meta });
    console.log(`+ field ${collection}.${f.field}`);
  }
}
const relations = await api('GET', '/relations');
for (const relation of RELATIONS) {
  if (relations.some((r) => r.collection === relation.collection && r.field === relation.field)) continue;
  await api('POST', '/relations', relation);
  console.log(`+ relation ${relation.collection}.${relation.field} → ${relation.related_collection}`);
}

// the singletons get their row with the defaults, so the hooks never read an empty one
// синглтоны получают строку со значениями по умолчанию: хуки не читают пустоту
const loyalty = await api('GET', '/items/loyalty_settings');
if (!loyalty?.id) {
  await api('PATCH', '/items/loyalty_settings', { enabled: true, tiers: DEFAULT_TIERS });
  console.log('+ Программа лояльности: значения по умолчанию');
} else if (!Array.isArray(loyalty.tiers) || !loyalty.tiers.length) {
  await api('PATCH', '/items/loyalty_settings', { tiers: DEFAULT_TIERS });
  console.log('= Программа лояльности: уровни по умолчанию');
}
const auth = await api('GET', '/items/guest_auth_settings');
if (!auth?.id) {
  await api('PATCH', '/items/guest_auth_settings', { enabled: true });
  console.log('+ Вход по телефону: значения по умолчанию');
}
console.log('account-schema: готово');
