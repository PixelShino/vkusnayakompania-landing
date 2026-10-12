/**
 * Catering and banquets: the page singleton, the formats, the steps and the
 * questions from Directus (`catering_page`, `catering_formats`,
 * `catering_steps`, `catering_faq`) turned into what `/catering/` and its two
 * pages read. Pure: no I/O, so the content check runs it on the fixture.
 * Lenient like the catalog: a format without a title or a question without an
 * answer is dropped with a warning, and a Directus without these collections
 * gives an empty section, not a failed build. Nothing about the app reaches the
 * page (the owner's rule of 12.10.2026): such a sentence drops out, such a
 * question is not shown and the build says so.
 * Кейтеринг и банкеты: синглтон страницы, форматы, шаги и вопросы из Directus
 * (`catering_page`, `catering_formats`, `catering_steps`, `catering_faq`) в том
 * виде, в каком их читают `/catering/` и две её страницы. Чистый модуль: без
 * сети и файлов, поэтому проверка контента гоняет его на фикстуре.
 * Снисходителен, как каталог: формат без названия или вопрос без ответа
 * выпадают с предупреждением, а Directus без этих коллекций даёт пустой раздел,
 * а не упавшую сборку. Ничего о приложении на страницу не попадает (правило
 * владельца от 12.10.2026): такое предложение выпадает, такой вопрос не
 * показывается, и сборка об этом пишет.
 */
import type { Img, Shot } from './content.ts';
import { rub, slugify } from './catalog.ts';
import { plural } from '../data/site.ts';

const NBSP = ' ';
const APP = /приложени|app\s?store|google\s?play|apps\.apple|play\.google|vkusdostavka/i;

/** Предложения без упоминаний приложения; пусто — `undefined`. */
const noApp = (text: string | null | undefined) => {
  const value = text?.trim();
  if (!value) return undefined;
  if (!APP.test(value)) return value;
  const kept = value
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => !APP.test(sentence))
    .join(' ')
    .trim();
  return kept || undefined;
};

export type Fact = { value: string; label: string };
export type Priority = { title: string; text?: string };
export type Message = { who: 'guest' | 'manager'; text: string };

export type CateringQuestion = {
  id: number;
  /** якорь `#q-…` на странице вопросов */
  slug: string;
  topic: string;
  question: string;
  answer: string;
  featured: boolean;
  /** id формата, к которому вопрос относится, — он покажется и у формата */
  format?: number;
};

export type CateringTopic = { slug: string; title: string; questions: CateringQuestion[] };

export type CateringFormat = {
  id: number;
  slug: string;
  title: string;
  summary?: string;
  /** абзацы подробного описания; пустое поле — берётся `summary` */
  description: string[];
  includes: string[];
  /** «от 3 500 ₽» и к чему цена; без цены — `undefined`, страница пишет «по смете» */
  price?: { from: number; text: string; unit?: string; note?: string };
  /** «до 140 гостей», «от 20 до 140 гостей» */
  guests?: string;
  guestsTo?: number;
  leadTime?: string;
  photo?: Img;
  questions: CateringQuestion[];
};

export type CateringStep = { id: number; n: string; title: string; text?: string; contacts: boolean };

export type CateringPage = {
  heroTitle: string;
  heroText?: string;
  heroImage?: Img;
  facts: Fact[];
  intro?: string;
  prioritiesTitle?: string;
  priorities: Priority[];
  formatsTitle?: string;
  formatsText?: string;
  stepsTitle?: string;
  stepsNote?: string;
  dialog: Message[];
  requestTitle?: string;
  requestText?: string;
  requestBonus?: string;
  hoursNote?: string;
  contactsText?: string;
  requestImage?: Img;
  seo: {
    title?: string;
    description?: string;
    servicesTitle?: string;
    servicesDescription?: string;
    faqTitle?: string;
    faqDescription?: string;
  };
};

export type Catering = {
  /** `null` — в админке страницы нет (схема не применена или запись пуста) */
  page: CateringPage | null;
  formats: CateringFormat[];
  steps: CateringStep[];
  topics: CateringTopic[];
  questions: CateringQuestion[];
  /** вопросы для обзорной страницы: отмеченные «На обзорной», иначе первые шесть */
  featured: CateringQuestion[];
  /** фото страницы, за ними — фото направлений «Кейтеринг» и «Банкеты» */
  gallery: Shot[];
  /** есть что показать: страница и хотя бы один формат */
  ready: boolean;
};

/** Файл Directus так, как его отдаёт запрос; сам объект нормализует `content.ts`. */
type RawFile = Record<string, unknown> & { id: string };
type RawShot = { sort?: number | null; caption?: string | null; directus_files_id: RawFile | null };

export type RawCateringPage = {
  id?: number;
  hero_title?: string | null;
  hero_text?: string | null;
  hero_image?: RawFile | null;
  facts?: { value?: string | null; label?: string | null }[] | null;
  intro?: string | null;
  priorities_title?: string | null;
  priorities?: { title?: string | null; text?: string | null }[] | null;
  formats_title?: string | null;
  formats_text?: string | null;
  steps_title?: string | null;
  steps_note?: string | null;
  dialog?: { who?: string | null; text?: string | null }[] | null;
  request_title?: string | null;
  request_text?: string | null;
  request_bonus?: string | null;
  hours_note?: string | null;
  contacts_text?: string | null;
  request_image?: RawFile | null;
  gallery?: RawShot[] | null;
  seo_title?: string | null;
  seo_description?: string | null;
  services_seo_title?: string | null;
  services_seo_description?: string | null;
  faq_seo_title?: string | null;
  faq_seo_description?: string | null;
};

export type RawCateringFormat = {
  id: number;
  status?: string | null;
  sort?: number | null;
  title?: string | null;
  slug?: string | null;
  summary?: string | null;
  description?: string | null;
  includes?: ({ text?: string | null } | string)[] | null;
  price_from?: number | string | null;
  price_unit?: string | null;
  price_note?: string | null;
  guests_from?: number | string | null;
  guests_to?: number | string | null;
  lead_time?: string | null;
  photo?: RawFile | null;
};

export type RawCateringStep = { id: number; sort?: number | null; title?: string | null; text?: string | null; contacts?: boolean | null };

export type RawCateringFaq = {
  id: number;
  status?: string | null;
  sort?: number | null;
  topic?: string | null;
  question?: string | null;
  answer?: string | null;
  featured?: boolean | null;
  format?: number | { id: number } | null;
};

/** Картинка страницы: строгая (alt обязателен) — её даёт `content.ts`. */
export type CateringImage = (file: RawFile | null | undefined) => Img | undefined;
/** Кадр направления для общей ленты: подпись уже собрана (`Кейтеринг · Бокс`). */
export type DirectionShots = { title: string; gallery: Shot[] }[];

const bySort = <T extends { sort?: number | null; id: number }>(a: T, b: T) =>
  (a.sort ?? Number.MAX_SAFE_INTEGER) - (b.sort ?? Number.MAX_SAFE_INTEGER) || a.id - b.id;
const published = (status?: string | null) => !status || status === 'published';
const whole = (value: unknown) => {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(String(value).replace(/\s/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

/** «до 140 гостей», «от 20 гостей», «от 20 до 140 гостей» — или ничего. */
export const guestsText = (from?: number, to?: number) => {
  if (from && to && to >= from) return `от${NBSP}${from} до${NBSP}${to} ${plural(to, 'гостя', 'гостей', 'гостей')}`;
  if (to) return `до${NBSP}${to} ${plural(to, 'гостя', 'гостей', 'гостей')}`;
  if (from) return `от${NBSP}${from} ${plural(from, 'гостя', 'гостей', 'гостей')}`;
  return undefined;
};

/** Абзацы по пустой строке; одиночный перенос — пробел. */
const paragraphs = (text?: string) =>
  (text ?? '')
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

export const emptyCatering = (): Catering => ({
  page: null,
  formats: [],
  steps: [],
  topics: [],
  questions: [],
  featured: [],
  gallery: [],
  ready: false,
});

export const normalizeCatering = (
  raw: {
    page?: RawCateringPage | RawCateringPage[] | null;
    formats?: RawCateringFormat[] | null;
    steps?: RawCateringStep[] | null;
    faq?: RawCateringFaq[] | null;
    directions?: DirectionShots;
  },
  image: CateringImage,
  warn: (message: string) => void,
): Catering => {
  // a singleton comes as an object; a Directus without the collection gives `[]`
  // синглтон приходит объектом; Directus без коллекции даёт `[]`
  const rawPage = Array.isArray(raw.page) ? raw.page[0] : raw.page;
  const heroTitle = noApp(rawPage?.hero_title);
  const page: CateringPage | null =
    rawPage && heroTitle
      ? {
          heroTitle,
          heroText: noApp(rawPage.hero_text),
          heroImage: image(rawPage.hero_image),
          facts: (rawPage.facts ?? []).flatMap((fact) => {
            const value = fact?.value?.trim();
            const label = noApp(fact?.label);
            return value && label ? [{ value, label }] : [];
          }),
          intro: noApp(rawPage.intro),
          prioritiesTitle: noApp(rawPage.priorities_title),
          priorities: (rawPage.priorities ?? []).flatMap((item) => {
            const title = item?.title?.trim();
            return title ? [{ title, text: noApp(item?.text) }] : [];
          }),
          formatsTitle: noApp(rawPage.formats_title),
          formatsText: noApp(rawPage.formats_text),
          stepsTitle: noApp(rawPage.steps_title),
          stepsNote: noApp(rawPage.steps_note),
          dialog: (rawPage.dialog ?? []).flatMap((message) => {
            const text = noApp(message?.text);
            return text ? [{ who: message?.who === 'manager' ? ('manager' as const) : ('guest' as const), text }] : [];
          }),
          requestTitle: noApp(rawPage.request_title),
          requestText: noApp(rawPage.request_text),
          requestBonus: noApp(rawPage.request_bonus),
          hoursNote: rawPage.hours_note?.trim() || undefined,
          contactsText: noApp(rawPage.contacts_text),
          requestImage: image(rawPage.request_image),
          seo: {
            title: rawPage.seo_title?.trim() || undefined,
            description: rawPage.seo_description?.trim() || undefined,
            servicesTitle: rawPage.services_seo_title?.trim() || undefined,
            servicesDescription: rawPage.services_seo_description?.trim() || undefined,
            faqTitle: rawPage.faq_seo_title?.trim() || undefined,
            faqDescription: rawPage.faq_seo_description?.trim() || undefined,
          },
        }
      : null;
  if (rawPage && !heroTitle) warn('кейтеринг: у страницы нет заголовка первого экрана — раздел соберётся пустым');

  // ── вопросы ────────────────────────────────────────────────────────────
  const takenQuestion = new Set<string>();
  const questions: CateringQuestion[] = [];
  for (const row of [...(raw.faq ?? [])].sort(bySort)) {
    if (!published(row.status)) continue;
    const question = row.question?.trim();
    const answer = row.answer?.trim();
    if (!question || !answer) {
      warn(`кейтеринг: вопрос ${row.id} без текста или ответа — пропущен`);
      continue;
    }
    if (APP.test(question) || APP.test(answer)) {
      warn(`кейтеринг: вопрос «${question}» про приложение — на сайте не показан`);
      continue;
    }
    let slug = slugify(question).slice(0, 48).replace(/-+$/, '') || `q-${row.id}`;
    if (takenQuestion.has(slug)) slug = `${slug}-${row.id}`;
    takenQuestion.add(slug);
    const format = typeof row.format === 'object' && row.format ? row.format.id : (row.format ?? undefined);
    questions.push({
      id: row.id,
      slug,
      topic: row.topic?.trim() || 'Другие вопросы',
      question,
      answer,
      featured: Boolean(row.featured),
      format: format ?? undefined,
    });
  }
  const topics: CateringTopic[] = [];
  const takenTopic = new Set<string>();
  for (const question of questions) {
    let topic = topics.find((item) => item.title === question.topic);
    if (!topic) {
      let slug = slugify(question.topic).slice(0, 40).replace(/-+$/, '') || `t-${topics.length + 1}`;
      if (takenTopic.has(slug)) slug = `${slug}-${topics.length + 1}`;
      takenTopic.add(slug);
      topic = { slug, title: question.topic, questions: [] };
      topics.push(topic);
    }
    topic.questions.push(question);
  }
  const marked = questions.filter((question) => question.featured);
  const featured = marked.length ? marked : questions.slice(0, 6);

  // ── форматы ────────────────────────────────────────────────────────────
  const takenFormat = new Set<string>(['request', 'formats', 'steps', 'about', 'gallery', 'faq', 'contacts', 'top', 'main']);
  const formats: CateringFormat[] = [];
  for (const row of [...(raw.formats ?? [])].sort(bySort)) {
    if (!published(row.status)) continue;
    const title = row.title?.trim();
    if (!title) {
      warn(`кейтеринг: формат ${row.id} без названия — пропущен`);
      continue;
    }
    let slug = slugify(row.slug?.trim() ?? '') || slugify(title) || `f-${row.id}`;
    if (takenFormat.has(slug)) slug = `${slug}-${row.id}`;
    takenFormat.add(slug);
    const summary = noApp(row.summary);
    const from = whole(row.price_from);
    const guestsFrom = whole(row.guests_from);
    const guestsTo = whole(row.guests_to);
    formats.push({
      id: row.id,
      slug,
      title,
      summary,
      description: paragraphs(noApp(row.description) ?? summary),
      includes: (row.includes ?? [])
        .map((item) => (typeof item === 'string' ? item : item?.text)?.trim())
        .filter((item): item is string => Boolean(item) && !APP.test(item!)),
      price: from
        ? { from, text: `от${NBSP}${rub(from)}`, unit: row.price_unit?.trim() || undefined, note: noApp(row.price_note) }
        : undefined,
      guests: guestsText(guestsFrom, guestsTo),
      guestsTo,
      leadTime: noApp(row.lead_time),
      photo: image(row.photo),
      questions: questions.filter((question) => question.format === row.id),
    });
  }

  const steps: CateringStep[] = [...(raw.steps ?? [])]
    .sort(bySort)
    .flatMap((row) => {
      const title = noApp(row.title);
      return title ? [{ id: row.id, title, text: noApp(row.text), contacts: Boolean(row.contacts) }] : [];
    })
    .map((step, i) => ({ ...step, n: String(i + 1).padStart(2, '0') }));

  // the page's own shots first, then the catering and banquet directions'
  // сначала свои кадры страницы, затем кадры направлений «Кейтеринг» и «Банкеты»
  const own = (rawPage?.gallery ?? [])
    .filter((row) => row.directus_files_id)
    .flatMap((row): Shot[] => {
      const shot = image(row.directus_files_id);
      return shot ? [{ image: shot, caption: row.caption?.trim() || undefined }] : [];
    });
  const borrowed = (raw.directions ?? []).flatMap((direction) =>
    direction.gallery.map((shot) => ({
      image: shot.image,
      caption: [direction.title, shot.caption].filter(Boolean).join(' · '),
    })),
  );

  return {
    page,
    formats,
    steps,
    topics,
    questions,
    featured,
    gallery: [...own, ...borrowed],
    ready: Boolean(page) && formats.length > 0,
  };
};

/** «от 3 500 ₽ за гостя» одной строкой — для разметки и подписей. */
export const priceLine = (format: CateringFormat) =>
  format.price ? [format.price.text, format.price.unit].filter(Boolean).join(' ') : undefined;
