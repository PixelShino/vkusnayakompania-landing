// The catering site (vkusnayakompania.ru, WordPress) into Directus: the page
// texts, the formats, the four steps, every question with its answer and the
// photos. The WordPress REST API returns empty `content` for these pages (the
// theme draws them from PHP templates), so the script reads the HTML of the
// five pages, as a visitor sees them. What the owner banned does not cross:
// the app block, App Store / Google Play and the question about the app.
// Details: docs/DIRECTUS.md → «Кейтеринг».
// Idempotent: records are matched by an import mark (`import_key`), photos by
// a mark in the file's description; a second run creates nothing twice and,
// without `--sync`, never overwrites what an editor changed.
//
// Сайт кейтеринга (vkusnayakompania.ru, WordPress) в Directus: тексты
// страницы, форматы, четыре шага, все вопросы с ответами и фото. REST API
// WordPress отдаёт у этих страниц пустой `content` (тема рисует их из
// PHP-шаблонов), поэтому скрипт читает HTML пяти страниц — как их видит
// посетитель. Запрещённое владельцем не переносится: блок приложения, App Store /
// Google Play и вопрос про приложение. Подробно: docs/DIRECTUS.md → «Кейтеринг».
// Идемпотентен: записи узнаются по метке импорта (`import_key`), фото — по
// пометке в описании файла; повторный запуск ничего не дублирует и без
// `--sync` не перезаписывает правки редакторов.
//
// Run / Запуск:
//   DIRECTUS_URL=http://127.0.0.1:8055 DIRECTUS_ADMIN_TOKEN=… node scripts/import-catering.mjs
// Flags / Флаги:
//   --dry-run         показать, что изменится, ничего не записывая
//   --sync            у уже заведённого переписать поля из импорта (тексты, цены,
//                     состав); без флага заполняются только пустые поля
//   --save file.json  сохранить разобранный сайт в файл
//   --from file.json  взять разбор из такого файла вместо сайта (без сети)
//   --no-photos       без фото
//   --plan file.json  сохранить, что будет записано (тексты после правки), для проверки глазами
// OLD_SITE — адрес старого сайта, по умолчанию https://vkusnayakompania.ru
import fs from 'node:fs';
import { loadEnv } from './env.mjs';

loadEnv();
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const DRY = flag('--dry-run');
const SYNC = flag('--sync');
const PHOTOS = !flag('--no-photos');
const FROM = option('--from');
const SAVE = option('--save');
const PLAN = option('--plan');

const SITE = (process.env.OLD_SITE ?? 'https://vkusnayakompania.ru').replace(/\/+$/, '');
const BASE = process.env.DIRECTUS_URL ?? 'http://127.0.0.1:8055';
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
if (!TOKEN && !DRY) throw new Error('DIRECTUS_ADMIN_TOKEN обязателен');

const PAGES = ['/', '/services/', '/about/', '/contacts/', '/faq/'];
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const log = (line) => console.log(line);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── разбор HTML ─────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' };
const decode = (text) =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
/** HTML-фрагмент → одна строка текста: `<br>` — пробел, теги прочь, пробелы схлопнуты. */
const flat = (html) =>
  html
    ? decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim() || null
    : null;
/** Первое совпадение группы или null. */
const pick = (html, re) => html.match(re)?.[1] ?? null;
const all = (html, re) => [...html.matchAll(re)].map((m) => m[1]);
/** Части `html` между открывающими тегами блоков класса `cls`. */
const blocks = (html, cls) => html.split(new RegExp(`<div class="${cls}"[^>]*>`)).slice(1);
const imgs = (html) => all(html, /<img\b[^>]*\bsrc="([^"]+)"/g);

/**
 * The page as the old site prints it — no editing yet. Every block is found
 * by its class in the theme `vkuscompany`; a block that did not parse is an
 * empty value, and the summary line says so.
 * Страница, как её печатает старый сайт, — ещё без правок. Каждый блок
 * ищется по классу темы `vkuscompany`; неразобравшийся блок — пустое значение,
 * и итоговая строка об этом говорит.
 */
const parse = (html) => {
  const hero = pick(html, /<div class="hero-slide">([\s\S]*?)<div class="main-btns">/);
  const heroSection = pick(html, /<div class="hero-wrapper">([\s\S]*?)<\/section>/);
  const about = pick(html, /<div class="about-wrapper">([\s\S]*?)<div class="about-second-wrapper/);
  const second = pick(html, /<div class="about-second-wrapper[^"]*">([\s\S]*?)<section/);
  const formats = pick(html, /<div class="sticky-data">([\s\S]*?)<div class="sticky-content/);
  const sticky = pick(html, /<div class="sticky-content[^"]*">([\s\S]*?)<\/section>/);
  const way = pick(html, /<div class="way-wrapper">([\s\S]*?)<\/section>/);
  const faq = pick(html, /<div class="faq-wrapper">([\s\S]*?)<\/section>/);
  // the app block: `<section id="app">` on the home page, `class="app"` on the others
  // блок приложения: `<section id="app">` на главной, `class="app"` на остальных
  const app = /<section[^>]*\b(?:id|class)="app"/.test(html);

  return {
    hero: hero && {
      title: flat(pick(hero, /<h1>([\s\S]*?)<\/h1>/)),
      text: flat(pick(hero, /<\/h1>\s*<span\s*>([\s\S]*?)<\/span\s*>/)),
      image: imgs(hero)[0] ?? null,
    },
    // the paragraph after the hero slider / абзац под слайдером первого экрана
    intro: heroSection ? flat(all(heroSection, /<p>([\s\S]*?)<\/p>/g).at(-1)) : null,
    priorities: about
      ? blocks(about, 'about-item').map((chunk) => ({
          title: flat(pick(chunk, /<h5>([\s\S]*?)<\/h5>/)),
          text: flat(pick(chunk, /<p>([\s\S]*?)<\/p>/)),
          image: imgs(chunk)[0] ?? null,
        }))
      : [],
    priorities_title: flat(pick(html, /<div class="about-info-text">([\s\S]*?)<\/div>/)),
    request: second && {
      title: flat(pick(second, /<div class="head-about-second">\s*<p>([\s\S]*?)<\/p>/)),
      text: flat(pick(second, /<div class="about-second-data">\s*<p>([\s\S]*?)<\/p>/)),
      tagline: flat(pick(second, /<\/p>\s*<span>([\s\S]*?)<\/span\s*>/)),
      visit: flat(pick(second, /<div class="map-and-text">\s*<p>([\s\S]*?)<\/p>/)),
      bonus: flat(pick(second, /<\/div>\s*<span>\s*([\s\S]*?)<\/span\s*>\s*<button/)),
      images: imgs(pick(second, /<div class="click">([\s\S]*?)<button/) ?? ''),
    },
    formats_title: formats ? flat(pick(formats, /<h2>([\s\S]*?)<\/h2>/)) : null,
    formats: formats
      ? blocks(formats, 'sticky-data-item').map((chunk) => ({
          title: flat(pick(chunk, /<p>([\s\S]*?)<\/p>/)),
          text: flat(pick(chunk, /<span\s*>([\s\S]*?)<\/span\s*>/)),
          image: imgs(chunk)[0] ?? null,
        }))
      : [],
    formats_quote: sticky ? flat(pick(sticky, /<div class="sitcky-item">\s*<p>([\s\S]*?)<\/p>/)) : null,
    gallery: sticky ? imgs(pick(sticky, /<div class="imgs">([\s\S]*?)<\/div>/) ?? '') : [],
    steps_title: way ? flat(pick(way, /<h3>([\s\S]*?)<\/h3>/)) : null,
    steps: way
      ? blocks(way, 'way-step(?: [^"]*)?').map((chunk) => ({
          title: flat(pick(chunk, /^\s*<span\s*>([\s\S]*?)<\/span\s*>/)),
          text: flat(pick(chunk, /<\/span\s*>\s*<p>([\s\S]*?)<\/p>/)),
          messages: blocks(chunk, 'way-step-messages').flatMap((m) =>
            all(m, /<div>\s*<p>([\s\S]*?)<\/p>/g).map((message) => flat(message)),
          ),
        }))
      : [],
    steps_note: way ? flat(all(way, /<p>([\s\S]*?)<\/p>/g).at(-1)) : null,
    faq: faq
      ? blocks(faq, 'faq-list-item').map((group) => ({
          topic: flat(pick(group, /<div class="faq-list-item-head">\s*<p>([\s\S]*?)<\/p>/)),
          items: group
            .split(/<li class="faq-item">/)
            .slice(1)
            .map((item) => ({
              question: flat(pick(item, /<div class="faq-item-head">\s*<p>([\s\S]*?)<\/p>/)),
              answer: flat(pick(item, /<div class="answer">([\s\S]*?)<\/div>/)),
            })),
        }))
      : [],
    app,
  };
};

const get = async (path) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(SITE + path, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt >= 3) throw new Error(`старый сайт ${path}: ${error.message}`);
      await sleep(1500 * attempt);
    }
  }
};

/**
 * The five pages repeat the same blocks (the FAQ page is the home page's FAQ,
 * «О нас» — its priorities): the home page is the base, another page adds a
 * block only where the home page has none.
 * Пять страниц повторяют одни и те же блоки (страница FAQ — это FAQ главной,
 * «О нас» — её приоритеты): основа — главная, другая страница добавляет блок,
 * только если на главной его нет.
 */
const scrape = async () => {
  const pages = [];
  for (const path of PAGES) {
    pages.push({ path, data: parse(await get(path)) });
    log(`старый сайт: ${path} прочитан`);
  }
  const merged = { ...pages[0].data };
  for (const { path, data } of pages.slice(1)) {
    for (const [key, value] of Object.entries(data)) {
      const empty = (v) => v === null || (Array.isArray(v) && !v.length);
      if (empty(merged[key]) && !empty(value)) {
        merged[key] = value;
        log(`старый сайт: «${key}» взят со страницы ${path}`);
      }
    }
  }
  return { source: { site: SITE, fetched_at: new Date().toISOString(), pages: PAGES }, ...merged };
};

// ── правка под стиль сайта ──────────────────────────────────────────────────

const NBSP = ' ';
const APP = /приложени|app\s?store|google\s?play|apps\.apple|play\.google|vkusdostavka/i;

/**
 * The site's typography, applied to every imported line: a space before `%`
 * and inside numbers, a dash instead of a hyphen between words, «ёлочки»,
 * rubles as ₽. The words stay the old site's.
 * Типографика сайта для каждой импортированной строки: пробел перед `%` и
 * внутри чисел, тире вместо дефиса между словами, «ёлочки», рубли знаком ₽.
 * Слова остаются старого сайта.
 */
const typeset = (text) =>
  text &&
  text
    .replace(/\s+/g, ' ')
    .replace(/(\d)\s?%/g, `$1${NBSP}%`)
    .replace(/(\d) (\d{3})(?!\d)/g, `$1${NBSP}$2`)
    // «руб./чел.» and «руб.» at the end of a sentence keep the full stop
    // «руб./чел.» и «руб.» в конце предложения сохраняют точку
    .replace(/(\d)\s?руб\.\s?\/\s?чел(\.?)/g, `$1${NBSP}₽ на гостя$2`)
    .replace(/(\d)\s?руб\.(?=\s*$|\s+[А-ЯЁ])/g, `$1${NBSP}₽.`)
    .replace(/(\d)\s?руб\./g, `$1${NBSP}₽`)
    .replace(/ [-–] /g, ' — ')
    .replace(/^[-–] /, '— ')
    .replace(/"([^"]+)"/g, '«$1»')
    .replace(/\s+([.,:;!?])/g, '$1')
    .trim();

/**
 * Exact edits of the old texts, each with its reason. Only obvious slips,
 * the app and what the new site does differently (no payment on the site);
 * the meaning stays.
 * Точечные правки старых текстов, у каждой причина. Только очевидные
 * огрехи, приложение и то, что новый сайт делает иначе (оплаты на сайте нет);
 * смысл не меняется.
 */
const EDITS = [
  // a full stop glued to the next sentence / точка без пробела
  ['ссылке или на сайте.Подписали', 'ссылке. Подписали'],
  // «оплата на сайте» — the new site takes no payment / новый сайт оплату не принимает
  ['оплата по ссылке или на сайте', 'оплата по ссылке'],
  ['Наш честный постскриптум: Если', 'Наш честный постскриптум: если'],
  ['в зависимости от сложности ивента', 'в зависимости от сложности мероприятия'],
  ['работаем через в том числе через ЭДО', 'работаем в том числе через ЭДО'],
  ['«Вкусной Компании»', '«Вкусной компании»'],
  ['что-то уникальное, и не забываемое как для вас так и для нас', 'что-то уникальное и незабываемое — как для вас, так и для нас'],
  ['на гостя на наших залах', 'на гостя в наших залах'],
  // the boxes are not sold on the new site: the change is agreed with the manager
  // боксов на новом сайте нет в каталоге: замены согласуются с менеджером
  ['состав готового гастробокса на сайте?', 'состав готового гастробокса?'],
  ['доставляете заказы', 'доставляете заказы?'],
  ['Внимательность к деталям.', 'Внимательность к деталям'],
];
const edit = (text) => {
  if (!text) return text;
  let out = typeset(text);
  for (const [from, to] of EDITS) out = out.split(typeset(from)).join(typeset(to));
  return out.replace(/\?\?$/, '?');
};
const capital = (text) => text && text[0].toUpperCase() + text.slice(1);

const RU = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
/** То же правило, что у сайта (`src/lib/catalog.ts`): адрес из названия. */
const slugify = (text) =>
  text
    .toLowerCase()
    .split('')
    .map((char) => RU[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');

/**
 * What the formats carry beyond their paragraph on the old site. Every line
 * comes from the old site itself — its FAQ answers and «О нас» — and is only
 * moved next to the format it is about; the source is named. Nothing here is a
 * new promise.
 * Что форматы несут сверх своего абзаца на старом сайте. Каждая строка — со
 * старого сайта: из ответов FAQ и «О нас», — её только перенесли к формату, о
 * котором она; источник назван. Новых обещаний здесь нет.
 */
const FORMAT_FACTS = {
  'Доставка боксов': {
    slug: 'boksy',
    // FAQ «Какая минимальная сумма заказа…»: от 1 250 руб. (от 1 шт.)
    price_from: 1250,
    price_unit: 'за бокс',
    price_note: 'минимальный заказ — один бокс',
    // формат: «Изготовление занимает около 2 часов»
    lead_time: 'Готовим около 2 часов',
    includes: [
      'Готовые наборы с выбранными блюдами', // формат
      'Эстетичная одноразовая упаковка', // FAQ «Входит ли аренда посуды…»
      'Доставка по Самаре, в Тольятти, Новокуйбышевск и по области', // FAQ «В какие районы…»
      'Замены в составе — по просьбе, при подтверждении заказа', // FAQ «Можно ли изменить состав…»
    ],
    photo: 'ss2.jpg',
  },
  Фуршет: {
    slug: 'furshet',
    // FAQ: «Организация выездного обслуживания с персоналом и сервировкой возможна при сумме чека от 50 000 руб.»
    price_from: 50000,
    price_unit: 'за заказ',
    price_note: 'выездное обслуживание с персоналом и сервировкой',
    includes: [
      'Зона закусок и напитков — гости выбирают сами', // формат
      'Сервировка и украшение стола', // формат
      'Пополнение блюд и контроль чистоты', // формат
      'Уборка и вывоз мусора после праздника', // FAQ «Убираете ли вы территорию…»
      'Пищевой лёд — бесплатно', // FAQ «Предоставляете ли вы лёд…»
      'Мебель, текстиль и декор — в аренду, по смете', // формат + FAQ «Предоставляете ли вы мебель…»
    ],
    photo: 'ss3.jpg',
  },
  'Кофе-брейк': {
    slug: 'kofe-breyk',
    includes: [
      'Кофемашина и профессиональный кофе', // формат
      'Выпечка и лёгкие закуски', // FAQ «Организуете ли вы кофе-брейки…»
      'Быстрый сервис в перерывах', // FAQ «Организуете ли вы кофе-брейки…»
    ],
    photo: 'ss1.png',
  },
  Праздники: {
    slug: 'prazdniki',
    // FAQ «Сколько стоит банкет на 1 человека на ваших площадках?»: от 3 500 руб./чел.
    price_from: 3500,
    price_unit: 'за гостя',
    price_note: 'банкет в наших залах',
    // «О нас»: залы готовы к праздникам до 140 человек
    guests_to: 140,
    includes: [
      'Базовый декор и ресторанная сервировка', // FAQ «Сколько стоит банкет…»
      'Официанты — уже в цене банкета', // FAQ «Нужно ли отдельно оплачивать работу поваров и официантов?»
      'Без пробкового сбора: лёд и бокалы — наши', // FAQ «Есть ли у вас пробковый сбор…»
      'Детские сеты для маленьких гостей', // FAQ «Есть ли у вас специальное меню для детей?»
      'Флористика и тематический декор «под ключ»', // FAQ «Занимаетесь ли вы оформлением…»
      'Ведущие и диджеи от проверенных партнёров', // FAQ «Помогаете ли вы с подбором ведущих…»
    ],
    photo: 'ss1.jpg',
  },
  'Корпоративные мероприятия': {
    slug: 'korporativy',
    // the same banquet price on our venues / та же цена банкета в наших залах
    price_from: 3500,
    price_unit: 'за гостя',
    price_note: 'банкет в наших залах',
    guests_to: 140,
    includes: [
      'Работаем с юрлицами, в том числе через ЭДО', // FAQ «Как можно оплатить услуги…»
      'Закрывающие документы — сразу', // FAQ «Как можно оплатить услуги…»
      'Выездной бар с барменом и коктейльной картой', // FAQ «Предоставляете ли вы услуги выездного бармена?»
      'Кофе-брейки для конференций', // FAQ «Организуете ли вы кофе-брейки…»
    ],
    photo: 'ss6.jpg',
  },
};

// the questions shown on /catering/ itself / вопросы на самой обзорной странице
const FEATURED = [
  'Сколько стоит банкет на 1 человека на ваших площадках?',
  'Какая минимальная сумма заказа на услуги кейтеринга?',
  'Как происходит процесс бронирования даты?',
  'Есть ли у вас пробковый сбор на свой алкоголь?',
  'Как и где можно провести дегустацию перед заказом?',
  'Можно ли заказать фуршет с доставкой «день в день»?',
  'В какие районы Самары и области вы доставляете заказы?',
  'Что делать, если количество гостей изменилось?',
];
// a question that is about one format is shown under it on /catering/services/
// вопрос про один формат показывается у него на /catering/services/
const QUESTION_FORMAT = {
  'Какая минимальная сумма заказа на услуги кейтеринга?': 'boksy',
  'Можно ли изменить состав готового гастробокса?': 'boksy',
  'В какие районы Самары и области вы доставляете заказы?': 'boksy',
  'Можно ли заказать фуршет с доставкой «день в день»?': 'boksy',
  'Предоставляете ли вы мебель для выездных фуршетов?': 'furshet',
  'Что требуется от площадки для организации вашей работы?': 'furshet',
  'Что делать, если на выбранной локации нет кухни?': 'furshet',
  'Убираете ли вы территорию после окончания фуршета?': 'furshet',
  'Что входит в базовую стоимость выездного обслуживания?': 'furshet',
  'Организуете ли вы кофе-брейки для конференций?': 'kofe-breyk',
  'Сколько стоит банкет на 1 человека на ваших площадках?': 'prazdniki',
  'Есть ли у вас специальное меню для детей?': 'prazdniki',
  'Какая основная площадка лучше подходит для свадьбы?': 'prazdniki',
  'Помогаете ли вы с подбором ведущих или диджеев?': 'prazdniki',
  'Занимаетесь ли вы оформлением и декором пространства?': 'prazdniki',
  'Как можно оплатить услуги и работаете ли вы с юрлицами?': 'korporativy',
  'Предоставляете ли вы услуги выездного бармена?': 'korporativy',
};

/**
 * Titles and alt texts for the photos: the old site left every `alt` empty.
 * The alt says what is in the frame, nothing more.
 * Заголовки и alt для фото: на старом сайте все `alt` пустые. Alt говорит,
 * что в кадре, и ничего сверх.
 */
const PHOTO_TEXT = {
  'a22.JPG': 'Банкетный зал со светлыми окнами, накрытый стол',
  'a1.JPG': 'Детская комната в зале: вигвам, игрушки и стеллаж',
  'a2.JPG': 'Зал ресторана: столы у стены и зелёные стулья',
  'a3.JPG': 'Зал ресторана с декоративной стеной',
  'a4.JPG': 'Зал ресторана со стеллажами и неоновой надписью',
  'ss1.jpg': 'Гости поднимают бокалы за длинным банкетным столом',
  'ss2.jpg': 'Закуски на доске: сыры, фрукты, брускетты',
  'ss3.jpg': 'Гостья с канапе в руке',
  'ss4.jpg': 'Ведущая вечера с микрофоном',
  'ss5.jpg': 'Сервировка банкетного стола с розами',
  'ss6.jpg': 'Тост при свечах: бокалы над столом',
  'ss1.png': 'Канапе с брускеттами на сланцевой доске',
  'ss2.png': 'Канапе с рыбой и мясом на сланцевой доске',
};

// the halls of the old «О нас» go into the gallery after the event shots
// залы из старого «О нас» идут в галерею после кадров с праздников
const HALLS = ['a2.JPG', 'a3.JPG', 'a4.JPG', 'a1.JPG'];

const SEO = {
  seo_title: 'Кейтеринг и банкеты в Самаре — Вкусная компания',
  seo_description:
    'Банкеты в наших залах до 140 гостей, фуршеты, кофе-брейки и доставка боксов по Самаре и области. Банкет от 3 500 ₽ на гостя. Оставьте заявку — перезвоним.',
  services_seo_title: 'Форматы и цены кейтеринга — Вкусная компания',
  services_seo_description:
    'Доставка боксов от 1 250 ₽, фуршет, кофе-брейк, праздники и корпоративы в Самаре: что входит в каждый формат, сколько гостей и как заказать.',
  faq_seo_title: 'Вопросы о кейтеринге и банкетах — Вкусная компания',
  faq_seo_description:
    'Цены и предоплата, дегустация, пробковый сбор, официанты, доставка по области: ответы о банкетах и кейтеринге «Вкусной компании» в Самаре.',
};

const base = (url) => url && decodeURIComponent(url.split('/').pop());

/** Разбор старого сайта → записи Directus (ещё без id файлов). */
const plan = (site) => {
  const skipped = [];
  const keep = (text, where) => {
    if (text && APP.test(text)) {
      skipped.push(where);
      return false;
    }
    return true;
  };
  if (site.app) skipped.push('блок «Приложение и интернет-магазин» с App Store и Google Play');

  const step1 = site.steps[0];
  // «Звоните: … или пишите в Telegram (на связи с 09:00 до 20:00).» — the step
  // shows the numbers itself, from «Настройки»; the hours go to `hours_note`
  // шаг сам показывает номер и мессенджеры из «Настроек»; часы — в `hours_note`
  const contactLine = /\s*Звоните:.*$/;
  const hours = step1?.text?.match(/на связи с (\d{2}:\d{2}) до (\d{2}:\d{2})/);

  const priorities = site.priorities
    .filter((p) => p.title && keep(p.text, `приоритет «${p.title}»`))
    .map((p) => ({ title: edit(p.title), text: edit(p.text) }));

  const page = {
    hero_title: edit(site.hero?.title),
    hero_text: edit(site.hero?.text),
    hero_image: base(site.hero?.image),
    facts: [
      // «Мы уже 6 лет делаем наших гостей и клиентов счастливыми»
      { value: '6 лет', label: 'делаем праздники' },
      // «Наши залы готовы к приему … праздников до 140 человек»
      { value: `до${NBSP}140`, label: 'гостей в наших залах' },
      // формат «Доставка боксов»: «Изготовление занимает около 2 часов»
      { value: `от${NBSP}2 часов`, label: 'готовим боксы' },
      // FAQ: «пробковый сбор отсутствует»
      { value: `0${NBSP}₽`, label: 'пробковый сбор' },
    ],
    intro: edit(site.intro),
    priorities_title: edit(site.priorities_title),
    priorities,
    formats_title: 'Форматы банкетов и кейтеринга',
    formats_text: edit(site.formats_quote),
    steps_title: edit(site.steps_title),
    steps_note: edit(site.steps_note),
    dialog: (step1?.messages ?? []).map((text, i) => ({ who: i % 2 ? 'manager' : 'guest', text: edit(text) })),
    request_title: edit(site.request?.title),
    request_text: edit(site.request?.text),
    request_bonus: edit(site.request?.bonus),
    // the old site said both «на связи 24/7» and «с 09:00 до 20:00»; the form
    // takes requests round the clock, the manager answers in the hours
    // старый сайт говорил и «на связи 24/7», и «с 09:00 до 20:00»; форма
    // принимает заявки круглосуточно, менеджер отвечает в часы
    hours_note: hours ? `с ${hours[1]} до ${hours[2]}` : null,
    contacts_text: site.request?.visit
      ? edit(site.request.visit.replace(/\s*по адресу:.*$/, '').replace(/^Приезжайте к нам:\s*/, ''))
      : null,
    request_image: base(site.request?.images?.[1] ?? site.request?.images?.[0]),
    ...SEO,
  };

  const formats = site.formats
    .filter((f) => f.title)
    .map((f, i) => {
      const title = f.title.replace(/\s*[-–—]\s*$/, '').trim();
      const facts = FORMAT_FACTS[title] ?? {};
      return {
        import_key: facts.slug ?? slugify(title),
        status: 'published',
        sort: i + 1,
        title,
        slug: facts.slug ?? slugify(title),
        summary: capital(edit(f.text)),
        description: null,
        includes: (facts.includes ?? []).map((text) => ({ text: typeset(text) })),
        price_from: facts.price_from ?? null,
        price_unit: facts.price_unit ?? null,
        price_note: facts.price_note ?? null,
        guests_from: facts.guests_from ?? null,
        guests_to: facts.guests_to ?? null,
        lead_time: facts.lead_time ?? null,
        photo: facts.photo ?? null,
      };
    });

  const steps = site.steps
    .filter((s) => s.title)
    .map((s, i) => ({
      import_key: `step-${i + 1}`,
      sort: i + 1,
      title: edit(s.title),
      text: edit(i === 0 ? s.text?.replace(contactLine, '') : s.text),
      contacts: i === 0,
    }));

  let n = 0;
  const faq = site.faq.flatMap((group) =>
    group.items
      .filter((item) => item.question && item.answer && keep(`${item.question} ${item.answer}`, `вопрос «${item.question}»`))
      .map((item) => {
        const question = edit(item.question);
        n += 1;
        return {
          import_key: slugify(item.question),
          status: 'published',
          sort: n,
          topic: edit(group.topic),
          question,
          answer: edit(item.answer),
          featured: FEATURED.includes(question),
          format: QUESTION_FORMAT[question] ?? null,
        };
      }),
  );

  // event shots first, then the halls; the hero frame is not repeated
  // сначала кадры с праздников, затем залы; кадр первого экрана не повторяется
  const gallery = [...site.gallery.map(base), ...HALLS].filter((name, i, list) => name && list.indexOf(name) === i);

  const urls = new Map(
    [site.hero?.image, ...site.priorities.map((p) => p.image), ...site.gallery, ...(site.request?.images ?? [])]
      .filter(Boolean)
      .map((url) => [base(url), url]),
  );
  return { page, formats, steps, faq, gallery, urls, skipped };
};

// ── Directus ────────────────────────────────────────────────────────────────

const api = async (method, path, body) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : (await response.json()).data;
};
const write = async (method, path, body) => (DRY ? { id: `dry-${Math.random()}` } : api(method, path, body));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const blank = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);

const site = FROM ? JSON.parse(fs.readFileSync(FROM, 'utf8')) : await scrape();
if (SAVE) {
  fs.writeFileSync(SAVE, JSON.stringify(site, null, 2) + '\n');
  log(`разбор сохранён: ${SAVE}`);
}
const data = plan(site);
if (PLAN) {
  fs.writeFileSync(PLAN, JSON.stringify({ ...data, urls: Object.fromEntries(data.urls) }, null, 2) + '\n');
  log(`план записи сохранён: ${PLAN}`);
}
const missing = [
  !data.page.hero_title && 'первый экран',
  !data.formats.length && 'форматы',
  !data.steps.length && 'шаги',
  !data.faq.length && 'вопросы',
].filter(Boolean);
if (missing.length) throw new Error(`старый сайт: не разобралось — ${missing.join(', ')}. Разметка поменялась?`);
log(
  `старый сайт: ${data.formats.length} форматов, ${data.steps.length} шага, ${data.faq.length} вопросов, ` +
    `${data.page.priorities.length} приоритетов, ${data.gallery.length} фото в галерею`,
);
for (const line of data.skipped) log(`не переносится (приложение): ${line}`);

const stats = { created: 0, updated: 0, photos: 0, reused: 0, photoFail: 0 };

let folder = null;
if (!DRY) {
  folder = (await api('GET', `/folders?filter[name][_eq]=${encodeURIComponent('Кейтеринг')}&filter[parent][_null]=true&limit=1`))[0];
  if (!folder) folder = await api('POST', '/folders', { name: 'Кейтеринг' });
}

const fileIds = new Map();
const photo = async (name) => {
  if (!name || !PHOTOS || DRY) return null;
  if (fileIds.has(name)) return fileIds.get(name);
  const mark = `Импорт со старого сайта кейтеринга: ${name}`;
  const [found] = await api('GET', `/files?filter[description][_eq]=${encodeURIComponent(mark)}&fields=id&limit=1`);
  if (found) {
    stats.reused += 1;
    fileIds.set(name, found.id);
    return found.id;
  }
  const url = data.urls.get(name) ?? `${SITE}/wp-content/themes/vkuscompany/assets/img/${name}`;
  const text = PHOTO_TEXT[name] ?? 'Праздник «Вкусной компании»';
  // the old site is slow: Directus gives up on a photo with 503 «external-file
  // unavailable» now and then, a second try a few seconds later goes through
  // старый сайт медленный: Directus то и дело сдаётся на фото с 503
  // «external-file unavailable», вторая попытка через несколько секунд проходит
  for (let attempt = 1; ; attempt += 1) {
    try {
      const file = await api('POST', '/files/import', { url, data: { title: text, alt: text, description: mark, folder: folder?.id ?? null } });
      stats.photos += 1;
      fileIds.set(name, file.id);
      log(`+ фото ${name}`);
      return file.id;
    } catch (error) {
      if (attempt < 4 && / → (503|502|504)/.test(error.message)) {
        await sleep(3000 * attempt);
        continue;
      }
      stats.photoFail += 1;
      log(`  фото ${name}: ${error.message.slice(0, 160)}`);
      return null;
    }
  }
};

// 1. the page singleton: empty fields are filled, `--sync` rewrites them
//    синглтон страницы: пустые поля заполняются, `--sync` переписывает
const current = DRY && !TOKEN ? {} : ((await api('GET', '/items/catering_page?fields=*,gallery.id')) ?? {});
const { hero_image: heroName, request_image: requestName, ...texts } = data.page;
const pagePatch = {};
for (const [key, value] of Object.entries(texts)) {
  if (blank(value)) continue;
  if (blank(current[key]) || (SYNC && !same(current[key], value))) pagePatch[key] = value;
}
if (blank(current.hero_image) && heroName) pagePatch.hero_image = await photo(heroName);
if (blank(current.request_image) && requestName) pagePatch.request_image = await photo(requestName);
// The gallery: an empty one gets every photo; with `--sync` the imported
// photos that are missing (a failed download last time) are added at the end,
// and what the editor added or removed by hand is not touched otherwise.
// Галерея: пустая получает все фото; с `--sync` недостающие импортированные
// (не скачались в прошлый раз) добавляются в конец, а то, что редактор
// добавил или убрал руками, иначе не трогается.
if (blank(current.gallery) || SYNC) {
  const rows = DRY || !current.id ? [] : await api('GET', `/items/catering_page_files?filter[catering_page_id][_eq]=${current.id}&fields=directus_files_id,sort&limit=-1`);
  const have = new Set(rows.map((row) => row.directus_files_id));
  let next = rows.reduce((max, row) => Math.max(max, row.sort ?? 0), 0);
  const create = [];
  for (const name of data.gallery) {
    const id = await photo(name);
    if (id && !have.has(id)) create.push({ directus_files_id: id, sort: (next += 1) });
  }
  if (create.length) pagePatch.gallery = { create, update: [], delete: [] };
}
for (const key of Object.keys(pagePatch)) if (pagePatch[key] === null) delete pagePatch[key];
if (Object.keys(pagePatch).length) {
  await write('PATCH', '/items/catering_page', pagePatch);
  stats.updated += 1;
  log(`= страница: ${Object.keys(pagePatch).join(', ')}`);
}

// 2. formats, steps, questions: matched by `import_key`, and failing that by
//    the slug, the title or the wording — records that came from the fixture
//    (`import-fixture.mjs`) or were typed by hand get the mark instead of a twin
//    форматы, шаги, вопросы: узнаются по `import_key`, а без него — по slug,
//    заголовку или формулировке: записи из фикстуры (`import-fixture.mjs`) или
//    набранные руками получают метку, а не двойника
const NATURAL = { catering_formats: 'slug', catering_steps: 'title', catering_faq: 'question' };
const plain = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const upsert = async (collection, items, label, prepare = async (item) => item) => {
  const existing = DRY && !TOKEN ? [] : await api('GET', `/items/${collection}?fields=*&limit=-1`);
  const byKey = new Map(existing.filter((row) => row.import_key).map((row) => [row.import_key, row]));
  const natural = NATURAL[collection];
  const byNatural = new Map(existing.filter((row) => !row.import_key && row[natural]).map((row) => [plain(row[natural]), row]));
  const ids = new Map();
  for (const item of items) {
    const found = byKey.get(item.import_key) ?? byNatural.get(plain(item[natural]));
    if (!found) {
      const created = await write('POST', `/items/${collection}`, await prepare(item, null));
      ids.set(item.import_key, created.id);
      stats.created += 1;
      log(`+ ${label} ${item.title ?? item.question}`);
      continue;
    }
    ids.set(item.import_key, found.id);
    const wanted = await prepare(item, found);
    const patch = Object.fromEntries(
      Object.entries(wanted).filter(
        ([key, value]) => key !== 'import_key' && !blank(value) && (blank(found[key]) || (SYNC && !same(found[key], value))),
      ),
    );
    if (!found.import_key) patch.import_key = item.import_key;
    if (Object.keys(patch).length) {
      await write('PATCH', `/items/${collection}/${found.id}`, patch);
      stats.updated += 1;
      log(`= ${label} ${item.title ?? item.question}: ${Object.keys(patch).join(', ')}`);
    }
  }
  return ids;
};

const formatIds = await upsert('catering_formats', data.formats, 'формат', async (item, found) => ({
  ...item,
  // a photo the editor chose stays / фото, выбранное редактором, остаётся
  photo: found?.photo ? found.photo : await photo(item.photo),
}));
await upsert('catering_steps', data.steps, 'шаг');
await upsert('catering_faq', data.faq, 'вопрос', async (item) => ({
  ...item,
  format: item.format ? (formatIds.get(item.format) ?? null) : null,
}));

log(
  `${DRY ? 'проверка без записи' : 'импорт'}: создано ${stats.created}, обновлено ${stats.updated}, ` +
    `фото загружено ${stats.photos}, уже были ${stats.reused}${stats.photoFail ? `, не загрузилось ${stats.photoFail}` : ''}`,
);
