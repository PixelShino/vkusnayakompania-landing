// Delivery by zone in Directus: the «Зоны доставки» collection with its seed,
// the delivery fields of an order next to the address, who may see what.
// Idempotent like the rest of the setup: what exists is left alone, what is
// missing is added; the zones are seeded only into an empty collection, so a
// price the owner changed in the admin is never overwritten.
// Доставка по зонам в Directus: коллекция «Зоны доставки» с начальными
// данными, поля доставки у заказа рядом с адресом, кому что видно.
// Идемпотентно, как вся настройка: существующее не трогается, недостающее
// добавляется; зоны заводятся только в пустую коллекцию, поэтому цену, которую
// владелец поменял в админке, повторный запуск не затрёт.
//
// The seed: `src/data/delivery-zones.json` — the zones of the FoodPicasso shop
// (`vkusdostavka.shop`, taken 20.10.2026): price, free from, minimum order and
// the polygon `[[lng, lat], …]`; the ids are the shop's, the names are ours.
// Начальные данные: `src/data/delivery-zones.json` — зоны магазина FoodPicasso
// (`vkusdostavka.shop`, сняты 20.10.2026): цена, бесплатно от, минимальный
// заказ и полигон `[[долгота, широта], …]`; id — магазина, имена — наши.
//
// Called from `scripts/directus-setup.mjs`:
//   await setup(api, { editorPolicy, builderPolicy, publicPolicy })

import { readFileSync } from 'node:fs';

const ZONES = 'delivery_zones';
const ORDERS = 'orders';
const SEED = new URL('../../src/data/delivery-zones.json', import.meta.url);

const tr = (text) => [{ language: 'ru-RU', translation: text }];
const choice = (text, value) => ({ text, value });
const label = (text, value, background, foreground) => ({ text, value, background, foreground, color: foreground });
const rubles = (field, name, note, sort, schema = {}) => ({
  field,
  type: 'integer',
  schema,
  meta: {
    interface: 'input',
    options: { min: 0, step: 50 },
    display: 'formatted-value',
    display_options: { suffix: ' ₽', format: true },
    note,
    width: 'half',
    sort,
    translations: tr(name),
  },
});

/** Поля «Зон доставки». */
const ZONE_FIELDS = [
  { field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true }, meta: { hidden: true, readonly: true, sort: 1 } },
  {
    field: 'status',
    type: 'string',
    schema: { default_value: 'published', max_length: 16, is_nullable: false },
    meta: {
      interface: 'select-dropdown',
      options: { choices: [choice('Действует', 'published'), choice('Выключена', 'draft')] },
      display: 'labels',
      display_options: {
        showAsDot: false,
        choices: [label('Действует', 'published', '#E7E9D6', '#474C2B'), label('Выключена', 'draft', '#EEE8DD', '#6E655A')],
      },
      note: 'Выключенная зона не считается: адрес в ней — «вне зон», стоимость назовёт менеджер',
      width: 'half',
      sort: 2,
      translations: tr('Статус'),
    },
  },
  { field: 'sort', type: 'integer', meta: { interface: 'input', hidden: true, sort: 3 } },
  {
    field: 'name',
    type: 'string',
    schema: { max_length: 120, is_nullable: false },
    meta: {
      interface: 'input',
      options: { trim: true },
      required: true,
      note: 'Так зону видят гость в корзине и менеджер в заказе',
      width: 'full',
      sort: 4,
      translations: tr('Название'),
    },
  },
  rubles('price', 'Доставка, ₽', '0 — бесплатно всегда', 5, { default_value: 0, is_nullable: false }),
  rubles('free_from', 'Бесплатно от, ₽', 'Сумма блюд до скидки и баллов. Пусто — бесплатной доставки нет', 6),
  rubles('min_order', 'Минимальный заказ, ₽', 'Меньше — заказ с доставкой сюда не примем, предложим добрать или самовывоз. 0 — без минимума', 7, { default_value: 0 }),
  {
    field: 'polygon',
    type: 'json',
    meta: {
      interface: 'input-code',
      options: { language: 'JSON', lineNumber: false },
      special: ['cast-json'],
      note: 'Граница зоны: точки [долгота, широта] из магазина FoodPicasso. Менять не нужно',
      width: 'full',
      sort: 8,
      translations: tr('Граница на карте'),
    },
  },
];

/** Поля доставки у заказа: рядом с адресом. */
const ORDER_FIELDS = [
  {
    field: 'delivery_zone',
    type: 'string',
    schema: { max_length: 120 },
    meta: {
      interface: 'input',
      options: { trim: true },
      note: 'Сервер находит зону по адресу. Пусто — адрес не нашли на карте или он вне зон: стоимость назвать при звонке',
      width: 'half',
      sort: 13,
      translations: tr('Зона доставки'),
    },
  },
  {
    field: 'delivery_cost',
    type: 'integer',
    schema: {},
    meta: {
      interface: 'input',
      options: { min: 0 },
      display: 'formatted-value',
      display_options: { suffix: ' ₽', format: true },
      note: '0 — бесплатно, пусто — назвать при звонке (в «К оплате» не вошла)',
      width: 'half',
      sort: 14,
      translations: tr('Доставка, ₽'),
    },
  },
];
const ORDER_NEW = ORDER_FIELDS.map((f) => f.field);
// the words of two old fields of an order change with the delivery: «Сумма» is
// the dishes, «К оплате» carries the delivery
// слова двух старых полей заказа меняются вместе с доставкой: «Сумма» — это
// блюда, «К оплате» несёт доставку
const ORDER_NOTES = {
  total: 'Блюда по ценам каталога — без доставки, скидки и баллов',
  to_pay: 'Блюда − скидка − баллы + доставка: столько оплачено онлайн или взять с гостя',
};
// set by `order-guard` on every site order, before permissions are checked
// ставит `order-guard` у каждого заказа с сайта, до проверки прав
const PUBLIC_ORDER_FIELDS = ['delivery_zone', 'delivery_cost', 'to_pay'];

export async function setup(api, { editorPolicy, builderPolicy = null, publicPolicy }) {
  const has = async (path) => {
    try {
      await api('GET', path);
      return true;
    } catch (error) {
      if (/→ (403|404)/.test(error.message)) return false;
      throw error;
    }
  };

  // 1. «Зоны доставки» in the catalog group / «Зоны доставки» в группе каталога
  if (!(await has(`/collections/${ZONES}`))) {
    await api('POST', '/collections', {
      collection: ZONES,
      schema: {},
      meta: {
        icon: 'local_shipping',
        group: 'catalog',
        sort: 4,
        sort_field: 'sort',
        display_template: '{{name}} · {{price}} ₽',
        note: 'Стоимость доставки по адресу: цена, бесплатно от, минимальный заказ. Корзина и сервер считают по этим цифрам',
        translations: [{ language: 'ru-RU', translation: 'Зоны доставки', singular: 'Зона доставки', plural: 'Зоны доставки' }],
      },
      fields: ZONE_FIELDS.filter((f) => f.field === 'id'),
    });
    console.log(`+ collection ${ZONES}`);
  }
  const zoneFields = (await api('GET', `/fields/${ZONES}`)).map((f) => f.field);
  for (const field of ZONE_FIELDS) {
    if (zoneFields.includes(field.field)) continue;
    await api('POST', `/fields/${ZONES}`, field);
    console.log(`+ field ${ZONES}.${field.field}`);
  }

  // 2. the seed, into an empty collection only / начальные зоны — только в пустую коллекцию
  const [anyZone] = await api('GET', `/items/${ZONES}?limit=1&fields=id`);
  if (!anyZone) {
    const zones = JSON.parse(readFileSync(SEED, 'utf8'));
    await api('POST', `/items/${ZONES}`, zones);
    console.log(`+ ${zones.length} зон доставки из src/data/delivery-zones.json`);
  }

  // 3. the delivery fields of an order, right after the address: the fields
  //    below them move down to make room (only when the fields are new)
  //    поля доставки у заказа сразу после адреса: поля ниже сдвигаются,
  //    освобождая место (только когда поля новые)
  const orderFields = await api('GET', `/fields/${ORDERS}`);
  const missing = ORDER_FIELDS.filter((f) => !orderFields.some((o) => o.field === f.field));
  if (missing.length) {
    const first = Math.min(...ORDER_FIELDS.map((f) => f.meta.sort));
    const moved = orderFields
      .filter((o) => !ORDER_NEW.includes(o.field) && Number.isFinite(o.meta?.sort) && o.meta.sort >= first)
      .map((o) => ({ field: o.field, meta: { sort: o.meta.sort + ORDER_FIELDS.length } }));
    if (moved.length) await api('PATCH', `/fields/${ORDERS}`, moved);
    for (const field of missing) {
      await api('POST', `/fields/${ORDERS}`, field);
      console.log(`+ field ${ORDERS}.${field.field}`);
    }
  }
  for (const [field, note] of Object.entries(ORDER_NOTES)) {
    const have = orderFields.find((o) => o.field === field);
    if (have && have.meta?.note !== note) {
      await api('PATCH', `/fields/${ORDERS}/${field}`, { meta: { note } });
      console.log(`= field ${ORDERS}.${field}: подсказка про доставку`);
    }
  }

  // 4. permissions / права
  const perms = await api('GET', `/permissions?filter[collection][_in]=${ZONES},${ORDERS}&limit=-1`);
  const ensure = async (policy, collection, action, fields = ['*']) => {
    if (!policy || perms.some((p) => p.policy === policy && p.collection === collection && p.action === action)) return;
    await api('POST', '/permissions', { policy, collection, action, fields });
    console.log(`+ permission ${collection} ${action}`);
  };
  // editors change prices and thresholds, switch a zone off; new zones and
  // their borders are the administrator's
  // редактор меняет цены и пороги, выключает зону; новые зоны и их границы — у администратора
  await ensure(editorPolicy, ZONES, 'read');
  await ensure(editorPolicy, ZONES, 'update', ['status', 'name', 'price', 'free_from', 'min_order', 'sort']);
  // the site's build may print the zones / сборка сайта может печатать зоны
  await ensure(builderPolicy, ZONES, 'read');
  // the public sends none of these: `order-guard` writes them, and the
  // permission is checked after it
  // публичная роль их не шлёт: их пишет `order-guard`, а права проверяются после него
  const publicCreate = perms.find((p) => p.policy === publicPolicy && p.collection === ORDERS && p.action === 'create');
  const lacking = publicCreate && !publicCreate.fields?.includes('*') ? PUBLIC_ORDER_FIELDS.filter((f) => !publicCreate.fields?.includes(f)) : [];
  if (lacking.length) {
    await api('PATCH', `/permissions/${publicCreate.id}`, { fields: [...(publicCreate.fields ?? []), ...lacking] });
    console.log(`= permission Публичная: orders create + ${lacking.join(', ')}`);
  }

  // 5. the zones' list: by order, with the money columns / список зон: по порядку, с колонками денег
  const presets = await api('GET', `/presets?filter[collection][_eq]=${ZONES}&filter[user][_null]=true&filter[role][_null]=true&limit=-1`);
  if (!presets.some((p) => !p.bookmark)) {
    await api('POST', '/presets', {
      collection: ZONES,
      layout: 'tabular',
      user: null,
      role: null,
      bookmark: null,
      layout_query: { tabular: { fields: ['name', 'price', 'free_from', 'min_order', 'status'], sort: ['sort'], limit: 25 } },
      layout_options: { tabular: { widths: { name: 420, price: 130, free_from: 150, min_order: 170, status: 130 } } },
    });
    console.log(`+ preset ${ZONES}`);
  }
}
