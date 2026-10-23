/**
 * `/llms-full.txt`: everything `/llms.txt` lists, with the content itself —
 * the delivery catalog with prices, the catering formats and questions, the
 * documents as plain text. One file a model can read instead of the site.
 * `/llms-full.txt`: всё, что перечисляет `/llms.txt`, вместе с самим
 * содержимым — каталог доставки с ценами, форматы и вопросы кейтеринга,
 * документы простым текстом. Один файл, который модель прочтёт вместо сайта.
 */
import type { APIRoute } from 'astro';
import { BASE } from '../lib/base.ts';
import { getContent } from '../lib/content.ts';
import { buildLlms, loadZones } from '../lib/llms.ts';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const root = new URL(BASE, site ?? 'https://vkus-com.ru');
  const text = buildLlms(await getContent(), root, { full: true, zones: await loadZones() });
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
