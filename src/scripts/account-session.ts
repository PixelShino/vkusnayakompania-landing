/**
 * The guest's session in the browser: kept in `localStorage`, shared by the
 * header, the account page and the cart. A change in one tab reaches the
 * others (`storage`), a change in this tab reaches the other scripts of the
 * page (`vk:session`).
 * Сессия гостя в браузере: хранится в `localStorage`, общая для шапки,
 * кабинета и корзины. Перемена в одной вкладке доходит до других (`storage`),
 * в этой вкладке — до остальных скриптов страницы (`vk:session`).
 */
import { SESSION_KEY, parseSession, type Session } from '../lib/account';

// storage may be closed (private mode, blocked site data): then the session
// lives until the page is closed, and nothing on the page breaks
// хранилище может быть закрыто (приватный режим, запрет данных сайта): тогда
// сессия живёт до закрытия страницы, и ничего на ней не ломается
let memory: string | null = null;
export const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return key === SESSION_KEY ? memory : null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      if (key === SESSION_KEY) memory = value;
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      if (key === SESSION_KEY) memory = null;
    }
  },
};

export const loadSession = () => parseSession(storage.get(SESSION_KEY));

const announce = () => window.dispatchEvent(new CustomEvent('vk:session'));

export const saveSession = (session: Session) => {
  storage.set(SESSION_KEY, JSON.stringify(session));
  announce();
};

/** Обновить сохранённое имя или телефон, не трогая токен. */
export const touchSession = (patch: Partial<Pick<Session, 'name' | 'phone'>>) => {
  const { session } = loadSession();
  if (!session) return;
  const next = { ...session, ...patch };
  if (JSON.stringify(next) === JSON.stringify(session)) return;
  storage.set(SESSION_KEY, JSON.stringify(next));
  announce();
};

export const clearSession = () => {
  storage.remove(SESSION_KEY);
  announce();
};

export const onSessionChange = (handler: () => void) => {
  window.addEventListener('vk:session', handler);
  window.addEventListener('storage', (event) => {
    if (event.key === SESSION_KEY || event.key === null) handler();
  });
};
