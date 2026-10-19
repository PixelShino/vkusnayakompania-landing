// Rights and lists of the guest account, called at the end of
// `scripts/directus-setup.mjs`. Idempotent like the rest of the setup: only
// what is missing is added; a rule that drifted from the one below is put back.
// Права и списки личного кабинета, вызывается в конце
// `scripts/directus-setup.mjs`. Идемпотентен, как и весь setup: дописывает
// только недостающее; правило, разошедшееся с описанным ниже, возвращается.
//
//   «Гость»   — sees and edits only himself and only the profile fields; reads
//               his orders and his points; creates an order like the public
//               (the `order-guard` hook checks it and binds it to him);
//   «Гость»   — видит и правит только себя и только поля профиля; читает свои
//               заказы и свои баллы; создаёт заказ как публичная роль (хук
//               `order-guard` проверяет его и привязывает к гостю);
//   «Редактор» — the programme and sign-in settings, guests (not staff), the
//               points ledger: reads it and adds manual entries, never edits
//               or deletes one;
//   «Редактор» — настройки программы и входа, гости (не сотрудники), операции
//               по баллам: читает и проводит ручные, не правит и не удаляет;
//   «Сборщик» — the programme settings, for the account page.
//   «Сборщик» — настройки программы, для страницы кабинета.

export const GUEST_PROFILE_READ = [
  'id', 'first_name', 'middle_name', 'last_name', 'phone', 'birthday', 'gender', 'recovery_email',
  'bonus_balance', 'total_spent', 'tier', 'guest_since', 'birthday_set_at',
];
export const GUEST_PROFILE_WRITE = ['first_name', 'middle_name', 'last_name', 'birthday', 'gender', 'recovery_email'];
const GUEST_ORDER_READ = [
  'id', 'number', 'status', 'date_created', 'fulfillment', 'place', 'address', 'desired_time',
  'items', 'total', 'bonus_spent', 'discount', 'to_pay', 'bonus_earned',
];
// what `order-guard` adds to a guest's order on top of the public fields
// что `order-guard` добавляет к заказу гостя поверх публичных полей
const GUEST_ORDER_EXTRA = ['customer', 'bonus_spent', 'discount', 'to_pay'];
const GUEST_TX_READ = ['id', 'type', 'amount', 'date_created', 'expires_at', 'comment', 'order'];
const EDITOR_GUEST_READ = [
  ...GUEST_PROFILE_READ, 'email', 'status', 'last_access', 'birthday_bonus_year', 'bonus_history', 'guest_orders',
];
const EDITOR_GUEST_WRITE = [...GUEST_PROFILE_WRITE, 'status', 'bonus_history'];
const ONLY_GUESTS = { role: { name: { _eq: 'Гость' } } };
const ME = { id: { _eq: '$CURRENT_USER' } };

/**
 * One permission per (policy, collection, action): created when missing,
 * patched when its fields or rules differ.
 * Одно право на (политика, коллекция, действие): создаётся, если нет,
 * правится, если поля или правила разошлись.
 */
const ensure = async (api, policy, collection, action, rule) => {
  const [current] = await api(
    'GET',
    `/permissions?filter[policy][_eq]=${policy}&filter[collection][_eq]=${collection}&filter[action][_eq]=${action}&limit=1`,
  );
  const want = { fields: ['*'], permissions: null, validation: null, presets: null, ...rule };
  if (!current) {
    await api('POST', '/permissions', { policy, collection, action, ...want });
    console.log(`+ permission ${collection} ${action}`);
    return;
  }
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const fieldsSame = same([...(current.fields ?? [])].sort(), [...want.fields].sort());
  if (!fieldsSame || !same(current.permissions, want.permissions) || !same(current.validation, want.validation) || !same(current.presets, want.presets)) {
    await api('PATCH', `/permissions/${current.id}`, want);
    console.log(`= permission ${collection} ${action}`);
  }
};

export async function setup(api, { findOne, ORDER_FIELDS_PUBLIC }) {
  // ── role «Гость» / роль «Гость» ──────────────────────────────────────────
  let policy = await findOne('/policies', { name: { _eq: 'Гость' } });
  if (!policy) {
    policy = await api('POST', '/policies', {
      name: 'Гость',
      icon: 'loyalty',
      description: 'Гости сайта: личный кабинет, свои заказы и баллы. В админку не входят',
      app_access: false,
      admin_access: false,
    });
    console.log('+ policy Гость');
  }
  let role = await findOne('/roles', { name: { _eq: 'Гость' } });
  if (!role) {
    role = await api('POST', '/roles', {
      name: 'Гость',
      icon: 'loyalty',
      description: 'Заводится сайтом при первом входе по телефону',
      policies: [{ policy: policy.id }],
    });
    console.log('+ role Гость');
  }

  await ensure(api, policy.id, 'directus_users', 'read', { fields: GUEST_PROFILE_READ, permissions: ME });
  await ensure(api, policy.id, 'directus_users', 'update', { fields: GUEST_PROFILE_WRITE, permissions: ME });
  await ensure(api, policy.id, 'orders', 'read', { fields: GUEST_ORDER_READ, permissions: { customer: { _eq: '$CURRENT_USER' } } });
  await ensure(api, policy.id, 'orders', 'create', {
    fields: [...new Set([...ORDER_FIELDS_PUBLIC, ...GUEST_ORDER_EXTRA])],
    presets: { status: 'new', source: 'site' },
    // the same as the public order, and the order is the guest's own
    // то же, что у публичного заказа, и заказ — самого гостя
    validation: {
      _and: [
        { status: { _eq: 'new' } },
        { source: { _eq: 'site' } },
        { consent: { _eq: true } },
        { customer_name: { _nempty: true } },
        { phone: { _nempty: true } },
        { customer: { _eq: '$CURRENT_USER' } },
      ],
    },
  });
  await ensure(api, policy.id, 'bonus_transactions', 'read', { fields: GUEST_TX_READ, permissions: { user: { _eq: '$CURRENT_USER' } } });

  // ── editors / редактор ───────────────────────────────────────────────────
  const editor = await findOne('/policies', { name: { _eq: 'Редактор' } });
  if (editor) {
    for (const collection of ['loyalty_settings', 'guest_auth_settings']) {
      await ensure(api, editor.id, collection, 'read', {});
      await ensure(api, editor.id, collection, 'update', {});
    }
    // the ledger is append-only: a mistake is fixed by an entry the other way
    // книга баллов только дописывается: ошибку исправляют встречной операцией
    await ensure(api, editor.id, 'bonus_transactions', 'read', {});
    await ensure(api, editor.id, 'bonus_transactions', 'create', { presets: { type: 'manual' } });
    // guests only — the staff accounts stay out of an editor's reach
    // только гости — учётки сотрудников редактору недоступны
    await ensure(api, editor.id, 'directus_users', 'read', { fields: EDITOR_GUEST_READ, permissions: ONLY_GUESTS });
    await ensure(api, editor.id, 'directus_users', 'update', { fields: EDITOR_GUEST_WRITE, permissions: ONLY_GUESTS });
  }

  // ── the builder: the programme for the account page / сборщик ────────────
  const builder = await findOne('/policies', { name: { _eq: 'Сборщик' } });
  if (builder) await ensure(api, builder.id, 'loyalty_settings', 'read', {});

  // ── lists / списки ───────────────────────────────────────────────────────
  const PRESETS = [
    {
      collection: 'bonus_transactions',
      layout_query: {
        tabular: { fields: ['date_created', 'user', 'type', 'amount', 'order', 'comment'], sort: ['-date_created'], limit: 50 },
      },
      layout_options: { tabular: { widths: { date_created: 150, user: 240, type: 190, amount: 90, order: 120, comment: 320 } } },
    },
    { collection: 'bonus_transactions', bookmark: 'Вручную', icon: 'edit_note', color: '#333721', filter: { type: { _eq: 'manual' } } },
    { collection: 'bonus_transactions', bookmark: 'Сгорание', icon: 'local_fire_department', color: '#A79C8A', filter: { type: { _eq: 'expire' } } },
    {
      collection: 'directus_users',
      bookmark: 'Гости сайта',
      icon: 'loyalty',
      color: '#6F7546',
      filter: ONLY_GUESTS,
      layout_query: {
        tabular: {
          fields: ['first_name', 'last_name', 'phone', 'bonus_balance', 'tier', 'total_spent', 'birthday', 'last_access'],
          sort: ['-last_access'],
          limit: 50,
        },
      },
      layout_options: {
        tabular: { widths: { first_name: 150, last_name: 160, phone: 170, bonus_balance: 110, tier: 120, total_spent: 140, birthday: 130, last_access: 160 } },
      },
    },
  ];
  const presetsNow = await api('GET', '/presets?filter[user][_null]=true&filter[role][_null]=true&limit=-1');
  for (const preset of PRESETS) {
    if (presetsNow.some((p) => p.collection === preset.collection && (p.bookmark ?? null) === (preset.bookmark ?? null))) continue;
    await api('POST', '/presets', { layout: 'tabular', user: null, role: null, bookmark: null, ...preset });
    console.log(`+ preset ${preset.collection}${preset.bookmark ? ` «${preset.bookmark}»` : ''}`);
  }
}
