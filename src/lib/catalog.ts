/**
 * Delivery catalog: sections and dishes from Directus (`product_categories`,
 * `products`) turned into what the catalog page and the cart read. Pure: no
 * I/O, so the content check runs it on the fixture. The catalog is lenient on
 * purpose: a dish with no price or a section with no name is dropped with a
 * warning instead of taking the whole site down — the landing must build even
 * when the catalog is empty, half-filled or missing from the schema.
 * Каталог доставки: разделы и блюда из Directus (`product_categories`,
 * `products`) в том виде, в каком их читают страница каталога и корзина.
 * Чистый модуль: без сети и файлов, поэтому проверка контента гоняет его на
 * фикстуре. Каталог намеренно снисходителен: блюдо без цены или раздел без
 * названия выпадают с предупреждением, а не роняют весь сайт — лендинг обязан
 * собираться и с пустым, и с недозаполненным, и с отсутствующим в схеме каталогом.
 */
import type { Img } from './content.ts';
import { plural } from '../data/site.ts';

export type Badge = 'hit' | 'new';
export const BADGE_LABEL: Record<Badge, string> = { hit: 'Хит', new: 'Новинка' };

/** Размер или вариант блюда со своей ценой: «1,5 кг — 2 450 ₽». */
export type Variant = { name: string; weight?: string; price: number };

export type Product = {
  id: number;
  slug: string;
  title: string;
  description?: string;
  composition?: string;
  weight?: string;
  /** цена без выбора варианта; при вариантах — самая низкая, «от …» */
  price: number;
  oldPrice?: number;
  /** два и больше; один вариант сворачивается в цену и вес самого блюда */
  variants: Variant[];
  /** начинки на выбор (торты): гость выбирает одну, цена от неё не меняется */
  fillings: string[];
  available: boolean;
  badges: Badge[];
  photo?: Img;
  /** slug раздела — якорь на странице каталога */
  category: string;
};

export type CatalogCategory = {
  id: number;
  slug: string;
  title: string;
  description?: string;
  products: Product[];
};

export type Catalog = {
  categories: CatalogCategory[];
  /** сколько блюд на странице — для заголовка и проверки «каталог пуст» */
  count: number;
};

export type RawVariant = { name?: string | null; weight?: string | null; price?: number | string | null };

/** Файл Directus так, как его отдаёт запрос: каталогу нужен только сам объект. */
type RawPhoto = { id: string; title?: string | null; alt?: string | null } & Record<string, unknown>;

export type RawCategory = {
  id: number;
  status?: string | null;
  sort?: number | null;
  title?: string | null;
  slug?: string | null;
  description?: string | null;
};

export type RawProduct = {
  id: number;
  status?: string | null;
  sort?: number | null;
  category?: number | { id: number } | null;
  title?: string | null;
  slug?: string | null;
  description?: string | null;
  composition?: string | null;
  weight?: string | null;
  price?: number | string | null;
  old_price?: number | string | null;
  variants?: RawVariant[] | null;
  fillings?: string[] | string | null;
  available?: boolean | null;
  badges?: string[] | string | null;
  photo?: RawPhoto | null;
};

/** Файл → кадр; `alt` — запасная подпись, если у файла пусто и в alt, и в заголовке. */
export type CatalogImage = (file: RawPhoto, alt: string) => Img | undefined;

const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** «Сырники со сметаной» → «syrniki-so-smetanoy»: адрес из названия, когда редактор его не задал. */
export const slugify = (text: string) =>
  text
    .toLowerCase()
    .split('')
    .map((char) => RU[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');

const NBSP = '\u00a0';

// ids already taken on the catalog page: a section named «main» must not steal the skip link
// id, уже занятые на странице каталога: раздел «main» не должен отнять цель у ссылки «к содержимому»
const RESERVED = new Set(['main', 'top', 'cart', 'book', 'header-menu', 'catalog']);

const RUB = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
/** 1250 → «1 250 ₽» с неразрывными пробелами: сумма не рвётся на две строки. */
export const rub = (value: number) => `${RUB.format(value).replace(/\s/g, NBSP)}${NBSP}₽`;

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/** Цена, за которую можно продать: ноль в магазине значит «не заполнено», а не «бесплатно». */
const price = (value: unknown) => {
  const n = num(value);
  return n && n > 0 ? n : null;
};

const list = (value: string[] | string | null | undefined) =>
  [...new Set((Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []).map((item) => item.trim()).filter(Boolean))];

/**
 * «30гр», «1,5кг», «250 мл.» → «30 г», «1,5 кг», «250 мл»: the shop typed units
 * three ways, the page prints them one way, with a non-breaking space.
 * «30гр», «1,5кг», «250 мл.» → «30 г», «1,5 кг», «250 мл»: в магазине единицы
 * набраны тремя способами, страница печатает одним, с неразрывным пробелом.
 */
export const weightText = (value: string) =>
  value
    .replace(/(\d)\s*(?:гр|г)\.?(?=$|[\s,;/)])/giu, `$1${NBSP}г`)
    .replace(/(\d)\s*кг\.?(?=$|[\s,;/)])/giu, `$1${NBSP}кг`)
    .replace(/(\d)\s*мл\.?(?=$|[\s,;/)])/giu, `$1${NBSP}мл`)
    .replace(/(\d)\s*л\.?(?=$|[\s,;/)])/giu, `$1${NBSP}л`)
    .replace(/(\d)\s*шт\.?(?=$|[\s,;/)])/giu, `$1${NBSP}шт.`)
    .replace(/(\d),\s+(\d)/g, '$1,$2');

// the shop types names with straight quotes: «Пирожное "Мохито"» → «Пирожное «Мохито»»,
// the same quotes as the rest of the page
// магазин набирает названия прямыми кавычками: «Пирожное "Мохито"» → «Пирожное «Мохито»»,
// те же кавычки, что на всей странице
const clean = (value: string | null | undefined) => {
  const text = value
    ?.replace(/\r\n/g, '\n')
    .replace(/"([^"\n]+)"/g, '«$1»')
    .trim();
  return text ? text : undefined;
};

const BADGES = new Set<string>(['hit', 'new']);
const badgesOf = (value: RawProduct['badges']): Badge[] => {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return list.map((badge) => badge.trim()).filter((badge): badge is Badge => BADGES.has(badge));
};

const bySort = <T extends { sort?: number | null; id: number }>(a: T, b: T) =>
  (a.sort ?? Number.MAX_SAFE_INTEGER) - (b.sort ?? Number.MAX_SAFE_INTEGER) || a.id - b.id;

const published = (status?: string | null) => !status || status === 'published';

/**
 * Raw sections and dishes → the catalog page. `warn` hears about every record
 * that was dropped, so a half-filled dish shows up in the build log instead of
 * vanishing silently.
 * Сырые разделы и блюда → страница каталога. `warn` слышит о каждой выпавшей
 * записи: недозаполненное блюдо видно в логе сборки, а не пропадает молча.
 */
export const normalizeCatalog = (
  rawCategories: RawCategory[] | null | undefined,
  rawProducts: RawProduct[] | null | undefined,
  image: CatalogImage,
  warn: (message: string) => void = () => {},
): Catalog => {
  const takenCategory = new Set<string>(RESERVED);
  const categories: CatalogCategory[] = [...(rawCategories ?? [])]
    .filter((category) => published(category.status))
    .sort(bySort)
    .flatMap((category) => {
      const title = clean(category.title);
      if (!title) {
        warn(`каталог: раздел ${category.id} без названия пропущен`);
        return [];
      }
      let slug = slugify(clean(category.slug) ?? '') || slugify(title) || `c-${category.id}`;
      if (takenCategory.has(slug)) slug = `${slug}-${category.id}`;
      takenCategory.add(slug);
      return [{ id: category.id, slug, title, description: clean(category.description), products: [] }];
    });
  const byId = new Map(categories.map((category) => [category.id, category]));

  const takenProduct = new Set<string>();
  for (const raw of [...(rawProducts ?? [])].sort(bySort)) {
    if (!published(raw.status)) continue;
    const categoryId = typeof raw.category === 'object' ? raw.category?.id : raw.category;
    const category = categoryId ? byId.get(categoryId) : undefined;
    // a dish of a hidden section hides with it; that is not an error
    // блюдо скрытого раздела скрывается вместе с ним — это не ошибка
    if (!category) continue;
    const title = clean(raw.title);
    if (!title) {
      warn(`каталог: блюдо ${raw.id} без названия пропущено`);
      continue;
    }

    const variants = (raw.variants ?? []).flatMap((variant): Variant[] => {
      const name = clean(variant?.name ?? undefined);
      const cost = price(variant?.price);
      const weight = clean(variant?.weight ?? undefined);
      return name && cost !== null
        ? [{ name: weightText(name), weight: weight && weightText(weight), price: cost }]
        : [];
    });
    const own = price(raw.price);
    const base = variants.length > 1 ? Math.min(...variants.map((variant) => variant.price)) : (own ?? variants[0]?.price ?? null);
    if (base === null) {
      warn(`каталог: у блюда «${title}» нет цены — пропущено`);
      continue;
    }
    const oldPrice = price(raw.old_price);
    let slug = slugify(clean(raw.slug) ?? '') || slugify(title) || String(raw.id);
    if (takenProduct.has(slug)) slug = `${slug}-${raw.id}`;
    takenProduct.add(slug);

    category.products.push({
      id: raw.id,
      slug,
      title,
      description: clean(raw.description),
      composition: clean(raw.composition),
      weight: (() => {
        const weight = clean(raw.weight) ?? (variants.length === 1 ? variants[0].weight : undefined);
        return weight && weightText(weight);
      })(),
      price: base,
      // a «discount» not above the price is a typo, not a discount
      // «скидка» не выше цены — опечатка, а не скидка
      oldPrice: oldPrice !== null && oldPrice > base ? oldPrice : undefined,
      variants: variants.length > 1 ? variants : [],
      fillings: list(raw.fillings),
      available: raw.available !== false,
      badges: badgesOf(raw.badges),
      photo: raw.photo ? image(raw.photo, title) : undefined,
      category: category.slug,
    });
  }

  // what can be ordered comes first; the stop-list waits at the end of its section
  // то, что можно заказать, — первым; стоп-лист ждёт в конце своего раздела
  for (const category of categories)
    category.products.sort((a, b) => Number(b.available) - Number(a.available));

  const filled = categories.filter((category) => category.products.length > 0);
  return { categories: filled, count: filled.reduce((sum, category) => sum + category.products.length, 0) };
};

/** Цена на карточке: «685 ₽» или «от 1 450 ₽», если есть размеры. */
export const priceLabel = (product: Pick<Product, 'price' | 'variants'>) =>
  `${product.variants.length ? 'от ' : ''}${rub(product.price)}`;

/**
 * The weight line of a card: the dish's own weight, or its sizes when it has
 * several («1 кг · 1,5 кг · 2 кг»), so «от 3 500 ₽» is not read as «1 кг за 3 500».
 * Строка веса на карточке: вес блюда или его размеры, когда их несколько
 * («1 кг · 1,5 кг · 2 кг»), чтобы «от 3 500 ₽» не читалось как «1 кг за 3 500».
 */
export const sizeLabel = (product: Pick<Product, 'weight' | 'variants'>) => {
  if (!product.variants.length) return product.weight;
  const names = product.variants.map((variant) => variant.name).join(' · ');
  return names.length <= 26 ? names : `${product.variants.length} ${plural(product.variants.length, 'размер', 'размера', 'размеров')}`;
};

/** «1 позиция», «2 позиции», «5 позиций». */
export const positions = (n: number) => `${n}${NBSP}${plural(n, 'позиция', 'позиции', 'позиций')}`;

/**
 * The widths a dish photo is cut into. One list for the card, the section tile
 * and the landing: the same width of the same file is one encode, not three.
 * Ширины, в которые режется фото блюда. Один список для карточки, плитки
 * раздела и лендинга: одна ширина одного файла — одно кодирование, а не три.
 */
const PHOTO_WIDTHS = [240, 360, 540, 720];
export const photoWidths = (width: number) => [
  ...new Set([...PHOTO_WIDTHS.filter((w) => w < width), Math.min(width, 720)]),
];

/**
 * The dish a section is shown by on its tile: a hit with a photo, else the
 * first dish in stock with one, else any dish with a photo.
 * Блюдо, которым раздел показан на плитке: хит с фото, иначе первое блюдо в
 * наличии с фото, иначе любое блюдо с фото.
 */
export const coverOf = (category: CatalogCategory): Product | undefined => {
  const shot = (product: Product) => Boolean(product.photo && !product.photo.placeholder);
  return (
    category.products.find((p) => p.available && p.badges.includes('hit') && shot(p)) ??
    category.products.find((p) => p.available && shot(p)) ??
    category.products.find(shot)
  );
};
