/**
 * The part of the notifications that needs neither Directus nor the network:
 * what a letter and a Telegram message say, who gets them, how a delivery is
 * retried and how its result reads in one line on the order card. `index.js`
 * feeds it rows from the database and real senders; `scripts/notify.check.mjs`
 * feeds it fakes.
 *
 * Та часть оповещений, которой не нужны ни Directus, ни сеть: что написано в
 * письме и в сообщении Telegram, кому они уходят, как повторяется отправка и
 * как её итог читается одной строкой в карточке заказа. `index.js` подаёт сюда
 * строки из базы и настоящие отправщики, `scripts/notify.check.mjs` — подделки.
 */

export const DEFAULTS = {
  email_enabled: true,
  email_subject_order: 'ЗАКАЗ №{number} — {total} ₽',
  email_subject_request: 'ЗАЯВКА №{number} — {format}',
  telegram_enabled: false,
  status_changes: false,
};

// Telegram refuses longer messages / Telegram не примет сообщение длиннее
const TELEGRAM_LIMIT = 4096;
// a network error is retried twice: three tries, 2 s and 5 s apart
// сетевую ошибку повторяем дважды: три попытки с паузой 2 и 5 с
export const TELEGRAM_RETRY_DELAYS = [2000, 5000];

const STATUS_WORDS = {
  orders: { new: 'Новый', in_work: 'В работе', done: 'Выполнен', cancelled: 'Отменён' },
  catering_requests: { new: 'Новая', in_work: 'В работе', contract: 'Договор', done: 'Выполнена', cancelled: 'Отменена' },
};
// what the order status looks like in a Telegram line and on a button
// как статус заказа выглядит в строке Telegram и на кнопке
export const STATUS_MARKS = { new: '🆕', in_work: '▶️', done: '✅', cancelled: '❌' };
// what the payment of the order says in the message: online orders only
// что сообщение говорит об оплате заказа: только для оплаты онлайн
const PAYMENT_WORDS = {
  pending: '⏳ ждём оплату онлайн',
  paid: '💳 оплачен онлайн',
  failed: '✗ оплата онлайн не прошла',
  refunded: '↩️ оплата возвращена',
};
const VENUE_WORDS = { hall: 'в нашем зале', offsite: 'выезд', unknown: 'место пока не выбрано' };
const SOURCE_WORDS = { site: 'сайт', phone: 'телефон', app: 'приложение', messenger: 'мессенджер' };

export const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
export const rub = (n) => `${money(n)} ₽`;
export const samaraTime = (date = new Date()) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Samara', hour: '2-digit', minute: '2-digit' }).format(date);
/** «23.10 12:40» in Samara time, for the status log. / «23.10 12:40» по Самаре, для журнала статусов. */
export const samaraStamp = (date = new Date()) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Samara', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(date)
    .replace(',', '');
/** Today — «12:40», another day — «21.10 12:40». / Сегодня — «12:40», в другой день — «21.10 12:40». */
export const whenText = (value, now = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = (d) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Samara', day: '2-digit', month: '2-digit' }).format(d);
  return day(date) === day(now) ? samaraTime(date) : samaraStamp(date);
};
export const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const plural = (n, [one, few, many]) => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return many;
  if (n % 10 === 1) return one;
  return [2, 3, 4].includes(n % 10) ? few : many;
};
export const guestsText = (n) => `${n} ${plural(n, ['гость', 'гостя', 'гостей'])}`;
// the database driver hands a `date` column over as a Date at local midnight,
// the API as «2026-11-21»: both become the same calendar day
// драйвер базы отдаёт колонку `date` как Date на местную полночь, API — строкой
// «2026-11-21»: и то и другое становится одним календарным днём
const ymd = (value) =>
  value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value).slice(0, 10);
const longDate = (value) => {
  const day = new Date(`${ymd(value)}T12:00:00Z`);
  if (Number.isNaN(day.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', weekday: 'short' }).format(day);
};
const json = (value, fallback) => {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

/** The singleton row as the code reads it: defaults filled, lists parsed. / Синглтон с умолчаниями и разобранными списками. */
export const normalizeSettings = (row) => {
  const s = { ...DEFAULTS, ...Object.fromEntries(Object.entries(row ?? {}).filter(([, v]) => v !== null && v !== undefined)) };
  const list = (value) => (Array.isArray(json(value, [])) ? json(value, []) : []);
  return {
    ...s,
    email_subject_order: String(s.email_subject_order ?? '').trim() || DEFAULTS.email_subject_order,
    email_subject_request: String(s.email_subject_request ?? '').trim() || DEFAULTS.email_subject_request,
    email_recipients: list(s.email_recipients),
    telegram_chats: list(s.telegram_chats),
    telegram_token: String(s.telegram_token ?? '').trim(),
  };
};

/**
 * Whether Directus can actually send a letter. The compose file defaults to
 * `sendmail`, and the container has no mail server behind it: that is «not
 * configured», not an error to retry. One switch turns mail on: EMAIL_TRANSPORT
 * with its block in `directus/.env`.
 * Может ли Directus на самом деле отправить письмо. По умолчанию в compose стоит
 * `sendmail`, а почтового сервера в контейнере нет: это «не настроено», а не
 * ошибка для повтора. Почта включается одной настройкой: EMAIL_TRANSPORT с её
 * блоком в `directus/.env`.
 */
export const mailState = (env = {}) => {
  const transport = String(env.EMAIL_TRANSPORT || 'sendmail').toLowerCase();
  const has = (key) => String(env[key] ?? '').trim() !== '';
  if (transport === 'smtp')
    return has('EMAIL_SMTP_HOST')
      ? { ok: true, transport, label: `SMTP ${env.EMAIL_SMTP_HOST}:${env.EMAIL_SMTP_PORT ?? 587}` }
      : { ok: false, transport, reason: 'SMTP не настроен' };
  if (transport === 'mailgun')
    return has('EMAIL_MAILGUN_API_KEY') && has('EMAIL_MAILGUN_DOMAIN')
      ? { ok: true, transport, label: `Mailgun ${env.EMAIL_MAILGUN_DOMAIN}` }
      : { ok: false, transport, reason: 'Mailgun не настроен' };
  if (transport === 'ses') return { ok: true, transport, label: 'Amazon SES' };
  return { ok: false, transport, reason: 'SMTP не настроен' };
};

// ── what is being reported / о чём сообщаем ──────────────────────────────────

/**
 * The address by parts (since 23.10.2026): the street and the house in
 * `address` — the only part the geocoder sees — and the flat, the entrance,
 * the floor and the intercom code in their own fields. A part typed with its
 * own word («офис 5», «подъезд 2») is not prefixed twice.
 * Адрес по пунктам (с 23.10.2026): улица и дом в `address` — только их видит
 * геокодер, — квартира, подъезд, этаж и код домофона в своих полях. Пункт,
 * набранный со своим словом («офис 5», «подъезд 2»), второй раз не подписывается.
 */
export const ADDRESS_PARTS = [
  // a flat is «кв. 12»; «офис 5», «кв 12», «пом. 3» stay as typed
  // квартира — «кв. 12»; «офис 5», «кв 12», «пом. 3» остаются как набраны
  { field: 'address_flat', word: 'кв.', own: /^\p{L}/u },
  // «подъезд 2», «5 этаж», «код 45#» already carry their word
  // «подъезд 2», «5 этаж», «код 45#» уже несут своё слово
  { field: 'address_entrance', word: 'подъезд', own: /подъезд|под\./iu },
  { field: 'address_floor', word: 'этаж', own: /этаж/iu },
  { field: 'address_intercom', word: 'домофон', own: /домофон|код/iu },
];

/**
 * «Советской Армии, 177, кв. 12, подъезд 2, этаж 5, домофон 12К»: the street
 * and the house, the parts that are filled, then the old one-line
 * `address_details` of the orders made before the parts. Empty — ''.
 * Улица и дом, заполненные пункты, затем старое однострочное `address_details`
 * заказов, сделанных до пунктов. Пусто — ''.
 */
export const addressLine = (order = {}) => {
  const clean = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim() : '');
  const parts = ADDRESS_PARTS.map(({ field, word, own }) => {
    const value = clean(order[field]);
    return value && (own.test(value) ? value : `${word} ${value}`);
  });
  return [clean(order.address), ...parts, clean(order.address_details)].filter(Boolean).join(', ');
};

/**
 * One shape for an order, a request and a status change, so that every
 * channel renders the same facts. `rows` are database rows, `names` the related
 * titles (`place`, `format`), `adminUrl` the card in the admin.
 * Одна форма для заказа, заявки и смены статуса, чтобы каждый канал рисовал одни
 * и те же факты. `rows` — строки базы, `names` — названия связей (`place`,
 * `format`), `adminUrl` — карточка в админке.
 */
export const orderModel = (order, { place = null, adminUrl = null, now = new Date() } = {}) => {
  const items = json(order.items, []) ?? [];
  const how =
    order.fulfillment === 'pickup'
      ? `Самовывоз${place ? `: ${place}` : ''}`
      : `Доставка: ${addressLine(order) || 'адрес не указан'}${order.delivery_zone ? ` · зона «${order.delivery_zone}»` : ''}`;
  const payment = paymentLine(order, now);
  const meta = telegramMeta(order);
  return {
    kind: 'order',
    collection: 'orders',
    title: 'Заказ',
    number: order.number ?? String(order.id ?? ''),
    vars: {
      number: order.number ?? String(order.id ?? ''),
      total: money(order.total),
      name: order.customer_name ?? '',
      phone: order.phone ?? '',
      when: order.desired_time ?? '',
    },
    headline: `Заказ №${order.number ?? order.id} — ${rub(order.total)}`,
    person: [order.customer_name, order.phone].filter(Boolean).join(', '),
    facts: [how, `Когда: ${order.desired_time || 'как можно скорее'}`, ...(payment ? [payment] : [])],
    lines: items.map((line) => `${line.title} × ${line.qty} — ${rub(line.sum ?? Number(line.price) * Number(line.qty))}`),
    // an order from the guest account: what points and the birthday discount took off, and what is left
    // заказ из личного кабинета: что сняли баллы и скидка именинника и сколько осталось
    total:
      order.to_pay !== null && order.to_pay !== undefined && Number(order.to_pay) !== Number(order.total)
        ? `Итого: ${rub(order.total)}${Number(order.discount) > 0 ? ` · скидка именинника −${rub(order.discount)}` : ''}${Number(order.bonus_spent) > 0 ? ` · баллами −${rub(order.bonus_spent)}` : ''}${order.delivery_cost === null || order.delivery_cost === undefined ? (order.fulfillment === 'delivery' ? ' · доставка: назвать при звонке' : '') : Number(order.delivery_cost) > 0 ? ` · доставка ${rub(order.delivery_cost)}` : order.fulfillment === 'delivery' ? ' · доставка бесплатно' : ''} · к оплате ${rub(order.to_pay)}`
        : `Итого: ${rub(order.total)}`,
    notes: [
      order.comment ? `Комментарий: ${order.comment}` : null,
      order.manager_note ? order.manager_note : null,
      order.source && order.source !== 'site' ? `Источник: ${SOURCE_WORDS[order.source] ?? order.source}` : null,
    ].filter(Boolean),
    // who moved the order where, newest last: «▶️ В работе — Дмитрий, 12:40»
    // кто и куда перевёл заказ, свежее внизу: «▶️ В работе — Дмитрий, 12:40»
    history: meta.history.map((entry) => historyLine(entry, now)),
    keyboard: telegramKeyboard(order),
    adminUrl,
  };
};

/** «Оплата: 💳 оплачен онлайн, 12:41» for an online order; nothing for the rest. / Для заказа с оплатой онлайн; остальным — ничего. */
export const paymentLine = (order, now = new Date()) => {
  const word = PAYMENT_WORDS[order.payment_status];
  if (!word) return null;
  const at = order.payment_status === 'paid' && order.paid_at ? whenText(order.paid_at, now) : '';
  return `Оплата: ${word}${at ? `, ${at}` : ''}`;
};

// ── the order in Telegram: buttons, presses, history / заказ в Telegram ──────

/**
 * What the `notify` extension keeps on the order in `telegram_meta`: the
 * messages it sent (to edit them later) and who changed the status when.
 * `job` is a relay queue ticket for a message whose id is not known yet.
 * Что расширение `notify` хранит у заказа в `telegram_meta`: отправленные
 * сообщения (чтобы потом их править) и кто когда менял статус. `job` — талон
 * очереди ретранслятора у сообщения, чей id ещё неизвестен.
 * @returns {{ messages: Array<{ chat: string, message_id?: number, job?: number }>, history: Array<{ status: string, who: string, via: string, at: string }> }}
 */
export const telegramMeta = (order = {}) => {
  const raw = json(order.telegram_meta, null);
  const meta = raw && typeof raw === 'object' ? raw : {};
  return {
    messages: Array.isArray(meta.messages) ? meta.messages.filter((m) => m && m.chat) : [],
    history: Array.isArray(meta.history) ? meta.history.filter((h) => h && h.status) : [],
  };
};

/** «▶️ В работе — Дмитрий, 12:40», «✅ Выполнен — Ирина · админка, 21.10 15:02» */
export const historyLine = (entry, now = new Date()) => {
  const word = STATUS_WORDS.orders[entry.status] ?? entry.status;
  const mark = STATUS_MARKS[entry.status] ?? '•';
  const via = entry.via === 'admin' ? ' · админка' : entry.via === 'site' ? ' · сайт' : '';
  const at = entry.at ? whenText(entry.at, now) : '';
  return `${mark} ${word} — ${entry.who || 'без имени'}${via}${at ? `, ${at}` : ''}`;
};

/** The same entry for the order card: «23.10 12:40 — В работе — Дмитрий (Telegram)». / Та же запись для карточки заказа. */
export const statusLogLine = (entry) => {
  const word = STATUS_WORDS.orders[entry.status] ?? entry.status;
  const via = entry.via === 'admin' ? 'админка' : entry.via === 'site' ? 'сайт' : 'Telegram';
  return `${samaraStamp(entry.at ? new Date(entry.at) : new Date())} — ${word} — ${entry.who || 'без имени'} (${via})`;
};

// a press carries «o:<order id>:<what>»: 64 bytes is Telegram's limit
// нажатие несёт «o:<id заказа>:<что>»: предел Telegram — 64 байта
const button = (text, id, what) => ({ text, callback_data: `o:${id}:${what}` });

/**
 * The buttons under the order for its current status; `confirm` is the second
 * step of «Отменить». A finished order has none: it is changed in the admin.
 * Кнопки под заказом для его текущего статуса; `confirm` — второй шаг
 * «Отменить». У выполненного заказа кнопок нет: его меняют в админке.
 * @returns {Array<Array<{ text: string, callback_data: string }>> | null}
 */
export const telegramKeyboard = (order = {}, { confirm = false } = {}) => {
  const id = order.id;
  if (id === undefined || id === null || id === '') return null;
  if (confirm) return [[button('Да, отменить заказ', id, 'cancelled'), button('Нет, оставить', id, 'keep')]];
  switch (order.status) {
    case 'new':
      return [[button('▶️ В работу', id, 'in_work'), button('❌ Отменить', id, 'cancel?')]];
    case 'in_work':
      return [[button('✅ Выполнен', id, 'done'), button('❌ Отменить', id, 'cancel?')]];
    case 'cancelled':
      return [[button('↩️ Вернуть в работу', id, 'in_work')]];
    default:
      return null;
  }
};

/** `o:15:in_work` → { id: 15, what: 'in_work' }; anything else → null. */
export const parseCallback = (data) => {
  const m = /^o:(\d{1,12}):(in_work|done|cancelled|cancel\?|keep)$/.exec(String(data ?? ''));
  return m ? { id: Number(m[1]), what: m[2] } : null;
};

// where a button may take the order from each status
// куда кнопка может перевести заказ из каждого статуса
const MOVES = { new: ['in_work', 'cancelled'], in_work: ['done', 'cancelled'], cancelled: ['in_work'], done: [] };

/**
 * What to do with a press: change the status, ask «точно?», put the buttons
 * back, or only answer. A stale button (the order moved on since) answers with
 * the current status instead of changing anything.
 * Что делать с нажатием: сменить статус, спросить «точно?», вернуть кнопки
 * или только ответить. Устаревшая кнопка (заказ с тех пор ушёл дальше)
 * отвечает текущим статусом и ничего не меняет.
 * @returns {{ kind: 'set', status: string, toast: string } | { kind: 'confirm' | 'keep' | 'toast', toast: string }}
 */
export const decideCallback = (order, what) => {
  const current = STATUS_WORDS.orders[order.status] ?? order.status;
  if (what === 'keep') return { kind: 'keep', toast: 'Заказ оставлен как есть' };
  if (what === 'cancel?') {
    if (!MOVES[order.status]?.includes('cancelled')) return { kind: 'toast', toast: `Заказ уже «${current}»` };
    return { kind: 'confirm', toast: 'Подтвердите отмену' };
  }
  if (order.status === what) return { kind: 'toast', toast: `Заказ уже «${current}»` };
  if (!MOVES[order.status]?.includes(what)) {
    return { kind: 'toast', toast: order.status === 'done' ? 'Заказ уже выполнен — менять в админке' : `Заказ уже «${current}» — менять в админке` };
  }
  return { kind: 'set', status: what, toast: `Статус: ${STATUS_WORDS.orders[what]}` };
};

/** The name under a press: «Дмитрий Г.», else @username, else «без имени». / Имя нажавшего. */
export const pressedBy = (from = {}) => {
  const first = String(from.first_name ?? '').trim();
  const last = String(from.last_name ?? '').trim();
  if (first || last) return [first, last ? `${last.slice(0, 1)}.` : ''].filter(Boolean).join(' ');
  return from.username ? `@${from.username}` : 'без имени';
};

export const requestModel = (request, { place = null, format = null, adminUrl = null } = {}) => {
  const where =
    request.venue === 'hall'
      ? place
        ? `зал: ${place}`
        : VENUE_WORDS.hall
      : request.venue === 'offsite'
        ? `выезд${request.address ? `: ${request.address}` : ''}`
        : VENUE_WORDS.unknown;
  const formatText = format ?? 'формат не выбран';
  return {
    kind: 'request',
    collection: 'catering_requests',
    title: 'Заявка на кейтеринг',
    number: request.number ?? String(request.id ?? ''),
    vars: {
      number: request.number ?? String(request.id ?? ''),
      format: formatText,
      guests: request.guests ? guestsText(Number(request.guests)) : 'гостей не назвали',
      date: request.event_date ? longDate(request.event_date) : 'дата не названа',
      name: request.name ?? '',
      phone: request.phone ?? '',
    },
    headline: `Заявка №${request.number ?? request.id} — ${formatText}`,
    person: [request.name, request.phone].filter(Boolean).join(', '),
    facts: [
      `Дата: ${request.event_date ? longDate(request.event_date) : 'не названа'}`,
      `Гостей: ${request.guests ? guestsText(Number(request.guests)) : 'не назвали'}`,
      `Формат: ${formatText}`,
      `Где: ${where}`,
    ],
    lines: [],
    total: null,
    notes: [
      request.wishes ? `Пожелания: ${request.wishes}` : null,
      request.source && request.source !== 'site' ? `Источник: ${SOURCE_WORDS[request.source] ?? request.source}` : null,
    ].filter(Boolean),
    history: [],
    keyboard: null,
    adminUrl,
  };
};

/** «Заказ №1910-4821 — статус «В работе»» */
export const statusModel = (base, status) => {
  const word = STATUS_WORDS[base.collection]?.[status] ?? status;
  return {
    ...base,
    kind: `${base.kind}_status`,
    headline: `${base.title} №${base.number} — статус «${word}»`,
    facts: [],
    lines: [],
    total: null,
    notes: [],
    history: [],
    keyboard: null,
    vars: { ...base.vars, status: word },
  };
};

/** «💳 Заказ №2310-4521 оплачен онлайн — 5 440 ₽»: the reply under the order when ЮKassa confirms. / Ответ под заказом, когда ЮKassa подтвердила оплату. */
export const paidModel = (base, order) => ({
  ...base,
  kind: 'order_paid',
  headline: `💳 Заказ №${base.number} оплачен онлайн — ${rub(order.to_pay ?? order.total)}`,
  person: '',
  facts: [],
  lines: [],
  total: null,
  notes: [],
  history: [],
  keyboard: null,
  adminUrl: null,
});

/** `{number}` → value; an unknown key stays as typed so the editor sees the typo. / Неизвестный ключ остаётся как есть — опечатка видна. */
export const fillTemplate = (template, vars) =>
  String(template).replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key] ?? '') : whole));

export const subjectFor = (model, settings) => {
  const subject =
    model.kind === 'order'
      ? fillTemplate(settings.email_subject_order || DEFAULTS.email_subject_order, model.vars)
      : model.kind === 'request'
        ? fillTemplate(settings.email_subject_request || DEFAULTS.email_subject_request, model.vars)
        : model.headline;
  return model.test ? `ПРОВЕРКА · ${subject}` : subject;
};

export const emailText = (model) =>
  [
    model.headline,
    model.person,
    ...model.facts,
    model.lines.length ? '' : null,
    ...model.lines.map((line) => `• ${line}`),
    model.total,
    model.notes.length ? '' : null,
    ...model.notes,
    model.history?.length ? '' : null,
    ...(model.history ?? []),
    model.adminUrl ? `\nОткрыть в админке: ${model.adminUrl}` : null,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');

export const emailHtml = (model) => {
  const p = (text, style = '') => `<p style="margin:0 0 6px;${style}">${escapeHtml(text)}</p>`;
  return [
    '<div style="font:15px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1d1d1b;max-width:560px">',
    `<p style="margin:0 0 12px;font-size:19px;font-weight:700">${escapeHtml(model.headline)}</p>`,
    model.person ? p(model.person, 'font-weight:600') : '',
    ...model.facts.map((fact) => p(fact)),
    model.lines.length
      ? `<ul style="margin:12px 0;padding-left:20px">${model.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      : '',
    model.total ? p(model.total, 'font-weight:700;margin-top:8px') : '',
    ...model.notes.map((note) => p(note, 'color:#5b5b55')),
    ...(model.history ?? []).map((line) => p(line, 'color:#5b5b55;margin-top:8px')),
    model.adminUrl
      ? `<p style="margin:16px 0 0"><a href="${escapeHtml(model.adminUrl)}" style="color:#6F7546;font-weight:600">Открыть в админке</a></p>`
      : '',
    '</div>',
  ].join('\n');
};

/** Telegram HTML: bold headline, the facts, a link to the card; cut to the API limit. / Обрезано до предела API. */
export const telegramText = (model) => {
  const body = [
    `<b>${escapeHtml(model.headline)}</b>`,
    model.person ? escapeHtml(model.person) : null,
    ...model.facts.map(escapeHtml),
    model.lines.length ? '' : null,
    ...model.lines.map((line) => `• ${escapeHtml(line)}`),
    model.total ? `<b>${escapeHtml(model.total)}</b>` : null,
    model.notes.length ? '' : null,
    ...model.notes.map(escapeHtml),
    model.history?.length ? '' : null,
    ...(model.history ?? []).map(escapeHtml),
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');
  const link = model.adminUrl ? `\n\n<a href="${escapeHtml(model.adminUrl)}">Открыть в админке</a>` : '';
  const room = TELEGRAM_LIMIT - link.length - 2;
  // cutting HTML mid-tag breaks the parse: the long tail is plain text, cut
  // at a line break and closed with an ellipsis
  // резать HTML посреди тега нельзя: длинный хвост — простой текст, режем по
  // переводу строки и ставим многоточие
  const edge = body.lastIndexOf('\n', room - 3);
  const cut = body.length > room ? `${body.slice(0, edge > 0 ? edge : room - 3)}\n…` : body;
  return `${cut}${link}`;
};

// ── who gets it / кому ───────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// a test goes to everyone listed, whatever the ticks say
// проверка уходит всем из списка, что бы ни стояло в галочках
const wants = (row, kind, everyone = false) => {
  if (everyone) return true;
  const key = kind.startsWith('order') ? 'orders' : 'requests';
  return row?.[key] !== false;
};

export const emailRecipients = (settings, kind, everyone = false) => {
  const seen = new Set();
  return settings.email_recipients
    .filter((row) => wants(row, kind, everyone))
    .map((row) => String(row?.email ?? '').trim())
    .filter((email) => email && !seen.has(email.toLowerCase()) && seen.add(email.toLowerCase()));
};

export const telegramChats = (settings, kind, everyone = false) => {
  const seen = new Set();
  return settings.telegram_chats
    .filter((row) => wants(row, kind, everyone))
    .map((row) => ({ id: String(row?.chat_id ?? '').trim(), label: String(row?.label ?? '').trim() }))
    .filter((chat) => chat.id && !seen.has(chat.id) && seen.add(chat.id));
};

// ── delivery / отправка ──────────────────────────────────────────────────────

/** Never let a bot token reach a log line or the admin. / Токен бота не должен попасть ни в лог, ни в админку. */
export const scrub = (text, secrets = []) => {
  let out = String(text ?? '');
  for (const secret of secrets) if (secret && secret.length > 4) out = out.split(secret).join('***');
  return out.replace(/bot\d+:[\w-]+/g, 'bot***').replace(/\d{6,}:[\w-]{20,}/g, '***');
};

const short = (text, max = 70) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const telegramReason = (status, description) => {
  if (status === 401 || status === 404) return 'неверный токен бота';
  if (status === 400 && /chat not found/i.test(description)) return 'чат не найден: проверьте chat_id и что бот добавлен в чат';
  if (status === 403) return 'бот не может писать в этот чат: его удалили из группы или не запустили';
  if (status === 400 && /parse entities/i.test(description)) return 'Telegram не разобрал разметку сообщения';
  return `Telegram ответил ${status}${description ? `: ${description}` : ''}`;
};

/**
 * One message to one chat. A network failure, a 5xx or a 429 is tried again
 * (twice); a 4xx is a settings problem and is reported at once.
 * Одно сообщение в один чат. Сетевой сбой, 5xx и 429 повторяются (дважды);
 * 4xx — ошибка настроек, о ней сообщаем сразу.
 */
export const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Where Bot API requests go: the relay from `TELEGRAM_API_BASE` first (a queue
 * outside Russia reachable over an SSH tunnel), then Telegram itself, when the
 * relay is unreachable or answers like a dead relay (502/503/504).
 * Куда идут запросы Bot API: сначала ретранслятор из `TELEGRAM_API_BASE`
 * (очередь за границей, доступная по SSH-туннелю), потом сам Telegram — когда
 * ретранслятор недоступен или отвечает как мёртвый (502/503/504).
 */
export const telegramBases = (env = {}) => {
  const relay = String(env.TELEGRAM_API_BASE ?? '').trim().replace(/\/+$/, '');
  return relay && relay !== TELEGRAM_API ? [relay, TELEGRAM_API] : [TELEGRAM_API];
};

/**
 * One Bot API call with retries. A network failure, a 5xx or a 429 is tried
 * again (twice); a 4xx is a settings problem and is reported at once. A relay
 * that took the call into its queue (202 `queued`) counts as «queued»: it will
 * reach Telegram without us, so there is nothing to retry here; `job` is its
 * ticket. `result` is Telegram's `result` (the sent message with its id).
 * Один вызов Bot API с повторами. Сетевой сбой, 5xx и 429 повторяются
 * (дважды); 4xx — ошибка настроек, о ней сообщается сразу. Ретранслятор,
 * взявший вызов в очередь (202 `queued`), — это «в очереди»: до Telegram он
 * дойдёт без нас, повторять нечего; `job` — его талон. `result` — `result`
 * Telegram (отправленное сообщение с его id).
 * @returns {Promise<{ status: 'sent' | 'queued' | 'failed', attempts: number, error: string | null, result?: any, job?: number, code?: number }>}
 */
export const telegramCall = async ({
  token,
  method,
  payload,
  fetchImpl = fetch,
  delays = TELEGRAM_RETRY_DELAYS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  bases = [TELEGRAM_API],
  timeout = 10_000,
}) => {
  let attempts = 0;
  let reason = '';
  let code = 0;
  for (;;) {
    attempts += 1;
    let retry = false;
    for (const [i, base] of bases.entries()) {
      const viaRelay = base !== TELEGRAM_API;
      try {
        const response = await fetchImpl(`${base}/bot${token}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(viaRelay ? timeout + 2_000 : timeout),
        });
        const answer = await response.json().catch(() => ({}));
        code = response.status;
        if (response.status === 202 && answer.queued) return { status: 'queued', attempts, error: null, job: answer.job ?? null, code };
        if (response.ok && answer.ok !== false) return { status: 'sent', attempts, error: null, result: answer.result ?? null, code };
        reason = telegramReason(response.status, answer.description ?? '');
        retry = response.status >= 500 || response.status === 429;
        // a dead relay is not Telegram's verdict: the next base gets its turn
        // мёртвый ретранслятор — не вердикт Telegram: очередь за следующим адресом
        if (viaRelay && [502, 503, 504].includes(response.status) && i < bases.length - 1) continue;
        break;
      } catch (error) {
        const cause = error?.cause?.code ?? error?.code ?? error?.name ?? '';
        reason = `нет связи с ${viaRelay ? 'ретранслятором' : 'Telegram'}${cause ? ` (${cause})` : ''}`;
        retry = true;
        code = 0;
        if (i < bases.length - 1) continue;
      }
    }
    if (!retry || attempts > delays.length) return { status: 'failed', attempts, error: scrub(reason, [token]), code };
    await sleep(delays[attempts - 1]);
  }
};

/**
 * One message to one chat, HTML, with buttons under an order and as a reply
 * under an earlier message when asked.
 * Одно сообщение в один чат, HTML, с кнопками под заказом и ответом под
 * прежним сообщением, когда просят.
 */
export const sendTelegram = ({ chatId, text, keyboard = null, replyTo = null, ...rest }) =>
  telegramCall({
    ...rest,
    method: 'sendMessage',
    payload: {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
    },
  });

/**
 * The order's message rewritten in place: new text, new buttons. «Message is
 * not modified» is Telegram saying the text already reads so — a success.
 * Сообщение заказа, переписанное на месте: новый текст, новые кнопки.
 * «Message is not modified» — Telegram говорит, что текст уже такой, — успех.
 */
export const editTelegram = async ({ chatId, messageId, text, keyboard = null, ...rest }) => {
  const r = await telegramCall({
    ...rest,
    method: 'editMessageText',
    payload: {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: keyboard ?? [] },
    },
  });
  if (r.status === 'failed' && /not modified/i.test(r.error ?? '')) return { ...r, status: 'sent', error: null };
  return r;
};

/** Only the buttons under a message: the «точно отменить?» step. / Только кнопки под сообщением: шаг «точно отменить?». */
export const editTelegramKeyboard = async ({ chatId, messageId, keyboard = null, ...rest }) => {
  const r = await telegramCall({ ...rest, method: 'editMessageReplyMarkup', payload: { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard ?? [] } } });
  if (r.status === 'failed' && /not modified/i.test(r.error ?? '')) return { ...r, status: 'sent', error: null };
  return r;
};

/** The little answer to a press (a toast); it may not be retried: a late answer is refused anyway. / Короткий ответ на нажатие; поздний ответ Telegram всё равно отвергнет. */
export const answerCallback = ({ callbackId, text = '', ...rest }) =>
  telegramCall({ ...rest, method: 'answerCallbackQuery', payload: { callback_query_id: callbackId, text, show_alert: false }, delays: [], timeout: 8_000 });

/**
 * One long poll for button presses: `getUpdates` with `offset`, through the
 * relay first and Telegram itself second. Returns the presses and the next
 * offset, or the reason nothing came. Not retried here — the loop calls again.
 * Один долгий опрос нажатий: `getUpdates` со смещением, сначала через
 * ретранслятор, потом сам Telegram. Возвращает нажатия и следующее смещение
 * или причину, по которой ничего не пришло. Повторов нет — цикл вызовет снова.
 * @returns {Promise<{ updates: any[], offset: number | null, error: string | null, code: number }>}
 */
export const pollTelegram = async ({ token, offset = null, timeout = 20, fetchImpl = fetch, bases = [TELEGRAM_API] }) => {
  let reason = '';
  let code = 0;
  for (const [i, base] of bases.entries()) {
    const viaRelay = base !== TELEGRAM_API;
    try {
      const response = await fetchImpl(`${base}/bot${token}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout, allowed_updates: ['callback_query'], ...(offset === null ? {} : { offset }) }),
        signal: AbortSignal.timeout((timeout + (viaRelay ? 15 : 10)) * 1000),
      });
      const answer = await response.json().catch(() => ({}));
      code = response.status;
      if (response.ok && Array.isArray(answer.result)) {
        const updates = answer.result;
        const next = updates.length ? Math.max(...updates.map((u) => Number(u.update_id))) + 1 : offset;
        return { updates, offset: next, error: null, code };
      }
      reason = telegramReason(response.status, answer.description ?? '');
      if (viaRelay && [502, 503, 504].includes(response.status) && i < bases.length - 1) continue;
      break;
    } catch (error) {
      const cause = error?.cause?.code ?? error?.code ?? error?.name ?? '';
      reason = `нет связи с ${viaRelay ? 'ретранслятором' : 'Telegram'}${cause ? ` (${cause})` : ''}`;
      code = 0;
      if (i < bases.length - 1) continue;
    }
  }
  return { updates: [], offset, error: scrub(reason, [token]), code };
};

/**
 * A queued message's fate from the relay: `GET /jobs/<id>` says whether it
 * reached Telegram and, if so, the message id (the ticket is shown to its own
 * bot token only). `null` — still pending or the
 * relay is unreachable; `{ lost: true }` — Telegram refused it for good.
 * Судьба отложенного сообщения по версии ретранслятора: `GET /jobs/<id>`
 * говорит, дошло ли оно и какой у него id. `null` — ещё ждёт или ретранслятор
 * недоступен; `{ lost: true }` — Telegram отверг его окончательно.
 */
export const relayJob = async ({ base, token, job, fetchImpl = fetch }) => {
  if (!base || base === TELEGRAM_API || !job || !token) return null;
  try {
    const response = await fetchImpl(`${base}/bot${token}/jobs/${job}`, { signal: AbortSignal.timeout(5_000) });
    if (response.status === 404) return { lost: true };
    const answer = await response.json().catch(() => ({}));
    if (answer.status === 'done') return { messageId: answer.result?.result?.message_id ?? null };
    if (answer.status === 'rejected' || answer.status === 'failed') return { lost: true };
    return null;
  } catch {
    return null;
  }
};

const mailReason = (error) => {
  const code = error?.code ?? '';
  if (code === 'EAUTH') return 'SMTP не принял логин или пароль';
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED'].includes(code)) return `нет связи с почтовым сервером (${code})`;
  if (code === 'EENVELOPE') return 'почтовый сервер не принял адрес';
  return error?.message ? String(error.message).split('\n')[0] : 'письмо не отправлено';
};

/**
 * Send one event to every channel and return the per-recipient results and the
 * one-line summary for the card. `sendMail(message)` and `fetchImpl` are the
 * real senders in Directus and fakes in the check.
 * Разослать одно событие по всем каналам; вернуть итог по каждому адресату и
 * строку для карточки. `sendMail(message)` и `fetchImpl` — настоящие отправщики
 * в Directus и подделки в проверке.
 */
export const deliver = async ({ model, settings, mail, sendMail, fetchImpl, delays, sleep, now = new Date(), secrets = [], bases = [TELEGRAM_API] }) => {
  const results = [];
  const kind = model.kind;

  // mail / почта
  const emails = emailRecipients(settings, kind, model.test);
  let emailPart;
  if (!settings.email_enabled) emailPart = 'почта выключена';
  else if (!emails.length) emailPart = 'почта — нет адресов';
  else if (!mail.ok) {
    for (const to of emails) results.push({ channel: 'email', recipient: to, status: 'skipped', error: mail.reason, attempts: 0 });
    emailPart = `почта ✗ ${mail.reason}`;
  } else {
    const subject = subjectFor(model, settings);
    const text = emailText(model);
    const html = emailHtml(model);
    for (const to of emails) {
      if (!EMAIL_RE.test(to)) {
        results.push({ channel: 'email', recipient: to, status: 'failed', error: 'адрес с ошибкой', attempts: 0 });
        continue;
      }
      try {
        await sendMail({ to, subject, text, html });
        results.push({ channel: 'email', recipient: to, status: 'sent', error: null, attempts: 1 });
      } catch (error) {
        results.push({ channel: 'email', recipient: to, status: 'failed', error: scrub(mailReason(error), secrets), attempts: 1 });
      }
    }
    emailPart = partLine('почта', results.filter((r) => r.channel === 'email'), ['адрес', 'адреса', 'адресов']);
  }

  // Telegram
  const chats = telegramChats(settings, kind, model.test);
  let telegramPart;
  if (!settings.telegram_enabled) telegramPart = 'Telegram выключен';
  else if (!settings.telegram_token) telegramPart = 'Telegram ✗ нет токена бота';
  else if (!chats.length) telegramPart = 'Telegram — нет чатов';
  else {
    const text = telegramText(model);
    // chats go one after another: a retry pause in one must not reorder the rest
    // чаты по очереди: пауза повтора в одном не должна путать остальные
    for (const chat of chats) {
      const { result, job, code, ...outcome } = await sendTelegram({
        token: settings.telegram_token,
        chatId: chat.id,
        text,
        keyboard: model.keyboard ?? null,
        replyTo: model.replyTo?.[chat.id] ?? null,
        fetchImpl,
        delays,
        sleep,
        bases,
      });
      results.push({
        channel: 'telegram',
        recipient: chat.label ? `${chat.label} (${chat.id})` : chat.id,
        ...outcome,
        // what lets the message be edited later: its id, or the relay's ticket until the id is known
        // что позволит потом править сообщение: его id или талон ретранслятора, пока id неизвестен
        chat: chat.id,
        messageId: result?.message_id ?? null,
        job: outcome.status === 'queued' ? (job ?? null) : null,
      });
    }
    telegramPart = partLine('Telegram', results.filter((r) => r.channel === 'telegram'), ['чат', 'чата', 'чатов']);
  }

  return { results, summary: `${emailPart} · ${telegramPart} · ${samaraTime(now)}` };
};

/** «почта ✓», «почта ✓ 2 адреса», «почта ✓ 1 из 2», «почта ✗ <причина>» */
function partLine(name, rows, words) {
  const sent = rows.filter((r) => r.status === 'sent' || r.status === 'queued').length;
  const queued = rows.filter((r) => r.status === 'queued').length;
  const mark = queued ? '⏳ в очереди' : '✓';
  if (sent === rows.length) return `${name} ${mark}${rows.length > 1 ? ` ${rows.length} ${plural(rows.length, words)}` : ''}`;
  if (sent > 0) return `${name} ${mark} ${sent} из ${rows.length}`;
  return `${name} ✗ ${short(rows[0]?.error ?? 'не отправлено')}`;
}

/** A demo order and request for `POST /notify/test`: the real layout with made-up data. / Пример для проверки: настоящая вёрстка, выдуманные данные. */
export const demoModel = (kind, adminUrl) => {
  const base =
    kind === 'request'
      ? requestModel(
          { number: 'ТЕСТ', name: 'Проверка оповещений', phone: '+7 900 000-00-00', event_date: null, guests: 40, venue: 'hall', wishes: 'Это проверочное сообщение — отвечать не нужно.' },
          { place: 'Садовая', format: 'Фуршет', adminUrl },
        )
      : orderModel(
          {
            number: 'ТЕСТ',
            customer_name: 'Проверка оповещений',
            phone: '+7 900 000-00-00',
            fulfillment: 'pickup',
            desired_time: 'Как можно скорее',
            items: [{ title: 'Торт «Наполеон» (1 кг)', qty: 1, sum: 1850 }, { title: 'Морс клюквенный', qty: 2, sum: 360 }],
            total: 2210,
            comment: 'Это проверочное сообщение — отвечать не нужно.',
          },
          { place: 'Садовая', adminUrl },
        );
  return { ...base, test: true, headline: `Проверка: ${base.headline}` };
};
