/**
 * Delivery by zone, the endpoint the cart talks to (public, CORS as the rest of Directus):
 * Доставка по зонам, эндпоинт, с которым говорит корзина (публичный, CORS как у всего Directus):
 *
 *   GET  /delivery/suggest?q=… → `{ items: [{ label, city, lat, lng }] }` — до 6 домов
 *        Самары и области (только с номером дома);
 *   POST /delivery/quote `{ address }` → `{ found: true, address, lat, lng, zone: { id, name,
 *        price, free_from, min_order } }`, или `{ found: false }` (не нашли), или
 *        `{ found: false, outside: true, address, lat, lng }` (нашли, но вне всех зон);
 *   GET  /delivery/zones → `{ items: [{ id, name, price, free_from, min_order }] }`.
 *
 * Suggestions and quotes: 60 requests a minute from one address, then 429.
 * The geocoder (Photon, Nominatim when Photon is down) and its cache live in
 * `photon.js`, the rules in `geo.js` — `order-guard` imports both and checks
 * every order the same way: the cart's price is only a preview.
 * Подсказки и расчёт: 60 запросов в минуту с одного адреса, дальше 429.
 * Геокодер (Photon, Nominatim, когда Photon лежит) и его кэш — в `photon.js`,
 * правила — в `geo.js`: `order-guard` импортирует оба и так же проверяет каждый
 * заказ, цена в корзине — только предпросмотр.
 *
 * No build step: these files are the extension. / Без сборки: эти файлы и есть расширение.
 */
import { normalizeAddress, publicZone, quote, suggestions, toZones } from './geo.js';
import { geocoder } from './photon.js';

const RATE = { max: 60, windowMs: 60 * 1000 };
const ZONE_FIELDS = ['id', 'name', 'price', 'free_from', 'min_order', 'polygon', 'sort', 'status'];

/** Действующие зоны из базы; коллекции нет (схема не применена) — зон нет. */
const loadZones = async (database) => {
  try {
    return toZones(await database('delivery_zones').select(ZONE_FIELDS));
  } catch {
    return [];
  }
};

export default {
  id: 'delivery',
  handler: (router, { database, logger }) => {
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

    const handle = (fn, { limited = true } = {}) => async (req, res) => {
      try {
        if (limited && tooMany(req.accountability?.ip ?? req.ip)) {
          res.status(429).json({ error: 'rate', message: 'Слишком много запросов подряд. Подождите минуту.' });
          return;
        }
        res.set('Cache-Control', 'no-store');
        await fn(req, res);
      } catch (error) {
        logger.error(error, 'delivery: ошибка обработки запроса');
        res.status(500).json({ error: 'server', message: 'Не получилось посчитать доставку. Стоимость назовём при звонке.' });
      }
    };

    router.get(
      '/suggest',
      handle(async (req, res) => {
        const q = normalizeAddress(req.query.q);
        if (q.length < 3) return void res.json({ items: [] });
        try {
          res.json({ items: suggestions(await geocoder.search(q), q) });
        } catch (error) {
          // no suggestions is not an error for the guest: the address can still be typed
          // нет подсказок — не ошибка для гостя: адрес можно дописать руками
          logger.warn(`delivery: подсказки для «${q}» не получены — ${error.message}`);
          res.json({ items: [] });
        }
      }),
    );

    router.post(
      '/quote',
      handle(async (req, res) => {
        const address = typeof req.body?.address === 'string' ? req.body.address : '';
        res.json(
          await quote(address, {
            zones: await loadZones(database),
            geocode: geocoder.locate,
            geocodeRaw: geocoder.locateRaw,
            log: (error) => logger.warn(`delivery: адрес «${normalizeAddress(address)}» не проверен — ${error.message}`),
          }),
        );
      }),
    );

    router.get(
      '/zones',
      handle(
        async (_req, res) => {
          res.set('Cache-Control', 'public, max-age=300');
          res.json({ items: (await loadZones(database)).map(publicZone) });
        },
        { limited: false },
      ),
    );
  },
};
