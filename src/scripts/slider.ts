/**
 * Photo strips: the gallery and the venue frames. One root with `data-slider`
 * is one strip; its rail, arrows, counter, progress line and caption are
 * looked up inside the root, so two strips on a page never see each other.
 * Arrows, keys and mouse drag move the rail; the current frame is the one
 * nearest the rail's centre. Edges are marked with `aria-disabled` rather
 * than `disabled`: a native disabled button drops the keyboard focus to
 * `<body>` mid-scroll.
 * Ленты фото: галерея и кадры залов. Один корень с `data-slider` — одна
 * лента; её рельс, стрелки, счётчик, прогресс и подпись ищутся внутри корня,
 * поэтому две ленты на странице не видят друг друга. Рельс двигают стрелки,
 * клавиши и мышь; текущий кадр — ближайший к центру рельса. Край помечается
 * `aria-disabled`, а не `disabled`: нативно погашенная кнопка роняет фокус
 * на `<body>` прямо во время прокрутки.
 */
const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;

const off = (button: HTMLButtonElement | null) => button?.getAttribute('aria-disabled') === 'true';

const mount = (root: HTMLElement) => {
  const rail = root.querySelector<HTMLElement>('[data-slider-rail]');
  if (!rail) return;
  const prev = root.querySelector<HTMLButtonElement>('[data-slider-prev]');
  const next = root.querySelector<HTMLButtonElement>('[data-slider-next]');
  const now = root.querySelector<HTMLElement>('[data-slider-now]');
  const fill = root.querySelector<HTMLElement>('[data-slider-fill]');
  const caption = root.querySelector<HTMLElement>('[data-slider-cap]');
  const frames = Array.from(rail.children) as HTMLElement[];

  // offset that puts a frame in the middle of the rail
  // смещение, при котором кадр стоит посередине рельса
  const leftFor = (frame: HTMLElement) => frame.offsetLeft - (rail.clientWidth - frame.offsetWidth) / 2;

  const current = () => {
    const centre = rail.scrollLeft + rail.clientWidth / 2;
    let best = 0;
    let gap = Infinity;
    frames.forEach((frame, i) => {
      const d = Math.abs(frame.offsetLeft + frame.offsetWidth / 2 - centre);
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    return best;
  };

  const sync = () => {
    // while `content-visibility` skips the section the frames are not laid
    // out and both widths match: judging by them would kill both arrows
    // пока секцию пропускает `content-visibility`, кадры не разложены и обе
    // ширины равны: по ним обе стрелки погасли бы навсегда
    if (rail.scrollWidth <= rail.clientWidth) return;
    const i = current();
    prev?.setAttribute('aria-disabled', String(i === 0));
    next?.setAttribute('aria-disabled', String(i === frames.length - 1));
    if (now) now.textContent = String(i + 1).padStart(2, '0');
    fill?.style.setProperty('--i', String(i));
    // the caption names the frame in the middle; the frame carries it itself
    // подпись называет кадр в центре; кадр несёт её на себе
    if (caption) caption.textContent = frames[i]?.dataset.caption ?? '';
  };

  const goTo = (i: number) => {
    const frame = frames[Math.max(0, Math.min(frames.length - 1, i))];
    if (!frame) return;
    rail.scrollTo({ left: leftFor(frame), behavior: smooth ? 'smooth' : 'auto' });
  };

  const go = (direction: number) => {
    if (direction < 0 ? off(prev) : off(next)) return;
    goTo(current() + direction);
  };

  prev?.addEventListener('click', () => go(-1));
  next?.addEventListener('click', () => go(1));
  rail.addEventListener('scroll', sync, { passive: true });

  // snap fights the native arrow-key scroll, so we page by frame ourselves
  // снап отбирает нативную прокрутку стрелками, поэтому листаем кадрами сами
  rail.addEventListener('keydown', (event) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    go(direction);
  });

  // the mouse drags the strip like a finger: snap is off while captured and
  // the strip settles on the nearest frame once released
  // мышью ленту тянут как пальцем: на время захвата снап выключен, после
  // отпускания лента сама доснапится к ближайшему кадру
  let dragX = 0;
  let dragLeft = 0;
  rail.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    dragX = event.clientX;
    dragLeft = rail.scrollLeft;
    rail.classList.add('is-dragging');
    rail.setPointerCapture(event.pointerId);
  });
  rail.addEventListener('pointermove', (event) => {
    if (!rail.classList.contains('is-dragging')) return;
    rail.scrollLeft = dragLeft - (event.clientX - dragX);
  });
  const release = () => {
    if (!rail.classList.contains('is-dragging')) return;
    rail.classList.remove('is-dragging');
    goTo(current());
  };
  rail.addEventListener('pointerup', release);
  rail.addEventListener('pointercancel', release);

  // ResizeObserver catches the moment the section finally gets its size
  // ResizeObserver ловит момент, когда секция наконец получила размеры
  new ResizeObserver(sync).observe(rail);
};

document.querySelectorAll<HTMLElement>('[data-slider]').forEach(mount);
