/**
 * Online payment on the catalog page. The cart script (`catalog.ts`) calls two
 * things: `withPayment` adds the guest's choice to the order, `payAfterOrder`
 * takes over once the order is saved — asks Directus for the bank's page
 * (`POST /pay/start`) and leaves for it. Everything else lives here: the
 * choice shown only when the admin turned payments on, the way back from the
 * bank (`/catalog/?pay=ok|fail|wait&order=…`), «try again», «on delivery», the
 * bank that does not answer and the order that still waits for payment.
 * Онлайн-оплата на странице каталога. Скрипт корзины (`catalog.ts`) зовёт две
 * вещи: `withPayment` добавляет выбор гостя в заказ, `payAfterOrder` берёт
 * управление, когда заказ сохранён, — просит у Directus страницу банка
 * (`POST /pay/start`) и уходит на неё. Всё остальное здесь: выбор, который
 * видно, только когда оплату включили в админке, возвращение из банка
 * (`/catalog/?pay=ok|fail|wait&order=…`), «ещё раз», «при получении», банк,
 * который не отвечает, и заказ, который всё ещё ждёт оплаты.
 */
import {
  PAY_KEY,
  failReason,
  parsePayConfig,
  parsePayRecord,
  readPayReturn,
  type PayConfig,
  type PayRecord,
} from '../lib/payment';
import { rub } from '../lib/catalog';
import type { OrderPayload } from '../lib/order';

type State = 'going' | 'paid' | 'failed' | 'unavailable' | 'wait' | 'waitlong' | 'pending' | 'offline';

const TEST_KEY = 'vk-paytest';
const CHOICE_KEY = 'vk-pay-choice';

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
      /* no storage — the payment still works, only the way back forgets / без хранилища оплата работает, только возврат забывает */
    }
  },
  drop: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to drop / нечего убирать */
    }
  },
};

const esc = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const drawer = document.getElementById('cart') as HTMLDialogElement | null;
const step = drawer?.querySelector<HTMLElement>('[data-pay-step]') ?? null;
const choice = drawer?.querySelector<HTMLFieldSetElement>('[data-pay-choice]') ?? null;
const api = step?.dataset.payApi ?? '';

let config: PayConfig = parsePayConfig(null);
let offered = false;

// ── the test flag / тестовый флаг ────────────────────────────────────────────
// `?paytest=1` marks this device as a tester's: in test mode only it sees the
// online option, guests do not. `?paytest=0` takes the mark off.
// `?paytest=1` помечает устройство как тестовое: в тестовом режиме онлайн-оплату
// видит только оно, гости — нет. `?paytest=0` снимает пометку.
{
  const flag = new URLSearchParams(location.search).get('paytest');
  if (flag === '1') store.set(TEST_KEY, '1');
  if (flag === '0') store.drop(TEST_KEY);
}
const tester = () => store.get(TEST_KEY) === '1';

// ── the choice in the form / выбор в форме ───────────────────────────────────

const chosen = () => choice?.querySelector<HTMLInputElement>('input[name="payment"]:checked')?.value ?? 'on_delivery';
const online = () => offered && chosen() === 'online';

const submitLabel = drawer?.querySelector<HTMLElement>('[data-submit-label]') ?? null;
const SEND = 'Отправить заказ';
const PAY = 'Перейти к оплате';
// the cart script writes «Отправить заказ» back after a send; online, the
// button says where it leads
// скрипт корзины после отправки пишет обратно «Отправить заказ»; при онлайн-
// оплате кнопка говорит, куда ведёт
const paintLabel = () => {
  // the note is about paying online; on delivery it has nothing to say
  // пояснение — про онлайн-оплату; при получении ему нечего сказать
  const note = choice?.querySelector<HTMLElement>('[data-pay-text="note"]');
  if (note) note.hidden = !online();
  if (!submitLabel) return;
  const text = submitLabel.textContent ?? '';
  if (online() && text === SEND) submitLabel.textContent = PAY;
  if (!online() && text === PAY) submitLabel.textContent = SEND;
};
if (submitLabel) new MutationObserver(paintLabel).observe(submitLabel, { childList: true, characterData: true, subtree: true });

const offer = (next: PayConfig) => {
  config = next;
  offered = Boolean(choice) && next.online && (!next.test || tester());
  if (!choice) return;
  choice.hidden = !offered;
  if (!offered) return;
  for (const node of choice.querySelectorAll<HTMLElement>('[data-pay-text]')) {
    const key = node.dataset.payText as keyof PayConfig['texts'];
    if (next.texts[key]) node.textContent = next.texts[key];
  }
  const test = choice.querySelector<HTMLElement>('[data-pay-test]');
  if (test) test.hidden = !next.test;
  const onDelivery = choice.querySelector<HTMLElement>('[data-pay-on-delivery]');
  if (onDelivery) onDelivery.hidden = !next.onDelivery;
  const remembered = store.get(CHOICE_KEY);
  const wanted = !next.onDelivery ? 'online' : remembered === 'on_delivery' ? 'on_delivery' : 'online';
  const input = choice.querySelector<HTMLInputElement>(`input[name="payment"][value="${wanted}"]`);
  if (input) input.checked = true;
  paintLabel();
};

choice?.addEventListener('change', () => {
  store.set(CHOICE_KEY, chosen());
  paintLabel();
});

const loadConfig = async () => {
  if (!api) return;
  try {
    const response = await fetch(`${api}/config`, { signal: AbortSignal.timeout(8000) });
    offer(parsePayConfig(response.ok ? await response.json() : null));
  } catch {
    // no answer — no online payment: the order still goes, paid on delivery
    // нет ответа — нет онлайн-оплаты: заказ всё равно уходит, оплата при получении
    offer(parsePayConfig(null));
  }
};

/** Заказ с выбором оплаты; без показанного выбора — как был (сервер поставит «при получении»). */
export const withPayment = <T extends OrderPayload>(payload: T): T & { payment_method?: 'online' | 'on_delivery' } =>
  offered ? { ...payload, payment_method: online() ? 'online' : 'on_delivery' } : payload;

// ── the payment step / шаг оплаты ────────────────────────────────────────────

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => step?.querySelector<T>(selector) ?? null;
const announcer = document.querySelector<HTMLElement>('[data-announce]');
const announce = (text: string) => {
  if (!announcer) return;
  announcer.textContent = '';
  requestAnimationFrame(() => (announcer.textContent = text));
};

const saveRecord = (record: PayRecord) => store.set(PAY_KEY, JSON.stringify(record));
const readRecord = () => parsePayRecord(store.get(PAY_KEY), Date.now());

const TITLES: Record<State, string> = {
  going: 'Переходим к оплате',
  paid: 'Заказ оплачен',
  // «не» stays with its verb: «ОПЛАТА / НЕ ПРОШЛА», not «ОПЛАТА НЕ / ПРОШЛА»
  // «не» держится за глагол: «ОПЛАТА / НЕ ПРОШЛА», а не «ОПЛАТА НЕ / ПРОШЛА»
  failed: 'Оплата не\u00a0прошла',
  unavailable: 'Оплата не\u00a0открылась',
  wait: 'Проверяем оплату',
  waitlong: 'Банк ещё не ответил',
  pending: 'Заказ ждёт оплаты',
  offline: 'Заказ принят',
};

let shown: { record: PayRecord | null; number: string } | null = null;

/** Показать шаг оплаты с состоянием; заказ — из записи на устройстве или только номер. */
const show = (state: State, record: PayRecord | null, number: string, lead: string) => {
  if (!drawer || !step) return;
  shown = { record, number };
  step.dataset.state = state;
  for (const section of drawer.querySelectorAll<HTMLElement>('[data-step]')) section.hidden = section !== step;
  const back = drawer.querySelector<HTMLElement>('[data-back]');
  if (back) back.hidden = true;
  const head = drawer.querySelector<HTMLElement>('[data-drawer-title]');
  if (head) head.textContent = 'Оплата';

  $('[data-pay-title]')!.textContent = TITLES[state];
  $('[data-pay-number]')!.textContent = number;
  $('[data-pay-lead]')!.innerHTML = lead;
  $('[data-pay-progress]')!.hidden = !(state === 'going' || state === 'wait');

  const lines = record?.number === number ? record.lines : [];
  const list = $('[data-pay-lines]')!;
  list.hidden = !lines.length;
  list.innerHTML = lines
    .map((line) => `<li><span>${esc(line.title)} × ${line.qty}</span><b class="tnum">${rub(line.sum)}</b></li>`)
    .join('');
  const sum = $('[data-pay-sum]')!;
  const total = record?.number === number ? record.total : 0;
  sum.hidden = !total;
  $('[data-pay-sum-label]')!.textContent = state === 'paid' ? 'Оплачено' : state === 'offline' ? 'Сумма заказа' : 'К оплате';
  $('[data-pay-total]')!.textContent = total ? rub(total) : '';

  // what can be done from here / что отсюда можно сделать
  const canRetry = Boolean(record?.number === number && record.phone) && config.online;
  const canOffline = Boolean(record?.number === number && record.phone) && config.onDelivery;
  const retry = $<HTMLButtonElement>('[data-pay-retry]')!;
  retry.hidden = !(['failed', 'unavailable', 'pending'].includes(state) && canRetry);
  $('[data-pay-retry-label]')!.textContent = state === 'pending' ? 'Перейти к оплате' : 'Оплатить ещё раз';
  retry.removeAttribute('aria-busy');
  retry.disabled = false;
  const offline = $('[data-pay-offline]')!;
  offline.hidden = !(['failed', 'unavailable', 'pending'].includes(state) && canOffline);
  $('[data-pay-recheck]')!.hidden = state !== 'waitlong' || !record?.phone;
  // one main action: with «pay again» on screen the way back is the cross in
  // the corner; it becomes a button only when there is nothing else to do
  // одно главное действие: при «оплатить ещё раз» путь назад — крестик в углу;
  // кнопкой он становится, только когда больше делать нечего
  $('[data-pay-close]')!.hidden = ['going', 'wait'].includes(state) || !retry.hidden || !offline.hidden;
  $('[data-pay-go]')!.hidden = true;
  const foot = $('.pay-step__foot')!;
  foot.hidden = ![...foot.children].some((node) => !(node as HTMLElement).hidden);

  if (!drawer.open) drawer.showModal();
  $('[data-pay-title]')?.focus({ preventScroll: true });
  announce(`${TITLES[state]}. Заказ ${number}.`);
};

const leadFor = (state: State, record: PayRecord | null, why: string | null = null, message = '') => {
  const phone = record?.phone ? `<b class="tnum">${esc(record.phone)}</b>` : '';
  switch (state) {
    case 'going':
      return 'Заказ сохранён. Открываем защищённую страницу банка — там вводят карту.';
    case 'paid':
      return esc(config.texts.paid);
    case 'failed':
      return `${esc(failReason(why))} ${esc(config.texts.failed)}`;
    case 'unavailable':
      return esc(message || 'Банк сейчас не отвечает. Заказ принят — попробуйте оплатить через минуту или оплатите при получении.');
    case 'wait':
      return 'Банк ещё подтверждает платёж — обычно это меньше минуты.';
    case 'waitlong':
      return 'Банк пока не прислал ответ. Если деньги списались, заказ отметится оплаченным сам — менеджер увидит это при звонке.';
    case 'pending':
      return 'Заказ сохранён, но ещё не оплачен. Оплатите его сейчас или при получении.';
    case 'offline':
      return phone
        ? `Оплата при получении. Перезвоним на ${phone}, чтобы подтвердить состав, сумму, адрес и время.`
        : 'Оплата при получении. Перезвоним, чтобы подтвердить состав, сумму, адрес и время.';
  }
};

const post = async (path: string, body: unknown, timeout = 25_000) => {
  const response = await fetch(`${api}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data: (data ?? {}) as Record<string, unknown> };
};

const networkLead = (error: unknown) =>
  (error as Error)?.name === 'TimeoutError'
    ? 'Банк долго не отвечает. Заказ принят — попробуйте оплатить ещё раз или оплатите при получении.'
    : 'Не получилось связаться с сервером. Заказ принят — проверьте интернет и попробуйте ещё раз или оплатите при получении.';

/** Только https (и http для локальной заглушки): в адрес банка не пролезет `javascript:`. */
const safeUrl = (value: unknown) => {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'https:' || (url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) return url.toString();
  } catch {
    /* not an address / не адрес */
  }
  return null;
};

let starting = false;
const start = async (record: PayRecord) => {
  if (starting || !api) return;
  starting = true;
  const retry = $<HTMLButtonElement>('[data-pay-retry]');
  if (retry && !retry.hidden) {
    retry.setAttribute('aria-busy', 'true');
    retry.disabled = true;
  }
  show('going', record, record.number, leadFor('going', record));
  try {
    const { ok, data } = await post('start', { number: record.number, phone: record.phone, path: location.pathname });
    // the server may have added a tail to a number that was taken («1910-8522-83»):
    // from here on the guest sees the order's real number
    // сервер мог добавить хвост к занятому номеру («1910-8522-83»): дальше гость
    // видит настоящий номер заказа
    if (ok && typeof data.number === 'string' && /^\d{4}-\d{4}(?:-\d{2})?$/.test(data.number) && data.number !== record.number) {
      record = { ...record, number: data.number };
      saveRecord(record);
      if (shown) shown.record = record;
      $('[data-pay-number]')!.textContent = record.number;
    }
    const url = safeUrl(data.url);
    if (ok && url) {
      saveRecord({ ...record, state: 'redirected', at: Date.now() });
      // if the browser keeps us here (a blocked navigation, a slow bank), the link is one tap away
      // если браузер задержит нас здесь (запрет перехода, медленный банк), ссылка в одном нажатии
      const go = $<HTMLAnchorElement>('[data-pay-go]');
      if (go) {
        go.href = url;
        setTimeout(() => {
          if (step?.dataset.state !== 'going') return;
          go.hidden = false;
          go.parentElement!.hidden = false;
        }, 5000);
      }
      location.assign(url);
      return;
    }
    if (ok && data.paid) {
      saveRecord({ ...record, state: 'done' });
      show('paid', record, record.number, leadFor('paid', record));
      return;
    }
    show('unavailable', record, record.number, leadFor('unavailable', record, null, String(data.message ?? '')));
  } catch (error) {
    show('unavailable', record, record.number, esc(networkLead(error)));
  } finally {
    starting = false;
  }
};

/**
 * Right after the order is saved (the cart script already showed «Заказ
 * принят»): online — remember the order and go to the bank; otherwise the
 * «accepted» screen stays as it is.
 * Сразу после сохранения заказа (скрипт корзины уже показал «Заказ
 * принят»): онлайн — запомнить заказ и уйти в банк; иначе экран «принят»
 * остаётся как есть.
 */
export const payAfterOrder = (number: string, payload: OrderPayload) => {
  if (!online() || !api) return false;
  const record: PayRecord = {
    number,
    phone: payload.phone,
    total: payload.total,
    lines: payload.items.map((line) => ({
      title: [line.title, [line.variant, line.filling].filter(Boolean).join(', ')].filter(Boolean).join(', '),
      qty: line.qty,
      sum: line.sum,
    })),
    at: Date.now(),
    state: 'started',
  };
  saveRecord(record);
  void start(record);
  return true;
};

// ── checking and the way back / проверка и возвращение ───────────────────────

let polling = 0;
const poll = async (record: PayRecord | null, number: string, rounds = 12) => {
  const id = ++polling;
  if (!record?.phone) {
    show('waitlong', record, number, leadFor('waitlong', record));
    return;
  }
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, i === 0 ? 1500 : 4000));
    if (id !== polling || step?.dataset.state !== 'wait') return;
    try {
      const { ok, data } = await post('status', { number: record.number, phone: record.phone }, 15_000);
      if (ok && data.status === 'paid') {
        saveRecord({ ...record, state: 'done' });
        show('paid', record, number, leadFor('paid', record));
        return;
      }
      if (ok && (data.status === 'failed' || data.status === 'refunded')) {
        show('failed', record, number, leadFor('failed', record, 'declined'));
        return;
      }
    } catch {
      /* the next round asks again / следующий круг спросит снова */
    }
  }
  if (id === polling) show('waitlong', record, number, leadFor('waitlong', record));
};

const waitFor = (record: PayRecord | null, number: string) => {
  show('wait', record, number, leadFor('wait', record));
  void poll(record, number);
};

/** `?pay=ok|fail|wait&order=…` — банк вернул гостя; адрес очищается, чтобы перезагрузка не показала итог снова. */
const handleReturn = () => {
  const back = readPayReturn(location.search);
  if (!back) return false;
  const url = new URL(location.href);
  for (const key of ['pay', 'order', 'why']) url.searchParams.delete(key);
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  const stored = readRecord();
  const record = stored && stored.number === back.number ? stored : null;
  if (back.state === 'ok') {
    if (record) saveRecord({ ...record, state: 'done' });
    show('paid', record, back.number, leadFor('paid', record));
  } else if (back.state === 'fail') {
    if (record) saveRecord({ ...record, state: 'done' });
    show('failed', record, back.number, leadFor('failed', record, back.why));
  } else waitFor(record, back.number);
  return true;
};

/**
 * The guest came back without the bank's address (the «back» button, a closed
 * tab reopened): if the order left for the bank in the last two hours, ask the
 * server what became of it and say so once.
 * Гость вернулся не по адресу банка (кнопка «назад», снова открытая вкладка):
 * если заказ ушёл в банк в последние два часа, спросить у сервера, что с ним,
 * и сказать об этом один раз.
 */
const handleUnfinished = async () => {
  const record = readRecord();
  if (!record || record.state !== 'redirected' || Date.now() - record.at > 2 * 60 * 60 * 1000 || !api) return;
  try {
    const { ok, data } = await post('status', { number: record.number, phone: record.phone }, 15_000);
    if (!ok) return;
    if (data.status === 'paid') {
      saveRecord({ ...record, state: 'done' });
      show('paid', record, record.number, leadFor('paid', record));
    } else if (data.status === 'pending' || data.status === 'failed') {
      saveRecord({ ...record, state: 'done' });
      show('pending', record, record.number, leadFor('pending', record));
    } else saveRecord({ ...record, state: 'done' });
  } catch {
    /* quiet: the order is in the admin anyway / тихо: заказ в админке в любом случае */
  }
};

// ── buttons / кнопки ─────────────────────────────────────────────────────────

step?.addEventListener('click', async (event) => {
  const target = event.target as Element;
  const record = shown?.record ?? null;
  if (target.closest('[data-pay-retry]') && record) {
    await start(record);
    return;
  }
  if (target.closest('[data-pay-recheck]')) {
    waitFor(record, shown?.number ?? '');
    return;
  }
  const offline = target.closest<HTMLButtonElement>('[data-pay-offline]');
  if (offline && record) {
    offline.disabled = true;
    try {
      const { ok, data } = await post('offline', { number: record.number, phone: record.phone }, 15_000);
      if (ok && data.paid) show('paid', record, record.number, leadFor('paid', record));
      else if (ok) {
        saveRecord({ ...record, state: 'done' });
        show('offline', record, record.number, leadFor('offline', record));
      } else show('unavailable', record, record.number, esc(String(data.message ?? 'Не получилось. Позвоните нам — примем оплату при получении.')));
    } catch (error) {
      show('unavailable', record, record.number, esc(networkLead(error)));
    } finally {
      offline.disabled = false;
    }
  }
});

// closing the drawer from the payment step leaves the cart behind it, as the
// cart script expects; a «waiting» record is not offered again
// закрытие корзины с шага оплаты оставляет за ним корзину, как ждёт скрипт
// корзины; запись «ждёт оплаты» второй раз не предлагается
drawer?.addEventListener('close', () => {
  if (!step || step.hidden) return;
  polling += 1;
  step.hidden = true;
  const cart = drawer.querySelector<HTMLElement>('[data-step="cart"]');
  if (cart) cart.hidden = false;
  const head = drawer.querySelector<HTMLElement>('[data-drawer-title]');
  if (head) head.textContent = 'Корзина';
  const record = readRecord();
  if (record && record.state !== 'done') saveRecord({ ...record, state: 'dismissed' });
});

// the bank's page and back by the browser's «back»: the page comes from the
// cache with the «going» screen frozen — ask what happened instead
// страница банка и обратно кнопкой «назад»: страница приходит из кеша с
// застывшим «переходим» — вместо этого спросить, что случилось
window.addEventListener('pageshow', (event) => {
  if (event.persisted && step?.dataset.state === 'going' && !step.hidden) {
    const record = readRecord();
    if (record) {
      saveRecord({ ...record, state: 'redirected' });
      void handleUnfinished();
    }
  }
});

// ── start / запуск ───────────────────────────────────────────────────────────
// after the cart script has set up the drawer (it is evaluated right after
// this module), so its listeners see the step we open
// после того как скрипт корзины настроит выдвижную панель (он выполняется сразу
// после этого модуля), чтобы его обработчики видели открытый нами шаг
if (drawer && step) {
  queueMicrotask(() => {
    void loadConfig().then(() => {
      if (!handleReturn()) void handleUnfinished();
    });
  });
}
