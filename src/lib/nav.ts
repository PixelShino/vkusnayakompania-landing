/**
 * Header and footer links built from the content: both depend on what the
 * editor filled in, not on a hand-kept list.
 * Ссылки шапки и подвала считаются из контента: их состав зависит от того,
 * что заполнено в админке, а не от списка в коде.
 */
import type { Content } from './content.ts';

/** Пункты шапки; «Афиша» появляется только при текущей афише. */
export const navFor = (content: Content) => [
  { label: 'Главная', href: '#top' },
  ...(content.afisha ? [{ label: 'Афиша', href: '#afisha' }] : []),
  { label: 'Доставка', href: '#delivery' },
  { label: 'О нас', href: '#about' },
  { label: 'Меню', href: '#menu' },
  { label: 'Контакты', href: '#contacts' },
];

/** Ссылки подвала: незаполненные в админке не рисуются. */
export const footerLinksFor = ({ settings }: Content) =>
  [
    { label: 'Магазин доставки', href: settings.shop_url },
    { label: 'Кейтеринг и банкеты', href: settings.catering_url },
    { label: 'App Store', href: settings.app_ios },
    { label: 'Google Play', href: settings.app_android },
    { label: 'ВКонтакте', href: settings.vk },
    { label: 'Telegram', href: settings.telegram },
  ].filter((link) => Boolean(link.href)) as { label: string; href: string }[];
