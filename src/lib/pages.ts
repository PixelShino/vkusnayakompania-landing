/**
 * Site documents (`pages` in Directus): the offer, the privacy policy,
 * delivery and payment, the requisites — open HTML pages at `/docs/<slug>/`,
 * the ones a payment provider and a guest look for. The body is the editor's
 * rich text; on the way in it is cleaned, its sections get anchors for the
 * table of contents, and the inserts `[[реквизиты]]`, `[[точки]]`, `[[связь]]`
 * and `[[телефон]]` are taken from «Настройки» and «Точки», so the documents
 * never keep a stale phone or opening hours of their own.
 * Документы сайта (`pages` в Directus): оферта, политика конфиденциальности,
 * доставка и оплата, реквизиты — открытые HTML-страницы `/docs/<slug>/`,
 * которые ищут платёжный сервис и гость. Текст — WYSIWYG редактора; на входе
 * он чистится, разделы получают якоря для оглавления, а вставки
 * `[[реквизиты]]`, `[[точки]]`, `[[связь]]` и `[[телефон]]` берутся из
 * «Настроек» и «Точек» — поэтому в документах не залёживаются старый телефон
 * или часы работы.
 */
import { BASE } from './base.ts';

/** Документы, на которые ссылается сам сайт: подвал, корзина, формы, каталог. */
export const DOC = { offer: 'offer', privacy: 'privacy', delivery: 'delivery', requisites: 'requisites' } as const;

/** Ответ Directus по одной странице; тот же вид в `src/data/fixture.json`. */
export type RawPage = {
  id: number;
  status?: string | null;
  sort?: number | null;
  slug?: string | null;
  title?: string | null;
  description?: string | null;
  body?: string | null;
  revised?: string | null;
  date_updated?: string | null;
};

/** Блок, который страница рисует из админки на месте вставки. */
export type DocBlock = 'requisites' | 'places' | 'contacts';
export type DocSegment = { kind: 'html'; html: string } | { kind: 'block'; block: DocBlock };
/** Раздел в оглавлении; номер «5.» из заголовка вынесен в `n`. */
export type TocItem = { id: string; title: string; n?: string };

export type DocPage = {
  id: number;
  slug: string;
  title: string;
  description?: string;
  href: string;
  /** дата редакции `YYYY-MM-DD`: «Редакция от …»; без неё — день последней правки */
  revised?: string;
  toc: TocItem[];
  segments: DocSegment[];
};

/** Оглавление нужно длинному документу: с четырёх разделов. */
export const TOC_FROM = 4;

const BLOCKS: Record<string, DocBlock> = { реквизиты: 'requisites', точки: 'places', связь: 'contacts' };

// Latin anchors keep the address readable when it is copied: `#5-tsena-i-oplata`
// Латинские якоря читаются и в скопированной ссылке: `#5-tsena-i-oplata`
const LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
export const anchorOf = (text: string) =>
  [...text.toLowerCase()]
    .map((ch) => LATIN[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '') || 'razdel';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–' };
/** Текст без тегов и сущностей — для оглавления и якорей. */
export const plainText = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (all, name: string) => ENTITIES[name] ?? all)
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The editors are trusted, the rich text is not: whatever a paste from Word
 * or a hand-edited source brings, scripts, frames, inline handlers and
 * `javascript:` links do not reach the page.
 * Редакторам доверяем, вставке — нет: что бы ни принесли копия из Word или
 * правка исходника, скрипты, фреймы, обработчики событий и ссылки
 * `javascript:` на страницу не попадают.
 */
export const cleanHtml = (html: string) =>
  html
    .replace(/<(script|style|iframe|object|embed|form|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta|base|input|button|textarea|select)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data):[^"']*\2/gi, ' $1="#"')
    // TinyMCE leaves empty paragraphs where Enter was pressed twice
    // TinyMCE оставляет пустые абзацы там, где дважды нажали Enter
    .replace(/<p[^>]*>(?:\s|&nbsp;| |<br\s*\/?>)*<\/p>/gi, '');

/**
 * Long Russian text: a one- or two-letter word («в», «по», «от») and «№» do
 * not hang at the end of a line, they go down with the next word.
 * Длинный русский текст: короткое слово («в», «по», «от») и «№» не висят в
 * конце строки, а уходят вниз вместе со следующим словом.
 */
const SHORT = /(^|[\s(«„\u00a0])(в|во|с|со|к|ко|о|об|и|а|у|на|по|за|до|от|из|не|но|ни|№)\s+(?=\S)/giu;
const glue = (text: string) => text.replace(SHORT, '$1$2\u00a0').replace(SHORT, '$1$2\u00a0');

/** Тире не начинает строку — то же правило, что `typo()` у остального сайта. */
const dashes = (html: string) => html.replace(/ ([—–]) /g, ' $1 ');

type Context = { phone: string; phoneHref: string };

/**
 * One document: anchors on the sections, the table of contents, root links
 * under the site base (a preview build lives in a subfolder), wide tables in a
 * scroll box, the inserts. Unknown inserts and blocks typed inside a sentence
 * go to the build log instead of the page.
 * Один документ: якоря у разделов, оглавление, корневые ссылки под базой сайта
 * (превью живёт в подпапке), широкие таблицы в коробке с прокруткой, вставки.
 * Неизвестная вставка и блок, набранный внутри фразы, уходят в лог сборки, а не
 * на страницу.
 */
export const prepareBody = (body: string, ctx: Context, where: string, log: (message: string) => void) => {
  const taken = new Set<string>();
  const toc: TocItem[] = [];
  let html = cleanHtml(body)
    // the page has its own h1: a heading 1 in the text is a section
    // у страницы свой h1: «Заголовок 1» в тексте — это раздел
    .replace(/<(\/?)h1\b/gi, '<$1h2')
    .replace(/<(h[23])\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_all, tag: string, attrs: string, inner: string) => {
      const title = plainText(inner);
      let id = anchorOf(title);
      for (let n = 2; taken.has(id); n += 1) id = `${anchorOf(title)}-${n}`;
      taken.add(id);
      if (tag.toLowerCase() === 'h2') {
        const [, n, rest] = title.match(/^(\d{1,2})\.\s+(.+)$/) ?? [];
        toc.push(n ? { id, title: rest, n } : { id, title });
      }
      // «5. Цена и оплата»: the number is set apart, the eye finds the section by it
      // «5. Цена и оплата»: номер отделён — по нему глаз находит раздел
      const numbered = inner.replace(/^(\s*)(\d{1,2})\.\s+/, '$1<span class="doc-n">$2.</span> ');
      return `<${tag} id="${id}"${attrs.replace(/\s+id\s*=\s*("[^"]*"|'[^']*')/i, '')}>${numbered}</${tag}>`;
    })
    // «5.3. Способ оплаты…»: a clause number hangs in the margin on a wide screen
    // «5.3. Способ оплаты…»: номер пункта на широком экране висит на поле
    .replace(/<p>(\s*)(\d{1,2}(?:\.\d{1,2})+\.?)\s+/g, '<p class="doc-cl">$1<span class="doc-cl__n">$2</span> ')
    .replace(/(<a\b[^>]*\shref=")\/(?!\/)/gi, `$1${BASE}`)
    .replace(/<table\b/gi, '<div class="doc-table" role="region" aria-label="Таблица" tabindex="0"><table')
    .replace(/<\/table>/gi, '</table></div>')
    .replace(/\[\[телефон\]\]/gi, `<a class="tnum" href="${ctx.phoneHref}">${ctx.phone}</a>`)
    // «vkus-com.ru/catalog/» broke after the hyphen: a domain in the text stays whole
    // «vkus-com.ru/catalog/» рвался после дефиса: домен в тексте держится целым
    // «5–30 рабочих дней» tore at the dash: a range of numbers stays whole too
    // «5–30 рабочих дней» рвалось на тире: диапазон чисел тоже держится целым
    .replace(/>([^<]+)</g, (_all, text: string) => {
      const set = glue(text)
        .replace(/(?<![\w./-])([a-z0-9-]+\.(?:ru|рф|com)(?:\/[\w./-]*)?)/gi, '<span class="nw">$1</span>')
        .replace(/(?<![\d:])(\d+(?:[.,]\d+)?\u2013\d+(?:[.,]\d+)?)(?![\d:])/g, '<span class="nw">$1</span>');
      return `>${set}<`;
    });
  html = dashes(html);

  // a block insert stands alone in its paragraph; it splits the text there
  // вставка-блок стоит отдельным абзацем; на ней текст и делится
  const segments: DocSegment[] = [];
  const block = /<p[^>]*>(?:\s|&nbsp;| )*\[\[([^\]]+)\]\](?:\s|&nbsp;| )*<\/p>/gi;
  let from = 0;
  for (const match of html.matchAll(block)) {
    const kind = BLOCKS[match[1].trim().toLowerCase()];
    if (!kind) continue;
    if (match.index > from) segments.push({ kind: 'html', html: html.slice(from, match.index) });
    segments.push({ kind: 'block', block: kind });
    from = match.index + match[0].length;
  }
  if (from < html.length) segments.push({ kind: 'html', html: html.slice(from) });

  // whatever is left in double brackets is a typo or a block inside a sentence
  // всё, что осталось в двойных скобках, — опечатка или блок внутри фразы
  for (const segment of segments) {
    if (segment.kind !== 'html') continue;
    segment.html = segment.html.replace(/\[\[([^\]]{1,40})\]\]/g, (_all, name: string) => {
      log(`документы: «${where}» — вставка [[${name}]] не распознана или стоит внутри фразы, на странице её нет`);
      return '';
    });
  }
  return { toc, segments: segments.filter((s) => s.kind === 'block' || s.html.trim()) };
};

// the day of the last save in the venues' timezone
// день последнего сохранения в поясе точек
const samaraDay = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Samara' }).format(new Date(iso));

/**
 * Published documents in the admin's order. A page without a slug or a title
 * is skipped with a log line: one half-filled draft must not cost the site
 * its build, and its link must not lead anywhere.
 * Опубликованные документы в порядке админки. Страница без адреса или
 * заголовка пропускается со строкой в логе: один недозаполненный документ не
 * должен стоить сайту сборки, а ссылка на него — вести в никуда.
 */
export const normalizePages = (
  raw: RawPage[] | null | undefined,
  ctx: Context,
  log: (message: string) => void = console.warn,
): DocPage[] => {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : [])
    .filter((page) => page.status === 'published')
    .sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity) || a.id - b.id)
    .flatMap((page) => {
      const slug = page.slug?.trim().toLowerCase() ?? '';
      const title = page.title?.trim() ?? '';
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || !title || !page.body?.trim()) {
        log(`документы: страница ${page.id} «${title || 'без заголовка'}» пропущена — нужны адрес латиницей, заголовок и текст`);
        return [];
      }
      if (seen.has(slug)) {
        log(`документы: адрес «${slug}» у двух страниц — показана первая`);
        return [];
      }
      seen.add(slug);
      const { toc, segments } = prepareBody(page.body, ctx, title, log);
      return [
        {
          id: page.id,
          slug,
          title,
          description: page.description?.trim() || undefined,
          href: `${BASE}docs/${slug}/`,
          revised: page.revised?.slice(0, 10) || (page.date_updated ? samaraDay(page.date_updated) : undefined),
          toc,
          segments,
        },
      ];
    });
};

/**
 * A plain line (the description of a document) set like the body: short words
 * glued, the dash holding on, the site address in a piece of its own, so the
 * page can keep it from breaking after the hyphen.
 * Простая строка (описание документа) с тем же набором, что и текст: короткие
 * слова приклеены, тире держится, адрес сайта — отдельным куском, чтобы
 * страница не дала ему разорваться на дефисе.
 */
export const textParts = (text: string) =>
  dashes(glue(text))
    .split(/((?<![\w./-])[a-z0-9-]+\.(?:ru|рф|com)(?:\/[\w./-]*)?)/i)
    .filter(Boolean)
    .map((part) => ({ text: part, domain: /^[a-z0-9-]+\.(?:ru|рф|com)(?:\/[\w./-]*)?$/i.test(part) }));

/** Адрес опубликованного документа или ничего: ссылка на архивный документ не рисуется. */
export const docHref = (pages: DocPage[], slug: string) => pages.find((page) => page.slug === slug)?.href;

/** «20 октября 2026» — без «г.», которое добавляет `Intl`. */
export const longDate = (day: string) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`))
    .replace(/\s*г\.$/, '');
