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
 *
 * Every venue has a cart of its own (owner, 27.10.2026: «разные корзины сделай,
 * для разных точек»): `vkus:cart:1`, `vkus:cart:2`. The switch over the menu
 * shows the chosen venue's cart; a dish both kitchens cook lies in the cart it
 * was put into. The shared cart of before (`vk-cart-v1`) moves whole into the
 * cart of the venue chosen at the first read and its key is removed; a site
 * with one venue keeps that key as its only cart.
 * У каждой точки своя корзина (владелец, 27.10.2026: «разные корзины сделай,
 * для разных точек»): `vkus:cart:1`, `vkus:cart:2`. Переключатель над меню
 * показывает корзину выбранной точки; блюдо, которое готовят обе кухни, лежит в
 * той корзине, куда его положили. Прежняя общая корзина (`vk-cart-v1`) при
 * первом чтении целиком переезжает в корзину выбранной точки, её ключ
 * удаляется; сайт с одной точкой держит этот ключ своей единственной корзиной.
 */
import type { Variant } from './catalog.ts';
import { cookedHere } from './venue.ts';

/** Общая корзина: до 27.10.2026 — на обе точки, теперь — только у сайта с одной точкой. */
export const CART_KEY = 'vk-cart-v1';
const VENUE_CART = 'vkus:cart:';
/** Ключ корзины точки: `vkus:cart:2`; без точки (одна на сайте) — общий `vk-cart-v1`. */
export const cartKey = (place: number | null | undefined) => (place ? `${VENUE_CART}${place}` : CART_KEY);
/** Ключ хранилища — какая-то корзина (точки или общая): шапке и вкладкам есть что перерисовать. */
export const isCartKey = (key: string | null | undefined) => key === CART_KEY || Boolean(key?.startsWith(VENUE_CART));
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
  /** точки, где блюдо готовят; пусто или нет поля — на всех */
  places?: readonly number[];
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
  /** точки, где блюдо готовят; пусто — на всех */
  places: readonly number[];
  /** выбранная точка это блюдо не готовит: в сумму не идёт, оформление закрыто */
  elsewhere: boolean;
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

/**
 * The cart with titles, prices and sums for its venue (`place`). Only what can
 * be ordered counts: a dish from the stop list (`blocked`) or one the venue no
 * longer cooks (`elsewhere`: the admin took the venue's tick off after the dish
 * was put in) stays in the list, named, but out of the total until the guest
 * removes it. With a cart per venue `elsewhere` is a safety net, not a way of
 * shopping.
 * Корзина с названиями, ценами и суммами для её точки (`place`). Считается
 * только то, что можно заказать: блюдо из стоп-листа (`blocked`) или блюдо,
 * которое точка больше не готовит (`elsewhere`: в админке сняли галочку точки
 * уже после того, как блюдо положили), остаётся в списке и называется, но в
 * сумму не идёт, пока гость его не уберёт. С корзиной на точку `elsewhere` —
 * страховка, а не способ покупать.
 */
export const priced = (cart: Cart, index: CartIndex, place?: number | null) => {
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
        places: product.places ?? [],
        elsewhere: !cookedHere(product, place),
      },
    ];
  });
  const ready = lines.filter((line) => line.available && !line.elsewhere);
  return {
    lines,
    total: ready.reduce((sum, line) => sum + line.sum, 0),
    count: ready.reduce((sum, line) => sum + line.qty, 0),
    /** есть строки из стоп-листа: оформить нельзя, пока их не убрали */
    blocked: lines.some((line) => !line.available),
    /** строки, которых точка корзины больше не готовит: оформить нельзя, пока их не убрали */
    elsewhere: lines.filter((line) => line.elsewhere),
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

/**
 * Two readings of one cart, side by side: a line in both keeps the larger
 * quantity, not the sum — the old shared cart written again by a tab that was
 * opened before the move is the same cart seen twice, and adding would double it.
 * Две записи одной корзины рядом: строка, которая есть в обеих, берёт большее
 * количество, а не сумму — старую общую корзину может снова записать вкладка,
 * открытая до переезда, это та же корзина, увиденная дважды, и сложение её удвоило бы.
 */
export const merge = (cart: Cart, other: Cart): Cart =>
  other.lines.reduce(
    (next, line) => setQty(next, line.id, line.variant, Math.max(line.qty, qtyOf(next, line.id, line.variant, line.filling)), line.filling),
    cart,
  );

/** Хранилище, как его видят корзина, шапка и кабинет: закрытое хранилище — их забота. */
export type CartStore = {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
};

/**
 * The venue's cart from storage. The shared cart of before (`vk-cart-v1`)
 * moves into it whole on the first read: merged with what the venue's cart may
 * already hold, written under the venue's key, and only once that write is
 * seen in storage is the old key removed — a refused write loses nothing. A
 * site with one venue (`place` empty) reads the shared key, nothing moves.
 * Корзина точки из хранилища. Прежняя общая корзина (`vk-cart-v1`) при первом
 * чтении целиком переезжает в неё: сливается с тем, что в корзине точки уже
 * могло лежать, записывается под ключом точки, и только когда запись видна в
 * хранилище, старый ключ удаляется — отказ записи ничего не теряет. Сайт с одной
 * точкой (`place` пуст) читает общий ключ, ничего не переезжает.
 */
export const takeCart = (store: CartStore, place: number | null | undefined): Cart => {
  const key = cartKey(place);
  const own = parseCart(store.get(key));
  if (key === CART_KEY) return own;
  const shared = store.get(CART_KEY);
  if (shared === null) return own;
  const cart = merge(own, parseCart(shared));
  const json = JSON.stringify(cart);
  store.set(key, json);
  if (store.get(key) === json) store.remove(CART_KEY);
  return cart;
};
