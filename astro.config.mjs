// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Домен взят из карточки организации на Яндекс.Картах.
// TODO(клиент): подтвердить, что лендинг едет именно на него.
export default defineConfig({
  site: 'https://vkus-com.ru',
  integrations: [sitemap()],
  build: {
    // страница одна: отдельный файл стилей стоит лишнего похода по сети —
    // на медленной мобильной связи это полсекунды до первой отрисовки
    inlineStylesheets: 'always',
  },
});
