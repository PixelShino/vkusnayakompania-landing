/**
 * Optimize every uploaded image in place. Editors upload straight from the
 * phone: 2 MB PNG screenshots, 7 MB print-ready menus, 12-megapixel photos.
 * The site never needs more than 2560 px on the long side, and the admin
 * (thumbnails, file library, backups) suffers from the originals. After
 * `files.upload` the file is re-encoded through Directus' own image pipeline
 * (sharp) and written back under the same id: the record keeps its title,
 * alt and links, only the bytes, type, size and dimensions change.
 *
 * Каждое загруженное изображение ужимается на месте. Редакторы грузят прямо
 * с телефона: PNG-скриншоты по 2 МБ, печатные меню по 7 МБ, фото на 12 Мп.
 * Сайту не нужно больше 2560 px по длинной стороне, а админке (миниатюры,
 * библиотека файлов, бэкапы) оригиналы только мешают. После `files.upload`
 * файл прогоняется через штатный конвейер картинок Directus (sharp) и
 * записывается обратно под тем же id: заголовок, alt и связи остаются, меняются
 * только байты, тип, размер и габариты.
 *
 * No build step: this file is the extension. / Без сборки: этот файл и есть расширение.
 */

// the site's largest frame is ~1200 px wide; 2560 leaves room for retina and crops
// самый широкий кадр на сайте ~1200 px; 2560 хватает на ретину и обрезку
const MAX_SIDE = 2560;
const QUALITY = 85;
// a photo already in a web format and under this size is left alone
// фото уже в веб-формате и легче этого порога не трогаем
const KEEP_UNDER = 1_200_000;
// small PNGs are usually logos and icons with transparency: keep them as they are
// маленькие PNG — обычно логотипы и иконки с прозрачностью: оставляем как есть
const PNG_KEEP_UNDER = 300_000;

// target format per source type; anything else (gif, svg, heic, pdf) is skipped
// целевой формат по исходному типу; остальное (gif, svg, heic, pdf) пропускается
const TARGET = {
  'image/jpeg': { format: 'jpg', type: 'image/jpeg', ext: 'jpg' },
  'image/tiff': { format: 'jpg', type: 'image/jpeg', ext: 'jpg' },
  'image/avif': { format: 'jpg', type: 'image/jpeg', ext: 'jpg' },
  // webp keeps transparency a PNG may carry / webp сохраняет прозрачность, которая может быть в PNG
  'image/png': { format: 'webp', type: 'image/webp', ext: 'webp' },
  'image/webp': { format: 'webp', type: 'image/webp', ext: 'webp' },
};

const kb = (bytes) => `${Math.round(bytes / 1024)} КБ`;

export default ({ action }, { services, getSchema, logger }) => {
  const { AssetsService, FilesService } = services;

  action('files.upload', async ({ key }) => {
    const schema = await getSchema();
    // no accountability = administrator: the hook must see and rewrite any file
    // без accountability = администратор: хук должен видеть и переписывать любой файл
    const files = new FilesService({ schema });
    const assets = new AssetsService({ schema });

    let file;
    try {
      file = await files.readOne(key, {
        fields: ['id', 'title', 'type', 'filesize', 'width', 'height', 'filename_download'],
      });
    } catch (error) {
      logger.warn(`optimize-upload: файл ${key} не прочитан — ${error.message}`);
      return;
    }

    const target = TARGET[file.type];
    if (!target || !file.width || !file.height) return;

    const tooBig = file.width > MAX_SIDE || file.height > MAX_SIDE;
    const keepLimit = file.type === 'image/png' ? PNG_KEEP_UNDER : KEEP_UNDER;
    const webFormat = file.type === 'image/jpeg' || file.type === 'image/webp';
    // a web-format photo that fits is fine as it is; a large PNG photo is not
    // фото в веб-формате, которое влезает в порог, оставляем; крупный PNG — нет
    if (!tooBig && Number(file.filesize) <= keepLimit && (webFormat || file.type === 'image/png')) return;

    const name = file.title || file.filename_download || file.id;
    try {
      const { stream } = await assets.getAsset(file.id, {
        transformationParams: {
          width: MAX_SIDE,
          height: MAX_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
          format: target.format,
          quality: QUALITY,
        },
      });
      const base = (file.filename_download || file.id).replace(/\.[^.]+$/, '');
      // emitEvents: false — the rewrite must not fire this hook again
      // emitEvents: false — переписывание не должно снова запускать этот хук
      await files.uploadOne(
        stream,
        { type: target.type, filename_download: `${base}.${target.ext}` },
        file.id,
        { emitEvents: false },
      );
      const after = await files.readOne(file.id, { fields: ['filesize', 'width', 'height'] });
      logger.info(
        `optimize-upload: «${name}» ${file.width}×${file.height} ${kb(file.filesize)} → ` +
          `${after.width}×${after.height} ${kb(after.filesize)} ${target.ext}`,
      );
    } catch (error) {
      // the original stays usable: the site compresses on build anyway
      // оригинал остаётся рабочим: сайт всё равно сжимает на сборке
      logger.warn(`optimize-upload: «${name}» не сжат — ${error.message}`);
    }
  });
};
