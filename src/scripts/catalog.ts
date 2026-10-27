/**
 * The catalog page wakes up: the cart (kept in `localStorage`, shared between
 * tabs), the counters on the cards, the dish window, the cart drawer with the
 * checkout and the order sent to Directus. Everything the guest sees without
 * scripts is already in the HTML; this file only adds behaviour, so a failed
 * script leaves a readable menu with prices, not an empty page.
 * Страница каталога оживает: корзина (в `localStorage`, общая для вкладок),
 * счётчики на карточках, окно блюда, выдвижная корзина с оформлением и заказ,
 * уходящий в Directus. Всё, что гость видит без скриптов, уже есть в HTML; этот
 * файл только добавляет поведение, поэтому упавший скрипт оставляет читаемое
 * меню с ценами, а не пустую страницу.
 * The venue (whose menu the page shows) is one choice for the switches over
 * the menu, the cart's venue radios and the order: `setPlace` changes all of
 * them, `<html data-venue>` hides the other menu (`src/lib/venue.ts`). Every
 * venue has its own cart (owner, 27.10.2026): switching the venue switches
 * the cart, the other one waits in storage and is offered under the switch.
 * Точка (чьё меню показывает страница) — один выбор для переключателей над
 * меню, радио точки в корзине и заказа: `setPlace` меняет их все, а
 * `<html data-venue>` прячет чужое меню (`src/lib/venue.ts`). У каждой точки
 * своя корзина (владелец, 27.10.2026): сменили точку — сменилась корзина,
 * другая ждёт в хранилище, и о ней напоминает строка под переключателем.
 */
import {
  MAX_QTY,
  add,
  cartKey,
  empty,
  isCartKey,
  keyParts,
  parseCart,
  priced,
  qtyOf,
  qtyOfProduct,
  reconcile,
  setQty,
  takeCart,
  type Cart,
  type CartIndex,
  type CartProduct,
  type CartStore,
} from '../lib/cart';
import {
  CHECKOUT_KEY,
  addressLine,
  buildOrder,
  daysFrom,
  bindPhoneMask,
  fulfillmentOf,
  orderNumber,
  slotsFor,
  splitDetails,
  tableLine,
  tableNumber,
  validate,
  type AptKey,
  type CheckoutForm,
  type Errors,
} from '../lib/order';
import { BADGE_LABEL, positions, rub, type Badge } from '../lib/catalog';
import { PLACE_KEY, cookedHere, venueCase } from '../lib/venue';
import { plural } from '../data/site';
import {
  HOME_CITY,
  QUOTE_DEBOUNCE_MS,
  SUGGEST_DEBOUNCE_MS,
  addressOf,
  announceFor,
  billRow,
  blocksOrder,
  canQuote,
  canSuggest,
  deliveryCost,
  hasAptWords,
  hasHouse,
  minOrderText,
  normalizeAddress,
  parseQuote,
  parseSuggestions,
  payable,
  shortOfMin,
  shortText,
  stateFromQuote,
  statusFor,
  type DeliveryState,
  type Quote,
  type StatusAction,
  type Suggestion,
} from '../lib/delivery';
import { mountCartAccount } from './account-cart';
import { online as paysOnline, payAfterOrder, withPayment } from './payment';
import minusIcon from '../assets/icons/minus.svg?raw';
import plusIcon from '../assets/icons/plus.svg?raw';
import trashIcon from '../assets/icons/trash.svg?raw';
import clocheIcon from '../assets/icons/cloche.svg?raw';
import pinIcon from '../assets/icons/pin.svg?raw';

/** Поля для курьера рядом с улицей: квартира, подъезд, этаж, домофон. */
const APT_KEYS = ['flat', 'entrance', 'floor', 'intercom'] as const satisfies readonly AptKey[];
type AptParts = Partial<Record<AptKey, string>>;

type Dish = CartProduct & {
  category: string;
  description: string | null;
  composition: string | null;
  oldPrice: number | null;
  badges: Badge[];
};

const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T & Element>(selector) as T | null;
const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T & Element>(selector)) as T[];

const esc = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const icon = (svg: string) => `<span class="ico" aria-hidden="true">${svg}</span>`;

// Storage can be closed (private mode, blocked site data): the page then works
// with carts that live until the tab is closed, and says nothing scary. What
// storage refused is kept in memory, so switching venues there and back does
// not lose the cart left behind.
// Хранилище может быть закрыто (приватный режим, запрет данных сайта): тогда
// страница работает с корзинами до закрытия вкладки и ничем не пугает. То, что
// хранилище не приняло, держится в памяти: переход на другую точку и обратно не
// теряет оставленную корзину.
const memory = new Map<string, string>();
const store: CartStore = {
  get: (key) => {
    try {
      return localStorage.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
      memory.delete(key);
    } catch {
      memory.set(key, value);
    }
  },
  remove: (key) => {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to remove there / там нечего удалять */
    }
  },
};

const dataNode = document.getElementById('catalog-data');
const drawer = document.getElementById('cart') as HTMLDialogElement | null;
const dishDialog = document.getElementById('dish') as HTMLDialogElement | null;

if (dataNode && drawer && dishDialog) {
  const { products, places: venues = [] } = JSON.parse(dataNode.textContent || '{}') as {
    products: Dish[];
    places?: { id: number; name: string; dishes: number }[];
  };
  const dishes = new Map(products.map((dish) => [dish.id, dish]));
  const index: CartIndex = dishes;
  const bySlug = new Map(products.map((dish) => [dish.slug, dish]));

  // ── venue: whose menu / точка: чьё меню ──────────────────────────────────
  // The head script has already chosen it (`?place=`, the remembered one, the
  // first venue) and hidden the other menu; here it becomes the cart's too.
  // `null` — a site with one venue: nothing to choose, nothing hidden.
  // Скрипт в `<head>` её уже выбрал (`?place=`, запомненная, первая точка) и
  // спрятал чужое меню; здесь она становится точкой и корзины. `null` — сайт
  // с одной точкой: выбирать нечего, ничего не спрятано.
  const root = document.documentElement;
  const venueById = new Map(venues.map((venue) => [venue.id, venue]));
  let place: number | null = venues.length ? (venueById.has(Number(root.dataset.venue)) ? Number(root.dataset.venue) : venues[0].id) : null;
  const nameOf = (id: number | null | undefined) => (id ? (venueById.get(id)?.name ?? '') : '');
  /** «на Садовой» — улица без дома: короткое «где» для строк о корзине */
  const onStreet = (id: number | null | undefined) => (id && venueById.has(id) ? `на ${venueCase(nameOf(id).split(',')[0].trim(), 'loc')}` : '');
  /** «на Садовой, 212Б» (и «на Советской Армии, 177») — где готовят блюдо */
  const whereCooked = (ids: readonly number[]) =>
    ids
      .filter((id) => venueById.has(id))
      .map((id) => `на ${venueCase(nameOf(id), 'loc')}`)
      .join(' и ');
  const dishWord = (n: number) => `${n}\u00a0${plural(n, 'блюдо', 'блюда', 'блюд')}`;
  /** «Борщ» в кавычках, а «Круассан «Миндальный»» — без вторых: кавычки у него уже есть */
  const named = (title: string) => (/[«»"]/.test(title) ? title : `«${title}»`);
  /** Видна ли разметка (раздел, плитка, пункт) на точке: `data-places` пуст — везде. */
  const shownAt = (node: HTMLElement, id: number | null) => {
    const list = node.dataset.places;
    return !id || !list || list.split(' ').includes(String(id));
  };

  // The chosen venue's cart; the old shared one moves into it on the first
  // visit (`takeCart`). A dish gone from the catalog is dropped and named.
  // Корзина выбранной точки; старая общая переезжает в неё при первом заходе
  // (`takeCart`). Блюдо, ушедшее из каталога, выпадает и называется.
  const loadCart = (id: number | null) => {
    const restored = reconcile(takeCart(store, id), index);
    if (restored.dropped.length) store.set(cartKey(id), JSON.stringify(restored.cart));
    return restored;
  };
  const restored = loadCart(place);
  let cart: Cart = restored.cart;
  let undo: Cart | null = null;
  let dropped = restored.dropped;

  // «Вкусные баллы» in the drawer (null without the account) / баллы в корзине (null без кабинета)
  let cartAccount: ReturnType<typeof mountCartAccount> = null;

  const announcer = $('[data-announce]');
  const announce = (text: string) => {
    if (!announcer) return;
    announcer.textContent = '';
    requestAnimationFrame(() => (announcer.textContent = text));
  };

  const bump = (node: Element | null) => {
    if (!node) return;
    node.classList.remove('bump');
    void (node as HTMLElement).offsetWidth;
    node.classList.add('bump');
  };

  /** Самая мелкая копия кадра карточки — миниатюра строки корзины. */
  const thumbOf = (id: number) => {
    const img = $<HTMLImageElement>(`[data-dish="${id}"] .dish__frame img`);
    if (!img) return null;
    const first = img.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
    return first || img.getAttribute('src');
  };
  const thumb = (id: number) => {
    const src = thumbOf(id);
    return src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : icon(clocheIcon);
  };

  // ── render ──────────────────────────────────────────────────────────────
  let lastCount = -1;
  const render = () => {
    const sum = priced(cart, index, place);
    const changed = sum.count !== lastCount && lastCount !== -1;
    lastCount = sum.count;

    // cards: the add button or the olive counter, never both
    // карточки: кнопка «В корзину» или оливковый счётчик, но не оба
    for (const ctl of $$('[data-ctl]')) {
      const id = Number(ctl.dataset.ctl);
      const n = qtyOf(cart, id, null);
      const addBtn = $<HTMLButtonElement>('[data-add]', ctl);
      const qty = $('[data-qty]', ctl);
      if (addBtn) addBtn.hidden = n > 0;
      if (qty) {
        qty.hidden = n === 0;
        const out = $('[data-n]', qty);
        if (out) out.textContent = String(n);
        const inc = $<HTMLButtonElement>('[data-inc]', qty);
        if (inc) inc.disabled = n >= MAX_QTY;
      }
    }
    for (const badge of $$('[data-in-cart]')) {
      const id = Number(badge.closest<HTMLElement>('[data-dish]')?.dataset.dish);
      const n = qtyOfProduct(cart, id);
      badge.hidden = n === 0;
      badge.textContent = n ? String(n) : '';
    }

    // header, side panel, phone bar
    // шапка, боковая панель, полоса на телефоне
    // a reader hears whose cart it is: the venue changes it
    // читалка слышит, чья корзина: точка её меняет
    const whose = place ? ` ${onStreet(place)}` : '';
    const label = sum.count ? `${positions(sum.count)} на ${rub(sum.total)}` : 'пусто';
    for (const node of $$('[data-cart-count]')) {
      node.textContent = String(sum.count);
      node.hidden = sum.count === 0;
      if (changed) bump(node);
    }
    for (const node of $$('[data-cart-sum]')) node.textContent = sum.count ? rub(sum.total) : '';
    for (const node of $$('.header__cart, .header__cart-btn')) node.setAttribute('aria-label', `Корзина${whose}: ${label}`);
    const mcEmpty = $('[data-mc-empty]');
    const mcFull = $('[data-mc-full]');
    if (mcEmpty && mcFull) {
      mcEmpty.hidden = cart.lines.length > 0;
      mcFull.hidden = cart.lines.length === 0;
      const count = $('[data-mc-count]');
      const total = $('[data-mc-total]');
      if (count) count.textContent = positions(sum.count);
      if (total) {
        total.textContent = rub(sum.total);
        if (changed) bump(total);
      }
    }
    const bar = $('[data-cartbar]');
    if (bar) {
      bar.hidden = cart.lines.length === 0 || drawer.open;
      const count = $('[data-bar-count]', bar);
      const total = $('[data-bar-total]', bar);
      if (count) count.textContent = `Корзина · ${positions(sum.count)}`;
      if (total) {
        total.textContent = rub(sum.total);
        if (changed) bump(total);
      }
      $('[data-cart-open]', bar)?.setAttribute('aria-label', `Открыть корзину${whose}: ${label}`);
    }

    paintOther();
    for (const node of $$('[data-count]', drawer)) node.textContent = sum.count ? `· ${positions(sum.count)}` : '';
    for (const node of $$('[data-total]', drawer)) node.textContent = rub(sum.total);
    renderLines(sum);
    // the delivery depends on the dishes (free from, the zone's minimum), the bill on both
    // доставка зависит от блюд (бесплатно от, минимум зоны), счёт — от того и другого
    paintDelivery();
    paintBill();
    cartAccount?.refresh();
  };

  const renderLines = (sum = priced(cart, index, place)) => {
    const list = $('[data-lines]', drawer);
    const emptyBox = $('[data-empty]', drawer);
    const foot = $('[data-cart-foot]', drawer);
    if (!list || !emptyBox || !foot) return;
    list.innerHTML = sum.lines
      .map((line) => {
        const key = esc(line.key);
        const meta = [
          line.variant ?? line.weight,
          line.filling ? `начинка «${line.filling}»` : null,
          line.qty > 1 ? `${rub(line.price)} за шт.` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        // a line that cannot be ordered here says why and offers the one way out in words
        // строка, которую здесь не заказать, говорит почему и называет выход словом
        // `elsewhere` — the admin took this venue off the dish after it was put in
        // `elsewhere` — в админке сняли эту точку у блюда уже после того, как его положили
        const cooked = whereCooked(line.places);
        const flag = !line.available
          ? 'Закончилось — уберите из заказа'
          : line.elsewhere
            ? cooked
              ? `Теперь готовят только ${cooked}`
              : 'Здесь больше не готовят'
            : '';
        const stuck = Boolean(flag);
        return `<li class="line${stuck ? ' line--out' : ''}${line.elsewhere ? ' line--away' : ''}">
          <div class="line__img">${thumb(line.id)}</div>
          <p class="line__title">${esc(line.title)}</p>
          <p class="line__sum tnum">${rub(line.sum)}</p>
          ${meta ? `<p class="line__meta tnum">${esc(meta)}</p>` : ''}
          ${flag ? `<p class="line__flag">${esc(flag)}</p>` : ''}
          <div class="line__ctl">
            <div class="qty qty--sm" role="group" aria-label="Количество: ${esc(line.title)}">
              <button type="button" class="qty__btn" data-line-dec="${key}" aria-label="Убрать одну">${icon(minusIcon)}</button>
              <output class="qty__n tnum">${line.qty}</output>
              <button type="button" class="qty__btn" data-line-inc="${key}" aria-label="Добавить ещё"${line.qty >= MAX_QTY || stuck ? ' disabled' : ''}>${icon(plusIcon)}</button>
            </div>
            ${
              stuck
                ? `<button type="button" class="tlink line__drop" data-line-remove="${key}" aria-label="Убрать из корзины: ${esc(line.title)}">${icon(trashIcon)}<span>Убрать</span></button>`
                : `<button type="button" class="round-btn line__remove" data-line-remove="${key}" aria-label="Убрать из корзины: ${esc(line.title)}">${icon(trashIcon)}</button>`
            }
          </div>
        </li>`;
      })
      .join('');
    const isEmpty = sum.lines.length === 0;
    emptyBox.hidden = !isEmpty;
    foot.hidden = isEmpty;
    const blocked = $('[data-blocked]', drawer);
    if (blocked) blocked.hidden = !sum.blocked;
    paintAway(sum);
    const toCheckout = $<HTMLButtonElement>('[data-to-checkout]', drawer);
    if (toCheckout) toCheckout.disabled = sum.blocked || sum.elsewhere.length > 0 || sum.count === 0;

    const notice = $('[data-dropped]', drawer);
    if (notice) {
      if (undo) {
        notice.innerHTML = 'Корзина очищена. <button type="button" class="tlink" data-undo>Вернуть</button>';
        notice.hidden = false;
      } else if (dropped.length) {
        notice.textContent = `Из корзины убрали: ${dropped.join(', ')} — этого больше нет в каталоге.`;
        notice.hidden = false;
      } else notice.hidden = true;
    }

    // an empty cart offers the hits instead of a blank page — one per
    // section, or all three would be breakfasts, the first section
    // пустая корзина предлагает хиты вместо пустого листа — по одному из
    // раздела, иначе все три оказались бы завтраками из первого раздела
    const suggest = $('[data-suggest]', drawer);
    const suggestList = $('[data-suggest-list]', drawer);
    if (suggest && suggestList) {
      const sections = new Set<string>();
      const picks = products
        .filter((dish) => dish.available && cookedHere(dish, place) && !dish.variants.length && !dish.fillings.length && dish.badges.includes('hit'))
        .filter((dish) => !sections.has(dish.category) && Boolean(sections.add(dish.category)))
        .slice(0, 3);
      suggest.hidden = !isEmpty || picks.length === 0;
      suggestList.innerHTML = picks
        .map(
          (dish) => `<li class="suggest__item">
            <div class="line__img">${thumb(dish.id)}</div>
            <div><p class="suggest__title">${esc(dish.title)}</p><p class="suggest__price tnum">${esc([dish.weight, rub(dish.price)].filter(Boolean).join(' · '))}</p></div>
            <button type="button" class="round-btn" data-add="${dish.id}" aria-label="В корзину: ${esc(dish.title)}">${icon(plusIcon)}</button>
          </li>`,
        )
        .join('');
    }
  };

  /**
   * Dishes this venue no longer cooks (a safety net: every venue has its own
   * cart, so they appear only when the admin takes a venue off a dish already
   * in a cart): the notice over the lines says how many and offers to remove
   * them; the line over the closed button says why it is closed.
   * Блюда, которых точка больше не готовит (страховка: у каждой точки своя
   * корзина, и такие появляются, только если в админке сняли точку у блюда, уже
   * лежащего в корзине): плашка над строками говорит, сколько их, и предлагает
   * убрать; строка над закрытой кнопкой говорит, почему она закрыта.
   */
  const paintAway = (sum = priced(cart, index, place)) => {
    const note = $('[data-away-note]', drawer);
    const warn = $('[data-cart-warn]', drawer);
    const away = sum.elsewhere;
    const n = away.length;
    if (warn) {
      warn.hidden = !n && !sum.blocked;
      warn.textContent = n
        ? n === 1
          ? 'Одно блюдо здесь больше не готовят — уберите его'
          : `${dishWord(n)} здесь больше не готовят — уберите их`
        : sum.blocked
          ? 'Сначала уберите то, что закончилось'
          : '';
    }
    if (!note) return;
    note.hidden = !n;
    if (!n) return;
    $('[data-away-note-text]', note)!.textContent =
      `${n === 1 ? `${named(away[0].title)} больше не готовят` : `${dishWord(n)} из корзины больше не готовят`} ${whereCooked(place ? [place] : [])}. ` +
      `Уберите ${n === 1 ? 'его' : 'их'}, чтобы оформить заказ.`;
    $('[data-away-drop]', note)!.textContent = n === 1 ? 'Убрать его' : `Убрать ${dishWord(n)}`;
  };

  /**
   * The other venue's cart, when it holds something: read from storage each
   * time (another tab may have filled it) and priced at its own venue.
   * Корзина другой точки, если в ней что-то есть: читается из хранилища каждый
   * раз (её могла наполнить другая вкладка) и считается по своей точке.
   */
  const otherCart = () => {
    for (const venue of venues) {
      if (venue.id === place) continue;
      const sum = priced(reconcile(parseCart(store.get(cartKey(venue.id))), index).cart, index, venue.id);
      const n = sum.lines.reduce((all, line) => all + line.qty, 0);
      if (n) return { venue, n, total: sum.total };
    }
    return null;
  };

  /**
   * «В корзине на Советской Армии: 3 блюда на 1 370 ₽ · Перейти» — under the
   * switch over the menu (head and column) and under the drawer's lines
   * whenever the other venue's cart holds something; an empty drawer says it
   * under «В корзине пусто» as «На Садовой в корзине …». The street without
   * the house number: the switch right above names the venue in full, and the
   * line fits the 228 px column.
   * «В корзине на Советской Армии: 3 блюда на 1 370 ₽ · Перейти» — под
   * переключателем над меню (в шапке и колонке) и под строками корзины, пока в
   * корзине другой точки что-то есть; пустая корзина говорит это под «В корзине
   * пусто» как «На Садовой в корзине …». Улица без номера дома: переключатель
   * прямо над строкой называет точку полностью, а строка помещается в колонку 228 px.
   */
  const paintOther = () => {
    const other = otherCart();
    const what = other ? `${dishWord(other.n)}${other.total ? ` на ${rub(other.total)}` : ''}` : '';
    const where = other ? onStreet(other.venue.id) : '';
    for (const node of $$('[data-venue-cart], [data-other-cart]')) {
      const kind = node.dataset.otherCart;
      const empty = kind === 'empty';
      node.hidden = !other || (empty && cart.lines.length > 0) || (kind === 'full' && !cart.lines.length);
      const text = $('[data-venue-cart-text]', node);
      if (text) text.textContent = !other ? '' : empty ? `${where.charAt(0).toUpperCase()}${where.slice(1)} в корзине` : `В корзине ${where}:`;
      const amount = $('[data-venue-cart-what]', node);
      if (amount) amount.textContent = what;
      const go = $<HTMLButtonElement>('[data-venue-go]', node);
      if (go && other) {
        go.dataset.venueGo = String(other.venue.id);
        go.setAttribute('aria-label', `Перейти на ${venueCase(other.venue.name, 'acc')}: в корзине ${what}`);
      }
    }
    // «Готовит: … · Поменять» in the checkout changes the cart along with the
    // venue: offered only when the other venue's cart has something to order
    // «Готовит: … · Поменять» в оформлении меняет вместе с точкой и корзину:
    // предлагается, только когда в корзине другой точки есть что заказать
    for (const swap of $$('[data-venue-swap]')) {
      swap.hidden = !other;
      if (other) {
        swap.dataset.venueGo = String(other.venue.id);
        swap.setAttribute('aria-label', `Поменять точку на ${venueCase(other.venue.name, 'acc')}: там в корзине ${what}`);
      }
    }
  };

  const commit = (next: Cart, message?: string) => {
    cart = next;
    store.set(cartKey(place), JSON.stringify(cart));
    render();
    if (message) announce(message);
  };

  const summary = () => {
    const sum = priced(cart, index, place);
    return sum.count ? `В корзине ${positions(sum.count)} на ${rub(sum.total)}` : 'Корзина пуста';
  };

  // ── dish window ─────────────────────────────────────────────────────────
  let current: Dish | null = null;
  let dlgQty = 1;
  let dlgVariant: string | null = null;
  let dlgFilling: string | null = null;

  const dlgPrice = () => {
    if (!current) return 0;
    const variant = current.variants.find((item) => item.name === dlgVariant);
    return (variant?.price ?? current.price) * dlgQty;
  };

  const paintDialog = () => {
    if (!current) return;
    const n = $('[data-dlg-n]', dishDialog);
    if (n) n.textContent = String(dlgQty);
    const dec = $<HTMLButtonElement>('[data-dlg-dec]', dishDialog);
    const inc = $<HTMLButtonElement>('[data-dlg-inc]', dishDialog);
    if (dec) dec.disabled = dlgQty <= 1;
    if (inc) inc.disabled = dlgQty >= MAX_QTY;
    const price = $('[data-dlg-price]', dishDialog);
    if (price) price.textContent = rub(dlgPrice());
    const add = $('[data-dlg-add]', dishDialog);
    const choice = [dlgVariant, dlgFilling].filter(Boolean).join(', ');
    add?.setAttribute('aria-label', `В корзину: ${current.title}${choice ? `, ${choice}` : ''}, ${dlgQty} шт., ${rub(dlgPrice())}`);
    const inCart = qtyOf(cart, current.id, dlgVariant, dlgFilling);
    const incart = $('[data-incart]', dishDialog);
    const incartText = $('[data-incart-text]', dishDialog);
    if (incart && incartText) {
      incart.hidden = inCart === 0;
      incartText.textContent = `Уже в корзине: ${inCart} шт.`;
    }
    // Not cooked at the chosen venue (a shared link, a dish seen at the other
    // venue): no buy row, the venue that cooks it and the way to its menu.
    // Не готовят на выбранной точке (ссылка, блюдо, увиденное на другой точке):
    // строки покупки нет — есть точка, где его готовят, и переход в её меню.
    const away = current.available && !cookedHere(current, place);
    $('[data-out]', dishDialog)!.hidden = current.available;
    $('[data-buy]', dishDialog)!.hidden = !current.available || away;
    const awayBox = $('[data-away]', dishDialog);
    if (awayBox) {
      awayBox.hidden = !away;
      const there = (current.places ?? []).find((id) => venueById.has(id));
      if (away && there) {
        $('[data-away-text]', awayBox)!.textContent = `Это блюдо готовят только ${whereCooked(current.places ?? [])}: меню на точках разное.`;
        const go = $<HTMLButtonElement>('[data-away-go]', awayBox)!;
        go.textContent = `Перейти на ${venueCase(nameOf(there), 'acc')}`;
        go.dataset.awayGo = String(there);
      }
    }
  };

  const openDish = (id: number, updateUrl = true) => {
    const dish = dishes.get(id);
    if (!dish) return;
    current = dish;
    dlgQty = 1;
    dlgVariant = dish.variants[0]?.name ?? null;
    // a filling is never chosen for the guest: a wrong cake is worse than one more tap
    // начинку за гостя не выбираем: не тот торт хуже лишнего касания
    dlgFilling = null;

    const card = $(`[data-dish="${id}"]`);
    const img = card ? $<HTMLImageElement>('.dish__frame img', card) : null;
    const photo = $('[data-photo]', dishDialog)!;
    if (img) {
      const big = document.createElement('img');
      if (img.getAttribute('srcset')) big.setAttribute('srcset', img.getAttribute('srcset')!);
      big.src = img.getAttribute('src') ?? '';
      big.sizes = '(min-width: 768px) 440px, 100vw';
      big.alt = img.alt || dish.title;
      big.decoding = 'async';
      photo.replaceChildren(big);
    } else {
      photo.innerHTML = `<span class="dish__stub">${icon(clocheIcon)}<span>Фото скоро</span></span>`;
    }

    $('[data-cat]', dishDialog)!.textContent = dish.category;
    $('[data-title]', dishDialog)!.textContent = dish.title;
    const meta = [
      ...(dish.available ? [] : ['<span class="dish__flag dish__flag--out">Нет в наличии</span>']),
      ...dish.badges.map((badge) => `<span class="dish__flag">${BADGE_LABEL[badge]}</span>`),
      ...(dish.weight && !dish.variants.length ? [`<span class="tnum">${esc(dish.weight)}</span>`] : []),
      ...(dish.oldPrice ? [`<span class="tnum">Было ${rub(dish.oldPrice)}</span>`] : []),
    ];
    $('[data-meta]', dishDialog)!.innerHTML = meta.join('');
    $('[data-desc]', dishDialog)!.textContent = dish.description ?? '';
    const compWrap = $('[data-comp-wrap]', dishDialog)!;
    compWrap.hidden = !dish.composition;
    $('[data-comp]', dishDialog)!.textContent = dish.composition ?? '';

    const variants = $('[data-variants]', dishDialog)!;
    variants.hidden = dish.variants.length === 0;
    $('[data-variant-list]', dishDialog)!.innerHTML = dish.variants
      .map(
        (variant, i) => `<label class="variant">
          <input type="radio" name="variant" value="${esc(variant.name)}"${i === 0 ? ' checked' : ''}>
          <span class="variant__name">${esc(variant.name)}</span>
          <span class="variant__price tnum">${esc([variant.weight && variant.weight !== variant.name ? variant.weight : null, rub(variant.price)].filter(Boolean).join(' · '))}</span>
        </label>`,
      )
      .join('');

    const fillings = $('[data-fillings]', dishDialog)!;
    fillings.hidden = dish.fillings.length === 0;
    $('[data-fill-err]', dishDialog)!.hidden = true;
    $('[data-filling-list]', dishDialog)!.innerHTML = dish.fillings
      .map(
        (filling) => `<label class="variant">
          <input type="radio" name="filling" value="${esc(filling)}">
          <span class="variant__name">${esc(filling)}</span>
        </label>`,
      )
      .join('');

    paintDialog();

    if (drawer.open) drawer.close();
    if (!dishDialog.open) dishDialog.showModal();
    // the title takes the focus: the reader hears the dish, the eye sees no ring on «Закрыть»
    // фокус на заголовке: читалка называет блюдо, глаз не видит кольца на «Закрыть»
    $<HTMLElement>('[data-title]', dishDialog)?.focus({ preventScroll: true });
    dishDialog.querySelector('.dish-dlg__body')?.scrollTo(0, 0);
    dishDialog.scrollTo(0, 0);
    if (updateUrl) history.replaceState(null, '', `#p-${dish.slug}`);
  };

  dishDialog.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name === 'variant') {
      dlgVariant = input.value;
      paintDialog();
    }
    if (input.name === 'filling') {
      dlgFilling = input.value;
      $('[data-fill-err]', dishDialog)!.hidden = true;
      paintDialog();
    }
  });

  dishDialog.addEventListener('close', () => {
    if (location.hash.startsWith('#p-')) history.replaceState(null, '', location.pathname + location.search);
    current = null;
  });

  // ── drawer: steps ───────────────────────────────────────────────────────
  type Step = 'cart' | 'checkout' | 'login' | 'done';
  let step: Step = 'cart';
  const TITLES: Record<Step, string> = { cart: 'Корзина', checkout: 'Оформление', login: 'Вход', done: 'Готово' };
  const form = $<HTMLFormElement>('form[data-step="checkout"]', drawer)!;
  const endpoint = drawer.dataset.endpoint ?? '';
  const deliveryApi = drawer.dataset.deliveryApi ?? '';

  const goto = (next: Step, focus = true) => {
    step = next;
    for (const section of $$('[data-step]', drawer)) section.hidden = section.dataset.step !== next;
    const back = $('[data-back]', drawer);
    if (back) back.hidden = next !== 'checkout' && next !== 'login';
    back?.setAttribute('aria-label', next === 'login' ? 'Назад к оформлению' : 'Назад к корзине');
    const title = $('[data-drawer-title]', drawer);
    if (title) title.textContent = TITLES[next];
    // whose cart — on the cart step: the form names the venue itself («Готовит:
    // …», the venue radios), twice in one view would be a duplicate; «Вход» and
    // «Готово» have their own lines
    // чья корзина — на шаге корзины: форма называет точку сама («Готовит: …»,
    // радио точки), дважды на одном экране было бы дублем; у «Входа» и «Готово»
    // свои строки
    const venueLine = $('[data-drawer-venue]', drawer);
    if (venueLine) venueLine.hidden = next !== 'cart';
    if (next === 'checkout') {
      fillTimes();
      cartAccount?.onCheckout();
      // a draft address is counted as soon as the form opens, not at the send
      // адрес из черновика считается, как только открылась форма, а не при отправке
      void ensureQuote();
    }
    if (focus) (next === 'done' ? $('#done-title', drawer) : title)?.focus({ preventScroll: true });
  };

  const openCart = () => {
    if (dishDialog.open) dishDialog.close();
    if (step === 'done') goto('cart', false);
    render();
    if (!drawer.open) drawer.showModal();
    $('[data-drawer-title]', drawer)?.focus({ preventScroll: true });
    $('[data-cartbar]')?.setAttribute('hidden', '');
  };

  drawer.addEventListener('close', () => {
    undo = null;
    dropped = [];
    if (location.hash === '#cart') history.replaceState(null, '', location.pathname + location.search);
    render();
  });

  // ── checkout form ───────────────────────────────────────────────────────
  const field = <T extends HTMLElement = HTMLInputElement>(name: string) => form.elements.namedItem(name) as T | null;
  const radio = (name: string) => (form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '');

  // only the order's own fields: the account's ones in the same form
  // (`saved_address`, `save_address`, `save_label*`) never reach the order or the draft
  // только поля самого заказа: поля кабинета в той же форме
  // (`saved_address`, `save_address`, `save_label*`) не попадают ни в заказ, ни в черновик
  // the mail for the receipt counts only while its field is shown — with
  // online payment on (`payment.ts`); a hidden one is neither checked nor sent
  // почта для чека считается, только пока её поле видно — при включённой
  // онлайн-оплате (`payment.ts`); скрытую не проверяем и не отправляем
  // the mail is required while it is shown: shown means online payment, and the
  // receipt of an online payment needs it (owner, 26.10.2026)
  // почта обязательна, пока её поле видно: видно — значит онлайн-оплата, а чеку
  // онлайн-оплаты она нужна (владелец, 26.10.2026)
  const emailBox = $('[data-receipt-email]', form);
  const read = (): CheckoutForm => ({
    name: field('name')?.value ?? '',
    phone: field('phone')?.value ?? '',
    email: emailBox && !emailBox.hidden ? (field('email')?.value ?? '') : '',
    payment: emailBox && !emailBox.hidden && paysOnline() ? 'online' : null,
    fulfillment: fulfillmentOf(radio('fulfillment')),
    place: Number(radio('place')) || place || null,
    table: field('table')?.value ?? '',
    address: field('address')?.value ?? '',
    flat: field('flat')?.value ?? '',
    entrance: field('entrance')?.value ?? '',
    floor: field('floor')?.value ?? '',
    intercom: field('intercom')?.value ?? '',
    when: radio('when') === 'later' ? 'later' : 'asap',
    date: field<HTMLSelectElement>('date')?.value,
    time: field<HTMLSelectElement>('time')?.value,
    comment: field<HTMLTextAreaElement>('comment')?.value ?? '',
    consent: field('consent')?.checked ?? false,
  });

  // ── delivery: address suggestions and the zone quote ─────────────────────
  // The address field becomes a combobox (WAI-ARIA 1.2) once the build has
  // the API: houses from `GET /delivery/suggest` after a 300 ms pause, ↑/↓ to
  // move, Enter to take, Esc to close (the drawer stays open). A picked house
  // or a typed address (on leaving the field or after a longer pause) is
  // quoted by `POST /delivery/quote`; the line under the field and the bill
  // say what that means, a zone's minimum not reached closes the send. The
  // server finds the zone again on its own, so nothing but the address leaves.
  // Поле адреса становится комбобоксом (WAI-ARIA 1.2), когда у сборки есть
  // API: дома из `GET /delivery/suggest` после паузы 300 мс, ↑/↓ — двигать,
  // Enter — взять, Esc — закрыть (корзина остаётся открытой). Выбранный дом
  // или набранный адрес (при уходе с поля или после паузы подольше) считается
  // через `POST /delivery/quote`; строка под полем и счёт говорят, что это
  // значит, недобранный минимум зоны закрывает отправку. Зону сервер находит
  // сам заново, поэтому, кроме адреса, ничего не уходит.
  const addressInput = field('address');
  const comboList = $<HTMLUListElement>('[data-combo-list]', form);
  const addressHint = $('[data-address-hint]', form);
  const dlv = $('[data-dlv]', form);
  const formScroll = $('.drawer__scroll', form);
  const suggesting = Boolean(deliveryApi && addressInput && comboList);
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  let delivery: DeliveryState = { kind: 'empty' };
  const quoted = new Map<string, Quote>();
  const suggested = new Map<string, Suggestion[]>();
  // the address that came from a suggestion: the guest has seen it, no «на карте» line for it
  // адрес, взятый из подсказки: гость его уже видел, строки «на карте» для него не нужно
  let pickedKey = '';
  let quoteSeq = 0;
  let quoting: Promise<void> | null = null;
  let lastSaid = '';
  const dishesTotal = () => priced(cart, index, place).total;

  const paintDelivery = () => {
    if (!dlv || !addressInput) return;
    const status = statusFor(delivery, dishesTotal());
    if (addressHint) addressHint.hidden = Boolean(status) || !suggesting;
    dlv.hidden = !status;
    addressInput.setAttribute(
      'aria-describedby',
      [addressHint && !addressHint.hidden ? addressHint.id : '', status ? dlv.id : '', 'co-address-err'].filter(Boolean).join(' '),
    );
    if (!status) return;
    dlv.dataset.tone = status.tone;
    const line = $('[data-dlv-line]', dlv)!;
    line.hidden = !status.text;
    const text = $('[data-dlv-text]', dlv)!;
    const money = status.money && status.text?.includes(status.money) ? status.money : '';
    if (money) {
      const at = status.text!.indexOf(money);
      text.innerHTML = `${esc(status.text!.slice(0, at))}<b class="tnum">${esc(money)}</b>${esc(status.text!.slice(at + money.length))}`;
    } else text.textContent = status.text ?? '';
    const meta = $('[data-dlv-meta]', dlv)!;
    meta.hidden = !status.meta.length;
    meta.innerHTML = status.meta.map((item) => `<span>${esc(item)}</span>`).join('');
    $('[data-dlv-warn]', dlv)!.hidden = !status.warn;
    $('[data-dlv-warn-text]', dlv)!.textContent = status.warn ?? '';
    for (const action of $$('[data-dlv-act]', dlv)) action.hidden = !status.actions.includes(action.dataset.dlvAct as StatusAction);
  };

  const paintBill = () => {
    const dishes = dishesTotal();
    const row = billRow(delivery, dishes);
    const rowNode = $('[data-bill-delivery]', form);
    if (rowNode) {
      // at a table there is nothing to deliver and nothing to take: no row at all
      // в зале нечего ни везти, ни забирать: строки нет вовсе
      rowNode.hidden = radio('fulfillment') === 'dine_in';
      $('[data-bill-delivery-label]', rowNode)!.textContent = row.label;
      const value = $('[data-bill-delivery-value]', rowNode)!;
      value.textContent = row.value;
      value.dataset.tone = row.tone;
    }
    const off = cartAccount?.deductions() ?? { discount: 0, points: 0 };
    const pay = $('[data-bill-pay]', form);
    if (pay) pay.textContent = rub(payable({ dishes, ...off, delivery: deliveryCost(delivery, dishes) }));
    // the zone's minimum not reached: the button says it is closed, the note under the bill says why
    // минимум зоны не добран: кнопка говорит, что закрыта, строка под счётом — почему
    const blocked = blocksOrder(delivery, dishes);
    const button = $('[data-submit]', form);
    // without the consent tick the button looks closed too; the click still
    // runs validation, which names the tick and lights it up
    // без галочки согласия кнопка тоже выглядит закрытой; клик всё равно
    // запускает проверку, которая называет галочку и подсвечивает её
    const consented = field('consent')?.checked ?? false;
    // dishes the venue no longer cooks (the admin took it off while the cart waited)
    // блюда, которых точка больше не готовит (в админке сняли, пока корзина ждала)
    const away = priced(cart, index, place).elsewhere;
    if (blocked || !consented || away.length) button?.setAttribute('aria-disabled', 'true');
    else button?.removeAttribute('aria-disabled');
    const note = $('[data-bill-note]', form);
    if (note) {
      note.hidden = !blocked;
      note.textContent = blocked ? shortText(shortOfMin(delivery, dishes)) : '';
    }
    const awayNote = $('[data-bill-away]', form);
    if (awayNote) {
      awayNote.hidden = !away.length;
      if (away.length)
        $('[data-bill-away-text]', awayNote)!.textContent = `${away.length === 1 ? `${named(away[0].title)} больше не готовят` : `${dishWord(away.length)} из корзины больше не готовят`} ${whereCooked(place ? [place] : [])}.`;
    }
  };

  const setDelivery = (next: DeliveryState, say = false) => {
    delivery = next;
    paintDelivery();
    paintBill();
    if (!say) return;
    const text = announceFor(next, dishesTotal());
    if (text && text !== lastSaid) announce(text);
    lastSaid = text;
  };

  /** Посчитать доставку на адрес: из памяти страницы или у сервера; ответ на старый адрес не применяется. */
  const quote = (address: string, picked = false): Promise<void> => {
    const key = normalizeAddress(address);
    if (picked) pickedKey = key;
    if (!canQuote(address)) {
      quoteSeq += 1;
      quoting = null;
      setDelivery({ kind: 'empty' });
      return Promise.resolve();
    }
    if (!deliveryApi) {
      setDelivery({ kind: 'unknown', address, why: 'off' });
      return Promise.resolve();
    }
    const known = quoted.get(key);
    if (known) {
      quoteSeq += 1;
      quoting = null;
      setDelivery(stateFromQuote(address, known, key === pickedKey), true);
      return Promise.resolve();
    }
    if (quoting && delivery.kind === 'pending' && normalizeAddress(delivery.address) === key) return quoting;
    const seq = ++quoteSeq;
    setDelivery({ kind: 'pending', address });
    const run = fetch(`${deliveryApi}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: address.trim() }),
      signal: AbortSignal.timeout(7000),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseQuote(await response.json());
      })
      .then((answer) => {
        quoted.set(key, answer);
        if (seq === quoteSeq) setDelivery(stateFromQuote(address, answer, key === pickedKey), true);
      })
      .catch(() => {
        // the server is to decide anyway: the order still goes, the price is named on the call
        // решать всё равно серверу: заказ уходит, стоимость назовут при звонке
        if (seq === quoteSeq) setDelivery({ kind: 'unknown', address, why: 'error' }, true);
      })
      .finally(() => {
        if (seq === quoteSeq) quoting = null;
      });
    quoting = run;
    return run;
  };

  /** Доставка этого адреса посчитана (или считается): на открытии формы, уходе с поля, отправке. */
  const ensureQuote = () => {
    if (radio('fulfillment') === 'pickup') return Promise.resolve();
    const address = addressInput?.value ?? '';
    const same = delivery.kind !== 'pickup' && delivery.kind !== 'empty' && normalizeAddress(delivery.address) === normalizeAddress(address);
    if (same && delivery.kind === 'pending' && quoting) return quoting;
    // an error is asked again: the server may have been away for a moment
    // ошибку спрашиваем заново: сервер мог отлучиться на минуту
    if (same && !(delivery.kind === 'unknown' && delivery.why === 'error')) return Promise.resolve();
    return quote(address);
  };

  /** Доставка ↔ самовывоз и зал: у них доставки нет, при возврате — снова расчёт адреса. */
  const syncFulfillment = () => {
    if (radio('fulfillment') !== 'delivery') {
      if (delivery.kind === 'pickup') return;
      quoteSeq += 1;
      quoting = null;
      closeList();
      setDelivery({ kind: 'pickup' });
      return;
    }
    if (delivery.kind !== 'pickup') return;
    setDelivery({ kind: 'empty' });
    if (step === 'checkout') void ensureQuote();
  };

  // ── the suggestions / подсказки ──
  let options: Suggestion[] = [];
  let activeIndex = -1;
  let suggestTimer = 0;
  let quoteTimer = 0;
  let suggestCtl: AbortController | null = null;
  let revealed = false;
  let escaped = false;

  const listOpen = () => Boolean(comboList && !comboList.hidden);

  function closeList() {
    if (!comboList || !addressInput) return;
    comboList.hidden = true;
    comboList.innerHTML = '';
    options = [];
    activeIndex = -1;
    if (suggesting) addressInput.setAttribute('aria-expanded', 'false');
    addressInput.removeAttribute('aria-activedescendant');
  }

  const highlight = (next: number) => {
    if (!comboList || !addressInput) return;
    activeIndex = next;
    for (const option of $$('[role="option"]', comboList)) {
      const on = Number(option.dataset.opt) === next;
      option.setAttribute('aria-selected', String(on));
      if (on) {
        addressInput.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    }
    if (next < 0) addressInput.removeAttribute('aria-activedescendant');
  };

  // On a phone the keyboard takes half the screen: when the list would end
  // under it (or under the drawer's footer), the form scrolls up once per
  // visit to the field, as far as the field itself can go.
  // На телефоне клавиатура занимает полэкрана: если список уходит под неё (или
  // под подвал корзины), форма один раз за заход в поле прокручивается вверх —
  // не дальше, чем позволяет само поле.
  const reveal = () => {
    if (revealed || !comboList || !formScroll || !addressInput) return;
    requestAnimationFrame(() => {
      if (comboList.hidden) return;
      const box = comboList.getBoundingClientRect();
      const view = formScroll.getBoundingClientRect();
      const screen = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
      const overflow = box.bottom + 8 - Math.min(view.bottom, screen);
      if (overflow <= 0) return;
      const room = Math.max(0, addressInput.getBoundingClientRect().top - view.top - 12);
      formScroll.scrollBy({ top: Math.min(overflow, room), behavior: calm() ? 'auto' : 'smooth' });
      revealed = true;
    });
  };

  const openList = (items: Suggestion[]) => {
    if (!comboList || !addressInput) return;
    options = items;
    activeIndex = -1;
    if (!items.length) {
      closeList();
      return;
    }
    comboList.innerHTML = items
      .map(
        (item, i) => `<li class="combo__opt" role="option" id="co-address-opt-${i}" aria-selected="false" data-opt="${i}">
          ${icon(pinIcon)}<span class="combo__label">${esc(item.label)}</span>${item.city && normalizeAddress(item.city) !== normalizeAddress(HOME_CITY) ? `<span class="combo__city">${esc(item.city)}</span>` : ''}
        </li>`,
      )
      .join('');
    comboList.hidden = false;
    addressInput.setAttribute('aria-expanded', 'true');
    addressInput.removeAttribute('aria-activedescendant');
    reveal();
  };

  const showHint = (text: string) => {
    if (addressHint && addressHint.textContent !== text) addressHint.textContent = text;
  };
  const HINT = 'Выберите дом из списка — так мы точно посчитаем доставку';
  // the whole address in one line («…, 165Б, кв 12, подъезд 2») is what the map
  // could not find: the hint points to the fields made for the rest
  // весь адрес одной строкой («…, 165Б, кв 12, подъезд 2») карта и не находила:
  // подсказка показывает на поля, сделанные для остального
  const hintFor = (value: string) => (hasAptWords(value) ? 'Квартиру, подъезд и этаж — в полях ниже, здесь только улица и дом' : HINT);

  const suggest = async (query: string) => {
    if (!addressInput) return;
    const key = normalizeAddress(query);
    const cached = suggested.get(key);
    const apply = (items: Suggestion[]) => {
      if (addressInput.value !== query || document.activeElement !== addressInput) return;
      openList(items);
      // only houses are offered: a street without a number gets a nudge, not silence
      // предлагаются только дома: улица без номера получает подсказку, а не тишину
      showHint(!items.length && !hasHouse(query) ? 'Допишите номер дома — подскажем адрес' : hintFor(query));
      if (items.length) announce(`${items.length} ${items.length === 1 ? 'подсказка' : items.length < 5 ? 'подсказки' : 'подсказок'} адреса, выбор — стрелками`);
    };
    if (cached) return apply(cached);
    suggestCtl?.abort();
    const ctl = new AbortController();
    suggestCtl = ctl;
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const response = await fetch(`${deliveryApi}/suggest?q=${encodeURIComponent(query.trim())}`, { signal: ctl.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const items = parseSuggestions(await response.json());
      if (suggested.size > 200) suggested.clear();
      suggested.set(key, items);
      if (ctl === suggestCtl) apply(items);
    } catch {
      // no suggestions — the field stays a plain field, the quote still works
      // нет подсказок — поле остаётся обычным, расчёт по адресу всё равно работает
      if (ctl === suggestCtl) closeList();
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * Put an address into the delivery fields and count it: a house from the
   * suggestions, a saved address from the account with its courier fields
   * (`parts`), or nothing for «Новый адрес». `picked` — the guest has seen
   * this address already, it needs no «на карте» line.
   * Поставить адрес в поля доставки и посчитать: дом из подсказок,
   * сохранённый адрес из кабинета вместе с полями для курьера (`parts`) или
   * пустоту для «Нового адреса». `picked` — гость этот адрес уже видел,
   * строка «на карте» для него не нужна.
   */
  const applyAddress = (value: string, parts?: AptParts, picked = true) => {
    if (!addressInput) return;
    addressInput.value = value;
    if (parts)
      for (const key of APT_KEYS) {
        const input = field(key);
        if (input) input.value = parts[key] ?? '';
      }
    window.clearTimeout(quoteTimer);
    window.clearTimeout(suggestTimer);
    suggestCtl?.abort();
    closeList();
    showHint(hintFor(value));
    saveDraft();
    // an emptied address is not an error yet: the guest is about to type it
    // очищенный адрес — ещё не ошибка: гость сейчас его наберёт
    if (tried && value) showErrors(validate(read()));
    void quote(value, picked);
    // the saved-address chips follow the fields however they were filled
    // чипы сохранённых адресов следуют за полями, как бы их ни заполнили
    cartAccount?.addressChanged();
  };

  const pick = (i: number) => {
    const item = options[i];
    if (item) applyAddress(addressOf(item));
  };

  if (suggesting && addressInput && comboList) {
    addressInput.setAttribute('role', 'combobox');
    addressInput.setAttribute('aria-autocomplete', 'list');
    addressInput.setAttribute('aria-expanded', 'false');
    addressInput.setAttribute('aria-controls', comboList.id);
    // the browser's own address list would lie on top of ours
    // собственный список адресов браузера лёг бы поверх нашего
    addressInput.setAttribute('autocomplete', 'off');
    addressInput.spellcheck = false;

    addressInput.addEventListener('input', () => {
      const value = addressInput.value;
      pickedKey = '';
      showHint(hintFor(value));
      // what was counted belongs to the old address: back to «by the address» until the new one is known
      // посчитанное относится к старому адресу: снова «по адресу», пока не известен новый
      if (delivery.kind !== 'pickup' && delivery.kind !== 'empty' && normalizeAddress(delivery.address) !== normalizeAddress(value)) {
        quoteSeq += 1;
        quoting = null;
        setDelivery({ kind: 'empty' });
      }
      window.clearTimeout(suggestTimer);
      window.clearTimeout(quoteTimer);
      if (!canSuggest(value)) {
        suggestCtl?.abort();
        closeList();
      } else suggestTimer = window.setTimeout(() => void suggest(value), SUGGEST_DEBOUNCE_MS);
      // typed without a pick: counted after a longer pause once a house number is
      // there and no houses are on offer; a bare street waits for the field to be left
      // набрано без выбора: считается после паузы подольше, когда номер дома уже
      // есть, а дома не предложены; улица без номера ждёт ухода с поля
      quoteTimer = window.setTimeout(() => {
        if (!listOpen() && document.activeElement === addressInput && hasHouse(addressInput.value)) void quote(addressInput.value);
      }, QUOTE_DEBOUNCE_MS);
    });

    addressInput.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!listOpen()) {
          if (event.key === 'ArrowDown' && canSuggest(addressInput.value)) {
            event.preventDefault();
            void suggest(addressInput.value);
          }
          return;
        }
        event.preventDefault();
        const n = options.length;
        highlight(event.key === 'ArrowDown' ? (activeIndex + 1) % n : activeIndex <= 0 ? n - 1 : activeIndex - 1);
        return;
      }
      if (event.key === 'Enter' && listOpen() && activeIndex >= 0) {
        // Enter takes the house instead of sending the form
        // Enter берёт дом, а не отправляет форму
        event.preventDefault();
        pick(activeIndex);
        return;
      }
      if (event.key === 'Escape' && listOpen()) {
        // Esc closes the list, not the drawer
        // Esc закрывает список, а не корзину
        event.preventDefault();
        event.stopPropagation();
        closeList();
        escaped = true;
        setTimeout(() => (escaped = false), 0);
      }
    });
    drawer.addEventListener('cancel', (event) => {
      if (escaped) event.preventDefault();
    });

    // the list keeps the focus in the field: a tap on a house does not blur it first
    // список не забирает фокус у поля: касание дома не снимает его с поля раньше времени
    comboList.addEventListener('mousedown', (event) => event.preventDefault());
    comboList.addEventListener('click', (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[data-opt]');
      if (option) pick(Number(option.dataset.opt));
    });

    addressInput.addEventListener('focus', () => (revealed = false));
    addressInput.addEventListener('blur', () => {
      window.clearTimeout(suggestTimer);
      window.clearTimeout(quoteTimer);
      suggestCtl?.abort();
      closeList();
      void ensureQuote();
    });
  } else if (addressInput) {
    // no API on this build: the price is named on the call, as before the zones
    // у сборки нет API: стоимость называют при звонке, как до зон
    addressInput.addEventListener('blur', () => void ensureQuote());
  }

  dlv?.addEventListener('click', (event) => {
    const action = (event.target as Element).closest<HTMLElement>('[data-dlv-act]')?.dataset.dlvAct;
    if (action === 'pickup') {
      const pickup = form.querySelector<HTMLInputElement>('input[name="fulfillment"][value="pickup"]');
      if (!pickup) return;
      pickup.checked = true;
      pickup.dispatchEvent(new Event('change', { bubbles: true }));
      // the next thing to do is to say where from
      // дальше нужно сказать, откуда заберёте
      const place = form.querySelector<HTMLInputElement>('input[name="place"]:checked') ?? form.querySelector<HTMLInputElement>('input[name="place"]');
      place?.focus({ preventScroll: true });
      place?.closest('.fs')?.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
      announce('Выбран самовывоз — доставки нет');
    }
    if (action === 'catalog') drawer.close();
  });

  const togglePart = () => {
    const data = read();
    for (const part of $$('[data-for]', form)) {
      // `data-for="pickup dine_in"`: the venue radios serve both
      // `data-for="pickup dine_in"`: радио точки нужны обоим
      const keys = (part.dataset.for ?? '').split(' ');
      part.hidden = keys[0] === 'later' ? data.when !== 'later' : !keys.includes(data.fulfillment);
    }
    // the same radios: «where from» for pickup, «where you sit» at a table
    // те же радио: «откуда» для самовывоза, «где сидите» в зале
    const label = $('[data-place-label]', form);
    if (label) label.textContent = data.fulfillment === 'dine_in' ? 'Где вы сидите' : 'Откуда заберёте';
    // the example in the comment fits the way: a door for a courier, a time to collect, a table
    // пример в комментарии — под способ: дверь для курьера, время забрать, стол
    const comment = field<HTMLTextAreaElement>('comment');
    if (comment) comment.placeholder = COMMENT_EXAMPLE[data.fulfillment];
    // at a table nobody calls: a waiter comes to the table and confirms (owner, 26.10.2026)
    // в зале не звонят: сотрудник подходит к столу и подтверждает (владелец, 26.10.2026)
    const dine = data.fulfillment === 'dine_in';
    const phoneHint = $('[data-phone-hint]', form);
    if (phoneHint) phoneHint.textContent = dine ? 'Номер нужен для заказа, звонить не будем' : 'Перезвоним на него, чтобы подтвердить заказ';
    const whenHint = $('[data-when-hint]', form);
    if (whenHint) whenHint.textContent = dine ? 'Подойдём к столу и подтвердим заказ' : 'Точное время подтвердим при звонке';
    syncFulfillment();
    paintDine();
  };

  const fillTimes = () => {
    const now = new Date();
    const days = field<HTMLSelectElement>('date');
    const times = field<HTMLSelectElement>('time');
    if (!days || !times) return;
    const keepDay = days.value;
    const list = daysFrom(now);
    days.innerHTML = list.map((day) => `<option value="${day.value}">${esc(day.label)}</option>`).join('');
    if (list.some((day) => day.value === keepDay)) days.value = keepDay;
    const keepTime = times.value;
    const slots = slotsFor(days.value, now);
    times.innerHTML = slots.map((slot) => `<option value="${slot}">к ${slot}</option>`).join('');
    if (slots.includes(keepTime)) times.value = keepTime;
  };

  /**
   * Every control that names the venue, after a change from any of them: the
   * switches over the menu, the cart's venue radios, «Готовит: …» and the bar.
   * Всё, что называет точку, — после смены из любого места: переключатели над
   * меню, радио точки в корзине, «Готовит: …» и строка разделов.
   */
  const paintVenue = () => {
    if (!place) return;
    for (const input of $$<HTMLInputElement>('[data-venue-switch] input[type="radio"]')) input.checked = Number(input.value) === place;
    for (const input of $$<HTMLInputElement>('input[name="place"]', form)) input.checked = Number(input.value) === place;
    for (const node of $$('[data-venue-name]')) node.textContent = nameOf(place);
  };

  /** Над меню — «Стол 5: оплатите на сайте, принесём к столу», пока корзина в режиме «В зале». */
  const paintDine = () => {
    const dine = radio('fulfillment') === 'dine_in';
    const table = tableNumber(field('table')?.value);
    for (const note of $$('[data-dine-note]')) {
      note.hidden = !dine || !place;
      const text = $('[data-dine-text]', note);
      if (text) text.textContent = dine ? `${table ? `Стол ${table}` : 'В зале'}: оплатите на сайте, принесём к столу` : '';
    }
  };

  const COMMENT_EXAMPLE: Record<CheckoutForm['fulfillment'], string> = {
    delivery: 'Например: позвоните за 10 минут, оставьте у двери',
    pickup: 'Например: заберу после работы, соберите в один пакет',
    dine_in: 'Например: без лука, сначала салат, потом горячее',
  };

  /** Сколько «В зале» и номер стола живут в черновике: один визит, а не неделя. */
  const DINE_KEEP_MS = 4 * 60 * 60 * 1000;
  const checkFulfillment = (mode: CheckoutForm['fulfillment']) => {
    const input = form.querySelector<HTMLInputElement>(`input[name="fulfillment"][value="${mode}"]`);
    if (input) input.checked = true;
  };

  // the contact part of the form is remembered for the next order on this device
  // контактная часть формы запоминается для следующего заказа на этом устройстве
  const DRAFT_FIELDS = ['name', 'phone', 'email', 'address', 'flat', 'entrance', 'floor', 'intercom'] as const;
  // words of an old draft that fit no field wait in the comment, and in the
  // draft too, until the order leaves or the guest erases them
  // слова старого черновика, не подошедшие ни к одному полю, ждут в комментарии
  // и в черновике, пока заказ не уйдёт или гость их не сотрёт
  let legacyRest = '';
  const saveDraft = () => {
    const data = read();
    if (legacyRest && !(data.comment ?? '').includes(legacyRest)) legacyRest = '';
    store.set(
      CHECKOUT_KEY,
      JSON.stringify({
        name: data.name,
        phone: data.phone,
        // as typed, even while the field is hidden: online payment may come back on
        // как набрана, даже пока поле скрыто: онлайн-оплату могут снова включить
        email: field('email')?.value ?? '',
        address: data.address,
        flat: data.flat,
        entrance: data.entrance,
        floor: data.floor,
        intercom: data.intercom,
        fulfillment: data.fulfillment,
        place: data.place,
        table: data.table,
        // when: a table is good for one visit, not for an order from home next week
        // когда: стол годится на один визит, а не на заказ из дома через неделю
        at: Date.now(),
        ...(legacyRest && { details: legacyRest }),
      }),
    );
  };
  try {
    const draft = JSON.parse(store.get(CHECKOUT_KEY) ?? '{}');
    // a draft from before the separate fields kept «Квартира, подъезд, этаж» in
    // one line: its pieces go to the fields still empty, the words that fit
    // none — to the comment; the draft is rewritten at once in the new shape
    // черновик до отдельных полей хранил «Квартира, подъезд, этаж» одной строкой:
    // её куски уходят в ещё пустые поля, слова, не подошедшие ни к одному, — в
    // комментарий; черновик сразу переписывается в новом виде
    const legacy = typeof draft.details === 'string' && draft.details.trim() ? splitDetails(draft.details) : null;
    if (legacy) for (const key of ['flat', 'entrance', 'floor', 'intercom'] as const) if (!draft[key] && legacy[key]) draft[key] = legacy[key];
    for (const key of DRAFT_FIELDS) {
      const input = field(key);
      if (input && typeof draft[key] === 'string') input.value = draft[key];
    }
    const comment = field<HTMLTextAreaElement>('comment');
    if (legacy?.rest && comment && !comment.value.trim()) {
      comment.value = legacy.rest;
      legacyRest = legacy.rest;
    }
    // «В зале» comes back only within the visit (a reload, a second round of
    // dessert): a week later the same guest orders from home
    // «В зале» возвращается только в пределах визита (обновили страницу,
    // заказали десерт вторым заходом): через неделю тот же гость заказывает из дома
    const fresh = Number(draft.at) > Date.now() - DINE_KEEP_MS;
    const mode = draft.fulfillment === 'dine_in' && !fresh ? 'delivery' : fulfillmentOf(draft.fulfillment);
    if (mode !== 'delivery') checkFulfillment(mode);
    const table = field('table');
    if (table && mode === 'dine_in' && typeof draft.table === 'string') table.value = draft.table;
    // with one venue the radio is the guest's own choice, as before the switch
    // с одной точкой радио — собственный выбор гостя, как до переключателя
    if (!venues.length && draft.place) {
      const radioPlace = form.querySelector<HTMLInputElement>(`input[name="place"][value="${Number(draft.place)}"]`);
      if (radioPlace) radioPlace.checked = true;
    }
    if (legacy) saveDraft();
  } catch {
    /* a broken draft is just no draft / битый черновик — просто без черновика */
  }
  // A QR code on a table: `?place=2&table=5` — the head script already chose
  // the venue, here the cart goes to «В зале» with the table filled in. The
  // address keeps the parameters: a reload lands at the same table.
  // QR-код на столе: `?place=2&table=5` — точку уже выбрал скрипт в `<head>`,
  // здесь корзина переходит в «В зале» с номером стола. Адрес сохраняет
  // параметры: обновление страницы приводит к тому же столу.
  {
    const params = new URLSearchParams(location.search);
    const table = field('table');
    if (params.has('table') && venueById.has(Number(params.get('place')))) {
      checkFulfillment('dine_in');
      if (table) table.value = tableNumber(params.get('table')) ?? '';
      saveDraft();
    }
  }
  paintVenue();
  togglePart();
  cartAccount = mountCartAccount({
    drawer,
    form,
    total: () => priced(cart, index, place).total,
    goto,
    announce,
    onChange: () => paintBill(),
    setAddress: (fields) => applyAddress(fields.address, fields),
    clearAddress: () => applyAddress('', { flat: '', entrance: '', floor: '', intercom: '' }, false),
  });

  const ERROR_FIELD: Record<keyof Errors, string> = {
    name: 'name',
    phone: 'phone',
    email: 'email',
    address: 'address',
    place: 'place',
    time: 'time',
    consent: 'consent',
  };
  let tried = false;
  const showErrors = (errors: Errors) => {
    for (const node of $$('[data-err]', form)) {
      const key = node.dataset.err as keyof Errors;
      const message = errors[key];
      node.hidden = !message;
      node.textContent = message ?? '';
      const target = key === 'place' ? null : field<HTMLElement>(ERROR_FIELD[key]);
      if (target && 'setAttribute' in target) {
        if (message) target.setAttribute('aria-invalid', 'true');
        else target.removeAttribute('aria-invalid');
      }
    }
    // the consent row gets a frame and a nudge while it is the thing missing
    // строка согласия получает рамку и толчок, пока не хватает именно её
    const consentRow = $('[data-consent]', form);
    if (consentRow) {
      const wanted = Boolean(errors.consent);
      if (wanted && !consentRow.classList.contains('is-attention')) {
        consentRow.classList.add('is-attention');
      } else if (!wanted) consentRow.classList.remove('is-attention');
    }
  };

  const phone = field('phone');
  // mask and «+7» on focus: the guest starts typing the number itself
  // маска и «+7» при фокусе — гость сразу набирает сам номер
  if (phone) bindPhoneMask(phone);
  phone?.addEventListener('blur', () => {
    if (phone.value.replace(/\D/g, '') === '7') phone.value = '';
  });

  form.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    // the cart's venue radios are the catalog's switch inside the form
    // радио точки в корзине — это переключатель каталога внутри формы
    if (target.name === 'place' && venues.length) setPlace(Number(target.value));
    if (target.name === 'date') fillTimes();
    if (target.name === 'consent') paintBill();
    togglePart();
    if (tried) showErrors(validate(read()));
    saveDraft();
  });
  form.addEventListener('input', (event) => {
    if ((event.target as HTMLInputElement).name === 'table') paintDine();
    if (tried) showErrors(validate(read()));
  });
  form.addEventListener('focusout', () => saveDraft());

  const offline = $('[data-offline]', drawer);
  const paintOnline = () => {
    if (offline) offline.hidden = navigator.onLine;
  };
  window.addEventListener('online', paintOnline);
  window.addEventListener('offline', paintOnline);
  paintOnline();

  const errorBox = $('[data-error]', form);
  const showFailure = (title: string, text: string) => {
    if (!errorBox) return;
    $('[data-error-title]', errorBox)!.textContent = title;
    $('[data-error-text]', errorBox)!.textContent = text;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'nearest' });
  };

  const submit = $<HTMLButtonElement>('[data-submit]', form)!;
  const submitLabel = $('[data-submit-label]', form)!;
  let busy = false;

  /** Что заказ стоит гостю: блюда, доставка, что сняли баллы и скидка, к оплате. */
  type Bill = { delivery: DeliveryState; dishes: number; discount: number; points: number; cost: number | null; pay: number };
  const billNow = (points: number): Bill => {
    const dishes = dishesTotal();
    const discount = cartAccount?.deductions().discount ?? 0;
    const cost = deliveryCost(delivery, dishes);
    return { delivery, dishes, discount, points, cost, pay: payable({ dishes, discount, points, delivery: cost }) };
  };

  const finish = (number: string, sent: ReturnType<typeof buildOrder>, bill: Bill, from: number | null) => {
    $('[data-done-number]', drawer)!.textContent = number;
    $('[data-done-total]', drawer)!.textContent = rub(bill.pay);
    // under the dishes: the delivery, then what points and the birthday took off — the rows the bill had
    // под блюдами: доставка, затем что сняли баллы и скидка именинника — те же строки, что в счёте
    const row = billRow(bill.delivery, bill.dishes);
    const extras = [
      // at a table there is nothing to deliver or take: no row, as in the bill
      // в зале нечего ни везти, ни забирать: строки нет, как и в счёте
      sent.fulfillment === 'dine_in'
        ? ''
        : `<li class="done__extra"><span>${esc(row.label)}</span><b class="tnum${row.tone === 'quiet' ? ' is-quiet' : ''}">${esc(row.value)}</b></li>`,
      bill.discount ? `<li class="done__extra"><span>Скидка именинника</span><b class="tnum">−${rub(bill.discount)}</b></li>` : '',
      bill.points ? `<li class="done__extra"><span>Баллами</span><b class="tnum">−${rub(bill.points)}</b></li>` : '',
    ];
    $('[data-done-lines]', drawer)!.innerHTML =
      sent.items
        .map((line) => {
          const choice = [line.variant, line.filling].filter(Boolean).join(', ');
          return `<li><span>${esc(line.title)}${choice ? `, ${esc(choice)}` : ''}\u00a0×\u00a0${line.qty}</span><b class="tnum">${rub(line.sum)}</b></li>`;
        })
        .join('') + extras.join('');
    // what happens next: a call to confirm — or, at a table, the dishes come to it
    // что дальше: звонок для подтверждения — или, в зале, блюда несут к столу
    const mode = sent.fulfillment;
    const lead = $('[data-done-lead]', drawer);
    const phoneTag = `<b class="tnum">${esc(sent.phone)}</b>`;
    if (lead)
      lead.innerHTML =
        mode === 'dine_in'
          ? 'Подойдём к столу и подтвердим заказ. Принесём, как будет готово.'
          : `Перезвоним на ${phoneTag}, чтобы подтвердить состав, сумму${mode === 'delivery' ? ', адрес' : ''} и время.`;
    const after = $('[data-done-after]', drawer);
    // paid online — the receipt from ЮKassa follows to the mail (required since
    // 26.10.2026); otherwise payment is settled on the call
    // оплачено онлайн — следом чек ЮKassa на почту (обязательна с 26.10.2026);
    // иначе оплату согласуют при звонке
    if (after)
      after.textContent =
        bill.cost === null
          ? 'Стоимость доставки назовём там же.'
          : paysOnline()
            ? sent.email
              ? `Чек придёт на ${sent.email}.`
              : ''
            : mode === 'dine_in'
              ? ''
              : 'Оплату обсудим там же.';
    // where and when, as they left: the guest checks them before the call, the manager says the same
    // куда и когда — как ушло: гость сверяет до звонка, менеджер назовёт то же
    const where = $('[data-done-where]', drawer);
    if (where) {
      const venue =
        nameOf(sent.place) ||
        form.querySelector<HTMLInputElement>('input[name="place"]:checked')?.closest('.place-opt')?.querySelector('.place-opt__name')?.textContent?.trim() ||
        '';
      // «Куда», not «Доставка»: the bill right under it has its own «Доставка» row
      // «Куда», а не «Доставка»: у счёта прямо под ним своя строка «Доставка»
      $('[data-done-where-label]', drawer)!.textContent = mode === 'pickup' ? 'Откуда' : mode === 'dine_in' ? 'Где' : 'Куда';
      where.textContent = mode === 'pickup' ? venue : mode === 'dine_in' ? tableLine(venue, sent.table) : addressLine(sent);
      $('[data-done-when]', drawer)!.textContent = sent.desired_time;
    }
    // the account gets the order as it left: the points it took, the address it went to
    // кабинет получает заказ, как он ушёл: списанные баллы и адрес, куда он едет
    cartAccount?.done(bill.points, sent);
    // only the cart that left is emptied: the other venue's waits as it was
    // очищается только ушедшая корзина: корзина другой точки ждёт, как была
    store.set(cartKey(from), JSON.stringify(empty()));
    if (from === place) cart = empty();
    const comment = field<HTMLTextAreaElement>('comment');
    if (comment) comment.value = '';
    saveDraft();
    render();
    goto('done');
    announce(
      `Заказ ${number} принят. К оплате ${rub(bill.pay)}. ${sent.fulfillment === 'dine_in' ? 'Подойдём к столу и подтвердим заказ.' : 'Перезвоним для подтверждения.'}`,
    );
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    tried = true;
    if (errorBox) errorBox.hidden = true;
    const data = read();
    const errors = validate(data);
    showErrors(errors);
    const first = (Object.keys(errors) as (keyof Errors)[])[0];
    if (first) {
      const target =
        first === 'place'
          ? form.querySelector<HTMLInputElement>('input[name="place"]')
          : field<HTMLElement>(ERROR_FIELD[first]);
      if (first === 'consent') {
        // the only thing missing is the tick: bring it to the middle of the screen and nudge again
        // не хватает только галочки: вывести её в середину экрана и толкнуть ещё раз
        const row = $('[data-consent]', form);
        row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (row) {
          row.classList.remove('is-attention');
          void row.offsetWidth;
          row.classList.add('is-attention');
        }
        target?.focus({ preventScroll: true });
        return;
      }
      target?.focus();
      return;
    }
    const sum = priced(cart, index, place);
    if (!sum.count || sum.blocked || sum.elsewhere.length) {
      goto('cart');
      return;
    }
    // the cart that leaves: the venue may still be switched while the order is on its way
    // корзина, которая уходит: точку ещё могут переключить, пока заказ в пути
    const from = place;
    // the delivery must be known before the send: a typed address may still be on its way
    // до отправки доставка должна быть известна: набранный адрес может ещё считаться
    if (data.fulfillment === 'delivery') {
      busy = true;
      if (delivery.kind === 'pending' || quoting) {
        submit.setAttribute('aria-busy', 'true');
        submitLabel.textContent = 'Считаем доставку…';
      }
      try {
        await ensureQuote();
      } finally {
        busy = false;
        submit.removeAttribute('aria-busy');
        submitLabel.textContent = 'Отправить заказ';
      }
      if (blocksOrder(delivery, sum.total)) {
        // closed by the zone's minimum: the warning with its ways out is under the address
        // закрыто минимумом зоны: предупреждение с выходами — под адресом
        dlv?.scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' });
        $<HTMLElement>('[data-dlv-act="pickup"]', dlv ?? form)?.focus({ preventScroll: true });
        if (delivery.kind === 'zone') announce(`${minOrderText(sum.total, delivery.quote.zone)}. Добавьте блюд или выберите самовывоз.`);
        return;
      }
    }
    const number = orderNumber(new Date(), Math.random());
    // a signed-in guest sends the order with his token and the points to spend;
    // the payment method rides along as for anyone
    // вошедший гость отправляет заказ со своим токеном и баллами к списанию;
    // способ оплаты едет так же, как у всех
    const extra = cartAccount?.extras();
    const payload = withPayment({ ...buildOrder(cart, index, data, number), ...(extra?.token && { bonus_spent: extra.bonus_spent }) });
    const bill = billNow(extra?.token ? extra.bonus_spent : 0);

    // a bot filled the field nobody sees: thank it and send nothing
    // бот заполнил поле, которого никто не видит: поблагодарить и ничего не отправлять
    if ((field('company')?.value ?? '').trim()) {
      finish(number, payload, bill, from);
      return;
    }
    if (!navigator.onLine) {
      showFailure('Нет интернета', 'Корзина и форма сохранены. Проверьте связь и нажмите «Отправить заказ» ещё раз — или позвоните нам.');
      return;
    }
    if (!endpoint) {
      showFailure('Заказ на сайте сейчас не принимаем', 'Позвоните нам — продиктуйте корзину, и менеджер примет заказ по телефону.');
      return;
    }

    busy = true;
    submit.setAttribute('aria-busy', 'true');
    submitLabel.textContent = 'Отправляем…';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(extra?.token && { Authorization: `Bearer ${extra.token}` }) },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        finish(number, payload, bill, from);
        // online payment asks for the dishes after points and the birthday discount, plus the delivery
        // онлайн-оплата просит блюда после баллов и скидки именинника плюс доставку
        payAfterOrder(number, payload, { total: bill.pay, delivery: bill.delivery.kind === 'pickup' ? undefined : bill.cost });
        return;
      }
      // the server speaks Russian for what the guest can fix (order-guard)
      // сервер отвечает по-русски, если гость может это исправить (order-guard)
      const body = await response.json().catch(() => null);
      const reason: string | undefined = body?.errors?.[0]?.extensions?.reason ?? (response.status === 400 ? body?.errors?.[0]?.message : undefined);
      if (response.status === 401 && extra?.token) {
        cartAccount?.signedOut();
        showFailure('Вход в кабинет закончился', 'Нажмите «Отправить заказ» ещё раз — уйдёт без баллов. Или войдите снова, чтобы их списать.');
      } else if (response.status === 403)
        showFailure('Заказ на сайте сейчас не принимаем', 'Позвоните нам — продиктуйте корзину, и менеджер примет заказ по телефону.');
      else if (reason) showFailure('Проверьте заказ', reason);
      else showFailure('Заказ не отправился', 'Сервер не ответил как надо. Попробуйте ещё раз через минуту или позвоните — примем по телефону.');
    } catch (error) {
      const timeout = (error as Error)?.name === 'TimeoutError';
      showFailure(
        timeout ? 'Сервер долго не отвечает' : 'Не получилось связаться с сервером',
        'Корзина сохранена. Проверьте интернет и нажмите «Отправить заказ» ещё раз — или позвоните нам.',
      );
    } finally {
      busy = false;
      submit.removeAttribute('aria-busy');
      submitLabel.textContent = 'Отправить заказ';
    }
  });

  // ── clicks ──────────────────────────────────────────────────────────────

  document.addEventListener('click', (event) => {
    const target = event.target as Element;
    const hit = <T extends HTMLElement = HTMLElement>(selector: string) => target.closest<T>(selector);

    const addBtn = hit('[data-add]');
    if (addBtn) {
      const id = Number(addBtn.dataset.add);
      const dish = dishes.get(id);
      if (!dish?.available) return;
      commit(add(cart, id), `Добавлено: ${dish.title}. ${summary()}`);
      // the button just hid itself: the focus goes to «+» of the counter in its place
      // кнопка только что спряталась — фокус переходит на «+» счётчика на её месте
      if (addBtn.closest('[data-ctl]')) $<HTMLButtonElement>(`[data-ctl="${id}"] [data-inc]`)?.focus();
      return;
    }
    const inc = hit('[data-inc]');
    if (inc) {
      const id = Number(inc.dataset.inc);
      commit(add(cart, id), summary());
      return;
    }
    const dec = hit('[data-dec]');
    if (dec) {
      const id = Number(dec.dataset.dec);
      const left = qtyOf(cart, id, null) - 1;
      commit(setQty(cart, id, null, left), left ? summary() : `${dishes.get(id)?.title ?? 'Блюдо'} убрано из корзины`);
      if (!left) $<HTMLButtonElement>(`[data-ctl="${id}"] [data-add]`)?.focus();
      return;
    }

    const open = hit<HTMLAnchorElement>('[data-open-dish]');
    if (open) {
      event.preventDefault();
      openDish(Number(open.dataset.openDish));
      return;
    }
    const cartOpen = hit('[data-cart-open]');
    if (cartOpen) {
      event.preventDefault();
      openCart();
      return;
    }

    // inside the dish window
    if (hit('[data-dlg-inc]')) {
      dlgQty = Math.min(MAX_QTY, dlgQty + 1);
      paintDialog();
      return;
    }
    if (hit('[data-dlg-dec]')) {
      dlgQty = Math.max(1, dlgQty - 1);
      paintDialog();
      return;
    }
    if (hit('[data-dlg-add]') && current) {
      const dish = current;
      if (dish.fillings.length && !dlgFilling) {
        // the message sits under the «Начинка» heading; on a phone the list is
        // often below the fold, so the sheet scrolls to it
        // сообщение стоит под заголовком «Начинка»; на телефоне список часто ниже
        // края, поэтому лист прокручивается к нему
        $('[data-fill-err]', dishDialog)!.hidden = false;
        $<HTMLInputElement>('input[name="filling"]', dishDialog)?.focus({ preventScroll: true });
        $('[data-fillings]', dishDialog)!.scrollIntoView({
          block: 'nearest',
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
        return;
      }
      const choice = [dlgVariant, dlgFilling].filter(Boolean).join(', ');
      commit(add(cart, dish.id, dlgVariant, dlgQty, dlgFilling), `Добавлено: ${dish.title}${choice ? `, ${choice}` : ''} — ${dlgQty} шт. ${summary()}`);
      dishDialog.close();
      return;
    }

    // the venue, from the dish window, the cart's notice and «Готовит: … · Поменять»
    // точка — из окна блюда, плашки корзины и «Готовит: … · Поменять»
    const goVenue = hit('[data-away-go]');
    if (goVenue) {
      setPlace(Number(goVenue.dataset.awayGo));
      // the button is gone with the notice: the focus goes to what it opened — the buy row
      // кнопка ушла вместе с плашкой: фокус — туда, что она открыла, на строку покупки
      $<HTMLButtonElement>('[data-dlg-add]', dishDialog)?.focus();
      return;
    }
    // «Перейти» to the other venue's cart: under the switch or in the empty drawer
    // «Перейти» к корзине другой точки: под переключателем или в пустой корзине
    const goCart = hit<HTMLButtonElement>('[data-venue-go]');
    if (goCart) {
      setPlace(Number(goCart.dataset.venueGo));
      // the line may be gone with the cart it offered: the focus stays with the switch or the drawer
      // строка могла уйти вместе с корзиной, которую предлагала: фокус остаётся у переключателя или корзины
      if (!goCart.offsetParent)
        (drawer.contains(goCart) ? $('[data-drawer-title]', drawer) : $<HTMLInputElement>('input:checked', goCart.closest('[data-venue-switch]') ?? document))?.focus();
      return;
    }
    const swap = hit('[data-venue-swap]');
    if (swap) {
      setPlace(Number(swap.dataset.venueGo));
      return;
    }
    if (hit('[data-away-drop]')) {
      const away = priced(cart, index, place).elsewhere;
      let next = cart;
      for (const line of away) next = setQty(next, line.id, line.variant, 0, line.filling);
      commit(next, `Убрали: ${away.map((line) => line.title).join(', ')}. ${summary()}`);
      $('[data-drawer-title]', drawer)?.focus();
      return;
    }
    if (hit('[data-to-cart]')) {
      goto('cart');
      return;
    }

    // inside the drawer
    const lineInc = hit('[data-line-inc]');
    if (lineInc) {
      const { id, variant, filling } = keyParts(lineInc.dataset.lineInc!);
      commit(add(cart, id, variant, 1, filling), summary());
      return;
    }
    const lineDec = hit('[data-line-dec]');
    if (lineDec) {
      const { id, variant, filling } = keyParts(lineDec.dataset.lineDec!);
      commit(setQty(cart, id, variant, qtyOf(cart, id, variant, filling) - 1, filling), summary());
      if (!cart.lines.length) $('[data-drawer-title]', drawer)?.focus();
      return;
    }
    const lineRemove = hit('[data-line-remove]');
    if (lineRemove) {
      const { id, variant, filling } = keyParts(lineRemove.dataset.lineRemove!);
      commit(setQty(cart, id, variant, 0, filling), `${dishes.get(id)?.title ?? 'Блюдо'} убрано. ${summary()}`);
      $('[data-drawer-title]', drawer)?.focus();
      return;
    }
    if (hit('[data-clear]')) {
      undo = cart;
      commit(empty(), 'Корзина очищена');
      $('[data-undo]', drawer)?.focus();
      return;
    }
    if (hit('[data-undo]') && undo) {
      const back = undo;
      undo = null;
      commit(back, `Корзина возвращена. ${summary()}`);
      $('[data-drawer-title]', drawer)?.focus();
      return;
    }
    if (hit('[data-to-checkout]')) {
      goto('checkout');
      return;
    }
    if (hit('[data-back]')) {
      goto(step === 'login' ? 'checkout' : 'cart');
      return;
    }
    const close = hit('[data-close]');
    if (close) {
      close.closest('dialog')?.close();
      return;
    }
  });

  // a click on the backdrop targets the dialog itself: the content sits on a wrapper
  // клик по подложке приходит в сам `<dialog>`: содержимое лежит на обёртке
  for (const dialog of [dishDialog, drawer])
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });

  // Another tab changed this venue's cart: it is taken as is. The other
  // venue's cart (or the old shared one being moved) only changes the line
  // that offers it.
  // Корзину этой точки поменяли в другой вкладке: она берётся как есть.
  // Корзина другой точки (или переезд старой общей) меняет только строку,
  // которая её предлагает.
  window.addEventListener('storage', (event) => {
    if (event.key === cartKey(place)) {
      cart = reconcile(parseCart(event.newValue), index).cart;
      render();
      if (current) paintDialog();
    } else if (event.key === null || isCartKey(event.key)) paintOther();
  });

  // ── sections: the desktop column, the sticky bar, the sheet, «наверх» ───
  // The observer watches the reading line — a 1 % band a third of the way
  // down the screen — and says when something crossed it; which section is
  // current is then measured, not taken from the entries: a jump (a click in
  // the column, «наверх», the End key) skips sections, and a fast scroll
  // delivers several entries at once in no useful order. Current = the last
  // section whose top has passed the line; above the first one it is the
  // first, below the last one (the help strip, the footer) the last.
  // Наблюдатель смотрит на линию чтения — полосу в 1 % на трети высоты экрана —
  // и сообщает, что её что-то пересекло; какой раздел текущий, потом меряется,
  // а не берётся из записей: прыжок (клик в колонке, «наверх», End) пропускает
  // разделы, а быстрая прокрутка приносит несколько записей разом и в
  // бесполезном порядке. Текущий — последний раздел, чей верх прошёл линию;
  // выше первого — первый, ниже последнего (полоса помощи, подвал) — последний.
  const sections = $$('[data-sec]');
  const titles = new Map(sections.map((section) => [section.dataset.sec!, $('h2', section)?.textContent?.trim() ?? '']));
  const marks = new Map<string, HTMLAnchorElement[]>();
  for (const link of $$<HTMLAnchorElement>('[data-nav], [data-sheet-link]')) {
    const slug = link.dataset.nav ?? link.dataset.sheetLink!;
    marks.set(slug, [...(marks.get(slug) ?? []), link]);
  }
  const bar = $('[data-secbar]');
  const barName = $('[data-secbar-name]');
  const barButton = $('[data-sheet-open]');
  const sheet = $<HTMLDialogElement>('[data-sheet]');
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  let active = '';
  const mark = (slug: string) => {
    if (!slug || slug === active) return;
    active = slug;
    for (const [key, links] of marks)
      for (const link of links) {
        if (key === slug) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    const title = titles.get(slug) ?? '';
    if (barName) barName.textContent = title;
    labelBar();
  };
  const labelBar = () =>
    barButton?.setAttribute('aria-label', `Все разделы. Сейчас: ${titles.get(active) ?? ''}${place ? `. Меню: ${nameOf(place)}` : ''}`);
  // sections of the other venue are hidden (no boxes): they are never current
  // разделы другой точки спрятаны (без коробок): текущими они не бывают
  const shown = () => sections.filter((section) => section.getClientRects().length > 0);
  mark(shown()[0]?.dataset.sec ?? sections[0]?.dataset.sec ?? '');

  /** Текущий раздел по линии чтения на трети экрана: последний видимый, чей верх её прошёл. */
  const measure = () => {
    const line = window.innerHeight * 0.33;
    const visible = shown();
    let slug = visible[0]?.dataset.sec ?? '';
    for (const section of visible) {
      if (section.getBoundingClientRect().top <= line) slug = section.dataset.sec!;
      else break;
    }
    mark(slug);
  };

  // the page script runs where IntersectionObserver exists; without it the
  // column, the tiles and the sheet still work as plain anchors
  // скрипт работает там, где есть IntersectionObserver; без него колонка,
  // плитки и лист всё равно работают как обычные якоря
  if ('IntersectionObserver' in window) {
    const reading = new IntersectionObserver(measure, { rootMargin: '-33% 0px -66% 0px' });
    for (const section of sections) reading.observe(section);
    // what follows the last section crosses the line too: a jump to the very
    // bottom lands there, past every section
    // то, что идёт за последним разделом, тоже пересекает линию: прыжок в самый
    // низ попадает туда, мимо всех разделов
    const after = sections.at(-1)?.closest('.cat-layout')?.nextElementSibling;
    if (after) reading.observe(after);
    // A jump from a place where nothing crosses the line to another such place
    // (Home, End, the top from the footer) gives the observer nothing to report:
    // the end of a scroll is measured too, once a frame at most.
    // Прыжок из места, где линию ничто не пересекает, в другое такое же (Home,
    // End, наверх из подвала) не даёт наблюдателю ни одной записи: конец
    // прокрутки тоже меряется, не чаще раза за кадр.
    let measuring = 0;
    window.addEventListener(
      'scroll',
      () => {
        if (!measuring) measuring = requestAnimationFrame(() => ((measuring = 0), measure()));
      },
      { passive: true },
    );

    // The bar comes out once the tiles have gone under the header and goes
    // back once the last section has: over the help strip and the footer a
    // section name says nothing.
    // Строка выезжает, когда плитки ушли под шапку, и уезжает, когда под шапку
    // ушёл последний раздел: над полосой помощи и подвалом имя раздела ни о чём
    // не говорит.
    const tiles = $('[data-tiles]');
    const layout = sections[0]?.closest<HTMLElement>('.cat-layout');
    const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 68;
    if (bar && tiles && layout) {
      let tilesGone = false;
      let sectionsGone = false;
      const above = (entry: IntersectionObserverEntry) =>
        !entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0) + 1;
      const toggle = () => bar.toggleAttribute('data-on', tilesGone && !sectionsGone);
      new IntersectionObserver(
        ([entry]) => {
          tilesGone = above(entry);
          toggle();
        },
        { rootMargin: `-${Math.round(header)}px 0px 0px 0px` },
      ).observe(tiles);
      new IntersectionObserver(
        ([entry]) => {
          sectionsGone = above(entry);
          toggle();
        },
        { rootMargin: `-${Math.round(header + 52)}px 0px 0px 0px` },
      ).observe(layout);
    }

    // The column's copy of the venue switch opens once the head switch has gone
    // over the top (under the header), and closes when it comes back: never two
    // switches in view.
    // Копия переключателя в колонке раскрывается, когда шапочный ушёл за верх
    // (под шапку сайта), и закрывается, когда он вернулся: двух переключателей в
    // поле зрения не бывает.
    const headSwitch = $('.pswitch--head');
    const sideVenue = $('[data-side-venue]');
    if (headSwitch && sideVenue)
      new IntersectionObserver(
        ([entry]) => sideVenue.toggleAttribute('data-on', !entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0) + 1),
        { rootMargin: `-${Math.round(header)}px 0px 0px 0px` },
      ).observe(headSwitch);

    // «наверх» — once the first screen is gone: the mark is the first screen's
    // height, so leaving it is one crossing however far the jump
    // «наверх» — когда первый экран ушёл: метка высотой в первый экран, и уход
    // с неё — одно пересечение, как бы далеко ни был прыжок
    const totop = $('[data-totop]');
    const firstScreen = $('[data-totop-mark]');
    if (totop && firstScreen)
      new IntersectionObserver(([entry]) => totop.toggleAttribute('data-on', !entry.isIntersecting)).observe(firstScreen);
  }

  // ── the venue changes / точка меняется ──
  // Sections above the eye may vanish or come back: the eye keeps its place.
  // The current section stays where it was on the screen; when the new venue
  // does not have it, the next section it has comes under the header. Above
  // the menu (the head, the tiles) nothing moves under the eye, nothing to keep.
  // Разделы выше взгляда могут исчезнуть или вернуться — взгляд остаётся на
  // месте. Текущий раздел стоит, где стоял на экране; если у новой точки его
  // нет, под шапку встаёт следующий раздел, который у неё есть. Выше меню
  // (шапка, плитки) под взглядом ничего не двигается — держать нечего.
  const anchorFor = (next: number) => {
    const layout = sections[0]?.closest<HTMLElement>('.cat-layout');
    if (!layout || layout.getBoundingClientRect().top > window.innerHeight * 0.33) return null;
    const now = sections.find((section) => section.dataset.sec === active);
    const from = now ? sections.indexOf(now) : 0;
    const stays = Boolean(now && shownAt(now, next));
    const node = stays
      ? now!
      : (sections.slice(from).find((section) => shownAt(section, next)) ?? [...sections].reverse().find((section) => shownAt(section, next)));
    return node ? { node, top: stays ? node.getBoundingClientRect().top : null } : null;
  };

  /**
   * Show another venue's menu: the page, the cart, the dish window and every
   * control that names the venue follow; the choice is remembered for the
   * next visit and a `?place=` in the address follows too.
   * Показать меню другой точки: страница, корзина, окно блюда и всё, что
   * называет точку, идут следом; выбор запоминается до следующего визита, а
   * `?place=` в адресе тоже меняется.
   */
  function setPlace(next: number, { say = true, keep = true } = {}) {
    if (!venueById.has(next)) return;
    if (next === place) {
      paintVenue();
      return;
    }
    const anchor = keep ? anchorFor(next) : null;
    // the browser's own scroll anchoring would move the page a second time
    // собственная привязка прокрутки браузера сдвинула бы страницу второй раз
    if (anchor) root.style.overflowAnchor = 'none';
    place = next;
    root.dataset.venue = String(next);
    store.set(PLACE_KEY, String(next));
    // the venue's own cart: «Вернуть» and «убрали из корзины» belonged to the one left behind
    // своя корзина точки: «Вернуть» и «убрали из корзины» относились к оставленной
    const restored = loadCart(next);
    cart = restored.cart;
    undo = null;
    dropped = restored.dropped;
    const url = new URL(location.href);
    if (url.searchParams.has('place')) {
      url.searchParams.set('place', String(next));
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
    paintVenue();
    // the new cart is painted before the eye is put back: the line about the
    // other cart over the menu appears or goes, and that height is above the eye
    // новая корзина рисуется до того, как взгляд вернут на место: строка о другой
    // корзине над меню появляется или уходит, и эта высота — выше взгляда
    render();
    if (anchor) {
      if (anchor.top === null) anchor.node.scrollIntoView({ block: 'start' });
      else window.scrollBy(0, anchor.node.getBoundingClientRect().top - anchor.top);
      requestAnimationFrame(() => root.style.removeProperty('overflow-anchor'));
    }
    saveDraft();
    if (current) paintDialog();
    // in the checkout the new venue's cart may be empty: back to the cart,
    // where the empty one offers the cart just left
    // в оформлении корзина новой точки может оказаться пустой: назад к корзине,
    // где пустая предложит только что оставленную
    if (drawer?.open && step === 'checkout' && !cart.lines.length) goto('cart');
    measure();
    labelBar();
    if (!say) return;
    const venue = venueById.get(next)!;
    announce(`Меню: ${venue.name}, ${positions(venue.dishes)}. ${summary()}.`);
  }

  // the switches over the menu (head, column, sheet) are one choice
  // переключатели над меню (шапка, колонка, лист) — один выбор
  document.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.closest('[data-venue-switch]')) setPlace(Number(input.value));
  });

  // A jump to a section lands its heading right under the header (and the
  // bar), puts the focus there for a keyboard or a screen reader, and keeps
  // the address shareable without a history entry per tap.
  // Переход к разделу ставит его заголовок сразу под шапку (и строку),
  // переносит туда фокус для клавиатуры и скринридера и оставляет адрес, которым
  // можно поделиться, не плодя запись в истории на каждое касание.
  const jumpTo = (slug: string) => {
    const section = sections.find((item) => item.dataset.sec === slug);
    if (!section) return;
    mark(slug);
    section.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'start' });
    $<HTMLElement>('h2', section)?.focus({ preventScroll: true });
    history.replaceState(history.state, '', `#${slug}`);
    announce(`Раздел «${titles.get(slug)}»`);
  };

  document.addEventListener('click', (event) => {
    const target = event.target as Element;
    const link = target.closest<HTMLAnchorElement>('[data-tile], [data-nav], [data-sheet-link]');
    if (link) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      const slug = link.dataset.tile ?? link.dataset.nav ?? link.dataset.sheetLink!;
      if (sheet?.open) sheet.close();
      jumpTo(slug);
      return;
    }
    if (target.closest('[data-sheet-open]') && sheet) {
      sheet.showModal();
      // the current section is where the eye and the focus start
      // текущий раздел — там, откуда начинают взгляд и фокус
      const current = $<HTMLAnchorElement>('[data-sheet-link][aria-current="true"]', sheet);
      current?.scrollIntoView({ block: 'center' });
      current?.focus({ preventScroll: true });
      return;
    }
    if (target.closest('[data-totop]')) {
      window.scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' });
      // back at the top the address no longer points into a section
      // наверху адрес больше не указывает в раздел
      history.replaceState(history.state, '', location.pathname + location.search);
      $<HTMLElement>('#cat-title')?.focus({ preventScroll: true });
    }
  });
  sheet?.addEventListener('click', (event) => {
    if (event.target === sheet) sheet.close();
  });

  // ── first paint and deep links ──────────────────────────────────────────
  render();
  labelBar();
  const hash = decodeURIComponent(location.hash);
  if (hash.startsWith('#p-')) {
    const dish = bySlug.get(hash.slice(3));
    if (dish) openDish(dish.id, false);
  } else if (hash === '#cart') openCart();
  else if (hash.length > 1) {
    // A link to a section the chosen venue does not have (the landing's
    // «Салаты» while the menu is Садовая's): the guest came for that section,
    // so the venue that has it opens, and the page lands on it.
    // Ссылка на раздел, которого у выбранной точки нет («Салаты» с главной, а
    // меню — Садовой): гость пришёл за этим разделом, поэтому открывается
    // точка, где он есть, и страница встаёт на него.
    const section = sections.find((item) => item.dataset.sec === hash.slice(1));
    const there = section && !shownAt(section, place) ? section.dataset.places?.split(' ').map(Number).find((id) => venueById.has(id)) : undefined;
    if (section && there) {
      setPlace(there, { keep: false });
      mark(section.dataset.sec!);
      section.scrollIntoView({ block: 'start' });
    }
  }
  window.addEventListener('hashchange', () => {
    const next = decodeURIComponent(location.hash);
    if (next.startsWith('#p-')) {
      const dish = bySlug.get(next.slice(3));
      if (dish) openDish(dish.id, false);
    } else if (next === '#cart') openCart();
  });
}
