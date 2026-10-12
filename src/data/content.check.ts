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
// the fixture is normalized many times below; its content notes (an app-only
// offer hidden, …) are collected once and asserted, not printed every time
// фикстура ниже нормализуется много раз; её заметки (скрытая акция приложения
// и т. п.) собираются один раз и проверяются, а не печатаются каждый раз
const notes: string[] = [];
const check = (data: Raw, images: ResolveImage, today?: string) =>
  normalize(data, images, today, (message) => notes.push(message));
const content = check(raw, resolve);

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
  check({ ...raw, places: raw.places.map((place) => ({ ...place, phone: null })) }, resolve)
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
  check(
    { ...raw, directions: raw.directions.map(({ gallery: _, ...direction }) => direction) },
    resolve,
  ).directions.map((direction) => direction.gallery),
  raw.directions.map(() => []),
  'directions: без поля gallery — пустая галерея',
);
const catering = raw.directions.findIndex((direction) => direction.key === 'catering');
const box = { ...raw.cakes[0].photo, title: 'Бокс с закусками', alt: 'Бокс с закусками' };
const [shot] = check(
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
  check(
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
  check({ ...raw, home: { ...raw.home, hero_image: { ...hero, alt: '' } } }, resolve).home
    .hero_image.alt,
  hero.title,
);
assert.throws(
  () =>
    check(
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
  check({ ...raw, cakes: [{ ...raw.cakes[0], photo }] }, resolve).cakes[0].photo;
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

// ── без приложения: каталог на сайте теперь и есть магазин ──────────────────
// The site sends no one to the app or the old shop. Texts written for the app
// still live in the admin: a sentence about it drops out, an app-only offer is
// not shown. Whatever the page prints must not mention the app.
// Сайт никого не отправляет в приложение или старый магазин. Тексты под
// приложение ещё живут в админке: предложение про него выпадает, акция только
// для приложения не показывается. Ничто из выводимого не упоминает приложение.
{
  const { withoutApp, mentionsApp } = await import('../lib/content.ts');
  assert.equal(withoutApp('Меню в PDF, чтобы посмотреть заранее. Заказать на доставку — в приложении.'), 'Меню в PDF, чтобы посмотреть заранее.');
  assert.equal(withoutApp('Скачайте приложение в App Store.'), undefined, 'текст только про приложение выпадает целиком');
  assert.equal(withoutApp('Торты за 48 часов.'), 'Торты за 48 часов.');
  assert.ok(mentionsApp('Ссылка: https://vkusdostavka.shop/'), 'старый магазин тоже считается');

  // the admin as the app left it: a sentence about the app in the menu text,
  // an app-only offer at the top of the list
  // админка, какой её оставило приложение: предложение про приложение в
  // тексте меню и акция только для приложения первой в списке
  const appOffer = {
    ...(raw.promos ?? [])[0],
    id: 9001,
    title: 'Скидка 20 % на первый бокс',
    text: 'При заказе из приложения «Вкусная Компания».',
    place: undefined,
    sort: 0,
  };
  const fromAdmin = check(
    {
      ...raw,
      home: { ...raw.home, menu_text: 'Меню в PDF, чтобы посмотреть заранее. Заказать на доставку — в приложении.' },
      promos: [appOffer, ...(raw.promos ?? [])],
    },
    resolve,
  );
  assert.equal(fromAdmin.home.menu_text, 'Меню в PDF, чтобы посмотреть заранее.', 'предложение про приложение выпало');
  assert.ok(!fromAdmin.promos.some((shown) => shown.id === appOffer.id), 'акция про приложение попала на сайт');
  assert.equal(fromAdmin.promos.length, content.promos.length, 'остальные акции на месте');
  assert.ok(notes.some((note) => note.includes(appOffer.title)), 'скрытая акция не записана в лог сборки');

  // what the page prints: home texts, offers, directions, poster, cakes, the
  // catalog; the settings keep the app links for the admin and are not printed
  // что печатает страница: тексты главной, акции, направления, афиша, торты,
  // каталог; ссылки на приложение в настройках остаются для админки и не выводятся
  // the catering section too, and the old catering site is not linked from anywhere
  // раздел кейтеринга тоже, и на старый сайт кейтеринга ничто не ссылается
  for (const shown of [content, fromAdmin]) {
    const { app_screenshot: _shot, ...homeShown } = shown.home;
    const { catering_url: _c, catering_services_url: _s, ...settingsShown } = shown.settings;
    const printed = JSON.stringify([homeShown, settingsShown, shown.promos, shown.directions, shown.afisha, shown.cakes, shown.catalog, shown.catering]);
    const leak = printed.match(/[^"]{0,40}(приложени|app\s?store|google\s?play|apps\.apple|play\.google|vkusdostavka|vkusnayakompania\.ru)[^"]{0,40}/i);
    assert.equal(leak, null, `на сайте осталось упоминание приложения: «${leak?.[0]}»`);
  }
}

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
  check({ ...raw, product_categories: undefined, products: undefined }, resolve).catalog.count,
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
  const hidden = check(
    { ...raw, products: rawDishes.map((product) => (product.id === dish.id ? { ...product, status: 'draft' } : product)) },
    resolve,
  ).catalog;
  assert.ok(
    !hidden.categories.some((category) => category.products.some((product) => product.id === dish.id)),
    'каталог: черновик блюда не попадает на страницу',
  );
  const noCat = check(
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
  const out = check(
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
      check({ ...raw, products: rawDishes.map((product) => (product.id === withPhoto.id ? { ...product, photo } : product)) }, resolve)
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
  // вставка полного номера в поле, где уже стоит «+7 »
  assert.equal(maskPhone('+7 +7 987 955-25-65'), '+7 (987) 955-25-65');
  assert.equal(maskPhone('+7 8 987 955-25-65'), '+7 (987) 955-25-65');
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

// плитки разделов и лендинг: обложка раздела — хит с фото, ширины — общие
{
  const { coverOf, photoWidths } = await import('../lib/catalog.ts');
  assert.deepEqual(photoWidths(600), [240, 360, 540, 600], 'ширины фото: без апскейла');
  assert.deepEqual(photoWidths(2400), [240, 360, 540, 720], 'ширины фото: не больше 720');
  for (const category of catalog.categories) {
    const cover = coverOf(category);
    const anyPhoto = category.products.some((product) => product.photo && !product.photo.placeholder);
    assert.equal(Boolean(cover?.photo), anyPhoto, `раздел «${category.title}»: обложка без фото при фото у блюд`);
    const hit = category.products.find(
      (product) => product.available && product.badges.includes('hit') && product.photo && !product.photo.placeholder,
    );
    if (hit) assert.equal(cover?.id, hit.id, `раздел «${category.title}»: обложка — не хит`);
  }
}

console.log(
  `каталог фикстуры: разделов ${catalog.categories.length}, блюд ${catalog.count} — проверки каталога, корзины и заказа прошли`,
);

// ── кейтеринг и банкеты ──────────────────────────────────────────────────────
// Раздел /catering/ собирается из пяти коллекций; любой из них может не быть
// (схема ещё не применена) — тогда раздел пустой, а сборка не падает.
{
  const { guestsText, priceLine } = await import('../lib/catering.ts');
  const { catering: c } = content;
  const rawFaq = raw.catering_faq ?? [];

  // фикстура: страница, пять форматов, четыре шага, все вопросы, кроме вопроса про приложение
  assert.ok(c.ready, 'кейтеринг: в фикстуре раздел не готов (нет страницы или форматов)');
  assert.ok(c.page?.heroImage, 'кейтеринг: нет фото первого экрана');
  assert.equal(c.formats.length, 5, 'кейтеринг: со старого сайта перенесены пять форматов');
  assert.equal(c.steps.length, 4, 'кейтеринг: четыре шага');
  assert.deepEqual(c.steps.map((step) => step.n), ['01', '02', '03', '04']);
  assert.equal(c.questions.length, rawFaq.filter((row) => row.status === 'published').length, 'кейтеринг: вопрос потерялся по дороге');
  assert.ok(c.questions.length >= 39, `кейтеринг: вопросов ${c.questions.length}, со старого сайта перенесено 39`);
  assert.ok(c.topics.length > 1, 'кейтеринг: вопросы не разложены по темам');
  assert.equal(
    c.topics.reduce((sum, topic) => sum + topic.questions.length, 0),
    c.questions.length,
    'кейтеринг: вопрос не попал ни в одну тему или попал в две',
  );
  assert.ok(c.featured.length > 0 && c.featured.length <= 8, `кейтеринг: на обзорной ${c.featured.length} вопросов`);
  assert.ok(c.gallery.length > 0, 'кейтеринг: пустая лента фото');

  // якоря: форматы, вопросы и темы — без повторов и без имён секций страницы
  for (const list of [c.formats.map((f) => f.slug), c.questions.map((q) => q.slug), c.topics.map((t) => t.slug)])
    assert.equal(new Set(list).size, list.length, `кейтеринг: повтор якоря среди ${list.join(', ')}`);
  for (const slug of c.formats.map((f) => f.slug))
    assert.ok(!['request', 'formats', 'faq', 'top', 'contacts'].includes(slug), `кейтеринг: якорь формата «${slug}» занят секцией`);

  // цены и гости: «от 3 500 ₽» и «за гостя», «до 140 гостей»; без цены — «по смете»
  for (const format of c.formats) {
    if (format.price) assert.match(format.price.text, /^от \d[\d   ]* ₽$/, `формат «${format.title}»: цена ${format.price.text}`);
    assert.ok(format.includes.length > 0, `формат «${format.title}»: пустое «что входит»`);
    assert.ok(format.description.length > 0, `формат «${format.title}»: нет описания`);
  }
  assert.ok(c.formats.some((format) => !format.price), 'кейтеринг: кофе-брейк идёт без цены — «по смете»');
  const party = c.formats.find((format) => format.guestsTo === 140);
  assert.ok(party, 'кейтеринг: нет формата «до 140 гостей»');
  assert.equal(priceLine(party!), `${party!.price!.text} за гостя`);
  assert.equal(guestsText(undefined, 140), 'до 140 гостей');
  assert.equal(guestsText(20, 140), 'от 20 до 140 гостей');
  assert.equal(guestsText(1), 'от 1 гостя');
  assert.equal(guestsText(undefined, 21), 'до 21 гостя');
  assert.equal(guestsText(), undefined);

  // SEO трёх страниц — в пределах выдачи
  for (const [name, text, max] of [
    ['seo_title', c.page?.seo.title, 60],
    ['seo_description', c.page?.seo.description, 160],
    ['services_seo_title', c.page?.seo.servicesTitle, 60],
    ['services_seo_description', c.page?.seo.servicesDescription, 160],
    ['faq_seo_title', c.page?.seo.faqTitle, 60],
    ['faq_seo_description', c.page?.seo.faqDescription, 160],
  ] as const) {
    assert.ok(text, `catering_page.${name}: пусто`);
    assert.ok(text!.length <= max, `catering_page.${name}: ${text!.length} символов, максимум ${max}`);
  }

  // схема не применена: коллекций нет вовсе или Directus отдал пустые списки
  for (const missing of [
    { catering_page: undefined, catering_formats: undefined, catering_steps: undefined, catering_faq: undefined },
    { catering_page: [], catering_formats: [], catering_steps: [], catering_faq: [] },
  ]) {
    const empty = check({ ...raw, ...missing } as unknown as Raw, resolve).catering;
    assert.equal(empty.ready, false, 'кейтеринг: без коллекций раздел не готов');
    assert.equal(empty.page, null);
    assert.deepEqual([empty.formats, empty.questions, empty.steps], [[], [], []]);
  }
  // страница без заголовка — пустой раздел и заметка в журнале сборки
  const untitled = check({ ...raw, catering_page: { ...raw.catering_page!, hero_title: ' ' } } as unknown as Raw, resolve);
  assert.equal(untitled.catering.page, null);
  assert.ok(notes.some((note) => note.includes('нет заголовка первого экрана')), 'кейтеринг: пустая страница не записана в журнал');

  // вопрос про приложение (был на старом сайте) на сайт не попадает и пишется в журнал
  const appQuestion = {
    ...rawFaq[0],
    id: 9101,
    question: 'Можно ли заказать через приложение?',
    answer: 'Да, скачайте наше приложение.',
    featured: true,
  };
  const withApp = check({ ...raw, catering_faq: [...rawFaq, appQuestion] } as unknown as Raw, resolve).catering;
  assert.ok(!withApp.questions.some((q) => q.id === appQuestion.id), 'кейтеринг: вопрос про приложение попал на сайт');
  assert.ok(notes.some((note) => note.includes(appQuestion.question)), 'кейтеринг: вопрос про приложение не записан в журнал');
  // черновик не выводится; без отмеченных на обзорной — первые шесть
  const drafts = check(
    { ...raw, catering_faq: rawFaq.map((row, i) => ({ ...row, status: i === 0 ? 'draft' : row.status, featured: false })) } as unknown as Raw,
    resolve,
  ).catering;
  assert.equal(drafts.questions.length, c.questions.length - 1, 'кейтеринг: черновик вопроса на сайте');
  assert.deepEqual(drafts.featured.map((q) => q.id), drafts.questions.slice(0, 6).map((q) => q.id));
  // формат без названия пропущен, одинаковые slug разведены
  const twins = check(
    {
      ...raw,
      catering_formats: [
        ...(raw.catering_formats ?? []),
        { ...raw.catering_formats![0], id: 9201, sort: 99 },
        { ...raw.catering_formats![0], id: 9202, title: '', sort: 100 },
      ],
    } as unknown as Raw,
    resolve,
  ).catering;
  assert.equal(twins.formats.length, c.formats.length + 1, 'кейтеринг: формат без названия не пропущен');
  assert.equal(new Set(twins.formats.map((f) => f.slug)).size, twins.formats.length, 'кейтеринг: одинаковые slug не разведены');
}

// ── заявка на кейтеринг: сайт и хук `request-guard` ──────────────────────────
{
  const { validateRequest, buildRequest, REQUEST_LIMITS, samaraToday, latestDate, guestsWord, dateWords } = await import(
    '../lib/request.ts'
  );
  type RequestForm = Parameters<typeof validateRequest>[0];
  const { normalizePhone } = await import('../lib/order.ts');
  const guard = await import('../../directus/extensions/request-guard/index.js');
  const today = '2026-10-12';
  const base = {
    name: ' Анна ',
    phone: '8 (987) 955 25 65',
    date: '2026-12-20',
    guests: '40',
    format: 3,
    where: 'place:1' as const,
    address: 'не нужен',
    wishes: '  Юбилей  ',
    consent: true,
  };

  assert.deepEqual(validateRequest(base, today), {}, 'заявка: заполненная форма проходит');
  const payload = buildRequest(base, '1210-0001');
  assert.deepEqual(payload, {
    number: '1210-0001',
    name: 'Анна',
    phone: '+7 987 955-25-65',
    event_date: '2026-12-20',
    guests: 40,
    format: 3,
    venue: 'hall',
    place: 1,
    address: null,
    wishes: 'Юбилей',
    consent: true,
  });
  assert.equal(buildRequest({ ...base, where: 'offsite', address: ' Дача ' }, 'x').address, 'Дача', 'заявка: адрес выезда');
  assert.deepEqual(
    (({ venue, place, address }) => ({ venue, place, address }))(buildRequest({ ...base, where: 'unknown' }, 'x')),
    { venue: 'unknown', place: null, address: null },
  );
  // только имя, телефон и согласие — дата, гости и формат необязательны
  const bare = { name: 'Анна', phone: '9879552565', where: 'unknown' as const, consent: true };
  assert.deepEqual(validateRequest(bare, today), {});
  assert.deepEqual(
    (({ event_date, guests, format, wishes }) => ({ event_date, guests, format, wishes }))(buildRequest(bare, 'x')),
    { event_date: null, guests: null, format: null, wishes: null },
  );

  // ошибки по полям
  assert.deepEqual(
    Object.keys(validateRequest({ name: ' ', phone: '123', where: 'unknown', consent: false }, today)).sort(),
    ['consent', 'name', 'phone'],
  );
  assert.ok(validateRequest({ ...base, date: '2026-10-11' }, today).date, 'заявка: прошедшая дата прошла');
  assert.ok(!validateRequest({ ...base, date: today }, today).date, 'заявка: сегодняшняя дата не прошла');
  assert.ok(validateRequest({ ...base, date: '2026-02-30' }, today).date, 'заявка: 30 февраля прошло');
  assert.ok(validateRequest({ ...base, date: '2029-01-01' }, today).date, 'заявка: дата через три года прошла');
  assert.equal(latestDate(today), '2028-10-11');
  for (const guests of ['0', '2001', '4,5'])
    assert.ok(validateRequest({ ...base, guests }, today).guests, `заявка: гостей «${guests}» прошло`);
  assert.ok(!validateRequest({ ...base, guests: '' }, today).guests, 'заявка: пустое число гостей не прошло');
  assert.equal(guestsWord(1), '1\u00a0гость');
  assert.equal(guestsWord(40), '40\u00a0гостей');
  assert.equal(dateWords('2026-12-20'), 'вс, 20 декабря');
  assert.match(samaraToday(new Date('2026-10-12T21:30:00Z')), /^2026-10-13$/, 'заявка: «сегодня» считается по Самаре');

  // хук повторяет правила сайта: то, что сайт пропустил, сервер принимает,
  // и наоборот; пределы и «сегодня» одни и те же
  assert.deepEqual(guard.LIMITS, REQUEST_LIMITS, 'заявка: пределы сайта и хука расходятся');
  assert.equal(guard.samaraToday(new Date('2026-10-12T21:30:00Z')), samaraToday(new Date('2026-10-12T21:30:00Z')));
  for (const sample of ['8 (987) 955 25 65', '+7 987 955-25-65', '9879552565', '+7 (123) 955-25-65', '12345', ''])
    assert.equal(guard.normalizePhone(sample), normalizePhone(sample), `телефон «${sample}»: сайт и хук заявок расходятся`);
  const samples: RequestForm[] = [
    base,
    bare,
    { ...base, where: 'offsite' as const, address: 'Дача в Царевщине' },
    { ...base, date: '2026-10-11' },
    { ...base, date: '2029-01-01' },
    { ...base, guests: '0' },
    { ...base, guests: '2001' },
    { ...base, phone: '+7 (123) 955-25-65' },
    { ...base, name: '   ' },
    { ...base, consent: false },
  ];
  // what a script would send bypassing the form: the fields as typed
  // то, что пришлёт скрипт в обход формы: поля как набраны
  const asTyped = (form: RequestForm) => ({
    ...buildRequest(form, 'x'),
    name: form.name,
    phone: form.phone,
    event_date: form.date ?? null,
    guests: form.guests ?? null,
    consent: form.consent,
  });
  for (const form of samples) {
    const siteOk = Object.keys(validateRequest(form, today)).length === 0;
    let serverOk = true;
    let reason = '';
    try {
      const clean = guard.checkRequest(siteOk ? buildRequest(form, 'x') : asTyped(form), today);
      if (siteOk) assert.equal(clean.phone, buildRequest(form, 'x').phone, 'заявка: хук переписал телефон');
    } catch (error) {
      serverOk = false;
      reason = (error as Error).message;
      assert.equal((error as { status?: number }).status, 400, 'заявка: отказ хука — не 400');
    }
    assert.equal(serverOk, siteOk, `заявка ${JSON.stringify(form)}: сайт ${siteOk ? 'пропускает' : 'не пускает'}, хук — ${reason || 'принимает'}`);
  }
  // зал без номера и формат строкой — только от скрипта в обход формы
  assert.throws(() => guard.checkRequest({ ...buildRequest(base, 'x'), place: null }, today), /зал/);
  assert.throws(() => guard.checkRequest({ ...buildRequest(base, 'x'), format: 'фуршет' }, today), /формат/i);
  // лишние поля и чужой статус хук не пропускает
  const forged = guard.checkRequest({ ...buildRequest(base, 'x'), status: 'done', manager_note: 'x' }, today);
  assert.ok(!('status' in forged) && !('manager_note' in forged), 'заявка: хук пропустил статус от гостя');
}

console.log('кейтеринг фикстуры и заявка: проверки прошли');
