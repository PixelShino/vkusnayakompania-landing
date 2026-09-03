/**
 * Image widths and the LCP frame `sizes`: shared by `Photo.astro` and the
 * `<link rel=preload>` in the layout, so the preload matches what Hero renders.
 * Ширины кадров и `sizes` LCP-снимка: их берут `Photo.astro` и preload в
 * шапке документа — иначе preload тянет не тот файл, что рисует Hero.
 */

export const PHOTO_WIDTHS = [480, 800, 1200, 1600];

export const HERO_SIZES = '(min-width: 1200px) 520px, (min-width: 768px) 45vw, 100vw';

/** Ширины `srcset` без апскейла: крупнее оригинала кадры не режем. */
export const widthsFor = (width: number) => [...PHOTO_WIDTHS.filter((w) => w < width), width];
