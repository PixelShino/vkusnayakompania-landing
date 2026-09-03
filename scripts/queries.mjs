// Directus REST queries: one request per collection, relations expanded to the
// fields the site reads. Shared by the loader and the scripts, so a schema
// change is edited once.
// Запросы к Directus: по одному на коллекцию, связи раскрыты до полей, которые
// читает сайт. Общие для загрузчика и скриптов — правка схемы в одном месте.

// fields that describe a file
// поля, описывающие файл
export const FILE_FIELDS = ['id', 'filename_download', 'title', 'alt', 'width', 'height', 'type'];

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
