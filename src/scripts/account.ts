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
  paidOf,
  profileErrors,
  relativeDays,
  repeatOrder,
  summarize,
  txTitle,
  type Me,
  type Order,
  type ProfileInput,
  type RawTx,
} from '../lib/account';
import { addDays, daysBetween, dayOf, points, type Program } from '../lib/loyalty';
import { CART_KEY, parseCart } from '../lib/cart';
import { CHECKOUT_KEY, addressLine, maskPhone } from '../lib/order';
import { clearSession, loadSession, onSessionChange, storage, touchSession } from './account-session';
import { mountLogin } from './account-login';
import repeatIcon from '../assets/icons/repeat.svg?raw';
import giftIcon from '../assets/icons/gift.svg?raw';
import calendarIcon from '../assets/icons/calendar.svg?raw';

type Offer = { title: string; text: string; place: string | null; until: string | null };
type PageData = {
  api: string;
  program: Program;
  catalog: string | null;
  phone: string;
  phoneHref: string;
  places: Record<string, string>;
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
  const orderRow = (order: Order, percent: number) => {
    const status = ORDER_STATUS[order.status] ?? order.status;
    const items = order.items ?? [];
    const names = items.map((item) => `${item.title} × ${item.qty}`);
    const shown = names.slice(0, 3).join(', ');
    const more = names.length > 3 ? ` и ещё ${names.length - 3}` : '';
    const how =
      order.fulfillment === 'pickup'
        ? `самовывоз${order.place && data.places[order.place] ? `, ${data.places[order.place]}` : ''}`
        : `доставка${order.address ? `, ${addressLine(order)}` : ''}`;
    const paid = paidOf(order);
    const sums = [
      `<div><dt>Сумма</dt><dd class="tnum">${rub(order.total)}</dd></div>`,
      Number(order.discount) > 0 ? `<div><dt>Скидка</dt><dd class="tnum">−${rub(Number(order.discount))}</dd></div>` : '',
      Number(order.bonus_spent) > 0 ? `<div><dt>Баллами</dt><dd class="tnum">−${num(Number(order.bonus_spent))}</dd></div>` : '',
      paid !== order.total ? `<div><dt>К оплате</dt><dd class="tnum">${rub(paid)}</dd></div>` : '',
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
    return `<li class="acc-order">
        <div class="acc-order__top">
          <p class="acc-order__no">Заказ <span class="tnum">${esc(order.number)}</span></p>
          <span class="acc-status" data-status="${esc(order.status)}">${esc(status)}</span>
        </div>
        <p class="acc-order__when">${esc(dateText(order.date_created, me!.today))} · ${esc(how)}</p>
        <p class="acc-order__items">${esc(shown + more)}</p>
        <div class="acc-order__bottom">
          <dl class="acc-order__sums">${sums}</dl>
          ${pts}
          ${items.length && data.catalog ? `<button type="button" class="btn btn--secondary btn--sm acc-order__again" data-repeat="${order.id}">${ico(repeatIcon)}Повторить</button>` : ''}
        </div>
      </li>`;
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
