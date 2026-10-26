// The menu of each venue and the orders in the hall (26.10.2026), called at
// the end of `scripts/directus-setup.mjs`. Idempotent like the rest of the
// setup: a field whose look drifted is PATCHed back (`schema apply` does not
// update the texts and choices of an existing field), a missing one is added.
// Меню каждой точки и заказы в зале (26.10.2026), вызывается в конце
// `scripts/directus-setup.mjs`. Идемпотентен, как и весь setup: поле, чей вид
// разошёлся с описанным, возвращается PATCH-ем (`schema apply` не обновляет
// тексты и варианты существующего поля), недостающее заводится.
//
//   products.places «Готовят на» — two ticks, both by default; a dish left
//                   without venues (an older row) gets both;
//   orders.fulfillment — «В зале» (`dine_in`) next to delivery and pickup;
//   orders.place «Точка» — for every order, delivery included (the kitchen);
//   orders.table «Стол» — right after the venue, seen on an order in the hall.
//   products.places «Готовят на» — две галочки, по умолчанию обе; блюдо без
//                   точек (старая строка) получает обе;
//   orders.fulfillment — «В зале» (`dine_in`) рядом с доставкой и самовывозом;
//   orders.place «Точка» — у каждого заказа, у доставки тоже (кухня);
//   orders.table «Стол» — сразу после точки, видно у заказа в зале.

const tr = (text) => [{ language: 'ru-RU', translation: text }];
// key order aside: the database may hand the JSON back with its keys sorted
// без учёта порядка ключей: база может вернуть JSON с отсортированными ключами
const stable = (value) =>
  JSON.stringify(value ?? null, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
const same = (a, b) => stable(a) === stable(b);
const drifted = (have, want) => Object.entries(want).some(([key, value]) => !same(have?.[key], value));

export const PLACES_NOTE = 'Где готовят это блюдо. Гость видит в каталоге только меню выбранной точки.';
export const FULFILLMENT_CHOICES = [
  { text: 'Доставка', value: 'delivery' },
  { text: 'Самовывоз', value: 'pickup' },
  { text: 'В зале', value: 'dine_in' },
];
export const PLACE_META = {
  translations: tr('Точка'),
  note: 'Самовывоз — откуда заберут, «В зале» — где сидит гость, доставка — какая точка готовит: меню на точках разное. Пусто — точку выбирают при звонке',
  conditions: null,
};
export const TABLE_META = {
  interface: 'input',
  options: { trim: true, placeholder: '4' },
  width: 'half',
  translations: tr('Стол'),
  note: 'Номер стола, если гость указал',
  conditions: [{ name: 'Не в зале', rule: { fulfillment: { _neq: 'dine_in' } }, hidden: true }],
};

export async function setup(api) {
  // the choices follow the venues as the admin names them / варианты — точки, как их называет админка
  const venues = await api('GET', '/items/places?fields=id,name&sort=id&limit=-1');
  const choices = venues.map((venue) => ({ text: venue.name, value: String(venue.id) }));

  // ── «Готовят на» ─────────────────────────────────────────────────────────
  const dishFields = await api('GET', '/fields/products');
  const places = dishFields.find((field) => field.field === 'places');
  if (!places) {
    console.warn('places: в products нет поля places («Готовят на») — сначала schema apply по directus/snapshot.yaml');
  } else {
    const want = {
      interface: 'select-multiple-checkbox',
      options: { ...(places.meta?.options ?? {}), choices },
      display: 'labels',
      display_options: { ...(places.meta?.display_options ?? {}), choices },
      required: true,
      translations: tr('Готовят на'),
      note: PLACES_NOTE,
    };
    if (drifted(places.meta, want)) {
      await api('PATCH', '/fields/products/places', { meta: want });
      console.log('= field products.places: «Готовят на», две галочки');
    }
    // a dish without venues reads as «both» on the site; the admin should say so too
    // блюдо без точек сайт читает как «на обеих»; пусть и админка говорит то же
    const blank = { _or: [{ places: { _null: true } }, { places: { _empty: true } }] };
    const empty = await api('GET', `/items/products?filter=${encodeURIComponent(JSON.stringify(blank))}&fields=id&limit=-1`);
    if (empty.length && venues.length) {
      await api('PATCH', '/items/products', { keys: empty.map((dish) => dish.id), data: { places: venues.map((venue) => String(venue.id)) } });
      const n = empty.length;
      const word = n % 10 === 1 && n % 100 !== 11 ? 'блюдо' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'блюда' : 'блюд';
      console.log(`= products.places: ${n} ${word} без точек — отмечены обе`);
    }
  }

  // ── the order: how it is received, where, the table / заказ: получение, точка, стол ──
  const orderFields = await api('GET', '/fields/orders');
  const field = (name) => orderFields.find((f) => f.field === name);

  const fulfillment = field('fulfillment');
  if (fulfillment) {
    const want = {
      options: { ...(fulfillment.meta?.options ?? {}), choices: FULFILLMENT_CHOICES },
      display_options: { ...(fulfillment.meta?.display_options ?? {}), choices: FULFILLMENT_CHOICES },
    };
    if (drifted(fulfillment.meta, want)) {
      await api('PATCH', '/fields/orders/fulfillment', { meta: want });
      console.log('= field orders.fulfillment: + «В зале»');
    }
  }

  const place = field('place');
  if (place && drifted(place.meta, PLACE_META)) {
    await api('PATCH', '/fields/orders/place', { meta: PLACE_META });
    console.log('= field orders.place: «Точка» — самовывоз, зал и кухня доставки');
  }

  const table = field('table');
  if (table) {
    if (drifted(table.meta, TABLE_META)) {
      await api('PATCH', '/fields/orders/table', { meta: TABLE_META });
      console.log('= field orders.table: «Стол»');
    }
  } else if (place) {
    // right after the venue: the fields below it move down to make room
    // сразу после точки: поля ниже сдвигаются, освобождая место
    const after = place.meta?.sort;
    if (Number.isFinite(after)) {
      const moved = orderFields
        .filter((f) => Number.isFinite(f.meta?.sort) && f.meta.sort > after)
        .map((f) => ({ field: f.field, meta: { sort: f.meta.sort + 1 } }));
      if (moved.length) await api('PATCH', '/fields/orders', moved);
    }
    await api('POST', '/fields/orders', {
      field: 'table',
      type: 'string',
      schema: { max_length: 10 },
      meta: { ...TABLE_META, sort: Number.isFinite(after) ? after + 1 : null },
    });
    console.log('+ field orders.table «Стол»');
  }
}
