/**
 * Ленивый iframe для виджетов Яндекса: кадр подставляется, когда контейнер
 * подходит к экрану. Переключают кнопки `[data-frame-target="имя"]` с
 * `data-src`, подпись рядом — `[data-frame-label]`, ссылка на карточку —
 * `[data-frame-link]` (адрес берётся из `data-frame-href` активной кнопки).
 */

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** столько ждём ответа Яндекса: столько же держит ветка JS API карты */
const TIMEOUT = 8000;

const mountFrame = (holder: HTMLElement) => {
  const name = holder.dataset.frame ?? '';
  const label = document.querySelector<HTMLElement>(`[data-frame-label='${name}']`);
  const links = [...document.querySelectorAll<HTMLAnchorElement>(`[data-frame-link='${name}']`)];
  const targets = [...document.querySelectorAll<HTMLElement>(`[data-frame-target='${name}']`)];
  let frame: HTMLIFrameElement | null = null;
  let observer: IntersectionObserver | null = null;

  // The holder keeps the current address, so a late observer cannot roll it back.
  // Текущий адрес живёт на контейнере: опоздавший наблюдатель не откатит кадр.
  const mount = (src: string) => {
    holder.dataset.src = src;
    if (frame) {
      frame.src = src;
      return;
    }
    frame = document.createElement('iframe');
    frame.src = src;
    frame.title = holder.dataset.frameTitle ?? '';
    frame.loading = 'lazy';
    frame.allowFullscreen = true;
    // не ответил — показываем отказ: пустая коробка с «Загружаем…» висела вечно
    const fail = () => {
      if (holder.classList.contains('is-loaded')) return;
      holder.classList.add('is-failed');
      const note = holder.querySelector('[data-frame-note]');
      if (note) note.textContent = 'Не загрузилось — откройте на Яндекс Картах';
    };
    const timer = setTimeout(fail, TIMEOUT);
    frame.addEventListener('load', () => {
      clearTimeout(timer);
      holder.classList.add('is-loaded');
    });
    frame.addEventListener('error', fail);
    holder.appendChild(frame);
  };

  targets.forEach((target) => {
    target.addEventListener('click', () => {
      // The scroll below wakes the observer up; the frame is already mounted.
      // Прокрутка ниже будит наблюдатель, а кадр уже смонтирован — он лишний.
      observer?.disconnect();
      targets.forEach((other) => {
        other.setAttribute('aria-pressed', String(other === target));
        other.closest('[data-place]')?.classList.toggle('is-shown', other === target);
      });
      if (label) label.textContent = target.dataset.frameName ?? '';
      const href = target.dataset.frameHref;
      if (href) links.forEach((link) => (link.href = href));
      mount(target.dataset.src ?? '');
      // виджет может лежать ниже кнопки
      holder.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    });
  });

  // First show only: after a click the frame already carries its own address.
  // Только первый показ: после клика кадр уже стоит на своём адресе.
  const start = () => {
    if (!frame) mount(holder.dataset.src ?? '');
  };

  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          start();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(holder);
  } else {
    start();
  }
};

document.querySelectorAll<HTMLElement>('[data-frame]').forEach(mountFrame);
