/**
 * Booking dialog: one delegated listener opens it from any `[data-book]`.
 * Escape, the close button and a click on the backdrop close it; the focus
 * goes back to the trigger by itself — that is what native `<dialog>` is for.
 * Диалог брони: один делегированный обработчик открывает его от любого
 * `[data-book]`. Закрывают Escape, крестик и клик по фону; фокус на триггер
 * возвращает сам `<dialog>` — ради этого он и нативный.
 */

const dialog = document.getElementById('book') as HTMLDialogElement | null;
const title = document.getElementById('book-title');
const note = document.getElementById('book-note');

if (dialog && title && note) {

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest<HTMLElement>('[data-book]');
    if (!trigger) return;

    event.preventDefault();
    title.textContent = trigger.dataset.book || 'Бронь стола';
    // повод от триггера; строка часов ниже стоит своя и не подменяется
    const hint = trigger.dataset.bookNote ?? '';
    note.textContent = hint;
    note.hidden = !hint;
    dialog.showModal();
  });

  // у клика по подложке цель — сам `<dialog>`: внутри лежит обёртка с паддингом
  // a backdrop click targets the `<dialog>` itself: the padding sits on a wrapper
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
}
