/**
 * Which mailboxes the site accepts: Russian mail services only — the owner's
 * decision for the guests' recovery mail and for the addresses in the admin.
 * The site keeps the same list in `src/lib/email.ts`; `src/lib/email.check.ts`
 * makes sure the two never drift apart. Extensions import this file from
 * `../email-guard/domains.js` (bundles without a build step).
 * Какие ящики принимает сайт: только российские почтовые службы — решение
 * владельца для почты гостей и адресов в админке. Тот же список у сайта в
 * `src/lib/email.ts`; `src/lib/email.check.ts` следит, чтобы они не разошлись.
 * Расширения берут этот файл как `../email-guard/domains.js` (бандлы без сборки).
 */

/** Mail.ru, Яндекс, Рамблер, VK — only the exact domain, no subdomains. / Только точный домен, без поддоменов. */
export const RU_MAIL_DOMAINS = [
  'mail.ru',
  'bk.ru',
  'list.ru',
  'inbox.ru',
  'internet.ru',
  'xmail.ru',
  'yandex.ru',
  'ya.ru',
  'yandex.com',
  'rambler.ru',
  'lenta.ru',
  'autorambler.ru',
  'myrambler.ru',
  'ro.ru',
  'vk.com',
];

/** The company's own mail: allowed in the admin (recipients, the contact mail), not offered to guests. / Своя почта: в админке можно, гостям не предлагается. */
export const OWN_MAIL_DOMAINS = ['vkus-com.ru'];

export const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** «Anna@Mail.RU » → «mail.ru»; not an address — null. / Не адрес — null. */
export const emailDomain = (email) => {
  const value = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_FORMAT_RE.test(value)) return null;
  return value.slice(value.lastIndexOf('@') + 1);
};

/**
 * A mailbox the site takes: a Russian service, and with `own` the company's
 * domain as well. The format is checked here too: a broken address is not Russian.
 * Ящик, который сайт принимает: российская служба, а с `own` ещё и свой домен.
 * Формат тоже проверяется: кривой адрес — не российский.
 */
export const isRuEmail = (email, { own = false } = {}) => {
  const domain = emailDomain(email);
  if (!domain) return false;
  return RU_MAIL_DOMAINS.includes(domain) || (own && OWN_MAIL_DOMAINS.includes(domain));
};

export const RU_MAIL_ERROR = 'Укажите российскую почту: mail.ru, yandex.ru, rambler.ru, vk.com…';
export const RU_MAIL_ERROR_ADMIN = 'Только российская почта (mail.ru, yandex.ru, rambler.ru, vk.com…) или адрес на vkus-com.ru';
