/**
 * The venue the catalog shows. The two kitchens cook different menus (Валерия,
 * 26.10.2026: «сначала выбирает адрес, после блюда»): a dish lists the venues
 * that cook it (`Product.places`, empty — both), and the page shows one venue
 * at a time. The choice lives on `<html data-venue>`: an inline script in the
 * head sets it before the first paint (from `?place=`, the remembered choice,
 * an old checkout draft or the first venue), and the rules from `venueCss`
 * hide the other venue's dishes, sections and counts — so the menu never
 * jumps when the page script wakes up, and without scripts the page is the
 * whole menu, as before.
 * Точка, которую показывает каталог. Две кухни готовят разное меню (Валерия,
 * 26.10.2026: «сначала выбирает адрес, после блюда»): у блюда — точки, где его
 * готовят (`Product.places`, пусто — на обеих), страница показывает одну точку
 * за раз. Выбор живёт на `<html data-venue>`: встроенный скрипт в `<head>`
 * ставит его до первой отрисовки (из `?place=`, запомненного выбора, старого
 * черновика оформления или первой точки), а правила `venueCss` прячут блюда,
 * разделы и счётчики другой точки — меню не прыгает, когда просыпается скрипт
 * страницы, а без скриптов страница остаётся полным меню, как раньше.
 */

import { cookedAt } from './catalog.ts';

/** Ключ хранилища: выбранная точка, общая для каталога и корзины. */
export const PLACE_KEY = 'vkus:place';

export type Cooked = { places?: readonly number[] | null };

/**
 * `cookedAt` of the catalog for anything that knows its venues, or not: no
 * venue chosen or no list — cooked here.
 * `cookedAt` каталога для всего, что знает свои точки или нет: точка не
 * выбрана или списка нет — готовят здесь.
 */
export const cookedHere = (dish: Cooked, place: number | null | undefined) =>
  !place || cookedAt({ places: [...(dish.places ?? [])] }, place);

/**
 * Where a section (or any group of dishes) has something: the venues of its
 * dishes, `[]` when something in it is cooked everywhere. A group whose
 * dishes name only venues the site does not have gets `[0]` — no venue shows it.
 * Где у раздела (любой группы блюд) что-то есть: точки его блюд, `[]` — если
 * хоть одно блюдо готовят везде. Группа, чьи блюда называют только точки,
 * которых на сайте нет, получает `[0]` — её не показывает ни одна точка.
 */
export const sectionPlaces = (dishes: readonly Cooked[], all: readonly number[]): number[] => {
  if (!dishes.length || all.length < 2) return [];
  const ids = new Set<number>();
  for (const dish of dishes) {
    if (!dish.places?.length) return [];
    for (const id of dish.places) if (all.includes(id)) ids.add(id);
  }
  if (!ids.size) return [0];
  return all.every((id) => ids.has(id)) ? [] : all.filter((id) => ids.has(id));
};

/** Значение `data-places`: id через пробел; `undefined` — есть везде, атрибута нет. */
export const placesAttr = (ids: readonly number[]) => (ids.length ? ids.join(' ') : undefined);

/** Сколько блюд из списка готовят на каждой точке: `{ 1: 94, 2: 102 }`. */
export const countsAt = (dishes: readonly Cooked[], all: readonly number[]): Record<number, number> =>
  Object.fromEntries(all.map((id) => [id, dishes.filter((dish) => cookedHere(dish, id)).length]));

/** Первая точка сайта из кандидатов (адрес, хранилище, черновик); иначе первая точка сайта. */
export const pickPlace = (all: readonly number[], ...candidates: unknown[]): number | null => {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const id = Number(candidate);
    if (Number.isInteger(id) && all.includes(id)) return id;
  }
  return all[0] ?? null;
};

/**
 * A venue's name after «на»: «Садовая, 212Б» → «Садовой, 212Б» (`loc`: готовят
 * на чём) or «Садовую, 212Б» (`acc`: перейти на что); «Советской Армии, 177»
 * stays. Only the first word changes and only a feminine adjective (-ая, -яя),
 * the shape of Samara's street names; anything else is left as written.
 * Имя точки после «на»: «Садовая, 212Б» → «Садовой, 212Б» (`loc`: готовят на
 * чём) или «Садовую, 212Б» (`acc`: перейти на что); «Советской Армии, 177»
 * остаётся. Меняется только первое слово и только прилагательное женского
 * рода (-ая, -яя) — так устроены названия улиц Самары; остальное — как написано.
 */
export const venueCase = (name: string, form: 'loc' | 'acc') =>
  name.replace(/^([\p{L}-]+?)(ая|яя)(?=[\s,]|$)/u, (_, stem: string, end: string) =>
    stem + (end === 'ая' ? (form === 'loc' ? 'ой' : 'ую') : form === 'loc' ? 'ей' : 'юю'),
  );

/** «Кондитерская и кафе» → «кондитерская и кафе»: вторая строка переключателя. */
export const kindLine = (kind: string) => kind.charAt(0).toLocaleLowerCase('ru-RU') + kind.slice(1);

/**
 * The rules that show one venue's menu, one block per venue: the other
 * venues' dishes, sections and count variants are hidden; the switch gets the
 * position of its ink (`--at`) and the colours of the chosen half (`--fg`,
 * `--fg-2`); the venue's last tile, alone in its row, spans it (`--span`).
 * Without `data-venue` (no scripts) the switch is hidden and the counts are
 * the whole menu's.
 * Правила, которые показывают меню одной точки, по блоку на точку: блюда,
 * разделы и варианты счётчиков других точек спрятаны; переключатель получает
 * положение чернильной половины (`--at`) и цвета выбранной (`--fg`, `--fg-2`);
 * последняя плитка точки, одна в ряду, берёт весь ряд (`--span`). Без
 * `data-venue` (нет скриптов) переключателя нет, а счётчики — всего меню.
 */
export const venueCss = (all: readonly number[]) =>
  all
    .map((id, i) => {
      const at = `:root[data-venue="${id}"]`;
      return (
        `${at} [data-places]:not([data-places~="${id}"]),${at} [data-for-venue]:not([data-for-venue="${id}"]){display:none!important}` +
        `${at} .pswitch__seg{--at:${i}}` +
        `${at} .pswitch__opt[data-venue-id="${id}"]{--fg:var(--on-ink);--fg-2:var(--on-ink-2)}` +
        // the last tile this venue shows, when it stands alone in its row of two
        // последняя плитка этой точки, когда она одна в ряду из двух
        `${at} .tiles>li:nth-last-child(1 of :not([data-places]),[data-places~="${id}"]):nth-child(odd of :not([data-places]),[data-places~="${id}"]){--span:2}`
      );
    })
    .join('') + ':root:not([data-venue]) [data-for-venue]:not([data-for-venue=""]),:root:not([data-venue]) .pswitch{display:none!important}';

/**
 * The inline head script: the venue from `?place=` (it wins and is
 * remembered: a QR code on a table means this venue), then the remembered
 * one, then an old checkout draft's pickup venue, then the first venue.
 * Встроенный скрипт для `<head>`: точка из `?place=` (она главнее и
 * запоминается: QR-код на столе значит эту точку), затем запомненная, затем
 * точка самовывоза из старого черновика оформления, затем первая точка.
 */
export const venueScript = (all: readonly number[], draftKey: string) =>
  `(function(){var all=${JSON.stringify(all)},d=document.documentElement,pick=function(v){v=Number(v);return v&&all.indexOf(v)>-1?v:0},p=0;` +
  `try{p=pick(new URLSearchParams(location.search).get('place'));if(p)localStorage.setItem(${JSON.stringify(PLACE_KEY)},String(p));` +
  `p=p||pick(localStorage.getItem(${JSON.stringify(PLACE_KEY)}));` +
  `if(!p){var r=JSON.parse(localStorage.getItem(${JSON.stringify(draftKey)})||'{}');p=pick(r&&r.place)}}catch(e){}` +
  `if(all.length)d.dataset.venue=String(p||all[0])})()`;
