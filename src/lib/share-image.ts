/**
 * An absolute address of a photo for structured data: the build's own copy,
 * at most 1200 px wide, as JPEG. A remote (Directus) image needs both sides
 * spelled out, so the height follows the photo's own ratio.
 * Абсолютный адрес фото для разметки: собственная копия сборки шириной до
 * 1200 px в JPEG. Удалённой картинке (Directus) нужны обе стороны, поэтому
 * высота идёт по пропорции самого фото.
 */
import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';
import type { Img } from './content.ts';

export const shareImage = async (photo: Img | undefined, site: URL, side = 1200) => {
  if (!photo || photo.placeholder) return undefined;
  const width = Math.min(side, photo.width);
  const height = Math.round((photo.height * width) / photo.width);
  const image = await getImage({ src: photo.src as ImageMetadata, width, height, format: 'jpeg', quality: 80 });
  return new URL(image.src, site).href;
};
