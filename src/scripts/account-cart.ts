/**
 * «Вкусные баллы» in the cart drawer. Signed out — the pitch and «Войти по
 * номеру» that opens the sign-in as a step of the drawer; signed in — the
 * name, the phone and the mail for the receipt go into the form, the balance
 * is fetched, the slider
 * and the number field «Списать баллы» stay within what the server allows
 * (the balance, the programme's share of the order after the birthday
 * discount). The footer's bill gets the rows of what is taken off (the bill
 * itself — dishes, delivery, to pay — is `catalog.ts`'s, told by `onChange`);
 * the order leaves with the guest's token and `bonus_spent`, and `order-guard`
 * with the `loyalty` hook check it all again. The saved addresses ride along:
 * chips above the street fill it in one tap, a new address can be saved to
 * the account after the order. `catalog.ts` calls in at six points: the
 * drawer step, the cart total, the address fields, the order, a refused
 * token, the receipt.
 * «Вкусные баллы» в выдвижной корзине. Не вошёл — приглашение и «Войти по
 * номеру», которое открывает вход шагом корзины; вошёл — имя, телефон и
 * почта для чека встают в форму, баланс подтягивается, ползунок и поле «Списать баллы»
 * держатся в пределах, которые разрешит сервер (баланс, доля программы от
 * заказа после скидки именинника). В счёт подвала встают строки того, что
 * вычтено (сам счёт — блюда, доставка, к оплате — ведёт `catalog.ts`, ему
 * сообщает `onChange`); заказ уходит с токеном гостя и `bonus_spent`, а
 * `order-guard` с хуком `loyalty` всё это проверяют ещё раз. Рядом —
 * сохранённые адреса: чипы над улицей ставят её одним касанием, новый адрес
 * после заказа можно сохранить в кабинет. `catalog.ts` обращается сюда в
 * шести местах: шаг корзины, сумма, поля адреса, заказ, отвергнутый токен, итог.
 */
import { ApiError, accountApi, displayName, isSignedOut, summarize, type Me } from '../lib/account';
import { toCheckoutFields, type SavedAddress } from '../lib/addresses';
import {
  NEW_ADDRESS,
  OWN_LABEL,
  addressToSave,
  chipFor,
  chipLine,
  labelChoice,
  labelToSave,
  saveOffer,
  type CheckoutAddress,
  type SentAddress,
} from '../lib/cart-addresses';
import { accrualFor, birthdayDiscountFor, dayOf, maxSpend, points, type Program } from '../lib/loyalty';
import { rub } from '../lib/catalog';
import { maskPhone } from '../lib/order';
import { isRuEmail } from '../lib/email';
import { clearSession, loadSession, onSessionChange } from './account-session';
import { mountLogin } from './account-login';

type Step = 'cart' | 'checkout' | 'login' | 'done';

/** Адресные поля формы корзины: улица и дом, затем поля для курьера. */
const ADDRESS_FIELDS = ['address', 'flat', 'entrance', 'floor', 'intercom'] as const;

export const mountCartAccount = ({
  drawer,
  form,
  total,
  goto,
  announce,
  onChange,
  setAddress,
  clearAddress,
}: {
  drawer: HTMLElement;
  form: HTMLFormElement;
  /** сумма корзины по ценам страницы */
  total: () => number;
  goto: (step: Step) => void;
  announce: (text: string) => void;
  /** скидка или баллы поменялись: корзина пересчитывает «К оплате» */
  onChange?: () => void;
  /** выбран сохранённый адрес: поставить улицу и поля для курьера, посчитать доставку */
  setAddress?: (fields: CheckoutAddress) => void;
  /** «Новый адрес»: очистить улицу и поля для курьера */
  clearAddress?: () => void;
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

  // ── saved addresses / сохранённые адреса ──
  const addrs = $('[data-ca-addrs]');
  const addrsList = $('[data-ca-addrs-list]');
  const newChip = addrsList?.querySelector('input[name="saved_address"]')?.closest('label') ?? null;
  const save = $('[data-ca-save]');
  const saveRow = $('[data-ca-save-row]');
  const saveCheck = $<HTMLInputElement>('[data-ca-save-check]');
  const saveLabels = $('[data-ca-save-labels]');
  const saveChips = saveLabels ? $('[role="radiogroup"]', saveLabels) : null;
  const ownBox = $('[data-ca-save-own]');
  const ownInput = $<HTMLInputElement>('#ca-save-own');
  const saveLimit = $('[data-ca-save-limit]');
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | null;

  // the list of the guest whose token `savedFor` is; an older server sends none — then nothing is offered
  // список гостя с токеном `savedFor`; старый сервер его не присылает — тогда ничего не предлагается
  let saved: SavedAddress[] = [];
  let savedFor: string | null = null;
  // the server has no place for addresses yet (503 ADDRESSES_OFF): stop offering to save
  // у сервера ещё нет места для адресов (503 ADDRESSES_OFF): больше не предлагать сохранить
  let saveOff = false;
  // «Новый адрес» asked for; the guest chose or typed an address (the first saved one stays out then); a label chosen
  // попросили «Новый адрес»; гость выбрал или набрал адрес (первый сохранённый тогда не подставляется); выбрана метка
  let wantsNew = false;
  let addressTouched = false;
  let labelTouched = false;
  // a tap on a chip moves on to the field; the arrows stay in the chips
  // касание чипа ведёт дальше в поле; стрелки остаются в чипах
  let pointer = false;
  let drawn = '';

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

  const fieldsNow = (): CheckoutAddress => {
    const value = (name: (typeof ADDRESS_FIELDS)[number]) => field(name)?.value ?? '';
    return { address: value('address'), flat: value('flat'), entrance: value('entrance'), floor: value('floor'), intercom: value('intercom') };
  };

  /** Чипы сохранённых адресов перед «Новым адресом» — заново, только когда список поменялся. */
  const drawChips = (list: SavedAddress[]) => {
    const key = JSON.stringify(list.map((a) => [a.id, a.label, a.address, a.flat]));
    if (!addrsList || !newChip || key === drawn) return;
    drawn = key;
    for (const old of addrsList.querySelectorAll('[data-ca-addr]')) old.remove();
    const nodes = list.map((a) => {
      const chip = document.createElement('label');
      chip.className = 'ca-addr';
      chip.dataset.caAddr = a.id;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'saved_address';
      input.value = a.id;
      const name = document.createElement('span');
      name.className = 'ca-addr__name';
      name.textContent = a.label;
      const line = document.createElement('small');
      line.className = 'ca-addr__line';
      line.textContent = chipLine(a);
      chip.append(input, name, line);
      return chip;
    });
    newChip.before(...nodes);
  };

  /** Чипы меток: занятые «Дом» и «Работа» уходят; выбор по умолчанию — пока гость не выбрал сам. */
  const drawLabels = (list: SavedAddress[]) => {
    if (!saveLabels) return;
    const choice = labelChoice(list);
    for (const chip of saveLabels.querySelectorAll<HTMLElement>('[data-ca-preset]')) chip.hidden = !choice.presets.includes(chip.dataset.caPreset ?? '');
    // no preset left: «Своя» alone is no choice — its field speaks for itself
    // заготовок не осталось: одна «Своя» — не выбор, говорит её поле
    if (saveChips) saveChips.hidden = !choice.presets.length;
    if (labelTouched) return;
    for (const input of saveLabels.querySelectorAll<HTMLInputElement>('input[name="save_label"]')) input.checked = input.value === choice.chosen;
    if (ownInput) ownInput.value = choice.own;
    if (ownBox) ownBox.hidden = choice.chosen !== OWN_LABEL;
  };

  // signed out or another guest: nothing of the previous one stays on the screen
  // вышли или вошёл другой гость: ничего от прежнего не остаётся на экране
  const forget = () => {
    saved = [];
    savedFor = null;
    wantsNew = false;
    addressTouched = false;
    labelTouched = false;
    if (saveCheck) saveCheck.checked = false;
  };

  /**
   * The chips and the save block follow the fields: the chip of the saved
   * address they are (or «Новый адрес»), the tick only for an address not
   * saved yet, the limit line when five are saved.
   * Чипы и блок сохранения следуют за полями: чип того сохранённого адреса,
   * которому они соответствуют (или «Новый адрес»), галочка — только для
   * ещё не сохранённого, строка о пределе — когда сохранено пять.
   */
  const paintAddresses = () => {
    if (!token) forget();
    const on = Boolean(token) && savedFor === token;
    const list = on ? saved : [];
    const fields = fieldsNow();
    if (addrs && addrsList) {
      addrs.hidden = !list.length;
      drawChips(list);
      const chip = list.length ? chipFor(list, fields, wantsNew) : null;
      for (const input of addrsList.querySelectorAll<HTMLInputElement>('input[name="saved_address"]')) input.checked = input.value === chip;
    }
    if (save) {
      const offer = on && !saveOff ? saveOffer(list, fields) : 'none';
      save.hidden = offer === 'none';
      if (saveRow) saveRow.hidden = offer !== 'offer';
      if (saveLimit) saveLimit.hidden = offer !== 'limit';
      if (saveLabels) saveLabels.hidden = offer !== 'offer' || !saveCheck?.checked;
      if (offer === 'offer') drawLabels(list);
    }
  };

  // the drawer's bill follows every repaint: the points and the discount are in its «К оплате»
  // счёт корзины следует за каждой перерисовкой: баллы и скидка входят в его «К оплате»
  const paint = () => {
    paintBox();
    paintAddresses();
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
      // points spent in this order close its accrual (23.10.2026)
      // списанные в этом заказе баллы закрывают начисление (23.10.2026)
      const coming = s.program.enabled && !spend ? accrualFor(pay, s.sum.level.tier.percent) : 0;
      earn.hidden = coming <= 0 && !spend;
      earn.textContent = spend
        ? 'За заказ с оплатой баллами новые баллы не начисляются.'
        : `Начислим ≈\u00a0${points(coming)} после выполнения заказа (${s.sum.level.tier.percent}\u00a0%, уровень ${s.sum.level.tier.name})`;
    }
  };

  // the name, the phone and the account's mail (for the receipt) go where they are empty —
  // what was typed stays; the first saved address goes to an empty delivery address — a
  // draft or the guest's own choice comes first
  // имя, телефон и почта кабинета (для чека) встают туда, где пусто, — набранное остаётся;
  // первый сохранённый адрес встаёт в пустой адрес доставки — черновик или выбор самого
  // гостя важнее
  const prefill = () => {
    if (!me) return;
    const name = form.elements.namedItem('name') as HTMLInputElement | null;
    const phone = form.elements.namedItem('phone') as HTMLInputElement | null;
    const email = form.elements.namedItem('email') as HTMLInputElement | null;
    const full = displayName(me.profile);
    if (name && !name.value.trim() && full) name.value = full;
    if (phone && phone.value.replace(/\D/g, '').length <= 1) phone.value = maskPhone(me.profile.phone);
    // only a mail the order would take: an old non-Russian one would greet the guest with an error
    // только почта, которую примет заказ: старая нероссийская встретила бы гостя ошибкой
    const mail = me.profile.recovery_email?.trim().toLowerCase();
    if (email && !email.value.trim() && mail && isRuEmail(mail)) email.value = mail;

    const list = me.profile.addresses;
    saved = Array.isArray(list) ? list : [];
    savedFor = Array.isArray(list) ? token : null;
    const delivery = form.querySelector<HTMLInputElement>('input[name="fulfillment"]:checked')?.value !== 'pickup';
    const empty = Object.values(fieldsNow()).every((value) => !value.trim());
    if (saved[0] && delivery && empty && !addressTouched) setAddress?.(toCheckoutFields(saved[0]));
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

  // a saved address chosen: the street and the courier fields in one tap, the delivery counted;
  // «Новый адрес»: the fields emptied, a tap goes on to the street
  // выбран сохранённый адрес: улица и поля для курьера одним касанием, доставка посчитана;
  // «Новый адрес»: поля очищены, касание ведёт дальше, в улицу
  for (const group of [addrsList, saveLabels]) {
    group?.addEventListener('pointerdown', () => (pointer = true));
    group?.addEventListener('keydown', () => (pointer = false));
  }
  addrsList?.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== 'saved_address') return;
    addressTouched = true;
    if (input.value === NEW_ADDRESS) {
      wantsNew = true;
      clearAddress?.();
      paintAddresses();
      if (pointer) field('address')?.focus();
      return;
    }
    const chosen = saved.find((a) => a.id === input.value);
    if (!chosen) return;
    wantsNew = false;
    setAddress?.(toCheckoutFields(chosen));
    paintAddresses();
  });
  // typed by hand: the chips and the save block follow
  // набрано руками: чипы и блок сохранения следуют за полями
  form.addEventListener('input', (event) => {
    const name = (event.target as HTMLInputElement).name;
    if (name === 'save_label_own') labelTouched = true;
    if (!(ADDRESS_FIELDS as readonly string[]).includes(name)) return;
    addressTouched = true;
    paintAddresses();
  });
  saveCheck?.addEventListener('change', () => paintAddresses());
  saveLabels?.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== 'save_label') return;
    labelTouched = true;
    const own = input.value === OWN_LABEL;
    if (ownBox) ownBox.hidden = !own;
    if (own && pointer) ownInput?.focus();
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
    /** адрес в полях поменялся не руками (подсказка дома, сохранённый адрес): чипы следуют */
    addressChanged: () => paintAddresses(),
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
     * The address goes to the account when the guest ticked it — without
     * waiting: the order is accepted whatever the answer; on success a line
     * under «Куда» says so, a refusal (no place for addresses yet, five
     * saved, no network) leaves the screen as it is.
     * «Заказ принят»: что начислим. Что списано и сколько к оплате — в строках
     * самого экрана (`catalog.ts`), рядом с доставкой. Адрес уходит в
     * кабинет, если гость поставил галочку, — без ожидания: заказ принят при
     * любом ответе; при успехе об этом говорит строка под «Куда», отказ (места
     * для адресов ещё нет, сохранено пять, нет сети) экран не трогает.
     */
    done: (spent: number, sent?: SentAddress) => {
      const savedLine = $('[data-ca-addr-done]');
      if (savedLine) savedLine.hidden = true;
      if (token && savedFor === token && sent && saveCheck?.checked && !saveOff) {
        const chosen = saveLabels?.querySelector<HTMLInputElement>('input[name="save_label"]:checked')?.value ?? labelChoice(saved).chosen;
        const input = addressToSave(labelToSave(chosen, ownInput?.value ?? '', saved), sent, saved);
        const was = token;
        if (input)
          void api
            .addAddress(was, input)
            .then(({ addresses }) => {
              if (token !== was) return;
              saved = addresses;
              savedFor = was;
              if (saveCheck) saveCheck.checked = false;
              labelTouched = false;
              paintAddresses();
              if (!savedLine) return;
              $('[data-ca-addr-done-text]', savedLine)!.textContent = `Сохранили в кабинете как «${input.label}»`;
              savedLine.hidden = false;
            })
            .catch((error) => {
              if (error instanceof ApiError && error.code === 'ADDRESSES_OFF') {
                saveOff = true;
                paintAddresses();
              }
            });
      }
      const line = $('[data-ca-done]');
      if (!line) return;
      const s = state();
      const discount = s?.discount ?? 0;
      // points are earned on what the dishes cost in money, not on the delivery
      // баллы начисляются с того, что блюда стоят деньгами, а не с доставки
      const pay = s ? s.amount - discount - spent : 0;
      const coming = s && s.program.enabled && !spent ? accrualFor(pay, s.sum.level.tier.percent) : 0;
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
