/**
 * The bottom bar rides on the first screen: hidden while any part of `#top`
 * is in view, shown once it has scrolled past. Width is CSS's business —
 * above 768 the bar is `display: none` and the class changes nothing.
 * Нижняя полоса привязана к первому экрану: пока в кадре есть кусок `#top`,
 * она спрятана, дальше показывается. Ширину решает CSS — выше 768 полоса
 * скрыта, и класс на ней ничего не меняет.
 */

const bar = document.getElementById('sticky-bar');
const hero = document.getElementById('top');

if (bar && hero) {
  new IntersectionObserver(
    ([entry]) => bar.classList.toggle('is-on', !entry.isIntersecting),
    { threshold: 0 },
  ).observe(hero);
}
