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
const SECRET_FIELDS = ['alfa_login', 'alfa_password', 'alfa_token', 'callback_key'];
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
const masked = (field, name, note, sort, width = 'half') => ({
  field,
  type: 'string',
  schema: { max_length: 512 },
  meta: { interface: 'input', options: { masked: true, trim: true }, note, width, sort, translations: tr(name) },
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
          'Секреты (логин, пароль, токен, ключ) надёжнее задать переменными окружения PAY_* на сервере: они важнее полей ниже и не попадают в базу и бэкапы.',
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
    schema: { default_value: 'alfa', max_length: 32 },
    meta: {
      interface: 'select-dropdown',
      options: { choices: [choice('Альфа-Банк', 'alfa'), choice('Заглушка — только для теста, денег не берёт', 'mock')] },
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
    field: 'alfa_login',
    type: 'string',
    schema: { max_length: 128 },
    meta: { interface: 'input', options: { trim: true }, note: 'Из письма банка, обычно оканчивается на «-api»', width: 'half', sort: 9, translations: tr('Логин API') },
  },
  masked('alfa_password', 'Пароль API', 'Скрыт. Переменная PAY_ALFA_PASSWORD важнее этого поля', 10),
  masked('alfa_token', 'Токен API', 'Вместо логина и пароля, если банк выдал токен', 11, 'full'),
  {
    field: 'alfa_gateway_test',
    type: 'string',
    schema: { default_value: 'https://alfa.rbsuat.com/payment/rest/', max_length: 255 },
    meta: { interface: 'input', options: { trim: true }, width: 'half', sort: 12, translations: tr('Шлюз: тест') },
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
      sort: 13,
      translations: tr('Шлюз: бой'),
    },
  },
  masked(
    'callback_key',
    'Ключ уведомлений',
    'Ключ контрольной суммы callback-уведомлений (выдаёт банк). Адрес уведомлений для банка: https://admin.vkus-com.ru/pay/callback',
    14,
    'full',
  ),
  {
    field: 'site_url',
    type: 'string',
    schema: { default_value: 'https://vkus-com.ru', max_length: 255 },
    meta: { interface: 'input', options: { trim: true }, note: 'Куда банк вернёт гостя после оплаты', width: 'half', sort: 15, translations: tr('Адрес сайта') },
  },
  {
    field: 'session_minutes',
    type: 'integer',
    schema: { default_value: 20 },
    meta: { interface: 'input', options: { min: 5, max: 1440 }, note: 'Сколько живёт страница оплаты', width: 'half', sort: 16, translations: tr('Ждём оплату, мин') },
  },
  divider('receipt_divider', 'Чек (54-ФЗ)', 'receipt', 17),
  {
    field: 'receipt_enabled',
    type: 'boolean',
    schema: { default_value: true, is_nullable: false },
    meta: {
      interface: 'boolean',
      options: { label: 'Передавать состав заказа для чека' },
      special: ['cast-boolean'],
      note: 'Нужно, когда у банка подключена онлайн-касса: строки заказа уходят в чек',
      width: 'full',
      sort: 18,
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
      sort: 19,
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
      sort: 20,
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
      note: 'Альфа для доставки с оплатой заранее советует «Предоплата 100 %» и закрывающий чек при передаче — решите с бухгалтером',
      width: 'half',
      sort: 21,
      translations: tr('Способ расчёта'),
    },
  },
  {
    field: 'receipt_ffd',
    type: 'string',
    schema: { default_value: '1.2', max_length: 8 },
    meta: {
      interface: 'select-radio',
      options: { choices: [choice('ФФД 1.2', '1.2'), choice('ФФД 1.05', '1.05')] },
      note: 'Версия формата чека у кассы: от неё зависит, как записана единица «шт»',
      width: 'half',
      sort: 22,
      translations: tr('Формат чека'),
    },
  },
  divider('texts_divider', 'Тексты для гостя', 'chat', 23),
  ...[
    ['text_online', 'Онлайн картой — подпись', 'Картой МИР, Visa или Mastercard на защищённой странице Альфа-Банка'],
    ['text_on_delivery', 'При получении — подпись', 'Наличными или картой курьеру, на кассе при самовывозе'],
    ['text_note', 'Пояснение под выбором', 'Онлайн оплачиваются блюда. Платную доставку назовём при звонке и оплатите её курьеру.'],
    ['text_paid', 'Экран «Заказ оплачен»', 'Спасибо! Перезвоним, чтобы подтвердить адрес и время.'],
    ['text_failed', 'Экран «Оплата не прошла»', 'Деньги не списаны. Заказ сохранён — оформлять его заново не нужно.'],
  ].map(([field, name, placeholder], i) => ({
    field,
    type: 'string',
    schema: { max_length: 300 },
    meta: { interface: 'input', options: { placeholder, trim: true }, note: 'Пусто — текст по умолчанию из подсказки', width: 'full', sort: 24 + i, translations: tr(name) },
  })),
];

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
      conditions: [{ name: 'Не оплачен', rule: { _and: [{ payment_status: { _neq: 'paid' } }] }, hidden: true }],
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
  const settingsFields = (await api('GET', `/fields/${SETTINGS}`)).map((f) => f.field);
  for (const field of SETTINGS_FIELDS) {
    if (settingsFields.includes(field.field)) continue;
    await api('POST', `/fields/${SETTINGS}`, field);
    console.log(`+ field ${SETTINGS}.${field.field}`);
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
