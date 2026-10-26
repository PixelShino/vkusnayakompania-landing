/**
 * Text for language models: `/llms.txt` (a map of the site in the llmstxt.org
 * format) and `/llms-full.txt` (the same with the whole content — the delivery
 * catalog, the catering formats and questions, the documents as plain text).
 * Everything comes from the same content the pages are built from: the
 * venues, their hours and phones, the prices, the requisites — nothing is
 * typed here, so the file never says what the site does not. Pure: no I/O in
 * `buildLlms`, so `llms.check.ts` runs it on the fixture; only `loadZones`
 * reads Directus, the way `content.ts` does.
 * Текст для языковых моделей: `/llms.txt` (карта сайта в формате llmstxt.org)
 * и `/llms-full.txt` (то же с полным содержимым: каталог доставки, форматы и
 * вопросы кейтеринга, документы простым текстом). Всё берётся из того же
 * контента, из которого собираются страницы: точки, часы и телефоны, цены,
 * реквизиты — здесь ничего не набрано руками, поэтому файл не скажет того,
 * чего не говорит сайт. `buildLlms` чистая, без сети и файлов — `llms.check.ts`
 * гоняет её на фикстуре; Directus читает только `loadZones`, как `content.ts`.
 */
import type { Content, Place } from './content.ts';
import type { CatalogCategory, Product } from './catalog.ts';
import type { CateringFormat } from './catering.ts';
import type { DocBlock, DocPage } from './pages.ts';
import { rub } from './catalog.ts';
import { priceLine } from './catering.ts';
import { chatLinks, isChatLink } from './contact-links.ts';
import { longDate } from './pages.ts';
import { DEFAULT_TEXTS } from './payment.ts';
import { menusFor } from './select.ts';
import { BRAND, hoursRows, plural, yandexOrgUrl } from '../data/site.ts';
import { cakeShowcase } from '../data/landings-shop.ts';
import seedZones from '../data/delivery-zones.json' with { type: 'json' };

/** Зона доставки так, как её печатает текст: без полигона. */
export type LlmsZone = { name: string; price: number; freeFrom: number | null; minOrder: number };

export type LlmsOptions = {
  /** `true` — `/llms-full.txt`: каталог, кейтеринг, вопросы и документы целиком */
  full?: boolean;
  /** действующие зоны доставки; пусто — раздел говорит только о каталоге и документе */
  zones?: LlmsZone[];
};

// ── text helpers / помощники текста ─────────────────────────────────────────

/** Строка из админки одной строкой: неразрывные пробелы и переносы — обычный пробел. */
const line = (value: string | null | undefined) =>
  String(value ?? '')
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Абзацы по пустой строке, внутри абзаца — одна строка. */
const paragraphs = (value: string | null | undefined) =>
  String(value ?? '')
    .split(/\n\s*\n/)
    .map(line)
    .filter(Boolean);

/** Части предложения через разделитель; пустые выпадают. */
const join = (parts: (string | null | undefined | false)[], sep = ', ') =>
  parts.map((part) => (part ? line(part) : '')).filter(Boolean).join(sep);

/** Предложения: у каждого точка в конце, если её не было. */
const sentences = (parts: (string | null | undefined | false)[]) =>
  parts
    .map((part) => (part ? line(part) : ''))
    .filter(Boolean)
    .map((part) => (/[.!?…:]$/.test(part) ? part : `${part}.`))
    .join(' ');

/** Квадратные скобки в тексте ссылки ломают разметку: меняются на круглые. */
const label = (text: string) => line(text).replace(/\[/g, '(').replace(/\]/g, ')');
const link = (text: string, href: string) => `[${label(text)}](${href})`;
/** Элемент списка llms.txt: `- [имя](адрес): пояснение`. */
const item = (text: string, href: string, note?: string | null) =>
  `- ${link(text, href)}${note && line(note) ? `: ${line(note)}` : ''}`;

const lower = (text: string) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : text);
const NUMBER_WORDS = ['', 'Одна', 'Две', 'Три', 'Четыре', 'Пять'];
const count = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`;

/** «пн–пт 8:00–21:00, сб 8:30–21:00, вс 9:00–21:00», «ежедневно 9:00–22:30». */
const hoursText = (place: Place) =>
  hoursRows(place.schedule)
    .map((row) => `${lower(row.days)} ${row.hours.replace(/\s*—\s*/, '–')}`)
    .join(', ');

/** 15 цифр — номер ИП, иначе ОГРН; так же подписывает реквизиты страница документа. */
const ogrnLabel = (ogrn: string) => (ogrn.replace(/\D/g, '').length === 15 ? 'ОГРНИП' : 'ОГРН');

const DIRECTION_WORD: Partial<Record<string, string>> = { cafe: 'кафе', restaurant: 'ресторан', confectionery: 'кондитерская' };

// ── HTML of a document → plain text / HTML документа → простой текст ──────

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“',
  rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–', hellip: '…', minus: '−', shy: '', thinsp: ' ',
  ensp: ' ', emsp: ' ', times: '×', deg: '°', numero: '№', copy: '©', reg: '®', middot: '·', bull: '•',
};
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[name.toLowerCase()] ?? all;
  });

const attr = (attrs: string, name: string) =>
  attrs.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((v) => v !== undefined);

/**
 * The editor's rich text (already cleaned by `pages.ts`) → plain text: a
 * paragraph is a paragraph, a heading is a Markdown heading `level` deep, a
 * list item is `- ` or `1. `, a table row is `cell | cell`, a link keeps its
 * words and gets an absolute address. Tags and entities do not survive.
 * Текст редактора (уже очищенный `pages.ts`) → простой текст: абзац остаётся
 * абзацем, заголовок — заголовком Markdown глубины `level`, пункт списка —
 * `- ` или `1. `, строка таблицы — `ячейка | ячейка`, ссылка сохраняет слова и
 * получает абсолютный адрес. Теги и сущности не доживают до текста.
 */
export const htmlToText = (html: string, level: number, href: (value: string) => string | undefined) => {
  // a list or a table is a group: its lines go one under another, groups stand apart
  // список или таблица — группа: их строки идут подряд, группы разделены пустой строкой
  type Block = { text: string; tight: boolean; group: number };
  const blocks: Block[] = [];
  const lists: { ordered: boolean; n: number }[] = [];
  let current = '';
  let tight = false;
  let heading = 0;
  let inItem = 0;
  let anchor: { href?: string; start: number } | null = null;
  let row: string[] | null = null;
  let group = 0;

  const flush = () => {
    const text = current
      .split('\n')
      .map(line)
      .filter(Boolean)
      .join('\n');
    // a bare marker («- », «1. ») of an empty item is not a line
    // одинокий маркер («- », «1. ») пустого пункта — не строка
    if (text && !/^(?:-|\d+\.)$/.test(text)) blocks.push({ text, tight, group });
    current = '';
    tight = false;
  };
  const glue = () => {
    // a line break inside a list item or a heading joins its two halves
    // перенос внутри пункта или заголовка соединяет две половины
    const before = current.trimEnd();
    current = /[.,:;!?…—–-]$/.test(before) || !before ? `${before} ` : `${before}: `;
  };

  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const token of source.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)/gi)) {
    const [, close, rawTag, attrs = '', text] = token;
    if (text !== undefined) {
      current += decode(text).replace(/\s+/g, ' ');
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (tag === 'br') {
      if (inItem || heading || row) glue();
      else current += '\n';
    } else if (/^h[1-6]$/.test(tag)) {
      if (!close) {
        flush();
        heading = Number(tag[1]);
      } else {
        const title = line(current);
        current = '';
        // h1 is a section like h2 (the page has its own title); deeper ones go one level down each
        // h1 — такой же раздел, как h2 (у страницы свой заголовок); глубже — на уровень вниз
        if (title) blocks.push({ text: `${'#'.repeat(Math.min(6, level + Math.max(0, heading - 2)))} ${title}`, tight: false, group });
        heading = 0;
      }
    } else if (tag === 'ul' || tag === 'ol') {
      flush();
      if (!close) lists.push({ ordered: tag === 'ol', n: 0 });
      else lists.pop();
      // a nested list stays in its parent's group
      // вложенный список остаётся в группе родителя
      if (!lists.length || (!close && lists.length === 1)) group += 1;
    } else if (tag === 'li') {
      flush();
      if (!close) {
        const list = lists.at(-1);
        const indent = '  '.repeat(Math.max(0, lists.length - 1));
        current = `${indent}${list?.ordered ? `${(list.n += 1)}.` : '-'} `;
        inItem += 1;
      } else inItem = Math.max(0, inItem - 1);
      tight = true;
    } else if (tag === 'tr') {
      if (!close) {
        flush();
        row = [];
      } else if (row) {
        const cells = row.filter(Boolean);
        if (cells.length) blocks.push({ text: cells.join(' | '), tight: true, group });
        row = null;
        current = '';
      }
    } else if (tag === 'td' || tag === 'th') {
      if (!close) current = '';
      else if (row) {
        row.push(line(current));
        current = '';
      }
    } else if (tag === 'a') {
      if (!close) anchor = { href: attr(attrs, 'href'), start: current.length };
      else if (anchor) {
        const words = line(current.slice(anchor.start));
        const target = anchor.href ? href(anchor.href) : undefined;
        // a link whose words already are its address stays as words
        // ссылка, чьи слова — уже её адрес, остаётся словами
        const same = target && words && target.replace(/^https?:\/\//, '').replace(/\/$/, '') === words.replace(/^https?:\/\//, '').replace(/\/$/, '');
        if (words && target && !same) current = `${current.slice(0, anchor.start)}${link(words, target)}`;
        anchor = null;
      }
    } else if (tag === 'table') {
      flush();
      group += 1;
    } else if (/^(p|div|blockquote|section|article|header|footer|figure|figcaption|pre|thead|tbody|dl|hr)$/.test(tag)) {
      if (inItem) current += ' ';
      else if (!row) flush();
    } else if (tag === 'dt' || tag === 'dd') {
      if (close) {
        if (tag === 'dt') glue();
        else flush();
      }
    }
    // inline tags (strong, em, span, b, i, sup…) leave only their words
    // строчные теги (strong, em, span, b, i, sup…) оставляют только слова
  }
  flush();

  return blocks.reduce((text, block, i) => {
    if (i === 0) return block.text;
    const previous = blocks[i - 1];
    return `${text}${block.tight && previous.tight && block.group === previous.group ? '\n' : '\n\n'}${block.text}`;
  }, '');
};

// ── delivery zones / зоны доставки ──────────────────────────────────────────

const money = (value: unknown) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/**
 * Rows of `delivery_zones` (or of `GET /delivery/zones`) → the zones in force,
 * the way the cart counts them: published, with a name and a price; a row with
 * a polygon field needs a real polygon. An empty «бесплатно от» is «never
 * free», an empty minimum is none.
 * Строки `delivery_zones` (или `GET /delivery/zones`) → действующие зоны так,
 * как их считает корзина: опубликованные, с именем и ценой; у строки с полем
 * полигона нужен настоящий полигон. Пустое «бесплатно от» — бесплатно не
 * бывает, пустой минимум — без минимума.
 */
export const toZones = (rows: unknown): LlmsZone[] =>
  (Array.isArray(rows) ? rows : [])
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .filter((row) => (row.status ?? 'published') === 'published')
    .filter((row) => !('polygon' in row) || (Array.isArray(row.polygon) && row.polygon.length >= 3))
    .map((row, i) => ({
      row,
      i,
      sort: Number.isFinite(Number(row.sort)) && row.sort !== null && row.sort !== undefined ? Number(row.sort) : i,
    }))
    .sort((a, b) => a.sort - b.sort || a.i - b.i)
    .flatMap(({ row }) => {
      const name = line(typeof row.name === 'string' ? row.name : '');
      const price = money(row.price);
      if (!name || price === null) return [];
      return [{ name, price, freeFrom: money(row.free_from), minOrder: money(row.min_order) ?? 0 }];
    });

const zoneText = (zone: LlmsZone) =>
  join([
    zone.price === 0 || zone.freeFrom === 0 ? 'доставка бесплатно' : `доставка ${rub(zone.price)}`,
    zone.price > 0 && zone.freeFrom ? `бесплатно от ${rub(zone.freeFrom)}` : null,
    zone.minOrder > 0 ? `минимальный заказ ${rub(zone.minOrder)}` : null,
  ]);

// Directus at build time, like `content.ts`; without it — the checked-in seed,
// the same data a fixture build has
// Directus на сборке, как в `content.ts`; без него — посев из репо, те же
// данные, что у сборки на фикстуре
const env = {
  url: import.meta.env?.DIRECTUS_URL || process.env.DIRECTUS_URL,
  token: import.meta.env?.DIRECTUS_TOKEN || process.env.DIRECTUS_TOKEN,
};

const fetchZones = async (): Promise<LlmsZone[]> => {
  const { url: base, token } = env;
  if (!base || !token) return toZones(seedZones);
  const get = async (path: string, auth: boolean) => {
    const response = await fetch(base + path, {
      headers: auth ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`${path.split('?')[0]} → ${response.status}`);
    return (await response.json()) as { items?: unknown; data?: unknown };
  };
  try {
    // the public list the cart reads: the zones in force, exactly as the cart counts them
    // публичный список, который читает корзина: действующие зоны ровно так, как она их считает
    return toZones((await get('/delivery/zones', false)).items);
  } catch (first) {
    try {
      const fields = 'id,status,sort,name,price,free_from,min_order,polygon';
      return toZones((await get(`/items/delivery_zones?fields=${fields}&sort=sort,id&limit=-1`, true)).data);
    } catch (second) {
      // a price of the past is worse than none: the text says only what the cart will say
      // старая цена хуже никакой: текст говорит только то, что скажет корзина
      console.warn(`llms: зоны доставки недоступны (${(first as Error).message}; ${(second as Error).message}) — в тексте их не будет`);
      return [];
    }
  }
};

let zonesCache: Promise<LlmsZone[]> | null = null;
/** Зоны доставки на сборку: один запрос на оба файла. */
export const loadZones = () => (zonesCache ??= fetchZones());

// ── the text / сам текст ────────────────────────────────────────────────────

const available = (category: CatalogCategory) => category.products.filter((product) => product.available);

/** «Завтрак с колбаской — 270 г, 685 ₽. Глазунья, … Состав: …». */
const productLine = (product: Product, href: string) => {
  // with sizes the own weight is the smallest one: the list of sizes below says it better
  // при размерах собственный вес — самый маленький: список размеров ниже скажет точнее
  const price = product.variants.length ? `от ${rub(product.price)}` : rub(product.price);
  const head = join([!product.variants.length && product.weight, product.oldPrice ? `${price} (без скидки ${rub(product.oldPrice)})` : price]);
  const badges = product.badges.map((badge) => (badge === 'hit' ? 'хит' : 'новинка'));
  const tail = sentences([
    product.description,
    product.composition && `Состав: ${product.composition}`,
    product.variants.length > 0 &&
      `Размеры: ${product.variants
        .map((variant) => `${variant.name}${variant.weight && line(variant.weight) !== line(variant.name) ? ` (${variant.weight})` : ''} — ${rub(variant.price)}`)
        .join('; ')}`,
    product.fillings.length > 0 && `Начинки на выбор: ${product.fillings.join(', ')}`,
    badges.length > 0 && `Пометка: ${badges.join(', ')}`,
  ]);
  return `- ${link(product.title, href)} — ${head}${tail ? `. ${tail}` : ''}`;
};

const formatNote = (format: CateringFormat) => join([priceLine(format) ?? 'по смете', format.guests], ', ');

/**
 * The text of `/llms.txt` (`full: false`) or `/llms-full.txt` (`full: true`).
 * `site` is the root of the site with its base: `https://vkus-com.ru/`.
 * Текст `/llms.txt` (`full: false`) или `/llms-full.txt` (`full: true`).
 * `site` — корень сайта вместе с базой: `https://vkus-com.ru/`.
 */
export const buildLlms = (content: Content, site: string | URL, { full = false, zones = [] }: LlmsOptions = {}): string => {
  const root = new URL(String(site));
  root.pathname = root.pathname.replace(/\/?$/, '/');
  root.search = '';
  root.hash = '';
  /** путь сайта без базы: `catalog/` → `https://vkus-com.ru/catalog/` */
  const page = (path = '') => new URL(path.replace(/^\/+/, ''), root).href;
  /** адрес страницы из контента — он уже с базой (`/docs/offer/`), второй раз её не добавляем */
  const at = (href: string) => new URL(href, root).href;
  /** адрес из контента (уже с базой) или внешний; `tel:`, `mailto:` и `#…` — без адреса */
  const abs = (value: string) => {
    const href = value.trim();
    if (!href || /^(tel|mailto|javascript|data):/i.test(href) || href.startsWith('#')) return undefined;
    try {
      const url = new URL(href, root);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
    } catch {
      return undefined;
    }
  };

  const { settings, home, places, directions, catalog, catering, pages, menus } = content;
  // the cakes to order are the catalog's festive section, the same as the home showcase
  // торты на заказ — праздничный раздел каталога, тот же, что витрина главной
  const cakes = cakeShowcase(content);
  const doc = (slug: string) => pages.find((p) => p.slug === slug);
  const chats = chatLinks(settings);
  const vk = isChatLink(settings.vk) ? String(settings.vk).trim() : undefined;
  const email = settings.email?.trim() || undefined;
  const inStock = catalog.categories
    .map((category) => ({ category, products: available(category) }))
    .filter(({ products }) => products.length > 0);
  const stockCount = inStock.reduce((sum, { products }) => sum + products.length, 0);
  const prices = inStock.flatMap(({ products }) => products.flatMap((p) => [p.price, ...p.variants.map((v) => v.price)]));
  const out: string[] = [];

  // ── заголовок и описание ──
  const kinds = ['cafe', 'restaurant', 'confectionery']
    .filter((key) => directions.some((direction) => direction.key === key))
    .map((key) => DIRECTION_WORD[key]!);
  const kindText = kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} и ${kinds.at(-1)}` : (kinds[0] ?? 'кафе');
  const placesText = places.length
    ? `${NUMBER_WORDS[places.length] ?? places.length} ${plural(places.length, 'точка', 'точки', 'точек')}: ${places
        .map((place) => `${place.name} (${lower(place.kind)})`)
        .join(' и ')}.`
    : '';
  const services = join([
    stockCount > 0 && 'доставка из каталога на сайте',
    cakes && 'торты на заказ',
    catering.ready && 'кейтеринг и банкеты',
  ]);
  out.push(`# ${BRAND.name}`);
  out.push(`> ${sentences([`${BRAND.name} — ${kindText} в городе ${BRAND.city}`, placesText, services && services[0].toUpperCase() + services.slice(1)])}`);
  // an address ends its line: a dot after it would be read as part of the address
  // адрес стоит в конце строки: точку после него читатель принял бы за часть адреса
  out.push(
    [
      `Сайт: ${page()}`,
      `Телефон: ${settings.phone}`,
      `Данные сайта на ${longDate(content.today)}, цены в рублях.`,
      full
        ? `Краткая версия этого файла: ${page('llms.txt')}`
        : `Полная версия с каталогом доставки, форматами кейтеринга, ответами на вопросы и текстами документов: ${page('llms-full.txt')}`,
    ].join('\n'),
  );

  // ── о компании ──
  const about: string[] = [item('Главная страница', page(), home.seo_description)];
  for (const place of places)
    about.push(
      item(
        `${place.name}, ${BRAND.city}`,
        yandexOrgUrl(place.yandex_org),
        join(
          [
            lower(place.kind),
            `телефон ${place.phone}`,
            `часы работы: ${hoursText(place)}`,
            place.rating && `оценка в Яндекс Картах ${place.rating}`,
          ],
          '; ',
        ),
      ),
    );
  if (cakes) about.push(item(home.cakes_title || 'Торты на заказ', page('#cakes'), home.cakes_text));
  about.push(item('Контакты и карта', page('#contacts'), `адреса, телефоны и часы работы ${places.length === 2 ? 'обеих точек' : 'точек'}`));
  out.push('## О компании', about.join('\n'));

  if (full) {
    const lines = directions
      .filter((direction) => line(direction.text))
      .map((direction) => `- ${line(direction.title)}${direction.place ? ` (${direction.place.name})` : ''}: ${line(direction.text)}`);
    if (lines.length) out.push('## Направления', lines.join('\n'));
  }

  // the models themselves are listed once, in their section of the catalog below
  // сами модели перечислены один раз — в своём разделе каталога ниже
  if (full && cakes) {
    const low = Math.min(...cakes.cakes.map(({ product }) => product.price));
    out.push(
      `## ${home.cakes_title || 'Торты на заказ'}`,
      [
        home.cakes_text && line(home.cakes_text),
        line(
          `${count(cakes.cakes.length, 'модель', 'модели', 'моделей')} от ${rub(low)} с фото, размерами и ценами — раздел «${cakes.section.title}» каталога: ${page(`catalog/#${cakes.section.slug}`)}`,
        ),
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  // ── меню ──
  const menuItems = directions.flatMap((direction) =>
    menusFor(menus, direction.id)
      .filter((menu) => !menu.file.placeholder)
      .flatMap((menu) => {
        const href = abs(menu.file.href);
        if (!href) return [];
        const kind = menu.file.kind === 'pdf' ? 'PDF' : menu.file.kind === 'image' ? 'изображение' : 'файл';
        const updated = /^\d{4}-\d{2}-\d{2}$/.test(menu.updated) ? `обновлено ${longDate(menu.updated)}` : null;
        return [item(menu.title, href, join([direction.title, kind, updated]))];
      }),
  );
  if (menuItems.length) out.push('## Меню', menuItems.join('\n'));

  // ── доставка и каталог ──
  const delivery: string[] = [];
  if (stockCount > 0)
    delivery.push(
      item(
        'Каталог доставки',
        page('catalog/'),
        join(
          [
            `${count(stockCount, 'позиция', 'позиции', 'позиций')} в ${count(inStock.length, 'разделе', 'разделах', 'разделах')}: ${inStock.map(({ category }) => category.title).join(', ')}`,
            prices.length > 0 && `цены от ${rub(Math.min(...prices))} до ${rub(Math.max(...prices))}`,
            'заказ в корзине на сайте',
          ],
          '; ',
        ),
      ),
    );
  // each venue's menu has its own address: `?place=` opens the catalog on that venue (26.10.2026)
  // у меню каждой точки свой адрес: `?place=` открывает каталог на этой точке (26.10.2026)
  if (stockCount > 0 && places.length > 1)
    for (const place of places) delivery.push(item(`Меню точки ${place.name}`, page(`catalog/?place=${place.id}`), 'каталог сразу с меню этой точки'));
  const deliveryDoc = doc('delivery');
  if (deliveryDoc) delivery.push(item(deliveryDoc.title, at(deliveryDoc.href), deliveryDoc.description));
  // how an order is got and paid — the owner's decisions of 22.10 and 26.10.2026, as the delivery questions say them
  // как получить и оплатить заказ — решения владельца 22.10 и 26.10.2026, теми же словами, что вопросы о доставке
  const howTo =
    stockCount > 0 && places.length
      ? sentences([
          places.length > 1 && 'Меню на точках разное: в каталоге сначала выбирают точку, и заказ готовит она',
          `Заказ можно получить с доставкой по зонам${zones.length ? ' ниже' : ''}, самовывозом из точки или в зале: гость за столиком выбирает точку, при желании номер стола, оплачивает на сайте, и заказ приносят к столу`,
          `Оплата на сайте только онлайн: ${lower(DEFAULT_TEXTS.online)}; электронный чек приходит на почту, указанную при оформлении`,
        ])
      : '';
  const zoneBlock = zones.length
    ? `Зоны доставки и стоимость (считается по адресу при оформлении заказа):\n\n${zones.map((zone) => `- ${zone.name}: ${zoneText(zone)}`).join('\n')}`
    : '';
  if (delivery.length || zoneBlock)
    out.push('## Доставка и каталог', [delivery.join('\n'), howTo, zoneBlock].filter(Boolean).join('\n\n'));

  if (full && inStock.length) {
    out.push(
      '## Каталог доставки',
      `Позиции в наличии на ${longDate(content.today)}: ${count(stockCount, 'позиция', 'позиции', 'позиций')}.\nЗаказ на сайте: ${page('catalog/')}`,
    );
    for (const { category, products } of inStock) {
      out.push(`### ${line(category.title)}`);
      const intro = [`Раздел на сайте: ${page(`catalog/#${category.slug}`)}`, category.description && line(category.description)];
      out.push(
        [...intro, products.map((product) => productLine(product, page(`catalog/#p-${product.slug}`))).join('\n')].filter(Boolean).join('\n\n'),
      );
    }
  }

  // ── кейтеринг ──
  if (catering.ready && catering.page) {
    const cp = catering.page;
    const facts = cp.facts.map((fact) => `${fact.value} — ${fact.label}`);
    const topics = catering.topics.map((topic) => topic.title);
    const list = [
      item(
        'Кейтеринг и банкеты',
        page('catering/'),
        join([facts.length ? facts.join('; ') : cp.heroText, cp.hoursNote && `менеджер на связи ${cp.hoursNote}`], '; '),
      ),
      item(
        'Форматы и цены',
        page('catering/services/'),
        catering.formats.map((format) => `${format.title} — ${formatNote(format)}`).join('; '),
      ),
    ];
    if (catering.questions.length)
      list.push(
        item(
          'Вопросы и ответы о кейтеринге',
          page('catering/faq/'),
          `${count(catering.questions.length, 'вопрос', 'вопроса', 'вопросов')}${topics.length ? ` по темам: ${topics.map((topic) => `«${topic}»`).join(', ')}` : ''}`,
        ),
      );
    out.push('## Кейтеринг и банкеты', list.join('\n'));

    if (full) {
      // the hero title is a slogan; the text under it and the intro say what is offered
      // заголовок первого экрана — лозунг; что предлагается, говорят текст под ним и вступление
      const head = [cp.heroText, cp.intro].flatMap(paragraphs);
      if (cp.priorities.length) head.push(cp.priorities.map((p) => `- ${join([p.title, p.text], ': ')}`).join('\n'));
      out.push(head.join('\n\n'));
      for (const format of catering.formats) {
        const price = priceLine(format);
        const body = [
          sentences([
            `Цена: ${price ?? 'по смете'}${format.price?.note ? ` (${line(format.price.note)})` : ''}`,
            format.guests && `Гостей: ${format.guests}`,
            format.leadTime && `Сроки: ${lower(line(format.leadTime))}`,
          ]),
          ...format.description,
          format.includes.length ? `Что входит:\n\n${format.includes.map((text) => `- ${line(text)}`).join('\n')}` : '',
          `Подробнее: ${page(`catering/services/#${format.slug}`)}`,
        ];
        out.push(`### ${line(format.title)}`, body.filter(Boolean).join('\n\n'));
      }
      if (catering.steps.length)
        out.push(
          '### Как проходит заказ',
          catering.steps.map((step, i) => `${i + 1}. ${join([step.title, step.text], ': ')}`).join('\n'),
        );
    }
  }

  if (full && catering.ready && catering.questions.length) {
    out.push('## Кейтеринг: вопросы и ответы', `Все вопросы на одной странице: ${page('catering/faq/')}`);
    for (const topic of catering.topics) {
      out.push(`### ${line(topic.title)}`);
      for (const question of topic.questions) out.push(`#### ${line(question.question)}`, paragraphs(question.answer).join('\n\n'));
    }
  }

  // ── документы, контакты, реквизиты ──
  if (pages.length) out.push('## Документы', pages.map((p) => item(p.title, at(p.href), p.description)).join('\n'));

  const contacts = [
    `- Телефон: ${settings.phone}`,
    ...places.filter((place) => place.phone !== settings.phone).map((place) => `- Телефон точки ${place.name}: ${place.phone}`),
    ...chats.map((chat) => item(chat.label, chat.href, `написать в ${chat.label}`)),
    vk && item('ВКонтакте', vk, 'сообщество'),
    email && `- Почта: ${email}`,
  ].filter(Boolean);
  out.push('## Контакты', contacts.join('\n'));

  const requisites = doc('requisites');
  const legal = [
    settings.legal_name && `- ${line(settings.legal_name)}`,
    settings.inn && `- ИНН ${line(settings.inn)}`,
    settings.ogrn && `- ${ogrnLabel(settings.ogrn)} ${line(settings.ogrn)}`,
    settings.legal_address && `- Адрес: ${line(settings.legal_address)}`,
    requisites && `- ${link(requisites.title, at(requisites.href))}`,
  ].filter(Boolean);
  if (legal.length) out.push('## Юридическая информация', legal.join('\n'));

  if (!full) {
    out.push(
      '## Optional',
      [
        item('Полная версия для языковых моделей', page('llms-full.txt'), 'каталог доставки с ценами, форматы и вопросы кейтеринга, тексты документов'),
        item('Карта сайта', page('sitemap-index.xml'), 'XML'),
      ].join('\n'),
    );
  } else {
    // ── documents in full / документы целиком ──
    const blockText = (block: DocBlock) => blockLines(block, content, root.hostname);
    for (const p of pages) out.push(`## ${line(p.title)}`, documentText(p, blockText, abs, at(p.href)));
  }

  return `${out
    .join('\n\n')
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/\u00ad/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
};

/** То, что стоит за вставкой `[[реквизиты]]`, `[[связь]]`, `[[точки]]`, — строками списка. */
const blockLines = (block: DocBlock, content: Content, host: string) => {
  const { settings, places } = content;
  if (block === 'requisites')
    return [
      settings.legal_name && `- Наименование: ${line(settings.legal_name)}`,
      settings.inn && `- ИНН: ${line(settings.inn)}`,
      settings.ogrn && `- ${ogrnLabel(settings.ogrn)}: ${line(settings.ogrn)}`,
      settings.legal_address && `- Адрес: ${line(settings.legal_address)}`,
      `- Сайт: ${host}`,
    ]
      .filter(Boolean)
      .join('\n');
  if (block === 'contacts')
    return [
      `- Телефон: ${settings.phone}`,
      settings.email?.trim() && `- Почта: ${settings.email.trim()}`,
      ...chatLinks(settings).map((chat) => `- ${chat.label}: ${chat.href}`),
      isChatLink(settings.vk) && `- ВКонтакте: ${String(settings.vk).trim()}`,
    ]
      .filter(Boolean)
      .join('\n');
  return places
    .map((place) => `- ${place.name}, ${BRAND.city}: ${lower(place.kind)}; телефон ${place.phone}; часы работы: ${hoursText(place)}`)
    .join('\n');
};

/** Документ простым текстом: адрес, редакция, описание и текст с подставленными вставками. */
const documentText = (
  p: DocPage,
  block: (block: DocBlock) => string,
  abs: (href: string) => string | undefined,
  href: string,
) => {
  const parts = [
    [`Адрес: ${href}`, p.revised && `Редакция от ${longDate(p.revised)}.`].filter(Boolean).join('\n'),
    p.description && line(p.description),
    ...p.segments.map((segment) => (segment.kind === 'block' ? block(segment.block) : htmlToText(segment.html, 3, abs))),
  ];
  return parts.filter(Boolean).join('\n\n');
};
