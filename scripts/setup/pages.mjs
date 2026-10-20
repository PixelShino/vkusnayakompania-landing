// Rights and the list of «Документы» (`pages`: the offer, the privacy policy,
// delivery and payment, the requisites), called at the end of
// `scripts/directus-setup.mjs`. Idempotent like the rest of the setup.
// Права и список «Документов» (`pages`: оферта, политика конфиденциальности,
// доставка и оплата, реквизиты), вызывается в конце `scripts/directus-setup.mjs`.
// Повторный запуск ничего не дублирует.
//
//   «Редактор» — reads, creates and edits documents; deletes none: a document
//                taken off the site goes to the archive, so its address and
//                its history stay;
//   «Редактор» — читает, создаёт и правит документы, не удаляет: снятый с сайта
//                документ уходит в архив, адрес и история правок остаются;
//   «Сборщик» — reads them for the build. The public reads nothing: the site
//                is static, the pages are in its HTML.
//   «Сборщик» — читает их для сборки. Публичная роль не читает ничего: сайт
//                статический, документы уже в его HTML.

/**
 * @param {(method: string, path: string, body?: unknown) => Promise<any>} api admin REST call / вызов REST от админа
 * @param {{ editorPolicy: string, builderPolicy: string }} ctx policies created by the main setup / политики из основной настройки
 */
export async function setup(api, { editorPolicy, builderPolicy }) {
  const collections = new Set((await api('GET', '/collections?limit=-1')).map((c) => c.collection));
  if (!collections.has('pages')) {
    console.log('pages: коллекции «Документы» нет (schema apply ещё не сделан) — пропускаю');
    return;
  }

  const wanted = [
    [editorPolicy, 'read'],
    [editorPolicy, 'create'],
    [editorPolicy, 'update'],
    [builderPolicy, 'read'],
  ];
  const existing = await api('GET', '/permissions?filter[collection][_eq]=pages&limit=-1');
  for (const [policy, action] of wanted) {
    if (existing.some((p) => p.policy === policy && p.action === action)) continue;
    await api('POST', '/permissions', { policy, collection: 'pages', action, fields: ['*'] });
    console.log(`+ permission pages ${action} (${policy === editorPolicy ? 'Редактор' : 'Сборщик'})`);
  }

  // the list shows what a document is and where it lives
  // список показывает, что за документ и где он живёт
  const presets = await api('GET', '/presets?filter[user][_null]=true&filter[role][_null]=true&filter[collection][_eq]=pages&limit=-1');
  if (!presets.some((p) => !p.bookmark)) {
    await api('POST', '/presets', {
      collection: 'pages',
      layout: 'tabular',
      user: null,
      role: null,
      bookmark: null,
      layout_query: { tabular: { fields: ['title', 'slug', 'revised', 'status'], sort: ['sort'], limit: 25 } },
      layout_options: { tabular: { widths: { title: 320, slug: 160, revised: 180, status: 150 } } },
    });
    console.log('+ preset pages');
  }
}
