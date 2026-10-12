/**
 * Content loader: Directus when DIRECTUS_URL and DIRECTUS_TOKEN are set, the
 * checked-in fixture otherwise. Both paths go through one `normalize`.
 * Загрузчик контента: Directus при заданных `DIRECTUS_URL` и `DIRECTUS_TOKEN`,
 * иначе фикстура из репо. Обе ветки проходят одну `normalize`, поэтому
 * страница не знает, откуда данные.
 */
import type { ImageMetadata } from 'astro';
import { toSchedule, type HoursRow, type Schedule } from '../data/site.ts';
import { BASE } from './base.ts';
import { currentAfisha, livePromos, type Dated } from './select.ts';
import { OPTIONAL, QUERIES, docKind, docTarget } from '../../scripts/queries.mjs';
import { normalizeCatalog, type Catalog, type RawCategory, type RawProduct } from './catalog.ts';
import {
  normalizeCatering,
  type Catering,
  type RawCateringFaq,
  type RawCateringFormat,
  type RawCateringPage,
  type RawCateringStep,
} from './catering.ts';
import fixture from '../data/fixture.json' with { type: 'json' };

/** Файл-заглушка помечен в админке: с этой пометкой сайт не выдаёт его за готовый. */
export const isPlaceholder = (title?: string | null) => Boolean(title?.startsWith('[заглушка]'));

/**
 * Timestamps of a file in Directus. A seed file has both stamps within a few
 * milliseconds; «Заменить файл» moves `uploaded_on` and leaves `created_on`.
 * The fixture carries no stamps, so there the title alone decides.
 * Метки времени файла в Directus. У файла из посева обе метки в паре
 * миллисекунд; «Заменить файл» сдвигает `uploaded_on`, а `created_on` не
 * трогает. В фикстуре меток нет — там решает только заголовок.
 */
type Stamped = { title?: string | null; created_on?: string | null; uploaded_on?: string | null };

const replaced = (file: Stamped) =>
  Boolean(file.created_on && file.uploaded_on) &&
  Date.parse(file.uploaded_on!) - Date.parse(file.created_on!) > 60_000;

/**
 * The mark alone is not enough: the owner replaces the file and never edits the
 * title, so a real photo kept showing as a plaque. A replaced file is real
 * whatever its title says.
 * Одной пометки мало: владелица заменяет файл, а заголовок не правит, и
 * настоящее фото продолжало стоять плашкой. Заменённый файл настоящий, что бы
 * ни было в заголовке.
 */
export const placeholderFile = (file: Stamped) => isPlaceholder(file.title) && !replaced(file);

/** Заголовок файла без пометки — им подписывается кадр, у которого alt не заполнен. */
const cleanTitle = (title?: string | null) => (title ?? '').replace(/^\[заглушка\]\s*/, '').trim();

/**
 * The seed alt says «фото появится позже»; after a replacement it lies under a
 * real photo and used to hide it. Such an alt, or an empty one, gives way to
 * the file title; the build fails only when both are empty.
 * Alt из посева гласит «фото появится позже»; после замены он врёт под
 * настоящим фото и раньше скрывал его. Такой alt, как и пустой, уступает
 * заголовку файла; сборка падает, только если пусто и там.
 */
const altOf = (file: RawFile, placeholder: boolean) => {
  const alt = file.alt?.trim() ?? '';
  // «[заглушка] …», «Фото афиши (заглушка)», «… — фото появится позже»: any seed wording
  // «[заглушка] …», «Фото афиши (заглушка)», «… — фото появится позже»: любая формулировка посева
  const stale = !placeholder && /заглушк|появится позже/i.test(alt);
  return alt && !stale ? alt : cleanTitle(file.title);
};

/**
 * A dash never starts a line: the space before it becomes non-breaking. Russian
 * typography allows a leading dash only in dialogue, and headings wrapped right
 * on it. Applied on render, so text typed in Directus is covered too.
 * Тире не начинает строку: пробел перед ним делается неразрывным. В русской
 * типографике тире с начала строки допустимо только в прямой речи, а заголовки
 * переносились ровно по нему. Применяется на выводе — значит, действует и на
 * текст, набранный в админке.
 */
export const typo = (text: string) => text.replace(/ ([\u2014\u2013]) /g, '\u00a0$1 ');

/** `placeholder` — файл помечен в админке как заглушка: страница обязана сказать об этом. */
export type Img = {
  src: ImageMetadata | string;
  width: number;
  height: number;
  alt: string;
  placeholder: boolean;
};
/**
 * A document in `public/media/`: a menu, the policy, the offer. `kind` is what
 * the link may promise — the owner uploads a picture of the menu as readily as a PDF.
 * Документ в `public/media/`: меню, политика, оферта. `kind` — что вправе
 * обещать ссылка: владелица кладёт картинку меню так же охотно, как PDF.
 */
export type Doc = { href: string; title: string; placeholder: boolean; kind: 'pdf' | 'image' | 'file' };

export type Settings = {
  phone: string;
  phoneHref: string;
  telegram: string;
  max: string;
  vk?: string;
  // the app and the old shop: the fields stay in the admin, the site prints none of them
  // приложение и старый магазин: поля остаются в админке, сайт их не выводит
  shop_url?: string | null;
  app_ios?: string | null;
  app_android?: string | null;
  // the old catering site: the fields stay in the admin, the site links to its
  // own `/catering/` now and prints neither
  // старый сайт кейтеринга: поля остаются в админке, сайт ведёт на свой
  // `/catering/` и не выводит ни одного из них
  catering_url?: string | null;
  catering_services_url?: string | null;
  shop_cakes_ready?: string | null;
  shop_cakes_custom?: string | null;
  shop_pastry?: string | null;
  shop_breakfasts?: string | null;
  legal_name?: string;
  inn?: string;
  ogrn?: string;
  legal_address?: string;
  policy?: Doc;
  offer?: Doc;
  yandex_score?: string;
  yandex_award?: string;
  yandex_ratings?: number;
  yandex_reviews?: number;
  yandex_highlights: { label: string; percent: number }[];
  metrika_id?: string;
};

export type Home = {
  hero_image: Img;
  hero_title: string;
  hero_text?: string;
  seo_title: string;
  seo_description: string;
  og_image?: Img;
  robots_index: boolean;
  about_title?: string;
  about_text?: string;
  menu_text?: string;
  cakes_title?: string;
  cakes_text?: string;
  // the old «app and shop» strip; kept in the admin, not printed
  // бывшая полоса «приложение и магазин»; в админке остаются, не выводятся
  delivery_title?: string;
  delivery_text?: string;
  delivery_note?: string;
  app_screenshot?: Img;
  contacts_note?: string;
};

/** Кадр галереи: фото и необязательная подпись из строки связки. */
export type Shot = { image: Img; caption?: string };

export type Place = {
  id: number;
  /** порядковый номер точки строкой — им подписаны метки на карте */
  n: string;
  name: string;
  street: string;
  kind: string;
  /** телефон точки; пустой в админке — общий из `settings` */
  phone: string;
  phoneHref: string;
  schedule: Schedule;
  lat: number;
  lng: number;
  yandex_org: string;
  rating?: string;
  gallery: Shot[];
};

export type Direction = {
  id: number;
  key: 'cafe' | 'restaurant' | 'confectionery' | 'catering' | 'banquets';
  title: string;
  text: string;
  photo?: Img;
  place?: Place;
  /**
   * Shots of the direction itself (catering boxes, a banquet table) for the
   * shared «Фотогалерея»; they follow the venues' shots. Empty when none.
   * Кадры самого направления (боксы кейтеринга, банкетный стол) для общей
   * «Фотогалереи»; идут после кадров точек. Пусто, если их нет.
   */
  gallery: Shot[];
};

// Only the title is required: an announcement («новое меню») may have no date,
// no venue and even no poster — the editor fills in what the event has.
// Обязателен только заголовок: у анонса («новое меню») может не быть ни даты,
// ни адреса, ни постера — редактор заполняет то, что у события есть.
export type Afisha = {
  id: number;
  title: string;
  poster?: Img;
  date?: string;
  time?: string;
  place?: Place;
  text?: string;
  link?: string;
};

export type Promo = {
  id: number;
  title: string;
  text: string;
  place?: Place;
};

/** `status` остаётся в типе: по нему `menuFor` выбирает свежее меню направления. */
export type Menu = {
  id: number;
  status: string;
  direction: number;
  title: string;
  file: Doc;
  updated: string;
};

export type Cake = { id: number; title: string; note?: string; photo: Img };

export type Content = {
  settings: Settings;
  home: Home;
  places: Place[];
  directions: Direction[];
  afisha: Afisha | null;
  promos: Promo[];
  menus: Menu[];
  cakes: Cake[];
  /** каталог доставки; пустой, если в админке его нет или он не заполнен */
  catalog: Catalog;
  /** кейтеринг и банкеты (`/catering/`); пустой, если в админке раздела нет */
  catering: Catering;
  /** сегодня в часовом поясе точек — от него считаются окна показа */
  today: string;
};

type RawFile = Stamped & {
  id: string;
  filename_download: string;
  title?: string;
  alt?: string;
  width?: number;
  height?: number;
};

// Raw types are the public ones minus what normalization computes. The JSON has
// `null` where these say `undefined`; both render as nothing, so it stays as is.
// Сырые типы — публичные минус то, что считает нормализация. В JSON на месте
// `undefined` приходит `null`: рисуются они одинаково, поэтому так и оставлено.
type RawSettings = Omit<Settings, 'phoneHref' | 'policy' | 'offer' | 'yandex_highlights'> & {
  yandex_highlights?: Settings['yandex_highlights'];
  policy_file?: RawFile;
  offer_file?: RawFile;
};
type RawHome = Omit<Home, 'hero_image' | 'og_image' | 'app_screenshot'> & {
  hero_image: RawFile;
  og_image?: RawFile;
  app_screenshot?: RawFile;
};
/** Строка связки `places_files` / `directions_files`: файл с порядком и подписью. */
type RawShot = { sort?: number; caption?: string; directus_files_id: RawFile | null };
type RawPlace = Omit<Place, 'n' | 'schedule' | 'gallery' | 'phone' | 'phoneHref'> & {
  phone?: string | null;
  hours: HoursRow[];
  gallery?: RawShot[];
};
// `gallery` is optional: the fixture and a Directus without the field have none
// `gallery` необязательна: в фикстуре и в Directus без этого поля её нет
type RawDirection = Omit<Direction, 'photo' | 'place' | 'gallery'> & {
  photo?: RawFile;
  place?: number;
  gallery?: RawShot[];
};
type RawAfisha = Omit<Afisha, 'poster' | 'place'> & Dated & { poster?: RawFile; place?: number };
type RawPromo = Omit<Promo, 'place'> & Dated & { place?: number; sort?: number };
type RawMenu = Omit<Menu, 'file'> & { file: RawFile };
type RawCake = Omit<Cake, 'photo'> & { status: string; photo: RawFile; sort?: number };

/** Ответ Directus до нормализации: тот же вид имеет `src/data/fixture.json`. */
export type Raw = {
  settings: RawSettings;
  home: RawHome;
  places: RawPlace[];
  directions: RawDirection[];
  afisha: RawAfisha[];
  promos: RawPromo[];
  menus: RawMenu[];
  cakes: RawCake[];
  // optional: an older fixture and a Directus without the catalog have neither
  // необязательны: в старой фикстуре и в Directus без каталога их нет
  product_categories?: RawCategory[] | null;
  products?: RawProduct[] | null;
  // optional too: a Directus without the catering collections gives an empty section
  // тоже необязательны: Directus без коллекций кейтеринга даёт пустой раздел
  catering_page?: RawCateringPage | RawCateringPage[] | null;
  catering_formats?: RawCateringFormat[] | null;
  catering_steps?: RawCateringStep[] | null;
  catering_faq?: RawCateringFaq[] | null;
};

/** Файл Directus → то, что кладётся в `Img.src`. */
export type ResolveImage = (file: RawFile) => ImageMetadata | string;

const ext = (file: RawFile) => file.filename_download.split('.').pop()?.toLowerCase() ?? '';

const need = <T>(value: T | null | undefined, message: string): T => {
  if (value === null || value === undefined) throw new Error(message);
  return value;
};

const telHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

const toImg = (file: RawFile | null | undefined, resolve: ResolveImage): Img | undefined => {
  if (!file) return undefined;
  const name = file.title || file.id;
  const placeholder = placeholderFile(file);
  const alt = altOf(file, placeholder);
  if (!alt) throw new Error(`alt пуст у файла ${name}`);
  if (!file.width || !file.height) throw new Error(`нет размеров у файла ${name}`);
  return { src: resolve(file), width: file.width, height: file.height, alt, placeholder };
};

const toDoc = (file: RawFile | null | undefined): Doc | undefined =>
  file
    ? {
        // BASE, not the root: under a subfolder `/media/...` lands on a 404;
        // the name is the one `fetch-files` saves under
        // BASE вместо корня: в подпапке `/media/...` ведёт в 404; имя — то,
        // под которым файл сохраняет `fetch-files`
        href: `${BASE}media/${docTarget(file).name}`,
        title: file.title || file.filename_download,
        placeholder: placeholderFile(file),
        kind: docKind(file) as Doc['kind'],
      }
    : undefined;

// the day of the replacement in the venues' timezone: the manual date under a
// freshly uploaded menu would say «обновлено 1 сентября» for a September 29 file
// день замены в поясе точек: ручная дата под свежим меню говорила бы
// «обновлено 1 сентября» про файл от 29 сентября
const samaraDay = (iso: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Samara' }).format(new Date(iso));
const menuUpdated = (menu: RawMenu) =>
  replaced(menu.file) && menu.file.uploaded_on! > `${menu.updated}T00:00:00.000Z`
    ? samaraDay(menu.file.uploaded_on!)
    : menu.updated;

// toSchedule knows the days but not the venue; the venue name is added here
// toSchedule знает про дни, но не про точку — имя точки подставляется здесь
const scheduleOf = (place: RawPlace): Schedule => {
  try {
    return toSchedule(place.hours);
  } catch (error) {
    throw new Error(`places «${place.name}» — ${(error as Error).message}`);
  }
};

// today in the venues' timezone, not the build server's; 'sv-SE' gives YYYY-MM-DD
// сегодня в часовом поясе точек, а не сервера сборки; 'sv-SE' даёт YYYY-MM-DD
const samaraToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Samara' }).format(new Date());

/**
 * The site no longer sends anyone to the app or to the old delivery shop: the
 * catalog on the site is the shop now. Texts written for the app still sit in
 * the admin, so they are cleaned on the way in: a sentence about the app is
 * dropped, an offer that only works in the app is not shown at all (without
 * the app its condition would promise a discount the site does not give).
 * Сайт больше не отправляет ни в приложение, ни в старый магазин доставки:
 * магазин теперь — каталог на сайте. Тексты, написанные под приложение, ещё
 * лежат в админке, поэтому чистятся на входе: предложение про приложение
 * выпадает, акция, которая действует только в приложении, не показывается
 * вовсе (без приложения её условие обещало бы скидку, которой на сайте нет).
 */
const APP = /приложени|app\s?store|google\s?play|apps\.apple|play\.google|vkusdostavka/i;
export const mentionsApp = (text: string | null | undefined) => Boolean(text && APP.test(text));
export const withoutApp = (text: string | undefined) => {
  if (!text || !APP.test(text)) return text;
  const kept = text
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => !APP.test(sentence))
    .join(' ')
    .trim();
  return kept || undefined;
};
const homeWithoutApp = (home: RawHome): RawHome =>
  Object.fromEntries(
    Object.entries(home).map(([key, value]) => [key, typeof value === 'string' ? withoutApp(value) : value]),
  ) as RawHome;

/** Сырой ответ → то, чем пользуются компоненты. Пустое нужное поле валит сборку. */
export const normalize = (raw: Raw, resolveImage: ResolveImage, today = samaraToday(), log = warn): Content => {
  const img = (file: RawFile | null | undefined) => toImg(file, resolveImage);
  // one rule for venue and direction galleries; `where` names the record in the error
  // одно правило для галерей точек и направлений; `where` называет запись в ошибке
  // a row whose file was deleted in the library keeps `directus_files_id: null`:
  // it is skipped, not fatal — one removed photo must not take the site down
  // строка, чей файл удалили из библиотеки, остаётся с `directus_files_id: null`:
  // она пропускается, а не валит сборку — одно удалённое фото не должно класть сайт
  const shots = (rows: RawShot[] | null | undefined, where: string): Shot[] =>
    (rows ?? [])
      .filter((row) => row.directus_files_id)
      .map((row) => ({
        image: need(img(row.directus_files_id), `${where}: пустое фото в галерее`),
        caption: row.caption,
      }));

  const mainPhone = need(raw.settings.phone, 'settings.phone: не заполнен телефон');
  const places: Place[] = raw.places.map((place, i) => {
    // a venue without its own number answers on the main one
    // точка без своего номера отвечает по общему
    const phone = place.phone?.trim() || mainPhone;
    return {
      ...place,
      n: String(i + 1),
      phone,
      phoneHref: telHref(phone),
      schedule: scheduleOf(place),
      gallery: shots(place.gallery, `places «${place.name}»`),
    };
  });
  const byId = new Map(places.map((place) => [place.id, place]));
  const at = (id: number | undefined, where: string) =>
    id ? need(byId.get(id), `${where}: адреса ${id} нет в places`) : undefined;

  const settings: Settings = {
    ...raw.settings,
    phoneHref: telHref(mainPhone),
    policy: toDoc(raw.settings.policy_file),
    offer: toDoc(raw.settings.offer_file),
    yandex_highlights: raw.settings.yandex_highlights ?? [],
  };

  const home: Home = {
    ...homeWithoutApp(raw.home),
    hero_image: need(img(raw.home.hero_image), 'home.hero_image: нет фото первого экрана'),
    og_image: img(raw.home.og_image),
    app_screenshot: img(raw.home.app_screenshot),
  };

  const current = currentAfisha(raw.afisha, today);
  const directions: Direction[] = raw.directions.map((direction) => ({
    ...direction,
    photo: img(direction.photo),
    place: at(direction.place, `directions «${direction.title}»`),
    gallery: shots(direction.gallery, `directions «${direction.title}»`),
  }));

  return {
    settings,
    home,
    places,
    directions,
    afisha: current && {
      ...current,
      poster: img(current.poster),
      place: at(current.place, `афиша «${current.title}»`),
    },
    promos: livePromos(raw.promos, today)
      .filter((promo) => {
        if (!mentionsApp(promo.title) && !mentionsApp(promo.text)) return true;
        log(`контент: акция «${promo.title}» действует в приложении — на сайте не показана`);
        return false;
      })
      .map((promo) => ({
        ...promo,
        place: at(promo.place, `акция «${promo.title}»`),
      })),
    menus: raw.menus.map((menu) => ({
      ...menu,
      updated: menuUpdated(menu),
      file: need(toDoc(menu.file), `меню «${menu.title}»: не приложен файл`),
    })),
    cakes: raw.cakes
      .filter((cake) => cake.status === 'published')
      .map((cake) => ({ ...cake, photo: need(img(cake.photo), `торт «${cake.title}»: нет фото`) })),
    catalog: normalizeCatalog(raw.product_categories, raw.products, (file, alt) => catalogImg(file, alt, resolveImage), warn),
    // the catering page is strict about its photos like the rest of the page
    // (alt, dimensions); the shots of the catering and banquet directions
    // follow its own in the strip
    // страница кейтеринга строга к своим фото, как и вся страница (alt,
    // размеры); кадры направлений «Кейтеринг» и «Банкеты» идут в ленте за её
    // собственными
    catering: normalizeCatering(
      {
        page: raw.catering_page,
        formats: raw.catering_formats,
        steps: raw.catering_steps,
        faq: raw.catering_faq,
        directions: directions
          .filter((direction) => direction.key === 'catering' || direction.key === 'banquets')
          .map((direction) => ({ title: direction.title, gallery: direction.gallery })),
      },
      (file) => img(file as unknown as RawFile | null),
      log,
    ),
    today,
  };
};

/**
 * A dish photo is lenient where the rest of the page is strict: without alt the
 * dish name describes it, without dimensions the card shows a plate. One bad
 * file in a hundred and fifty must not cost the site its build.
 * Фото блюда снисходительнее остальных кадров страницы: без alt его описывает
 * название блюда, без размеров карточка встаёт плашкой. Один плохой файл из
 * полутора сотен не должен стоить сайту сборки.
 */
const catalogImg = (file: Record<string, unknown>, alt: string, resolve: ResolveImage): Img | undefined => {
  const raw = file as RawFile;
  if (!raw.id || !raw.filename_download || !raw.width || !raw.height) return undefined;
  const placeholder = placeholderFile(raw);
  return { src: resolve(raw), width: raw.width, height: raw.height, alt: altOf(raw, placeholder) || alt, placeholder };
};

// warnings of the build go to the log, not to the page
// предупреждения сборки идут в лог, а не на страницу
const warn = (message: string) => console.warn(message);

// Astro exposes .env as import.meta.env, plain Node (checks) has only process.env;
// keys are static because Vite rejects dynamic `import.meta.env[key]` in dev
// Astro отдаёт .env через import.meta.env, голый Node (проверки) — только process.env;
// ключи статические: динамический `import.meta.env[key]` Vite в dev не пропускает
const env = {
  url: import.meta.env?.DIRECTUS_URL || process.env.DIRECTUS_URL,
  token: import.meta.env?.DIRECTUS_TOKEN || process.env.DIRECTUS_TOKEN,
};

// Vite inlines the glob at build time; plain Node has no `import.meta.glob`
// Vite подставляет карту файлов при сборке; в голом Node `glob` нет
let fixtureImages: Record<string, ImageMetadata> | null = null;
const fixtureImage: ResolveImage = (file) => {
  try {
    fixtureImages ??= import.meta.glob('../data/fixture-files/*', {
      eager: true,
      import: 'default',
    }) as Record<string, ImageMetadata>;
  } catch {
    fixtureImages = {};
  }
  const name = `${file.id}.${ext(file)}`;
  return need(
    fixtureImages[`../data/fixture-files/${name}`],
    `нет файла src/data/fixture-files/${name} — запусти pnpm fixture`,
  );
};

// the token stays in the build-time URL; the page only ships optimized copies
// токен живёт только в адресе на сборке, в HTML уходят пережатые копии
const remoteImage =
  (base: string, token: string): ResolveImage =>
  (file) =>
    `${base}/assets/${file.id}?access_token=${token}`;

// Directus answers 503 «Under pressure» when its event loop lags — a busy
// moment on a 2-vCPU server (an import, a burst of saves). It passes in a
// second or two, so the build waits instead of failing the release.
// Directus отвечает 503 «Under pressure», когда у него отстаёт цикл событий —
// загруженная минута на сервере в 2 ядра (импорт, пачка сохранений). Это
// проходит за секунду-другую, поэтому сборка ждёт, а не роняет релиз.
const fetchPatient = async (url: string, init: RequestInit, tries = 4): Promise<Response> => {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, init);
    if (response.status !== 503 || attempt >= tries) return response;
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
  }
};

const fromDirectus = async (base: string, token: string): Promise<Raw> => {
  const entries = await Promise.all(
    Object.entries(QUERIES).map(async ([key, path]) => {
      const response = await fetchPatient(base + path, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        // the catalog and catering are additions, not the site: a schema not yet
        // applied or a builder without the new rights gives an empty section and
        // a loud log line
        // каталог и кейтеринг — дополнения, а не сайт: не применённая схема или
        // сборщик без новых прав дают пустой раздел и громкую строку в логе
        if (OPTIONAL.has(key)) {
          console.warn(`контент: ${key} недоступен (${response.status}) — раздел соберётся пустым`);
          return [key, []] as const;
        }
        throw new Error(`Directus ${path} → ${response.status}: ${await response.text()}`);
      }
      return [key, (await response.json()).data] as const;
    }),
  );
  return Object.fromEntries(entries) as Raw;
};

const load = async (): Promise<Content> => {
  const { url: base, token } = env;
  if (base && token) {
    console.log(`контент: Directus ${base}`);
    return normalize(await fromDirectus(base, token), remoteImage(base, token));
  }
  console.log('контент: фикстура src/data/fixture.json');
  return normalize(fixture as unknown as Raw, fixtureImage);
};

// cached for the whole build: every page and component gets the same content
// кеш на сборку: все страницы и компоненты получают один и тот же контент
let cache: Promise<Content> | null = null;
export const getContent = (): Promise<Content> => (cache ??= load());
