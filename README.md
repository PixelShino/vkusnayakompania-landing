<div align="center">

# Vkusnaya Kompaniya — bakery landing page

Single-page site for a bakery and kitchen with two locations in Samara, Russia.<br>
Built with **Astro 5**, no UI framework, ~5 kB of JavaScript on the wire.

[![Astro](https://img.shields.io/badge/Astro-5.18-FF5D01?logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
![JS shipped](https://img.shields.io/badge/JS%20shipped-5.4%20kB-6f7546)
![Lighthouse mobile](https://img.shields.io/badge/Lighthouse%20mobile-99%20·%20100%20·%20100%20·%20100-brightgreen)
![Lighthouse desktop](https://img.shields.io/badge/Lighthouse%20desktop-100%20·%20100%20·%20100%20·%20100-brightgreen)

<img src="docs/screenshots/hero.webp" alt="Hero section on desktop" width="900">

</div>

## Screenshots · Скриншоты

| Showcase · Витрина | Contacts · Контакты |
|---|---|
| <img src="docs/screenshots/cakes.webp" alt="Cake showcase with filters" width="440"> | <img src="docs/screenshots/contacts.webp" alt="Contacts with schedule and Yandex map" width="440"> |

| Mobile — hero | Mobile — showcase | Mobile — contacts |
|---|---|---|
| <img src="docs/screenshots/mobile-hero.webp" alt="Mobile hero" width="240"> | <img src="docs/screenshots/mobile-cakes.webp" alt="Mobile showcase" width="240"> | <img src="docs/screenshots/mobile-contacts.webp" alt="Mobile contacts" width="240"> |

<details open>
<summary><b>🇬🇧 English</b> — documentation</summary>

### Highlights

- **No UI framework.** The page has four interactive pieces — a sticky menu, showcase
  filters, "show more", and two lazy iframes. All four are covered by the platform, so
  React would only add weight.
- **Opening status computed in the browser** against `Europe/Samara`, not baked into the
  HTML at build time — a static "Open now" would lie to everyone visiting at night.
- **Business hours live in one place.** A `Schedule` tuple in `src/data/site.ts` renders
  the human-readable table, the status pill and the `openingHours` field of the
  schema.org markup, and it is covered by tests.
- **Reviews come from the official Yandex Maps widget.** Review texts belong to their
  authors and cannot be copied onto a third-party site; only the aggregate numbers are
  quoted, with a link to the source.
- **Images are content, not decoration.** AVIF via `astro:assets`, explicit `srcset`,
  the LCP frame preloaded from the same origin.
- **Accessible by default.** Every text step holds ≥4.5:1 contrast, focus is visible,
  the map and reviews have `noscript` fallbacks, and the page has a skip link.

### Tech stack

| | |
|---|---|
| Framework | [Astro 5](https://astro.build) — static output, zero hydration |
| Language | TypeScript (strict), plain CSS with custom properties |
| Images | `astro:assets` → AVIF, `<Image />` + `getImage()` for the preload |
| Fonts | Montserrat Variable, self-hosted, only Cyrillic and Latin subsets |
| SEO | JSON-LD `@graph` of two `Bakery` nodes, OpenGraph, sitemap, `robots.txt` |
| Tests | `node:assert` — no test runner, Node reads the TypeScript directly |

### Getting started

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
npm run preview  # serve the built site
npm run check    # types and .astro diagnostics
npm test         # schedule and opening-status logic
```

> **Windows note.** Run from a path that matches the on-disk letter case
> (`D:\Code\Projects\…`, not `D:\code\projects\…`). On a mismatch Astro loses compile
> metadata and **silently drops all CSS** from the build.

### Project structure

| Path | What lives there |
|---|---|
| `src/data/site.ts` | contacts, business hours, addresses, every outbound link |
| `src/data/catalog.ts` | cakes, desserts, room photos, order steps, `srcset` helpers |
| `src/data/site.check.ts` | assertions for the schedule and status logic |
| `src/components/` | one component per section of the page |
| `src/layouts/BaseLayout.astro` | meta, OpenGraph, JSON-LD, fonts, LCP preload |
| `src/scripts/lazy-frame.ts` | lazy iframes for the map and reviews, location switching |
| `src/styles/global.css` | design tokens, buttons, shared patterns |
| `docs/` | [design system](docs/DESIGN.md), [product notes](docs/PRODUCT.md), screenshots |
| `handoff/` | original design handoff — reference only, never shipped |

Content changes go into `src/data/`. Section copy lives in the components; everything
enumerable (showcase items, locations, links) lives in the data files.

### How it stays fast

- **CSS is inlined** into the document — no render-blocking stylesheet request.
- **`@font-face` is declared by hand** for the Cyrillic and Latin subsets only. Importing
  the font package pulled in `latin-ext`, `cyrillic-ext` and `vietnamese` — 100+ kB of
  subsets the page never renders a glyph from.
- **The LCP image is preloaded** with the same `srcset`/`sizes` the markup uses, so the
  browser starts the fetch before it parses the page.
- **Sections below the fold are skipped** until they are scrolled into view
  (`content-visibility: auto`). The trade-off is documented in the CSS: anchor jumps are
  instant instead of smooth, because unrendered sections only estimate their height.
- **Third-party widgets are deferred.** Yandex Maps and the reviews widget mount through
  an `IntersectionObserver` and never touch the critical path.

Measured with Lighthouse 12 against a gzip-serving production build: mobile
99 / 100 / 100 / 100 (median of five runs), desktop 100 / 100 / 100 / 100.

### Responsive scale

The design was drawn for three fixed widths — 390 / 834 / 1440. In production those are
custom properties that switch at `768px` and `1200px`:

| | mobile | tablet | desktop |
|---|---|---|---|
| side padding | 18 | 36 | 72 |
| content width | 354 | 762 | 1296 |
| H1 / H2 | 34 / 25 | 47 / 33 | 66 / 42 |
| section padding | 44 | 64 | 92 |
| columns: cakes / desserts | 2 / 2 | 3 / 3 | 4 / 3 |

At the three reference widths the numbers match the design to the pixel; in between they
interpolate with `clamp()`.

### Tests

`npm test` runs `src/data/site.check.ts` — the only logic on the page that cannot be
verified by looking at it, since it depends on the weekday, the time of day and the
Samara time zone:

- schedule → human-readable rows and schema.org `openingHours`
- opening and closing boundaries (open at exactly 08:00, closed at exactly 21:00)
- Saturday's later opening, and midnight rollover into the next day's hours
- Russian plural forms for the rating counters

No runner and no dependencies: `node:assert` plus Node's native TypeScript support.

### Deployment

A push to `main` builds the site and publishes a preview to GitHub Pages
(`.github/workflows/deploy.yml`). The preview is served from a subdirectory, so `site`
and `base` come from the `SITE` and `BASE_PATH` environment variables, and it is marked
`noindex` so it never competes with the production domain in search.

</details>

<details>
<summary><b>🇷🇺 Русский</b> — документация</summary>

### Коротко

- **Без UI-фреймворка.** Интерактива на странице четыре штуки — липкое меню, фильтры
  витрины, «показать ещё» и два ленивых iframe. Всё четыре закрывает платформа, React
  здесь только добавил бы вес.
- **Статус «Открыто / Откроется в 8:00» считается в браузере** по `Europe/Samara`, а не
  вшивается в HTML на сборке: статичная плашка врала бы всем, кто зашёл ночью.
- **Часы работы живут в одном месте.** Кортеж `Schedule` в `src/data/site.ts`
  разворачивается и в человеческую таблицу, и в плашку статуса, и в `openingHours`
  разметки schema.org — и покрыт тестами.
- **Отзывы — официальный виджет Яндекс Карт.** Тексты чужих отзывов принадлежат авторам,
  переносить их на свой сайт нельзя; рядом только цифры с карточки организации — они
  факты и ведут на источник.
- **Фотографии — контент, а не украшение.** AVIF через `astro:assets`, явный `srcset`,
  LCP-кадр предзагружается со своего домена.
- **Доступность из коробки.** Все ступени текста держат контраст ≥4,5:1, фокус виден,
  у карты и отзывов есть `noscript`-запасной вариант, в начале страницы — skip-ссылка.

### Стек

| | |
|---|---|
| Фреймворк | [Astro 5](https://astro.build) — статическая сборка, без гидратации |
| Язык | TypeScript (strict), обычный CSS на кастомных свойствах |
| Картинки | `astro:assets` → AVIF, `<Image />` и `getImage()` для preload |
| Шрифт | Montserrat Variable, свой хостинг, только кириллица и латиница |
| SEO | JSON-LD `@graph` из двух `Bakery`, OpenGraph, sitemap, `robots.txt` |
| Тесты | `node:assert` — без раннера, Node читает TypeScript сам |

### Запуск

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # статика в dist/
npm run preview  # посмотреть собранное
npm run check    # типы и диагностика .astro
npm test         # расписание и статус точек
```

> **Windows-грабли.** Запускать из пути с тем же регистром, что и на диске
> (`D:\Code\Projects\…`, не `D:\code\projects\…`). При расхождении Astro теряет
> метаданные компиляции и **молча выбрасывает весь CSS** из сборки.

### Что где лежит

| Путь | Что это |
|---|---|
| `src/data/site.ts` | контакты, часы, адреса точек, все внешние ссылки |
| `src/data/catalog.ts` | торты, десерты, фото зала, шаги заказа, сборка `srcset` |
| `src/data/site.check.ts` | проверки расписания и статуса |
| `src/components/` | по компоненту на секцию страницы |
| `src/layouts/BaseLayout.astro` | мета, OpenGraph, JSON-LD, шрифт, preload первого экрана |
| `src/scripts/lazy-frame.ts` | ленивые iframe карты и отзывов, переключение точек |
| `src/styles/global.css` | токены, кнопки, общие паттерны |
| `docs/` | [дизайн-система](docs/DESIGN.md), [продукт](docs/PRODUCT.md), скриншоты |
| `handoff/` | исходная выгрузка макета — эталон, в прод не идёт |

Контент меняется в `src/data/`. Тексты секций живут в компонентах, всё перечислимое
(позиции витрины, точки, ссылки) — в данных.

### За счёт чего быстро

- **CSS инлайнится** в документ — нет блокирующего запроса за стилями.
- **`@font-face` объявлен вручную** только для кириллицы и латиницы. Импорт пакета
  тянул ещё `latin-ext`, `cyrillic-ext` и `vietnamese` — 100+ КБ подмножеств, из которых
  на странице нет ни одного символа.
- **LCP-кадр предзагружается** с тем же `srcset`/`sizes`, что и в разметке: браузер
  начинает качать его, не дожидаясь разбора страницы.
- **Секции ниже первого экрана не считаются**, пока до них не долистали
  (`content-visibility: auto`). Плата описана прямо в CSS: переход по якорю стал
  мгновенным вместо плавного — у неотрисованной секции высота лишь оценка.
- **Сторонние виджеты отложены.** Карта и отзывы Яндекса монтируются через
  `IntersectionObserver` и не попадают в критический путь.

Замерено `Lighthouse 12` на продакшен-сборке с gzip: мобильный 99 / 100 / 100 / 100
(медиана из пяти прогонов), десктоп 100 / 100 / 100 / 100.

### Адаптив

Макет нарисован под три фиксированные ширины — 390 / 834 / 1440. В проде это
CSS-переменные, переключающиеся на `768px` и `1200px`:

| | телефон | планшет | десктоп |
|---|---|---|---|
| боковой отступ | 18 | 36 | 72 |
| контент | 354 | 762 | 1296 |
| H1 / H2 | 34 / 25 | 47 / 33 | 66 / 42 |
| отступ секции | 44 | 64 | 92 |
| колонки: торты / десерты | 2 / 2 | 3 / 3 | 4 / 3 |

В контрольных ширинах цифры совпадают с макетом до пикселя, между ними тянутся
через `clamp()`.

### Тесты

`npm test` прогоняет `src/data/site.check.ts` — единственную логику на странице, которую
нельзя проверить глазами: она зависит от дня недели, времени суток и часового пояса
Самары.

- расписание → человеческие строки и `openingHours` для schema.org
- границы открытия и закрытия (в 8:00 уже открыто, в 21:00 уже нет)
- субботнее «с 8:30» и переход через полночь в часы следующего дня
- склонение числительных в счётчиках оценок

Ни раннера, ни зависимостей: `node:assert` и встроенная поддержка TypeScript в Node.

### Выкладка

Пуш в `main` собирает сайт и выкладывает превью на GitHub Pages
(`.github/workflows/deploy.yml`). Превью живёт в подкаталоге, поэтому `site` и `base`
приходят из переменных `SITE` и `BASE_PATH`, а сама страница помечена `noindex` — чтобы
не конкурировать в поиске с боевым доменом.

</details>

## Related · Соседние ресурсы

| | |
|---|---|
| Delivery shop · Магазин доставки | [vkusdostavka.shop](https://vkusdostavka.shop/) |
| Catering · Кейтеринг и банкеты | [vkusnayakompania.ru](https://vkusnayakompania.ru/) |
| Apps · Приложение | [App Store](https://apps.apple.com/app/id6477568088) · [Google Play](https://play.google.com/store/apps/details?id=com.foodpicasso.cateringvkusnaya) |
| Social · Соцсети | [VK](https://vk.ru/vkusnayakompania) · [Telegram](https://t.me/vkusnayakompania) |
