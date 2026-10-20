/**
 * ЮKassa (API v3: JSON over HTTPS, Basic auth `shopId:secretKey`):
 * `POST /payments` opens a one-stage payment and returns the address of
 * ЮKassa's page, `GET /payments/{id}` says what happened to it, `GET /me` is
 * the credentials check without money. Every POST carries an
 * `Idempotence-Key`: a repeat after silence or a 5xx with the same key never
 * makes a second payment. ЮKassa's certificates are ordinary — no Russian
 * Trusted Root CA as at Alfa's gateway. Notifications are the service's job
 * (`notification` in `service.js`): this file only talks to the API.
 * ЮKassa (API v3: JSON по HTTPS, Basic-авторизация `shopId:secretKey`):
 * `POST /payments` открывает одностадийный платёж и возвращает адрес
 * страницы ЮKassa, `GET /payments/{id}` говорит, что с ним стало, `GET /me` —
 * проверка доступа без денег. Каждый POST несёт `Idempotence-Key`: повтор
 * после молчания или 5xx с тем же ключом второй платёж не создаст.
 * Сертификаты у ЮKassa обычные — Russian Trusted Root CA, как у шлюза Альфы,
 * не нужен. Уведомления — забота сервиса (`notification` в `service.js`):
 * этот файл только говорит с API.
 */
import { randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { buildYooPayment, buildYooReceipt, yooReceiptTotal, yooState } from '../core.js';
import { BankError } from './alfa.js';

// two rounds of ten seconds fit into the site's 25-second wait for a link
// два круга по десять секунд укладываются в 25 секунд, что сайт ждёт ссылку
const TIMEOUT_MS = 10_000;
const ROUNDS = 2;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** HTTP-запрос к API: `{ status, text }`; сеть и тайм-аут — исключение. */
const send = (method, url, { headers = {}, body } = {}, timeoutMs) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = target.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = request(
      target,
      {
        method,
        headers: { ...headers, ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
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

const fail = (message, { code = null, kind = 'bank', status = null } = {}) => Object.assign(new BankError(message, { code, kind }), { status });

export const yookassa = (settings, transport = send) => {
  const auth = () => {
    if (!settings.shopId || !settings.secretKey) throw fail('Не заданы shopId и секретный ключ ЮKassa', { kind: 'config' });
    return `Basic ${Buffer.from(`${settings.shopId}:${settings.secretKey}`).toString('base64')}`;
  };

  /** Запрос к API: ответ JSON при 2xx, иначе `BankError` с кодом ЮKassa. */
  const call = async (method, path, body, key) => {
    const headers = { Authorization: auth(), Accept: 'application/json' };
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    if (method === 'POST') headers['Idempotence-Key'] = key ?? randomUUID();
    for (let round = 1; ; round += 1) {
      let response;
      try {
        response = await transport(method, `${settings.yookassaApi}${path}`, { headers, body: payload }, TIMEOUT_MS);
      } catch (error) {
        // silence: ЮKassa may have made the payment — the same key asks again safely
        // молчание: ЮKassa могла создать платёж — тот же ключ безопасно спросит снова
        if (round < ROUNDS) {
          await pause(800);
          continue;
        }
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        throw fail(timeout ? 'ЮKassa не ответила за 10 секунд' : `ЮKassa недоступна: ${error?.code ?? error?.message ?? error}`, { kind: 'network' });
      }
      // 500: «the outcome is unknown, repeat with the same key» (ЮKassa's own advice)
      // 500: «результат неизвестен, повторите с тем же ключом» (совет самой ЮKassa)
      if (response.status >= 500 && round < ROUNDS) {
        await pause(800);
        continue;
      }
      let data;
      try {
        data = response.text ? JSON.parse(response.text) : {};
      } catch {
        throw fail(`ЮKassa ответила не JSON (HTTP ${response.status})`, { kind: 'network', status: response.status });
      }
      if (response.status >= 200 && response.status < 300) return data;
      const code = typeof data?.code === 'string' ? data.code : String(response.status);
      const message =
        code === 'invalid_credentials'
          ? 'ЮKassa не приняла shopId или секретный ключ'
          : data?.description
            ? `${data.description}${data.parameter ? ` (${data.parameter})` : ''}`
            : `Ошибка ЮKassa ${code} (HTTP ${response.status})`;
      throw fail(message, { code, kind: response.status >= 500 || response.status === 429 ? 'network' : 'bank', status: response.status });
    }
  };

  return {
    id: 'yookassa',
    label: 'ЮKassa',
    // a pending payment stays payable until ЮKassa cancels it itself, and the
    // merchant cannot cancel it: the live page is handed out again instead of
    // a second payment the guest could also pay
    // ждущий платёж можно оплатить, пока ЮKassa сама его не отменит, а магазин
    // отменить его не может: живая страница выдаётся снова вместо второго
    // платежа, который гость тоже мог бы оплатить
    keepsPage: true,

    /**
     * `amount` in kopecks; `receipt` — the order's lines and the receipt
     * settings, or `null` when the receipt is off in the admin.
     * `amount` в копейках; `receipt` — строки заказа и настройки чека или
     * `null`, если чек в админке выключен.
     * @param {{ orderNumber: string, amount: number, description: string, returnUrl: string,
     *   receipt?: Record<string, any> | null, metadata?: Record<string, any>, key?: string, [extra: string]: any }} input
     */
    async register({ orderNumber, amount, description, returnUrl, receipt = null, metadata = {}, key }) {
      let receiptBody = null;
      if (receipt) {
        try {
          receiptBody = buildYooReceipt(receipt.lines, { ...receipt, amount });
        } catch (error) {
          throw fail(`Чек для ЮKassa не собран: ${error.message}`, { kind: 'config' });
        }
        if (yooReceiptTotal(receiptBody) !== amount) throw fail('Чек для ЮKassa не сходится с суммой платежа', { kind: 'config' });
      }
      const body = buildYooPayment({ amount, description, returnUrl, metadata: { ...metadata, bank_order: orderNumber }, receipt: receiptBody });
      const data = await call('POST', 'payments', body, key);
      const url = data?.confirmation?.confirmation_url;
      if (!data?.id || !url) throw fail('ЮKassa не вернула ссылку на оплату');
      return { id: String(data.id), url: String(url), test: data.test === true };
    },

    /**
     * @param {string} id
     * @returns {Promise<Record<string, any>>}
     */
    async status(id) {
      let data = await call('GET', `payments/${encodeURIComponent(id)}`);
      if (data?.status === 'waiting_for_capture') {
        // held money of a one-stage payment: take it, or ЮKassa returns it in a few days
        // замороженные деньги одностадийного платежа: списать, иначе ЮKassa вернёт их через несколько дней
        try {
          data = await call('POST', `payments/${encodeURIComponent(id)}/capture`, { amount: data.amount }, `capture-${id}`);
        } catch {
          /* still held — the next check tries again / всё ещё заморожены — следующая проверка попробует снова */
        }
      }
      const result = yooState(data);
      // a test shop's payment in production mode is no money at all
      // платёж тестового магазина в боевом режиме — вовсе не деньги
      if (result.test && settings.mode === 'prod' && result.state !== 'pending')
        return { ...result, state: 'failed', why: 'declined', note: 'платёж тестового магазина в боевом режиме — денег нет', metadata: data?.metadata ?? {} };
      return { ...result, orderNumber: data?.metadata?.bank_order ?? null, metadata: data?.metadata ?? {} };
    },

    /**
     * Credentials check without money: `GET /me` answers with the shop —
     * its id, test or live, whether ЮKassa's receipts are on.
     * Проверка доступа без денег: `GET /me` отвечает магазином — его номер,
     * тестовый ли он, подключены ли чеки ЮKassa.
     */
    async check() {
      try {
        const me = await call('GET', 'me');
        const test = me?.test === true;
        const fiscal = me?.fiscalization?.enabled ?? me?.fiscalization_enabled ?? null;
        const parts = [`Ключ принят, магазин ${me?.account_id ?? settings.shopId}${test ? ' — тестовый' : ''}`];
        if (fiscal === true) parts.push(`чеки ЮKassa подключены${me?.fiscalization?.provider ? ` (${me.fiscalization.provider})` : ''}`);
        if (fiscal === false) parts.push('чеки в ЮKassa не подключены');
        return { ok: true, message: parts.join('; '), test, fiscal };
      } catch (error) {
        if (error.code === 'invalid_credentials' || error.status === 401)
          return { ok: false, message: 'ЮKassa на связи, но shopId или секретный ключ не подошли', code: 'invalid_credentials' };
        return { ok: false, message: error.message, code: error.code ?? null };
      }
    },
  };
};
