/**
 * Проверка посадочных кейтеринга (`src/data/landings-catering.ts`): на
 * фикстуре через тот же `normalize`, что у сборки. Title не длиннее 60 и без
 * года, description 140–160 и с запасным текстом, каждое число в текстах —
 * из форматов админки, утверждения подтверждены данными, вопросы и форматы
 * находятся, фото не повторяются, а разметка (`cateringJsonLd` с видом
 * `landing`) — крошки, услуга с ценами за гостя, `FAQPage` простым текстом,
 * все `@id` разные.
 * Запуск: `pnpm test`.
 */
import assert from 'node:assert/strict';
import { normalize, type Raw } from './content.ts';
import { rub } from './catalog.ts';
import { cateringJsonLd } from './catering-seo.ts';
import { breadcrumbId, orgId } from './seo.ts';
import fixture from '../data/fixture.json' with { type: 'json' };
import {
  LANDINGS,
  fillText,
  imageKey,
  landingBySlug,
  landingDescription,
  landingFacts,
  landingFormats,
  landingLead,
  landingPath,
  landingPick,
  landingQuestions,
  landingSeason,
  landingShots,
  unproven,
} from '../data/landings-catering.ts';

const content = normalize(fixture as unknown as Raw, (file) => `/fixture/${file.id}`, undefined, () => {});
const plain = (text: string) => text.replace(/[  ]/g, ' ');
const TOKEN = /\{[a-z]+:[a-z0-9-]+\}/;
const HOLE = /undefined|NaN|null|\[object/;

// ── реестр ───────────────────────────────────────────────────────────────────
assert.deepEqual(
  LANDINGS.map((landing) => landing.slug),
  ['corporate', 'banquet', 'buffet', 'birthday'],
  'четыре посадочные; поминальные обеды и бизнес-ланч ждут решения владельца',
);
assert.equal(landingPath(landingBySlug('corporate')), '/catering/corporate/');
assert.throws(() => landingBySlug('memorial' as never), /не описана/);

const prices = new Set(content.catering.formats.flatMap((format) => (format.price ? [plain(rub(format.price.from))] : [])));
const guests = new Set(content.catering.formats.flatMap((format) => (format.guestsTo ? [String(format.guestsTo)] : [])));

/** Каждое «N ₽» и «до N гостей» текста — из форматов админки. */
const figuresFromAdmin = (where: string, text: string) => {
  for (const [sum] of plain(text).matchAll(/\d[\d ]*\d ₽|\d ₽/g)) {
    assert.ok(prices.has(sum), `${where}: «${sum}» нет среди цен форматов (${[...prices].join(', ')})`);
  }
  for (const [, n] of plain(text).matchAll(/до (\d+) гост/g)) {
    assert.ok(guests.has(n), `${where}: «до ${n} гостей» нет у форматов`);
  }
};

for (const landing of LANDINGS) {
  const at = `/catering/${landing.slug}/`;

  // title, H1, description
  assert.ok(landing.title.length <= 60, `${at}: title ${landing.title.length} > 60`);
  assert.match(landing.title, / — Вкусная компания$/, `${at}: title кончается названием`);
  assert.doesNotMatch(landing.title, /20\d\d/, `${at}: в title нет года — его не переписывать каждый год`);
  assert.ok(landing.h1.length > 8 && landing.h1.length <= 60, `${at}: H1`);
  assert.notEqual(landing.h1, landing.title, `${at}: H1 не повторяет title`);

  const description = landingDescription(landing, content);
  assert.ok(
    description.length >= 140 && description.length <= 160,
    `${at}: description ${description.length}, а не 140–160: «${description}»`,
  );
  assert.doesNotMatch(description, TOKEN, `${at}: в description не осталось меток`);
  assert.doesNotMatch(description, HOLE);
  figuresFromAdmin(`${at} description`, description);
  if (TOKEN.test(landing.description)) {
    assert.ok(landing.descriptionFallback, `${at}: у description с метками есть запасной текст`);
  }
  if (landing.descriptionFallback) {
    const length = landing.descriptionFallback.length;
    assert.ok(length >= 140 && length <= 160, `${at}: запасной description ${length}, а не 140–160`);
    assert.doesNotMatch(landing.descriptionFallback, TOKEN);
    assert.doesNotMatch(landing.descriptionFallback, /\d[\d ]*₽/, `${at}: в запасном description нет цен`);
  }

  // ввод первого экрана: прямой ответ в 2–3 предложения, цена — из админки
  const lead = landingLead(landing, content);
  assert.doesNotMatch(lead, TOKEN);
  assert.doesNotMatch(lead, HOLE);
  const sentences = lead.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  assert.ok(sentences >= 2 && sentences <= 3, `${at}: ввод — 2–3 предложения, а не ${sentences}`);
  assert.match(plain(lead), /от \d[\d ]* ₽/, `${at}: ввод называет цену «от»`);
  figuresFromAdmin(`${at} ввод`, lead);
  if (TOKEN.test(landing.lead)) assert.ok(landing.leadFallback, `${at}: у ввода с метками есть запасной текст`);
  if (landing.leadFallback) {
    assert.doesNotMatch(landing.leadFallback, TOKEN);
    assert.doesNotMatch(landing.leadFallback, /\d[\d ]*₽/, `${at}: в запасном вводе нет цен`);
  }

  // утверждения без чисел — в данных кейтеринга
  assert.deepEqual(unproven(landing, content).map(String), [], `${at}: утверждения подтверждены данными`);

  // форматы, вопросы, цифры
  const formats = landingFormats(landing, content);
  assert.deepEqual(
    formats.map((format) => format.slug),
    landing.formats,
    `${at}: все форматы страницы есть в админке`,
  );
  assert.equal(landingPick(landing, content)?.slug, landing.formats[0], `${at}: форма выбирает главный формат страницы`);
  assert.ok(formats[0].price, `${at}: у главного формата есть цена`);

  const questions = landingQuestions(landing, content);
  assert.equal(questions.length, landing.questions.length, `${at}: каждый образец нашёл свой вопрос`);
  assert.equal(new Set(questions.map((item) => item.id)).size, questions.length, `${at}: вопросы не повторяются`);
  assert.ok(questions.length >= 6 && questions.length <= 8, `${at}: 6–8 вопросов`);

  const facts = landingFacts(landing, content);
  assert.equal(facts.length, landing.facts.length, `${at}: каждая ячейка полосы цифр нашлась`);
  for (const fact of facts) {
    assert.ok(fact.value && fact.label, `${at}: ячейка с числом и подписью`);
    assert.doesNotMatch(`${fact.value} ${fact.label}`, HOLE);
  }

  // фото: ни одного дважды на странице
  const shots = landingShots(landing, content);
  assert.ok(shots.hero, `${at}: есть кадр первого экрана`);
  assert.ok(shots.rail.length >= 4 && shots.rail.length <= 8, `${at}: в ленте 4–8 кадров, а не ${shots.rail.length}`);
  assert.equal(shots.halls.length, landing.halls ? content.places.length : 0, `${at}: по кадру на зал`);
  const keys = [
    shots.hero!,
    ...shots.halls.flatMap((hall) => (hall.shot ? [hall.shot.image] : [])),
    ...shots.rail.map((shot) => shot.image),
    ...formats.flatMap((format) => (format.photo ? [format.photo] : [])),
  ].map(imageKey);
  assert.equal(new Set(keys).size, keys.length, `${at}: кадр не повторяется на странице`);
  if (landing.halls) assert.ok(shots.halls.every((hall) => hall.shot), `${at}: у каждого зала свой кадр`);

  // фразы ядра
  assert.ok(landing.keywords.length >= 5, `${at}: фразы ядра`);
  assert.equal(new Set(landing.keywords.map((item) => item.phrase)).size, landing.keywords.length);
}

assert.equal(new Set(LANDINGS.map((landing) => landing.title)).size, LANDINGS.length, 'title не повторяются');
assert.equal(new Set(LANDINGS.map((landing) => landing.h1)).size, LANDINGS.length, 'H1 не повторяются');

// ── корпоратив: сезон ────────────────────────────────────────────────────────
const corporate = landingBySlug('corporate');
const season = landingSeason(corporate, '2026-10-23');
assert.ok(season && /Новый год 2027/.test(season) && /декабрь 2026/.test(season), 'в сезонной строке обе формы года');
assert.equal(landingSeason(corporate, '2027-01-01'), undefined, 'после 31 декабря сезонная строка уходит');
assert.ok(
  corporate.keywords.reduce((sum, item) => sum + item.exact, 0) >= 159 + 141 + 108,
  'корпоратив несёт три сезонные фразы',
);
assert.ok(
  landingFacts(corporate, content).some((fact) => fact.value === 'ЭДО'),
  'юрлица и ЭДО — в полосе цифр, пока формат «Корпоративные мероприятия» это говорит',
);
const withoutEdo = {
  ...content,
  catering: {
    ...content.catering,
    formats: content.catering.formats.map((format) => ({
      ...format,
      includes: format.includes.filter((item) => !/ЭДО/.test(item)),
    })),
    questions: content.catering.questions.map((item) => ({ ...item, answer: item.answer.replace(/ЭДО/g, 'договор') })),
    steps: content.catering.steps.map((step) => ({ ...step, text: step.text?.replace(/ЭДО/g, 'договор') })),
  },
};
assert.ok(!landingFacts(corporate, withoutEdo).some((fact) => fact.value === 'ЭДО'), 'без ЭДО в данных ячейки нет');

// ── метки: формат без цены даёт запасной текст, а не дыру ────────────────────
assert.equal(plain(fillText('банкет {price:korporativy}', content) ?? ''), 'банкет от 3 500 ₽ за гостя');
assert.equal(fillText('{from:furshet}', content), rub(50000));
assert.equal(fillText('{time:boksy}', content), 'готовим около 2 часов');
assert.equal(fillText('{price:kofe-breyk}', content), undefined, 'у кофе-брейка нет цены — метка не заполняется');
assert.equal(fillText('{guests:net-takogo}', content), undefined);
const noPrices = {
  ...content,
  catering: { ...content.catering, formats: content.catering.formats.map((format) => ({ ...format, price: undefined })) },
};
for (const landing of LANDINGS) {
  const description = landingDescription(landing, noPrices);
  assert.doesNotMatch(description, /₽|\{/, `${landing.slug}: без цен в админке description без цифр`);
  assert.doesNotMatch(landingLead(landing, noPrices), /₽|\{/, `${landing.slug}: без цен в админке ввод без цифр`);
}

// ── разметка ─────────────────────────────────────────────────────────────────
type Node = Record<string, unknown> & { '@id'?: string; '@type'?: string };
const origin = 'https://vkus-com.ru';
const site = new URL(origin);

const ids = (value: unknown, out: string[] = []): string[] => {
  if (Array.isArray(value)) value.forEach((item) => ids(item, out));
  else if (value && typeof value === 'object') {
    const node = value as Node;
    if (node['@id'] && Object.keys(node).length > 1) out.push(node['@id']);
    Object.values(node).forEach((item) => ids(item, out));
  }
  return out;
};

for (const landing of LANDINGS) {
  const path = landingPath(landing);
  const url = `${origin}${path}`;
  const formats = landingFormats(landing, content);
  const questions = landingQuestions(landing, content);
  const graph = cateringJsonLd(content, site, 'landing', `${origin}/_astro/hero.jpg`, {
    path,
    crumb: landing.crumb,
    service: landing.service,
    description: landingDescription(landing, content),
    formats,
    questions,
    faqName: landing.faqTitle,
  }) as unknown as { '@graph': Node[] };
  const text = JSON.stringify(graph);
  assert.doesNotMatch(text, HOLE, `${path}: в разметке нет дыр`);

  const all = ids(graph);
  assert.equal(new Set(all).size, all.length, `${path}: все @id разные: ${all.join(', ')}`);
  assert.ok(!all.includes(url), `${path}: узел страницы — у раскладки`);
  const node = (id: string) => graph['@graph'].find((item) => item['@id'] === id) as Node;

  const crumbs = node(breadcrumbId(url)) as Node & { itemListElement: { name: string; item: string }[] };
  assert.equal(crumbs['@type'], 'BreadcrumbList');
  assert.deepEqual(
    crumbs.itemListElement.map((item) => [item.name, item.item]),
    [
      ['Главная', `${origin}/`],
      ['Кейтеринг и банкеты', `${origin}/catering/`],
      [landing.crumb, url],
    ],
    `${path}: крошки`,
  );

  assert.ok(node(`${origin}/catering/#business`), `${path}: заведение то же, что у раздела`);
  assert.equal(node(`${origin}/catering/#service`), undefined, `${path}: услуга раздела не повторяется — у страницы своя`);

  const service = node(`${url}#service`) as Node & { offers: Node[]; provider: Node };
  assert.equal(service['@type'], 'Service');
  assert.equal(service.name, landing.service.name);
  assert.deepEqual(service.provider, { '@id': orgId(origin) }, `${path}: услугу оказывает компания`);
  const priced = formats.filter((format) => format.price);
  assert.equal(service.offers.length, priced.length, `${path}: предложение — у каждого формата с ценой`);
  service.offers.forEach((offer, i) => {
    const format = priced[i];
    const spec = offer.priceSpecification as Node;
    assert.equal(offer['@id'], `${url}#offer-${format.slug}`);
    assert.equal(offer.url, `${url}#format-${format.slug}`, `${path}: предложение ведёт к строке формата`);
    assert.equal(spec.minPrice, format.price!.from);
    assert.equal(spec.priceCurrency, 'RUB');
    if (format.price!.unit) {
      assert.equal(spec['@type'], 'UnitPriceSpecification', `${path}: «${format.price!.unit}» — цена за единицу`);
      assert.equal(spec.unitText, format.price!.unit);
    }
  });
  if (landing.formats.includes('korporativy')) {
    const offer = service.offers.find((item) => item['@id'] === `${url}#offer-korporativy`)!;
    assert.deepEqual(
      [(offer.priceSpecification as Node)['@type'], (offer.priceSpecification as Node).unitText],
      ['UnitPriceSpecification', 'за гостя'],
    );
  }

  const faq = node(`${url}#faq`) as Node & { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
  assert.equal(faq['@type'], 'FAQPage');
  assert.deepEqual(faq.about, { '@id': `${url}#service` });
  assert.deepEqual(
    faq.mainEntity.map((item) => item.name),
    questions.map((item) => item.question),
    `${path}: в FAQPage те же вопросы, что на странице`,
  );
  for (const item of faq.mainEntity) assert.doesNotMatch(item.acceptedAnswer.text, /<[a-z/]/i, 'ответ простым текстом');
}

assert.throws(() => cateringJsonLd(content, site, 'landing'), /landing/, 'посадочная без записи — ошибка, а не пустые узлы');

console.log('landings-catering: посадочные кейтеринга в порядке');
