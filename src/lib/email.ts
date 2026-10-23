/**
 * Which mailboxes the site accepts: Russian mail services only (the owner's
 * decision). The server keeps the same list in
 * `directus/extensions/email-guard/domains.js`; `email.check.ts` keeps them equal.
 * Какие ящики принимает сайт: только российские почтовые службы (решение
 * владельца). У сервера тот же список в `directus/extensions/email-guard/domains.js`;
 * `email.check.ts` следит за их равенством.
 */

/** Mail.ru, Яндекс, Рамблер, VK — только точный домен, без поддоменов. */
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

/** Своя почта компании: в админке можно, гостям не предлагается. */
export const OWN_MAIL_DOMAINS = ['vkus-com.ru'];

export const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** «Anna@Mail.RU » → «mail.ru»; не адрес — null. */
export const emailDomain = (email: string | null | undefined): string | null => {
  const value = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_FORMAT_RE.test(value)) return null;
  return value.slice(value.lastIndexOf('@') + 1);
};

/** Ящик, который сайт принимает: российская служба, а с `own` ещё и свой домен. Кривой адрес — не российский. */
export const isRuEmail = (email: string | null | undefined, { own = false }: { own?: boolean } = {}): boolean => {
  const domain = emailDomain(email);
  if (!domain) return false;
  return RU_MAIL_DOMAINS.includes(domain) || (own && OWN_MAIL_DOMAINS.includes(domain));
};

export const RU_MAIL_ERROR = 'Укажите российскую почту: mail.ru, yandex.ru, rambler.ru, vk.com…';
export const RU_MAIL_ERROR_ADMIN = 'Только российская почта (mail.ru, yandex.ru, rambler.ru, vk.com…) или адрес на vkus-com.ru';
