/**
 * Проверка контента: пустое поле в админке ломает страницу молча, поэтому
 * фикстура прогоняется через ту же нормализацию, что и сборка, и падает с
 * названием поля. Запуск: `pnpm test` и первым шагом сборки (`prebuild`).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, type Raw, type ResolveImage } from '../lib/content.ts';
import fixture from './fixture.json' with { type: 'json' };

// fixture files are not in git: CI and the VPS build from Directus and have none,
// so the on-disk check runs only where `pnpm fixture` was executed
// файлы фикстуры не в git: CI и VPS собирают из Directus и их не имеют,
// поэтому сверка с диском идёт только там, где запускали `pnpm fixture`
const DIR = 'src/data/fixture-files';
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR) : [];
if (!files.length) console.log(`${DIR} пуст — проверяю данные без файлов (для pnpm dev нужен pnpm fixture)`);

// в голом Node `import.meta.glob` недоступен: подменяем резолвер картинок и,
// когда файлы скачаны, сверяем, что каждый лежит на диске
const resolve: ResolveImage = (file) => {
  const name = `${file.id}.${file.filename_download.split('.').pop()?.toLowerCase()}`;
  if (files.length && !files.includes(name))
    throw new Error(`нет файла ${DIR}/${name} (${file.title ?? file.id}) — запусти pnpm fixture`);
  return `/${DIR}/${name}`;
};

const raw = fixture as unknown as Raw;
const content = normalize(raw, resolve);

// контакты: без телефона страница теряет главное действие
assert.match(
  content.settings.phoneHref,
  /^tel:\+\d{10,}$/,
  `settings.phone: «${content.settings.phone}» не похож на телефон`,
);

// у каждой точки свой номер; пустой в админке подменяется общим
for (const place of content.places)
  assert.match(
    place.phoneHref,
    /^tel:\+\d{10,}$/,
    `places «${place.name}»: «${place.phone}» не похож на телефон`,
  );
assert.equal(
  normalize({ ...raw, places: raw.places.map((place) => ({ ...place, phone: null })) }, resolve)
    .places[1].phone,
  content.settings.phone,
  'places: точка без своего телефона берёт общий',
);

// две точки, у каждой семь строк часов
assert.equal(content.places.length, 2, 'places: на сайте ровно две точки');
for (const place of raw.places)
  assert.equal(place.hours?.length, 7, `places «${place.name}»: в часах должно быть семь строк`);

// первый экран и SEO
assert.ok(content.home.hero_image, 'home.hero_image: нет фото первого экрана');
assert.ok(
  content.home.seo_title.length <= 60,
  `home.seo_title: ${content.home.seo_title.length} символов, максимум 60`,
);
assert.ok(
  content.home.seo_description.length <= 160,
  `home.seo_description: ${content.home.seo_description.length} символов, максимум 160`,
);

// пять направлений с разными ключами: кнопки карточек зашиты по ключу
assert.deepEqual(
  content.directions.map((direction) => direction.key).sort(),
  ['banquets', 'cafe', 'catering', 'confectionery', 'restaurant'],
  'directions: нужны ровно пять направлений с разными ключами',
);

// галерея направления: в фикстуре поля нет — пустой массив, кадр — фото с подписью
for (const direction of content.directions)
  assert.ok(Array.isArray(direction.gallery), `directions «${direction.title}»: нет массива gallery`);
assert.deepEqual(
  normalize(
    { ...raw, directions: raw.directions.map(({ gallery: _, ...direction }) => direction) },
    resolve,
  ).directions.map((direction) => direction.gallery),
  raw.directions.map(() => []),
  'directions: без поля gallery — пустая галерея',
);
const catering = raw.directions.findIndex((direction) => direction.key === 'catering');
const box = { ...raw.cakes[0].photo, title: 'Бокс с закусками', alt: 'Бокс с закусками' };
const [shot] = normalize(
  {
    ...raw,
    directions: raw.directions.map((direction, i) =>
      i === catering
        ? { ...direction, gallery: [{ sort: 1, caption: 'Бокс', directus_files_id: box }] }
        : direction,
    ),
  },
  resolve,
).directions[catering].gallery;
assert.equal(shot.caption, 'Бокс', 'directions.gallery: подпись из строки связки');
assert.equal(shot.image.alt, 'Бокс с закусками', 'directions.gallery: фото из directus_files_id');
assert.equal(shot.image.placeholder, false, 'directions.gallery: файл без пометки — не заглушка');
// строка связки без файла (фото удалили из библиотеки) пропускается, а не валит сборку
assert.deepEqual(
  normalize(
    {
      ...raw,
      directions: raw.directions.map((direction, i) =>
        i === catering
          ? {
              ...direction,
              gallery: [
                { sort: 1, caption: 'Пусто', directus_files_id: null },
                { sort: 2, caption: 'Бокс', directus_files_id: box },
              ],
            }
          : direction,
      ),
    },
    resolve,
  ).directions[catering].gallery.map((item) => item.caption),
  ['Бокс'],
  'directions.gallery: строка с удалённым файлом пропускается',
);

// пустой alt подменяется заголовком файла; без заголовка нормализация валится с именем файла
const hero = raw.home.hero_image;
assert.equal(
  normalize({ ...raw, home: { ...raw.home, hero_image: { ...hero, alt: '' } } }, resolve).home
    .hero_image.alt,
  hero.title,
);
assert.throws(
  () =>
    normalize(
      { ...raw, home: { ...raw.home, hero_image: { ...hero, alt: '', title: '' } } },
      resolve,
    ),
  /alt пуст/,
);

// заменённый файл — настоящий, даже с пометкой и посевным alt; alt берётся из заголовка
const seed = raw.cakes[0].photo;
const stamped = {
  ...seed,
  title: '[заглушка] Торт «Медовик»',
  alt: 'Торт «Медовик» — фото появится позже',
  created_on: '2026-09-23T10:26:53.000Z',
};
const cakeOf = (photo: typeof stamped) =>
  normalize({ ...raw, cakes: [{ ...raw.cakes[0], photo }] }, resolve).cakes[0].photo;
const untouched = cakeOf({ ...stamped, uploaded_on: '2026-09-23T10:26:53.006Z' });
assert.equal(untouched.placeholder, true, 'посевной файл остаётся заглушкой');
assert.equal(untouched.alt, 'Торт «Медовик» — фото появится позже');
const real = cakeOf({ ...stamped, uploaded_on: '2026-09-29T12:30:15.516Z' });
assert.equal(real.placeholder, false, 'заменённый файл — не заглушка');
assert.equal(real.alt, 'Торт «Медовик»', 'посевной alt под настоящим фото уступает заголовку');
assert.equal(
  cakeOf({ ...stamped, alt: 'Фото торта (заглушка)', uploaded_on: '2026-09-29T12:30:15.516Z' }).alt,
  'Торт «Медовик»',
  'alt «(заглушка)» без префикса тоже уступает заголовку',
);

console.log(
  `контент фикстуры: ${content.places.length} точки, ${content.directions.length} направлений, ` +
    `${content.cakes.length} тортов, ${content.promos.length} акций — все проверки прошли`,
);

// ── каталог доставки ─────────────────────────────────────────────────────────
// В фикстуре каталог есть, если его выгрузили из Directus; без него — пустой,
// и это не ошибка: сайт обязан собираться и без каталога.
const catalog = content.catalog;
const rawCats = raw.product_categories ?? [];
const rawDishes = raw.products ?? [];
assert.equal(
  catalog.count,
  catalog.categories.reduce((sum, category) => sum + category.products.length, 0),
  'catalog.count: сумма блюд по разделам',
);
assert.equal(
  normalize({ ...raw, product_categories: undefined, products: undefined }, resolve).catalog.count,
  0,
  'каталог: без коллекций каталога сайт собирается с пустым каталогом',
);
const slugs = catalog.categories.flatMap((category) => category.products.map((product) => product.slug));
assert.equal(new Set(slugs).size, slugs.length, 'каталог: адреса блюд не повторяются');
assert.equal(
  new Set(catalog.categories.map((category) => category.slug)).size,
  catalog.categories.length,
  'каталог: адреса разделов не повторяются',
);
for (const category of catalog.categories) {
  for (const product of category.products) {
    assert.ok(Number.isInteger(product.price) && product.price >= 0, `«${product.title}»: цена целыми рублями`);
    assert.ok(product.title.trim(), `блюдо ${product.id}: пустое название`);
    if (product.variants.length) assert.ok(product.variants.length > 1, `«${product.title}»: один вариант сворачивается в цену`);
  }
  // стоп-лист в конце раздела
  const flags = category.products.map((product) => product.available);
  assert.deepEqual(flags, [...flags].sort((a, b) => Number(b) - Number(a)), `«${category.title}»: нет в наличии — в конце раздела`);
}

if (rawCats.length && rawDishes.length) {
  // черновик блюда и черновик раздела не видны; раздел без блюд не рисуется
  const firstCat = rawCats.find((category) => category.status === 'published')!;
  const dish = rawDishes.find((product) => product.status === 'published' && product.category === firstCat.id)!;
  const hidden = normalize(
    { ...raw, products: rawDishes.map((product) => (product.id === dish.id ? { ...product, status: 'draft' } : product)) },
    resolve,
  ).catalog;
  assert.ok(
    !hidden.categories.some((category) => category.products.some((product) => product.id === dish.id)),
    'каталог: черновик блюда не попадает на страницу',
  );
  const noCat = normalize(
    { ...raw, product_categories: rawCats.map((category) => (category.id === firstCat.id ? { ...category, status: 'draft' } : category)) },
    resolve,
  ).catalog;
  assert.ok(!noCat.categories.some((category) => category.id === firstCat.id), 'каталог: скрытый раздел скрывает и свои блюда');

  // блюдо без цены и без названия выпадает с предупреждением, а не валит сборку
  const warnings: string[] = [];
  const broken = (await import('../lib/catalog.ts')).normalizeCatalog(
    rawCats,
    rawDishes.map((product, i) => (i === 0 ? { ...product, price: null, variants: [] } : i === 1 ? { ...product, title: ' ' } : product)),
    () => undefined,
    (message) => warnings.push(message),
  );
  assert.equal(warnings.length, 2, 'каталог: о пропущенных блюдах сказано в логе');
  assert.equal(broken.count, catalog.count - 2 + 0, 'каталог: два битых блюда пропущены, остальные на месте');

  // нет в наличии — уходит в конец раздела, но остаётся на странице
  const out = normalize(
    { ...raw, products: rawDishes.map((product) => (product.id === dish.id ? { ...product, available: false } : product)) },
    resolve,
  ).catalog.categories.find((category) => category.id === firstCat.id)!;
  assert.equal(out.products.at(-1)?.id, dish.id, 'каталог: блюдо из стоп-листа стоит последним в разделе');
  assert.equal(out.products.at(-1)?.available, false);

  // фото без alt подписывается названием блюда, без размеров — плашка
  const withPhoto = rawDishes.find((product) => product.photo && product.status === 'published' && product.category === firstCat.id);
  if (withPhoto) {
    type Photo = NonNullable<(typeof rawDishes)[number]['photo']>;
    const photoOf = (photo: Photo) =>
      normalize({ ...raw, products: rawDishes.map((product) => (product.id === withPhoto.id ? { ...product, photo } : product)) }, resolve)
        .catalog.categories.flatMap((category) => category.products)
        .find((product) => product.id === withPhoto.id)?.photo;
    assert.equal(photoOf({ ...withPhoto.photo!, alt: '', title: '' })?.alt, withPhoto.title, 'каталог: фото без alt — по названию блюда');
    assert.equal(photoOf({ ...withPhoto.photo!, width: null }), undefined, 'каталог: фото без размеров — плашка, а не падение');
  }
}

// ── корзина и заказ ──────────────────────────────────────────────────────────
{
  const { add, setQty, priced, reconcile, parseCart, empty, MAX_QTY } = await import('../lib/cart.ts');
  const { buildOrder, normalizePhone, maskPhone, validate, slotsFor, daysFrom, desiredTime, orderNumber } = await import(
    '../lib/order.ts'
  );
  const all = catalog.categories.flatMap((category) => category.products);
  const index = new Map(all.map((product) => [product.id, product]));
  const simple = all.find((product) => product.available && !product.variants.length);
  const sized = all.find((product) => product.available && product.variants.length > 1);

  if (simple) {
    let cart = add(add(empty(), simple.id), simple.id);
    assert.equal(priced(cart, index).total, simple.price * 2, 'корзина: сумма — цена × количество');
    cart = setQty(cart, simple.id, null, 999);
    assert.equal(priced(cart, index).count, MAX_QTY, `корзина: не больше ${MAX_QTY} одного блюда`);
    assert.equal(priced(setQty(cart, simple.id, null, 0), index).lines.length, 0, 'корзина: ноль убирает строку');
    // корзина из хранилища: битая строка — пустая корзина; неизвестное блюдо выпадает с названием
    assert.deepEqual(parseCart('{oops'), empty());
    assert.deepEqual(parseCart(JSON.stringify({ v: 2, lines: [] })), empty());
    const stale = reconcile(parseCart(JSON.stringify({ v: 1, lines: [{ id: simple.id, variant: null, qty: 1 }, { id: -5, variant: null, qty: 1 }, { id: 999999, variant: null, qty: 3 }] })), index);
    assert.equal(stale.cart.lines.length, 1, 'корзина: блюда, которых нет в каталоге, выпадают');
    assert.equal(stale.dropped.length, 1, 'корзина: о выпавшем сказано гостю');

    // заказ: строки, сумма, телефон в одном виде, время словами
    const form = {
      name: ' Анна ',
      phone: '8 (987) 955 25 65',
      fulfillment: 'delivery' as const,
      address: 'Садовая, 212Б',
      details: 'кв. 5',
      when: 'asap' as const,
      comment: '',
      consent: true,
    };
    assert.deepEqual(validate(form), {}, 'заказ: заполненная форма проходит');
    const order = buildOrder(add(empty(), simple.id, null, 3), index, form, '1210-4821');
    assert.equal(order.phone, '+7 987 955-25-65');
    assert.equal(order.customer_name, 'Анна');
    assert.equal(order.total, simple.price * 3);
    assert.deepEqual(order.items, [
      { product: simple.id, title: simple.title, variant: null, filling: null, qty: 3, price: simple.price, sum: simple.price * 3 },
    ]);
    assert.equal(order.desired_time, 'Как можно скорее');
    assert.equal(order.place, null, 'заказ: у доставки нет точки самовывоза');
    const pickup = buildOrder(add(empty(), simple.id), index, { ...form, fulfillment: 'pickup', place: content.places[0].id }, 'x');
    assert.equal(pickup.address, null, 'заказ: у самовывоза нет адреса');
    assert.equal(pickup.place, content.places[0].id);
    // блюдо из стоп-листа в заказ не идёт
    const outIndex = new Map(index);
    outIndex.set(simple.id, { ...simple, available: false });
    assert.equal(priced(add(empty(), simple.id), outIndex).blocked, true, 'корзина: стоп-лист блокирует оформление');
  }
  if (sized) {
    const [small, big] = sized.variants;
    const filling = sized.fillings[0] ?? null;
    const cart = add(add(empty(), sized.id, small.name, 1, filling), sized.id, big.name, 2, filling);
    assert.equal(priced(cart, index).total, small.price + big.price * 2, 'корзина: у каждого размера своя цена');
    assert.equal(priced(add(empty(), sized.id, null, 1, filling), index).lines.length, 0, 'корзина: блюдо с размерами без размера не считается');
  }
  // торт с начинками: без начинки строка не собрана, разные начинки — разные строки
  const cake = all.find((product) => product.available && product.fillings.length > 1);
  if (cake) {
    const size = cake.variants[0]?.name ?? null;
    const [first, second] = cake.fillings;
    assert.equal(priced(add(empty(), cake.id, size), index).lines.length, 0, 'корзина: торт без начинки не считается');
    const two = add(add(empty(), cake.id, size, 1, first), cake.id, size, 1, second);
    assert.equal(priced(two, index).lines.length, 2, 'корзина: две начинки — две строки');
    assert.equal(
      reconcile(add(empty(), cake.id, size, 1, 'Начинки нет в каталоге'), index).dropped.length,
      1,
      'корзина: начинка, которой больше нет, выпадает с названием',
    );
    const order = buildOrder(two, index, { name: 'А', phone: '9879552565', fulfillment: 'pickup', place: content.places[0].id, when: 'asap', consent: true }, 'x');
    assert.deepEqual(order.items.map((line) => line.filling), [first, second], 'заказ: начинка уходит в строке заказа');
  }
  // the fixture of the imported shop has cakes with fillings; without them the check above is skipped
  // в фикстуре из магазина есть торты с начинками; без них проверка выше пропускается
  if (all.length) assert.ok(cake, 'фикстура: нет торта с начинками — проверка начинок не прошла бы');

  // телефон: маска и проверка
  assert.equal(maskPhone('89879552565'), '+7 (987) 955-25-65');
  assert.equal(maskPhone('+7 987'), '+7 (987)');
  assert.equal(maskPhone('9'), '+7 (9');
  assert.equal(normalizePhone('+7 (987) 955-25-65'), '+7 987 955-25-65');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('+7 (123) 955-25-65'), null, 'телефон: код не начинается с 1 или 2');
  // straight quotes from the shop become the page's own
  // прямые кавычки магазина становятся кавычками страницы
  {
    const { normalizeCatalog } = await import('../lib/catalog.ts');
    const quoted = normalizeCatalog(
      [{ id: 1, status: 'published', sort: 1, title: 'Пирожные', slug: 'p' }],
      [{ id: 1, status: 'published', sort: 1, title: 'Пирожное "Мохито"', price: 425, category: 1 }] as never,
      () => undefined,
      () => {},
    );
    assert.equal(quoted.categories[0].products[0].title, 'Пирожное «Мохито»', 'кавычки: прямые не заменились ёлочками');
  }

  // the order hook in Directus repeats the site's rules: the same phone and the
  // same size must come out the same on both sides, or a valid order is refused
  // хук заказов в Directus повторяет правила сайта: один и тот же телефон и
  // размер должны выходить одинаково с обеих сторон, иначе верный заказ отклонят
  const guard = await import('../../directus/extensions/order-guard/index.js');
  const { weightText } = await import('../lib/catalog.ts');
  for (const sample of ['8 (987) 955 25 65', '+7 987 955-25-65', '9879552565', '+7 (123) 955-25-65', '12345', ''])
    assert.equal(guard.normalizePhone(sample), normalizePhone(sample), `телефон «${sample}»: сайт и хук заказов расходятся`);
  for (const sample of ['30гр', '1,5кг', '2, 5 кг', '250 мл', '0,5л', '6шт', '1 кг', 'Большой'])
    assert.equal(guard.weightText(sample), weightText(sample), `размер «${sample}»: сайт и хук заказов расходятся`);

  const errors = validate({ name: '', phone: '123', fulfillment: 'pickup', place: null, when: 'later', consent: false });
  assert.deepEqual(Object.keys(errors).sort(), ['consent', 'name', 'phone', 'place', 'time'], 'форма: все пустые обязательные поля названы');

  // время: слоты по полчаса, сегодня — не раньше чем через час
  const noon = new Date('2026-10-12T12:10:00+04:00');
  assert.equal(slotsFor('2026-10-12', noon)[0], '13:30');
  assert.equal(slotsFor('2026-10-13', noon)[0], '09:00');
  assert.equal(slotsFor('2026-10-12', new Date('2026-10-12T21:30:00+04:00')).length, 0, 'время: вечером сегодня слотов нет');
  assert.equal(daysFrom(new Date('2026-10-12T21:30:00+04:00'))[0].value, '2026-10-13', 'время: тогда первым идёт завтра');
  assert.equal(daysFrom(noon).length, 7);
  assert.match(
    desiredTime({ name: 'a', phone: '', fulfillment: 'delivery', when: 'later', date: '2026-10-16', time: '14:30', consent: true }),
    /^пт, 16 октября, к 14:30$/,
  );
  assert.match(orderNumber(new Date('2026-10-12T10:00:00+04:00'), 0.5), /^1210-\d{4}$/);
}

// заголовок и описание страницы каталога — в пределах выдачи
{
  const page = fs.readFileSync('src/pages/catalog/index.astro', 'utf8');
  const description = page.match(/const description =\s*'([^']+)'/)?.[1] ?? '';
  assert.ok(description.length > 50 && description.length <= 160, `catalog description: ${description.length} символов`);
}

console.log(
  `каталог фикстуры: разделов ${catalog.categories.length}, блюд ${catalog.count} — проверки каталога, корзины и заказа прошли`,
);
