// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Домен взят из карточки организации на Яндекс.Картах.
// TODO(клиент): подтвердить, что лендинг едет именно на него.
// `SITE` и `BASE_PATH` переопределяет превью-сборка на GitHub Pages: там сайт
// живёт в подкаталоге, и без `base` ссылки на ассеты ведут в корень домена.
export default defineConfig({
  site: process.env.SITE ?? 'https://vkus-com.ru',
  base: process.env.BASE_PATH,
  integrations: [sitemap()],
  build: {
    // страница одна: отдельный файл стилей стоит лишнего похода по сети —
    // на медленной мобильной связи это полсекунды до первой отрисовки
    inlineStylesheets: 'always',
  },
});
