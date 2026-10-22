/**
 * «Вкусные баллы» in the cart drawer. Signed out — the pitch and «Войти по
 * номеру» that opens the sign-in as a step of the drawer; signed in — the
 * name and the phone go into the form, the balance is fetched, the slider
 * and the number field «Списать баллы» stay within what the server allows
 * (the balance, the programme's share of the order after the birthday
 * discount). The footer's bill gets the rows of what is taken off (the bill
 * itself — dishes, delivery, to pay — is `catalog.ts`'s, told by `onChange`);
 * the order leaves with the guest's token and `bonus_spent`, and `order-guard`
 * with the `loyalty` hook check it all again. `catalog.ts` calls in at five
 * points: the drawer step, the cart total, the order, a refused token, the receipt.
 * «Вкусные баллы» в выдвижной корзине. Не вошёл — приглашение и «Войти по
 * номеру», которое открывает вход шагом корзины; вошёл — имя и телефон
 * встают в форму, баланс подтягивается, ползунок и поле «Списать баллы»
 * держатся в пределах, которые разрешит сервер (баланс, доля программы от
 * заказа после скидки именинника). В счёт подвала встают строки того, что
 * вычтено (сам счёт — блюда, доставка, к оплате — ведёт `catalog.ts`, ему
 * сообщает `onChange`); заказ уходит с токеном гостя и `bonus_spent`, а
 * `order-guard` с хуком `loyalty` всё это проверяют ещё раз. `catalog.ts`
 * обращается сюда в пяти местах: шаг корзины, сумма, заказ, отвергнутый токен, итог.
 */
import { accountApi, displayName, isSignedOut, summarize, type Me } from '../lib/account';
import { accrualFor, birthdayDiscountFor, dayOf, maxSpend, points, type Program } from '../lib/loyalty';
import { rub } from '../lib/catalog';
import { maskPhone } from '../lib/order';
import { clearSession, loadSession, onSessionChange } from './account-session';
import { mountLogin } from './account-login';

type Step = 'cart' | 'checkout' | 'login' | 'done';

export const mountCartAccount = ({
  drawer,
  form,
  total,
  goto,
  announce,
  onChange,
}: {
  drawer: HTMLElement;
  form: HTMLFormElement;
  /** сумма корзины по ценам страницы */
  total: () => number;
  goto: (step: Step) => void;
  announce: (text: string) => void;
  /** скидка или баллы поменялись: корзина пересчитывает «К оплате» */
  onChange?: () => void;
}) => {
  const box = drawer.querySelector<HTMLElement>('[data-cart-account]');
  if (!box) return null;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = drawer) => root.querySelector<T>(selector);
  const api = accountApi(box.dataset.api ?? '');
  const fallback = JSON.parse(box.dataset.program ?? '{}') as Program;

  const out = $('[data-ca-out]', box)!;
  const inside = $('[data-ca-in]', box)!;
  const range = $<HTMLInputElement>('[data-ca-range]', box)!;
  const numberField = $<HTMLInputElement>('[data-ca-num]', box)!;
  const spendBox = $('[data-ca-spend]', box)!;
  const errorBox = $('[data-ca-error]', box)!;
  const rowDiscount = $('[data-ca-row="discount"]');
  const rowPoints = $('[data-ca-row="points"]');
  const earn = $('[data-ca-earn]');

  let me: Me | null = null;
  let token: string | null = null;
  let spend = 0;
  let loading: Promise<void> | null = null;

  const state = () => {
    if (!me) return null;
    const sum = summarize(me, fallback);
    const program = sum.program;
    const amount = total();
    // the birthday discount the server will give: the same eligibility as the hook
    // скидка именинника, которую даст сервер: те же условия, что у хука
    const win = sum.birthday;
    const early = !me.profile.birthday_set_at || (win && dayOf(me.profile.birthday_set_at) < win.from);
    const used = win ? me.orders.some((order) => Number(order.discount) > 0 && order.status !== 'cancelled' && dayOf(order.date_created) >= win.from) : true;
    const discount = program.enabled && program.birthdayDiscount > 0 && win?.inWindow && early && !used ? birthdayDiscountFor(amount, program.birthdayDiscount) : 0;
    const max = program.enabled ? maxSpend({ total: amount, balance: sum.balance, sharePercent: program.maxSharePercent, discount }) : 0;
    return { sum, program, amount, discount, max };
  };

  // the drawer's bill follows every repaint: the points and the discount are in its «К оплате»
  // счёт корзины следует за каждой перерисовкой: баллы и скидка входят в его «К оплате»
  const paint = () => {
    paintBox();
    onChange?.();
  };

  const paintBox = () => {
    errorBox.hidden = true;
    const s = state();
    out.hidden = Boolean(token);
    inside.hidden = !token;
    if (!token) {
      const amount = total();
      const first = fallback.tiers[0]?.percent ?? 0;
      const pitch = $('[data-ca-pitch]', box);
      if (pitch)
        pitch.textContent = `Войдите по номеру, чтобы копить баллы: за этот заказ начислим ≈\u00a0${points(accrualFor(amount, first))}${
          fallback.signupBonus ? `, а за первый вход — ещё ${points(fallback.signupBonus)}` : ''
        }.`;
      if (rowDiscount) rowDiscount.hidden = true;
      if (rowPoints) rowPoints.hidden = true;
      if (earn) earn.hidden = true;
      return;
    }
    $('[data-ca-loading]', box)!.hidden = Boolean(me);
    if (!s) {
      spendBox.hidden = true;
      if (rowDiscount) rowDiscount.hidden = true;
      if (rowPoints) rowPoints.hidden = true;
      return;
    }
    const name = displayName(me!.profile);
    $('[data-ca-name]', box)!.textContent = name ? `${name}, ${maskPhone(me!.profile.phone)}` : maskPhone(me!.profile.phone);
    $('[data-ca-balance]', box)!.textContent = s.program.enabled ? `на счёте ${points(s.sum.balance)}` : '';

    spend = Math.max(0, Math.min(spend, s.max));
    spendBox.hidden = s.max <= 0;
    range.max = numberField.max = String(s.max);
    range.value = numberField.value = String(spend);
    range.style.setProperty('--fill', s.max ? String(spend / s.max) : '0');
    // what holds the limit: the balance or the programme's share of the order
    // что держит предел: баланс или доля программы от заказа
    const shareCap = Math.floor(((s.amount - s.discount) * s.program.maxSharePercent) / 100);
    $('[data-ca-limit]', box)!.textContent =
      s.max < shareCap
        ? `Можно списать всё, что на счёте, — ${points(s.max)}`
        : `Баллами — не больше ${s.program.maxSharePercent}\u00a0% заказа, до ${points(s.max)}`;
    const zero = $('[data-ca-zero]', box)!;
    zero.hidden = !s.program.enabled || s.max > 0;
    zero.textContent = s.sum.balance > 0 ? 'Баллы можно списать в заказ побольше.' : 'Баллов пока нет — первые придут за этот заказ.';

    const discountNote = $('[data-ca-discount]', box)!;
    discountNote.hidden = !s.discount;
    $('[data-ca-discount-text]', box)!.textContent = `С днём рождения! Скидка ${s.program.birthdayDiscount} % уже в сумме заказа.`;

    // what the dishes cost in money after points and the discount: points are earned on it, not on the delivery
    // сколько блюда стоят деньгами после баллов и скидки: баллы начисляются с этого, а не с доставки
    const pay = s.amount - s.discount - spend;
    if (rowDiscount) {
      rowDiscount.hidden = !s.discount;
      $('[data-ca-discount-sum]')!.textContent = `−${rub(s.discount)}`;
    }
    if (rowPoints) {
      rowPoints.hidden = !spend;
      $('[data-ca-points-sum]')!.textContent = `−${rub(spend)}`;
    }
    if (earn) {
      const coming = s.program.enabled ? accrualFor(pay, s.sum.level.tier.percent) : 0;
      earn.hidden = coming <= 0;
      earn.textContent = `Начислим ≈\u00a0${points(coming)} после выполнения заказа (${s.sum.level.tier.percent}\u00a0%, уровень ${s.sum.level.tier.name})`;
    }
  };

  // the name and the phone of the guest go where they are empty — what was typed stays
  // имя и телефон гостя встают туда, где пусто, — набранное остаётся
  const prefill = () => {
    if (!me) return;
    const name = form.elements.namedItem('name') as HTMLInputElement | null;
    const phone = form.elements.namedItem('phone') as HTMLInputElement | null;
    const full = displayName(me.profile);
    if (name && !name.value.trim() && full) name.value = full;
    if (phone && phone.value.replace(/\D/g, '').length <= 1) phone.value = maskPhone(me.profile.phone);
  };

  const load = () => {
    const { session } = loadSession();
    token = session?.token ?? null;
    if (!token) {
      me = null;
      paint();
      return Promise.resolve();
    }
    paint();
    loading ??= api
      .me(token)
      .then((answer) => {
        me = answer;
        prefill();
      })
      .catch((error) => {
        if (isSignedOut(error)) {
          clearSession();
          token = null;
          me = null;
        } else {
          errorBox.hidden = false;
          errorBox.textContent = 'Баллы не загрузились — заказ можно отправить и без них.';
        }
      })
      .finally(() => {
        loading = null;
        paint();
      });
    return loading;
  };

  const set = (value: number) => {
    spend = Math.max(0, Math.floor(Number(value) || 0));
    paint();
  };
  range.addEventListener('input', () => set(Number(range.value)));
  numberField.addEventListener('input', () => {
    if (numberField.value === '') return;
    set(Number(numberField.value));
  });
  numberField.addEventListener('blur', () => paint());
  $('[data-ca-all]', box)!.addEventListener('click', () => set(state()?.max ?? 0));
  $('[data-ca-login]', box)!.addEventListener('click', () => {
    goto('login');
    loginApi?.focus();
  });
  $('[data-ca-logout]', box)!.addEventListener('click', () => {
    const was = token;
    clearSession();
    if (was) void api.logout(was).catch(() => undefined);
    announce('Вы вышли из кабинета. Заказ можно отправить и без входа.');
  });

  const loginForm = drawer.querySelector<HTMLFormElement>('[data-step="login"] [data-login]');
  const draftPhone = () => (form.elements.namedItem('phone') as HTMLInputElement | null)?.value || loadSession().session?.phone || null;
  const loginApi = loginForm
    ? mountLogin(loginForm, {
        api,
        phone: draftPhone(),
        onSignedIn: ({ created }) => {
          me = null;
          goto('checkout');
          void load().then(() => announce(created ? 'Вы вошли — кабинет создан, баллы за первый вход уже на счёте.' : 'Вы вошли — баллы можно списать.'));
        },
      })
    : null;

  // signed in or out in another tab or on the account page
  // вошли или вышли в другой вкладке или на странице кабинета
  onSessionChange(() => {
    const { session } = loadSession();
    if ((session?.token ?? null) !== token) {
      me = null;
      void load();
    }
  });

  return {
    /** шаг оформления открыт: свежий баланс и подстановка имени */
    onCheckout: () => void load(),
    /** сумма корзины поменялась: пересчитать предел */
    refresh: () => paint(),
    /** что добавить к заказу: токен и баллы к списанию */
    extras: () => (token ? { token, bonus_spent: me ? spend : 0 } : { token: null, bonus_spent: 0 }),
    /** что снимается с блюд в счёте: скидка именинника и баллы (без входа — ничего) */
    deductions: () => {
      if (!token || !me) return { discount: 0, points: 0 };
      return { discount: state()?.discount ?? 0, points: spend };
    },
    /** сервер отверг токен: выйти и сказать об этом */
    signedOut: () => {
      clearSession();
      token = null;
      me = null;
      paint();
    },
    /**
     * «Заказ принят»: what will be earned. What was taken off and what is to pay
     * stand in the screen's own rows (`catalog.ts`), next to the delivery.
     * «Заказ принят»: что начислим. Что списано и сколько к оплате — в строках
     * самого экрана (`catalog.ts`), рядом с доставкой.
     */
    done: (spent: number) => {
      const line = $('[data-ca-done]');
      if (!line) return;
      const s = state();
      const discount = s?.discount ?? 0;
      // points are earned on what the dishes cost in money, not on the delivery
      // баллы начисляются с того, что блюда стоят деньгами, а не с доставки
      const pay = s ? s.amount - discount - spent : 0;
      const coming = s && s.program.enabled ? accrualFor(pay, s.sum.level.tier.percent) : 0;
      line.hidden = !coming;
      $('[data-ca-done-text]', line)!.textContent = coming ? `Начислим ≈\u00a0${points(coming)}, когда заказ будет выполнен.` : '';
      // a guest without a name in the profile keeps the one typed in the order
      // гость без имени в профиле сохраняет то, что ввёл в заказе
      const typed = (form.elements.namedItem('name') as HTMLInputElement | null)?.value.trim();
      if (token && me && !me.profile.first_name && !me.profile.last_name && typed)
        void api.saveProfile(token, { first_name: typed.slice(0, 60) }).catch(() => undefined);
      spend = 0;
      me = null;
    },
  };
};
