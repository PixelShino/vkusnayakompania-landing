# SEO, AEO и GEO: как сайт виден поиску и нейросетям

Что сделано 23–24.10.2026 по просьбе владельца («оптимизация по максимуму»),
где это лежит и как поддерживать. Семантическое ядро и план страниц —
[seo-core-2026-10-23.md](seo-core-2026-10-23.md) (282 запроса, 27 кластеров,
частоты Wordstat по Самаре и живые позиции на 23.10.2026).

## Файлы для роботов

- **`/robots.txt`** (`public/robots.txt`): общая группа `Allow: /` и отдельные
  группы для роботов поисковиков и нейросетей (YandexBot, GPTBot,
  OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web, anthropic-ai,
  PerplexityBot, Google-Extended, Applebot-Extended, CCBot, Amazonbot,
  YandexAdditional). В каждой группе `Disallow: /account/` — личный кабинет.
  У YandexBot `Clean-param` для utm/yclid/ysclid/gclid/fbclid. `Sitemap:` и
  комментарий со ссылками на `/llms.txt` и `/llms-full.txt`.
- **`/llms.txt` и `/llms-full.txt`** (`src/pages/llms*.txt.ts`,
  сборщик `src/lib/llms.ts`, тест `src/lib/llms.check.ts`): собираются при
  каждой сборке из данных Directus — точки с часами и телефонами, каталог
  (в полной версии все позиции с ценами), зоны доставки с ценами из
  расширения `delivery`, форматы и FAQ кейтеринга, документы текстом,
  контакты (Max только с настоящей ссылкой), реквизиты. Формат llmstxt.org.
  Новые страницы добавлять в `src/lib/llms.ts` (раздел «О компании» /
  «Кейтеринг»).
- **IndexNow** (`scripts/indexnow.mjs`, ключ `public/<ключ>.txt`): после
  публикации релиза `deploy/build.sh` сравнивает HTML страниц из sitemap с
  прошлым состоянием (`/srv/vkus/indexnow-state.json`, вне репозитория) и
  отправляет изменившиеся адреса одним POST на `yandex.com/indexnow`. Сбой
  сети не роняет сборку, строка `IndexNow: N адресов → код` в логе сборки.
  Проверка без отправки: `node scripts/indexnow.mjs dist https://vkus-com.ru --dry-run`.

## Разметка Schema.org

Граф каждой страницы строит `src/lib/seo.ts` (`layoutGraph`) в
`BaseLayout.astro`: `Organization` (`#org`: реквизиты, логотип, телефон,
`sameAs` — ВКонтакте, Telegram, Max, сеть на Яндекс Картах, 2ГИС из
`src/data/site.ts`), `WebSite`, две точки (`Bakery` Садовая и `Restaurant`
Советской Армии: часы `openingHoursSpecification`, гео, бронь,
`OrderAction` в каталог, фото зала), `WebPage` самой страницы (тип, крошки и
доп. поля — через проп `schema` раскладки). Свои узлы страницы добавляют через
`slot="head"` с `@id` вида `…#list`, `…#faq`, `…#breadcrumb`:

- `/catalog/`: `ItemList` с `Product`/`Offer`, `BreadcrumbList`, `FAQPage`
  (блок «Вопросы о доставке», `src/lib/delivery-faq.ts`, ответы из данных
  доставки и точек);
- кейтеринг (`src/lib/catering-seo.ts`): `FoodEstablishment` с
  `parentOrganization`, `Service` с `provider: #org` и
  `UnitPriceSpecification` («за гостя», «за бокс»), `FAQPage` на
  `/catering/faq/`;
- документы: `CollectionPage`/`WebPage`/`ContactPage` с `about: #org`.

Правило: без `aggregateRating` с чужих площадок (Google запрещает) и без
фактов, которых нет в данных (`hasMenu` появится, когда PDF-меню в админке
заменят с заглушек на настоящие). Проверка: `node src/lib/seo.check.ts`
(в `pnpm test`); по собранному `dist` — скрипт разбора всех `ld+json`
(уникальные `@id`, нет `null`/`undefined`, ссылки `{@id}` находят узел).

## Метатеги

`BaseLayout` печатает `title`, `description`, `canonical`, `robots`
(noindex на превью и в кабинете), Open Graph, `yandex-verification` (поле
«Код Яндекс Вебмастера» в «Настройках сайта»), Метрику (поле «Счётчик
Яндекс Метрики»; номер печатается в скрипт буквально — проверка Метрики
ищет `ym(<номер>` в исходнике) и, по просьбе владельца, `keywords` (проп
`keywords`, поисковики его не учитывают, вреда нет).

## Посадочные страницы ядра

Список и анкоры — `LANDINGS`/`landingGroupsFor` в `src/lib/nav.ts`, вторая
колонка подвала. Реестры текстов: `src/data/landings-shop.ts` (торты,
десерты, завтраки, меню, точки) и `src/data/landings-catering.ts`
(корпоративы, банкетный зал, фуршет, день рождения). Title ≤ 60, description
140–160, один H1 с запросом; факты только из данных админки. Не сделаны до
решения владельца: `/business-lunch/` (нет цены и состава), `/catering/memorial/`
(услуга не заявлена), бенто-торты (нет в ассортименте).

## Что смотреть после выкатки

1. Яндекс Вебмастер: подтвердить сайт (метатег уже на страницах), добавить
   `https://vkus-com.ru/sitemap-index.xml`, через неделю — «Страницы в поиске»
   и «Диагностика».
2. Метрика: визиты пошли, вебвизор пишет.
3. Лог сборки: строка IndexNow с кодом 200/202.
4. PDF-заглушка «Menu restaurant (sample)» в индексе: заменить в админке
   настоящим меню.
5. Старые домены `vkusnayakompania.ru` и `vkusdostavka.shop`: при закрытии —
   постраничные 301 по карте из отчёта ядра.
