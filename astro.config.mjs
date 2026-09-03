// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { loadEnv } from './scripts/env.mjs';

// Astro fills import.meta.env from .env, but not process.env this config reads
// Astro кладёт .env в import.meta.env, но не в process.env, который читает конфиг
loadEnv();

// Images from Directus are fetched at build time from this host (token in the URL)
// Картинки из Directus сборка тянет с этого хоста, токен в адресе
const directus = process.env.DIRECTUS_URL ? new URL(process.env.DIRECTUS_URL) : null;

export default defineConfig({
  // SITE/BASE_PATH come from the environment: preview builds live on another host
  // SITE/BASE_PATH из окружения: превью живёт на другом хосте
  site: process.env.SITE ?? 'https://vkus-com.ru',
  base: process.env.BASE_PATH,
  integrations: [sitemap()],
  build: { inlineStylesheets: 'always' },
  image: {
    remotePatterns: directus
      ? [{ protocol: directus.protocol.replace(':', ''), hostname: directus.hostname }]
      : [],
  },
});