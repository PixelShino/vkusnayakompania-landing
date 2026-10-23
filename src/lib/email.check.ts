/**
 * Проверка правила «только российская почта»: список сайта равен списку
 * сервера, обе проверки отвечают одинаково. Запуск: `pnpm test`.
 */
import assert from 'node:assert/strict';
import * as site from './email.ts';

const server = await import('../../directus/extensions/email-guard/domains.js');

assert.deepEqual(site.RU_MAIL_DOMAINS, server.RU_MAIL_DOMAINS, 'списки доменов сайта и сервера разошлись');
assert.deepEqual(site.OWN_MAIL_DOMAINS, server.OWN_MAIL_DOMAINS);
assert.equal(site.RU_MAIL_ERROR, server.RU_MAIL_ERROR);
assert.equal(site.RU_MAIL_ERROR_ADMIN, server.RU_MAIL_ERROR_ADMIN);
assert.ok(new Set(site.RU_MAIL_DOMAINS).size === site.RU_MAIL_DOMAINS.length, 'домены без повторов');

const yes = ['anna@mail.ru', ' Anna@Mail.RU ', 'a@bk.ru', 'a@list.ru', 'a@inbox.ru', 'a@ya.ru', 'a@yandex.ru', 'a@yandex.com', 'a@rambler.ru', 'a@lenta.ru', 'a@vk.com', 'a@xmail.ru'];
const no = ['a@gmail.com', 'a@outlook.com', 'a@icloud.com', 'a@proton.me', 'a@sub.mail.ru', 'a@mail.ru.evil.com', '@mail.ru', 'mail.ru', 'a@mail', '', null, undefined, 'a b@mail.ru'];
for (const impl of [site, server] as const) {
  for (const email of yes) assert.equal(impl.isRuEmail(email), true, `${email} должен проходить`);
  for (const email of no) assert.equal(impl.isRuEmail(email as string), false, `${email} не должен проходить`);
  // свой домен — только когда разрешён явно (админка) / own domain only when allowed (admin)
  assert.equal(impl.isRuEmail('zakaz@vkus-com.ru'), false);
  assert.equal(impl.isRuEmail('zakaz@vkus-com.ru', { own: true }), true);
  assert.equal(impl.isRuEmail('a@gmail.com', { own: true }), false);
  assert.equal(impl.emailDomain('Anna@Mail.RU '), 'mail.ru');
  assert.equal(impl.emailDomain('мусор'), null);
}

console.log('почта: только российские домены, списки сайта и сервера совпадают — проверки прошли');
