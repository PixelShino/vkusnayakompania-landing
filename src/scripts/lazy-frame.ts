/**
 * Ленивый iframe для виджетов Яндекса: кадр подставляется, когда контейнер
 * подходит к экрану. Переключают кнопки `[data-frame-target="имя"]` с
 * `data-src`, подпись рядом — `[data-frame-label]`.
 */

const mountFrame = (holder: HTMLElement) => {
  const name = holder.dataset.frame ?? '';
  const label = document.querySelector<HTMLElement>(`[data-frame-label='${name}']`);
  const targets = [...document.querySelectorAll<HTMLElement>(`[data-frame-target='${name}']`)];
  let frame: HTMLIFrameElement | null = null;

  const mount = (src: string) => {
    if (frame) {
      frame.src = src;
      return;
    }
    frame = document.createElement('iframe');
    frame.src = src;
    frame.title = holder.dataset.frameTitle ?? '';
    frame.loading = 'lazy';
    frame.allowFullscreen = true;
    frame.addEventListener('load', () => holder.classList.add('is-loaded'));
    holder.appendChild(frame);
  };

  targets.forEach((target) => {
    target.addEventListener('click', () => {
      targets.forEach((other) => {
        other.setAttribute('aria-pressed', String(other === target));
        other.closest('[data-place]')?.classList.toggle('is-shown', other === target);
      });
      if (label) label.textContent = target.dataset.frameName ?? '';
      mount(target.dataset.src ?? '');
      // виджет может лежать ниже кнопки
      holder.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  const start = () => mount(holder.dataset.src ?? '');

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
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
