/**
 * Site base path, always slash-terminated. Astro mirrors the `base` option
 * verbatim, so an unslashed `base` glues straight onto the next segment and
 * yields `/subfoldermedia/...`; everything root-absolute goes through here.
 * Базовый путь сайта, всегда со слэшем на конце. Astro отдаёт `base` как есть,
 * и без завершающего слэша он склеивается со следующим сегментом —
 * получается `/subfoldermedia/...`; все корневые ссылки строим через него.
 */

// `?.`: content.check.ts runs this module under plain node, without Vite
// `?.`: content.check.ts гоняет модуль голым node, без Vite
export const BASE = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');
