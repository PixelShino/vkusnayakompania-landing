/**
 * Header and footer links built from the content: both depend on what the
 * editor filled in, not on a hand-kept list.
 * Ссылки шапки и подвала считаются из контента: их состав зависит от того,
 * что заполнено в админке, а не от списка в коде.
 */
import type { Content } from './content.ts';
import { BASE } from './base.ts';

/**
 * Where «Заказать доставку» leads: our own catalog — it is the shop now. An
 * empty catalog is not a dead end either: its page says to call.
 * Куда ведёт «Заказать доставку»: в свой каталог — теперь он и есть магазин.
 * Пустой каталог тоже не тупик: его страница предлагает позвонить.
 */
export const orderLinkFor = (_content: Content) => ({ href: `${BASE}catalog/`, external: false });

/** Ссылка на раздел каталога, если он есть: «Торты в наличии» из секции тортов. */
export const catalogSectionHref = ({ catalog }: Content, slug: string) =>
  catalog.categories.some((category) => category.slug === slug) ? `${BASE}catalog/#${slug}` : undefined;

/** Страница кейтеринга и банкетов: с 12.10.2026 она на этом сайте, а не на старом. */
export const CATERING = `${BASE}catering/`;

/**
 * Пункты шапки; «Афиша» появляется только при текущей афише. `base` — префикс
 * пути: на главной якорь голый, на 404 он должен вести на главную.
 */
export const navFor = (content: Content, base = '') => [
  { label: 'Главная', href: `${base}#top` },
  ...(content.afisha ? [{ label: 'Афиша', href: `${base}#afisha` }] : []),
  // with a catalog «Доставка» is the catalog itself, without — the delivery section
  // с каталогом «Доставка» — это сам каталог, без него — секция доставки
  { label: 'Доставка', href: content.catalog.count > 0 ? `${BASE}catalog/` : `${base}#delivery` },
  // catering and banquets live on this site: one page with two more under it
  // кейтеринг и банкеты живут на этом сайте: страница и две вложенные
  { label: 'Кейтеринг', href: CATERING },
  { label: 'О нас', href: `${base}#about` },
  { label: 'Меню', href: `${base}#menu` },
  { label: 'Контакты', href: `${base}#contacts` },
];

/**
 * Whether a header link points at the page shown or at the section it belongs
 * to: `page` for the very page, `true` for its parent («Кейтеринг» while on
 * /catering/faq/). Anchors on the home page are never current.
 * Ведёт ли ссылка шапки на открытую страницу или на её раздел: `page` — на саму
 * страницу, `true` — на родителя («Кейтеринг», пока открыта /catering/faq/).
 * Якоря главной текущими не бывают.
 */
export const currentOf = (href: string, here: string) => {
  if (href.includes('#')) return undefined;
  const norm = (path: string) => path.replace(/\/?$/, '/');
  if (norm(href) === norm(here)) return 'page' as const;
  return norm(here).startsWith(norm(href)) && norm(href) !== BASE ? ('true' as const) : undefined;
};

type Link = { label: string; href: string };
const filled = (links: { label: string; href?: string }[]) =>
  links.filter((link) => Boolean(link.href)) as Link[];

/**
 * Footer links by group; what is empty in the admin is not drawn. There are no
 * «other sites» any more: the shop is the catalog and catering is `/catering/`,
 * both among the sections.
 * Ссылки подвала по группам: незаполненные в админке не рисуются. «Других
 * сайтов» больше нет: магазин — это каталог, кейтеринг — `/catering/`, оба
 * стоят среди разделов.
 */
export const footerGroupsFor = ({ settings }: Content) => ({
  social: filled([
    { label: 'ВКонтакте', href: settings.vk },
    { label: 'Telegram', href: settings.telegram },
    { label: 'Max', href: settings.max },
  ]),
});
