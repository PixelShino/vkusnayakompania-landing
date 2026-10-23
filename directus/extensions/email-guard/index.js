/**
 * Russian mail only — the hook that no request gets around: the account page,
 * `PATCH /users/me`, the admin form and a script all go through these filters.
 *   · a guest's recovery mail (`directus_users.recovery_email`) — Mail.ru,
 *     Яндекс, Рамблер, VK;
 *   · «Оповещения» → «Кому писать» and «Настройки сайта» → «Почта для
 *     обращений» — the same services or the company's vkus-com.ru.
 * Clearing a field is always allowed. The list lives in `domains.js`, the
 * rules in `rules.js` (checked by `scripts/notify.check.mjs`).
 * Только российская почта — хук, который не обойти запросом: страница
 * кабинета, `PATCH /users/me`, форма админки и скрипт проходят через эти
 * фильтры.
 *   · почта гостя для восстановления — Mail.ru, Яндекс, Рамблер, VK;
 *   · «Оповещения» → «Кому писать» и «Настройки сайта» → «Почта для
 *     обращений» — те же службы или свой vkus-com.ru.
 * Очистить поле можно всегда. Список — в `domains.js`, правила — в `rules.js`
 * (их проверяет `scripts/notify.check.mjs`).
 */
import { RULES, payloadProblem } from './rules.js';

// the error Directus answers with: 400, the text in `extensions.reason` (as order-guard)
// ошибка, которой ответит Directus: 400, текст в `extensions.reason` (как в order-guard)
class EmailError extends Error {
  name = 'DirectusError';
  constructor(message, status = 400, code = 'INVALID_PAYLOAD') {
    super(message);
    this.status = status;
    this.code = code;
    this.extensions = { reason: message };
  }
}

export default ({ filter }) => {
  for (const rule of RULES)
    for (const event of rule.events)
      filter(event, (payload) => {
        const problem = payloadProblem(rule, payload);
        if (problem) throw new EmailError(problem);
        return payload;
      });
};
