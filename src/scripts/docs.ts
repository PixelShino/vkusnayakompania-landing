/**
 * Document pages: «Распечатать», «Скопировать реквизиты» and the table of
 * contents that follows the reading. Both buttons are hidden in the markup and
 * appear only here — without a script they would do nothing.
 * Страницы документов: «Распечатать», «Скопировать реквизиты» и оглавление,
 * которое идёт за чтением. Обе кнопки в разметке скрыты и появляются только
 * здесь — без скрипта они ничего бы не делали.
 */

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-print]')) {
  button.hidden = false;
  button.addEventListener('click', () => window.print());
}

// the clipboard needs a secure context; on plain http the button stays hidden
// буферу обмена нужен защищённый контекст; на голом http кнопка не появляется
if (navigator.clipboard && window.isSecureContext) {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    const label = button.querySelector<HTMLElement>('[data-copy-label]');
    const idle = label?.textContent ?? '';
    let timer = 0;
    button.hidden = false;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy ?? '');
        if (label) label.textContent = 'Скопировано';
      } catch {
        if (label) label.textContent = 'Не скопировалось — выделите текст';
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (label) label.textContent = idle;
      }, 2400);
    });
  }
}

// a tap on a section in the folded contents closes it: the text is what the guest wants now
// нажатие на раздел в свёрнутом оглавлении закрывает его: гостю теперь нужен текст
for (const fold of document.querySelectorAll<HTMLDetailsElement>('.doc-toc--fold')) {
  fold.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) fold.open = false;
  });
}

// The side contents mark the section being read: the last heading that has
// passed a line at a third of the screen. Measured on scroll, once a frame:
// an observer missed a jump straight to the top and kept the old mark.
// Боковое оглавление отмечает читаемый раздел: последний заголовок, прошедший
// линию на трети экрана. Меряется на прокрутке, раз за кадр: наблюдатель
// пропускал прыжок сразу наверх и оставлял старую отметку.
const side = document.querySelector<HTMLElement>('[data-toc]');
if (side) {
  const links = new Map(
    [...side.querySelectorAll<HTMLAnchorElement>('[data-toc-link]')].map((link) => [link.dataset.tocLink!, link]),
  );
  const headings = [...links.keys()]
    .map((id) => document.getElementById(id))
    .filter((heading): heading is HTMLElement => Boolean(heading));
  let frame = 0;
  const mark = () => {
    frame = 0;
    // the side contents are shown from 1200 px only; narrower, nothing to mark
    // боковое оглавление видно только с 1200 px; уже — отмечать нечего
    if (!side.offsetParent) return;
    const line = window.innerHeight / 3;
    let current: HTMLElement | undefined;
    for (const heading of headings) if (heading.getBoundingClientRect().top <= line) current = heading;
    for (const [id, link] of links) {
      if (id === current?.id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(mark);
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  mark();
}
