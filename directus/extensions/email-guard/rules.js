/**
 * What the email-guard hook checks, without Directus: which field of which
 * collection takes which mail, and the text a refusal reads. `index.js` hangs
 * these rules on the filters; `scripts/notify.check.mjs` imports them as they
 * are — no side effects here.
 * Что проверяет хук email-guard, без Directus: какое поле какой коллекции
 * какую почту принимает и каким текстом отказывает. `index.js` вешает эти
 * правила на фильтры; `scripts/notify.check.mjs` берёт их как есть — побочных
 * эффектов здесь нет.
 */
import { RU_MAIL_ERROR, RU_MAIL_ERROR_ADMIN, isRuEmail } from './domains.js';

// null, '' or spaces: the field is being cleared, nothing to check
// null, '' или пробелы: поле очищают, проверять нечего
const blank = (value) => value === null || value === undefined || String(value).trim() === '';

/**
 * One address: the refusal text, or null when it is fine or empty. Without
 * `own` — a guest's mail (Russian services only); with `own` — an address in
 * the admin, where the company's vkus-com.ru is allowed too.
 * Один адрес: текст отказа или null, если подходит или пуст. Без `own` —
 * почта гостя (только российские службы); с `own` — адрес в админке, где можно
 * и свой vkus-com.ru.
 */
export const emailProblem = (email, { own = false } = {}) => {
  if (blank(email)) return null;
  if (isRuEmail(email, { own })) return null;
  return own ? RU_MAIL_ERROR_ADMIN : RU_MAIL_ERROR;
};

const LIST_SHAPE_ERROR = '«Кому писать»: ожидается список адресов [{ "email": "…" }]';

/** The JSON list as it may come: an array, a JSON string, or nothing. / Список, как он может прийти: массив, строка JSON или ничего. */
const rowsOf = (list) => {
  if (blank(list)) return [];
  let value = list;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value === null) return [];
  return Array.isArray(value) ? value : null;
};

/** The addresses of the list that are not allowed, each once, as typed. / Неподходящие адреса списка, каждый один раз, как набраны. */
const badRecipients = (rows) => {
  const seen = new Set();
  const bad = [];
  for (const row of rows) {
    const email = typeof row === 'string' ? row : row?.email;
    if (blank(email) || !emailProblem(email, { own: true })) continue;
    const typed = String(email).trim();
    if (seen.has(typed.toLowerCase())) continue;
    seen.add(typed.toLowerCase());
    bad.push(typed);
  }
  return bad;
};

/**
 * «Оповещения» → «Кому писать» (`notify_settings.email_recipients`,
 * `[{ email, label?, orders?, requests? }]`): one text per address that is
 * not allowed; an empty list means everything is fine.
 * «Оповещения» → «Кому писать»: по тексту на каждый неподходящий адрес;
 * пустой список — всё в порядке.
 */
export const recipientProblems = (list) => {
  const rows = rowsOf(list);
  if (!rows) return [LIST_SHAPE_ERROR];
  return badRecipients(rows).map((email) => `${RU_MAIL_ERROR_ADMIN}: ${email}`);
};

/** The same list as one refusal naming every wrong address, or null. / Тот же список одним отказом со всеми неподходящими адресами или null. */
export const recipientsError = (list) => {
  const rows = rowsOf(list);
  if (!rows) return LIST_SHAPE_ERROR;
  const bad = badRecipients(rows);
  return bad.length ? `${RU_MAIL_ERROR_ADMIN}: ${bad.join(', ')}` : null;
};

/**
 * Which field of which collection is guarded, on create and on update:
 *   · the guest's recovery mail — Russian services only (the account page,
 *     `PATCH /users/me` and the editor's form alike);
 *   · the alert recipients and the contact mail — Russian or vkus-com.ru.
 * Какое поле какой коллекции охраняется при создании и правке:
 *   · почта гостя для восстановления — только российские службы (страница
 *     кабинета, `PATCH /users/me` и форма редактора одинаково);
 *   · получатели оповещений и почта для обращений — российская или vkus-com.ru.
 */
export const RULES = [
  { events: ['users.create', 'users.update'], field: 'recovery_email', problem: (value) => emailProblem(value) },
  { events: ['notify_settings.items.create', 'notify_settings.items.update'], field: 'email_recipients', problem: recipientsError },
  { events: ['settings.items.create', 'settings.items.update'], field: 'email', problem: (value) => emailProblem(value, { own: true }) },
];

/**
 * The refusal for one payload under one rule, or null. A field the payload
 * does not carry is not touched; a batch (an array of items) is checked item
 * by item.
 * Отказ для одного payload по одному правилу или null. Поле, которого в
 * payload нет, не трогаем; пачку (массив записей) проверяем по записи.
 */
export const payloadProblem = (rule, payload) => {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const problem = payloadProblem(rule, item);
      if (problem) return problem;
    }
    return null;
  }
  if (!payload || typeof payload !== 'object' || !(rule.field in payload)) return null;
  return rule.problem(payload[rule.field]);
};
