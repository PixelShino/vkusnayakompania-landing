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

// a gallery is a junction row (sort, caption) around a file; `deep` keeps the
// owner's drag order, otherwise rows come back in insertion order
// галерея — строка связки (порядок, подпись) вокруг файла; `deep` сохраняет
// порядок, выставленный перетаскиванием, иначе строки идут в порядке вставки
const gallery = `gallery.id,gallery.sort,gallery.caption,${img('gallery.directus_files_id')}`;

export const QUERIES = {
  settings: `/items/settings?${q(`*,${img('policy_file')},${img('offer_file')}`)}`,
  home: `/items/home?${q(`*,${img('hero_image')},${img('og_image')},${img('app_screenshot')}`)}`,
  places: `/items/places?${q(`*,${gallery}`, '&sort=id&deep[gallery][_sort]=sort')}`,
  directions: `/items/directions?${q(`*,${img('photo')},${gallery}`, '&sort=sort&deep[gallery][_sort]=sort')}`,
  afisha: `/items/afisha?${q(`*,${img('poster')}`, '&sort=date')}`,
  promos: `/items/promos?${q('*', '&sort=sort')}`,
  menus: `/items/menus?${q(`*,${img('file')}`)}`,
  cakes: `/items/cakes?${q(`*,${img('photo')}`, '&sort=sort')}`,
  // the delivery catalog: sections, then dishes with their photo; the manager's
  // orders are not here — the builder token never reads them
  // каталог доставки: разделы, затем блюда с фото; заказов здесь нет — токен
  // сборщика их не читает
  product_categories: `/items/product_categories?${q('id,status,sort,title,slug,description', '&sort=sort,id')}`,
  products: `/items/products?${q(
    `id,status,sort,category,title,slug,description,composition,weight,price,old_price,variants,fillings,available,badges,${img('photo')}`,
    '&sort=sort,id',
  )}`,
};

// Collections the site builds without: a missing one means an empty catalog,
// not a failed build (schema not applied yet, builder without the new rights).
// Коллекции, без которых сайт собирается: недоступная — это пустой каталог, а
// не упавшая сборка (схема ещё не применена, у сборщика нет новых прав).
export const OPTIONAL = new Set(['product_categories', 'products']);
