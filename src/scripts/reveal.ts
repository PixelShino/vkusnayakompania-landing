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
/** дольше самой длинной пары «задержка + длительность» в `global.css` */
const DONE = 1500;

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
        // The mask is dropped once it has finished. `clip-path: inset(0)` is the
        // element's own box, and display antiqua with `line-height: 0.9` stands
        // 17–27 px above it — at rest the mask cut the tops off «26» and «20 %».
        // Маска снимается, когда отработала. `clip-path: inset(0)` — это бокс
        // самого элемента, а дисплейная антиква с `line-height: 0.9` выходит за
        // него на 17–27 px: в покое маска срезала верх у «26» и «20 %».
        window.setTimeout(() => entry.target.classList.add('is-done'), DONE);
        observer.unobserve(entry.target);
      }
    },
    // the block is a fifth in before it moves: not on the first pixel, not too late
    // блок входит на пятую часть, и только тогда идёт: не с первого пикселя, но и не поздно
    { threshold: 0.2, rootMargin: '0px 0px -6% 0px' },
  );
  blocks.forEach((block) => observer.observe(block));
}
