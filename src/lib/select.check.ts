/**
 * Проверка выборок: окна показа и порядок карточек глазами не проверить,
 * а от них зависит, что вообще попадёт на страницу.
 * Запуск: `pnpm test` (Node читает TypeScript сам).
 */
import assert from 'node:assert/strict';
import { currentAfisha, groupByPlace, isLive, livePromos, menuFor } from './select.ts';

const TODAY = '2026-09-03';

// окно показа: пустые границы значат «всегда», сами границы включительно
assert.equal(isLive({ status: 'published' }, TODAY), true);
assert.equal(isLive({ status: 'published', show_from: null, show_until: null }, TODAY), true);
assert.equal(isLive({ status: 'published', show_from: TODAY }, TODAY), true);
assert.equal(isLive({ status: 'published', show_until: TODAY }, TODAY), true);
assert.equal(isLive({ status: 'published', show_from: '2026-09-04' }, TODAY), false);
assert.equal(isLive({ status: 'published', show_until: '2026-09-02' }, TODAY), false);

// черновик и архив не показываются даже внутри окна
assert.equal(isLive({ status: 'draft' }, TODAY), false);
assert.equal(isLive({ status: 'archived', show_from: '2026-01-01' }, TODAY), false);

const afisha = [
  { id: 1, status: 'published', date: '2026-08-20' },
  { id: 2, status: 'published', date: '2026-09-26' },
  { id: 3, status: 'published', date: '2026-10-10' },
  { id: 4, status: 'draft', date: '2026-09-05' },
];

// афиша: ближайшая будущая, черновик мимо; сегодняшняя важнее будущей
assert.equal(currentAfisha(afisha, TODAY)?.id, 2);
assert.equal(currentAfisha([...afisha, { id: 5, status: 'published', date: TODAY }], TODAY)?.id, 5);
// все прошли — остаётся последняя живая, а не пустота
assert.equal(currentAfisha(afisha.slice(0, 1), TODAY)?.id, 1);
assert.equal(currentAfisha([], TODAY), null);
// запись без даты — анонс: берётся, когда датированных впереди нет, и уступает
// любой датированной будущей; прошедшую датированную она обгоняет
assert.equal(currentAfisha([{ id: 7, status: 'published' }], TODAY)?.id, 7);
assert.equal(currentAfisha([{ id: 7, status: 'published' }, ...afisha], TODAY)?.id, 2);
assert.equal(currentAfisha([{ id: 7, status: 'published' }, afisha[0]], TODAY)?.id, 7);
// запись вне окна показа не берётся, хотя дата ещё впереди
assert.equal(
  currentAfisha([{ id: 6, status: 'published', date: '2026-09-10', show_from: '2026-09-09' }], TODAY),
  null,
);

const promos = [
  { id: 1, status: 'published', sort: 3, place: 1 },
  { id: 2, status: 'published', sort: 1, place: null },
  { id: 3, status: 'draft', sort: 2, place: null },
  { id: 4, status: 'published', sort: 2, place: 2, show_until: '2026-09-02' },
  { id: 5, status: 'published', sort: null, place: 1 },
];

// акции: только живые, по возрастанию sort, пустой sort уходит в конец
assert.deepEqual(
  livePromos(promos, TODAY).map((promo) => promo.id),
  [2, 1, 5],
);

// группы по адресу: «обе точки» первой, даже если такая акция не первая в списке
const groups = groupByPlace(livePromos(promos, TODAY));
assert.deepEqual([...groups.keys()], [null, 1]);
assert.deepEqual(groups.get(null)?.map((promo) => promo.id), [2]);
assert.deepEqual(groups.get(1)?.map((promo) => promo.id), [1, 5]);
assert.deepEqual(
  [...groupByPlace([{ place: 1 }, { place: 2 }, { place: null }, { place: 1 }]).keys()],
  [null, 1, 2],
);

const menus = [
  { id: 1, status: 'published', direction: 1, updated: '2026-08-01' },
  { id: 2, status: 'published', direction: 1, updated: '2026-09-01' },
  { id: 3, status: 'draft', direction: 1, updated: '2026-09-02' },
  { id: 4, status: 'published', direction: 2, updated: '2026-07-01' },
];

// меню: самое свежее опубликованное по направлению, черновик не в счёт
assert.equal(menuFor(menus, 1)?.id, 2);
assert.equal(menuFor(menus, 2)?.id, 4);
assert.equal(menuFor(menus, 3), null);

console.log('выборки афиши, акций и меню — все проверки прошли');
