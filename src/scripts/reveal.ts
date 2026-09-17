/**
 * Scroll reveal: a `[data-reveal]` block gets `is-in` once it enters the
 * viewport, and CSS in global.css does the rest (the mark draws its whiskers,
 * the children rise in a short stagger). One observer, once per block, never
 * re-armed. Without IntersectionObserver or under reduced motion every block
 * is shown at once.
 * Появление при прокрутке: блок `[data-reveal]` получает `is-in`, когда входит
 * в окно, остальное делает CSS в global.css (марка рисует усы, дети поднимаются
 * короткой лесенкой). Один наблюдатель, один раз на блок, повторно не взводится.
 * Без IntersectionObserver и при reduced-motion всё показывается сразу.
 */
const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));

const showAll = () => blocks.forEach((block) => block.classList.add('is-in'));

if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
  showAll();
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    // the block is a fifth in before it moves: not on the first pixel, not too late
    // блок входит на пятую часть, и только тогда идёт: не с первого пикселя, но и не поздно
    { threshold: 0.2, rootMargin: '0px 0px -6% 0px' },
  );
  blocks.forEach((block) => observer.observe(block));
}
