// Russian mail only, the admin side: the notes under the three mail fields say
// which mail is taken (the `email-guard` hook refuses the rest), and a report
// of what is already stored and would be refused now — domains and counts
// only, never an address. Called at the end of `scripts/directus-setup.mjs`;
// idempotent like the rest of it: a note is patched only when it differs.
// Только российская почта, сторона админки: подсказки под тремя полями почты
// говорят, какая почта принимается (остальное не пустит хук `email-guard`), и
// отчёт о том, что уже лежит в базе и сейчас было бы отклонено, — только
// домены и количество, без адресов. Вызывается в конце
// `scripts/directus-setup.mjs`; идемпотентен, как и весь setup: подсказка
// правится, только если отличается.
//
// Alone / Отдельно:
//   DIRECTUS_URL=http://localhost:8055 DIRECTUS_ADMIN_TOKEN=… node scripts/setup/email.mjs
import { pathToFileURL } from 'node:url';
import { emailDomain } from '../../directus/extensions/email-guard/domains.js';
import { emailProblem } from '../../directus/extensions/email-guard/rules.js';

const ADMIN_MAIL = 'Только российская почта: mail.ru, yandex.ru, rambler.ru, vk.com… или адрес на vkus-com.ru';
// the whole note, the field's own words kept / подсказка целиком, свои слова поля сохранены
export const NOTES = [
  {
    collection: 'notify_settings',
    field: 'email_recipients',
    note: `Можно несколько адресов: каждому уйдёт своё письмо. Галочки — что присылать на этот адрес. ${ADMIN_MAIL}`,
  },
  {
    collection: 'settings',
    field: 'email',
    note:
      'Почта для гостей: печатается в «Реквизитах и контактах» и в политике конфиденциальности (туда пишут об отзыве ' +
      `согласия и претензиях). Пусто — вместо почты телефон. ${ADMIN_MAIL}`,
  },
  {
    collection: 'directus_users',
    field: 'recovery_email',
    note: 'Настоящая почта гостя, только российская (mail.ru, yandex.ru, rambler.ru, vk.com…). «Email» выше — служебный адрес для входа',
  },
];

// «gmail.com ×2, outlook.com» — what the report prints instead of addresses
// «gmail.com ×2, outlook.com» — что отчёт печатает вместо адресов
const domainsLine = (emails) => {
  const counts = new Map();
  for (const email of emails) {
    const domain = emailDomain(email) ?? 'адрес с ошибкой';
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([domain, n]) => (n > 1 ? `${domain} ×${n}` : domain)).join(', ');
};
const filled = (value) => value !== null && value !== undefined && String(value).trim() !== '';

/** @param {(method: string, path: string, body?: unknown) => Promise<any>} api admin REST call / вызов REST от админа */
export async function setup(api) {
  // 1. the notes / подсказки
  for (const { collection, field, note } of NOTES) {
    let current;
    try {
      current = await api('GET', `/fields/${collection}/${field}`);
    } catch {
      console.log(`email: поля ${collection}.${field} нет (schema apply ещё не сделан) — пропускаю`);
      continue;
    }
    if ((current?.meta?.note ?? '') === note) continue;
    await api('PATCH', `/fields/${collection}/${field}`, { meta: { note } });
    console.log(`= field ${collection}.${field}: подсказка «только российская почта»`);
  }

  // 2. what is stored and would be refused now: domains and counts only
  //    что уже лежит в базе и сейчас было бы отклонено: только домены и количество
  const report = async (label, read) => {
    let emails;
    try {
      emails = await read();
    } catch {
      return console.log(`email: ${label} — не прочитано, пропускаю`);
    }
    console.log(emails.length ? `email: ${label} не подходят — ${emails.length}: ${domainsLine(emails)}` : `email: ${label} — все подходят`);
  };
  await report('почта гостей для восстановления', async () =>
    (await api('GET', '/users?filter[recovery_email][_nnull]=true&fields=recovery_email&limit=-1'))
      .map((u) => u.recovery_email)
      .filter((e) => filled(e) && emailProblem(e)),
  );
  await report('получатели в «Оповещениях»', async () => {
    const row = await api('GET', '/items/notify_settings?fields=email_recipients');
    let list = row?.email_recipients ?? [];
    if (typeof list === 'string') list = JSON.parse(list);
    return (Array.isArray(list) ? list : [])
      .map((r) => (typeof r === 'string' ? r : r?.email))
      .filter((e) => filled(e) && emailProblem(e, { own: true }));
  });
  await report('«Почта для обращений» в «Настройках сайта»', async () => {
    const email = (await api('GET', '/items/settings?fields=email'))?.email;
    return filled(email) && emailProblem(email, { own: true }) ? [email] : [];
  });
}

// run alone: the same REST call as the main setup / запуск отдельно: тот же вызов REST, что у основного setup
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const BASE = process.env.DIRECTUS_URL ?? 'http://localhost:8055';
  const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
  if (!TOKEN) throw new Error('DIRECTUS_ADMIN_TOKEN обязателен');
  const api = async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${await r.text()}`);
    return r.status === 204 ? null : (await r.json()).data;
  };
  await setup(api);
  console.log('email: готово');
}
