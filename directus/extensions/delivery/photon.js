/**
 * The geocoder client, shared: the `delivery` endpoint (suggestions and the
 * cart's quote) and the `order-guard` hook (the order's own check) import this
 * one module, so they share one cache — the address the cart has just priced
 * is not asked again when the order arrives. Photon first; when Photon fails,
 * Nominatim, at most once a second (its rules). No Directus here, `fetch` is
 * Node's own.
 * Клиент геокодера, общий: эндпоинт `delivery` (подсказки и расчёт корзины) и
 * хук `order-guard` (проверка заказа) импортируют один этот модуль и делят
 * один кэш — адрес, который корзина только что посчитала, при заказе заново
 * не спрашивается. Сначала Photon; если Photon упал — Nominatim, не чаще раза
 * в секунду (его правила). Directus здесь нет, `fetch` — свой у Node.
 */
import { nominatimUrl, normalizeAddress, parseNominatim, parsePhoton, photonRawUrl, photonUrl, topPlace } from './geo.js';

export const USER_AGENT = 'vkus-com.ru (delivery)';
const DAY = 86_400_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ fetch?: typeof globalThis.fetch, ttlMs?: number, max?: number, timeoutMs?: number,
 *   gapMs?: number, waitMaxMs?: number, now?: () => number }} [options]
 */
export const createGeocoder = ({
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  ttlMs = DAY,
  max = 2000,
  timeoutMs = 5000,
  gapMs = 1000,
  waitMaxMs = 2000,
  now = () => Date.now(),
} = {}) => {
  // a Map keeps insertion order: the first key is the oldest, it goes first
  // Map хранит порядок вставки: первый ключ — самый старый, он и уходит первым
  const cache = new Map();
  const pending = new Map();
  const stats = { hits: 0, misses: 0, fallbacks: 0 };

  const remember = (key, value) => {
    cache.delete(key);
    cache.set(key, { at: now(), value });
    while (cache.size > max) cache.delete(cache.keys().next().value);
  };

  /** Ответ из кэша, или один запрос на все одновременные одинаковые; ошибка в кэш не попадает. */
  const cached = (key, run) => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) {
      stats.hits += 1;
      return Promise.resolve(hit.value);
    }
    if (hit) cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    stats.misses += 1;
    const job = run()
      .then((value) => {
        remember(key, value);
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, job);
    return job;
  };

  const getJson = async (url) => {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${new URL(url).host} ответил ${response.status}`);
    return response.json();
  };

  const photon = (text) => cached(`p:${text}`, async () => parsePhoton(await getJson(photonUrl(text))));
  const photonRaw = (text) => cached(`r:${text}`, async () => topPlace(await getJson(photonRawUrl(text))));

  // Nominatim: one request a second for the whole server; a wait longer than
  // two seconds is not worth a guest's order — then the address is «not found»
  // Nominatim: один запрос в секунду на весь сервер; ждать дольше двух секунд
  // заказ гостя не будет — тогда адрес «не найден»
  let nextSlot = 0;
  const nominatim = (text) =>
    cached(`n:${text}`, async () => {
      const at = Math.max(now(), nextSlot);
      if (at - now() > waitMaxMs) throw new Error('Nominatim: очередь запросов');
      nextSlot = at + gapMs;
      if (at > now()) await sleep(at - now());
      return parseNominatim(await getJson(nominatimUrl(text)));
    });

  return {
    /** Подсказки: только Photon (Nominatim запрещает автодополнение). */
    search: (text) => photon(normalizeAddress(text)),
    /** Запрос как набран, без рамки: лучшая догадка Photon где угодно (чужой город). */
    locateRaw: (text) => photonRaw(normalizeAddress(text)),
    /** Один адрес: Photon, при его ошибке — Nominatim. Ошибка обоих — исключение. */
    locate: async (text) => {
      const key = normalizeAddress(text);
      try {
        return await photon(key);
      } catch (error) {
        stats.fallbacks += 1;
        try {
          return await nominatim(key);
        } catch (second) {
          throw new Error(`Photon: ${error?.message ?? error}; Nominatim: ${second?.message ?? second}`);
        }
      }
    },
    size: () => cache.size,
    stats: () => ({ ...stats, size: cache.size }),
    clear: () => cache.clear(),
  };
};

// one per server: the endpoint and order-guard get this very object
// один на сервер: эндпоинт и order-guard получают именно этот объект
export const geocoder = createGeocoder();
