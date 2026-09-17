/**
 * Image widths and the LCP frame `sizes`: shared by `Photo.astro` and the
 * `<link rel=preload>` in the layout, so the preload matches what Hero renders.
 * Ширины кадров и `sizes` LCP-снимка: их берут `Photo.astro` и preload в
 * шапке документа — иначе preload тянет не тот файл, что рисует Hero.
 */

export const PHOTO_WIDTHS = [480, 800, 1200, 1600];

/** снимок первого экрана лежит на всю ширину окна — на любой ширине это `100vw` */
export const HERO_SIZES = '100vw';

/** Ширины `srcset` без апскейла: крупнее оригинала кадры не режем. */
export const widthsFor = (width: number) => [...PHOTO_WIDTHS.filter((w) => w < width), width];
