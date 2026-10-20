/**
 * Drives one `LoginForm`: the number with the site's mask and consent, then
 * the code. Four digits submit themselves; the timer says when a new code may
 * be asked for; a call can be swapped for an SMS; the operator's sign-in
 * («Мобильная авторизация») is waited for by asking the server every three
 * seconds while the guest confirms on the phone. Every refusal of the server
 * is shown as it comes — in Russian, next to the field it is about.
 * Ведёт одну `LoginForm`: номер с маской сайта и согласием, затем код. Четыре
 * цифры отправляются сами; таймер говорит, когда можно попросить новый код;
 * звонок можно заменить на SMS; вход через оператора («Мобильная
 * авторизация») ждётся опросом сервера раз в три секунды, пока гость
 * подтверждает на телефоне. Каждый отказ сервера показывается как есть —
 * по-русски, рядом с полем, к которому относится.
 */
import { ApiError, accountApi, type Sent } from '../lib/account';
import { bindPhoneMask, maskPhone, normalizePhone } from '../lib/order';
import { saveSession } from './account-session';

type Options = {
  api: ReturnType<typeof accountApi>;
  /** номер, который уже знаем: прошлый вход или черновик корзины */
  phone?: string | null;
  onSignedIn: (result: { created: boolean; phone: string }) => void;
  /** шаг сменился: родитель двигает фокус или заголовок */
  onStep?: (step: 'phone' | 'code') => void;
};

const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode) => root.querySelector<T>(selector);

// the phone inside a hint never breaks across lines: «+7 (987) 000-» / «11-22» read as two numbers
// номер в подсказке не переносится: «+7 (987) 000-» / «11-22» читались двумя номерами
const paintHint = (node: HTMLElement, text: string) => {
  node.replaceChildren();
  let rest = text;
  for (let match = rest.match(/\+7[\d\s()-]{9,}\d/); match; match = rest.match(/\+7[\d\s()-]{9,}\d/)) {
    const at = match.index ?? 0;
    const phone = document.createElement('span');
    phone.className = 'nowrap';
    phone.textContent = match[0];
    node.append(rest.slice(0, at), phone);
    rest = rest.slice(at + match[0].length);
  }
  node.append(rest);
};

export const mountLogin = (form: HTMLFormElement, options: Options) => {
  const { api } = options;
  const steps = { phone: $('[data-login-step="phone"]', form)!, code: $('[data-login-step="code"]', form)! };
  const phoneInput = $<HTMLInputElement>('input[name="phone"]', form)!;
  const consent = $<HTMLInputElement>('input[name="consent"]', form)!;
  const codeInput = $<HTMLInputElement>('input[name="code"]', form)!;
  const hint = $('[data-hint]', form)!;
  const timerNode = $('[data-timer]', form)!;
  const resend = $<HTMLButtonElement>('[data-resend]', form)!;
  const sms = $<HTMLButtonElement>('[data-sms]', form)!;
  const change = $<HTMLButtonElement>('[data-change]', form)!;
  const wait = $('[data-wait]', form)!;
  const errorBox = $('[data-login-error]', form)!;
  const codeLabel = $('[data-code-label]', form)!;

  let step: 'phone' | 'code' = 'phone';
  let phone = '';
  let sent: Sent | null = null;
  let busy = false;
  let timer = 0;
  let poll = 0;

  if (options.phone) phoneInput.value = maskPhone(options.phone);

  const fieldError = (name: 'phone' | 'consent' | 'code', message: string | null) => {
    const node = $(`[data-err="${name}"]`, form);
    if (node) {
      node.textContent = message ?? '';
      node.hidden = !message;
    }
    const input = name === 'phone' ? phoneInput : name === 'code' ? codeInput : consent;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  const showError = (title: string | null, text = '') => {
    errorBox.hidden = !title;
    if (!title) return;
    $('[data-error-title]', errorBox)!.textContent = title;
    $('[data-error-text]', errorBox)!.textContent = text;
  };
  const setBusy = (on: boolean, label?: string) => {
    busy = on;
    for (const button of form.querySelectorAll<HTMLButtonElement>('[data-submit]')) {
      if (on) button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
      const text = $('[data-submit-label]', button);
      if (text && label && on) {
        text.dataset.idle ??= text.textContent ?? '';
        text.textContent = label;
      } else if (text && !on && text.dataset.idle) text.textContent = text.dataset.idle;
    }
  };

  const go = (next: 'phone' | 'code') => {
    step = next;
    steps.phone.hidden = next !== 'phone';
    steps.code.hidden = next !== 'code';
    options.onStep?.(next);
  };

  const stopTimers = () => {
    clearInterval(timer);
    clearInterval(poll);
    timer = 0;
    poll = 0;
  };

  /** Обратный отсчёт до нового кода; на нуле — «Прислать ещё раз» и, если можно, SMS. */
  const countdown = (seconds: number) => {
    clearInterval(timer);
    let left = Math.max(0, Math.round(seconds));
    const paint = () => {
      const ready = left <= 0;
      timerNode.hidden = ready;
      timerNode.textContent = `Новый код — через ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      resend.hidden = !ready;
      sms.hidden = !ready || !sent?.fallback;
      resend.textContent = sent?.channel === 'call' ? 'Позвонить ещё раз' : 'Прислать код ещё раз';
    };
    paint();
    timer = window.setInterval(() => {
      left -= 1;
      paint();
      if (left <= 0) clearInterval(timer);
    }, 1000);
  };

  const signedIn = (token: string, expires: string, created: boolean) => {
    stopTimers();
    saveSession({ token, expires, phone });
    options.onSignedIn({ created, phone });
  };

  /** Мобильная авторизация: спрашиваем сервер, пока гость подтверждает на телефоне. */
  const waitForOperator = (ttl: number) => {
    clearInterval(poll);
    wait.hidden = false;
    const until = Date.now() + ttl * 1000;
    poll = window.setInterval(async () => {
      if (Date.now() > until) {
        clearInterval(poll);
        wait.hidden = true;
        return;
      }
      if (busy) return;
      try {
        const result = await api.verify(phone, undefined, sent?.request || undefined);
        if (result) signedIn(result.token, result.expires, result.created);
      } catch (error) {
        if (error instanceof ApiError && error.status && error.status !== 429) {
          clearInterval(poll);
          wait.hidden = true;
          fieldError('code', error.message);
        }
      }
    }, 3000);
  };

  const send = async (channel?: 'sms') => {
    if (busy) return;
    showError(null);
    fieldError('code', null);
    setBusy(true, 'Отправляем…');
    try {
      sent = await api.send(phone, channel);
      paintHint(hint, sent.hint);
      codeLabel.textContent = sent.channel === 'call' ? 'Последние 4 цифры номера' : 'Код из SMS';
      codeInput.maxLength = sent.length;
      codeInput.value = '';
      go('code');
      countdown(sent.resend_in);
      wait.hidden = true;
      if (sent.channel === 'mobile_id') {
        codeLabel.textContent = 'Код из SMS, если пришёл';
        waitForOperator(sent.expires_in);
      }
      codeInput.focus();
    } catch (error) {
      const e = error as ApiError;
      if (e.code === 'TOO_SOON') {
        // a code went out a minute ago (another tab, a reload): it is still good
        // код ушёл минуту назад (другая вкладка, перезагрузка): он ещё действует
        sent ??= { request: '', channel: 'sms', length: 4, expires_in: 300, resend_in: e.retryAfter, hint: '', fallback: false };
        hint.textContent = 'Код уже отправлен на этот номер — введите его.';
        go('code');
        countdown(e.retryAfter || 60);
        codeInput.focus();
      } else if (e.code === 'INVALID_PHONE') {
        go('phone');
        fieldError('phone', e.message);
        phoneInput.focus();
      } else {
        showError(e.status === 0 ? 'Нет связи' : 'Код не отправлен', e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (busy) return;
    const code = codeInput.value.replace(/\D/g, '');
    const length = sent?.length ?? 4;
    if (code.length !== length) {
      fieldError('code', sent?.channel === 'mobile_id' ? 'Подтвердите вход на телефоне или введите код из SMS' : `Нужны ${length} цифры`);
      codeInput.focus();
      return;
    }
    showError(null);
    fieldError('code', null);
    setBusy(true, 'Проверяем…');
    try {
      const result = await api.verify(phone, code, sent?.request || undefined);
      if (result) signedIn(result.token, result.expires, result.created);
    } catch (error) {
      const e = error as ApiError;
      if (['CODE_WRONG', 'CODE_BURNT', 'CODE_EXPIRED', 'CODE_REQUIRED', 'CONFIRM_FAILED', 'NOT_READY'].includes(e.code)) {
        fieldError('code', e.message);
        codeInput.select();
        // a burnt or stale code cannot be fixed by typing: offer a new one at once
        // сгоревший или устаревший код набором не исправить: сразу предложить новый
        if (!['CODE_WRONG', 'CODE_REQUIRED', 'NOT_READY'].includes(e.code)) countdown(0);
      } else showError(e.status === 0 ? 'Нет связи' : 'Не получилось войти', e.message);
    } finally {
      setBusy(false);
    }
  };

  // the site's mask: «+7» on focus, the guest types the number itself
  // маска сайта: «+7» при фокусе, гость набирает сам номер
  bindPhoneMask(phoneInput, () => fieldError('phone', null));
  phoneInput.addEventListener('blur', () => {
    if (phoneInput.value.replace(/\D/g, '') === '7') phoneInput.value = '';
  });
  consent.addEventListener('change', () => consent.checked && fieldError('consent', null));
  codeInput.addEventListener('input', () => {
    const digits = codeInput.value.replace(/\D/g, '').slice(0, codeInput.maxLength || 4);
    if (digits !== codeInput.value) codeInput.value = digits;
    fieldError('code', null);
    if (digits.length === (sent?.length ?? 4)) void verify();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (step === 'code') return void verify();
    const normalized = normalizePhone(phoneInput.value);
    fieldError('phone', normalized ? null : phoneInput.value.replace(/\D/g, '').length > 1 ? 'Проверьте номер: 10 цифр после +7' : 'Введите номер телефона');
    fieldError('consent', consent.checked ? null : 'Без согласия мы не можем завести кабинет');
    if (!normalized) return phoneInput.focus();
    if (!consent.checked) return consent.focus();
    phone = normalized;
    void send();
  });
  resend.addEventListener('click', () => void send());
  sms.addEventListener('click', () => void send('sms'));
  change.addEventListener('click', () => {
    stopTimers();
    wait.hidden = true;
    showError(null);
    fieldError('code', null);
    go('phone');
    phoneInput.focus();
  });

  return {
    focus: () => (step === 'phone' ? phoneInput : codeInput).focus(),
    reset: () => {
      stopTimers();
      showError(null);
      go('phone');
    },
  };
};
