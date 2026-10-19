/**
 * Check of the «Ваши правки опубликованы» wording (`scripts/build-notify.mjs`)
 * on hand-made activity rows: no Directus, no network.
 * Проверка текста «Ваши правки опубликованы» на выдуманных строках журнала:
 * без Directus и без сети.
 *
 * Run / Запуск: `pnpm test` (или node scripts/build-notify.check.mjs)
 */
import assert from 'node:assert/strict';
import { describe } from './build-notify.mjs';

const row = (collection, item, action = 'update') => ({ collection, item: String(item), action });

{
  // the case from 19.10: a dish created as a draft with its photo, and the venue phone changed
  // случай 19.10: блюдо создано черновиком вместе с фото, и поменян телефон точки
  const { counts, lines, drafts } = describe(
    [row('directus_files', 'f1', 'create'), row('products', 122, 'create'), row('places', 1), row('places', 1)],
    {
      products: { 122: { title: 'Корпусная малина', status: 'draft' } },
      places: { 1: { title: 'Садовая, 212Б' } },
      directus_files: { f1: { title: 'Малина' } },
    },
  );
  assert.deepEqual(counts, ['1 точка'], 'черновик не считается опубликованным, фото блюда — часть блюда');
  assert.deepEqual(lines, ['- Точки: «Садовая, 212Б»']);
  assert.deepEqual(drafts, [{ collection: 'products', id: '122', title: 'Корпусная малина' }]);
}
{
  // two dishes and a deletion; a gallery row of an edited venue is not counted twice
  // два блюда и удаление; строка галереи у правленой точки не считается дважды
  const { counts, lines } = describe(
    [row('products', 5), row('products', 6), row('products', 7, 'delete'), row('places', 2), row('places_files', 40, 'create')],
    {
      products: { 5: { title: 'Наполеон', status: 'published' }, 6: { title: 'Эстерхази', status: 'published' } },
      places: { 2: { title: 'Советской Армии, 177' } },
    },
  );
  assert.deepEqual(counts, ['3 блюда', '1 точка']);
  assert.deepEqual(lines, ['- Блюда: «Наполеон», «Эстерхази»; удалено — 1', '- Точки: «Советской Армии, 177»']);
}
{
  // singletons by name, a lone upload is «a file», unknown collections are skipped
  // одиночные — по названию, одна загрузка — «файл», чужие коллекции пропускаются
  const { counts } = describe([row('settings', 1), row('orders', 3), row('notify_settings', 1)], {});
  assert.deepEqual(counts, ['настройки сайта']);
  assert.deepEqual(describe([row('directus_files', 'a', 'create')], {}).counts, ['1 файл']);
  // without titles (the read failed) the counts stay
  // без названий (чтение не удалось) числа остаются
  assert.deepEqual(describe([row('cakes', 1), row('cakes', 2)], {}).lines, ['- Торты: 2']);
}

console.log('уведомления о публикации: тексты и черновики — проверки прошли');
