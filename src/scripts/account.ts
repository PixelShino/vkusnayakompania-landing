/**
 * The account page wakes up: with no session it shows the sign-in; with one
 * it asks `GET /guest-auth/me` once and draws the band (balance, tier,
 * spending), the guest's offers, the orders, the points and the profile.
 * A session that has ended goes back to the sign-in and says so; no
 * connection — a view with «try again» and the phone. Tabs follow WAI-ARIA
 * and the address (`#orders`, `#points`, `#profile`).
 * Страница кабинета оживает: без сессии показывает вход; с сессией один раз
 * спрашивает `GET /guest-auth/me` и рисует полосу (баланс, уровень, траты),
 * акции гостя, заказы, баллы и профиль. Закончившаяся сессия возвращает ко
 * входу и говорит об этом; нет связи — вид с «Попробовать ещё раз» и
 * телефоном. Вкладки — по WAI-ARIA и по адресу (`#orders`, `#points`,
 * `#profile`).
 */
import {
  ApiError,
  ORDER_STATUS,
  accountApi,
  dateText,
  displayName,
  isSignedOut,
  monthIn,
  orderAnchor,
  orderCard,
  orderHow,
  paidOf,
  payLabel,
  profileErrors,
  relativeDays,
  repeatOrder,
  summarize,
  txTitle,
  type Me,
  type Order,
  type PickupPlace,
  type ProfileInput,
  type RawTx,
} from '../lib/account';
import { LABEL_PRESETS, MAX_ADDRESSES, addressErrors, defaultLabel, savedLine, type AddressInput, type SavedAddress } from '../lib/addresses';
import { canQuote, normalizeAddress, parseQuote } from '../lib/delivery';
import { addDays, daysBetween, dayOf, points, type Program } from '../lib/loyalty';
import { CART_KEY, parseCart } from '../lib/cart';
import { CHECKOUT_KEY, maskPhone } from '../lib/order';
import { clearSession, loadSession, onSessionChange, storage, touchSession } from './account-session';
import { mountLogin } from './account-login';
import repeatIcon from '../assets/icons/repeat.svg?raw';
import giftIcon from '../assets/icons/gift.svg?raw';
import calendarIcon from '../assets/icons/calendar.svg?raw';
import chevronIcon from '../assets/icons/chevron-down.svg?raw';
import pinIcon from '../assets/icons/pin.svg?raw';
import deliveryIcon from '../assets/icons/delivery.svg?raw';
import infoIcon from '../assets/icons/info.svg?raw';

type Offer = { title: string; text: string; place: string | null; until: string | null };
type PageData = {
  api: string;
  program: Program;
  catalog: string | null;
  phone: string;
  phoneHref: string;
  places: PickupPlace[];
  promos: Offer[];
  birthdayPromos: Offer[];
};

const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector);
const $$ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(selector));
const esc = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const ico = (svg: string) => `<span class="ico" aria-hidden="true">${svg}</span>`;
const rub = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n)} ₽`;
const num = (n: number) => new Intl.NumberFormat('ru-RU').format(n);
const typo = (text: string) => text.replace(/ ([—–]) /g, ' $1 ');
/**
 * «Торт «Прага», 1,5 кг × 2»: the number keeps its unit and the sign its
 * number when the line wraps — «1,5 / кг» read as two things.
 * «Торт «Прага», 1,5 кг × 2»: число не отрывается от единицы, а знак — от
 * числа при переносе: «1,5 / кг» читалось двумя вещами.
 */
const times = (title: string, qty: number) =>
  `${esc(title.replace(/(\d)\s+(?=(?:кг|г|л|мл|шт|см|мм|порц)(?![\p{L}]))/gu, '$1\u00a0'))}\u00a0×\u00a0${qty}`;

const node = document.getElementById('account-data');
if (node) {
  const data = JSON.parse(node.textContent || '{}') as PageData;
  const api = accountApi(data.api);
  const announcer = $('[data-announce]');
  const announce = (text: string) => {
    if (!announcer) return;
    announcer.textContent = '';
    requestAnimationFrame(() => (announcer.textContent = text));
  };

  // ── views / виды ────────────────────────────────────────────────────────
  type View = 'login' | 'loading' | 'account' | 'error';
  const show = (view: View) => {
    for (const section of $$('[data-view]')) section.hidden = section.dataset.view !== view;
    document.documentElement.dataset.accountView = view;
  };
  const title = $('[data-title]')!;
  const lead = $('[data-lead]')!;
  const who = $('[data-who]')!;
  const defaultLead = lead.textContent ?? '';

  let me: Me | null = null;
  let token: string | null = null;
  let welcome = false;

  // ── sign-in / вход ──────────────────────────────────────────────────────
  const lastPhone = () => {
    const saved = loadSession().session?.phone;
    if (saved) return saved;
    try {
      return JSON.parse(storage.get(CHECKOUT_KEY) ?? '{}').phone ?? null;
    } catch {
      return null;
    }
  };
  const loginForm = $<HTMLFormElement>('[data-view="login"] [data-login]');
  const login = loginForm
    ? mountLogin(loginForm, {
        api,
        phone: lastPhone(),
        onSignedIn: ({ created }) => {
          welcome = created;
          $('[data-expired]')!.hidden = true;
          void start();
        },
      })
    : null;

  const showLogin = (expired = false) => {
    me = null;
    token = null;
    title.textContent = 'Личный кабинет';
    lead.textContent = defaultLead;
    lead.hidden = false;
    who.hidden = true;
    const notice = $('[data-expired]');
    if (notice) notice.hidden = !expired;
    login?.reset();
    // a form left open belongs to the guest who left
    // открытая форма адреса принадлежала ушедшему гостю
    editing = null;
    asking = null;
    show('login');
  };

  // ── the band: balance, tier, spending / полоса: баланс, уровень, траты ──
  const paintBand = (sum: ReturnType<typeof summarize>) => {
    const { program, level } = sum;
    $('[data-program-name]')!.textContent = program.name;
    $('[data-balance]')!.textContent = num(sum.balance);
    $('[data-balance-word]')!.textContent = points(sum.balance).replace(/^[\d\s ]+/, '');
    $('[data-balance-note]')!.textContent = program.enabled
      ? `1 балл = 1 ₽ — оплатить можно до ${program.maxSharePercent} % заказа`
      : 'Программа на паузе: баллы не начисляются и не списываются, накопленные сохранятся';
    const burn = $('[data-burn]')!;
    burn.hidden = !program.enabled || !sum.burnSoon || !sum.burnDay;
    // a lot «expires» on the first day it no longer works: the guest is told the last day it does
    // партия «истекает» в первый день, когда уже не действует: гостю называется последний день, когда действует
    if (!burn.hidden) $('[data-burn-text]', burn)!.textContent = `${points(sum.burnSoon)} сгорят после ${dateText(addDays(sum.burnDay!, -1), me!.today)}`;

    $('[data-tier]')!.textContent = level.tier.name;
    $('[data-tier-pct]')!.textContent = `${level.tier.percent} % баллами`;
    const progress = $('[data-progress]')!;
    const pct = Math.round(level.progress * 100);
    progress.setAttribute('aria-valuenow', String(pct));
    progress.setAttribute('aria-valuetext', level.next ? `${pct} % пути до уровня ${level.next.name}` : 'Высший уровень');
    $('[data-progress-fill]')!.style.setProperty('--p', String(level.progress));
    $('[data-next]')!.textContent = level.next
      ? `До уровня ${level.next.name} (${level.next.percent} %) — ещё ${rub(level.left)} покупок`
      : 'Высший уровень программы — спасибо, что вы с нами';

    $('[data-month-label]')!.textContent = `В ${monthIn(me!.today)}`;
    $('[data-month]')!.textContent = rub(sum.monthSpent);
    $('[data-spent]')!.textContent = rub(sum.spent);
    const pending = $('[data-pending]')!;
    pending.hidden = !program.enabled || sum.pending <= 0;
    pending.textContent = `За заказы в работе начислим ≈ ${points(sum.pending)}`;
  };

  // ── offers / акции ──────────────────────────────────────────────────────
  const offerRow = (offer: Offer, i: number, tag: string | null = null) => `<li class="acc-offer">
      <span class="acc-offer__n display tnum" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
      <div class="acc-offer__body">
        <p class="acc-offer__title">${esc(typo(offer.title))}</p>
        ${offer.text ? `<p class="acc-offer__text">${esc(typo(offer.text))}</p>` : ''}
        <p class="tag acc-offer__tag">${esc([tag, offer.place ?? 'Обе точки', offer.until ? `до ${dateText(offer.until, me!.today)}` : null].filter(Boolean).join(' · '))}</p>
      </div>
    </li>`;

  const paintOffers = (sum: ReturnType<typeof summarize>) => {
    const box = $('[data-offers]')!;
    const list = $('[data-offers-list]')!;
    const { program, birthday } = sum;
    const profile = me!.profile;
    const today = me!.today;
    let coupon = '';

    if (program.enabled && (program.birthdayBonus > 0 || program.birthdayDiscount > 0)) {
      if (!profile.birthday) {
        const gifts = [program.birthdayBonus > 0 ? points(program.birthdayBonus) : null, program.birthdayDiscount ? `скидку ${program.birthdayDiscount} % на заказ` : null]
          .filter(Boolean)
          .join(' и ');
        coupon = `<div class="acc-coupon">
            <span class="acc-coupon__icon">${ico(giftIcon)}</span>
            <p class="acc-coupon__title">Подарок ко дню рождения</p>
            <p class="acc-coupon__text">${esc(`Укажите дату в профиле — к празднику подарим ${gifts}.`)}</p>
            <button type="button" class="btn btn--secondary btn--sm" data-goto-birthday>Указать дату</button>
          </div>`;
      } else if (birthday?.inWindow) {
        const early = !profile.birthday_set_at || dayOf(profile.birthday_set_at) < birthday.from;
        const gift = me!.transactions.find((tx) => tx.type === 'birthday' && dayOf(tx.date_created) >= birthday.from && dayOf(tx.date_created) <= birthday.until);
        const usedDiscount = me!.orders.some((order) => Number(order.discount) > 0 && order.status !== 'cancelled' && dayOf(order.date_created) >= birthday.from);
        const lines = [
          gift
            ? `Подарили ${points(gift.amount)} — они действуют до ${dateText(birthday.until, today)}.`
            : early && program.birthdayBonus > 0
              ? `${points(program.birthdayBonus)} придут на счёт этой ночью и будут действовать до ${dateText(birthday.until, today)}.`
              : !early
                ? 'Дату указали уже в праздничные дни, поэтому подарок придёт в следующий раз.'
                : null,
          early && program.birthdayDiscount && !usedDiscount
            ? `Скидка ${program.birthdayDiscount} % на один заказ с сайта до ${dateText(birthday.until, today)} — корзина посчитает её сама.`
            : null,
        ].filter(Boolean) as string[];
        const when = birthday.distance === 0 ? 'Сегодня ваш день рождения' : `День рождения ${relativeDays(birthday.distance)}`;
        coupon = `<div class="acc-coupon acc-coupon--party">
            <span class="acc-coupon__icon">${ico(giftIcon)}</span>
            <p class="label acc-coupon__kicker">${esc(when)}</p>
            <p class="acc-coupon__title display">С днём рождения!</p>
            ${lines.map((line) => `<p class="acc-coupon__text">${esc(typo(line))}</p>`).join('')}
          </div>`;
      } else if (birthday) {
        const next = birthday.distance <= 0 ? birthday.day : `${Number(birthday.day.slice(0, 4)) + 1}${birthday.day.slice(4)}`;
        const days = daysBetween(today, next);
        coupon = `<div class="acc-coupon acc-coupon--quiet">
            <span class="acc-coupon__icon">${ico(calendarIcon)}</span>
            <p class="acc-coupon__title">До дня рождения ${esc(relativeDays(-days).replace('через ', ''))}</p>
            <p class="acc-coupon__text">${esc(
              typo(
                `${dateText(next, today)} — ${program.birthdayBonus > 0 ? `подарим ${points(program.birthdayBonus)}` : 'ждём вас'}${
                  program.birthdayDiscount ? ` и скидку ${program.birthdayDiscount} % на один заказ` : ''
                }. Подарок действует ±${program.birthdayWindow} дня от праздника.`,
              ),
            )}</p>
          </div>`;
      }
    }

    const birthdayOffers = birthday?.inWindow ? data.birthdayPromos : [];
    const rows = [
      ...birthdayOffers.map((offer) => ({ offer, tag: 'Именинникам' })),
      ...data.promos.map((offer) => ({ offer, tag: null })),
    ];
    // a long list folds after three: the tabs below matter more on a phone
    // длинный список сворачивается после трёх: на телефоне вкладки ниже важнее
    const FOLD = 3;
    const registry = rows.length
      ? `<div><ol class="acc-offers__list" role="list" id="offers-list">${rows
          .map((row, i) => offerRow(row.offer, i, row.tag).replace('<li class="acc-offer"', `<li class="acc-offer"${i >= FOLD ? ' data-more hidden' : ''}`))
          .join('')}</ol>${
          rows.length > FOLD
            ? `<button type="button" class="tlink acc-offers__more" data-offers-more aria-expanded="false" aria-controls="offers-list">Ещё ${rows.length - FOLD}</button>`
            : ''
        }</div>`
      : '';
    box.hidden = !coupon && !registry;
    list.innerHTML = `${coupon}${registry}`;
    list.classList.toggle('acc-offers__grid--single', !coupon || !registry);
  };

  // ── orders / заказы ─────────────────────────────────────────────────────
  // Orders the guest opened stay open through every `render()` (a saved
  // profile redraws the list).
  // Заказы, которые гость раскрыл, остаются раскрытыми при любом `render()`
  // (сохранение профиля перерисовывает список).
  const openOrders = new Set<number>();

  /**
   * The whole order under its row: the dishes and the bill on the left, where,
   * when, who and the payment with the history on the right (one column on a
   * phone). Folded with `hidden="until-found"`, so the browser's search still
   * finds a dish in a folded order and opens it.
   * Заказ целиком под строкой: блюда и счёт слева, куда, когда, кто и оплата с
   * историей справа (одной колонкой на телефоне). Свёрнут через
   * `hidden="until-found"`: поиск браузера находит блюдо и в свёрнутом заказе и
   * раскрывает его.
   */
  const orderDetails = (order: Order) => {
    const card = orderCard(order, data.places, me!.today);
    const open = openOrders.has(order.id);
    const lines = card.lines.map((line) => `<li><span>${times(line.title, line.qty)}</span><b class="tnum">${rub(line.sum)}</b></li>`).join('');
    const bill = card.bill
      .map((row) => `<div data-tone="${row.tone}"><dt>${esc(row.label)}</dt><dd class="tnum">${esc(row.value)}</dd></div>`)
      .join('');
    const fact = (label: string, value: string, note: string | null = null) =>
      `<div><dt>${esc(label)}</dt><dd>${value}${note ? `<span class="acc-order__note">${esc(note)}</span>` : ''}</dd></div>`;
    const pay = card.pay
      ? [
          card.pay.status ? `<span class="acc-pay" data-pay="${esc(card.pay.state ?? '')}">${esc(card.pay.status)}</span>` : '',
          `<span class="acc-pay__how">${esc([card.pay.method, card.pay.at].filter(Boolean).join(' · '))}</span>`,
          card.pay.test ? `<span class="acc-pay__test">Тестовая оплата</span>` : '',
        ].join('')
      : '';
    const facts = [
      fact(card.where.label, esc(card.where.value), card.where.note),
      card.when ? fact('Когда', esc(card.when)) : '',
      card.comment ? fact('Комментарий', esc(typo(card.comment))) : '',
      card.who ? fact('Получатель', `<span class="tnum">${esc(card.who)}</span>`) : '',
      card.receipt ? fact('Чек', esc(card.receipt)) : '',
      pay ? fact('Оплата', `<span class="acc-pay__line">${pay}</span>`) : '',
    ].join('');
    const history = card.history
      .map(
        (step) =>
          `<li data-status="${esc(step.status)}"><span class="acc-order__step">${esc(step.label)}</span>${
            step.at ? `<span class="acc-order__at tnum">${esc(step.at)}</span>` : ''
          }</li>`,
      )
      .join('');
    return `<div class="acc-order__more" id="order-${order.id}-more" data-order-more="${order.id}"${open ? '' : ' hidden="until-found"'}>
        <div class="acc-order__col">
          <p class="acc-order__cap">Состав</p>
          ${lines ? `<ul class="acc-order__lines" role="list">${lines}</ul>` : ''}
          <dl class="acc-order__bill">${bill}
            <div class="acc-order__total"><dt>${esc(card.total.label)}</dt><dd class="tnum">${rub(card.total.value)}</dd></div>
          </dl>
        </div>
        <div class="acc-order__col">
          <dl class="acc-order__facts">${facts}</dl>
          <p class="acc-order__cap">История</p>
          <ol class="acc-order__history" role="list">${history}</ol>
        </div>
        <p class="acc-order__fold"><button type="button" class="tlink" data-order-fold="${order.id}">Свернуть заказ</button></p>
      </div>`;
  };

  const orderRow = (order: Order, percent: number) => {
    const status = ORDER_STATUS[order.status] ?? order.status;
    const items = order.items ?? [];
    const names = items.map((item) => times(item.title, item.qty));
    const shown = names.slice(0, 3).join(', ');
    const more = names.length > 3 ? ` и ещё ${names.length - 3}` : '';
    // delivery, pickup or «в зале, Садовая, 212Б, стол 4» (since 26.10.2026) — one rule with the card
    // доставка, самовывоз или «в зале, Садовая, 212Б, стол 4» (с 26.10.2026) — одно правило с карточкой
    const how = orderHow(order, data.places);
    const paid = paidOf(order);
    const sums = [
      `<div><dt>Сумма</dt><dd class="tnum">${rub(order.total)}</dd></div>`,
      Number(order.discount) > 0 ? `<div><dt>Скидка</dt><dd class="tnum">−${rub(Number(order.discount))}</dd></div>` : '',
      Number(order.bonus_spent) > 0 ? `<div><dt>Баллами</dt><dd class="tnum">−${rub(Number(order.bonus_spent))}</dd></div>` : '',
      paid !== order.total ? `<div><dt>${esc(payLabel(order))}</dt><dd class="tnum">${rub(paid)}</dd></div>` : '',
    ].join('');
    const earned = Number(order.bonus_earned) || 0;
    const pts =
      order.status === 'done' && earned > 0
        ? `<p class="acc-order__pts" data-sign="plus">+${points(earned)}</p>`
        : order.status === 'new' || order.status === 'in_work'
          ? `<p class="acc-order__pts acc-order__pts--soon">≈ +${points(Math.floor((paid * percent) / 100))} после выполнения</p>`
          : order.status === 'cancelled' && Number(order.bonus_spent) > 0
            ? `<p class="acc-order__pts acc-order__pts--soon">Баллы вернулись на счёт</p>`
            : '';
    const open = openOrders.has(order.id);
    // the toggle ends the line of dishes: «… и ещё 2 · Весь заказ»
    // кнопка заканчивает строку блюд: «… и ещё 2 · Весь заказ»
    const toggle = `<button type="button" class="tlink acc-order__toggle" aria-expanded="${open}" aria-controls="order-${order.id}-more" data-order-toggle="${order.id}"><span data-order-toggle-label>${open ? 'Свернуть' : 'Весь заказ'}</span>${ico(chevronIcon)}</button>`;
    return `<li class="acc-order${open ? ' is-open' : ''}" id="${esc(orderAnchor(order.number))}" data-order="${order.id}">
        <div class="acc-order__top">
          <p class="acc-order__no">Заказ <span class="tnum">${esc(order.number)}</span></p>
          <span class="acc-status" data-status="${esc(order.status)}">${esc(status)}</span>
        </div>
        <p class="acc-order__when">${esc(dateText(order.date_created, me!.today))} · ${esc(how)}</p>
        <p class="acc-order__items">${shown ? `${shown}${esc(more)}<span class="acc-order__dot" aria-hidden="true">\u00a0· </span>` : ''}${toggle}</p>
        ${orderDetails(order)}
        <div class="acc-order__bottom">
          <dl class="acc-order__sums">${sums}</dl>
          ${pts}
          ${items.length && data.catalog ? `<button type="button" class="btn btn--secondary btn--sm acc-order__again" data-repeat="${order.id}">${ico(repeatIcon)}Повторить</button>` : ''}
        </div>
      </li>`;
  };

  /** Раскрыть или свернуть заказ; состояние переживает перерисовку списка. */
  const setOrderOpen = (id: number, open: boolean) => {
    if (open) openOrders.add(id);
    else openOrders.delete(id);
    const row = $(`[data-order="${id}"]`);
    const more = document.getElementById(`order-${id}-more`);
    const toggle = $<HTMLButtonElement>(`[data-order-toggle="${id}"]`);
    if (!row || !more || !toggle) return;
    row.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    $('[data-order-toggle-label]', toggle)!.textContent = open ? 'Свернуть' : 'Весь заказ';
    if (open) more.removeAttribute('hidden');
    else more.setAttribute('hidden', 'until-found');
  };

  const bindOrders = (root: HTMLElement) => {
    // the browser's search opens a folded order on its own and says so here
    // поиск браузера раскрывает свёрнутый заказ сам и сообщает об этом здесь
    for (const more of $$('[data-order-more]', root)) more.addEventListener('beforematch', () => setOrderOpen(Number(more.dataset.orderMore), true));
  };

  /** `#order-2310-4821`: вкладка «Заказы», заказ раскрыт и перед глазами. */
  const openFromHash = () => {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (!me || !hash.startsWith('order-')) return false;
    const order = me.orders.find((item) => orderAnchor(item.number) === hash);
    if (!order) return false;
    selectTab('orders', false);
    setOrderOpen(order.id, true);
    $(`[data-order="${order.id}"]`)?.scrollIntoView({ block: 'start' });
    $<HTMLButtonElement>(`[data-order-toggle="${order.id}"]`)?.focus({ preventScroll: true });
    return true;
  };

  // ── points / баллы ──────────────────────────────────────────────────────
  const txRow = (tx: RawTx) => {
    const label = txTitle(tx);
    const note = (tx.comment ?? '').replace(/\s·\sзаказ\s.+$/, '').trim();
    const meta = [dateText(tx.date_created, me!.today), tx.order?.number ? `заказ ${tx.order.number}` : null].filter(Boolean).join(' · ');
    const keepsNote = note && !/^(Оплата заказа баллами|Заказ отменён)/.test(note);
    return `<li class="acc-tx">
        <div class="acc-tx__body">
          <p class="acc-tx__title">${esc(label)}</p>
          <p class="acc-tx__meta tnum">${esc(meta)}</p>
          ${keepsNote ? `<p class="acc-tx__note">${esc(typo(note))}</p>` : ''}
        </div>
        <p class="acc-tx__amount tnum" data-sign="${tx.amount > 0 ? 'plus' : 'minus'}">${tx.amount > 0 ? '+' : '−'}${num(Math.abs(tx.amount))}</p>
      </li>`;
  };

  // ── profile / профиль ───────────────────────────────────────────────────
  const profileForm = $<HTMLFormElement>('[data-profile]')!;
  const input = <T extends HTMLInputElement = HTMLInputElement>(name: string) => profileForm.elements.namedItem(name) as T | null;
  const radio = (name: string) => profileForm.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
  let profileDirty = false;

  const paintProfile = (program: Program) => {
    const profile = me!.profile;
    for (const key of ['first_name', 'last_name', 'middle_name', 'recovery_email'] as const) {
      const field = input(key);
      if (field) field.value = profile[key] ?? '';
    }
    input('phone')!.value = maskPhone(profile.phone);
    const genders = $$<HTMLInputElement>('input[name="gender"]', profileForm);
    for (const option of genders) option.checked = option.value === (profile.gender ?? '');
    const birthday = input('birthday')!;
    birthday.value = profile.birthday ?? '';
    birthday.readOnly = Boolean(profile.birthday);
    // a set birthday is shown as words, not as the browser's date box
    // указанная дата показывается словами, а не полем даты браузера
    const birthdayText = $<HTMLInputElement>('[data-birthday-text]')!;
    birthday.hidden = Boolean(profile.birthday);
    birthdayText.hidden = !profile.birthday;
    $('[data-birthday-locked]')!.hidden = !profile.birthday;
    birthdayText.value = profile.birthday ? dateText(profile.birthday, '0000-00-00') : '';
    birthday.max = me!.today;
    birthday.min = `${Number(me!.today.slice(0, 4)) - 110}-01-01`;
    $('[data-birthday-field]')!.classList.toggle('acc-locked-field', Boolean(profile.birthday));
    $('[data-birthday-hint]')!.textContent = profile.birthday
      ? 'Указана. Ошиблись — позвоните нам, исправим'
      : program.birthdayBonus > 0
        ? `Подарим ${points(program.birthdayBonus)} к празднику. Указать можно один раз`
        : 'Указать можно один раз';
    $('[data-profile-dot]')!.hidden = Boolean(profile.first_name && profile.birthday);
    profileDirty = false;
    $('[data-saved]')!.textContent = '';
  };

  const showProfileErrors = (errors: Partial<Record<string, string>>) => {
    for (const box of $$('[data-err]', profileForm)) {
      const key = box.dataset.err!;
      const message = errors[key];
      box.hidden = !message;
      box.textContent = message ?? '';
      const field = input(key);
      if (field) {
        if (message) field.setAttribute('aria-invalid', 'true');
        else field.removeAttribute('aria-invalid');
      }
    }
  };

  // ── saved addresses / сохранённые адреса ────────────────────────────────
  // A list of up to five, each with its own «Изменить» and «Удалить»; one
  // form adds and edits — editing opens it in place of the row. Removing asks
  // once, in the row. After «street and house» the map is asked for the zone,
  // as the cart does; the address saves without it all the same.
  // Список до пяти адресов, у каждого свои «Изменить» и «Удалить»; одна форма
  // добавляет и правит — правка открывает её на месте строки. Удаление
  // переспрашивает один раз, в строке. После «Улицы и дома» карта называет
  // зону, как в корзине; сохранить адрес можно и без этого.
  const addrList = $('[data-addrs-list]')!;
  const addrForm = $<HTMLFormElement>('[data-addr-form]')!;
  const addrHome = $('[data-addr-home]')!;
  const addBtn = $<HTMLButtonElement>('[data-addr-add]')!;
  const addrField = (name: string) => addrForm.elements.namedItem(name) as HTMLInputElement;
  const addrErrorBox = $('[data-addr-error]', addrForm)!;
  const addrSubmit = $<HTMLButtonElement>('[data-submit]', addrForm)!;
  const quoteLine = $('[data-addr-quote]', addrForm)!;
  const addrNote = $('[data-addrs-err]')!;
  const APT_NAME: Record<string, string> = { flat: 'Квартира / офис', entrance: 'Подъезд', floor: 'Этаж', intercom: 'Код домофона' };
  let saved: SavedAddress[] = [];
  /** `'new'` — добавляем, id — правим этот адрес, `null` — формы нет */
  let editing: string | null = null;
  /** id адреса, который спрашивает «Удалить?» */
  let asking: string | null = null;
  let addrBusy = false;

  const addrRow = (a: SavedAddress) => {
    const id = esc(a.id);
    const label = esc(a.label);
    const actions =
      asking === a.id
        ? `<p class="acc-addr__ask" role="group" aria-labelledby="ask-${id}">
            <span id="ask-${id}">Удалить «${label}»?</span>
            <button type="button" class="tlink acc-addr__yes" data-addr-yes="${id}">Да</button>
            <button type="button" class="tlink" data-addr-no="${id}">Нет</button>
          </p>`
        : `<p class="acc-addr__actions">
            <button type="button" class="tlink" data-addr-edit="${id}" aria-label="Изменить адрес «${label}»">Изменить</button>
            <button type="button" class="tlink acc-addr__remove" data-addr-remove="${id}" aria-label="Удалить адрес «${label}»">Удалить</button>
          </p>`;
    return `<li class="acc-addr${asking === a.id ? ' is-asking' : ''}" data-addr="${id}">
        <span class="acc-addr__ico">${ico(pinIcon)}</span>
        <div class="acc-addr__body">
          <p class="acc-addr__label">${label}</p>
          <p class="acc-addr__line">${esc(savedLine(a))}</p>
        </div>
        ${actions}
      </li>`;
  };

  const paintAddresses = () => {
    // the form is kept out of the list while the rows are redrawn: it is one node with the guest's typing in it
    // форма на время перерисовки уходит из списка: это один узел, в нём набранное гостем
    addrHome.prepend(addrForm);
    addrList.innerHTML = saved.map(addrRow).join('');
    const row = editing && editing !== 'new' ? $(`[data-addr="${CSS.escape(editing)}"]`, addrList) : null;
    if (row) {
      row.classList.add('is-editing');
      row.replaceChildren(addrForm);
    }
    addrForm.hidden = !editing;
    $('[data-addrs-empty]')!.hidden = saved.length > 0 || editing === 'new';
    // «Корзина предложит их» needs something to offer; an empty list says it in its own line
    // «Корзина предложит их» — когда есть что предложить; пустой список говорит своей строкой
    $('[data-addrs-lead]')!.hidden = saved.length === 0;
    $('[data-addrs-count]')!.textContent = saved.length ? `${saved.length} из ${MAX_ADDRESSES}` : '';
    const full = saved.length >= MAX_ADDRESSES;
    addBtn.setAttribute('aria-disabled', String(full));
    $('[data-addr-limit]')!.hidden = !full;
    $('[data-addr-foot]')!.hidden = editing === 'new';
  };

  const showAddrErrors = (errors: Partial<Record<string, string>>) => {
    for (const box of $$('[data-addr-err]', addrForm)) {
      const key = box.dataset.addrErr!;
      const message = errors[key];
      box.hidden = !message;
      // the four parts share one line under their grid: the message names its field
      // у четырёх пунктов общая строка под сеткой: сообщение называет своё поле
      box.textContent = message ? (APT_NAME[key] ? `${APT_NAME[key]}: ${message.charAt(0).toLowerCase()}${message.slice(1)}` : message) : '';
      const field = key === 'label' ? addrField('own') : addrField(key);
      if (field) {
        if (message) field.setAttribute('aria-invalid', 'true');
        else field.removeAttribute('aria-invalid');
      }
    }
  };

  const kind = () => addrForm.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value ?? 'own';
  const paintKind = () => {
    $('[data-addr-own]', addrForm)!.hidden = kind() !== 'own';
  };
  const readAddr = (): AddressInput => ({
    label: kind() === 'own' ? addrField('own').value : kind(),
    address: addrField('address').value,
    flat: addrField('flat').value,
    entrance: addrField('entrance').value,
    floor: addrField('floor').value,
    intercom: addrField('intercom').value,
  });

  // «Нашли: зона …» after the street, the same `POST /delivery/quote` as the cart
  // «Нашли: зона …» после улицы — тот же `POST /delivery/quote`, что у корзины
  let quoteSeq = 0;
  let quotedKey = '';
  // the line never disappears: at rest it is a hint, so leaving the field does not move «Сохранить»
  // from under the pointer (the click that blurred the field would land on nothing)
  // строка не исчезает: в покое это подсказка, и уход с поля не сдвигает «Сохранить» из-под
  // курсора (нажатие, которое увело фокус с поля, пришлось бы в пустоту)
  const QUOTE_HINT = data.api ? 'Найдём дом на карте и назовём зону доставки' : '';
  const setQuote = (tone: 'wait' | 'found' | 'miss' | null, html = '') => {
    quoteLine.hidden = !tone && !QUOTE_HINT;
    quoteLine.dataset.tone = tone ?? 'hint';
    quoteLine.innerHTML = tone ? `${ico(tone === 'miss' ? infoIcon : deliveryIcon)}<span>${html}</span>` : `<span>${QUOTE_HINT}</span>`;
  };
  const quoteAddress = async (value: string) => {
    const key = normalizeAddress(value);
    if (!canQuote(value) || !data.api) {
      quoteSeq += 1;
      quotedKey = '';
      setQuote(null);
      return;
    }
    if (key === quotedKey) return;
    quotedKey = key;
    const seq = ++quoteSeq;
    setQuote('wait', 'Ищем адрес на карте…');
    try {
      const response = await fetch(`${data.api}/delivery/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: value.trim() }),
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const quote = parseQuote(await response.json());
      if (seq !== quoteSeq) return;
      if (quote.found)
        setQuote(
          'found',
          `Нашли: зона «${esc(quote.zone.name)}»<span class="acc-addr-form__meta">доставка ${quote.zone.price ? rub(quote.zone.price) : 'бесплатно'}${
            quote.zone.price && quote.zone.free_from ? `, бесплатно от ${rub(quote.zone.free_from)}` : ''
          }</span>`,
        );
      else setQuote('miss', quote.outside ? 'Адрес вне зон доставки — стоимость назовём при звонке' : 'Не нашли на карте — проверьте адрес');
    } catch {
      // the map is a help, not a gate: no answer — no line, the address saves anyway
      // карта — подсказка, а не проверка: нет ответа — нет строки, адрес сохранится и так
      if (seq === quoteSeq) {
        quotedKey = '';
        setQuote(null);
      }
    }
  };

  const openAddrForm = (mode: string) => {
    const address = mode === 'new' ? null : saved.find((a) => a.id === mode);
    if (mode !== 'new' && !address) return;
    editing = mode;
    asking = null;
    const label = address?.label ?? defaultLabel(saved);
    const preset = LABEL_PRESETS.find((item) => item.toLowerCase() === label.toLowerCase());
    for (const option of $$<HTMLInputElement>('input[name="kind"]', addrForm)) option.checked = option.value === (preset ?? 'own');
    addrField('own').value = preset ? '' : label;
    addrField('address').value = address?.address ?? '';
    for (const key of ['flat', 'entrance', 'floor', 'intercom'] as const) addrField(key).value = address?.[key] ?? '';
    $('[data-addr-form-title]', addrForm)!.textContent = address ? `Изменить «${address.label}»` : 'Новый адрес';
    paintKind();
    showAddrErrors({});
    addrErrorBox.hidden = true;
    addrNote.hidden = true;
    quoteSeq += 1;
    quotedKey = '';
    setQuote(null);
    paintAddresses();
    if (address) void quoteAddress(address.address);
    addrField('address').focus();
  };

  const closeAddrForm = () => {
    const was = editing;
    editing = null;
    quoteSeq += 1;
    paintAddresses();
    // back to where the guest came from: the row's «Изменить» or «Добавить адрес»
    // туда, откуда пришёл гость: к «Изменить» своей строки или к «Добавить адрес»
    const back = was && was !== 'new' ? $<HTMLButtonElement>(`[data-addr-edit="${CSS.escape(was)}"]`, addrList) : null;
    (back ?? addBtn).focus();
  };

  const addrFailure = (error: unknown) => {
    const e = error as ApiError;
    if (isSignedOut(e)) {
      clearSession();
      showLogin(true);
      return null;
    }
    // the field is not in the database yet: a calm word instead of the server's
    // поля ещё нет в базе: спокойные слова вместо серверных
    return e.code === 'ADDRESSES_OFF' ? 'Адреса пока недоступны, попробуйте позже.' : e.message;
  };

  addrForm.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name !== 'kind') return;
    paintKind();
    showAddrErrors({});
    if (kind() === 'own') addrField('own').focus();
  });
  addrForm.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    // a changed street makes the old answer of the map stale
    // изменённая улица делает старый ответ карты устаревшим
    if (target.name === 'address' && normalizeAddress(target.value) !== quotedKey) {
      quoteSeq += 1;
      quotedKey = '';
      setQuote(null);
    }
    if (target.getAttribute('aria-invalid') === 'true') {
      const key = target.name === 'own' ? 'label' : target.name;
      const left = addressErrors(readAddr());
      const box = $(`[data-addr-err="${key}"]`, addrForm);
      if (box && !left[key as keyof typeof left]) {
        box.hidden = true;
        target.removeAttribute('aria-invalid');
      }
    }
  });
  addrField('address').addEventListener('blur', () => void quoteAddress(addrField('address').value));
  addrForm.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || addrBusy) return;
    event.preventDefault();
    closeAddrForm();
  });

  addrForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!me || !token || addrBusy || !editing) return;
    const values = readAddr();
    const errors = addressErrors(values);
    showAddrErrors(errors);
    const first = Object.keys(errors)[0];
    if (first) {
      (first === 'label' ? addrField('own') : addrField(first))?.focus();
      return;
    }
    addrErrorBox.hidden = true;
    const mode = editing;
    const label = $('[data-addr-submit-label]', addrSubmit)!;
    addrBusy = true;
    addrSubmit.setAttribute('aria-busy', 'true');
    label.textContent = 'Сохраняем…';
    try {
      const before = new Set(saved.map((a) => a.id));
      let id = mode;
      if (mode === 'new') {
        const result = await api.addAddress(token, values);
        saved = result.addresses;
        id = result.id;
      } else saved = (await api.updateAddress(token, mode, values)).addresses;
      me.profile.addresses = saved;
      editing = null;
      paintAddresses();
      const name = saved.find((a) => a.id === id)?.label ?? values.label ?? '';
      // the same street and flat again is not a second address: the server updated the one it had
      // та же улица и квартира — не второй адрес: сервер обновил уже сохранённый
      announce(mode === 'new' && before.has(id) ? `Такой адрес уже был — обновили «${name}»` : `Адрес «${name}» сохранён`);
      const row = $(`[data-addr="${CSS.escape(id)}"]`, addrList);
      row?.classList.add('is-fresh');
      $<HTMLButtonElement>('[data-addr-edit]', row ?? addrList)?.focus();
    } catch (error) {
      const message = addrFailure(error);
      if (message === null) return;
      const fields = (error as ApiError).fields ?? {};
      if (Object.keys(fields).length) {
        showAddrErrors(fields);
        const key = Object.keys(fields)[0];
        (key === 'label' ? addrField('own') : addrField(key))?.focus();
      } else {
        $('[data-addr-error-text]', addrErrorBox)!.textContent = message;
        addrErrorBox.hidden = false;
      }
    } finally {
      addrBusy = false;
      addrSubmit.removeAttribute('aria-busy');
      label.textContent = 'Сохранить адрес';
    }
  });

  const removeAddress = async (id: string) => {
    if (!me || !token || addrBusy) return;
    const address = saved.find((a) => a.id === id);
    if (!address) return;
    addrBusy = true;
    const ask = $(`[data-addr="${CSS.escape(id)}"] .acc-addr__ask`, addrList);
    ask?.setAttribute('aria-busy', 'true');
    try {
      saved = (await api.removeAddress(token, id)).addresses;
      me.profile.addresses = saved;
      asking = null;
      addrNote.hidden = true;
      paintAddresses();
      announce(`Адрес «${address.label}» удалён`);
      // the row is gone: focus goes to «Добавить адрес», the next thing to do here
      // строки больше нет: фокус — на «Добавить адрес», следующее действие здесь
      addBtn.focus();
    } catch (error) {
      const message = addrFailure(error);
      if (message === null) return;
      asking = null;
      paintAddresses();
      addrNote.textContent = `Не удалилось: ${message}`;
      addrNote.hidden = false;
      $<HTMLButtonElement>(`[data-addr-remove="${CSS.escape(id)}"]`, addrList)?.focus();
    } finally {
      addrBusy = false;
    }
  };

  $('[data-addrs]')!.addEventListener('click', (event) => {
    const target = event.target as Element;
    const pick = (attr: string) => target.closest<HTMLElement>(`[${attr}]`)?.getAttribute(attr) ?? null;
    if (target.closest('[data-addr-add]')) {
      if (addBtn.getAttribute('aria-disabled') === 'true') {
        announce($('[data-addr-limit]')!.textContent ?? '');
        return;
      }
      openAddrForm('new');
      return;
    }
    if (target.closest('[data-addr-cancel]')) {
      if (!addrBusy) closeAddrForm();
      return;
    }
    const edit = pick('data-addr-edit');
    if (edit) {
      openAddrForm(edit);
      return;
    }
    const remove = pick('data-addr-remove');
    if (remove && !addrBusy) {
      if (editing && editing !== 'new') editing = null;
      asking = remove;
      addrNote.hidden = true;
      paintAddresses();
      // the safe answer takes the focus: «Нет»
      // фокус — на безопасный ответ: «Нет»
      $<HTMLButtonElement>(`[data-addr-no="${CSS.escape(remove)}"]`, addrList)?.focus();
      return;
    }
    const no = pick('data-addr-no');
    if (no && !addrBusy) {
      asking = null;
      paintAddresses();
      $<HTMLButtonElement>(`[data-addr-remove="${CSS.escape(no)}"]`, addrList)?.focus();
      return;
    }
    const yes = pick('data-addr-yes');
    if (yes) void removeAddress(yes);
  });

  // ── draw everything / нарисовать всё ────────────────────────────────────
  const render = () => {
    if (!me) return;
    const sum = summarize(me, data.program);
    const name = displayName(me.profile);
    title.textContent = name ? `Здравствуйте, ${name}` : 'Личный кабинет';
    lead.hidden = true;
    who.hidden = false;
    $('[data-who-phone]')!.textContent = maskPhone(me.profile.phone);
    touchSession({ name, phone: me.profile.phone });

    const welcomeBox = $('[data-welcome]')!;
    welcomeBox.hidden = !welcome;
    if (welcome) {
      const signup = me.transactions.find((tx) => tx.type === 'signup');
      $('[data-welcome-text]')!.textContent = signup
        ? `Добро пожаловать в «${sum.program.name}»! Начислили ${points(signup.amount)} за первый вход — их можно потратить в каталоге.`
        : `Добро пожаловать в «${sum.program.name}»!`;
    }

    paintBand(sum);
    paintOffers(sum);
    // the ladder in «Баллы» marks the guest's own step
    // лестница во вкладке «Баллы» отмечает ступень самого гостя
    for (const step of $$('[data-tier-step]')) step.toggleAttribute('data-current', Number(step.dataset.tierStep) === sum.level.index);

    const orders = $('[data-orders]')!;
    orders.innerHTML = me.orders.map((order) => orderRow(order, sum.level.tier.percent)).join('');
    bindOrders(orders);
    $('[data-orders-empty]')!.hidden = me.orders.length > 0;
    $('[data-orders-n]')!.textContent = me.orders.length ? String(me.orders.length) : '';

    const txs = $('[data-txs]')!;
    txs.innerHTML = me.transactions.map(txRow).join('');
    $('[data-txs-empty]')!.hidden = me.transactions.length > 0;
    // the nearest burn only: a warning in terracotta within a month, a quiet line otherwise
    // только ближайшее сгорание: в пределах месяца — предупреждение терракотой, иначе тихая строка
    const expiring = $('[data-expiring]')!;
    const nearest = sum.expiring[0];
    expiring.hidden = !sum.program.enabled || !nearest;
    if (nearest) {
      const soon = daysBetween(me.today, nearest.day) <= 30;
      expiring.classList.toggle('acc-expiring--quiet', !soon);
      expiring.textContent = `${soon ? 'Скоро сгорят' : 'Ближайшее сгорание'}: ${points(nearest.amount)} — после ${dateText(addDays(nearest.day, -1), me.today)}. Первыми тратятся баллы, которые сгорают раньше.`;
    }

    if (!profileDirty) paintProfile(sum.program);
    // an open address form keeps its node and its typing: the list waits for it to close
    // открытая форма адреса сохраняет свой узел и набранное: список ждёт, пока её закроют
    saved = me.profile.addresses ?? [];
    if (!editing) paintAddresses();
  };

  // ── load / загрузка ─────────────────────────────────────────────────────
  // one request per session: the sign-in and the session event both ask for it
  // один запрос на сессию: о нём просят и вход, и событие сессии
  let inflight: { token: string; done: Promise<void> } | null = null;
  const start = () => {
    const { session } = loadSession();
    if (session && inflight?.token === session.token) return inflight.done;
    const done = load();
    if (session) inflight = { token: session.token, done: done.finally(() => (inflight = null)) };
    return done;
  };
  const load = async () => {
    const { session, expired } = loadSession();
    if (!session) {
      if (expired) clearSession();
      showLogin(expired);
      return;
    }
    token = session.token;
    if (!me) show('loading');
    try {
      me = await api.me(session.token);
      render();
      show('account');
      selectTab(tabFromHash() ?? currentTab, false);
      openFromHash();
      if (welcome) announce($('[data-welcome-text]')?.textContent ?? '');
      welcome = false;
    } catch (error) {
      if (isSignedOut(error)) {
        clearSession();
        showLogin(true);
        return;
      }
      $('[data-error-text]')!.textContent = (error as ApiError).message;
      show('error');
    }
  };

  // ── tabs / вкладки ──────────────────────────────────────────────────────
  type Tab = 'orders' | 'points' | 'profile';
  const tabs = $$<HTMLButtonElement>('[data-tab]');
  let currentTab: Tab = 'orders';
  const tabFromHash = (): Tab | null => {
    const hash = location.hash.slice(1);
    return hash === 'orders' || hash === 'points' || hash === 'profile' ? hash : null;
  };
  const selectTab = (tab: Tab, focus = true, updateHash = false) => {
    currentTab = tab;
    for (const button of tabs) {
      const on = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      if (on && focus) button.focus();
    }
    for (const panel of $$('[data-panel]')) panel.hidden = panel.dataset.panel !== tab;
    if (updateHash) history.replaceState(history.state, '', `#${tab}`);
  };
  for (const button of tabs) {
    button.addEventListener('click', () => selectTab(button.dataset.tab as Tab, false, true));
    button.addEventListener('keydown', (event) => {
      const i = tabs.indexOf(button);
      const to =
        event.key === 'ArrowRight' ? (i + 1) % tabs.length : event.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (to < 0) return;
      event.preventDefault();
      selectTab(tabs[to].dataset.tab as Tab, true, true);
    });
  }
  window.addEventListener('hashchange', () => {
    const tab = tabFromHash();
    if (tab && me) selectTab(tab, false);
    else openFromHash();
  });

  // ── clicks / нажатия ────────────────────────────────────────────────────
  const logout = async () => {
    const was = token;
    clearSession();
    showLogin();
    announce('Вы вышли из кабинета');
    if (was) await api.logout(was).catch(() => undefined);
    $<HTMLElement>('#acc-title')?.focus();
  };

  document.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.closest('[data-logout]')) {
      void logout();
      return;
    }
    if (target.closest('[data-retry]')) {
      void start();
      return;
    }
    const again = target.closest<HTMLElement>('[data-repeat]');
    if (again && me && data.catalog) {
      const order = me.orders.find((item) => item.id === Number(again.dataset.repeat));
      if (!order) return;
      storage.set(CART_KEY, JSON.stringify(repeatOrder(order, parseCart(storage.get(CART_KEY)))));
      location.href = `${data.catalog}#cart`;
      return;
    }
    const toggle = target.closest<HTMLButtonElement>('[data-order-toggle]');
    if (toggle) {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      setOrderOpen(Number(toggle.dataset.orderToggle), open);
      // folding a long order must not leave the guest far below it
      // свёрнутый длинный заказ не должен оставить гостя далеко под собой
      if (!open) toggle.scrollIntoView({ block: 'nearest' });
      return;
    }
    const fold = target.closest<HTMLButtonElement>('[data-order-fold]');
    if (fold) {
      const id = Number(fold.dataset.orderFold);
      setOrderOpen(id, false);
      const back = $<HTMLButtonElement>(`[data-order-toggle="${id}"]`);
      back?.scrollIntoView({ block: 'nearest' });
      back?.focus({ preventScroll: true });
      return;
    }
    const more = target.closest<HTMLButtonElement>('[data-offers-more]');
    if (more) {
      const open = more.getAttribute('aria-expanded') !== 'true';
      for (const row of $$('[data-more]')) row.hidden = !open;
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Свернуть' : `Ещё ${$$('[data-more]').length}`;
      return;
    }
    if (target.closest('[data-goto-birthday]')) {
      selectTab('profile', false, true);
      const birthday = input('birthday');
      birthday?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      birthday?.focus({ preventScroll: true });
    }
  });

  // ── saving the profile / сохранение профиля ─────────────────────────────
  profileForm.addEventListener('input', () => {
    profileDirty = true;
    $('[data-saved]')!.textContent = '';
  });
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!me || !token) return;
    const values: ProfileInput = {
      first_name: input('first_name')!.value,
      last_name: input('last_name')!.value,
      middle_name: input('middle_name')!.value,
      gender: radio('gender') as ProfileInput['gender'],
      recovery_email: input('recovery_email')!.value,
      // a set birthday is not sent: it cannot change anyway
      // указанная дата рождения не отправляется: её всё равно не изменить
      ...(!me.profile.birthday && { birthday: input('birthday')!.value }),
    };
    const errors = profileErrors(values, me.today);
    showProfileErrors(errors);
    const first = Object.keys(errors)[0];
    if (first) {
      input(first)?.focus();
      return;
    }
    const box = $('[data-profile-error]')!;
    box.hidden = true;
    const button = $<HTMLButtonElement>('[data-submit]', profileForm)!;
    const label = $('[data-submit-label]', button)!;
    button.setAttribute('aria-busy', 'true');
    label.textContent = 'Сохраняем…';
    try {
      me.profile = { ...me.profile, ...(await api.saveProfile(token, values)) };
      profileDirty = false;
      render();
      $('[data-saved]')!.textContent = 'Сохранено';
    } catch (error) {
      const e = error as ApiError;
      if (isSignedOut(e)) {
        clearSession();
        showLogin(true);
        return;
      }
      if (Object.keys(e.fields).length) showProfileErrors(e.fields);
      $('[data-profile-error-text]')!.textContent = e.message;
      box.hidden = false;
    } finally {
      button.removeAttribute('aria-busy');
      label.textContent = 'Сохранить';
    }
  });

  // another tab signed in or out / в другой вкладке вошли или вышли
  onSessionChange(() => {
    const { session } = loadSession();
    if (!session && me) showLogin();
    else if (session && session.token !== token) void start();
  });

  void start();
}
