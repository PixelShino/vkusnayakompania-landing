/**
 * Catering requests from the site's form (`/catering/`). The public role may
 * only create a request and never read one back, so everything the browser
 * sends is checked here before the row is written: the phone is normalised,
 * the date may not lie in the past, the format must be one the site shows, the
 * hall must be one of ours, the status, the source and the number are set by
 * us, and one address may not flood the inbox. After the row is written,
 * editors and administrators get a notification in the admin (and a letter,
 * once SMTP is configured).
 *
 * Заявки на кейтеринг из формы сайта (`/catering/`). Публичная роль может
 * только создать заявку и не может прочитать её обратно, поэтому всё, что
 * прислал браузер, проверяется здесь до записи: телефон приводится к одному
 * виду, дата не может быть в прошлом, формат — только из тех, что показывает
 * сайт, зал — только наш, статус, источник и номер ставим мы, а один адрес не
 * может завалить заявками. После записи редакторы и администраторы получают
 * уведомление в админке (и письмо, когда настроен SMTP).
 *
 * The rules mirror `src/lib/request.ts` on the site: the form refuses the same
 * things before sending, this hook is the part a script cannot skip; parity is
 * checked by `pnpm test`. Orders from the cart have their own hook
 * (`order-guard`): the two share the phone rule and nothing else.
 * Правила повторяют `src/lib/request.ts` сайта: форма отказывает в том же до
 * отправки, а этот хук — та часть, которую скрипт обойти не может; паритет
 * проверяет `pnpm test`. У заказов из корзины свой хук (`order-guard`): общее у
 * них только правило телефона.
 *
 * No build step: this file is the extension. / Без сборки: этот файл и есть расширение.
 */

export const LIMITS = { name: 80, address: 200, wishes: 2000, guests: 2000, daysAhead: 730 };
// one visitor, ten minutes, five requests: a typo and a retry fit, a script does not
// один посетитель, десять минут, пять заявок: опечатка и повтор поместятся, скрипт — нет
const RATE = { max: 5, windowMs: 10 * 60 * 1000 };
// who hears about a new request / кто узнаёт о новой заявке
const NOTIFY_ROLES = ['Administrator', 'Редактор'];
const VENUES = new Set(['hall', 'offsite', 'unknown']);

// Directus turns an error named `DirectusError` into a proper HTTP answer with
// its status and message; anything else becomes a faceless 500
// Directus превращает ошибку с именем `DirectusError` в ответ со своим статусом
// и текстом; всё остальное становится безликим 500
export class RequestError extends Error {
  name = 'DirectusError';
  constructor(message, status = 400, code = 'INVALID_PAYLOAD') {
    super(message);
    this.status = status;
    this.code = code;
    this.extensions = { reason: message };
  }
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** «8 (987) 955 25 65» → «+7 987 955-25-65»; null — не российский номер. То же, что у `order-guard`. */
export const normalizePhone = (value) => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  if (!/^7[3-9]\d{9}$/.test(digits)) return null;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
};

/** Сегодня в Самаре, YYYY-MM-DD: «прошлое» для даты праздника считается по точкам, а не по серверу. */
export const samaraToday = (now = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Samara' }).format(now);

const DAY = 86_400_000;
const addDays = (ymd, days) => new Date(Date.parse(`${ymd}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * The part of the check that needs no database: what the site's form checks
 * too. Returns the clean fields or throws the message the guest will read.
 * Часть проверки, которой не нужна база: то же проверяет и форма сайта.
 * Возвращает чистые поля или бросает сообщение, которое прочитает гость.
 */
export const checkRequest = (payload, today = samaraToday()) => {
  const name = text(payload?.name, LIMITS.name);
  if (!name) throw new RequestError('Укажите имя.');
  const phone = normalizePhone(payload?.phone);
  if (!phone) throw new RequestError('Телефон не похож на российский номер.');
  if (payload?.consent !== true) throw new RequestError('Нужно согласие на обработку данных.');

  let event_date = null;
  if (payload?.event_date !== undefined && payload?.event_date !== null && payload?.event_date !== '') {
    const value = String(payload.event_date).slice(0, 10);
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && addDays(value, 0) === value;
    if (!valid) throw new RequestError('Дата праздника не похожа на дату.');
    if (value < today) throw new RequestError('Дата праздника уже прошла — выберите другую.');
    if (value > addDays(today, LIMITS.daysAhead)) throw new RequestError('Так далеко вперёд не принимаем: выберите дату в ближайшие два года.');
    event_date = value;
  }

  let guests = null;
  if (payload?.guests !== undefined && payload?.guests !== null && payload?.guests !== '') {
    guests = Number(payload.guests);
    if (!Number.isInteger(guests) || guests < 1 || guests > LIMITS.guests)
      throw new RequestError(`Число гостей — от 1 до ${LIMITS.guests}.`);
  }

  const venue = VENUES.has(payload?.venue) ? payload.venue : 'unknown';
  const place = venue === 'hall' ? Number(payload?.place) : null;
  // `Number(null)` is 0, so the id must be positive, not just whole
  // `Number(null)` — это 0, поэтому номер должен быть положительным, а не просто целым
  if (venue === 'hall' && !(Number.isInteger(place) && place > 0)) throw new RequestError('Выберите зал.');
  const format = payload?.format === null || payload?.format === undefined || payload?.format === '' ? null : Number(payload.format);
  if (format !== null && !(Number.isInteger(format) && format > 0)) throw new RequestError('Такого формата нет. Обновите страницу.');

  return {
    name,
    phone,
    event_date,
    guests,
    format,
    venue,
    place,
    address: venue === 'offsite' ? text(payload?.address, LIMITS.address) || null : null,
    wishes: text(payload?.wishes, LIMITS.wishes) || null,
    consent: true,
  };
};

/** «1210-4821»: день, месяц и четыре цифры — короткий номер, который гость назовёт по телефону */
const freshNumber = () => {
  const day = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Samara', day: '2-digit', month: '2-digit' })
    .format(new Date())
    .replace('.', '');
  return `${day}-${String(Math.floor(1000 + Math.random() * 9000))}`;
};

const longDate = (ymd) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', weekday: 'short' }).format(
    new Date(`${ymd}T12:00:00Z`),
  );
const guestsText = (n) => {
  const tail = n % 100;
  const word = tail >= 11 && tail <= 14 ? 'гостей' : n % 10 === 1 ? 'гость' : [2, 3, 4].includes(n % 10) ? 'гостя' : 'гостей';
  return `${n} ${word}`;
};

export default ({ filter, action }, { services, logger }) => {
  const hits = new Map();

  const tooMany = (ip) => {
    if (!ip) return false;
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs);
    recent.push(now);
    hits.set(ip, recent);
    // the map must not grow forever on a public endpoint
    // на публичном адресе карта не должна расти бесконечно
    if (hits.size > 5000) for (const [key, times] of hits) if (now - times.at(-1) > RATE.windowMs) hits.delete(key);
    return recent.length > RATE.max;
  };

  filter('catering_requests.items.create', async (payload, _meta, { accountability, database }) => {
    // an editor entering a request taken by phone, and internal calls, pass as they are
    // редактор, вбивающий заявку с телефона, и внутренние вызовы проходят как есть
    if (!accountability || accountability.user) return payload;

    if (tooMany(accountability.ip))
      throw new RequestError('Слишком много заявок подряд. Позвоните нам — обсудим праздник по телефону.', 429, 'REQUESTS_EXCEEDED');

    const clean = checkRequest(payload);

    // the format must be one the page shows; a hidden or deleted one is refused
    // формат — только из тех, что показывает страница; скрытый или удалённый — отказ
    if (clean.format !== null) {
      const row = await database('catering_formats').where({ id: clean.format }).first('id', 'status');
      if (!row || row.status !== 'published') throw new RequestError('Такого формата больше нет. Обновите страницу.');
    }
    if (clean.venue === 'hall') {
      const known = await database('places').where({ id: clean.place }).first('id');
      if (!known) throw new RequestError('Такого зала нет. Обновите страницу.');
    }

    let number = /^\d{4}-\d{4}$/.test(String(payload.number ?? '')) ? payload.number : freshNumber();
    if (await database('catering_requests').where({ number }).first('id'))
      number = `${number}-${Math.floor(Math.random() * 90 + 10)}`;

    return { ...clean, number, status: 'new', source: 'site', manager_note: null };
  });

  action('catering_requests.items.create', async ({ key, payload }, { database, schema }) => {
    try {
      const roles = await database('directus_roles').whereIn('name', NOTIFY_ROLES).pluck('id');
      const users = roles.length
        ? await database('directus_users').whereIn('role', roles).where({ status: 'active' }).pluck('id')
        : [];
      if (!users.length) return;
      const format = payload.format
        ? (await database('catering_formats').where({ id: payload.format }).first('title'))?.title
        : null;
      const place = payload.place ? (await database('places').where({ id: payload.place }).first('name'))?.name : null;
      const where =
        payload.venue === 'hall'
          ? (place ? `зал: ${place}` : 'в нашем зале')
          : payload.venue === 'offsite'
            ? `выезд${payload.address ? `: ${payload.address}` : ''}`
            : 'место пока не выбрано';
      const facts = [
        payload.event_date ? longDate(payload.event_date) : 'дата не названа',
        payload.guests ? guestsText(payload.guests) : 'число гостей не названо',
        format ?? 'формат не выбран',
        where,
      ];
      const message = [
        `**${payload.name}**, ${payload.phone}`,
        facts.join(' · '),
        payload.wishes ? `\nПожелания: ${payload.wishes}` : '',
      ].join('\n');
      const subject = ['Заявка на кейтеринг', payload.number ?? key, payload.guests ? `· ${guestsText(payload.guests)}` : '']
        .filter(Boolean)
        .join(' ');
      const notifications = new services.NotificationsService({ schema, knex: database });
      for (const recipient of users) {
        await notifications.createOne({ recipient, subject, message, collection: 'catering_requests', item: String(key) });
      }
    } catch (error) {
      // a lost notification must not lose the request: it is already written
      // потерянное уведомление не должно терять заявку: она уже записана
      logger.warn(`request-guard: уведомление о заявке ${key} не создано — ${error.message}`);
    }
  });
};
