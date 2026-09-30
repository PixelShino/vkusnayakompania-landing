// Directus REST queries: one request per collection, relations expanded to the
// fields the site reads. Shared by the loader and the scripts, so a schema
// change is edited once.
// Запросы к Directus: по одному на коллекцию, связи раскрыты до полей, которые
// читает сайт. Общие для загрузчика и скриптов — правка схемы в одном месте.

// fields that describe a file
// поля, описывающие файл
// created_on and uploaded_on together tell a replaced file from a seed one
// created_on и uploaded_on вместе отличают заменённый файл от посевного
export const FILE_FIELDS = [
  'id', 'filename_download', 'title', 'alt', 'width', 'height', 'type', 'created_on', 'uploaded_on',
];

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'heic']);
export const fileExt = (file) => file.filename_download.split('.').pop()?.toLowerCase() ?? '';
/** pdf, image or file: what a document link may promise / что вправе обещать ссылка на документ */
export const docKind = (file) =>
  fileExt(file) === 'pdf' ? 'pdf' : IMAGE_EXT.has(fileExt(file)) ? 'image' : 'file';

/**
 * Where a document lands in `public/media/` and what to fetch for it. A menu
 * uploaded as a picture (a 7 MB print-ready PNG) is served as a 2500 px webp
 * made by Directus; a PDF and everything else is copied as is. One rule for the
 * page link, the fetch step and the fixture export.
 * Куда ложится документ в `public/media/` и что для него скачивать. Меню,
 * загруженное картинкой (печатный PNG на 7 МБ), отдаётся webp 2500 px, который
 * делает Directus; PDF и прочее копируется как есть. Одно правило для ссылки на
 * странице, шага скачивания и выгрузки фикстуры.
 */
export const docTarget = (file) =>
  docKind(file) === 'image'
    ? { name: `${file.id}.webp`, asset: `/assets/${file.id}?format=webp&width=2500&quality=85` }
    : { name: `${file.id}.${fileExt(file)}`, asset: `/assets/${file.id}` };

const img = (f) => FILE_FIELDS.map((x) => `${f}.${x}`).join(',');
const q = (fields, extra = '') => `fields=${fields}&limit=-1${extra}`;

export const QUERIES = {
  settings: `/items/settings?${q(`*,${img('policy_file')},${img('offer_file')}`)}`,
  home: `/items/home?${q(`*,${img('hero_image')},${img('og_image')},${img('app_screenshot')}`)}`,
  places: `/items/places?${q(`*,gallery.id,gallery.sort,gallery.caption,${img('gallery.directus_files_id')}`, '&sort=id&deep[gallery][_sort]=sort')}`,
  directions: `/items/directions?${q(`*,${img('photo')}`, '&sort=sort')}`,
  afisha: `/items/afisha?${q(`*,${img('poster')}`, '&sort=date')}`,
  promos: `/items/promos?${q('*', '&sort=sort')}`,
  menus: `/items/menus?${q(`*,${img('file')}`)}`,
  cakes: `/items/cakes?${q(`*,${img('photo')}`, '&sort=sort')}`,
};
