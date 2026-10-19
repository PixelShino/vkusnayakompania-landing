/**
 * Alfa-Bank internet acquiring (the RBS payment gateway, REST): `register.do`
 * opens a payment page for an order and returns its address,
 * `getOrderStatusExtended.do` says what happened to it. Both take the API
 * login and password (or a token) as form fields over HTTPS; the answer is
 * JSON, an error is a non-zero `errorCode` with `errorMessage`.
 * Интернет-эквайринг Альфа-Банка (платёжный шлюз RBS, REST): `register.do`
 * открывает страницу оплаты заказа и возвращает её адрес,
 * `getOrderStatusExtended.do` говорит, что с ним стало. Оба принимают логин и
 * пароль API (или токен) полями формы по HTTPS; ответ — JSON, ошибка —
 * ненулевой `errorCode` с `errorMessage`.
 *
 * A provider is `{ id, label, register(order), status(id), check() }`; a new
 * bank (CloudPayments: `orders/create` → `Url`) is one more file like this.
 * Провайдер — это `{ id, label, register(order), status(id), check() }`;
 * новый банк (CloudPayments: `orders/create` → `Url`) — ещё один такой файл.
 */
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { rootCertificates } from 'node:tls';
import { alfaState } from '../core.js';

/**
 * The gateway's certificates are issued by the Russian Trusted Root CA of the
 * Ministry of Digital Development, which Node does not trust out of the box:
 * without it every call ends in `SELF_SIGNED_CERT_IN_CHAIN`. The root and the
 * intermediate (public, from gosuslugi.ru/crt) ride along with the extension
 * and are added to Node's own list — no system or container setting needed.
 * Сертификаты шлюза выпущены Russian Trusted Root CA Минцифры, которому Node
 * из коробки не доверяет: без него любой запрос падает с
 * `SELF_SIGNED_CERT_IN_CHAIN`. Корневой и промежуточный (публичные, с
 * gosuslugi.ru/crt) лежат в расширении и добавляются к списку самого Node —
 * настраивать систему или контейнер не нужно.
 */
const CA = (() => {
  try {
    return [...rootCertificates, readFileSync(new URL('../certs/russian-trusted-ca.pem', import.meta.url), 'utf8')];
  } catch {
    return undefined;
  }
})();

/** POST формы на шлюз: `{ status, text }`; сеть и тайм-аут — исключение. */
const postForm = (url, body, timeoutMs) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = send(
      target,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        ca: target.protocol === 'https:' ? CA : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    req.on('error', reject);
    req.end(body);
  });

export class BankError extends Error {
  constructor(message, { code = null, kind = 'bank' } = {}) {
    super(message);
    this.code = code;
    // bank — шлюз ответил ошибкой, network — не ответил, config — не настроено
    this.kind = kind;
  }
}

const TIMEOUT_MS = 15_000;

export const alfa = (settings, transport = postForm) => {
  const auth = () => {
    if (settings.token) return { token: settings.token };
    if (settings.login && settings.password) return { userName: settings.login, password: settings.password };
    throw new BankError('Не заданы логин и пароль API Альфа-Банка', { kind: 'config' });
  };

  const call = async (method, params) => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...auth(), ...params })) {
      if (value !== undefined && value !== null && value !== '') body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    let response;
    try {
      response = await transport(`${settings.gateway}${method}`, body.toString(), TIMEOUT_MS);
    } catch (error) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new BankError(timeout ? 'Банк не ответил за 15 секунд' : `Банк недоступен: ${error?.code ?? error?.message ?? error}`, { kind: 'network' });
    }
    let data;
    try {
      data = JSON.parse(response.text);
    } catch {
      throw new BankError(`Банк ответил не JSON (HTTP ${response.status})`, { kind: 'network' });
    }
    const code = data.errorCode === undefined ? '0' : String(data.errorCode);
    if (code !== '0') throw new BankError(data.errorMessage || `Ошибка шлюза ${code}`, { code });
    return data;
  };

  return {
    id: 'alfa',
    label: 'Альфа-Банк',
    /**
     * `amount` in kopecks; `bundle` goes as `orderBundle` (the receipt);
     * `sessionSeconds` is how long the payment page lives.
     * `amount` в копейках; `bundle` уходит как `orderBundle` (чек);
     * `sessionSeconds` — сколько живёт страница оплаты.
     */
    async register({ orderNumber, amount, description, returnUrl, failUrl, bundle, taxSystem, sessionSeconds, phone }) {
      const data = await call('register.do', {
        orderNumber,
        amount,
        currency: '643',
        language: 'ru',
        returnUrl,
        failUrl,
        description,
        sessionTimeoutSecs: sessionSeconds,
        phone,
        orderBundle: bundle ?? undefined,
        taxSystem: bundle ? taxSystem : undefined,
      });
      if (!data.orderId || !data.formUrl) throw new BankError('Банк не вернул ссылку на оплату');
      return { id: String(data.orderId), url: String(data.formUrl) };
    },
    async status(id) {
      const data = await call('getOrderStatusExtended.do', { orderId: id, language: 'ru' });
      return {
        state: alfaState(data),
        amount: Number(data.amount ?? 0),
        code: data.orderStatus ?? null,
        // what the bank says about a decline, for the manager / что банк говорит об отказе — для менеджера
        note: data.actionCodeDescription || null,
        action: data.actionCode ?? null,
        orderNumber: data.orderNumber ?? null,
      };
    },
    /**
     * Credentials check without money: the status of an order that does not
     * exist. Wrong login → access error; right login → «order not found».
     * Проверка доступа без денег: статус несуществующего заказа. Неверный
     * логин — ошибка доступа; верный — «заказ не найден».
     */
    async check() {
      try {
        await call('getOrderStatusExtended.do', { orderId: '00000000-0000-0000-0000-000000000000' });
        return { ok: true, message: 'Шлюз ответил' };
      } catch (error) {
        if (error.kind === 'bank' && ['6', '7'].includes(String(error.code)))
          return { ok: true, message: `Логин принят, шлюз на связи (ответ на пробный заказ: «${error.message}»)` };
        if (error.kind === 'bank' && String(error.code) === '5')
          return { ok: false, message: `Шлюз на связи, но логин или пароль не подошли (ответ банка: «${error.message}»)`, code: '5' };
        return { ok: false, message: error.message, code: error.code ?? null };
      }
    },
  };
};
