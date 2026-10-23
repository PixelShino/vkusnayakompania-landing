/**
 * `/llms.txt`: the site for language models in the llmstxt.org format — who
 * we are, the venues, delivery, catering, documents, contacts and requisites,
 * each with a link. Built with the pages from the same content
 * (`src/lib/llms.ts`); the full version is `/llms-full.txt`.
 * `/llms.txt`: сайт для языковых моделей в формате llmstxt.org — кто мы,
 * точки, доставка, кейтеринг, документы, контакты и реквизиты, у каждого
 * пункта ссылка. Собирается вместе со страницами из того же контента
 * (`src/lib/llms.ts`); полная версия — `/llms-full.txt`.
 */
import type { APIRoute } from 'astro';
import { BASE } from '../lib/base.ts';
import { getContent } from '../lib/content.ts';
import { buildLlms, loadZones } from '../lib/llms.ts';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const root = new URL(BASE, site ?? 'https://vkus-com.ru');
  const text = buildLlms(await getContent(), root, { zones: await loadZones() });
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
