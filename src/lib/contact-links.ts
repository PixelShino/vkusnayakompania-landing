/**
 * Where a guest who is stuck can write: the messenger links from the admin
 * («Настройки»: Telegram, Max) that really open a chat. Until the owner sends
 * the channel the admin keeps `https://max.ru/` as a placeholder; a bare home
 * page of a messenger, an empty field or not a web address opens no chat, so
 * the site does not print it.
 * Куда написать гостю, у которого что-то не получается: ссылки мессенджеров из
 * админки («Настройки»: Telegram, Max), которые правда открывают чат. Пока
 * владелец не прислал канал, в админке стоит заглушка `https://max.ru/`; голая
 * главная мессенджера, пустое поле или не веб-адрес чат не открывают — сайт их
 * не выводит.
 */

export type ChatLink = { label: 'Telegram' | 'Max'; href: string };

/** `https://t.me/vkusnayakompania` — да; `https://max.ru/`, `https://t.me`, пусто, `tg://…` — нет. */
export const isChatLink = (href: string | null | undefined): boolean => {
  const value = String(href ?? '').trim();
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  // a chat is a path after the domain: `/vkusnayakompania`, `/u/…`
  // чат — это путь после домена: `/vkusnayakompania`, `/u/…`
  return url.pathname.replace(/\/+$/, '') !== '';
};

/** Telegram, затем Max — только те, что открывают чат; адрес без пробелов по краям. */
export const chatLinks = (settings: { telegram?: string | null; max?: string | null }): ChatLink[] => {
  const all: [ChatLink['label'], string | null | undefined][] = [
    ['Telegram', settings.telegram],
    ['Max', settings.max],
  ];
  return all.filter(([, href]) => isChatLink(href)).map(([label, href]) => ({ label, href: String(href).trim() }));
};
