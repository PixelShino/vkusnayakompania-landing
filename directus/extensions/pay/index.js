/**
 * Online payment of site orders: one bundle, an endpoint and a hook.
 * Онлайн-оплата заказов с сайта: один бандл, эндпоинт и хук.
 *
 * Endpoint `/pay` (public, CORS as the rest of Directus):
 * Эндпоинт `/pay` (публичный, CORS как у всего Directus):
 *   GET  /pay/config    — включена ли онлайн-оплата и тексты для гостя;
 *   POST /pay/start     — `{ number, phone, path }` → `{ url }` страницы банка (или `{ paid }`);
 *   POST /pay/offline   — `{ number, phone }` → оплата при получении;
 *   POST /pay/status    — `{ number, phone }` → статус оплаты, ждущий уточняется у банка;
 *   GET  /pay/return    — сюда банк возвращает гостя; дальше — на сайт с итогом;
 *   GET|POST /pay/callback — уведомление Альфа-Банка (подпись `checksum`, статус всегда у банка);
 *   POST /pay/yookassa/webhook — уведомление ЮKassa (статус перепроверяется запросом к ЮKassa);
 *   GET  /pay/check     — только администратор: настройки без секретов и связь с банком;
 *   GET  /pay/mock/…    — страница банка-заглушки, только в тестовом режиме.
 * Hook: `payment_*` of an order are written only by this extension (a person
 * in the admin cannot set «paid»), and every five minutes the payments still
 * waiting are asked at the bank.
 * Хук: поля `payment_*` заказа пишет только это расширение (человек в админке
 * не может поставить «оплачен»), а раз в пять минут ждущие оплаты
 * уточняются у банка.
 *
 * No build step: these files are the extension. / Без сборки: эти файлы и есть расширение.
 */
import { createPayService, PayError } from './service.js';
import { mockOrders } from './providers/mock.js';
import { isYooKassaIp } from './core.js';

// written by the server only / пишет только сервер
const SERVER_FIELDS = ['payment_status', 'payment_id', 'payment_url', 'paid_at', 'payment_meta', 'payment_log', 'payment_test'];
const METHODS = ['online', 'on_delivery'];
// one visitor, ten minutes: enough for a retry and a status poll, too few for a script
// один посетитель, десять минут: хватит на повтор и опрос статуса, мало для скрипта
const RATE = { max: 40, windowMs: 10 * 60 * 1000 };

let service = null;
const serviceFor = (context) => (service ??= createPayService(context));

const limiter = () => {
  const hits = new Map();
  return (ip) => {
    if (!ip) return false;
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) for (const [key, times] of hits) if (now - times.at(-1) > RATE.windowMs) hits.delete(key);
    return recent.length > RATE.max;
  };
};

const esc = (text) =>
  String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const rub = (kopecks) => `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(kopecks / 100)} ₽`;

const page = (title, body) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>
body{margin:0;background:#FFFAED;color:#2C2927;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:440px;margin:0 auto;padding:32px 18px}h1{font-size:24px;line-height:1.2;margin:0 0 6px}
.tag{display:inline-block;margin-bottom:14px;padding:2px 8px;border:1px solid #C67139;color:#8C4C24;font-size:12px;letter-spacing:.08em;text-transform:uppercase;border-radius:3px}
.sum{font-size:32px;font-weight:700;margin:18px 0 4px;color:#2C2927;font-variant-numeric:tabular-nums}ul{padding:0;list-style:none;border-top:1px solid #E4DBC9;margin:16px 0}
li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #E4DBC9;font-size:14px}li b{white-space:nowrap}
.btn{display:block;text-align:center;padding:14px;margin-top:10px;border-radius:3px;text-decoration:none;font-weight:600}
.pay{background:#6F7546;color:#FFFAED}.no{border:1px solid #C67139;color:#8C4C24}.back{color:#5A5348}
p{color:#5A5348}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px}dt{color:#6B6252}dd{margin:0}
.ok{color:#474C2B;font-weight:700}.bad{color:#8C4C24;font-weight:700}</style></head><body><main>${body}</main></body></html>`;

const routes = (router, context) => {
  const pay = serviceFor(context);
  const tooMany = limiter();
  const ipOf = (req) => req.accountability?.ip ?? req.ip;

  const handle = (fn, { limited = true } = {}) => async (req, res) => {
    try {
      if (limited && tooMany(ipOf(req))) throw new PayError(429, 'rate', 'Слишком много запросов подряд. Подождите пару минут или позвоните нам.');
      await fn(req, res);
    } catch (error) {
      if (error instanceof PayError) {
        res.status(error.status).json({ error: error.code, message: error.message });
        return;
      }
      context.logger.error(error, 'pay: ошибка обработки запроса');
      res.status(500).json({ error: 'server', message: 'Оплата сейчас не открылась. Заказ принят — оплатите его при получении или позвоните нам.' });
    }
  };

  const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

  router.get(
    '/config',
    handle(async (_req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await pay.publicConfig());
    }, { limited: false }),
  );

  router.post(
    '/start',
    handle(async (req, res) => {
      const { number, phone, path } = body(req);
      res.json(await pay.start({ number: String(number ?? ''), phone: String(phone ?? ''), origin: req.get('origin') ?? null, path }));
    }),
  );

  router.post(
    '/offline',
    handle(async (req, res) => {
      const { number, phone } = body(req);
      res.json(await pay.offline({ number: String(number ?? ''), phone: String(phone ?? '') }));
    }),
  );

  router.post(
    '/status',
    handle(async (req, res) => {
      const { number, phone } = body(req);
      res.json(await pay.status({ number: String(number ?? ''), phone: String(phone ?? '') }));
    }),
  );

  router.get(
    '/return',
    handle(async (req, res) => {
      const url = await pay.back({ id: Number(req.query.o), bankId: String(req.query.orderId ?? req.query.mdOrder ?? ''), key: String(req.query.t ?? '') });
      if (url) {
        res.redirect(303, url);
        return;
      }
      res.status(404).type('html').send(page('Оплата', '<h1>Заказ не найден</h1><p>Вернитесь на сайт и позвоните нам — разберёмся.</p>'));
    }),
  );

  // the bank's callback comes as GET by default and may come as a form POST:
  // Directus parses JSON only, so a form body is read here
  // уведомление банка по умолчанию приходит GET-запросом, может прийти POST-формой:
  // Directus разбирает только JSON, поэтому тело формы читается здесь
  const formOf = (req) =>
    new Promise((resolve) => {
      if (req.method !== 'POST' || !/urlencoded/.test(req.get('content-type') ?? '') || req.readableEnded) return resolve({});
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        data += chunk;
        if (data.length > 100_000) req.destroy();
      });
      req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
      req.on('error', () => resolve({}));
    });
  const callback = handle(async (req, res) => {
    const params = { ...req.query, ...body(req), ...(await formOf(req)) };
    for (const key of Object.keys(params)) params[key] = String(params[key]);
    await pay.callback(params);
    res.type('text').send('OK');
  });
  router.get('/callback', callback);
  router.post('/callback', callback);

  // ЮKassa's notification (JSON, parsed by Directus): its own addresses are
  // never limited, anyone else is — and the payment is asked at ЮKassa anyway
  // уведомление ЮKassa (JSON, его разбирает Directus): её собственные адреса
  // не ограничиваются, остальные — да, а платёж всё равно уточняется у ЮKassa
  router.post(
    '/yookassa/webhook',
    handle(async (req, res) => {
      const ip = ipOf(req);
      const trusted = isYooKassaIp(ip);
      if (!trusted && tooMany(ip)) throw new PayError(429, 'rate', 'too many requests');
      res.json(await pay.yookassaNotification(body(req), { trusted }));
    }, { limited: false }),
  );

  router.get(
    '/check',
    handle(async (req, res) => {
      if (!req.accountability?.admin) {
        res.status(403).type('html').send(page('Проверка оплаты', '<h1>Только для администратора</h1><p>Войдите в админку и откройте эту страницу снова.</p>'));
        return;
      }
      const c = await pay.check();
      const SRC = { env: 'переменная окружения', admin: 'админка', none: 'не задан' };
      const TAX = { 0: 'ОСН', 1: 'УСН «доходы»', 2: 'УСН «доходы минус расходы»', 3: 'ЕНВД', 4: 'ЕСХН', 5: 'патент' };
      const VAT = { 0: 'без НДС', 1: 'НДС 0 %', 2: 'НДС 10 %', 6: 'НДС 20 %', 10: 'НДС 5 %', 12: 'НДС 7 %', 14: 'НДС 22 %' };
      const METHOD = { 1: 'предоплата 100 %', 4: 'полный расчёт' };
      const SUBJECT = { 1: 'товар', 3: 'работа', 4: 'услуга' };
      const yoo = c.providerId === 'yookassa';
      // what ЮKassa says about its receipts against what the admin asks for
      // что ЮKassa говорит о своих чеках против того, что просит админка
      const fiscalNote =
        yoo && c.bank.fiscal === true && !c.receipt
          ? ' <span class="bad">— в ЮKassa чеки подключены: без состава заказа платёж не создастся, включите «Чек»</span>'
          : yoo && c.bank.fiscal === false && c.receipt
            ? ' <span class="bad">— в ЮKassa чеки не подключены: если платежи не создаются, выключите «Чек» или подключите чеки в кабинете</span>'
            : '';
      const siteOrigin = (() => {
        try {
          return c.siteUrl ? new URL(c.siteUrl).origin : null;
        } catch {
          return null;
        }
      })();
      // the cart calls /pay from the site: an origin outside CORS_ORIGIN never gets an answer
      // корзина обращается к /pay с сайта: адрес вне CORS_ORIGIN ответа не получит
      const corsNote = siteOrigin && !c.cors.includes(siteOrigin) ? ` <span class="bad">— адреса сайта ${esc(siteOrigin)} здесь нет: корзина не достучится до оплаты</span>` : '';
      const rows = [
        [
          'Онлайн-оплата',
          c.enabled
            ? '<span class="ok">включена</span>'
            : c.stubInProd
              ? '<span class="bad">выключена: заглушка в боевом режиме</span>'
              : c.testKeyInProd
                ? '<span class="bad">выключена: ключ тестового магазина ЮKassa (test_…) в боевом режиме</span>'
                : 'выключена',
        ],
        ['Банк', esc(c.provider)],
        ['Режим', c.mode === 'тест' ? 'тест — гости кнопку оплаты не видят, проверка по ссылке …/catalog/?paytest=1' : '<span class="ok">бой</span>'],
        [yoo ? 'API' : 'Шлюз', esc(c.gateway ?? '—')],
        ...(yoo
          ? [
              ['shopId', SRC[c.sources.shopId]],
              ['Секретный ключ', SRC[c.sources.secretKey]],
            ]
          : [
              ['Логин API', SRC[c.sources.login]],
              ['Пароль API', SRC[c.sources.password]],
              ['Токен API', SRC[c.sources.token]],
              ['Ключ уведомлений', SRC[c.sources.callbackKey]],
            ]),
        ['Адрес возврата', esc(c.returnUrl ?? 'нет PUBLIC_URL')],
        [
          'Адрес уведомлений',
          `${esc(c.callbackUrl ?? 'нет PUBLIC_URL')}${yoo ? ' — в кабинете ЮKassa «Интеграция → HTTP-уведомления», события payment.succeeded, payment.canceled, refund.succeeded' : ''}`,
        ],
        ['Сайт', esc(c.siteUrl ?? '—')],
        ['Сайту разрешено (CORS)', `${esc(c.cors.join(', ') || '—')}${corsNote}`],
        [
          'Чек',
          (c.receipt
            ? esc(
                `${TAX[c.receipt.taxSystem] ?? c.receipt.taxSystem}, ${VAT[c.receipt.vat] ?? `НДС код ${c.receipt.vat}`}, ${METHOD[c.receipt.method] ?? `расчёт ${c.receipt.method}`}, ${SUBJECT[c.receipt.subject] ?? `предмет ${c.receipt.subject}`}, ФФД ${c.receipt.ffd}`,
              )
            : 'без состава заказа') + fiscalNote,
        ],
        ['Связь с банком', `<span class="${c.bank.ok ? 'ok' : 'bad'}">${esc(c.bank.message)}</span>`],
      ];
      res.set('Cache-Control', 'no-store');
      res.type('html').send(
        page(
          'Проверка оплаты',
          `<h1>Проверка оплаты</h1><p>Секреты здесь не показываются — только откуда они взяты.</p><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` +
            '<a class="btn back" href="/admin/content/payment_settings">Вернуться к настройкам оплаты</a>',
        ),
      );
    }, { limited: false }),
  );

  // ── the stub bank's page / страница банка-заглушки ─────────────────────────
  // links, not forms: the admin's CSP (`form-action 'self'`) would stop a form
  // whose answer redirects to the site
  // ссылки, а не формы: CSP админки (`form-action 'self'`) остановит форму,
  // ответ которой уводит на сайт
  const mockOrder = async (req) => {
    const s = await pay.settings();
    if (s.mode !== 'test') return null;
    return mockOrders.get(String(req.params.id)) ?? null;
  };
  const withBankId = (url, id) => `${url}${url.includes('?') ? '&' : '?'}orderId=${encodeURIComponent(id)}`;

  router.get(
    '/mock/:id',
    handle(async (req, res) => {
      const order = await mockOrder(req);
      if (!order) {
        res.status(404).type('html').send(page('Заглушка банка', '<h1>Страница оплаты не найдена</h1><p>Заглушка работает только в тестовом режиме и забывает заказы при перезапуске.</p>'));
        return;
      }
      const lines = order.bundle?.cartItems?.items ?? [];
      const id = encodeURIComponent(order.id);
      res.set('Cache-Control', 'no-store');
      res.type('html').send(
        page(
          'Тестовая оплата',
          `<span class="tag">Тест · денег не берёт</span><h1>Оплата заказа</h1><p>${esc(order.description)}</p>
<p class="sum">${rub(order.amount)}</p>
${lines.length ? `<ul>${lines.map((l) => `<li><span>${esc(l.name)} × ${l.quantity.value}</span><b>${rub(l.itemAmount)}</b></li>`).join('')}</ul>` : ''}
<a class="btn pay" href="${id}/pay">Оплатить</a><a class="btn no" href="${id}/decline">Отклонить</a><a class="btn back" href="${id}/cancel">Вернуться в магазин</a>`,
        ),
      );
    }, { limited: false }),
  );

  router.get(
    '/mock/:id/:action',
    handle(async (req, res) => {
      const order = await mockOrder(req);
      const action = req.params.action;
      if (!order || !['pay', 'decline', 'cancel'].includes(action)) {
        res.status(404).type('html').send(page('Заглушка банка', '<h1>Страница оплаты не найдена</h1>'));
        return;
      }
      if (order.state === 'pending') {
        if (Date.now() > order.until) order.state = 'expired';
        else if (action === 'pay') order.state = 'paid';
        else if (action === 'decline') order.state = 'failed';
      }
      res.redirect(303, withBankId(order.state === 'paid' ? order.returnUrl : order.failUrl, order.id));
    }, { limited: false }),
  );
};

const hooks = ({ filter, schedule }, context) => {
  const pay = serviceFor(context);

  // `accountability` null — our own service or another server job: as is.
  // Anyone else (the public through `order-guard`, an editor in the admin)
  // never sets the payment's outcome, and the method is one of two words.
  // `accountability` null — наш собственный сервис или другая серверная
  // задача: как есть. Любой другой (публика через `order-guard`, редактор в
  // админке) итог оплаты не ставит, а способ — одно из двух слов.
  const guard = (payload, _meta, { accountability }) => {
    if (!accountability || !payload || typeof payload !== 'object') return payload;
    const out = { ...payload };
    for (const field of SERVER_FIELDS) delete out[field];
    if ('payment_method' in out && !METHODS.includes(out.payment_method)) out.payment_method = 'on_delivery';
    return out;
  };
  filter('orders.items.create', guard);
  filter('orders.items.update', guard);

  schedule('*/5 * * * *', async () => {
    try {
      await pay.sweep();
    } catch (error) {
      context.logger.warn(`pay: проверка ждущих оплат не прошла — ${error.message}`);
    }
  });
};

export default {
  endpoints: [{ name: 'pay', config: { id: 'pay', handler: routes } }],
  hooks: [{ name: 'pay-hook', config: hooks }],
  operations: [],
};
