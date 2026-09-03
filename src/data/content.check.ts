/**
 * Проверка контента: пустое поле в админке ломает страницу молча, поэтому
 * фикстура прогоняется через ту же нормализацию, что и сборка, и падает с
 * названием поля. Запуск: `pnpm test` и первым шагом сборки (`prebuild`).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, type Raw, type ResolveImage } from '../lib/content.ts';
import fixture from './fixture.json' with { type: 'json' };

const DIR = 'src/data/fixture-files';
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR) : [];
if (!files.length) throw new Error('нет src/data/fixture-files — запусти pnpm fixture');

// в голом Node `import.meta.glob` недоступен: подменяем резолвер картинок и
// заодно сверяем, что файл фикстуры лежит на диске
const resolve: ResolveImage = (file) => {
  const name = `${file.id}.${file.filename_download.split('.').pop()?.toLowerCase()}`;
  if (!files.includes(name))
    throw new Error(`нет файла ${DIR}/${name} (${file.title ?? file.id}) — запусти pnpm fixture`);
  return `/${DIR}/${name}`;
};

const raw = fixture as unknown as Raw;
const content = normalize(raw, resolve);

// контакты: без телефона страница теряет главное действие
assert.match(
  content.settings.phoneHref,
  /^tel:\+\d{10,}$/,
  `settings.phone: «${content.settings.phone}» не похож на телефон`,
);

// две точки, у каждой семь строк часов
assert.equal(content.places.length, 2, 'places: на сайте ровно две точки');
for (const place of raw.places)
  assert.equal(place.hours?.length, 7, `places «${place.name}»: в часах должно быть семь строк`);

// первый экран и SEO
assert.ok(content.home.hero_image, 'home.hero_image: нет фото первого экрана');
assert.ok(
  content.home.seo_title.length <= 60,
  `home.seo_title: ${content.home.seo_title.length} символов, максимум 60`,
);
assert.ok(
  content.home.seo_description.length <= 160,
  `home.seo_description: ${content.home.seo_description.length} символов, максимум 160`,
);

// пять направлений с разными ключами: кнопки карточек зашиты по ключу
assert.deepEqual(
  content.directions.map((direction) => direction.key).sort(),
  ['banquets', 'cafe', 'catering', 'confectionery', 'restaurant'],
  'directions: нужны ровно пять направлений с разными ключами',
);

// alt обязателен у всех картинок: нормализация валится с именем файла
assert.throws(
  () =>
    normalize(
      { ...raw, home: { ...raw.home, hero_image: { ...raw.home.hero_image, alt: '' } } },
      resolve,
    ),
  /alt пуст/,
);

console.log(
  `контент фикстуры: ${content.places.length} точки, ${content.directions.length} направлений, ` +
    `${content.cakes.length} тортов, ${content.promos.length} акций — все проверки прошли`,
);
