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
const VENUE_WORDS = { hall: 'в нашем зале', offsite: 'выезд', unknown: 'место пока не выбрано' };
const SOURCE_WORDS = { site: 'сайт', phone: 'телефон', app: 'приложение', messenger: 'мессенджер' };

export const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
export const rub = (n) => `${money(n)} ₽`;
export const samaraTime = (date = new Date()) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Samara', hour: '2-digit', minute: '2-digit' }).format(date);
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
 * One shape for an order, a request and a status change, so that every
 * channel renders the same facts. `rows` are database rows, `names` the related
 * titles (`place`, `format`), `adminUrl` the card in the admin.
 * Одна форма для заказа, заявки и смены статуса, чтобы каждый канал рисовал одни
 * и те же факты. `rows` — строки базы, `names` — названия связей (`place`,
 * `format`), `adminUrl` — карточка в админке.
 */
export const orderModel = (order, { place = null, adminUrl = null } = {}) => {
  const items = json(order.items, []) ?? [];
  const how =
    order.fulfillment === 'pickup'
      ? `Самовывоз${place ? `: ${place}` : ''}`
      : `Доставка: ${[order.address, order.address_details].filter(Boolean).join(', ') || 'адрес не указан'}`;
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
    facts: [how, `Когда: ${order.desired_time || 'как можно скорее'}`],
    lines: items.map((line) => `${line.title} × ${line.qty} — ${rub(line.sum ?? Number(line.price) * Number(line.qty))}`),
    // an order from the guest account: what points and the birthday discount took off, and what is left
    // заказ из личного кабинета: что сняли баллы и скидка именинника и сколько осталось
    total:
      order.to_pay !== null && order.to_pay !== undefined && Number(order.to_pay) !== Number(order.total)
        ? `Итого: ${rub(order.total)}${Number(order.discount) > 0 ? ` · скидка именинника −${rub(order.discount)}` : ''}${Number(order.bonus_spent) > 0 ? ` · баллами −${rub(order.bonus_spent)}` : ''} · к оплате ${rub(order.to_pay)}`
        : `Итого: ${rub(order.total)}`,
    notes: [
      order.comment ? `Комментарий: ${order.comment}` : null,
      order.manager_note ? order.manager_note : null,
      order.source && order.source !== 'site' ? `Источник: ${SOURCE_WORDS[order.source] ?? order.source}` : null,
    ].filter(Boolean),
    adminUrl,
  };
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
    vars: { ...base.vars, status: word },
  };
};

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
export const sendTelegram = async ({
  token,
  chatId,
  text,
  fetchImpl = fetch,
  delays = TELEGRAM_RETRY_DELAYS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) => {
  let attempts = 0;
  let reason = '';
  for (;;) {
    attempts += 1;
    let retry = false;
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      const answer = await response.json().catch(() => ({}));
      if (response.ok && answer.ok !== false) return { status: 'sent', attempts, error: null };
      reason = telegramReason(response.status, answer.description ?? '');
      retry = response.status >= 500 || response.status === 429;
    } catch (error) {
      const cause = error?.cause?.code ?? error?.code ?? error?.name ?? '';
      reason = `нет связи с Telegram${cause ? ` (${cause})` : ''}`;
      retry = true;
    }
    if (!retry || attempts > delays.length) return { status: 'failed', attempts, error: scrub(reason, [token]) };
    await sleep(delays[attempts - 1]);
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
export const deliver = async ({ model, settings, mail, sendMail, fetchImpl, delays, sleep, now = new Date(), secrets = [] }) => {
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
      const result = await sendTelegram({ token: settings.telegram_token, chatId: chat.id, text, fetchImpl, delays, sleep });
      results.push({ channel: 'telegram', recipient: chat.label ? `${chat.label} (${chat.id})` : chat.id, ...result });
    }
    telegramPart = partLine('Telegram', results.filter((r) => r.channel === 'telegram'), ['чат', 'чата', 'чатов']);
  }

  return { results, summary: `${emailPart} · ${telegramPart} · ${samaraTime(now)}` };
};

/** «почта ✓», «почта ✓ 2 адреса», «почта ✓ 1 из 2», «почта ✗ <причина>» */
function partLine(name, rows, words) {
  const sent = rows.filter((r) => r.status === 'sent').length;
  if (sent === rows.length) return `${name} ✓${rows.length > 1 ? ` ${rows.length} ${plural(rows.length, words)}` : ''}`;
  if (sent > 0) return `${name} ✓ ${sent} из ${rows.length}`;
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
