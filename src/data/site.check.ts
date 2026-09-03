/**
 * Проверка расписания: часы и статус зависят от дня недели и времени суток,
 * глазами их не проверить. Запуск: `pnpm test` (Node читает TypeScript сам).
 */
import assert from 'node:assert/strict';
import { hoursRows, openState, plural, schemaHours, toSchedule } from './site.ts';
import type { HoursRow } from './site.ts';

// строки админки → кортеж по getDay()
const rows: HoursRow[] = [
  { day: 'mon', open: '08:00', close: '21:00' },
  { day: 'tue', open: '08:00', close: '21:00' },
  { day: 'wed', open: '08:00', close: '21:00' },
  { day: 'thu', open: '08:00', close: '21:00' },
  { day: 'fri', open: '08:00', close: '21:00' },
  { day: 'sat', open: '08:30', close: '21:00' },
  { day: 'sun', open: '09:00', close: '21:00' },
];
assert.deepEqual(toSchedule(rows)[0], ['09:00', '21:00']);
assert.deepEqual(toSchedule(rows)[6], ['08:30', '21:00']);
assert.throws(() => toSchedule(rows.slice(1)), /понедельник/);
assert.throws(
  () => toSchedule([...rows.slice(0, 6), { day: 'sun', open: '21:00', close: '09:00' }]),
  /воскресенье/,
);

const sadovaya = toSchedule(rows);
const armii = toSchedule(rows.map((row) => ({ ...row, open: '09:00', close: '22:30' })));

// расписание разворачивается в человеческие строки и в формат schema.org
assert.deepEqual(
  hoursRows(sadovaya).map((row) => `${row.days} ${row.hours}`),
  ['Пн–пт 8:00 — 21:00', 'Сб 8:30 — 21:00', 'Вс 9:00 — 21:00'],
);
assert.deepEqual(hoursRows(armii), [{ days: 'Ежедневно', hours: '9:00 — 22:30' }]);
assert.deepEqual(schemaHours(sadovaya), [
  'Mo-Fr 08:00-21:00',
  'Sa 08:30-21:00',
  'Su 09:00-21:00',
]);

// среда: до открытия, в течение дня, после закрытия
assert.equal(openState(sadovaya, 3, 7 * 60).label, 'Откроется в 8:00');
assert.equal(openState(sadovaya, 3, 12 * 60).isOpen, true);
assert.equal(openState(sadovaya, 3, 12 * 60).label, 'Открыто до 21:00');
assert.equal(openState(sadovaya, 3, 21 * 60 + 30).label, 'Откроется завтра в 8:00');

// границы: ровно в момент открытия уже открыто, ровно в закрытие — уже нет
assert.equal(openState(sadovaya, 3, 8 * 60).isOpen, true);
assert.equal(openState(sadovaya, 3, 21 * 60).isOpen, false);

// суббота открывается позже, а пятничная ночь ведёт в субботние 8:30
assert.equal(openState(sadovaya, 6, 8 * 60 + 10).label, 'Откроется в 8:30');
assert.equal(openState(sadovaya, 5, 22 * 60).label, 'Откроется завтра в 8:30');
// воскресная ночь — обратно к понедельничным восьми
assert.equal(openState(sadovaya, 0, 23 * 60).label, 'Откроется завтра в 8:00');

// у точки с одинаковыми днями завтрашнее открытие не съезжает
assert.equal(openState(armii, 6, 23 * 60).label, 'Откроется завтра в 9:00');

// склонение числительных
assert.equal(plural(463, 'отзыв', 'отзыва', 'отзывов'), 'отзыва');
assert.equal(plural(1085, 'оценка', 'оценки', 'оценок'), 'оценок');
assert.equal(plural(1, 'отзыв', 'отзыва', 'отзывов'), 'отзыв');

console.log('расписание и статус — все проверки прошли');
