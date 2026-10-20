/**
 * Sign-in by phone for the site's guests, no passwords: the number gets a code
 * (a call, an SMS or the operator's «Мобильная авторизация» through SMS Aero),
 * the code gets a session. A guest is a Directus user with the «Гость» role,
 * found or created by the phone; the session is a Directus access token —
 * the same JWT Directus issues itself (HS256 with `SECRET`, issuer `directus`,
 * 30 days) bound to a row in `directus_sessions`. With it the guest's browser
 * talks to the regular API under the «Гость» policy: its own profile, its own
 * orders and points, a new order. Signing out deletes the session row, so a
 * stolen token dies with it, and a suspended guest is cut off at once.
 *
 * Вход гостей сайта по телефону, без паролей: на номер приходит код (звонок,
 * SMS или «Мобильная авторизация» оператора через SMS Aero), за код выдаётся
 * сессия. Гость — пользователь Directus с ролью «Гость», найденный или
 * заведённый по телефону; сессия — токен доступа Directus, тот же JWT, что
 * Directus выдаёт сам (HS256 на `SECRET`, издатель `directus`, 30 дней),
 * привязанный к строке в `directus_sessions`. С ним браузер гостя говорит с
 * обычным API по политике «Гость»: свой профиль, свои заказы и баллы, новый
 * заказ. Выход удаляет строку сессии — украденный токен умирает вместе с ней,
 * а заблокированный гость отключается сразу.
 *
 *   POST /guest-auth/send     { phone, channel? }  → { request, channel, hint, resend_in, fallback }
 *   POST /guest-auth/verify   { phone, code? }     → { token, expires, created } | 202 { pending }
 *   GET  /guest-auth/me                            → profile, orders, points, programme
 *   POST /guest-auth/profile  { first_name, … }    → profile
 *   POST /guest-auth/logout                        → 204
 *
 * Code: four digits, five minutes, five tries; the table keeps only an HMAC of
 * it. Limits: a new code once a minute, five an hour and ten a day per number,
 * twelve an hour per address; thirty tries in ten minutes per address.
 * Код: четыре цифры, пять минут, пять попыток; в таблице только HMAC от него.
 * Лимиты: новый код раз в минуту, пять в час и десять в сутки на номер,
 * двенадцать в час на адрес; тридцать попыток ввода за десять минут на адрес.
 *
 * Env: SMSAERO_EMAIL, SMSAERO_API_KEY. GUEST_AUTH_DEBUG=true — nothing is
 * sent, the code goes to the Directus log (GUEST_AUTH_DEBUG_CODE fixes it);
 * for local work only, off by default.
 * Окружение: SMSAERO_EMAIL, SMSAERO_API_KEY. GUEST_AUTH_DEBUG=true — ничего не
 * отправляется, код пишется в лог Directus (GUEST_AUTH_DEBUG_CODE задаёт его);
 * только для локальной работы, по умолчанию выключено.
 *
 * No build step: this file is the extension. / Без сборки: этот файл и есть расширение.
 */
import crypto from 'node:crypto';
import { smsaero } from './smsaero.js';

const GUEST_ROLE = 'Гость';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const CODE = { length: 4, ttlMs: 5 * MINUTE, tries: 5, resendMs: MINUTE };
export const LIMITS = { phoneHour: 5, phoneDay: 10, ipHour: 12, verifyWindowMs: 10 * MINUTE, verifyMax: 30 };
export const SESSION_DAYS = 30;

const PROFILE_FIELDS = [
  'id', 'first_name', 'middle_name', 'last_name', 'phone', 'birthday', 'gender', 'recovery_email',
  'bonus_balance', 'total_spent', 'tier', 'guest_since', 'birthday_set_at',
];
const ORDER_FIELDS = [
  'id', 'number', 'status', 'date_created', 'fulfillment', 'place', 'address', 'desired_time',
  'items', 'total', 'bonus_spent', 'discount', 'to_pay', 'bonus_earned',
];
const TX_FIELDS = ['id', 'type', 'amount', 'date_created', 'expires_at', 'comment', 'order.number'];

/** «8 (987) 955 25 65» → «+7 987 955-25-65» — как в заказах (`order-guard`); null — не российский номер. */
export const normalizePhone = (value) => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  if (!/^7[3-9]\d{9}$/.test(digits)) return null;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
};
const digitsOf = (phone) => phone.replace(/\D/g, '');
/** «+7 987 ***-**-65» — номер в логе без середины */
const masked = (phone) => phone.replace(/\d{3}-\d{2}(?=-\d{2}$)/, '***-**');

export const hashCode = (secret, phone, code) => crypto.createHmac('sha256', String(secret)).update(`${phone}:${code}`).digest('hex');
const sameHash = (a, b) => Boolean(a && b) && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const randomCode = () => String(crypto.randomInt(0, 10 ** CODE.length)).padStart(CODE.length, '0');

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
/**
 * A Directus access token: HS256 over `SECRET`, `iss: directus`, and the
 * claims `verifyAccessJWT` requires (`role`, `app_access`, `admin_access`).
 * Токен доступа Directus: HS256 на `SECRET`, `iss: directus` и поля, которых
 * требует `verifyAccessJWT` (`role`, `app_access`, `admin_access`).
 */
export const signToken = (claims, secret, ttlSeconds, now = Date.now()) => {
  const iat = Math.floor(now / 1000);
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...claims, iat, exp: iat + ttlSeconds, iss: 'directus' })}`;
  return `${head}.${crypto.createHmac('sha256', String(secret)).update(head).digest('base64url')}`;
};

const fill = (template, values) => String(template ?? '').replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
const pretty = (phone) => phone.replace(/^\+7 (\d{3}) /, '+7 ($1) ');

/** Сегодня в поясе точек: «2026-10-19». */
const samaraToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Samara' }).format(new Date());

/**
 * The profile a guest may save — the same rules as the account page
 * (`src/lib/account.ts`, `profileErrors`); `pnpm test` keeps them equal.
 * Профиль, который гость может сохранить, — те же правила, что у страницы
 * кабинета (`src/lib/account.ts`, `profileErrors`); `pnpm test` держит их равными.
 */
export const profileErrors = (input, today = samaraToday()) => {
  const errors = {};
  for (const [key, max] of [['first_name', 60], ['middle_name', 60], ['last_name', 60]])
    if (String(input[key] ?? '').trim().length > max) errors[key] = `Не длиннее ${max} знаков`;
  const birthday = String(input.birthday ?? '').trim();
  if (birthday) {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(birthday) && !Number.isNaN(Date.parse(`${birthday}T00:00:00Z`)) && new Date(`${birthday}T00:00:00Z`).toISOString().slice(0, 10) === birthday;
    const age = valid ? Number(today.slice(0, 4)) - Number(birthday.slice(0, 4)) - (today.slice(5) < birthday.slice(5) ? 1 : 0) : -1;
    if (!valid) errors.birthday = 'Дата в виде ДД.ММ.ГГГГ';
    else if (birthday > today) errors.birthday = 'Дата ещё не наступила';
    else if (age < 7 || age > 110) errors.birthday = 'Проверьте год рождения';
  }
  if (input.gender && !['female', 'male'].includes(input.gender)) errors.gender = 'Выберите из списка';
  const email = String(input.recovery_email ?? '').trim();
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) errors.recovery_email = 'Проверьте адрес: name@example.ru';
  return errors;
};

const cleanProfile = (input) => {
  const out = {};
  for (const key of ['first_name', 'middle_name', 'last_name']) if (key in input) out[key] = String(input[key] ?? '').trim() || null;
  if ('birthday' in input) out.birthday = String(input.birthday ?? '').trim() || null;
  if ('gender' in input) out.gender = input.gender || null;
  if ('recovery_email' in input) out.recovery_email = String(input.recovery_email ?? '').trim().toLowerCase() || null;
  return out;
};

const fail = (res, status, code, message, extra = {}) =>
  res.status(status).json({ errors: [{ message, extensions: { code, reason: message, ...extra } }] });

export default {
  id: 'guest-auth',
  handler: (router, { database, env, logger, services, getSchema }) => {
    const secret = env.SECRET;
    const debug = env.GUEST_AUTH_DEBUG === true || String(env.GUEST_AUTH_DEBUG).toLowerCase() === 'true';
    const debugCode = env.GUEST_AUTH_DEBUG_CODE ? String(env.GUEST_AUTH_DEBUG_CODE).replace(/\D/g, '').padStart(CODE.length, '0').slice(-CODE.length) : null;
    const provider =
      env.SMSAERO_EMAIL && env.SMSAERO_API_KEY ? smsaero({ email: String(env.SMSAERO_EMAIL), apiKey: String(env.SMSAERO_API_KEY) }) : null;
    const publicUrl = String(env.PUBLIC_URL ?? '').replace(/\/+$/, '');
    if (debug) logger.warn('guest-auth: РЕЖИМ ОТЛАДКИ — коды не отправляются, а пишутся в лог. На боевом сервере выключить (GUEST_AUTH_DEBUG)');
    else if (!provider) logger.warn('guest-auth: нет SMSAERO_EMAIL / SMSAERO_API_KEY — вход по коду не работает');

    let guestRoleId = null;
    const guestRole = async () => {
      if (!guestRoleId) guestRoleId = (await database('directus_roles').where({ name: GUEST_ROLE }).first('id'))?.id ?? null;
      return guestRoleId;
    };
    const settings = async () => {
      const row = await database('guest_auth_settings').first().catch(() => null);
      return {
        enabled: row?.enabled !== false,
        channel: ['call', 'sms', 'mobile_id'].includes(row?.channel) ? row.channel : 'call',
        fallback_sms: row?.fallback_sms !== false,
        sms_sign: row?.sms_sign || 'SMS Aero',
        sms_text: row?.sms_text || 'Код для входа на vkus-com.ru: {code}. Никому его не сообщайте',
        hint_call: row?.hint_call || 'Сейчас позвоним на {phone}. Отвечать не нужно — введите последние 4 цифры номера, с которого звонят.',
        hint_sms: row?.hint_sms || 'Отправили SMS с кодом на {phone}.',
        hint_mobile_id:
          row?.hint_mobile_id || 'Подтвердите вход в запросе, который придёт на {phone}. Если вместо запроса пришло SMS с кодом — введите его здесь.',
      };
    };
    const smsText = (s, code) => (s.sms_text.includes('{code}') ? fill(s.sms_text, { code }) : `${s.sms_text} ${code}`);

    // in-memory try counter per address: verification is cheap to hammer
    // счётчик попыток ввода по адресу в памяти: проверку дёшево долбить
    const tries = new Map();
    const tooManyTries = (ip) => {
      if (!ip) return false;
      const now = Date.now();
      const recent = (tries.get(ip) ?? []).filter((t) => now - t < LIMITS.verifyWindowMs);
      recent.push(now);
      tries.set(ip, recent);
      if (tries.size > 5000) for (const [key, list] of tries) if (now - list.at(-1) > LIMITS.verifyWindowMs) tries.delete(key);
      return recent.length > LIMITS.verifyMax;
    };

    const route = (handler) => (req, res, next) => handler(req, res).catch(next);
    /** id гостя за токеном запроса; null — не вошёл или это не гость */
    const guestOf = async (req) => {
      const accountability = req.accountability;
      if (!accountability?.user || !accountability.role) return null;
      return accountability.role === (await guestRole()) ? accountability.user : null;
    };

    // ── send a code / отправить код ───────────────────────────────────────
    router.post(
      '/send',
      route(async (req, res) => {
        const s = await settings();
        if (!s.enabled) return fail(res, 503, 'AUTH_CLOSED', 'Вход на сайте временно закрыт. Позвоните нам — примем заказ по телефону.');
        const phone = normalizePhone(req.body?.phone);
        if (!phone) return fail(res, 400, 'INVALID_PHONE', 'Проверьте номер: нужен российский, 10 цифр после +7.');
        const ip = req.accountability?.ip ?? null;
        const now = Date.now();

        const recent = await database('auth_codes').where({ phone }).where('date_created', '>', new Date(now - DAY)).orderBy('date_created', 'desc').select('date_created', 'status');
        // the pause is between codes that are still waiting: after a successful
        // sign-in (sign out, sign in on another device) a new code goes at once
        // пауза — между кодами, которые ещё ждут: после удачного входа (вышел,
        // входит на другом устройстве) новый код уходит сразу
        const waiting = recent.find((row) => row.status !== 'used');
        const last = waiting && recent[0] === waiting ? new Date(waiting.date_created).getTime() : 0;
        if (now - last < CODE.resendMs) {
          const wait = Math.ceil((CODE.resendMs - (now - last)) / 1000);
          return fail(res, 429, 'TOO_SOON', `Код уже отправлен. Запросить новый можно через ${wait} с.`, { retry_after: wait });
        }
        const lastHour = recent.filter((row) => now - new Date(row.date_created).getTime() < HOUR).length;
        if (lastHour >= LIMITS.phoneHour || recent.length >= LIMITS.phoneDay)
          return fail(res, 429, 'TOO_MANY', 'На этот номер уже отправили много кодов. Попробуйте через час или позвоните нам.');
        if (ip) {
          const row = await database('auth_codes').where({ ip }).where('date_created', '>', new Date(now - HOUR)).count('* as n').first();
          if (Number(row?.n ?? 0) >= LIMITS.ipHour) return fail(res, 429, 'TOO_MANY', 'Слишком много запросов кода. Попробуйте через час или позвоните нам.');
        }

        // the guest may ask for an SMS instead (when the admin allows it); otherwise the admin's channel
        // гость может попросить SMS вместо звонка (если это разрешено в админке); иначе — канал из админки
        let channel = s.channel;
        if (req.body?.channel === 'sms' && (s.fallback_sms || s.channel === 'sms')) channel = 'sms';

        let code = null;
        let providerId = null;
        if (debug) {
          code = debugCode ?? randomCode();
          logger.warn(`guest-auth: режим отладки — код для ${masked(phone)} (${channel}): ${code}; ничего не отправлено`);
        } else if (!provider) {
          return fail(res, 503, 'NO_PROVIDER', 'Вход по коду ещё не настроен. Позвоните нам — примем заказ по телефону.');
        } else {
          const digits = digitsOf(phone);
          const sendSms = async () => {
            code = randomCode();
            const data = await provider.sms(digits, smsText(s, code), s.sms_sign);
            providerId = String((Array.isArray(data) ? data[0]?.id : data?.id) ?? '');
          };
          try {
            if (channel === 'sms') await sendSms();
            else if (channel === 'call') {
              code = randomCode();
              providerId = String((await provider.call(digits, code))?.id ?? '');
            } else {
              const data = await provider.mobileId(digits, s.sms_sign, `${publicUrl}/guest-auth/mobile-id`);
              providerId = String(data?.id ?? '');
            }
          } catch (error) {
            logger.warn(`guest-auth: ${channel} на ${masked(phone)} не ушёл — ${error.message}`);
            if (channel === 'sms' || !s.fallback_sms) return fail(res, 502, 'SEND_FAILED', 'Не получилось отправить код. Попробуйте через минуту или позвоните нам.');
            // the call (or the operator) failed: the code goes by SMS, the guest is told so
            // звонок (или оператор) не сработал: код уходит SMS, гостю об этом говорится
            try {
              channel = 'sms';
              await sendSms();
            } catch (second) {
              logger.warn(`guest-auth: SMS на ${masked(phone)} тоже не ушло — ${second.message}`);
              return fail(res, 502, 'SEND_FAILED', 'Не получилось отправить код. Попробуйте через минуту или позвоните нам.');
            }
          }
        }

        // the newest code wins: an earlier one stops working
        // действует последний код: прежний перестаёт работать
        await database('auth_codes').where({ phone, status: 'sent' }).update({ status: 'replaced' });
        const id = crypto.randomUUID();
        await database('auth_codes').insert({
          id,
          phone,
          channel,
          code_hash: code ? hashCode(secret, phone, code) : null,
          provider_id: providerId || null,
          attempts: 0,
          expires_at: new Date(now + CODE.ttlMs),
          status: 'sent',
          ip,
          date_created: new Date(now),
        });
        const hint = { call: s.hint_call, sms: s.hint_sms, mobile_id: s.hint_mobile_id }[channel];
        res.json({
          data: {
            request: id,
            channel,
            length: CODE.length,
            expires_in: CODE.ttlMs / 1000,
            resend_in: CODE.resendMs / 1000,
            hint: fill(hint, { phone: pretty(phone) }),
            fallback: channel !== 'sms' && s.fallback_sms,
            ...(debug && { debug: true }),
          },
        });
      }),
    );

    // ── check the code, open a session / проверить код, открыть сессию ─────
    router.post(
      '/verify',
      route(async (req, res) => {
        const ip = req.accountability?.ip ?? null;
        if (tooManyTries(ip)) return fail(res, 429, 'TOO_MANY', 'Слишком много попыток. Подождите десять минут или позвоните нам.');
        const phone = normalizePhone(req.body?.phone);
        if (!phone) return fail(res, 400, 'INVALID_PHONE', 'Проверьте номер: нужен российский, 10 цифр после +7.');
        // the browser that asked for the code names its request (`/send` gave the id):
        // a stranger who only knows the phone cannot pick up this confirmation
        // браузер, который просил код, называет свой запрос (id выдал `/send`):
        // посторонний, знающий только телефон, это подтверждение не заберёт
        const request = typeof req.body?.request === 'string' && /^[0-9a-f-]{36}$/i.test(req.body.request) ? req.body.request : null;
        const row = await database('auth_codes')
          .where({ phone, status: 'sent' })
          .where('expires_at', '>', new Date())
          .orderBy('date_created', 'desc')
          .first();
        if (!row || (request && row.id !== request)) return fail(res, 400, 'CODE_EXPIRED', 'Код устарел. Запросите новый.');
        const code = String(req.body?.code ?? '').replace(/\D/g, '');
        const s = await settings();

        const wrong = async () => {
          // counted in the database, not from this request's snapshot: ten wrong
          // codes at once are ten tries, not one
          // считается в базе, а не по снимку этого запроса: десять неверных кодов
          // разом — десять попыток, а не одна
          await database('auth_codes').where({ id: row.id, status: 'sent' }).update({ attempts: database.raw('attempts + 1') });
          const attempts = Number((await database('auth_codes').where({ id: row.id }).first('attempts'))?.attempts ?? Number(row.attempts) + 1);
          const burnt = attempts >= CODE.tries;
          if (burnt) await database('auth_codes').where({ id: row.id, status: 'sent' }).update({ status: 'burnt' });
          return burnt
            ? fail(res, 400, 'CODE_BURNT', `Код введён неверно ${CODE.tries} раз. Запросите новый.`)
            : fail(res, 400, 'CODE_WRONG', `Неверный код. Осталось попыток: ${CODE.tries - attempts}.`, { attempts_left: CODE.tries - attempts });
        };

        if (row.channel === 'mobile_id' && !row.code_hash) {
          // the operator's sign-in: the code (if any) is checked by SMS Aero,
          // a confirmation on the phone is read back from SMS Aero — the
          // webhook is never trusted, anyone can post to it
          // вход через оператора: код (если пришёл) проверяет SMS Aero,
          // подтверждение на телефоне читается обратно у SMS Aero — вебхуку не
          // верим, отправить в него может кто угодно
          if (!provider) return fail(res, 503, 'NO_PROVIDER', 'Вход по коду ещё не настроен. Позвоните нам.');
          if (!code) {
            // a confirmation on the phone opens a session only for the browser
            // that started this sign-in — anyone else needs the code
            // подтверждение на телефоне открывает сессию только браузеру, который
            // начал этот вход, — остальным нужен код
            if (!request) return fail(res, 400, 'CODE_REQUIRED', 'Введите код из сообщения или продолжите вход там, где его начали.');
            const data = await provider.mobileIdStatus(row.provider_id).catch(() => null);
            if (data?.status === 1) {
              /* confirmed on the phone / подтверждено на телефоне */
            } else if (data && [2, 16].includes(data.status)) {
              await database('auth_codes').where({ id: row.id }).update({ status: 'failed' });
              return fail(res, 400, 'CONFIRM_FAILED', 'Оператор не подтвердил вход. Запросите код ещё раз.');
            } else return res.status(202).json({ data: { pending: true, otp: data?.status === 3 } });
          } else {
            // SMS Aero registers the sign-in a few seconds after `send`: until then
            // `verify` answers «session not found» — that is not a wrong code
            // SMS Aero заводит вход через несколько секунд после `send`: до этого
            // `verify` отвечает «session not found» — это не неверный код
            const young = Date.now() - new Date(row.date_created).getTime() < 60_000;
            let accepted = false;
            for (let attempt = 0; attempt < 3 && !accepted; attempt += 1) {
              try {
                await provider.mobileIdVerify(row.provider_id, code, s.sms_sign);
                accepted = true;
              } catch (error) {
                const early = young && /session not found/i.test(error.message);
                if (early && attempt < 2) {
                  await new Promise((resolve) => setTimeout(resolve, 2000));
                  continue;
                }
                if (early) return fail(res, 409, 'NOT_READY', 'Код ещё в пути. Попробуйте ввести его через несколько секунд.');
                logger.info(`guest-auth: SMS Aero не принял код для ${masked(phone)} — ${error.message}`);
                return wrong();
              }
            }
          }
        } else {
          if (code.length !== CODE.length) return fail(res, 400, 'CODE_REQUIRED', `Введите ${CODE.length} цифры кода.`);
          if (!sameHash(hashCode(secret, phone, code), row.code_hash)) return wrong();
        }
        // the code is spent by one request only: two checks of the right code at
        // once give one session, not two
        // код тратится одним запросом: две одновременные проверки верного кода
        // дают одну сессию, а не две
        const taken = await database('auth_codes').where({ id: row.id, status: 'sent' }).update({ status: 'used', used_at: new Date() });
        if (!taken) return fail(res, 400, 'CODE_EXPIRED', 'Код уже использован. Запросите новый.');

        // the guest: found by the phone or created; a staff member's phone never opens a guest session
        // гость: найден по телефону или заведён; телефон сотрудника гостевую сессию не открывает
        const role = await guestRole();
        if (!role) return fail(res, 503, 'NO_ROLE', 'Личный кабинет ещё не настроен. Позвоните нам — примем заказ по телефону.');
        let user = await database('directus_users').where({ phone }).first('id', 'role', 'status');
        let created = false;
        if (!user) {
          const users = new services.UsersService({ schema: await getSchema(), knex: database });
          const id = await users.createOne({
            email: `${digitsOf(phone)}@guest.vkus-com.ru`,
            role,
            status: 'active',
            phone,
            guest_since: new Date().toISOString(),
            language: 'ru-RU',
          });
          user = { id, role, status: 'active' };
          created = true;
          logger.info(`guest-auth: новый гость ${masked(phone)}`);
        }
        if (user.role !== role) return fail(res, 403, 'NOT_A_GUEST', 'Этот номер привязан к сотруднику — войдите в админку как обычно.');
        if (user.status !== 'active') return fail(res, 403, 'SUSPENDED', 'Вход для этого номера закрыт. Позвоните нам.');

        const session = crypto.randomBytes(48).toString('base64url');
        const expires = new Date(Date.now() + SESSION_DAYS * DAY);
        await database('directus_sessions').insert({
          token: session,
          user: user.id,
          expires,
          ip,
          user_agent: String(req.get('user-agent') ?? '').slice(0, 255) || null,
          origin: String(req.get('origin') ?? '').slice(0, 255) || null,
        });
        await database('directus_users').where({ id: user.id }).update({ last_access: new Date() });
        const token = signToken({ id: user.id, role, app_access: false, admin_access: false, session }, secret, SESSION_DAYS * 86_400);
        res.json({ data: { token, expires: expires.toISOString(), created } });
      }),
    );

    // ── the account: everything the page shows in one round trip ──────────
    // ── кабинет: всё, что показывает страница, за один запрос ─────────────
    router.get(
      '/me',
      route(async (req, res) => {
        const user = await guestOf(req);
        if (!user) return fail(res, 401, 'NOT_SIGNED_IN', 'Войдите по номеру телефона.');
        const schema = await getSchema();
        const accountability = req.accountability;
        // read under the guest's own policy: the API gives only what the «Гость» role may see
        // чтение по политике самого гостя: API отдаёт только то, что можно роли «Гость»
        const [profile, orders, transactions, programme] = await Promise.all([
          new services.UsersService({ schema, accountability }).readOne(user, { fields: PROFILE_FIELDS }),
          new services.ItemsService('orders', { schema, accountability }).readByQuery({ fields: ORDER_FIELDS, sort: ['-date_created'], limit: 100 }),
          new services.ItemsService('bonus_transactions', { schema, accountability }).readByQuery({ fields: TX_FIELDS, sort: ['-date_created', '-id'], limit: 1000 }),
          database('loyalty_settings').first().catch(() => null),
        ]);
        const program = programme && {
          enabled: programme.enabled,
          program_name: programme.program_name,
          signup_bonus: programme.signup_bonus,
          points_ttl_days: programme.points_ttl_days,
          max_share_percent: programme.max_share_percent,
          tiers: programme.tiers,
          birthday_bonus: programme.birthday_bonus,
          birthday_window_days: programme.birthday_window_days,
          birthday_discount_percent: programme.birthday_discount_percent,
        };
        res.json({ data: { profile, orders, transactions, program, today: samaraToday() } });
      }),
    );

    router.post(
      '/profile',
      route(async (req, res) => {
        const user = await guestOf(req);
        if (!user) return fail(res, 401, 'NOT_SIGNED_IN', 'Войдите по номеру телефона.');
        const input = req.body ?? {};
        const errors = profileErrors(input);
        const first = Object.values(errors)[0];
        if (first) return fail(res, 400, 'INVALID_PROFILE', first, { fields: errors });
        const users = new services.UsersService({ schema: await getSchema(), accountability: req.accountability });
        try {
          await users.updateOne(user, cleanProfile(input));
        } catch (error) {
          if (Number(error?.status) >= 400 && Number(error?.status) < 500)
            return fail(res, error.status, error.code ?? 'INVALID_PAYLOAD', error.extensions?.reason ?? error.message, {
              fields: /рождени/i.test(error.message) ? { birthday: error.message } : undefined,
            });
          throw error;
        }
        res.json({ data: await users.readOne(user, { fields: PROFILE_FIELDS }) });
      }),
    );

    router.post(
      '/logout',
      route(async (req, res) => {
        if (req.accountability?.session) await database('directus_sessions').where({ token: req.accountability.session }).delete();
        res.status(204).end();
      }),
    );

    // SMS Aero posts sign-in statuses here; the answer must be 200. The status
    // itself is always asked back from SMS Aero (see /verify).
    // SMS Aero присылает сюда статусы входа; ответ должен быть 200. Сам статус
    // всегда переспрашивается у SMS Aero (см. /verify).
    router.post('/mobile-id', (_req, res) => res.json({ ok: true }));
  },
};
