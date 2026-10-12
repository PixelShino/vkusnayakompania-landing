// The delivery catalog from the owner's shop (vkusdostavka.shop, FoodPicasso)
// into Directus: sections, dishes, sizes, fillings, the stop-list and photos.
// FoodPicasso has no public JSON API for the menu: the shop renders every
// section as HTML with the dish data in `data-*` attributes (`data-prices`,
// `data-modifiers`, `data-media`), the same data its Vue front reads; prices
// there are rubles × 10 000. Details: docs/DIRECTUS.md → «Каталог доставки».
// Idempotent: sections are matched by the shop's number, then by address;
// dishes by the shop's number; photos by a mark in the file's description —
// a second run creates nothing twice.
//
// Каталог доставки из магазина владельца (vkusdostavka.shop, FoodPicasso) в
// Directus: разделы, блюда, размеры, начинки, стоп-лист и фото. Публичного
// JSON API для меню у FoodPicasso нет: магазин отдаёт каждый раздел HTML-ом,
// а данные блюда лежат в атрибутах `data-*` (`data-prices`, `data-modifiers`,
// `data-media`) — те же, что читает его фронт на Vue; цены там — рубли × 10 000.
// Подробно: docs/DIRECTUS.md → «Каталог доставки». Идемпотентен: разделы
// узнаются по номеру в магазине, затем по адресу; блюда — по номеру в
// магазине; фото — по пометке в описании файла. Повторный запуск ничего не
// дублирует.
//
// Run / Запуск:
//   DIRECTUS_URL=http://127.0.0.1:8055 DIRECTUS_ADMIN_TOKEN=… node scripts/import-catalog.mjs
// Flags / Флаги:
//   --dry-run         показать, что изменится, ничего не записывая
//   --sync            у уже заведённых блюд обновить из магазина цены, размеры,
//                     начинки, наличие, тексты и раздел; блюда, которых в магазине
//                     больше нет, — в архив. Без флага существующее не трогается:
//                     правки редакторов важнее магазина
//   --save file.json  сохранить разобранный магазин в файл (для проверки или переноса)
//   --from file.json  взять каталог из такого файла вместо магазина
//   --no-photos       без фото (быстрая проверка)
// SHOP_URL — адрес магазина, по умолчанию https://vkusdostavka.shop
import fs from 'node:fs';
import { loadEnv } from './env.mjs';

loadEnv();
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const DRY = flag('--dry-run');
const SYNC = flag('--sync');
const PHOTOS = !flag('--no-photos');
const FROM = option('--from');
const SAVE = option('--save');

const SHOP = (process.env.SHOP_URL ?? 'https://vkusdostavka.shop').replace(/\/+$/, '');
const BASE = process.env.DIRECTUS_URL ?? 'http://127.0.0.1:8055';
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
if (!TOKEN && !(DRY && FROM)) throw new Error('DIRECTUS_ADMIN_TOKEN обязателен');

// the shop's sections in its own order; the live navigation wins when it parses
// разделы магазина в его порядке; живая навигация главнее, если разобралась
const DEFAULT_SECTIONS = [
  '/s/zavtraki_1', '/s/salaty_11', '/s/supy_12', '/s/goryachee_14', '/s/pasta_13', '/s/vypechka_18',
  '/s/pirojnye_30', '/s/torty-v-nalichii_31', '/s/prazdnichnye-torty_26', '/s/perekus_20',
  '/s/konfety_29', '/s/hleb_15', '/s/nabory-pirojnyh-i-konfet_33',
];
const PRICE_DIV = 10_000;
// the CDN transformation «as uploaded»: the original photo instead of the 1100 px copy
// трансформация CDN «как загружено»: оригинал фото вместо копии 1100 px
const ORIGINAL = '_original_919c8_convert';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line) => console.log(line);

// ── разбор магазина ─────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' };
const decode = (text) =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
/** HTML-фрагмент → текст: `<br>` — перенос, теги прочь, пробелы схлопнуты. */
const clean = (html) => {
  if (!html) return null;
  const text = decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p\s*>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/ |​/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .filter((line, i, all) => line || (i > 0 && all[i - 1]))
    .join('\n')
    .trim();
  return text || null;
};
const ws = (text) => (text ? decode(String(text)).replace(/\s+/g, ' ').trim() || null : null);
const json = (text, fallback) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
};
const rubles = (value) => {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const n = Number(value) / PRICE_DIV;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
/**
 * «30гр», «1,5кг» → «30 г», «1,5 кг» with a non-breaking space — the same rule
 * as the site's `weightText` (`src/lib/catalog.ts`): the admin gets the units
 * the page prints.
 * «30гр», «1,5кг» → «30 г», «1,5 кг» с неразрывным пробелом — то же правило,
 * что `weightText` сайта (`src/lib/catalog.ts`): в админку попадают те же
 * единицы, что печатает страница.
 */
const weightText = (value) =>
  String(value)
    .replace(/(\d)\s*(?:гр|г)\.?(?=$|[\s,;/)])/giu, '$1 г')
    .replace(/(\d)\s*кг\.?(?=$|[\s,;/)])/giu, '$1 кг')
    .replace(/(\d)\s*мл\.?(?=$|[\s,;/)])/giu, '$1 мл')
    .replace(/(\d)\s*л\.?(?=$|[\s,;/)])/giu, '$1 л')
    .replace(/(\d)\s*шт\.?(?=$|[\s,;/)])/giu, '$1 шт.')
    .replace(/(\d),\s+(\d)/g, '$1,$2')
    .trim();

const ATTR = /([\w:-]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
const attrs = (tag) => Object.fromEntries([...tag.matchAll(ATTR)].map((m) => [m[1], decode(m[2] ?? m[3])]));
const inner = (chunk, cls, tag = 'div') =>
  chunk.match(new RegExp(`<${tag}\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? null;

const RU = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
/** То же правило, что у сайта (`src/lib/catalog.ts`): адрес из названия. */
const slugify = (text) =>
  text
    .toLowerCase()
    .split('')
    .map((char) => RU[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');

const get = async (path) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(SHOP + path, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' },
        signal: AbortSignal.timeout(40_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await sleep(400);
      return await response.text();
    } catch (error) {
      if (attempt >= 3) throw new Error(`магазин ${path}: ${error.message}`);
      await sleep(1500 * attempt);
    }
  }
};

const NAV = /<a\s+data-index="(\d+)"\s+id="sect(\d+)"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const SECT = /<div class="sect nav__anchor"([^>]*)>/g;
const CARD = /<div class="(ddish(?:\s[^"]*)?)"((?:\s+[\w-]+=(?:'[^']*'|"[^"]*"))*)\s*>/g;
const BADGE = /<i class="ddish__badge ddish__badge--([\w-]+)"[^>]*>/g;

/** Фото: оригинал загрузки на CDN, а запасным — копия 1100 px. */
const photoOf = (media) => {
  const item = (media ?? []).find((m) => m?.type === 'photo' && (m.high || m.src));
  if (!item) return null;
  const high = item.high || item.src;
  const match = high.match(/^(.*---([a-z0-9]+))_[^/]+$/i);
  return { best: match ? `${match[1]}${ORIGINAL}.${match[2]}` : high, fallback: high, hash: high.split('/').pop().split('---')[0] };
};

const cardsOf = (chunk) => {
  const heads = [...chunk.matchAll(CARD)].filter((m) => m[2].includes('data-id='));
  return heads.map((head, i) => {
    const body = chunk.slice(head.index + head[0].length, heads[i + 1]?.index ?? chunk.length);
    const classes = head[1].split(/\s+/);
    const a = attrs(head[2]);
    const modifiers = json(a['data-modifiers'], []);
    const prices = json(a['data-prices'], []);
    const sizes = modifiers.find((m) => m?.type === 'sizes');
    const unit = (value) => (ws(value) ? weightText(ws(value)) : null);
    let variants = (sizes?.options ?? []).map((o) => ({ name: unit(o.name), weight: unit(o.size) || unit(o.name), price: rubles(o.price) }));
    if (!variants.length) variants = prices.map((p) => ({ name: unit(p.sizeFormatted), weight: unit(p.sizeFormatted), price: rubles(p.price) }));
    // the shop shows sizes with a price; a size without one is a hole in its data
    // магазин показывает размеры с ценой; размер без цены — дыра в его данных
    variants = variants.filter((v) => v.name && v.price);
    // free single-choice add-ons are fillings («Наполнение»); paid add-ons are not used by the shop
    // бесплатный выбор одного — это начинки («Наполнение»); платных добавок магазин не использует
    const fillings = modifiers
      .filter((m) => m?.type !== 'sizes')
      .flatMap((m) => (m.options ?? []).filter((o) => !rubles(o.price)).map((o) => ws(o.name)))
      .filter(Boolean);
    const paid = modifiers.filter((m) => m?.type !== 'sizes').flatMap((m) => m.options ?? []).filter((o) => rubles(o.price));
    const link = body.match(/<a href="([^"]+)" class="ddish__link">([\s\S]*?)<\/a>/);
    const before = inner(body, 'ddish__before-price', 'span') ?? inner(body, 'ddish__before-price');
    const size = body.match(/<span class="ddish__size"[^>]*>([\s\S]*?)<\/span>/);
    return {
      source_id: Number(a['data-id']),
      title: clean(link?.[2]) ?? ws(attrs(body.match(/<img\b[^>]*class="ddish__photo[^"]*"[^>]*>/)?.[0] ?? '').alt),
      description: clean(inner(body, 'ddish__ingredients')),
      weight: variants[0]?.weight ?? (ws(size?.[1]) ? weightText(ws(size[1])) : null),
      price: variants.length > 1 ? Math.min(...variants.map((v) => v.price)) : (variants[0]?.price ?? rubles(prices[0]?.price)),
      old_price: before ? Number(clean(before).replace(/[^\d]/g, '')) || null : null,
      variants: variants.length > 1 ? variants : [],
      fillings: [...new Set(fillings)],
      available: !classes.includes('ddish--stop') && !classes.includes('ddish--orderScheduleStop') && !a['data-order-schedule-stop'],
      badges: [...body.matchAll(BADGE)].map((m) => m[1]).filter((b) => b === 'hit' || b === 'new'),
      photo: photoOf(json(a['data-media'], [])),
      source_url: link ? new URL(link[1], SHOP).href : null,
      paid: paid.length,
    };
  });
};

const scrape = async () => {
  const home = await get('/');
  const navAt = home.indexOf('<div class="cnav__sections">');
  const nav = navAt >= 0 ? [...home.slice(navAt, home.indexOf('</div>', navAt)).matchAll(NAV)] : [];
  const sections = (nav.length ? nav.map((m) => m[3]) : DEFAULT_SECTIONS).map((path, i) => {
    const [, slug, id] = path.match(/\/s\/(.+)_(\d+)$/) ?? [];
    return { path, slug, source_id: Number(id), sort: i + 1, title: nav[i] ? clean(nav[i][4]) : null };
  });
  if (!nav.length) log('магазин: навигация не разобралась, беру список разделов по умолчанию');

  const categories = [];
  const products = [];
  for (const section of sections) {
    const page = await get(section.path);
    // the section's own block on its page; the whole page if the markup changed
    // собственный блок раздела на его странице; вся страница, если разметка поменялась
    const heads = [...page.matchAll(SECT)];
    const own = heads.findIndex((m) => attrs(m[1])['data-id'] === String(section.source_id));
    const chunk = own >= 0 ? page.slice(heads[own].index, heads[own + 1]?.index ?? page.length) : page;
    const title = section.title ?? clean(chunk.match(/<h1 class="sect__title">([\s\S]*?)<\/h1>/)?.[1]) ?? section.slug;
    const cards = cardsOf(chunk);
    categories.push({ source_id: section.source_id, slug: section.slug, title, sort: section.sort, path: section.path });
    cards.forEach((card, i) => products.push({ ...card, category: section.source_id, sort: section.sort * 1000 + i + 1 }));
    log(`магазин: ${title} — ${cards.length}`);
  }
  // a dish shown in two sections is imported once, into the first
  // блюдо из двух разделов импортируется один раз — в первый
  const seen = new Set();
  return {
    source: { site: SHOP, fetched_at: new Date().toISOString(), method: 'html', price_unit: 'рубли (в магазине × 10 000)' },
    categories,
    products: products.filter((p) => !seen.has(p.source_id) && seen.add(p.source_id)),
  };
};

/** Файл выгрузки (`--from`): свой формат или `catalog.json` скрипта разбора. */
const fromFile = (file) => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    ...data,
    products: data.products.map((p) => ({
      ...p,
      weight: p.weight ? weightText(p.weight) : null,
      variants: (p.variants ?? [])
        .filter((v) => v?.name && v?.price > 0)
        .map(({ name, weight, price }) => ({ name: weightText(name), weight: weightText(weight ?? name), price })),
      fillings: p.fillings ?? [...new Set((p.modifiers ?? []).filter((m) => m.type !== 'sizes').flatMap((m) => m.options ?? []).filter((o) => !o.price).map((o) => o.name))],
      photo: p.photo && { best: p.photo.best, fallback: p.photo.fallback, hash: (p.photo.fallback ?? p.photo.best).split('/').pop().split('---')[0] },
    })),
  };
};

// ── Directus ────────────────────────────────────────────────────────────────

const api = async (method, path, body) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : (await response.json()).data;
};
const write = async (method, path, body) => (DRY ? { id: `dry-${Math.random()}` } : api(method, path, body));

const catalog = FROM ? fromFile(FROM) : await scrape();
// a size with a single option is the dish's own price and weight
// размер из одного варианта — это цена и вес самого блюда
for (const p of catalog.products) if (p.variants.length < 2) p.variants = [];
if (SAVE) {
  fs.writeFileSync(SAVE, JSON.stringify(catalog, null, 2) + '\n');
  log(`выгрузка сохранена: ${SAVE}`);
}
const paid = catalog.products.filter((p) => p.paid);
if (paid.length) log(`внимание: платные добавки у ${paid.map((p) => `«${p.title}»`).join(', ')} — сайт их не продаёт, пропущены`);
// «1 раздел, 13 разделов», «121 блюдо, 5 блюд» / Russian plural for the summary line
const plural = (n, one, few, many) => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return many;
  return [many, one, few, few, few, many, many, many, many, many][n % 10];
};
log(
  `магазин: ${catalog.categories.length} ${plural(catalog.categories.length, 'раздел', 'раздела', 'разделов')}, ` +
    `${catalog.products.length} ${plural(catalog.products.length, 'блюдо', 'блюда', 'блюд')}`,
);

const stats = { catNew: 0, catSync: 0, new: 0, synced: 0, archived: 0, photos: 0, reused: 0, photoFail: 0 };

// folder for the photos, so the file library stays tidy
// папка для фото, чтобы библиотека файлов не превращалась в свалку
let folder = DRY ? null : (await api('GET', `/folders?filter[name][_eq]=${encodeURIComponent('Каталог')}&filter[parent][_null]=true&limit=1`))[0];
if (!folder && !DRY) folder = await api('POST', '/folders', { name: 'Каталог' });

const existingCats = DRY && !TOKEN ? [] : await api('GET', '/items/product_categories?fields=id,source_id,slug,title,sort&limit=-1');
const catBySource = new Map();
for (const category of catalog.categories) {
  let found = existingCats.find((c) => c.source_id === category.source_id) ?? existingCats.find((c) => c.slug === category.slug);
  if (!found) {
    found = await write('POST', '/items/product_categories', {
      status: 'published', title: category.title, slug: category.slug, sort: category.sort, source_id: category.source_id,
    });
    stats.catNew += 1;
    log(`+ раздел ${category.title}`);
  } else if (SYNC && (found.title !== category.title || found.sort !== category.sort || found.source_id !== category.source_id)) {
    await write('PATCH', `/items/product_categories/${found.id}`, { title: category.title, sort: category.sort, source_id: category.source_id });
    stats.catSync += 1;
    log(`= раздел ${category.title}`);
  }
  catBySource.set(category.source_id, found.id);
}

const SHOP_FIELDS = ['title', 'description', 'weight', 'price', 'old_price', 'variants', 'fillings', 'available', 'badges', 'category', 'sort'];
const existing =
  DRY && !TOKEN
    ? []
    : await api('GET', `/items/products?fields=id,source_id,slug,photo,status,${SHOP_FIELDS.join(',')}&limit=-1`);
const bySource = new Map(existing.filter((p) => p.source_id).map((p) => [p.source_id, p]));
const slugs = new Set(existing.map((p) => p.slug).filter(Boolean));

const photoFor = async (product) => {
  if (!PHOTOS || !product.photo || DRY) return null;
  const mark = `Импорт из магазина: ${product.photo.hash}`;
  const [file] = await api('GET', `/files?filter[description][_eq]=${encodeURIComponent(mark)}&fields=id&limit=1`);
  if (file) {
    stats.reused += 1;
    return file.id;
  }
  for (const url of [product.photo.best, product.photo.fallback].filter(Boolean)) {
    try {
      const imported = await api('POST', '/files/import', {
        url,
        data: { title: product.title, alt: product.title, description: mark, folder: folder?.id ?? null },
      });
      stats.photos += 1;
      return imported.id;
    } catch (error) {
      log(`  фото «${product.title}» (${url.split('/').pop()}): ${error.message.slice(0, 160)}`);
    }
  }
  stats.photoFail += 1;
  return null;
};

const shopFields = (product) => ({
  title: product.title,
  description: product.description,
  weight: product.weight,
  price: product.price,
  old_price: product.old_price && product.old_price > product.price ? product.old_price : null,
  variants: product.variants.map(({ name, weight, price }) => ({ name, weight, price })),
  fillings: product.fillings,
  available: product.available,
  badges: product.badges,
  category: catBySource.get(product.category),
  sort: product.sort,
});

for (const product of catalog.products) {
  if (!product.title || !product.price) {
    log(`пропуск: ${product.source_id} без названия или цены`);
    continue;
  }
  const found = bySource.get(product.source_id);
  if (!found) {
    let slug = slugify(product.title) || `p-${product.source_id}`;
    if (slugs.has(slug)) slug = `${slug}-${product.source_id}`;
    slugs.add(slug);
    const photo = await photoFor(product);
    await write('POST', '/items/products', {
      status: 'published', slug, source_id: product.source_id, photo, ...shopFields(product),
    });
    stats.new += 1;
    log(`+ ${product.title}${photo ? '' : PHOTOS && product.photo ? ' (без фото)' : ''}`);
    continue;
  }
  // only what really changed: every saved dish is a rebuild event for the Flow
  // только то, что правда поменялось: каждое сохранение — событие пересборки во Flow
  const same = (key, value) => JSON.stringify(found[key] ?? null) === JSON.stringify(value ?? null);
  const patch = SYNC ? Object.fromEntries(Object.entries(shopFields(product)).filter(([key, value]) => !same(key, value))) : {};
  if (SYNC && found.status === 'archived') patch.status = 'published';
  if (!found.photo) {
    const photo = await photoFor(product);
    if (photo) patch.photo = photo;
  }
  if (Object.keys(patch).length) {
    await write('PATCH', `/items/products/${found.id}`, patch);
    stats.synced += 1;
    log(`= ${product.title}`);
  }
}

// a dish the shop dropped goes to the archive, not to the bin: the editor can bring it back
// блюдо, которое магазин убрал, уходит в архив, а не в корзину: редактор может вернуть
if (SYNC) {
  const live = new Set(catalog.products.map((p) => p.source_id));
  for (const gone of existing.filter((p) => p.source_id && !live.has(p.source_id) && p.status !== 'archived')) {
    await write('PATCH', `/items/products/${gone.id}`, { status: 'archived' });
    stats.archived += 1;
    log(`− в архив: блюдо ${gone.source_id} (${gone.slug})`);
  }
}

log(
  `${DRY ? 'проверка без записи' : 'импорт'}: разделы +${stats.catNew}${SYNC ? ` =${stats.catSync}` : ''}, ` +
    `блюда +${stats.new} =${stats.synced}${SYNC ? ` в архив ${stats.archived}` : ''}, ` +
    `фото загружено ${stats.photos}, уже были ${stats.reused}${stats.photoFail ? `, не загрузилось ${stats.photoFail}` : ''}`,
);
