/**
 * Pure selections over Directus content: no I/O, dates compared as strings.
 * Чистые выборки по контенту Directus: без сети и файлов, даты сравниваются
 * строками `YYYY-MM-DD` — так лексикографический порядок совпадает с
 * хронологическим.
 */

/** Запись с окном показа: пустая граница значит «всегда». */
export type Dated = { status: string; show_from?: string | null; show_until?: string | null };

/** Опубликовано и сегодня внутри окна показа, границы включительно. */
export const isLive = <T extends Dated>(item: T, today: string) =>
  item.status === 'published' &&
  (!item.show_from || item.show_from <= today) &&
  (!item.show_until || item.show_until >= today);

/** Текущая афиша: ближайшая будущая из живых, а если все прошли — последняя. */
export const currentAfisha = <T extends Dated & { date: string }>(
  items: T[],
  today: string,
): T | null => {
  const live = items.filter((item) => isLive(item, today));
  const upcoming = live.filter((item) => item.date >= today);
  const sorted = (upcoming.length ? upcoming : live).sort((a, b) => a.date.localeCompare(b.date));
  return (upcoming.length ? sorted[0] : sorted.at(-1)) ?? null;
};

// null sorts last: Directus leaves `sort` empty until the editor drags a card
// пустой `sort` в конец: Directus оставляет его пустым, пока карточку не двигали
const SORT_LAST = Number.MAX_SAFE_INTEGER;

/** Живые акции в порядке `sort`. */
export const livePromos = <T extends Dated & { sort?: number | null }>(items: T[], today: string) =>
  items
    .filter((item) => isLive(item, today))
    .sort((a, b) => (a.sort ?? SORT_LAST) - (b.sort ?? SORT_LAST));

/** Группы по адресу; «обе точки» (`null`) идут первой группой. */
export const groupByPlace = <T extends { place?: number | null }>(items: T[]) => {
  const groups = new Map<number | null, T[]>();
  if (items.some((item) => item.place == null)) groups.set(null, []);
  for (const item of items) {
    const key = item.place ?? null;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
};

/** Опубликованное меню направления, самое свежее по `updated`; нет — `null`. */
export const menuFor = <T extends { status: string; direction: number; updated: string }>(
  menus: T[],
  direction: number,
): T | null =>
  menus
    .filter((menu) => menu.status === 'published' && menu.direction === direction)
    .reduce<T | null>((best, menu) => (!best || menu.updated > best.updated ? menu : best), null);
