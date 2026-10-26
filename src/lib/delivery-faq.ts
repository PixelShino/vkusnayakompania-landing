/**
 * «Вопросы о доставке» at the end of the catalog: short direct answers for a
 * guest and for answer engines, built only from data the site already has —
 * the delivery zones the cart quotes from, the checkout's time slots, the
 * payment words, the venues, the order statuses of the account, the cakes of
 * the catalog. A question without its fact is left out, never answered with a
 * guessed number. Every answer comes twice: plain text for the `FAQPage`
 * markup and HTML with links and the zone list for the page.
 * «Вопросы о доставке» в конце каталога: короткие прямые ответы для гостя и
 * для поисковых ответов нейросетей, собранные только из данных, которые у
 * сайта уже есть, — зоны доставки, по которым считает корзина, слоты времени
 * оформления, слова об оплате, точки, статусы заказа в кабинете, торты
 * каталога. Вопрос без своего факта пропускается, а не получает выдуманное
 * число. Каждый ответ — дважды: простой текст для разметки `FAQPage` и HTML со
 * ссылками и списком зон для страницы.
 *
 * Zones: the same rows and the same normalization as the server
 * (`toZones` of `directus/extensions/delivery`): only switched-on zones with a
 * border, in the admin's order. The build reads them from Directus (the
 * builder may, see `scripts/setup/delivery.mjs`; a saved zone rebuilds the
 * site); without Directus — the seed `src/data/delivery-zones.json`, the same
 * one the fixture's Directus was filled from.
 * Зоны: те же строки и та же нормализация, что у сервера (`toZones`
 * расширения `directus/extensions/delivery`): только включённые зоны с
 * границей, в порядке админки. Сборка читает их из Directus (сборщику можно,
 * см. `scripts/setup/delivery.mjs`; сохранённая зона пересобирает сайт); без
 * Directus — сид `src/data/delivery-zones.json`, которым заполнен Directus
 * фикстуры.
 */
import { toZones } from '../../directus/extensions/delivery/geo.js';
import seed from '../data/delivery-zones.json' with { type: 'json' };
import { hoursRows, shortTime } from '../data/site.ts';
import { ORDER_STATUS } from './account.ts';
import { rub } from './catalog.ts';
import { chatLinks } from './contact-links.ts';
import { BASE } from './base.ts';
import { typo, type Content } from './content.ts';
import { HOME_CITY } from './delivery.ts';
import { plural } from './loyalty.ts';
import { SLOT_FROM, SLOT_TO, daysFrom, slotsFor } from './order.ts';
import { DEFAULT_TEXTS } from './payment.ts';

/** Зона так, как её видит гость: без полигона. `free_from: null` — бесплатного порога нет. */
export type FaqZone = { name: string; price: number; free_from: number | null; min_order: number };

/** `aHtml` — тот же ответ со ссылками и списком; без него страница печатает `a`. */
export type FaqItem = { id: string; q: string; a: string; aHtml?: string };

export type FaqOptions = {
  /** зоны доставки; `null` — не удалось узнать: ответ без чисел, вопрос о минимуме пропущен */
  zones: FaqZone[] | null;
  /** страница «Доставка и оплата» (`/docs/delivery/`), если она есть */
  deliveryHref?: string;
};

// ── zones / зоны ─────────────────────────────────────────────────────────────

/** Строки `delivery_zones` (Directus или сид) → зоны гостя, как их считает сервер. */
export const zonesFrom = (rows: unknown): FaqZone[] =>
  toZones(Array.isArray(rows) ? rows : []).map((zone) => ({
    name: zone.name,
    price: zone.price,
    free_from: zone.free_from ?? null,
    min_order: zone.min_order,
  }));

const env = {
  url: import.meta.env?.DIRECTUS_URL || process.env.DIRECTUS_URL,
  token: import.meta.env?.DIRECTUS_TOKEN || process.env.DIRECTUS_TOKEN,
};

const ZONES_PATH = '/items/delivery_zones?fields=id,name,price,free_from,min_order,polygon,sort,status&limit=-1';

/**
 * The zones for the build. Directus answering 503 under load is waited for, as
 * in `content.ts`; any other failure gives `null` and a loud log line — the
 * page then answers without prices rather than with the seed's, which may be
 * older than the admin.
 * Зоны для сборки. 503 Directus под нагрузкой пережидаем, как в `content.ts`;
 * любая другая неудача — `null` и громкая строка в логе: страница тогда
 * отвечает без цен, а не ценами сида, которые могут быть старее админки.
 */
export const loadZones = async (): Promise<FaqZone[] | null> => {
  const { url, token } = env;
  if (!url || !token) return zonesFrom(seed);
  try {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetch(url + ZONES_PATH, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 503 && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return zonesFrom((await response.json()).data);
    }
  } catch (error) {
    console.warn(`вопросы о доставке: зоны недоступны (${(error as Error).message}) — ответ о цене без чисел`);
    return null;
  }
};

// ── words / слова ────────────────────────────────────────────────────────────

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** HTML-ссылка с экранированными адресом и текстом. */
const link = (href: string, text: string, external = false) =>
  `<a href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${esc(text)}</a>`;

/** «а, б и в» */
const andList = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;

/** «Рядом с нами — Советский, …» → «Рядом с нами»; «Красноглинский район, Зубчаниновка, …» → «Красноглинский район» */
export const shortZone = (name: string) => name.split(/\s[—–-]\s|,/)[0].trim();

/** «Рядом с нами — Советский, …» → [«Рядом с нами», «Советский, …»]; без пояснения — [имя, ''] */
const splitZone = (name: string) => {
  const short = shortZone(name);
  const rest = name.slice(short.length).replace(/^\s*(?:[—–-]\s|,)\s*/, '').trim();
  return [short, rest] as const;
};

const quoted = (text: string) => `«${text}»`;

/** «8:00 — 21:00» строки расписания → «8:00–21:00» для фразы */
const span = (hours: string) => hours.replace(/\s[—–]\s/, '–');

/** Расписание точки одной фразой: «пн–пт 8:00–21:00, сб 8:30–21:00, вс 9:00–21:00». */
export const scheduleText = (schedule: Content['places'][number]['schedule'], wrap = (piece: string) => piece) =>
  hoursRows(schedule)
    .map((row) => wrap(`${row.days.charAt(0).toLowerCase()}${row.days.slice(1)} ${span(row.hours)}`))
    .join(', ');

const NUMBER_WORDS: Record<number, string> = { 2: 'двух', 3: 'трёх', 4: 'четырёх' };

/** «по Самаре», «в Самаре»: город сайта в нужном падеже */
const CITY_IN = ({ Самара: 'Самаре' } as Record<string, string>)[HOME_CITY] ?? HOME_CITY;

/** Сколько — чаще всего, при равенстве — меньшее. */
const mostCommon = (values: number[]) => {
  const count = new Map<number, number>();
  for (const value of values) count.set(value, (count.get(value) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
};

// ── time slots / время ───────────────────────────────────────────────────────

/**
 * What «ко времени» in the checkout offers, read from the checkout's own
 * rules (`order.ts`), not retyped: the window, the step, how many days and
 * how soon the nearest slot is. Measured on a fixed morning so the build's
 * own hour does not change the answer.
 * Что предлагает «Ко времени» в оформлении, прочитанное из правил самого
 * оформления (`order.ts`), а не перепечатанное: окно, шаг, сколько дней и
 * через сколько ближайший слот. Меряется на фиксированном утре, чтобы час
 * сборки не менял ответ.
 */
export const slotFacts = () => {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const opening = new Date(`2026-01-05T${SLOT_FROM}:00+04:00`);
  const later = slotsFor('2026-01-06', opening);
  const today = slotsFor('2026-01-05', opening);
  const step = later.length > 1 ? minutes(later[1]) - minutes(later[0]) : 0;
  const lead = today.length ? minutes(today[0]) - minutes(SLOT_FROM) : 0;
  const morning = new Date(`2026-01-05T06:00:00+04:00`);
  return { from: SLOT_FROM, to: SLOT_TO, step, lead, days: daysFrom(morning).length };
};

// ── cakes / торты ────────────────────────────────────────────────────────────

/** Раздел каталога с праздничными тортами — тот же адрес, что у стикера первого экрана. */
const FESTIVE = 'prazdnichnye-torty';
const READY = 'torty-v-nalichii';

/** «за 48 часов» в описании блюда или тексте → 48 */
const hoursIn = (text: string | null | undefined) => {
  const match = /(\d+)\s*час/iu.exec(text ?? '');
  return match ? Number(match[1]) : null;
};

// ── the questions / вопросы ──────────────────────────────────────────────────

export const buildDeliveryFaq = (content: Content, { zones, deliveryHref }: FaqOptions): FaqItem[] => {
  const { settings, places, catalog, home, loyalty } = content;
  const items: FaqItem[] = [];
  const doc = (text: string) => (deliveryHref ? link(deliveryHref, text) : esc(text));

  // 1. zones and prices / зоны и цены
  if (zones?.length) {
    const prices = zones.map((zone) => zone.price);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const cost = low === high ? `доставка стоит ${rub(low)}` : `доставка стоит от ${rub(low)} до ${rub(high)} в зависимости от зоны адреса`;
    const thresholds = zones.map((zone) => zone.free_from).filter((value): value is number => value !== null && value > 0);
    const freeLow = thresholds.length ? Math.min(...thresholds) : null;
    const freeZones = zones.filter((zone) => zone.free_from === freeLow).map((zone) => quoted(shortZone(zone.name)));
    const free =
      freeLow === null
        ? ''
        : freeZones.length === zones.length
          ? ` Бесплатно — при заказе блюд от ${rub(freeLow)}.`
          : ` Бесплатно — при заказе блюд от ${rub(freeLow)} в ${freeZones.length > 1 ? 'зонах' : 'зоне'} ${andList(freeZones)}, в остальных порог выше.`;
    const first = `По ${CITY_IN} и окрестностям: ${cost}.${free}`;
    const last = 'Точную сумму корзина считает по адресу при оформлении; если адрес вне зон, выберите самовывоз или позвоните нам.';
    const line = (zone: FaqZone) =>
      [
        `доставка ${rub(zone.price)}`,
        zone.free_from ? `бесплатно от ${rub(zone.free_from)}` : '',
        zone.min_order ? `минимальный заказ ${rub(zone.min_order)}` : '',
      ]
        .filter(Boolean)
        .join(', ');
    const list = zones.map((zone) => `${zone.name}: ${line(zone)}.`).join(' ');
    const rows = zones
      .map((zone) => {
        const [short, rest] = splitZone(zone.name);
        // the line breaks at the dot, never inside «минимум 1 000 ₽» / строка переносится по точке, а не внутри «минимум 1 000 ₽»
        const meta = [zone.free_from ? `бесплатно от ${rub(zone.free_from)}` : '', zone.min_order ? `минимум ${rub(zone.min_order)}` : '']
          .filter(Boolean)
          .map((piece) => `<span class="dfaq-nw">${piece}</span>`)
          .join(' · ');
        return (
          `<li class="dfaq-zone">` +
          // the dash is for a reader without styles: copied or read aloud, the row says the zone's full name
          // тире — для чтения без стилей: скопированная или озвученная строка называет зону полностью
          `<span class="dfaq-zone__name"><b>${esc(short)}</b>${rest ? `<span class="sr-only"> — </span><span class="dfaq-zone__area">${esc(rest)}</span>` : ''}</span>` +
          `<span class="dfaq-zone__price tnum">${rub(zone.price)}</span>` +
          (meta ? `<span class="dfaq-zone__meta tnum">${meta}</span>` : '') +
          `</li>`
        );
      })
      .join('');
    items.push({
      id: 'zones',
      q: 'Куда доставляете и сколько стоит доставка?',
      a: `${first} ${list} ${last}`,
      aHtml: `<p>${esc(typo(first))}</p><ul class="dfaq-zones" role="list">${rows}</ul><p>${esc(last)}</p>`,
    });
  } else {
    const text = `По ${CITY_IN}: стоимость зависит от зоны адреса, корзина посчитает её при оформлении.`;
    items.push({ id: 'zones', q: 'Куда доставляете и сколько стоит доставка?', a: text });
  }

  // 2. minimum order — only when the zones have one / минимальный заказ — только если он есть у зон
  const minimums = zones?.map((zone) => zone.min_order).filter((value) => value > 0) ?? [];
  if (zones?.length && minimums.length) {
    const base = mostCommon(minimums)!;
    const others = zones.filter((zone) => zone.min_order > 0 && zone.min_order !== base);
    const byValue = [...new Set(others.map((zone) => zone.min_order))].sort((a, b) => a - b);
    const extra = byValue
      .map((value) => {
        const names = others.filter((zone) => zone.min_order === value).map((zone) => quoted(shortZone(zone.name)));
        return `в ${names.length > 1 ? 'зонах' : 'зоне'} ${andList(names)} — ${rub(value)}`;
      })
      .join(', ');
    const none = zones.filter((zone) => zone.min_order === 0).map((zone) => quoted(shortZone(zone.name)));
    const head = `Да, для доставки: ${rub(base)} за блюда${extra ? `, а ${extra}` : ''}${none.length ? `; без минимума — ${andList(none)}` : ''}.`;
    const a = `${head} Для самовывоза минимальной суммы нет. Если в корзине меньше, она подскажет, сколько добавить.`;
    items.push({ id: 'minimum', q: 'Есть ли минимальная сумма заказа?', a });
  }

  // 3. how soon / как быстро
  const slots = slotFacts();
  if (slots.step > 0) {
    const days = slots.days === 7 ? 'на неделю вперёд' : `на ${plural(slots.days, 'день', 'дня', 'дней')} вперёд`;
    const lead = slots.lead >= 60 && slots.lead % 60 === 0
      ? slots.lead === 60 ? 'не раньше чем через час' : `не раньше чем через ${plural(slots.lead / 60, 'час', 'часа', 'часов')}`
      : slots.lead > 0 ? `не раньше чем через ${slots.lead} минут` : '';
    const a =
      'Как можно скорее: точное время доставки менеджер называет при звонке, когда подтверждает заказ. ' +
      `Можно и ко времени: с ${shortTime(slots.from)} до ${shortTime(slots.to)} с шагом ${slots.step} минут, ${days}${lead ? `, ближайшее — ${lead} после заказа` : ''}.`;
    items.push({ id: 'time', q: 'Как быстро привезёте?', a });
  }

  // 4. payment / оплата — online by card only (the owner, 22.10.2026; «on delivery» is commented out in PayChoice)
  // оплата — только онлайн картой (владелец, 22.10.2026; «При получении» в PayChoice закомментирована)
  {
    const card = DEFAULT_TEXTS.online.charAt(0).toLowerCase() + DEFAULT_TEXTS.online.slice(1);
    const points =
      loyalty.enabled && loyalty.maxSharePercent > 0
        ? ` Если войти в личный кабинет по номеру телефона, до ${loyalty.maxSharePercent} % заказа можно оплатить баллами программы ${quoted(loyalty.name)}.`
        : '';
    // true before and after the bank goes live: in test mode a guest sees no
    // online option, and the manager settles payment on the call
    // верно и до запуска банка, и после: в тестовом режиме гость онлайн-оплаты
    // не видит, и способ оплаты согласует менеджер при звонке
    const a = `Онлайн ${card} сразу после оформления: блюда и доставка одним платежом. Если онлайн-оплата на сайте временно недоступна, способ оплаты согласует менеджер при звонке.${points}`;
    items.push({ id: 'payment', q: 'Как оплатить заказ?', a });
  }

  // 5. pickup / самовывоз
  if (places.length) {
    const count =
      places.length === 1 ? 'из нашей точки' : `из ${NUMBER_WORDS[places.length] ?? places.length} наших точек`;
    const say = (where: string[]) => `Да, самовывоз бесплатный, ${count} в ${CITY_IN}: ${andList(where)}. Когда заказ будет готов, скажем при звонке.`;
    const a = say(places.map((place) => `${place.name} (${scheduleText(place.schedule)})`));
    // on the page a day range stays with its hours: «пн–» never ends a line
    // на странице дни держатся за часы: «пн–» не остаётся в конце строки
    const nw = (piece: string) => `<span class="dfaq-nw">${esc(piece)}</span>`;
    const aHtml = say(places.map((place) => `${nw(place.name)} (${scheduleText(place.schedule, nw)})`));
    items.push({ id: 'pickup', q: 'Можно забрать заказ самому?', a, aHtml });
  }

  // 6. was the order accepted / заказ принят
  {
    const statuses = Object.entries(ORDER_STATUS)
      .filter(([key]) => key !== 'cancelled')
      .map(([, label]) => quoted(label));
    const a =
      'После оформления корзина покажет номер заказа, а менеджер перезвонит, чтобы подтвердить состав, сумму, адрес и время. ' +
      `Если перед оформлением войти в личный кабинет по номеру телефона, статус заказа будет виден там: ${statuses.join(', ')}.`;
    items.push({ id: 'accepted', q: 'Как узнать, что заказ принят?', a, aHtml: esc(a).replace('личный кабинет', link(`${BASE}account/`, 'личный кабинет')) });
  }

  // 7. a cake for a celebration / торт на праздник
  const festive = catalog.categories.find((category) => category.slug === FESTIVE);
  const ready = catalog.categories.find((category) => category.slug === READY && category.products.some((product) => product.available));
  if (festive?.products.length) {
    const hours = mostCommon(festive.products.map((product) => hoursIn(product.description)).filter((value): value is number => value !== null)) ?? hoursIn(home.cakes_text);
    const inscription = festive.products.some((product) => /надпис/iu.test(product.description ?? '') && /комментари/iu.test(product.description ?? ''));
    const lead = hours
      ? `Да: праздничные торты из каталога делаем на заказ за ${plural(hours, 'час', 'часа', 'часов')}.`
      : `Да: праздничные торты на заказ — в разделе ${quoted(festive.title)} каталога.`;
    const tail = [
      inscription ? 'надпись и цвет можно указать в комментарии к заказу' : '',
      ready ? `торт на сегодня можно выбрать в разделе ${quoted(ready.title)}` : '',
    ].filter(Boolean);
    const more = tail.length ? ` ${tail[0].charAt(0).toUpperCase()}${tail[0].slice(1)}${tail[1] ? `, а ${tail[1]}` : ''}.` : '';
    const a = typo(`${lead}${more}`);
    const festiveText = hours ? 'праздничные торты из каталога' : quoted(festive.title);
    let aHtml = esc(a).replace(esc(festiveText), link(`#${festive.slug}`, festiveText));
    if (ready) aHtml = aHtml.replace(esc(quoted(ready.title)), link(`#${ready.slug}`, quoted(ready.title)));
    items.push({ id: 'cakes', q: 'Можно ли заказать торт на праздник?', a, aHtml });
  }

  // 8. something went wrong / что-то пошло не так
  {
    const chats = chatLinks(settings);
    const write = chats.length ? ` или напишите в ${chats.map((chat) => chat.label).join(' или ')}` : '';
    const first = `Позвоните по номеру ${settings.phone}${write}.`;
    const second = deliveryHref ? ' Как отменить заказ, заменить блюдо или вернуть деньги, написано в условиях доставки и оплаты.' : '';
    const a = `${first}${second}`;
    const writeHtml = chats.length ? ` или напишите в ${chats.map((chat) => link(chat.href, chat.label, true)).join(' или ')}` : '';
    const aHtml =
      `Позвоните по номеру <a class="tnum" href="${esc(settings.phoneHref)}">${esc(settings.phone)}</a>${writeHtml}.` +
      (deliveryHref ? ` Как отменить заказ, заменить блюдо или вернуть деньги, написано в ${doc('условиях доставки и оплаты')}.` : '');
    items.push({ id: 'help', q: 'Как связаться, если что-то пошло не так?', a, aHtml });
  }

  // a dash never starts a line, here as everywhere on the site / тире не начинает строку — здесь, как везде на сайте
  // and the page's answer is always a block: a paragraph or the zone list / а ответ страницы — всегда блок: абзац или список зон
  const block = (html: string) => (/^<(p|ul)\b/.test(html) ? html : `<p>${html}</p>`);
  return items.map((item) => ({ ...item, q: typo(item.q), a: typo(item.a), ...(item.aHtml && { aHtml: block(typo(item.aHtml)) }) }));
};

/** Узел `FAQPage` для `@graph` страницы: ответы простым текстом, как на странице. */
export const faqJsonLd = (items: FaqItem[], pageUrl: string) => ({
  '@type': 'FAQPage',
  '@id': `${pageUrl}#faq`,
  mainEntity: items.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
});
