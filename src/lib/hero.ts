/**
 * Image widths and the LCP frame `sizes`: shared by `Photo.astro` and the
 * `<link rel=preload>` in the layout, so the preload matches what Hero renders.
 * Ширины кадров и `sizes` LCP-снимка: их берут `Photo.astro` и preload в
 * шапке документа — иначе preload тянет не тот файл, что рисует Hero.
 */

export const PHOTO_WIDTHS = [480, 800, 1200, 1600, 2000, 2560];

/**
 * The widest frame we cut: the first screen lies across a 2K monitor at 2560px
 * and nothing on the page is wider. A phone original of 4032px would otherwise
 * be encoded whole on top of the steps.
 * Самый широкий кадр, что режем: первый экран лежит на 2K-мониторе в 2560px,
 * шире на странице ничего нет. Иначе телефонный оригинал в 4032px кодировался
 * бы целиком поверх ступеней.
 */
const MAX_WIDTH = 2560;

/** снимок первого экрана лежит на всю ширину окна — на любой ширине это `100vw` */
export const HERO_SIZES = '100vw';

/** Ширины `srcset` без апскейла: крупнее оригинала и `MAX_WIDTH` кадры не режем. */
export const widthsFor = (width: number) =>
  width > MAX_WIDTH ? PHOTO_WIDTHS : [...PHOTO_WIDTHS.filter((w) => w < width), width];
