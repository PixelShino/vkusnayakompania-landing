// Online payment in Directus: the «Оплата» singleton, the payment fields of an
// order, who may see what, the order list's payment column and bookmarks.
// Idempotent like the rest of the setup: what exists is left alone, what is
// missing is added — so a clean install needs no snapshot for this part, and
// an install from the snapshot only gets its permissions here.
// Онлайн-оплата в Directus: синглтон «Оплата», поля оплаты у заказа, кому что
// видно, колонка оплаты и закладки в списке заказов. Идемпотентно, как вся
// настройка: существующее не трогается, недостающее добавляется — чистой
// установке снапшот для этой части не нужен, а установка из снапшота получает
// здесь только права.
//
// Called from `scripts/directus-setup.mjs`:
//   await setup(api, { editorPolicy, publicPolicy })

const SETTINGS = 'payment_settings';
const ORDERS = 'orders';

// secrets stay with the administrator: editors never read them
// секреты — только администратору: редактор их не читает
const SECRET_FIELDS = ['alfa_login', 'alfa_password', 'alfa_token', 'callback_key', 'yookassa_shop_id', 'yookassa_secret_key'];
// what an editor may switch: the payments on/off and the words for the guest
// что может переключить редактор: оплату вкл/выкл и слова для гостя
const EDITOR_UPDATE = ['online_enabled', 'allow_on_delivery', 'text_online', 'text_on_delivery', 'text_note', 'text_paid', 'text_failed'];

const tr = (text) => [{ language: 'ru-RU', translation: text }];
const choice = (text, value) => ({ text, value });
const label = (text, value, background, foreground) => ({ text, value, background, foreground, color: foreground });
const divider = (field, title, icon, sort) => ({
  field,
  type: 'alias',
  meta: { special: ['alias', 'no-data'], interface: 'presentation-divider', options: { title, icon, inlineTitle: true }, width: 'full', sort },
});
// a bank's own fields show only while that bank is chosen
// поля банка видны, только пока выбран этот банк
const onlyFor = (provider, name) => [{ name, rule: { _and: [{ provider: { _neq: provider } }] }, hidden: true }];
const ALFA_ONLY = onlyFor('alfa', 'Не Альфа-Банк');
const YOOKASSA_ONLY = onlyFor('yookassa', 'Не ЮKassa');
const masked = (field, name, note, sort, width = 'half', conditions = undefined) => ({
  field,
  type: 'string',
  schema: { max_length: 512 },
  meta: { interface: 'input', options: { masked: true, trim: true }, note, width, sort, translations: tr(name), ...(conditions ? { conditions } : {}) },
});

/** Поля синглтона «Оплата»: включение, банк, чек, тексты. */
const SETTINGS_FIELDS = [
  { field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true }, meta: { hidden: true, readonly: true, sort: 1 } },
  {
    field: 'intro',
    type: 'alias',
    meta: {
      special: ['alias', 'no-data'],
      interface: 'presentation-notice',
      width: 'full',
      sort: 2,
      options: {
        color: 'normal',
        icon: 'credit_card',
        text:
          'Онлайн-оплата заказов из корзины сайта. Выключена — гость оформляет заказ, как раньше, и платит при получении. ' +
          'Банк — ЮKassa. ' +
          'Секреты (секретный ключ ЮKassa, ключи) надёжнее задать переменными окружения PAY_* на сервере: они важнее полей ниже и не попадают в базу и бэкапы.',
      },
    },
  },
  {
    field: 'online_enabled',
    type: 'boolean',
    schema: { default_value: false, is_nullable: false },
    meta: { interface: 'boolean', options: { label: 'Принимать онлайн-оплату' }, special: ['cast-boolean'], width: 'half', sort: 3, translations: tr('Онлайн-оплата') },
  },
  {
    field: 'allow_on_delivery',
    type: 'boolean',
    schema: { default_value: true, is_nullable: false },
    meta: {
      interface: 'boolean',
      options: { label: 'Разрешить оплату при получении' },
      special: ['cast-boolean'],
      note: 'Выключить — заказ с сайта только с онлайн-оплатой',
      width: 'half',
      sort: 4,
      translations: tr('При получении'),
    },
  },
  {
    field: 'check_link',
    type: 'alias',
    meta: {
      special: ['alias', 'no-data'],
      interface: 'presentation-links',
      width: 'full',
      sort: 5,
      options: { links: [{ label: 'Проверить настройки и связь с банком', icon: 'fact_check', type: 'normal', url: '/pay/check' }] },
    },
  },
  divider('bank_divider', 'Банк', 'account_balance', 6),
  {
    field: 'provider',
    type: 'string',
    schema: { default_value: 'yookassa', max_length: 32 },
    meta: {
      interface: 'select-dropdown',
      options: {
        // Альфа-Банк снят с выбора 21.10.2026 (решение владельца); модуль и поля
        // остались в коде, вернуть — choice('Альфа-Банк', 'alfa')
        choices: [choice('ЮKassa', 'yookassa'), choice('Заглушка — только для теста, денег не берёт', 'mock')],
      },
      display: 'labels',
      width: 'half',
      sort: 7,
      translations: tr('Банк'),
    },
  },
  {
    field: 'mode',
    type: 'string',
    schema: { default_value: 'test', max_length: 16 },
    meta: {
      interface: 'select-radio',
      options: { choices: [choice('Тест', 'test'), choice('Бой', 'prod')] },
      note: 'В тесте гости кнопку оплаты не видят. Проверка — по ссылке vkus-com.ru/catalog/?paytest=1',
      width: 'half',
      sort: 8,
      translations: tr('Режим'),
    },
  },
  {
    field: 'yookassa_shop_id',
    type: 'string',
    schema: { max_length: 32 },
    meta: {
      interface: 'input',
      options: { trim: true },
      note: 'Кабинет ЮKassa → «Интеграция» → «Ключи API». У тестового магазина свой shopId',
      width: 'half',
      sort: 9,
      translations: tr('shopId'),
      conditions: YOOKASSA_ONLY,
    },
  },
  masked(
    'yookassa_secret_key',
    'Секретный ключ',
    'Скрыт. live_… — боевой магазин, test_… — тестовый (в режиме «Бой» тестовый ключ выключает оплату). Переменная PAY_YOOKASSA_SECRET_KEY важнее поля',
    10,
    'half',
    YOOKASSA_ONLY,
  ),
  {
    field: 'yookassa_hint',
    type: 'alias',
    meta: {
      special: ['alias', 'no-data'],
      interface: 'presentation-notice',
      width: 'full',
      sort: 11,
      options: {
        color: 'normal',
        icon: 'notifications_active',
        text:
          'В кабинете ЮKassa «Интеграция → HTTP-уведомления»: адрес https://admin.vkus-com.ru/pay/yookassa/webhook, события payment.succeeded, payment.canceled, refund.succeeded. ' +
          'Возврат денег — в кабинете ЮKassa: заказ сам станет «Возврат».',
      },
      conditions: YOOKASSA_ONLY,
    },
  },
  {
    field: 'alfa_login',
    type: 'string',
    schema: { max_length: 128 },
    meta: {
      interface: 'input',
      options: { trim: true },
      note: 'Из письма банка, обычно оканчивается на «-api»',
      width: 'half',
      sort: 12,
      translations: tr('Логин API'),
      conditions: ALFA_ONLY,
    },
  },
  masked('alfa_password', 'Пароль API', 'Скрыт. Переменная PAY_ALFA_PASSWORD важнее этого поля', 13, 'half', ALFA_ONLY),
  masked('alfa_token', 'Токен API', 'Вместо логина и пароля, если банк выдал токен', 14, 'full', ALFA_ONLY),
  {
    field: 'alfa_gateway_test',
    type: 'string',
    schema: { default_value: 'https://alfa.rbsuat.com/payment/rest/', max_length: 255 },
    meta: { interface: 'input', options: { trim: true }, width: 'half', sort: 15, translations: tr('Шлюз: тест'), conditions: ALFA_ONLY },
  },
  {
    field: 'alfa_gateway_prod',
    type: 'string',
    schema: { default_value: 'https://pay.alfabank.ru/payment/rest/', max_length: 255 },
    meta: {
      interface: 'input',
      options: { trim: true },
      note: 'Логин с префиксом «r-» — https://payment.alfabank.ru/payment/rest/',
      width: 'half',
      sort: 16,
      translations: tr('Шлюз: бой'),
      conditions: ALFA_ONLY,
    },
  },
  masked(
    'callback_key',
    'Ключ уведомлений',
    'Ключ контрольной суммы callback-уведомлений (выдаёт банк). Адрес уведомлений для банка: https://admin.vkus-com.ru/pay/callback',
    17,
    'full',
    ALFA_ONLY,
  ),
  {
    field: 'site_url',
    type: 'string',
    schema: { default_value: 'https://vkus-com.ru', max_length: 255 },
    meta: { interface: 'input', options: { trim: true }, note: 'Куда банк вернёт гостя после оплаты', width: 'half', sort: 18, translations: tr('Адрес сайта') },
  },
  {
    field: 'session_minutes',
    type: 'integer',
    schema: { default_value: 20 },
    meta: {
      interface: 'input',
      options: { min: 5, max: 1440 },
      note: 'Сколько живёт страница оплаты. ЮKassa держит страницу сама: по этому сроку заказ только отмечается «Не прошла»',
      width: 'half',
      sort: 19,
      translations: tr('Ждём оплату, мин'),
    },
  },
  divider('receipt_divider', 'Чек (54-ФЗ)', 'receipt', 20),
  {
    field: 'receipt_enabled',
    type: 'boolean',
    schema: { default_value: true, is_nullable: false },
    meta: {
      interface: 'boolean',
      options: { label: 'Передавать состав заказа для чека' },
      special: ['cast-boolean'],
      note:
        'ЮKassa: включите, если в её кабинете подключены «Чеки от ЮKassa» или онлайн-касса, — тогда без состава платёж не создастся',
      width: 'full',
      sort: 21,
      translations: tr('Чек'),
    },
  },
  {
    field: 'tax_system',
    type: 'integer',
    schema: { default_value: 1 },
    meta: {
      interface: 'select-dropdown',
      options: {
        choices: [
          choice('ОСН', 0),
          choice('УСН «доходы»', 1),
          choice('УСН «доходы минус расходы»', 2),
          choice('ЕСХН', 4),
          choice('Патент', 5),
        ],
      },
      note: 'Уточните у бухгалтера',
      width: 'half',
      sort: 22,
      translations: tr('Система налогообложения'),
    },
  },
  {
    field: 'vat',
    type: 'integer',
    schema: { default_value: 0 },
    meta: {
      interface: 'select-dropdown',
      options: {
        choices: [
          choice('Без НДС', 0),
          choice('НДС 0 %', 1),
          choice('НДС 5 % (УСН)', 10),
          choice('НДС 7 % (УСН)', 12),
          choice('НДС 10 %', 2),
          choice('НДС 22 %', 14),
        ],
      },
      note: 'Ставка для всех строк заказа',
      width: 'half',
      sort: 23,
      translations: tr('НДС'),
    },
  },
  {
    field: 'receipt_method',
    type: 'integer',
    schema: { default_value: 4 },
    meta: {
      interface: 'select-dropdown',
      options: { choices: [choice('Полный расчёт', 4), choice('Предоплата 100 %', 1)] },
      note: 'Для доставки с оплатой заранее банки советуют «Предоплата 100 %» и закрывающий чек при передаче — решите с бухгалтером',
      width: 'half',
      sort: 24,
      translations: tr('Способ расчёта'),
    },
  },
  {
    field: 'receipt_subject',
    type: 'integer',
    schema: { default_value: 1 },
    meta: {
      interface: 'select-dropdown',
      options: { choices: [choice('Товар', 1), choice('Услуга', 4)] },
      note: 'Признак предмета расчёта для всех строк: блюда обычно «Товар» — решите с бухгалтером',
      width: 'half',
      sort: 25,
      translations: tr('Предмет расчёта'),
    },
  },
  {
    field: 'receipt_ffd',
    type: 'string',
    schema: { default_value: '1.2', max_length: 8 },
    meta: {
      interface: 'select-radio',
      options: { choices: [choice('ФФД 1.2', '1.2'), choice('ФФД 1.05', '1.05')] },
      note: 'Версия формата чека у кассы: от неё зависит, как записана единица «шт». «Чеки от ЮKassa» — ФФД 1.2',
      width: 'half',
      sort: 26,
      translations: tr('Формат чека'),
    },
  },
  divider('texts_divider', 'Тексты для гостя', 'chat', 27),
  ...[
    ['text_online', 'Онлайн картой — подпись', 'Картой МИР, Visa или Mastercard на защищённой странице ЮKassa', 'Пусто — текст по умолчанию'],
    ['text_on_delivery', 'При получении — подпись', 'Наличными или картой курьеру, на кассе при самовывозе'],
    ['text_note', 'Пояснение под выбором', 'Онлайн оплачиваются блюда и доставка. Если адрес не найден на карте, стоимость доставки назовём при звонке.'],
    ['text_paid', 'Экран «Заказ оплачен»', 'Спасибо! Перезвоним, чтобы подтвердить адрес и время.'],
    ['text_failed', 'Экран «Оплата не прошла»', 'Деньги не списаны. Заказ сохранён — оформлять его заново не нужно.'],
  ].map(([field, name, placeholder, note], i) => ({
    field,
    type: 'string',
    schema: { max_length: 300 },
    meta: {
      interface: 'input',
      options: { placeholder, trim: true },
      note: note ?? 'Пусто — текст по умолчанию из подсказки',
      width: 'full',
      sort: 28 + i,
      translations: tr(name),
    },
  })),
];
// the layout of the fields that exist already follows this list: the order,
// the words, the choices and when a field shows (the snapshot carries the
// same; this keeps an install without it in step)
// раскладка уже существующих полей следует этому списку: порядок, слова,
// варианты и когда поле видно (снапшот несёт то же; это держит в ногу
// установку без него)
const SYNCED_META = ['sort', 'note', 'options', 'conditions', 'width'];

/** Поля оплаты у заказа: после суммы, только для чтения — их пишет сервер. */
const ORDER_FIELDS = [
  {
    field: 'payment_status',
    type: 'string',
    schema: { default_value: 'none', max_length: 16, is_nullable: false },
    meta: {
      interface: 'select-dropdown',
      readonly: true,
      options: {
        choices: [choice('—', 'none'), choice('Ждём оплату', 'pending'), choice('Оплачен', 'paid'), choice('Не прошла', 'failed'), choice('Возврат', 'refunded')],
      },
      display: 'labels',
      display_options: {
        showAsDot: false,
        choices: [
          label('—', 'none', '#F4EFE6', '#8A8172'),
          label('Ждём оплату', 'pending', '#F6E3D3', '#8A4A22'),
          label('Оплачен', 'paid', '#E7E9D6', '#474C2B'),
          label('Не прошла', 'failed', '#F1D9CC', '#8C4C24'),
          label('Возврат', 'refunded', '#EEE8DD', '#6E655A'),
        ],
      },
      note: 'Онлайн-оплата: ставит сервер по ответу банка',
      width: 'half',
      sort: 16,
      translations: tr('Оплата'),
    },
  },
  {
    field: 'payment_method',
    type: 'string',
    schema: { default_value: 'on_delivery', max_length: 16 },
    meta: {
      interface: 'select-radio',
      options: { choices: [choice('Онлайн картой', 'online'), choice('При получении', 'on_delivery')] },
      display: 'labels',
      display_options: {
        showAsDot: false,
        choices: [label('Онлайн картой', 'online', '#E7E9D6', '#474C2B'), label('При получении', 'on_delivery', '#EEE8DD', '#6E655A')],
      },
      width: 'half',
      sort: 17,
      translations: tr('Способ оплаты'),
    },
  },
  {
    field: 'paid_at',
    type: 'timestamp',
    meta: { interface: 'datetime', readonly: true, display: 'datetime', display_options: { relative: false }, width: 'half', sort: 18, translations: tr('Оплачен') },
  },
  {
    field: 'payment_id',
    type: 'string',
    schema: { max_length: 64 },
    meta: { interface: 'input', readonly: true, note: 'Номер заказа в банке: по нему ищут платёж в кабинете эквайринга', width: 'full', sort: 19, translations: tr('Номер в банке') },
  },
  {
    field: 'payment_url',
    type: 'string',
    schema: { max_length: 512 },
    meta: {
      interface: 'input',
      readonly: true,
      display: 'formatted-value',
      note: 'Пока оплата ждёт, эту ссылку можно отправить гостю',
      width: 'full',
      sort: 20,
      translations: tr('Ссылка на оплату'),
    },
  },
  {
    field: 'payment_log',
    type: 'text',
    meta: { interface: 'input-multiline', readonly: true, width: 'full', sort: 21, translations: tr('Журнал оплаты') },
  },
  {
    field: 'payment_meta',
    type: 'json',
    meta: { interface: 'input-code', options: { language: 'JSON' }, special: ['cast-json'], hidden: true, readonly: true, width: 'full', sort: 22 },
  },
  {
    field: 'paid_hint',
    type: 'alias',
    meta: {
      special: ['alias', 'no-data'],
      interface: 'presentation-notice',
      width: 'full',
      sort: 6,
      options: { color: 'success', icon: 'credit_score', text: 'Оплачен картой на сайте — сумму с гостем обсуждать не нужно. Позвоните, подтвердите адрес и время — и переведите заказ в «В работе».' },
      conditions: [{ name: 'Не оплачен или тест', rule: { _or: [{ payment_status: { _neq: 'paid' } }, { payment_test: { _eq: true } }] }, hidden: true }],
    },
  },
  // a payment with no money behind it: the bank's test shop or the stub
  // платёж без денег: тестовый магазин банка или заглушка
  {
    field: 'payment_test',
    type: 'boolean',
    schema: { default_value: false, is_nullable: false },
    meta: {
      interface: 'boolean',
      readonly: true,
      display: 'boolean',
      options: { label: 'Тестовый магазин банка: деньги не списывались' },
      note: 'Ставит сервер, когда ссылка на оплату выдана тестовым магазином или заглушкой',
      width: 'half',
      sort: 18,
      translations: tr('Тестовая оплата'),
      conditions: [{ name: 'Не тест', rule: { _and: [{ payment_test: { _neq: true } }] }, hidden: true }],
    },
  },
  {
    field: 'test_hint',
    type: 'alias',
    meta: {
      special: ['alias', 'no-data'],
      interface: 'presentation-notice',
      width: 'full',
      sort: 5,
      options: { color: 'warning', icon: 'science', text: 'ТЕСТОВАЯ ОПЛАТА — проверка связи с банком. Деньги не списывались, заказ не готовить и не везти.' },
      conditions: [{ name: 'Не тест', rule: { _and: [{ payment_test: { _neq: true } }] }, hidden: true }],
    },
  },
];
// the fields that follow the payment block move down to make room
// поля после блока оплаты сдвигаются вниз, освобождая место
const AFTER_PAYMENT = ['comment', 'manager_note', 'consent', 'date_updated'];

export async function setup(api, { editorPolicy, publicPolicy }) {
  const has = async (path) => {
    try {
      await api('GET', path);
      return true;
    } catch (error) {
      if (/→ (403|404)/.test(error.message)) return false;
      throw error;
    }
  };

  // 1. singleton «Оплата» in the catalog group / синглтон «Оплата» в группе каталога
  if (!(await has(`/collections/${SETTINGS}`))) {
    await api('POST', '/collections', {
      collection: SETTINGS,
      schema: {},
      meta: {
        singleton: true,
        icon: 'credit_card',
        group: 'catalog',
        sort: 3,
        note: 'Онлайн-оплата заказов из корзины: банк, режим, чек и тексты для гостя',
        translations: [{ language: 'ru-RU', translation: 'Оплата', singular: 'Оплата', plural: 'Оплата' }],
      },
      fields: SETTINGS_FIELDS.filter((f) => f.field === 'id'),
    });
    console.log(`+ collection ${SETTINGS}`);
  }
  const existing = await api('GET', `/fields/${SETTINGS}`);
  const settingsFields = existing.map((f) => f.field);
  for (const field of SETTINGS_FIELDS) {
    if (settingsFields.includes(field.field)) continue;
    await api('POST', `/fields/${SETTINGS}`, field);
    console.log(`+ field ${SETTINGS}.${field.field}`);
  }
  // ЮKassa joined later: the old fields take the new order, words, choices and
  // conditions; the bank by default becomes ЮKassa (the saved choice stays)
  // ЮKassa пришла позже: старые поля получают новый порядок, слова, варианты и
  // условия; банк по умолчанию — ЮKassa (сохранённый выбор не меняется)
  const stable = (value) =>
    JSON.stringify(value ?? null, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
  const patches = [];
  for (const field of SETTINGS_FIELDS) {
    const have = existing.find((f) => f.field === field.field);
    if (!have || field.field === 'id') continue;
    const meta = {};
    for (const key of SYNCED_META) if (key in field.meta && stable(have.meta?.[key]) !== stable(field.meta[key])) meta[key] = field.meta[key];
    if (Object.keys(meta).length) patches.push({ field: field.field, meta });
  }
  if (patches.length) {
    await api('PATCH', `/fields/${SETTINGS}`, patches);
    console.log(`= fields ${SETTINGS}: ${patches.map((p) => `${p.field} (${Object.keys(p.meta).join(', ')})`).join('; ')}`);
  }
  const provider = existing.find((f) => f.field === 'provider');
  if (provider && provider.schema?.default_value !== 'yookassa') {
    await api('PATCH', `/fields/${SETTINGS}/provider`, { schema: { default_value: 'yookassa' } });
    console.log(`= field ${SETTINGS}.provider: по умолчанию ЮKassa`);
  }

  // 2. payment fields of an order / поля оплаты у заказа
  const orderFields = await api('GET', `/fields/${ORDERS}`);
  const missing = ORDER_FIELDS.filter((f) => !orderFields.some((o) => o.field === f.field));
  for (const field of missing) {
    await api('POST', `/fields/${ORDERS}`, field);
    console.log(`+ field ${ORDERS}.${field.field}`);
  }
  if (missing.length) {
    const top = Math.max(...ORDER_FIELDS.map((f) => f.meta.sort));
    const moved = AFTER_PAYMENT.filter((name) => orderFields.some((o) => o.field === name)).map((field, i) => ({ field, meta: { sort: top + 1 + i } }));
    if (moved.length) await api('PATCH', `/fields/${ORDERS}`, moved);
  }
  // the old hint said «no payment on the site»; now it steps aside for a paid order
  // старая подсказка говорила «оплаты на сайте нет»; теперь она уступает оплаченному заказу
  const hint = orderFields.find((f) => f.field === 'confirm_hint');
  if (hint && /Оплаты на сайте нет/.test(hint.meta?.options?.text ?? '')) {
    await api('PATCH', `/fields/${ORDERS}/confirm_hint`, {
      meta: {
        options: {
          ...hint.meta.options,
          text: 'Гость ждёт звонка. Позвоните, подтвердите состав, сумму, адрес и время — и переведите заказ в «В работе». Оплачен ли заказ — в поле «Оплата».',
        },
        conditions: [{ name: 'Не новый или оплачен', rule: { _or: [{ status: { _neq: 'new' } }, { payment_status: { _eq: 'paid' } }] }, hidden: true }],
      },
    });
    console.log('= field orders.confirm_hint: текст и условие под оплату');
  }

  // 3. permissions / права
  const perms = await api('GET', `/permissions?filter[collection][_in]=${SETTINGS},${ORDERS}&limit=-1`);
  const readable = SETTINGS_FIELDS.map((f) => f.field).filter((f) => !SECRET_FIELDS.includes(f));
  const editorOn = (action) => perms.find((p) => p.policy === editorPolicy && p.collection === SETTINGS && p.action === action);
  for (const [action, fields] of [
    ['read', readable],
    ['update', EDITOR_UPDATE],
  ]) {
    const existing = editorOn(action);
    if (!existing) {
      await api('POST', '/permissions', { policy: editorPolicy, collection: SETTINGS, action, fields });
      console.log(`+ permission Редактор: ${SETTINGS} ${action}`);
    } else if (
      existing.fields?.includes('*') ||
      existing.fields?.some((f) => SECRET_FIELDS.includes(f)) ||
      fields.some((f) => !existing.fields?.includes(f))
    ) {
      // a wildcard would show the secrets; a field added later joins the list
      // звёздочка показала бы секреты; поле, добавленное позже, входит в список
      await api('PATCH', `/permissions/${existing.id}`, { fields });
      console.log(`= permission Редактор: ${SETTINGS} ${action} — поля без секретов`);
    }
  }
  // the guest chooses how to pay; the outcome is the server's
  // гость выбирает способ оплаты; итог ставит сервер
  const publicCreate = perms.find((p) => p.policy === publicPolicy && p.collection === ORDERS && p.action === 'create');
  if (publicCreate && !publicCreate.fields?.includes('*') && !publicCreate.fields?.includes('payment_method')) {
    await api('PATCH', `/permissions/${publicCreate.id}`, { fields: [...(publicCreate.fields ?? []), 'payment_method'] });
    console.log('= permission Публичная: orders create + payment_method');
  }

  // 4. the order list: a payment column and two bookmarks
  //    список заказов: колонка оплаты и две закладки
  const presets = await api('GET', `/presets?filter[collection][_eq]=${ORDERS}&filter[user][_null]=true&filter[role][_null]=true&limit=-1`);
  const list = presets.find((p) => !p.bookmark);
  const columns = list?.layout_query?.tabular?.fields;
  // right after the order's own status: «new · paid» is what a manager reads first
  // сразу за статусом заказа: «новый · оплачен» менеджер читает первым
  const at = Array.isArray(columns) && columns.includes('status') ? columns.indexOf('status') + 1 : (columns?.length ?? 0);
  const withPayment = Array.isArray(columns)
    ? columns.includes('payment_status')
      ? columns
      : [...columns.slice(0, at), 'payment_status', ...columns.slice(at)]
    : ['status', 'payment_status', 'number', 'date_created', 'customer_name', 'phone', 'total'];
  if (list && Array.isArray(columns) && !columns.includes('payment_status')) {
    const fields = withPayment;
    await api('PATCH', `/presets/${list.id}`, {
      layout_query: { ...list.layout_query, tabular: { ...list.layout_query.tabular, fields } },
      layout_options: {
        ...list.layout_options,
        tabular: { ...list.layout_options?.tabular, widths: { ...list.layout_options?.tabular?.widths, payment_status: 140 } },
      },
    });
    console.log('= preset orders: колонка «Оплата»');
  }
  for (const bookmark of [
    { bookmark: 'Оплачены', icon: 'credit_score', color: '#6F7546', filter: { payment_status: { _eq: 'paid' } } },
    { bookmark: 'Ждут оплату', icon: 'hourglass_top', color: '#C67139', filter: { payment_status: { _eq: 'pending' } } },
  ]) {
    if (presets.some((p) => p.bookmark === bookmark.bookmark)) continue;
    await api('POST', '/presets', {
      collection: ORDERS,
      layout: 'tabular',
      user: null,
      role: null,
      ...bookmark,
      layout_query: { tabular: { fields: withPayment, sort: ['-date_created'], limit: 50 } },
      layout_options: list?.layout_options ?? null,
    });
    console.log(`+ preset orders «${bookmark.bookmark}»`);
  }
}
