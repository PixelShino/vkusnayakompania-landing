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
 */
import {
  CART_KEY,
  MAX_QTY,
  add,
  empty,
  keyParts,
  parseCart,
  priced,
  qtyOf,
  qtyOfProduct,
  reconcile,
  setQty,
  type Cart,
  type CartIndex,
  type CartProduct,
} from '../lib/cart';
import {
  CHECKOUT_KEY,
  buildOrder,
  daysFrom,
  bindPhoneMask,
  orderNumber,
  slotsFor,
  validate,
  type CheckoutForm,
  type Errors,
} from '../lib/order';
import { BADGE_LABEL, positions, rub, type Badge } from '../lib/catalog';
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
import { payAfterOrder, withPayment } from './payment';
import minusIcon from '../assets/icons/minus.svg?raw';
import plusIcon from '../assets/icons/plus.svg?raw';
import trashIcon from '../assets/icons/trash.svg?raw';
import clocheIcon from '../assets/icons/cloche.svg?raw';
import pinIcon from '../assets/icons/pin.svg?raw';

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
// with a cart that lives until the tab is closed, and says nothing scary.
// Хранилище может быть закрыто (приватный режим, запрет данных сайта): тогда
// страница работает с корзиной до закрытия вкладки и ничем не пугает.
const store = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* no storage — the cart lives in memory / без хранилища корзина живёт в памяти */
    }
  },
};

const dataNode = document.getElementById('catalog-data');
const drawer = document.getElementById('cart') as HTMLDialogElement | null;
const dishDialog = document.getElementById('dish') as HTMLDialogElement | null;

if (dataNode && drawer && dishDialog) {
  const { products } = JSON.parse(dataNode.textContent || '{}') as { products: Dish[] };
  const dishes = new Map(products.map((dish) => [dish.id, dish]));
  const index: CartIndex = dishes;
  const bySlug = new Map(products.map((dish) => [dish.slug, dish]));

  const restored = reconcile(parseCart(store.get(CART_KEY)), index);
  let cart: Cart = restored.cart;
  let undo: Cart | null = null;
  let dropped = restored.dropped;
  if (dropped.length) store.set(CART_KEY, JSON.stringify(cart));

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
    const sum = priced(cart, index);
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
    const label = sum.count ? `${positions(sum.count)} на ${rub(sum.total)}` : 'пусто';
    for (const node of $$('[data-cart-count]')) {
      node.textContent = String(sum.count);
      node.hidden = sum.count === 0;
      if (changed) bump(node);
    }
    for (const node of $$('[data-cart-sum]')) node.textContent = sum.count ? rub(sum.total) : '';
    for (const node of $$('.header__cart, .header__cart-btn')) node.setAttribute('aria-label', `Корзина: ${label}`);
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
      $('[data-cart-open]', bar)?.setAttribute('aria-label', `Открыть корзину: ${label}`);
    }

    for (const node of $$('[data-count]', drawer)) node.textContent = sum.count ? `· ${positions(sum.count)}` : '';
    for (const node of $$('[data-total]', drawer)) node.textContent = rub(sum.total);
    renderLines(sum);
    // the delivery depends on the dishes (free from, the zone's minimum), the bill on both
    // доставка зависит от блюд (бесплатно от, минимум зоны), счёт — от того и другого
    paintDelivery();
    paintBill();
    cartAccount?.refresh();
  };

  const renderLines = (sum = priced(cart, index)) => {
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
        return `<li class="line${line.available ? '' : ' line--out'}">
          <div class="line__img">${thumb(line.id)}</div>
          <p class="line__title">${esc(line.title)}</p>
          <p class="line__sum tnum">${rub(line.sum)}</p>
          ${meta ? `<p class="line__meta tnum">${esc(meta)}</p>` : ''}
          ${line.available ? '' : '<p class="line__flag">Закончилось — уберите из заказа</p>'}
          <div class="line__ctl">
            <div class="qty qty--sm" role="group" aria-label="Количество: ${esc(line.title)}">
              <button type="button" class="qty__btn" data-line-dec="${key}" aria-label="Убрать одну">${icon(minusIcon)}</button>
              <output class="qty__n tnum">${line.qty}</output>
              <button type="button" class="qty__btn" data-line-inc="${key}" aria-label="Добавить ещё"${line.qty >= MAX_QTY || !line.available ? ' disabled' : ''}>${icon(plusIcon)}</button>
            </div>
            <button type="button" class="round-btn line__remove" data-line-remove="${key}" aria-label="Убрать из корзины: ${esc(line.title)}">${icon(trashIcon)}</button>
          </div>
        </li>`;
      })
      .join('');
    const isEmpty = sum.lines.length === 0;
    emptyBox.hidden = !isEmpty;
    foot.hidden = isEmpty;
    const blocked = $('[data-blocked]', drawer);
    if (blocked) blocked.hidden = !sum.blocked;
    const toCheckout = $<HTMLButtonElement>('[data-to-checkout]', drawer);
    if (toCheckout) toCheckout.disabled = sum.blocked || sum.count === 0;

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
        .filter((dish) => dish.available && !dish.variants.length && !dish.fillings.length && dish.badges.includes('hit'))
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

  const commit = (next: Cart, message?: string) => {
    cart = next;
    store.set(CART_KEY, JSON.stringify(cart));
    render();
    if (message) announce(message);
  };

  const summary = () => {
    const sum = priced(cart, index);
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

    $('[data-out]', dishDialog)!.hidden = dish.available;
    $('[data-buy]', dishDialog)!.hidden = !dish.available;
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

  const read = (): CheckoutForm => ({
    name: field('name')?.value ?? '',
    phone: field('phone')?.value ?? '',
    fulfillment: radio('fulfillment') === 'pickup' ? 'pickup' : 'delivery',
    place: Number(radio('place')) || null,
    address: field('address')?.value ?? '',
    details: field('details')?.value ?? '',
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
  const dishesTotal = () => priced(cart, index).total;

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
    if (blocked) button?.setAttribute('aria-disabled', 'true');
    else button?.removeAttribute('aria-disabled');
    const note = $('[data-bill-note]', form);
    if (note) {
      note.hidden = !blocked;
      note.textContent = blocked ? shortText(shortOfMin(delivery, dishes)) : '';
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

  /** Доставка ↔ самовывоз: у самовывоза доставки нет, при возврате — снова расчёт адреса. */
  const syncFulfillment = () => {
    if (radio('fulfillment') === 'pickup') {
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
  const HINT = 'Подскажем дом и посчитаем доставку';

  const suggest = async (query: string) => {
    if (!addressInput) return;
    const key = normalizeAddress(query);
    const cached = suggested.get(key);
    const apply = (items: Suggestion[]) => {
      if (addressInput.value !== query || document.activeElement !== addressInput) return;
      openList(items);
      // only houses are offered: a street without a number gets a nudge, not silence
      // предлагаются только дома: улица без номера получает подсказку, а не тишину
      showHint(!items.length && !hasHouse(query) ? 'Допишите номер дома — подскажем адрес' : HINT);
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

  const pick = (i: number) => {
    const item = options[i];
    if (!item || !addressInput) return;
    const value = addressOf(item);
    addressInput.value = value;
    window.clearTimeout(quoteTimer);
    window.clearTimeout(suggestTimer);
    suggestCtl?.abort();
    closeList();
    saveDraft();
    if (tried) showErrors(validate(read()));
    void quote(value, true);
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
      showHint(HINT);
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
      const key = part.dataset.for;
      part.hidden = key === 'later' ? data.when !== 'later' : key !== data.fulfillment;
    }
    syncFulfillment();
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

  // the contact part of the form is remembered for the next order on this device
  // контактная часть формы запоминается для следующего заказа на этом устройстве
  const DRAFT_FIELDS = ['name', 'phone', 'address', 'details'] as const;
  const saveDraft = () => {
    const data = read();
    store.set(
      CHECKOUT_KEY,
      JSON.stringify({ name: data.name, phone: data.phone, address: data.address, details: data.details, fulfillment: data.fulfillment, place: data.place }),
    );
  };
  try {
    const draft = JSON.parse(store.get(CHECKOUT_KEY) ?? '{}');
    for (const key of DRAFT_FIELDS) {
      const input = field(key);
      if (input && typeof draft[key] === 'string') input.value = draft[key];
    }
    if (draft.fulfillment === 'pickup') {
      const pickup = form.querySelector<HTMLInputElement>('input[name="fulfillment"][value="pickup"]');
      if (pickup) pickup.checked = true;
    }
    if (draft.place) {
      const place = form.querySelector<HTMLInputElement>(`input[name="place"][value="${Number(draft.place)}"]`);
      if (place) place.checked = true;
    }
  } catch {
    /* a broken draft is just no draft / битый черновик — просто без черновика */
  }
  togglePart();
  cartAccount = mountCartAccount({ drawer, form, total: () => priced(cart, index).total, goto, announce, onChange: () => paintBill() });

  const ERROR_FIELD: Record<keyof Errors, string> = {
    name: 'name',
    phone: 'phone',
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
    if (target.name === 'date') fillTimes();
    togglePart();
    if (tried) showErrors(validate(read()));
    saveDraft();
  });
  form.addEventListener('input', () => {
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

  const finish = (number: string, sent: ReturnType<typeof buildOrder>, bill: Bill) => {
    $('[data-done-number]', drawer)!.textContent = number;
    $('[data-done-phone]', drawer)!.textContent = sent.phone;
    $('[data-done-total]', drawer)!.textContent = rub(bill.pay);
    // under the dishes: the delivery, then what points and the birthday took off — the rows the bill had
    // под блюдами: доставка, затем что сняли баллы и скидка именинника — те же строки, что в счёте
    const row = billRow(bill.delivery, bill.dishes);
    const extras = [
      `<li class="done__extra"><span>${esc(row.label)}</span><b class="tnum${row.tone === 'quiet' ? ' is-quiet' : ''}">${esc(row.value)}</b></li>`,
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
    const after = $('[data-done-after]', drawer);
    if (after) after.textContent = bill.cost === null ? 'Стоимость доставки назовём там же.' : 'Оплату обсудим там же.';
    cartAccount?.done(bill.points);
    cart = empty();
    store.set(CART_KEY, JSON.stringify(cart));
    const comment = field<HTMLTextAreaElement>('comment');
    if (comment) comment.value = '';
    saveDraft();
    render();
    goto('done');
    announce(`Заказ ${number} принят. К оплате ${rub(bill.pay)}. Перезвоним для подтверждения.`);
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
      target?.focus();
      return;
    }
    const sum = priced(cart, index);
    if (!sum.count || sum.blocked) {
      goto('cart');
      return;
    }
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
      finish(number, payload, bill);
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
        finish(number, payload, bill);
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

  // another tab changed the cart / корзину поменяли в другой вкладке
  window.addEventListener('storage', (event) => {
    if (event.key !== CART_KEY) return;
    cart = reconcile(parseCart(event.newValue), index).cart;
    render();
    if (current) paintDialog();
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
    barButton?.setAttribute('aria-label', `Все разделы. Сейчас: ${title}`);
  };
  mark(sections[0]?.dataset.sec ?? '');

  // the page script runs where IntersectionObserver exists; without it the
  // column, the tiles and the sheet still work as plain anchors
  // скрипт работает там, где есть IntersectionObserver; без него колонка,
  // плитки и лист всё равно работают как обычные якоря
  if ('IntersectionObserver' in window) {
    const measure = () => {
      const line = window.innerHeight * 0.33;
      let slug = sections[0]?.dataset.sec ?? '';
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) slug = section.dataset.sec!;
        else break;
      }
      mark(slug);
    };
    const reading = new IntersectionObserver(measure, { rootMargin: '-33% 0px -66% 0px' });
    for (const section of sections) reading.observe(section);
    // what follows the last section crosses the line too: a jump to the very
    // bottom lands there, past every section
    // то, что идёт за последним разделом, тоже пересекает линию: прыжок в самый
    // низ попадает туда, мимо всех разделов
    const after = sections.at(-1)?.closest('.cat-layout')?.nextElementSibling;
    if (after) reading.observe(after);

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

    // «наверх» — once the first screen is gone: the mark is the first screen's
    // height, so leaving it is one crossing however far the jump
    // «наверх» — когда первый экран ушёл: метка высотой в первый экран, и уход
    // с неё — одно пересечение, как бы далеко ни был прыжок
    const totop = $('[data-totop]');
    const firstScreen = $('[data-totop-mark]');
    if (totop && firstScreen)
      new IntersectionObserver(([entry]) => totop.toggleAttribute('data-on', !entry.isIntersecting)).observe(firstScreen);
  }

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
  const hash = decodeURIComponent(location.hash);
  if (hash.startsWith('#p-')) {
    const dish = bySlug.get(hash.slice(3));
    if (dish) openDish(dish.id, false);
  } else if (hash === '#cart') openCart();
  window.addEventListener('hashchange', () => {
    const next = decodeURIComponent(location.hash);
    if (next.startsWith('#p-')) {
      const dish = bySlug.get(next.slice(3));
      if (dish) openDish(dish.id, false);
    } else if (next === '#cart') openCart();
  });
}
