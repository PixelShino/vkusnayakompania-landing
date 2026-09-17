/**
 * Header and footer links built from the content: both depend on what the
 * editor filled in, not on a hand-kept list.
 * Ссылки шапки и подвала считаются из контента: их состав зависит от того,
 * что заполнено в админке, а не от списка в коде.
 */
import type { Content } from './content.ts';

/**
 * Пункты шапки; «Афиша» появляется только при текущей афише. `base` — префикс
 * пути: на главной якорь голый, на 404 он должен вести на главную.
 */
export const navFor = (content: Content, base = '') => [
  { label: 'Главная', href: `${base}#top` },
  ...(content.afisha ? [{ label: 'Афиша', href: `${base}#afisha` }] : []),
  { label: 'Доставка', href: `${base}#delivery` },
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
  more: filled([
    { label: 'Магазин доставки', href: settings.shop_url },
    { label: 'Кейтеринг и банкеты', href: settings.catering_url },
    { label: 'App Store', href: settings.app_ios },
    { label: 'Google Play', href: settings.app_android },
  ]),
});
