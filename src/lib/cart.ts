/**
 * The cart: what the guest picked, kept in `localStorage` between visits. Pure
 * functions over a plain object — the page script owns storage and the DOM,
 * the checks run these on the fixture. The cart stores only dish ids, variants
 * and quantities; titles and prices always come from the catalog the page was
 * built with, so a price changed in the admin never lingers in a stale cart.
 * Корзина: что выбрал гость, хранится в `localStorage` между визитами. Чистые
 * функции над простым объектом — хранилищем и DOM владеет скрипт страницы,
 * проверки гоняют эти функции на фикстуре. В корзине лежат только номера блюд,
 * варианты и количества; названия и цены всегда берутся из каталога, с которым
 * собрана страница, поэтому цена, изменённая в админке, не застревает в корзине.
 */
import type { Variant } from './catalog.ts';

export const CART_KEY = 'vk-cart-v1';
/** больше 50 одного блюда — уже кейтеринг, а не доставка; то же ограничение у сервера */
export const MAX_QTY = 50;
/** строк в одном заказе — как у сервера (`order-guard`) */
export const MAX_LINES = 40;

/**
 * `variant` — the size with its own price («2 кг»), `filling` — a free choice
 * the cake needs («Прага»). Either is `null` when the dish has none.
 * `variant` — размер со своей ценой («2 кг»), `filling` — бесплатный выбор,
 * без которого торт не собрать («Прага»). `null`, если у блюда такого нет.
 */
export type CartLine = { id: number; variant: string | null; filling: string | null; qty: number };
export type Cart = { v: 1; lines: CartLine[] };

/** Что корзине нужно знать о блюде: собирается из каталога на странице. */
export type CartProduct = {
  id: number;
  slug: string;
  title: string;
  price: number;
  weight?: string;
  variants: Variant[];
  /** начинки на выбор; пусто — выбирать нечего */
  fillings: string[];
  available: boolean;
};
export type CartIndex = Map<number, CartProduct>;

export type PricedLine = CartLine & {
  key: string;
  title: string;
  slug: string;
  weight?: string;
  price: number;
  sum: number;
  available: boolean;
};

export const empty = (): Cart => ({ v: 1, lines: [] });

/** Строка корзины — блюдо, размер и начинка: «Медовик 1 кг» и «Медовик 2 кг» — разные строки. */
export const lineKey = (id: number, variant: string | null, filling: string | null = null) =>
  JSON.stringify([id, variant ?? '', filling ?? '']);

/** Обратно из ключа строки: `[id, variant, filling]`. */
export const keyParts = (key: string) => {
  const [id, variant, filling] = JSON.parse(key) as [number, string, string];
  return { id, variant: variant || null, filling: filling || null };
};

const clamp = (qty: number) => Math.max(0, Math.min(MAX_QTY, Math.floor(qty)));

const same = (line: CartLine, id: number, variant: string | null, filling: string | null) =>
  line.id === id && line.variant === variant && line.filling === filling;

export const qtyOf = (cart: Cart, id: number, variant: string | null = null, filling: string | null = null) =>
  cart.lines.find((line) => same(line, id, variant, filling))?.qty ?? 0;

/** Сколько всего штук блюда в корзине, по всем его вариантам. */
export const qtyOfProduct = (cart: Cart, id: number) =>
  cart.lines.filter((line) => line.id === id).reduce((sum, line) => sum + line.qty, 0);

export const setQty = (
  cart: Cart,
  id: number,
  variant: string | null,
  qty: number,
  filling: string | null = null,
): Cart => {
  const next = clamp(qty);
  const exists = cart.lines.some((line) => same(line, id, variant, filling));
  if (!exists) {
    if (next === 0 || cart.lines.length >= MAX_LINES) return cart;
    return { v: 1, lines: [...cart.lines, { id, variant, filling, qty: next }] };
  }
  return {
    v: 1,
    lines: cart.lines
      .map((line) => (same(line, id, variant, filling) ? { ...line, qty: next } : line))
      .filter((line) => line.qty > 0),
  };
};

export const add = (cart: Cart, id: number, variant: string | null = null, qty = 1, filling: string | null = null) =>
  setQty(cart, id, variant, qtyOf(cart, id, variant, filling) + qty, filling);

export const remove = (cart: Cart, id: number, variant: string | null, filling: string | null = null) =>
  setQty(cart, id, variant, 0, filling);

/** Цена строки: у варианта своя, без варианта — цена блюда; неизвестный вариант — `null`. */
export const linePrice = (product: CartProduct, variant: string | null) => {
  if (!variant) return product.variants.length ? null : product.price;
  return product.variants.find((item) => item.name === variant)?.price ?? null;
};

/** Строка собрана: размер и начинка — из тех, что у блюда есть сейчас. */
const valid = (product: CartProduct, line: Pick<CartLine, 'variant' | 'filling'>) =>
  linePrice(product, line.variant) !== null &&
  (product.fillings.length ? Boolean(line.filling && product.fillings.includes(line.filling)) : !line.filling);

/**
 * Lines against today's catalog. A dish that left the catalog or a variant that
 * no longer exists is dropped and named, so the guest is told what vanished
 * instead of finding a shorter cart.
 * Строки по сегодняшнему каталогу. Блюдо, ушедшее из каталога, и вариант,
 * которого больше нет, выпадают и называются: гостю говорят, что пропало, а
 * не показывают молча укороченную корзину.
 */
export const reconcile = (cart: Cart, index: CartIndex) => {
  const dropped: string[] = [];
  const lines = cart.lines.filter((line) => {
    const product = index.get(line.id);
    if (product && valid(product, line)) return true;
    dropped.push(product?.title ?? 'позиция, которой больше нет в каталоге');
    return false;
  });
  return { cart: { v: 1 as const, lines }, dropped };
};

/** Корзина с названиями, ценами и суммами; в сумму идёт только то, что есть в наличии. */
export const priced = (cart: Cart, index: CartIndex) => {
  const lines: PricedLine[] = cart.lines.flatMap((line) => {
    const product = index.get(line.id);
    const price = product && valid(product, line) ? linePrice(product, line.variant) : null;
    if (!product || price === null) return [];
    const variant = line.variant ? product.variants.find((item) => item.name === line.variant) : undefined;
    return [
      {
        ...line,
        key: lineKey(line.id, line.variant, line.filling),
        title: product.title,
        slug: product.slug,
        weight: variant?.weight ?? product.weight,
        price,
        sum: price * line.qty,
        available: product.available,
      },
    ];
  });
  const ready = lines.filter((line) => line.available);
  return {
    lines,
    total: ready.reduce((sum, line) => sum + line.sum, 0),
    count: ready.reduce((sum, line) => sum + line.qty, 0),
    /** есть строки из стоп-листа: оформить нельзя, пока их не убрали */
    blocked: lines.some((line) => !line.available),
  };
};

/** Чтение из хранилища: битая или чужая запись — пустая корзина, а не ошибка на странице. */
export const parseCart = (json: string | null | undefined): Cart => {
  if (!json) return empty();
  try {
    const data = JSON.parse(json);
    if (data?.v !== 1 || !Array.isArray(data.lines)) return empty();
    let cart = empty();
    const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
    for (const line of data.lines) {
      const id = Number(line?.id);
      const variant = text(line?.variant);
      const filling = text(line?.filling);
      if (Number.isInteger(id) && id > 0)
        cart = setQty(cart, id, variant, qtyOf(cart, id, variant, filling) + Number(line?.qty || 0), filling);
    }
    return cart;
  } catch {
    return empty();
  }
};
