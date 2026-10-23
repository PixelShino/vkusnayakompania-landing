/**
 * The catering landing pages for the search clusters of the semantic core
 * (October 2026): corporate parties and New Year banquets, the banquet hall,
 * the buffet, a birthday in the restaurant. One record per page — its address,
 * title, H1, description, the phrases it answers, the lead, which formats,
 * questions and photos it shows — and the pure pickers that turn a record and
 * the admin's content into what the page prints. Every figure in a text comes
 * from the admin at build time through a `{token}` (`{price:korporativy}` is
 * «от 3 500 ₽ за гостя» of that format); a token the admin no longer fills
 * gives the fallback text instead of a guessed number. The plain claims of a
 * text («через ЭДО», «детские сеты») are listed in `proof`: the check runs
 * them against the fixture and the build warns when the admin drops one.
 * Посадочные страницы кейтеринга под кластеры семантического ядра (октябрь
 * 2026): корпоративы и новогодние банкеты, банкетный зал, фуршет, день
 * рождения в ресторане. Одна запись на страницу — адрес, title, H1,
 * description, фразы, на которые она отвечает, ввод, какие форматы, вопросы и
 * фото она показывает, — и чистые выборщики, которые из записи и контента
 * админки делают то, что печатает страница. Каждое число в тексте приходит из
 * админки на сборке через `{метку}` (`{price:korporativy}` — «от 3 500 ₽ за
 * гостя» этого формата); метка, которую админка больше не заполняет, даёт
 * запасной текст, а не угаданное число. Утверждения без чисел («через ЭДО»,
 * «детские сеты») перечислены в `proof`: проверка гоняет их по фикстуре, а
 * сборка предупреждает, если админка убрала одно из них.
 */
import type { Content, Img, Place, Shot } from '../lib/content.ts';
import type { CateringFormat, CateringQuestion, Fact } from '../lib/catering.ts';
import { priceLine } from '../lib/catering.ts';
import { rub } from '../lib/catalog.ts';
import { CATERING } from '../lib/nav.ts';
import { plural } from './site.ts';

export type LandingSlug = 'corporate' | 'banquet' | 'buffet' | 'birthday';

/** Фраза ядра и её точная частота в Вордстате (Самара, октябрь 2026). */
export type Keyword = { phrase: string; exact: number };

/**
 * A cell of the ink strip under the first screen: a format's price («от
 * 3 500 ₽» over «за гостя · банкет в наших залах»), a fact of the overview
 * whose label matches, the number of halls or a word the data backs («ЭДО»).
 * Ячейка чернильной полосы под первым экраном: цена формата («от 3 500 ₽» над
 * «за гостя · банкет в наших залах»), факт обзорной страницы с подходящей
 * подписью, число залов или слово, которое подтверждают данные («ЭДО»).
 */
export type FactSpec =
  | { from: 'price'; format: string; label?: string }
  | { from: 'fact'; match: RegExp }
  | { from: 'halls' }
  /** слово без числа («ЭДО») — только пока данные его подтверждают (`proof`) */
  | { from: 'text'; value: string; label: string; proof: RegExp };

export type Landing = {
  slug: LandingSlug;
  /** крошка и подпись ссылки на страницу */
  crumb: string;
  /** ≤ 60 знаков, без года */
  title: string;
  h1: string;
  /** 140–160 знаков после подстановки меток */
  description: string;
  /** то же без меток: если админка не заполнила цену или гостей */
  descriptionFallback?: string;
  keywords: Keyword[];
  /** ввод первого экрана: 2–3 предложения с прямым ответом — цена, где, сколько гостей */
  lead: string;
  leadFallback?: string;
  /** сезонная строка под вводом, видна до даты `until` включительно (по Самаре) */
  season?: { text: string; until: string };
  /** утверждения текстов страницы, которые должны быть в данных кейтеринга */
  proof: RegExp[];
  facts: FactSpec[];
  /** слаги форматов в порядке показа; первый — главный формат страницы */
  formats: string[];
  formatsTitle: string;
  formatsLead: string;
  /** формат, который форма заявки выбирает сама: по нему в админке видно, откуда заявка */
  pick: string;
  /** залы с фото: где провести (у фуршета залов нет — он выездной) */
  halls?: { title: string; lead: string };
  /** вопросы по образцам — первый совпавший по тексту вопроса, в этом порядке */
  questions: RegExp[];
  faqTitle: string;
  /** кадр первого экрана: первый совпавший по alt */
  hero: RegExp[];
  /** лента фото: сначала совпавшие по alt в этом порядке */
  photos: RegExp[];
  photosTitle: string;
  /** узел `Service` страницы */
  service: { name: string; type: string };
};

const SEASON_2026 = '2026-12-31';

export const LANDINGS: Landing[] = [
  {
    slug: 'corporate',
    crumb: 'Корпоративы',
    title: 'Новогодний корпоратив в Самаре — Вкусная компания',
    h1: 'Корпоративы и новогодние банкеты',
    description:
      'Новогодние корпоративы в Самаре: банкет в наших залах {guests:korporativy}, от {from:korporativy} на гостя, или выездной фуршет в офис. Работаем с юрлицами через ЭДО.',
    descriptionFallback:
      'Новогодние корпоративы в Самаре: банкет в наших залах или выездной фуршет в офис. Работаем с юрлицами через ЭДО, закрывающие документы — сразу. Оставьте заявку.',
    keywords: [
      { phrase: 'новогодний корпоратив в самаре', exact: 159 },
      { phrase: 'новогодний корпоратив 2027 самара', exact: 141 },
      { phrase: 'новогодние корпоративы 2026 самара', exact: 108 },
      { phrase: 'корпоратив самара', exact: 45 },
      { phrase: 'где отметить корпоратив в самаре', exact: 25 },
      { phrase: 'где отметить новогодний корпоратив в самаре', exact: 21 },
      { phrase: 'где провести корпоратив в самаре', exact: 18 },
      { phrase: 'новогодний корпоратив самара рестораны', exact: 14 },
      { phrase: 'корпоратив на новый год самара', exact: 10 },
      { phrase: 'ресторан для корпоратива самара', exact: 9 },
    ],
    lead:
      'Банкет в наших залах на Садовой, 212Б и на Советской Армии, 177 — {price:korporativy}, {guests:korporativy}. Если праздник в офисе, привезём фуршет с персоналом и сервировкой — {price:furshet}.',
    leadFallback:
      'Банкет в наших залах на Садовой, 212Б и на Советской Армии, 177 или фуршет с персоналом и сервировкой у вас в офисе. С юрлицами работаем через ЭДО, закрывающие документы — сразу.',
    season: { text: 'Новый год 2027: принимаем заявки на декабрь 2026', until: SEASON_2026 },
    proof: [
      /через ЭДО/,
      /закрывающие документы/i,
      /фуршеты? в офисе/i,
      /персоналом и сервировкой/,
      /конференц/i,
      /загородной площадке/,
      /дегустац/i,
    ],
    facts: [
      { from: 'price', format: 'korporativy' },
      { from: 'fact', match: /гост/i },
      { from: 'price', format: 'furshet', label: 'фуршет в офисе, за заказ' },
      { from: 'text', value: 'ЭДО', label: 'для юрлиц, документы сразу', proof: /через ЭДО/ },
    ],
    formats: ['korporativy', 'furshet', 'kofe-breyk'],
    formatsTitle: 'Банкет, фуршет или кофе-брейк',
    formatsLead:
      'Банкет — в нашем зале. Фуршет и кофе-брейк привезём к вам: в офис, на конференцию или на загородную площадку.',
    pick: 'korporativy',
    halls: {
      title: 'Где провести корпоратив в Самаре',
      lead: 'Посмотреть зал и попробовать меню можно до того, как бронировать дату: дегустация — в любом из двух залов.',
    },
    questions: [
      /юрлиц/i,
      /стоит банкет/i,
      /бронировани/i,
      /смет/i,
      /количество гостей/i,
      /пробков/i,
      /дегустац/i,
      /бармен/i,
    ],
    faqTitle: 'Вопросы о корпоративах',
    hero: [/банкетная рассадка/i, /банкетн/i],
    photos: [/бокал/i, /тост/i, /ведущ/i, /банкетн/i, /сервировк/i, /зал ресторана/i],
    photosTitle: 'Фото с наших банкетов',
    service: { name: 'Новогодние корпоративы и банкеты', type: 'Корпоративный банкет' },
  },
  {
    slug: 'banquet',
    crumb: 'Банкетный зал',
    title: 'Банкетный зал в Самаре — Вкусная компания',
    h1: 'Банкетный зал в Самаре',
    description:
      'Банкеты в двух залах «Вкусной компании» в Самаре: свадьбы, юбилеи, дни рождения и семейные праздники {guests:prazdniki}. От {from:prazdniki} на гостя, торт с той же кухни.',
    descriptionFallback:
      'Банкеты в двух залах «Вкусной компании» в Самаре: свадьбы, юбилеи, дни рождения и семейные праздники. Официанты и сервировка — в цене, торт с той же кухни.',
    keywords: [
      { phrase: 'банкетный зал самара', exact: 118 },
      { phrase: 'банкетные залы самара для свадьбы', exact: 53 },
      { phrase: 'кафе в самаре для свадьбы', exact: 25 },
      { phrase: 'банкет самара', exact: 23 },
      { phrase: 'банкетный зал самара на 30 человек', exact: 18 },
      { phrase: 'банкетный зал самара на 20 человек', exact: 15 },
      { phrase: 'где отметить юбилей в самаре', exact: 15 },
      { phrase: 'рестораны в самаре для свадьбы', exact: 12 },
      { phrase: 'аренда банкетного зала самара', exact: 6 },
      { phrase: 'кафе для банкета самара', exact: 5 },
    ],
    lead:
      'Два зала — на Садовой, 212Б и на Советской Армии, 177 — для свадьбы, юбилея или семейного праздника, {guests:prazdniki}. Банкет {price:prazdniki}: в цену уже входят базовый декор, ресторанная сервировка и официанты. Пробкового сбора нет, торт — с той же кухни.',
    leadFallback:
      'Два зала — на Садовой, 212Б и на Советской Армии, 177 — для свадьбы, юбилея или семейного праздника. В цену банкета уже входят базовый декор, ресторанная сервировка и официанты. Пробкового сбора нет, торт — с той же кухни.',
    proof: [
      /базовый декор/i,
      /ресторанная сервировка/i,
      /официанты/i,
      /пробков/i,
      /торт с той же кухни/i,
      /свадьб/i,
      /юбиле/i,
      /атмосферных городских/i,
      /масштабных торжеств/i,
      /флористик/i,
      /ведущ/i,
    ],
    facts: [
      { from: 'price', format: 'prazdniki' },
      { from: 'fact', match: /гост/i },
      { from: 'halls' },
      { from: 'fact', match: /пробков/i },
    ],
    formats: ['prazdniki', 'korporativy'],
    formatsTitle: 'Что входит в банкет',
    formatsLead:
      'Цена считается на гостя, сервировка и официанты уже в ней. Флористику, декор, ведущего и диджея подберём под ваш праздник.',
    pick: 'prazdniki',
    halls: {
      title: 'Два банкетных зала',
      lead: 'Садовая, 212Б — для атмосферных городских праздников, Советской Армии, 177 — для масштабных торжеств. Приезжайте посмотреть зал и попробовать меню.',
    },
    questions: [
      /стоит банкет/i,
      /свадьб/i,
      /поваров и официантов/i,
      /сколько официантов/i,
      /пробков/i,
      /декор/i,
      /ведущих/i,
      /парковк/i,
    ],
    faqTitle: 'Вопросы о банкетах',
    hero: [/банкетный зал/i, /банкетн/i],
    photos: [/банкетн/i, /бокал/i, /сервировк/i, /ведущ/i, /тост/i, /зал/i],
    photosTitle: 'Залы и банкеты',
    service: { name: 'Банкеты в Самаре', type: 'Банкет' },
  },
  {
    slug: 'buffet',
    crumb: 'Фуршет',
    title: 'Фуршет в Самаре с доставкой — Вкусная компания',
    h1: 'Фуршет в Самаре',
    description:
      'Фуршет в Самаре под ключ: закуски и напитки, сервировка, персонал и уборка. Боксы с доставкой от {from:boksy}, выездной фуршет — от {from:furshet} за заказ.',
    descriptionFallback:
      'Фуршет в Самаре под ключ: закуски и напитки, сервировка, пополнение блюд, персонал и уборка после праздника. Или готовые боксы с доставкой по Самаре и области.',
    keywords: [
      { phrase: 'фуршет', exact: 34 },
      { phrase: 'фуршет самара', exact: 22 },
      { phrase: 'фуршет самара доставка', exact: 18 },
      { phrase: 'фуршет бокс самара', exact: 15 },
      { phrase: 'фуршет на заказ', exact: 3 },
      { phrase: 'заказать фуршет', exact: 2 },
      { phrase: 'канапе для фуршета заказать', exact: 1 },
    ],
    lead:
      'Выездной фуршет в Самаре и по области — {price:furshet}: сервировка, персонал, пополнение блюд и уборка после праздника. Для небольшой компании привезём готовые боксы — {price:boksy}, {time:boksy}.',
    leadFallback:
      'Выездной фуршет в Самаре и по области: сервировка, персонал, пополнение блюд и уборка после праздника. Для небольшой компании привезём готовые боксы к нужному времени.',
    proof: [
      /закуски и напитки/i,
      /персоналом/i,
      /пополнение блюд/i,
      /уборка/i,
      /области/i,
      /к праздничному столу/i,
      /на природ/i,
    ],
    facts: [
      { from: 'price', format: 'furshet', label: 'выездной фуршет, за заказ' },
      { from: 'price', format: 'boksy', label: 'за бокс, с доставкой' },
      { from: 'fact', match: /бокс/i },
      { from: 'fact', match: /праздник/i },
    ],
    formats: ['furshet', 'boksy'],
    formatsTitle: 'Выездной фуршет или боксы',
    formatsLead:
      'Выездной фуршет — с персоналом, сервировкой и уборкой. Боксы — готовые наборы к нужному времени: в офис, на природу или к праздничному столу.',
    pick: 'furshet',
    questions: [
      /минимальная сумма/i,
      /день в день/i,
      /базовую стоимость/i,
      /районы/i,
      /от площадки/i,
      /нет кухни/i,
      /мебель/i,
      /убираете/i,
    ],
    faqTitle: 'Вопросы о фуршете',
    hero: [/канапе с брускеттами/i, /канапе/i, /закуск/i],
    photos: [/канапе/i, /закуск/i, /бокал/i, /сервировк/i, /ведущ/i, /тост/i],
    photosTitle: 'Фото с наших праздников',
    service: { name: 'Фуршет в Самаре', type: 'Фуршет' },
  },
  {
    slug: 'birthday',
    crumb: 'День рождения',
    title: 'День рождения в ресторане в Самаре — Вкусная компания',
    h1: 'День рождения в ресторане',
    description:
      'Где отметить день рождения в Самаре: банкет в ресторане на Советской Армии или в кафе на Садовой, детские сеты, торт на заказ с нашей кухни за 48 часов.',
    keywords: [
      { phrase: 'где отметить день рождения в самаре', exact: 94 },
      { phrase: 'где отметить день рождения в самаре взрослому', exact: 80 },
      { phrase: 'где отметить день рождения ребенка самара', exact: 48 },
      { phrase: 'кафе в самаре для день рождения', exact: 31 },
      { phrase: 'отметить день рождения в самаре взрослому', exact: 31 },
      { phrase: 'где можно отметить день рождения в самаре', exact: 22 },
      { phrase: 'отметить детский день рождения в самаре', exact: 10 },
    ],
    lead:
      'Отметить день рождения можно в ресторане на Советской Армии, 177 или в кафе на Садовой, 212Б: банкет {price:prazdniki}, {guests:prazdniki}. Для маленьких гостей — детские сеты, а торт на заказ испечём на своей кухне за 48 часов.',
    leadFallback:
      'Отметить день рождения можно в ресторане на Советской Армии, 177 или в кафе на Садовой, 212Б. Для маленьких гостей — детские сеты, а торт на заказ испечём на своей кухне за 48 часов.',
    proof: [/детские сеты/i, /48 часов/, /детского дня рождения/i, /к праздничному столу/i, /оставшиеся позиции/i],
    facts: [
      { from: 'price', format: 'prazdniki' },
      { from: 'fact', match: /гост/i },
      { from: 'text', value: '48 часов', label: 'торт на заказ с нашей кухни', proof: /торты на заказ за 48 часов/i },
      { from: 'fact', match: /пробков/i },
    ],
    formats: ['prazdniki', 'boksy'],
    formatsTitle: 'В зале или дома',
    formatsLead:
      'Банкет в нашем зале — с официантами и сервировкой. Или боксы с доставкой к праздничному столу дома.',
    pick: 'prazdniki',
    halls: {
      title: 'Где отметить день\u00a0рождения в Самаре',
      lead: 'Ресторан на Советской Армии, 177 и кафе на Садовой, 212Б. Приезжайте заранее: покажем зал и дадим попробовать меню.',
    },
    questions: [
      /для детей/i,
      /стоит банкет/i,
      /пробков/i,
      /ведущих/i,
      /декор/i,
      /оставш/i,
      /количество гостей/i,
      /аллергик/i,
    ],
    faqTitle: 'Вопросы о дне рождения',
    hero: [/основной зал ресторана/i, /зал ресторана/i],
    photos: [/бокал/i, /ведущ/i, /детская комната/i, /роз/i, /сервировк/i, /тост/i],
    photosTitle: 'Праздники у нас',
    service: { name: 'День рождения в ресторане', type: 'Банкет на день рождения' },
  },
];

/** `/catering/corporate/` (с `BASE`). */
export const landingPath = (landing: Pick<Landing, 'slug'>) => `${CATERING}${landing.slug}/`;

export const landingBySlug = (slug: LandingSlug) => {
  const landing = LANDINGS.find((item) => item.slug === slug);
  if (!landing) throw new Error(`посадочная «${slug}» не описана в src/data/landings-catering.ts`);
  return landing;
};

// ── тексты: метки из админки ─────────────────────────────────────────────────

const formatOf = (content: Content, slug: string) => content.catering.formats.find((format) => format.slug === slug);

const TOKEN = /\{(price|from|guests|time):([a-z0-9-]+)\}/g;

const tokenValue = (content: Content, kind: string, slug: string): string | undefined => {
  const format = formatOf(content, slug);
  if (!format) return undefined;
  if (kind === 'price') return priceLine(format);
  if (kind === 'from') return format.price ? rub(format.price.from) : undefined;
  if (kind === 'guests') return format.guests;
  if (kind === 'time') return format.leadTime && format.leadTime.charAt(0).toLowerCase() + format.leadTime.slice(1);
  return undefined;
};

/**
 * The text with its tokens filled from the admin, or `undefined` when any of
 * them has nothing to give (no price, no guests, no such format).
 * Текст с метками, заполненными из админки, или `undefined`, если хоть одной
 * нечего дать (нет цены, гостей, такого формата).
 */
export const fillText = (template: string, content: Content): string | undefined => {
  let missing = false;
  const text = template.replace(TOKEN, (_all, kind: string, slug: string) => {
    const value = tokenValue(content, kind, slug);
    if (!value) missing = true;
    return value ?? '';
  });
  return missing ? undefined : text;
};

export const landingDescription = (landing: Landing, content: Content) =>
  fillText(landing.description, content) ?? landing.descriptionFallback ?? landing.description.replace(TOKEN, '');

export const landingLead = (landing: Landing, content: Content) =>
  fillText(landing.lead, content) ?? landing.leadFallback ?? landing.lead.replace(TOKEN, '');

/** Сезонная строка, пока не прошла её дата (`today` — по Самаре, `YYYY-MM-DD`). */
export const landingSeason = (landing: Landing, today: string) =>
  landing.season && today <= landing.season.until ? landing.season.text : undefined;

/**
 * The words of the catering data a claim may rest on: formats, questions,
 * the overview's texts, the directions, the home page's first screen and the
 * cakes' notes («48 часов»).
 * Слова данных, на которые может опираться утверждение: форматы, вопросы,
 * тексты обзора, направления, первый экран главной и подписи тортов
 * («48 часов»).
 */
export const cateringCorpus = (content: Content) => {
  const { catering, directions, home, cakes } = content;
  const page = catering.page;
  return [
    ...catering.formats.flatMap((format) => [
      format.title,
      format.summary,
      ...format.description,
      ...format.includes,
      format.price?.note,
      format.leadTime,
      format.photo?.alt,
    ]),
    ...catering.questions.flatMap((item) => [item.question, item.answer]),
    ...catering.steps.flatMap((step) => [step.title, step.text]),
    ...(page
      ? [
          page.heroTitle,
          page.heroText,
          page.intro,
          page.formatsText,
          page.requestBonus,
          page.contactsText,
          ...page.facts.map((fact) => `${fact.value} ${fact.label}`),
          ...page.priorities.flatMap((item) => [item.title, item.text]),
          ...page.dialog.map((message) => message.text),
        ]
      : []),
    ...catering.gallery.map((shot) => shot.image.alt),
    ...directions.map((direction) => direction.text),
    home.hero_text,
    ...cakes.map((cake) => cake.note),
  ]
    .filter(Boolean)
    .join('\n');
};

/** Утверждения страницы, которых в данных больше нет: сборка о них предупреждает. */
export const unproven = (landing: Landing, content: Content) => {
  const corpus = cateringCorpus(content);
  return landing.proof.filter((claim) => !claim.test(corpus));
};

// ── форматы, вопросы, цифры ──────────────────────────────────────────────────

export const landingFormats = (landing: Landing, content: Content): CateringFormat[] =>
  landing.formats.flatMap((slug) => formatOf(content, slug) ?? []);

/** Главный формат страницы — тот, что форма выбирает сама. */
export const landingPick = (landing: Landing, content: Content) => formatOf(content, landing.pick);

/** Вопросы по образцам: каждый образец берёт первый ещё не взятый вопрос с подходящим текстом. */
export const landingQuestions = (landing: Landing, content: Content): CateringQuestion[] => {
  const taken = new Set<number>();
  return landing.questions.flatMap((pattern) => {
    const found = content.catering.questions.find((item) => !taken.has(item.id) && pattern.test(item.question));
    if (!found) return [];
    taken.add(found.id);
    return [found];
  });
};

export const landingFacts = (landing: Landing, content: Content): Fact[] => {
  const corpus = cateringCorpus(content);
  return landing.facts.flatMap((spec): Fact[] => {
    if (spec.from === 'price') {
      const format = formatOf(content, spec.format);
      if (!format?.price) return [];
      const label = spec.label ?? [format.price.unit, format.price.note].filter(Boolean).join(', ');
      return [{ value: format.price.text, label }];
    }
    if (spec.from === 'halls') {
      const n = content.places.length;
      if (n < 2) return [];
      return [{ value: String(n), label: `${plural(n, 'зал', 'зала', 'залов')}: ${content.places.map((place) => place.street).join(' и ')}` }];
    }
    if (spec.from === 'text') return spec.proof.test(corpus) ? [{ value: spec.value, label: spec.label }] : [];
    const fact = content.catering.page?.facts.find((item) => spec.match.test(item.label));
    return fact ? [fact] : [];
  });
};

// ── фото ─────────────────────────────────────────────────────────────────────

/** Один и тот же файл в разных местах админки — один ключ. */
export const imageKey = (image: Img) => (typeof image.src === 'string' ? image.src : image.src.src);

const real = (shot: Shot | undefined): shot is Shot => Boolean(shot && !shot.image.placeholder);

/**
 * The photos of a landing, none twice: the first screen's frame, a frame per
 * hall, then the rail — the shots matching the page's patterns in their
 * order, topped up from the catering gallery to four when few match. Frames
 * the format rows already show are left out of the rail.
 * Фото посадочной, ни одного дважды: кадр первого экрана, по кадру на зал,
 * затем лента — кадры, подходящие под образцы страницы, в их порядке, и
 * добор из галереи кейтеринга до четырёх, если совпало мало. Кадры, которые
 * уже показывают строки форматов, в ленту не идут.
 */
export const landingShots = (landing: Landing, content: Content) => {
  const { catering, places } = content;
  const used = new Set<string>();
  const take = (shot: Shot | undefined) => {
    if (shot) used.add(imageKey(shot.image));
    return shot;
  };
  const free = (shot: Shot) => real(shot) && !used.has(imageKey(shot.image));

  // the rows of the page's formats show their own frames; the request band
  // shows the dish on a desktop
  // строки форматов страницы показывают свои кадры; полоса заявки на десктопе —
  // блюдо
  const formats = landingFormats(landing, content);
  for (const format of formats) if (format.photo && !format.photo.placeholder) used.add(imageKey(format.photo));
  if (catering.page?.requestImage) used.add(imageKey(catering.page.requestImage));

  // the frames of the formats this page does not show are free to use
  // кадры форматов, которых страница не показывает, свободны
  const otherFormats: Shot[] = catering.formats
    .filter((format) => !landing.formats.includes(format.slug))
    .flatMap((format) => (format.photo ? [{ image: format.photo }] : []));
  const pageShots: Shot[] = [
    ...(catering.page?.heroImage ? [{ image: catering.page.heroImage }] : []),
    ...catering.gallery,
  ];
  const placeShots = places.flatMap((place) => place.gallery);
  const pool = [...pageShots, ...placeShots, ...otherFormats];
  const byPatterns = (patterns: RegExp[], from: Shot[]) =>
    patterns.flatMap((pattern) => from.filter((shot) => free(shot) && pattern.test(shot.image.alt)));

  const hero = take(byPatterns(landing.hero, pool)[0] ?? pool.find(free));

  const HALL = [/банкетн/i, /зал/i];
  const halls: { place: Place; shot?: Shot }[] = landing.halls
    ? places.map((place) => ({ place, shot: take(byPatterns(HALL, place.gallery)[0] ?? place.gallery.find(free)) }))
    : [];

  const rail: Shot[] = [];
  for (const shot of byPatterns(landing.photos, pool)) {
    if (rail.length >= 8) break;
    if (free(shot)) rail.push(take(shot)!);
  }
  for (const shot of catering.gallery) {
    if (rail.length >= 4) break;
    if (free(shot)) rail.push(take(shot)!);
  }

  return { hero: hero?.image as Img | undefined, halls, rail };
};
