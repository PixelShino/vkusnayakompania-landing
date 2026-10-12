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
  { label: 'О нас', href: `${base}#about` },
  { label: 'Меню', href: `${base}#menu` },
  { label: 'Контакты', href: `${base}#contacts` },
];

type Link = { label: string; href: string };
const filled = (links: { label: string; href?: string }[]) =>
  links.filter((link) => Boolean(link.href)) as Link[];

/** Ссылки подвала по группам: незаполненные в админке не рисуются. */
export const footerGroupsFor = ({ settings }: Content) => ({
  social: filled([
    { label: 'ВКонтакте', href: settings.vk },
    { label: 'Telegram', href: settings.telegram },
    { label: 'Max', href: settings.max },
  ]),
  // other sites of the company; the delivery shop and the app stores are not
  // here — the catalog on this site is the shop now
  // другие сайты компании; магазина доставки и магазинов приложений здесь нет —
  // теперь магазин — это каталог на этом сайте
  more: filled([{ label: 'Кейтеринг и банкеты', href: settings.catering_url }]),
});
