/**
 * The build-time half of a landing's markup: addresses of the page and the
 * catalog, the dish photos for `Product.image` and the page's own `WebPage`
 * fields. The photo is the card's own 720 px webp — the same transform as the
 * catalog's markup and the tile, so it costs no extra encode.
 * Сборочная половина разметки посадочной страницы: адреса страницы и
 * каталога, фото блюд для `Product.image` и поля своего `WebPage`. Фото — та
 * же копия 720 px webp, что у карточки и у разметки каталога: лишнего
 * кодирования нет.
 */
import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';
import { BASE } from '../../lib/base.ts';
import type { Product } from '../../lib/catalog.ts';
import { homeUrl, type PageSchema } from '../../lib/seo.ts';
import type { ShopLanding } from '../../data/landings-shop.ts';

/** Адрес страницы, каталога и главной от `site` (на превью — в подкаталоге `BASE`). */
export const urlsOf = (site: URL | undefined, path: string) => {
  const root = site ?? new URL('https://vkus-com.ru');
  return {
    site: root,
    url: new URL(`${BASE}${path.slice(1)}`, root).href,
    catalog: new URL(`${BASE}catalog/`, root).href,
    home: homeUrl(root),
  };
};

/** Фото блюд для разметки: slug → абсолютный адрес копии 720 px. */
export const dishImages = async (products: Product[], pageUrl: string) => {
  const entries = await Promise.all(
    products.map(async (product) => {
      const photo = product.photo;
      if (!photo || photo.placeholder) return [product.slug, undefined] as const;
      const width = Math.min(photo.width, 720);
      const image = await getImage({
        src: photo.src as ImageMetadata,
        width,
        height: Math.round((photo.height * width) / photo.width),
        format: 'webp',
        quality: 76,
      });
      return [product.slug, new URL(image.src, pageUrl).href] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, string | undefined>;
};

/** Что страница сообщает раскладке: вид узла, крошки «Главная → страница» и свои поля. */
export const pageSchema = (
  page: ShopLanding,
  urls: ReturnType<typeof urlsOf>,
  fields: Record<string, unknown> = {},
): PageSchema => ({
  type: page.schemaType,
  crumbs: [
    { name: 'Главная', url: urls.home },
    { name: page.crumb, url: urls.url },
  ],
  fields,
});

/** Журнал сборки: что из обещаний title и description контент больше не подтверждает. */
export const warnMissing = (page: ShopLanding, missing: string[]) => {
  if (missing.length)
    console.warn(
      `${page.path}: контент не подтверждает «${missing.join('», «')}» — title и description взяты запасные (src/data/landings-shop.ts)`,
    );
};
