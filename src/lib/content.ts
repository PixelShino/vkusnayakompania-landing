/**
 * Content loader: Directus when DIRECTUS_URL and DIRECTUS_TOKEN are set, the
 * checked-in fixture otherwise. Both paths go through one `normalize`.
 * Загрузчик контента: Directus при заданных `DIRECTUS_URL` и `DIRECTUS_TOKEN`,
 * иначе фикстура из репо. Обе ветки проходят одну `normalize`, поэтому
 * страница не знает, откуда данные.
 */
import type { ImageMetadata } from 'astro';
import { toSchedule, type HoursRow, type Schedule } from '../data/site.ts';
import { currentAfisha, livePromos, type Dated } from './select.ts';
import { QUERIES } from '../../scripts/queries.mjs';
import fixture from '../data/fixture.json' with { type: 'json' };

/** Картинка для `<Image>`: свой файл или адрес Directus, размеры обязательны. */
/** Файл-заглушка помечен в админке: с этой пометкой сайт не выдаёт его за готовый. */
export const isPlaceholder = (title?: string | null) => Boolean(title?.startsWith('[заглушка]'));

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
/** Документ в `public/media/` — PDF меню, политика, оферта. */
export type Doc = { href: string; title: string; placeholder: boolean };

export type Settings = {
  phone: string;
  phoneHref: string;
  telegram: string;
  max: string;
  vk?: string;
  shop_url: string;
  app_ios: string;
  app_android: string;
  catering_url: string;
  catering_services_url?: string;
  shop_cakes_ready?: string;
  shop_cakes_custom?: string;
  shop_pastry?: string;
  shop_breakfasts?: string;
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
  delivery_title?: string;
  delivery_text?: string;
  delivery_note?: string;
  app_screenshot?: Img;
  contacts_note?: string;
};

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
  gallery: { image: Img; caption?: string }[];
};

export type Direction = {
  id: number;
  key: 'cafe' | 'restaurant' | 'confectionery' | 'catering' | 'banquets';
  title: string;
  text: string;
  photo?: Img;
  place?: Place;
};

export type Afisha = {
  id: number;
  title: string;
  poster: Img;
  date: string;
  time?: string;
  place: Place;
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
  /** сегодня в часовом поясе точек — от него считаются окна показа */
  today: string;
};

type RawFile = {
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
type RawPlace = Omit<Place, 'n' | 'schedule' | 'gallery' | 'phone' | 'phoneHref'> & {
  phone?: string | null;
  hours: HoursRow[];
  gallery?: { sort?: number; caption?: string; directus_files_id: RawFile }[];
};
type RawDirection = Omit<Direction, 'photo' | 'place'> & { photo?: RawFile; place?: number };
type RawAfisha = Omit<Afisha, 'poster' | 'place'> & Dated & { poster: RawFile; place: number };
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
  if (!file.alt?.trim()) throw new Error(`alt пуст у файла ${name}`);
  if (!file.width || !file.height) throw new Error(`нет размеров у файла ${name}`);
  return {
    src: resolve(file),
    width: file.width,
    height: file.height,
    alt: file.alt,
    placeholder: isPlaceholder(file.title),
  };
};

const toDoc = (file: RawFile | null | undefined): Doc | undefined =>
  file
    ? {
        // `BASE_URL` вместо корня: на GitHub Pages сайт живёт в подпапке, и
        // абсолютный `/media/...` там ведёт в 404
        // `BASE_URL`, not the root: on GitHub Pages the site lives in a
        // subfolder and an absolute `/media/...` lands on a 404 there
        href: `${import.meta.env?.BASE_URL ?? '/'}media/${file.id}.${ext(file)}`,
        title: file.title || file.filename_download,
        placeholder: isPlaceholder(file.title),
      }
    : undefined;

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

/** Сырой ответ → то, чем пользуются компоненты. Пустое нужное поле валит сборку. */
export const normalize = (raw: Raw, resolveImage: ResolveImage, today = samaraToday()): Content => {
  const img = (file: RawFile | null | undefined) => toImg(file, resolveImage);

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
      gallery: (place.gallery ?? []).map((row) => ({
        image: need(img(row.directus_files_id), `places «${place.name}»: пустое фото в галерее`),
        caption: row.caption,
      })),
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
    ...raw.home,
    hero_image: need(img(raw.home.hero_image), 'home.hero_image: нет фото первого экрана'),
    og_image: img(raw.home.og_image),
    app_screenshot: img(raw.home.app_screenshot),
  };

  const current = currentAfisha(raw.afisha, today);

  return {
    settings,
    home,
    places,
    directions: raw.directions.map((direction) => ({
      ...direction,
      photo: img(direction.photo),
      place: at(direction.place, `directions «${direction.title}»`),
    })),
    afisha: current && {
      ...current,
      poster: need(img(current.poster), `афиша «${current.title}»: нет постера`),
      place: need(
        at(current.place, `афиша «${current.title}»`),
        `афиша «${current.title}»: не выбран адрес`,
      ),
    },
    promos: livePromos(raw.promos, today).map((promo) => ({
      ...promo,
      place: at(promo.place, `акция «${promo.title}»`),
    })),
    menus: raw.menus.map((menu) => ({
      ...menu,
      file: need(toDoc(menu.file), `меню «${menu.title}»: не приложен файл`),
    })),
    cakes: raw.cakes
      .filter((cake) => cake.status === 'published')
      .map((cake) => ({ ...cake, photo: need(img(cake.photo), `торт «${cake.title}»: нет фото`) })),
    today,
  };
};

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

const fromDirectus = async (base: string, token: string): Promise<Raw> => {
  const entries = await Promise.all(
    Object.entries(QUERIES).map(async ([key, path]) => {
      const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok)
        throw new Error(`Directus ${path} → ${response.status}: ${await response.text()}`);
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
