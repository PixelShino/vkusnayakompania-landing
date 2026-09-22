/**
 * LQIP: a ~20px preview of the frame, inlined as a data-URI, so `figure.media`
 * shows the photo's own blurred colors while the AVIF loads — not a flat plate.
 * LQIP: микро-превью кадра в ~20px, вшитое в страницу data-URI — пока грузится
 * AVIF, `figure.media` показывает размытый кадр, а не плоскую плашку.
 */
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import type { ImageMetadata } from 'astro';

/** ширина превью и качество WebP: ~500 байт на кадр */
const WIDTH = 20;
const QUALITY = 45;

const FIXTURES = fileURLToPath(new URL('../data/fixture-files/', import.meta.url));

// `Photo` renders dozens of times per page — every source is encoded once.
// `Photo` рисуется на странице десятки раз — каждый исходник кодируем один раз.
const cache = new Map<string, Promise<string | undefined>>();

// Astro keeps the absolute path in `fsPath`; should the field go away, the file
// is found back in the fixtures folder by the id in its served address.
// Astro держит абсолютный путь в `fsPath`; если поле пропадёт, файл ищется в
// папке фикстур по идентификатору из адреса.
const sourcePath = async (src: ImageMetadata): Promise<string | undefined> => {
  const { fsPath } = src as ImageMetadata & { fsPath?: string };
  if (fsPath) return fsPath;
  const id = path.basename(src.src).split('.')[0];
  const files = await readdir(FIXTURES).catch(() => [] as string[]);
  const name = files.find((file) => file.startsWith(id));
  return name && path.join(FIXTURES, name);
};

// A broken or missing source must not take the build down: no preview, plate.
// Битый или пропавший исходник не должен валить сборку: без превью, с плашкой.
const encode = async (file: string): Promise<string | undefined> => {
  try {
    const buf = await sharp(file).resize({ width: WIDTH }).webp({ quality: QUALITY }).toBuffer();
    return `data:image/webp;base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
};

/** data-URI превью для своего файла; для адреса Directus — `undefined`. */
export const lqip = async (src: ImageMetadata | string): Promise<string | undefined> => {
  // a remote frame is not on disk at build time — fetching it back is not worth it
  // удалённый кадр на сборке не лежит на диске — тянуть его обратно незачем
  if (typeof src === 'string') return undefined;
  let pending = cache.get(src.src);
  if (!pending) {
    pending = sourcePath(src).then((file) => (file ? encode(file) : undefined));
    cache.set(src.src, pending);
  }
  return pending;
};
