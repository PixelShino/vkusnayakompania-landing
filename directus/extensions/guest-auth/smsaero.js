/**
 * SMS Aero, API v2 (https://smsaero.ru/integration/documentation/api/): the
 * three ways a sign-in code reaches a guest. HTTP Basic `email:api_key`, JSON
 * in, `{ success, data, message }` out; anything but `success: true` is an
 * error with SMS Aero's own message.
 *
 * - `flashcall/send` — a call; the code is the last four digits of the
 *   calling number. As of 19.10.2026 the gate answers this method with
 *   «Method not found» for the shop's account: the endpoint then falls back to
 *   SMS by itself (see `index.js`).
 * - `sms/send` — an SMS with the code in the text; the sender name must be
 *   registered in the SMS Aero cabinet, «SMS Aero» is the free one.
 * - `mobile-id/send` / `verify` / `status` — «Мобильная авторизация»: the
 *   operator asks the guest to confirm on the phone (SIM-PUSH), otherwise
 *   sends an SMS code SMS Aero checks itself. The test API key works here:
 *   nothing is sent, the code is always 1234.
 *
 * SMS Aero, API v2: три способа доставить гостю код входа. HTTP Basic
 * `email:api_key`, на входе JSON, на выходе `{ success, data, message }`;
 * всё, кроме `success: true`, — ошибка с текстом самого SMS Aero.
 *
 * - `flashcall/send` — звонок; код — последние четыре цифры номера. На
 *   19.10.2026 шлюз отвечает на этот метод «Method not found» для аккаунта
 *   заведения — тогда адрес входа сам переходит на SMS (см. `index.js`).
 * - `sms/send` — SMS с кодом; имя отправителя регистрируется в кабинете SMS
 *   Aero, «SMS Aero» — бесплатное.
 * - `mobile-id/send` / `verify` / `status` — «Мобильная авторизация»: оператор
 *   просит гостя подтвердить вход на телефоне (SIM-PUSH), иначе шлёт SMS с
 *   кодом, который проверяет сам SMS Aero. Тестовый ключ работает здесь:
 *   ничего не отправляется, код всегда 1234.
 */

export class ProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

export const smsaero = ({ email, apiKey, base = 'https://gate.smsaero.ru/v2/', fetchImpl = fetch, timeoutMs = 15_000 }) => {
  const auth = `Basic ${Buffer.from(`${email}:${apiKey}`).toString('base64')}`;
  const call = async (path, body) => {
    let response;
    try {
      response = await fetchImpl(base + path, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`SMS Aero недоступен: ${error.message}`);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) throw new ProviderError(data?.message || `HTTP ${response.status}`, response.status);
    return data.data;
  };
  return {
    /** звонок: код — последние 4 цифры номера, с которого звонят */
    call: (digits, code) => call('flashcall/send', { phone: digits, code: Number(code) }),
    sms: (digits, text, sign) => call('sms/send', { number: digits, text, sign }),
    mobileId: (digits, sign, callbackUrl) => call('mobile-id/send', { number: digits, sign, callbackUrl }),
    mobileIdVerify: (id, code, sign) => call('mobile-id/verify', { id: Number(id), code: String(code), sign }),
    mobileIdStatus: (id) => call('mobile-id/status', { id: Number(id) }),
  };
};
