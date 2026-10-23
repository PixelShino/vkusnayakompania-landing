/**
 * Проверка ссылок мессенджеров для строки «Что-то не получается?»: заглушка
 * `https://max.ru/`, голая главная и пустое поле не выводятся, настоящий чат —
 * выводится. Запуск: `pnpm test`.
 */
import assert from 'node:assert/strict';
import { chatLinks, isChatLink } from './contact-links.ts';

const yes = [
  'https://t.me/vkusnayakompania',
  ' https://t.me/vkusnayakompania ',
  'https://t.me/vkusnayakompania/',
  'http://t.me/vkusnayakompania',
  'https://max.ru/u/f9LHodD0cOKmT3qLuMSEO7ldmCK0IZTLcTDSt1KrCgEJNnymcK7QTq',
  'https://max.ru/join/abc',
  'https://www.max.ru/vkus',
];
const no = [
  'https://max.ru/',
  'https://max.ru',
  'http://max.ru/',
  'https://www.max.ru/',
  'HTTPS://MAX.RU/',
  'https://max.ru//',
  'https://max.ru/?start=1',
  'https://t.me/',
  'https://t.me',
  '',
  '   ',
  null,
  undefined,
  't.me/vkusnayakompania',
  'tg://resolve?domain=vkusnayakompania',
  'javascript:alert(1)',
  'mailto:zakaz@vkus-com.ru',
  'не ссылка',
];
for (const href of yes) assert.equal(isChatLink(href), true, `${href} — чат, должен выводиться`);
for (const href of no) assert.equal(isChatLink(href), false, `${String(href)} — не чат, выводиться не должен`);

// как сейчас в админке: Telegram настоящий, Max — заглушка
assert.deepEqual(chatLinks({ telegram: 'https://t.me/vkusnayakompania', max: 'https://max.ru/' }), [
  { label: 'Telegram', href: 'https://t.me/vkusnayakompania' },
]);
// оба настоящие — Telegram первым, пробелы по краям сняты
assert.deepEqual(chatLinks({ telegram: ' https://t.me/vkus ', max: 'https://max.ru/u/abc' }), [
  { label: 'Telegram', href: 'https://t.me/vkus' },
  { label: 'Max', href: 'https://max.ru/u/abc' },
]);
// пустой Telegram, настоящий Max
assert.deepEqual(chatLinks({ telegram: '', max: 'https://max.ru/u/abc' }), [{ label: 'Max', href: 'https://max.ru/u/abc' }]);
// ни одного — пустой список: строка оставит только телефон
assert.deepEqual(chatLinks({ telegram: null, max: 'https://max.ru' }), []);
assert.deepEqual(chatLinks({}), []);

console.log('мессенджеры: заглушка Max, голые главные и пустые поля не выводятся — проверки прошли');
