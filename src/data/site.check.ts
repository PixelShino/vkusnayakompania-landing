/**
 * Проверка расписания: часы и живой статус — единственная логика на странице,
 * которую нельзя увидеть глазами (она зависит от дня недели и времени суток).
 *
 * Запуск: `npm test` — без раннера и зависимостей, Node сам читает TypeScript.
 */
import assert from 'node:assert/strict';
import { hoursRows, openState, places, plural, schemaHours } from './site.ts';

const [sadovaya, armii] = places;

// расписание разворачивается в человеческие строки и в формат schema.org
assert.deepEqual(
  hoursRows(sadovaya.schedule).map((row) => `${row.days} ${row.hours}`),
  ['Пн–пт 8:00 — 21:00', 'Сб 8:30 — 21:00', 'Вс 9:00 — 21:00'],
);
assert.deepEqual(hoursRows(armii.schedule), [{ days: 'Ежедневно', hours: '9:00 — 22:30' }]);
assert.deepEqual(schemaHours(sadovaya.schedule), [
  'Mo-Fr 08:00-21:00',
  'Sa 08:30-21:00',
  'Su 09:00-21:00',
]);

// среда: до открытия, в течение дня, после закрытия
assert.equal(openState(sadovaya.schedule, 3, 7 * 60).label, 'Откроется в 8:00');
assert.equal(openState(sadovaya.schedule, 3, 12 * 60).isOpen, true);
assert.equal(openState(sadovaya.schedule, 3, 12 * 60).label, 'Открыто до 21:00');
assert.equal(openState(sadovaya.schedule, 3, 21 * 60 + 30).label, 'Откроется завтра в 8:00');

// границы: ровно в момент открытия уже открыто, ровно в закрытие — уже нет
assert.equal(openState(sadovaya.schedule, 3, 8 * 60).isOpen, true);
assert.equal(openState(sadovaya.schedule, 3, 21 * 60).isOpen, false);

// суббота открывается позже, а пятничная ночь ведёт в субботние 8:30
assert.equal(openState(sadovaya.schedule, 6, 8 * 60 + 10).label, 'Откроется в 8:30');
assert.equal(openState(sadovaya.schedule, 5, 22 * 60).label, 'Откроется завтра в 8:30');
// воскресная ночь — обратно к понедельничным восьми
assert.equal(openState(sadovaya.schedule, 0, 23 * 60).label, 'Откроется завтра в 8:00');

// у точки с одинаковыми днями завтрашнее открытие не съезжает
assert.equal(openState(armii.schedule, 6, 23 * 60).label, 'Откроется завтра в 9:00');

// числительные склоняются, а не пишутся «463 отзывов»
assert.equal(plural(463, 'отзыв', 'отзыва', 'отзывов'), 'отзыва');
assert.equal(plural(1085, 'оценка', 'оценки', 'оценок'), 'оценок');
assert.equal(plural(1, 'отзыв', 'отзыва', 'отзывов'), 'отзыв');

console.log('расписание и статус — все проверки прошли');
