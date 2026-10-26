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

const PRODUCT_FIELDS = 'id,status,sort,category,title,slug,description,composition,weight,price,old_price,variants,fillings,available,badges';

export const QUERIES = {
  settings: `/items/settings?${q(`*,${img('policy_file')},${img('offer_file')}`)}`,
  home: `/items/home?${q(`*,${img('hero_image')},${img('og_image')},${img('app_screenshot')}`)}`,
  places: `/items/places?${q(`*,${gallery}`, '&sort=id&deep[gallery][_sort]=sort')}`,
  directions: `/items/directions?${q(`*,${img('photo')},${gallery}`, '&sort=sort&deep[gallery][_sort]=sort')}`,
  afisha: `/items/afisha?${q(`*,${img('poster')}`, '&sort=date')}`,
  promos: `/items/promos?${q('*', '&sort=sort')}`,
  menus: `/items/menus?${q(`*,${img('file')}`)}`,
  // no `cakes`: the home showcase is the catalog's «Праздничные торты» now; the
  // collection stays in the admin and nothing on the site reads it
  // `cakes` нет: витрина тортов главной теперь — раздел каталога «Праздничные
  // торты»; коллекция остаётся в админке, сайт её не читает
  // the delivery catalog: sections, then dishes with their photo; the manager's
  // orders are not here — the builder token never reads them
  // каталог доставки: разделы, затем блюда с фото; заказов здесь нет — токен
  // сборщика их не читает
  product_categories: `/items/product_categories?${q('id,status,sort,title,slug,description', '&sort=sort,id')}`,
  // `places` — «Готовят на» (since 26.10.2026): the venues that cook the dish
  // `places` — «Готовят на» (с 26.10.2026): точки, где готовят блюдо
  products: `/items/products?${q(`${PRODUCT_FIELDS},places,${img('photo')}`, '&sort=sort,id')}`,
  // catering and banquets: the page singleton with its gallery, the formats,
  // the steps and the questions; the requests are not here — the builder
  // token never reads them
  // кейтеринг и банкеты: синглтон страницы с галереей, форматы, шаги и вопросы;
  // заявок здесь нет — токен сборщика их не читает
  catering_page: `/items/catering_page?${q(
    `*,${img('hero_image')},${img('request_image')},${gallery}`,
    '&deep[gallery][_sort]=sort',
  )}`,
  catering_formats: `/items/catering_formats?${q(
    `id,status,sort,title,slug,summary,description,includes,price_from,price_unit,price_note,guests_from,guests_to,lead_time,${img('photo')}`,
    '&sort=sort,id',
  )}`,
  catering_steps: `/items/catering_steps?${q('id,sort,title,text,contacts', '&sort=sort,id')}`,
  catering_faq: `/items/catering_faq?${q('id,status,sort,topic,question,answer,featured,format', '&sort=sort,id')}`,
  // «Вкусные баллы»: the programme the account page and the cart describe;
  // the guests, their points and the sign-in settings are not here
  // «Вкусные баллы»: программа, которую описывают кабинет и корзина; гостей,
  // их баллов и настроек входа здесь нет
  loyalty_settings: `/items/loyalty_settings?${q('enabled,program_name,signup_bonus,points_ttl_days,max_share_percent,tiers,birthday_bonus,birthday_window_days,birthday_discount_percent')}`,
  // the documents (offer, privacy, delivery, requisites): every status, so the
  // site report can name a draft; the site shows only the published ones
  // документы (оферта, политика, доставка, реквизиты): все статусы, чтобы отчёт
  // сборки назвал черновик; сайт показывает только опубликованные
  pages: `/items/pages?${q('id,status,sort,slug,title,description,body,revised,date_updated', '&sort=sort,id')}`,
};

// What to ask when the main query is refused: a field the site reads but a
// Directus may not have yet. A build after `git pull` and before `schema apply`
// must not lose the whole catalog over «Готовят на» — it gets every dish on
// both venues and a loud log line instead.
// Что спросить, когда основной запрос отклонён: поле, которое сайт читает, а
// Directus может ещё не иметь. Сборка после `git pull` и до `schema apply` не
// должна терять весь каталог из-за «Готовят на» — она получает все блюда на
// обеих точках и громкую строку в логе.
export const FALLBACK = {
  products: `/items/products?${q(`${PRODUCT_FIELDS},${img('photo')}`, '&sort=sort,id')}`,
};

// Collections the site builds without: a missing one means an empty catalog or
// an empty catering section, not a failed build (schema not applied yet,
// builder without the new rights).
// Коллекции, без которых сайт собирается: недоступная — это пустой каталог или
// пустой раздел кейтеринга, а не упавшая сборка (схема ещё не применена, у
// сборщика нет новых прав).
export const OPTIONAL = new Set([
  'product_categories', 'products',
  'catering_page', 'catering_formats', 'catering_steps', 'catering_faq',
  'loyalty_settings', 'pages',
]);
