/**
 * The catering pages' behaviour: the question accordions, the search over the
 * questions and the request form. Everything is static markup first — without
 * this script every answer is open and the form posts nothing, but the phone
 * and the messengers next to it still work.
 * Поведение страниц кейтеринга: аккордеоны вопросов, поиск по вопросам и форма
 * заявки. Сначала всё — статическая разметка: без этого скрипта каждый ответ
 * раскрыт, а форма ничего не отправляет, но телефон и мессенджеры рядом с ней
 * работают.
 */
import { bindPhoneMask, orderNumber } from '../lib/order';
import {
  REQUEST_DRAFT_KEY,
  buildRequest,
  dateWords,
  guestsWord,
  validateRequest,
  type RequestErrors,
  type RequestForm,
  type Where,
} from '../lib/request';

const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector);
const $$ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(selector));

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
      /* storage blocked: nothing is remembered / хранилище закрыто — ничего не помним */
    }
  },
};

// ── аккордеон ─────────────────────────────────────────────────────────────

type Qa = { root: HTMLElement; button: HTMLButtonElement; answer: HTMLElement };
const items: Qa[] = $$('[data-qa]').flatMap((root) => {
  const button = $<HTMLButtonElement>('[data-qa-btn]', root);
  const answer = $('[data-qa-a]', root);
  return button && answer ? [{ root, button, answer }] : [];
});

/**
 * Open or fold one answer. `until-found` keeps a folded answer findable: the
 * browser's search opens it and fires `beforematch`.
 * Раскрыть или свернуть ответ. `until-found` оставляет свёрнутый ответ
 * находимым: поиск браузера раскрывает его и шлёт `beforematch`.
 */
const setOpen = (item: Qa, open: boolean) => {
  item.button.setAttribute('aria-expanded', String(open));
  item.root.classList.toggle('is-open', open);
  if (open) item.answer.removeAttribute('hidden');
  else item.answer.setAttribute('hidden', 'until-found');
};

const byHash = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  return id ? items.find((item) => item.root.id === id) : undefined;
};

for (const item of items) {
  setOpen(item, false);
  item.button.addEventListener('click', () => setOpen(item, item.button.getAttribute('aria-expanded') !== 'true'));
  item.answer.addEventListener('beforematch', () => setOpen(item, true));
}

const openFromHash = () => {
  const item = byHash();
  if (!item) return;
  setOpen(item, true);
  item.root.scrollIntoView({ block: 'start' });
  item.button.focus({ preventScroll: true });
};
openFromHash();
window.addEventListener('hashchange', openFromHash);

// Up / Down / Home / End move between the questions of one list (WAI-ARIA accordion)
// ↑ / ↓ / Home / End ходят по вопросам одного списка (аккордеон WAI-ARIA)
document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (!target.matches?.('[data-qa-btn]')) return;
  const list = target.closest('[data-accordion]');
  if (!list) return;
  const buttons = $$<HTMLButtonElement>('[data-qa-btn]', list).filter((button) => button.offsetParent !== null);
  const at = buttons.indexOf(target as HTMLButtonElement);
  const next = {
    ArrowDown: buttons[(at + 1) % buttons.length],
    ArrowUp: buttons[(at - 1 + buttons.length) % buttons.length],
    Home: buttons[0],
    End: buttons.at(-1),
  }[event.key];
  if (!next) return;
  event.preventDefault();
  next.focus();
});

// ── лента фото ────────────────────────────────────────────────────────────
// The rail starts at the container edge and pages from the left by one frame;
// a hairline under the heading shows which part of the strip is in view.
// Лента начинается от края контейнера и листается слева по одному кадру;
// волосяная линия у заголовка показывает, какая часть ленты в кадре.
const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
for (const root of $$('[data-rail-root]')) {
  const rail = $('[data-rail]', root);
  if (!rail) continue;
  const prev = $<HTMLButtonElement>('[data-rail-prev]', root);
  const next = $<HTMLButtonElement>('[data-rail-next]', root);
  const fill = $('[data-rail-fill]', root);
  const step = () => {
    const [first, second] = Array.from(rail.children) as HTMLElement[];
    return second ? second.offsetLeft - first.offsetLeft : rail.clientWidth;
  };
  const sync = () => {
    const max = rail.scrollWidth - rail.clientWidth;
    if (max <= 0) return;
    prev?.setAttribute('aria-disabled', String(rail.scrollLeft <= 2));
    next?.setAttribute('aria-disabled', String(rail.scrollLeft >= max - 2));
    fill?.style.setProperty('--seen', String(rail.clientWidth / rail.scrollWidth));
    fill?.style.setProperty('--at', String(rail.scrollLeft / rail.scrollWidth));
  };
  const page = (direction: number) => {
    const button = direction < 0 ? prev : next;
    if (button?.getAttribute('aria-disabled') === 'true') return;
    rail.scrollBy({ left: direction * step(), behavior: smooth ? 'smooth' : 'auto' });
  };
  prev?.addEventListener('click', () => page(-1));
  next?.addEventListener('click', () => page(1));
  rail.addEventListener('scroll', sync, { passive: true });
  rail.addEventListener('keydown', (event) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    page(direction);
  });
  // the mouse drags the strip like a finger; snap is off while it is held
  // мышью ленту тянут как пальцем; пока держат, снап выключен
  let dragX = 0;
  let dragLeft = 0;
  rail.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    dragX = event.clientX;
    dragLeft = rail.scrollLeft;
    rail.classList.add('is-dragging');
    rail.setPointerCapture(event.pointerId);
  });
  rail.addEventListener('pointermove', (event) => {
    if (rail.classList.contains('is-dragging')) rail.scrollLeft = dragLeft - (event.clientX - dragX);
  });
  const release = () => {
    if (!rail.classList.contains('is-dragging')) return;
    rail.classList.remove('is-dragging');
    const at = Math.round(rail.scrollLeft / step());
    rail.scrollTo({ left: at * step(), behavior: smooth ? 'smooth' : 'auto' });
  };
  rail.addEventListener('pointerup', release);
  rail.addEventListener('pointercancel', release);
  new ResizeObserver(sync).observe(rail);
}

// ── «Показать ещё» у приоритетов ──────────────────────────────────────────
// On a phone the about block shows three priorities; the button opens the
// rest and hands the focus to the first one it opened.
// На телефоне блок «о нас» показывает три приоритета; кнопка открывает
// остальные и передаёт фокус первому открытому.
for (const button of $$<HTMLButtonElement>('[data-prios-more]')) {
  button.addEventListener('click', () => {
    const list = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!list) return;
    const shown = [...list.children].filter((item) => (item as HTMLElement).offsetParent !== null).length;
    list.classList.remove('is-short');
    button.setAttribute('aria-expanded', 'true');
    button.hidden = true;
    const next = list.children[shown]?.querySelector<HTMLElement>('.prio__title');
    if (next) {
      next.tabIndex = -1;
      next.focus({ preventScroll: true });
    }
  });
}

// ── поиск по вопросам (страница /catering/faq/) ───────────────────────────

const tools = $('[data-faq-tools]');
const search = $<HTMLInputElement>('[data-faq-search]');
const all = $<HTMLButtonElement>('[data-faq-all]');
const empty = $('[data-faq-empty]');
const status = $('[data-faq-status]');
if (tools) tools.hidden = false;

const plural = (n: number, one: string, few: string, many: string) =>
  ({ one, few, many, other: many })[new Intl.PluralRules('ru-RU').select(n) as 'one' | 'few' | 'many' | 'other'];

let typing: number | undefined;
search?.addEventListener('input', () => {
  window.clearTimeout(typing);
  typing = window.setTimeout(() => {
    const words = search.value.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter((word) => word.length > 1);
    let shown = 0;
    for (const item of items) {
      const text = (item.root.dataset.search ?? '').replace(/ё/g, 'е');
      const hit = words.every((word) => text.includes(word));
      item.root.hidden = !hit;
      if (hit) shown += 1;
      // a narrow search opens what it found; clearing the field folds it back
      // узкий поиск раскрывает найденное; пустое поле сворачивает обратно
      if (words.length) setOpen(item, hit && shown <= 8);
      else setOpen(item, false);
    }
    for (const topic of $$('[data-topic]')) {
      const visible = $$('[data-qa]', topic).some((qa) => !qa.hidden);
      topic.hidden = !visible;
      const link = $(`[data-topic-link="${topic.id}"]`);
      if (link) link.hidden = !visible;
    }
    if (empty) empty.hidden = shown > 0;
    if (status)
      status.textContent = words.length
        ? shown
          ? `Найдено: ${shown} ${plural(shown, 'вопрос', 'вопроса', 'вопросов')}`
          : 'Ничего не нашлось'
        : '';
    if (all) {
      all.setAttribute('aria-pressed', 'false');
      all.textContent = 'Развернуть все';
    }
  }, 120);
});

all?.addEventListener('click', () => {
  const open = all.getAttribute('aria-pressed') !== 'true';
  for (const item of items) if (!item.root.hidden) setOpen(item, open);
  all.setAttribute('aria-pressed', String(open));
  all.textContent = open ? 'Свернуть все' : 'Развернуть все';
});

// ── форма заявки ──────────────────────────────────────────────────────────

const form = $<HTMLFormElement>('[data-request]');
if (form) mountRequest(form);

function mountRequest(form: HTMLFormElement) {
  const endpoint = form.dataset.endpoint ?? '';
  const done = $('[data-done]', form.parentElement ?? document);
  const announce = $('[data-announce]');
  const field = <T extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement>(name: string) =>
    form.querySelector<T>(`[name="${name}"]`);
  const checked = (name: string) => form.querySelector<HTMLInputElement>(`[name="${name}"]:checked`);
  const say = (text: string) => {
    if (announce) announce.textContent = text;
  };

  const read = (): RequestForm => ({
    name: field('name')?.value ?? '',
    phone: field('phone')?.value ?? '',
    date: field('date')?.value || undefined,
    guests: field('guests')?.value || undefined,
    format: checked('format')?.value ? Number(checked('format')!.value) : null,
    where: (checked('where')?.value as Where | undefined) ?? 'unknown',
    address: field('address')?.value ?? '',
    wishes: field<HTMLTextAreaElement>('wishes')?.value ?? '',
    consent: Boolean(field('consent')?.checked),
  });

  // the address appears only for a party at the guest's venue
  // адрес появляется только для праздника на площадке гостя
  const togglePart = () => {
    const where = checked('where')?.value;
    for (const part of $$('[data-for]', form)) part.hidden = part.dataset.for !== where;
  };

  // ── черновик: закрытая вкладка ничего не теряет ──
  const DRAFT = ['name', 'phone', 'date', 'guests', 'address', 'wishes'] as const;
  const saveDraft = () => {
    const data: Record<string, string> = {};
    for (const key of DRAFT) data[key] = field<HTMLInputElement | HTMLTextAreaElement>(key)?.value ?? '';
    data.format = checked('format')?.value ?? '';
    data.where = checked('where')?.value ?? '';
    store.set(REQUEST_DRAFT_KEY, JSON.stringify(data));
  };
  const pick = (name: string, value: string) => {
    const input = $$<HTMLInputElement>(`input[name="${name}"]`, form).find((option) => option.value === value);
    if (input) input.checked = true;
    return input;
  };
  try {
    const draft = JSON.parse(store.get(REQUEST_DRAFT_KEY) ?? '{}');
    for (const key of DRAFT) {
      const input = field<HTMLInputElement | HTMLTextAreaElement>(key);
      if (input && typeof draft[key] === 'string' && draft[key]) input.value = draft[key];
    }
    if (typeof draft.format === 'string') pick('format', draft.format);
    if (typeof draft.where === 'string' && draft.where) pick('where', draft.where);
    // a date that has passed since is no longer a date to send
    // дата, которая с тех пор прошла, — уже не дата для заявки
    const date = field('date');
    if (date?.value && date.min && date.value < date.min) date.value = '';
  } catch {
    /* a broken draft is just no draft / битый черновик — просто без черновика */
  }

  // ?format=furshet in the address picks the format (a link from elsewhere)
  // ?format=furshet в адресе выбирает формат (ссылка откуда-то ещё)
  const wanted = new URLSearchParams(location.search).get('format');
  if (wanted) {
    const input = $<HTMLInputElement>(`input[name="format"][data-format-slug="${CSS.escape(wanted)}"]`, form);
    if (input) input.checked = true;
  }
  togglePart();

  // «Обсудить» on a format: the format is picked, the link itself scrolls to the form
  // «Обсудить» у формата: формат выбран, к форме прокручивает сама ссылка
  document.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLElement>('[data-pick-format]');
    if (!link) return;
    const input = pick('format', link.dataset.pickFormat ?? '');
    if (input) {
      saveDraft();
      const title = input.nextElementSibling?.textContent ?? '';
      say(`Формат «${title}» выбран. Заполните имя и телефон.`);
      // after the jump the name field is the next thing to fill
      // после перехода следующее, что заполнять, — имя
      window.setTimeout(() => field('name')?.focus({ preventScroll: true }), 450);
    }
  });

  // ── телефон: маска и «+7» при фокусе ──
  const phone = field('phone');
  if (phone) bindPhoneMask(phone);
  phone?.addEventListener('blur', () => {
    if (phone.value.replace(/\D/g, '') === '7') phone.value = '';
  });
  // guests: digits only, whatever the keyboard sends
  // гости: только цифры, что бы ни прислала клавиатура
  const guests = field('guests');
  guests?.addEventListener('input', () => {
    const digits = guests.value.replace(/\D/g, '').slice(0, 4);
    if (digits !== guests.value) guests.value = digits;
  });

  // ── ошибки ──
  let tried = false;
  const showErrors = (errors: RequestErrors) => {
    for (const node of $$('[data-err]', form)) {
      const key = node.dataset.err as keyof RequestErrors;
      const message = errors[key];
      node.hidden = !message;
      node.textContent = message ?? '';
      const target = field(key);
      if (target) {
        if (message) target.setAttribute('aria-invalid', 'true');
        else target.removeAttribute('aria-invalid');
      }
    }
  };
  form.addEventListener('change', () => {
    togglePart();
    if (tried) showErrors(validateRequest(read()));
    saveDraft();
  });
  form.addEventListener('input', () => {
    if (tried) showErrors(validateRequest(read()));
  });
  form.addEventListener('focusout', saveDraft);

  const offline = $('[data-offline]', form);
  const paintOnline = () => {
    if (offline) offline.hidden = navigator.onLine;
  };
  window.addEventListener('online', paintOnline);
  window.addEventListener('offline', paintOnline);
  paintOnline();

  const errorBox = $('[data-error]', form);
  const fail = (title: string, text: string) => {
    if (!errorBox) return;
    $('[data-error-title]', errorBox)!.textContent = title;
    $('[data-error-text]', errorBox)!.textContent = text;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'nearest' });
  };

  // ── заявка принята ──
  const finish = (number: string, sent: ReturnType<typeof buildRequest>) => {
    if (!done) return;
    $('[data-done-number]', done)!.textContent = number;
    $('[data-done-phone]', done)!.textContent = sent.phone;
    const format = checked('format');
    const where = checked('where');
    const facts: [string, string][] = [
      ['Дата', sent.event_date ? dateWords(sent.event_date) : 'обсудим по телефону'],
      ['Гостей', sent.guests ? guestsWord(sent.guests) : 'уточним'],
      ['Формат', sent.format && format ? (format.nextElementSibling?.textContent ?? '') : 'подберём вместе'],
      [
        'Где',
        sent.venue === 'offsite'
          ? `выезд${sent.address ? `: ${sent.address}` : ''}`
          : sent.venue === 'hall'
            ? `зал: ${where?.parentElement?.querySelector('.tile__name')?.textContent ?? ''}`
            : 'подскажем',
      ],
    ];
    const list = $('[data-done-facts]', done)!;
    list.replaceChildren(
      ...facts.map(([term, value]) => {
        const row = document.createElement('div');
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = term;
        dd.textContent = value;
        row.append(dt, dd);
        return row;
      }),
    );
    // what describes this party is cleared, the contacts stay for the next time
    // то, что описывает этот праздник, очищается, контакты остаются на следующий раз
    for (const key of ['date', 'guests', 'address', 'wishes'] as const) {
      const input = field<HTMLInputElement | HTMLTextAreaElement>(key);
      if (input) input.value = '';
    }
    pick('format', '');
    pick('where', 'unknown');
    togglePart();
    saveDraft();
    form.hidden = true;
    done.hidden = false;
    done.scrollIntoView({ block: 'start' });
    $('#rq-done-title', done)?.focus({ preventScroll: true });
    say(`Заявка ${number} принята. Перезвоним, чтобы обсудить детали.`);
  };

  $('[data-again]', done ?? document)?.addEventListener('click', () => {
    if (!done) return;
    done.hidden = true;
    form.hidden = false;
    tried = false;
    showErrors({});
    if (errorBox) errorBox.hidden = true;
    field('name')?.focus();
  });

  const submit = $<HTMLButtonElement>('[data-submit]', form)!;
  const label = $('[data-submit-label]', form)!;
  let busy = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    tried = true;
    if (errorBox) errorBox.hidden = true;
    const data = read();
    const errors = validateRequest(data);
    showErrors(errors);
    const first = (Object.keys(errors) as (keyof RequestErrors)[])[0];
    if (first) {
      field(first)?.focus();
      return;
    }
    const number = orderNumber(new Date(), Math.random());
    const payload = buildRequest(data, number);

    // a bot filled the field nobody sees: thank it and send nothing
    // бот заполнил поле, которого никто не видит: поблагодарить и ничего не отправлять
    if ((field('company')?.value ?? '').trim()) {
      finish(number, payload);
      return;
    }
    if (!navigator.onLine) {
      fail('Нет интернета', 'Форма сохранена. Проверьте связь и нажмите «Отправить заявку» ещё раз — или позвоните нам.');
      return;
    }

    busy = true;
    submit.setAttribute('aria-busy', 'true');
    label.textContent = 'Отправляем…';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        finish(number, payload);
        return;
      }
      // the server speaks Russian for what the guest can fix (request-guard)
      // сервер отвечает по-русски, если гость может это исправить (request-guard)
      const body = await response.json().catch(() => null);
      const reason: string | undefined =
        body?.errors?.[0]?.extensions?.reason ?? (response.status === 400 ? body?.errors?.[0]?.message : undefined);
      if (response.status === 429) fail('Слишком много заявок подряд', reason ?? 'Позвоните нам — обсудим праздник по телефону.');
      else if (response.status === 403)
        fail('Заявки на сайте сейчас не принимаем', 'Позвоните или напишите нам — обсудим праздник и посчитаем смету.');
      else if (reason) fail('Проверьте заявку', reason);
      else fail('Заявка не отправилась', 'Сервер не ответил как надо. Попробуйте ещё раз через минуту или позвоните нам.');
    } catch (error) {
      const timeout = (error as Error)?.name === 'TimeoutError';
      fail(
        timeout ? 'Сервер долго не отвечает' : 'Не получилось связаться с сервером',
        'Форма сохранена. Проверьте интернет и нажмите «Отправить заявку» ещё раз — или позвоните нам.',
      );
    } finally {
      busy = false;
      submit.removeAttribute('aria-busy');
      label.textContent = 'Отправить заявку';
    }
  });
}
