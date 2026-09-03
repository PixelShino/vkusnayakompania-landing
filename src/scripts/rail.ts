/**
 * Horizontal rails: `[data-rail-prev]` / `[data-rail-next]` inside a
 * `[data-rail-group]` scroll the group's `[data-rail]` by one frame and go
 * disabled at the ends. Smooth scroll only without reduced motion.
 * Горизонтальные рельсы: стрелки `[data-rail-prev]` / `[data-rail-next]`
 * внутри `[data-rail-group]` прокручивают ленту на кадр и гаснут на краях.
 * Плавность включается только без `prefers-reduced-motion`.
 */

const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;

const sync = (rail: HTMLElement, prev: HTMLButtonElement | null, next: HTMLButtonElement | null) => {
  // до раскрытия `content-visibility` ширины нулевые — тогда решать нечего
  // widths are zero until `content-visibility` unskips the section — nothing to decide yet
  if (!rail.clientWidth) return;
  const max = rail.scrollWidth - rail.clientWidth - 1;
  prev?.toggleAttribute('disabled', rail.scrollLeft <= 0);
  next?.toggleAttribute('disabled', rail.scrollLeft >= max);
};

document.querySelectorAll<HTMLElement>('[data-rail]').forEach((rail) => {
  const group = rail.closest('[data-rail-group]');
  const prev = group?.querySelector<HTMLButtonElement>('[data-rail-prev]') ?? null;
  const next = group?.querySelector<HTMLButtonElement>('[data-rail-next]') ?? null;
  const update = () => sync(rail, prev, next);

  const step = () => {
    const frame = rail.firstElementChild?.getBoundingClientRect().width ?? rail.clientWidth;
    return frame + (parseFloat(getComputedStyle(rail).columnGap) || 0);
  };

  const go = (direction: number) =>
    rail.scrollBy({ left: direction * step(), behavior: smooth ? 'smooth' : 'auto' });

  prev?.addEventListener('click', () => go(-1));
  next?.addEventListener('click', () => go(1));
  rail.addEventListener('scroll', update, { passive: true });
  // ResizeObserver ловит момент, когда секция наконец получила размеры
  // ResizeObserver catches the moment the section finally gets its size
  new ResizeObserver(update).observe(rail);
});
