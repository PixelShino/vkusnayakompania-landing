/**
 * Проверка «Вопросов о доставке»: фикстура и сид зон проходят через тот же
 * построитель, что и сборка. Ответы без `undefined` и `NaN`, цены как
 * «от 400 ₽» и совпадают с зонами до рубля, заглушка Max не попадает, вопрос
 * без данных пропускается, а разметка `FAQPage` — простой текст. С 26.10.2026:
 * меню у точек разное, заказ «В зале», чек только на почту.
 * Запуск: `pnpm test`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, type Raw } from './content.ts';
import { rub } from './catalog.ts';
import { buildDeliveryFaq, faqJsonLd, shortZone, slotFacts, zonesFrom, type FaqItem, type FaqZone } from './delivery-faq.ts';
import fixture from '../data/fixture.json' with { type: 'json' };

const seed = JSON.parse(readFileSync(new URL('../data/delivery-zones.json', import.meta.url), 'utf8'));
const raw = fixture as unknown as Raw;
const content = normalize(raw, (file) => `/fixture/${file.id}`, undefined, () => {});
const zones = zonesFrom(seed);
const href = '/docs/delivery/';
const faq = buildDeliveryFaq(content, { zones, deliveryHref: href });
const byId = (items: FaqItem[], id: string) => items.find((item) => item.id === id);
const plain = (text: string) => text.replace(/ /g, ' ');

// ── зоны: та же нормализация, что у сервера ─────────────────────────────────
assert.equal(zones.length, 6, 'шесть зон из src/data/delivery-zones.json');
assert.deepEqual(
  zones.map((zone) => [zone.price, zone.free_from, zone.min_order]),
  seed.map((row: FaqZone) => [row.price, row.free_from, row.min_order]),
  'цены и пороги — как в сиде, в порядке sort',
);
assert.equal(zonesFrom([{ ...seed[0], status: 'draft' }]).length, 0, 'выключенная зона не печатается');
assert.equal(zonesFrom([{ ...seed[0], polygon: [] }]).length, 0, 'зона без границы не печатается — корзина её не найдёт');
assert.deepEqual(zonesFrom(null), []);
assert.equal(shortZone('Рядом с нами — Советский, Промышленный'), 'Рядом с нами');
assert.equal(shortZone('Советский, Промышленный, Октябрьский, Кировский'), 'Советский, Промышленный, Октябрьский, Кировский', 'имя по районам не режется по запятой');
assert.equal(shortZone('Новокуйбышевск'), 'Новокуйбышевск');

// ── общее: ни одного пустого места ──────────────────────────────────────────
assert.ok(faq.length >= 6 && faq.length <= 10, `от 6 до 10 вопросов, а не ${faq.length}`);
// the order of the page: prices first, then how to get the order, then after it
// порядок страницы: сначала цены, потом как получить заказ, потом что после
assert.deepEqual(
  faq.map((item) => item.id),
  ['zones', 'minimum', 'time', 'payment', 'pickup', 'menu', 'table', 'accepted', 'cakes', 'help'],
  'порядок вопросов',
);
assert.equal(new Set(faq.map((item) => item.id)).size, faq.length, 'id вопросов не повторяются — по ним ссылки #faq-…');
for (const item of faq) {
  for (const text of [item.q, item.a, item.aHtml ?? '']) {
    assert.doesNotMatch(text, /undefined|NaN|null|\[object/, `«${item.q}»: дыра в тексте`);
  }
  assert.match(item.q, /\?$/, `«${item.q}» — вопрос`);
  assert.doesNotMatch(item.a, /<[a-z/]/i, `«${item.q}»: в простом тексте нет HTML`);
  assert.ok(item.a.length > 40, `«${item.q}»: ответ не пустой`);
  if (item.aHtml) assert.match(item.aHtml, /^<(p|ul)\b/, `«${item.q}»: HTML ответа — блок`);
  // первое предложение — сам ответ, не вступление
  assert.doesNotMatch(item.a, /^(Отличный|Хороший) вопрос|^Мы рады/);
  // тире не начинает строку: перед ним неразрывный пробел
  assert.doesNotMatch(item.a, / [—–] /, `«${item.q}»: перед тире обычный пробел`);
}

// ── зоны и цены: до рубля как у корзины ─────────────────────────────────────
const where = byId(faq, 'zones')!;
assert.match(plain(where.a), /^По Самаре и окрестностям: доставка стоит от 400 ₽ до 4 000 ₽/);
assert.ok(where.a.includes(`от ${rub(400)} до ${rub(4000)}`), 'цены как «от 400 ₽» с неразрывными пробелами');
assert.ok(plain(where.a).includes('Бесплатно — при заказе блюд от 7 000 ₽ в зонах «Советский, Промышленный, Октябрьский, Кировский» и «Ленинский, Самарский, Железнодорожный», в остальных порог выше.'));
for (const zone of zones) {
  assert.ok(where.a.includes(`доставка ${rub(zone.price)}`), `${zone.name}: цена ${zone.price}`);
  assert.ok(where.aHtml!.includes(rub(zone.price)), `${zone.name}: цена в списке страницы`);
  assert.ok(where.aHtml!.includes(rub(zone.min_order)), `${zone.name}: минимум в списке страницы`);
}
assert.equal((where.aHtml!.match(/<li class="dfaq-zone">/g) ?? []).length, zones.length, 'строка на каждую зону');
// zones named by districts (since 26.10.2026) carry no explanation after the dash: bold name only, no stray dash
// зоны по районам (с 26.10.2026) без пояснения после тире: только имя жирным, без висячего тире
assert.ok(where.aHtml!.includes('<b>Советский, Промышленный, Октябрьский, Кировский</b></span>'), 'имя зоны целиком и без тире');
assert.ok(!where.aHtml!.includes('sr-only'), 'без пояснения нет и скрытого тире');
const explained = buildDeliveryFaq(content, { zones: zones.map((zone, i) => (i === 0 ? { ...zone, name: 'Рядом с нами — Советский, Промышленный' } : zone)), deliveryHref: href });
assert.ok(byId(explained, 'zones')!.aHtml!.includes('Рядом с нами</b><span class="sr-only">\u00a0— </span>'), 'без стилей строка называет зону полностью');

// ── минимальный заказ ───────────────────────────────────────────────────────
const min = byId(faq, 'minimum')!;
assert.equal(
  plain(min.a),
  'Да, для доставки: 1 000 ₽ за блюда, а в зонах «Красноглинский район и Смышляевка» и «Новокуйбышевск» — 2 500 ₽. Для самовывоза и заказа в зале минимальной суммы нет. Если в корзине меньше, она подскажет, сколько добавить.',
);
// у зон нет минимума — вопроса нет
const noMin = buildDeliveryFaq(content, { zones: zones.map((zone) => ({ ...zone, min_order: 0 })), deliveryHref: href });
assert.equal(byId(noMin, 'minimum'), undefined, 'минимума нет в данных — вопрос не выводится');
// зоны недоступны — ответ о цене без чисел, вопроса о минимуме нет
const blind = buildDeliveryFaq(content, { zones: null, deliveryHref: href });
assert.equal(byId(blind, 'minimum'), undefined);
assert.doesNotMatch(byId(blind, 'zones')!.a, /\d/, 'без зон в ответе о цене нет ни одного числа');
assert.equal(byId(blind, 'zones')!.aHtml, undefined);

// ── время: из правил оформления, а не перепечатка ───────────────────────────
assert.deepEqual(slotFacts(), { from: '09:00', to: '21:00', step: 30, lead: 60, days: 7 });
assert.equal(
  plain(byId(faq, 'time')!.a),
  'Как можно скорее: точное время доставки менеджер называет при звонке, когда подтверждает заказ. Можно и ко времени: с 9:00 до 21:00 с шагом 30 минут, на неделю вперёд, ближайшее — не раньше чем через час после заказа.',
);

// ── оплата: только онлайн, «При получении» не обещаем ────────────────────────
const pay = byId(faq, 'payment')!;
assert.match(pay.a, /^Онлайн картой МИР, Visa или Mastercard на защищённой странице ЮKassa/);
assert.doesNotMatch(pay.a, /наличн|курьеру|при получении/i, 'оплата при получении выключена — её нет в ответе');
assert.ok(pay.a.includes(`до 30 % заказа`), 'доля баллов — из «Программы лояльности»');
// the receipt goes to the mail asked for at checkout, never «to the phone» (the owner, 26.10.2026)
// чек — на почту, которую спрашивает оформление, и никогда «на телефон» (владелец, 26.10.2026)
assert.ok(plain(pay.a).includes('Электронный чек придёт на почту, которую вы укажете при оформлении.'), 'чек — на почту');
assert.doesNotMatch(pay.a, /чек[^.]*телефон|телефон[^.]*чек/i, 'чек на телефон не обещаем');
const noPoints = buildDeliveryFaq({ ...content, loyalty: { ...content.loyalty, enabled: false } }, { zones, deliveryHref: href });
assert.doesNotMatch(byId(noPoints, 'payment')!.a, /балл/, 'программа выключена — о баллах ни слова');

// ── самовывоз: точки и часы из админки ──────────────────────────────────────
const pickup = plain(byId(faq, 'pickup')!.a);
assert.ok(pickup.startsWith('Да, самовывоз бесплатный, из двух наших точек в Самаре: '));
assert.ok(pickup.includes('Садовая, 212Б (пн–пт 8:00–21:00, сб 8:30–21:00, вс 9:00–21:00)'));
assert.ok(pickup.includes('Советской Армии, 177 (ежедневно 9:00–22:30)'));
assert.ok(byId(faq, 'pickup')!.aHtml!.includes('<span class="dfaq-nw">пн–пт 8:00–21:00</span>'), 'на странице дни не отрываются от часов');
assert.equal(byId(buildDeliveryFaq({ ...content, places: [] }, { zones, deliveryHref: href }), 'pickup'), undefined, 'нет точек — нет вопроса');

// ── меню точек и заказ в зале (владелец, 26.10.2026) ────────────────────────
const menu = byId(faq, 'menu')!;
assert.equal(menu.q, 'Меню одинаковое на обеих точках?');
assert.ok(plain(menu.a).startsWith('Нет, у каждой точки своё меню. Выберите точку вверху каталога — он покажет её блюда и запомнит выбор.'), plain(menu.a));
assert.ok(menu.a.includes('на доставку, с собой или к столику'), 'выбранная точка готовит заказ любым способом получения');
const solo = buildDeliveryFaq({ ...content, places: content.places.slice(0, 1) }, { zones, deliveryHref: href });
assert.equal(byId(solo, 'menu'), undefined, 'одна точка — вопроса о разном меню нет');
assert.ok(byId(solo, 'table'), 'одна точка — заказ в зале всё равно есть');
const table = byId(faq, 'table')!;
assert.equal(table.q, 'Можно заказать за столиком?');
assert.ok(plain(table.a).startsWith('Да. Откройте каталог на телефоне, выберите вверху точку, где сидите, и в оформлении отметьте «В зале» — номер стола можно указать.'), plain(table.a));
assert.ok(table.a.endsWith('Оплатите заказ на сайте, и его принесут к столу.'), 'в зале — оплата на сайте и к столу');

// ── заказ принят: статусы кабинета ──────────────────────────────────────────
const accepted = byId(faq, 'accepted')!;
assert.ok(accepted.a.endsWith('«Принят», «Готовим», «Выполнен».'), 'статусы — как в кабинете, без «Отменён»');
assert.ok(accepted.aHtml!.includes('<a href="/account/">личный кабинет</a>'));

// ── торт: срок из описаний праздничных тортов каталога ──────────────────────
const cake = byId(faq, 'cakes')!;
assert.ok(plain(cake.a).startsWith('Да: праздничные торты из каталога делаем на заказ за 48 часов. '), plain(cake.a));
// the old `cakes` collection is not read: no wedding cake, no «5 дней»
// старая коллекция `cakes` не читается: ни свадебного торта, ни «5 дней»
assert.doesNotMatch(cake.a, /свадеб|\d+\s*дн(ей|я)/iu, 'в ответе про торт нет строк старой витрины');
assert.ok(cake.aHtml!.includes('<a href="#prazdnichnye-torty">праздничные торты из каталога</a>'));
assert.ok(cake.aHtml!.includes('<a href="#torty-v-nalichii">«Торты в наличии»</a>'));
const noCakes = buildDeliveryFaq(
  { ...content, catalog: { ...content.catalog, categories: content.catalog.categories.filter((c) => c.slug !== 'prazdnichnye-torty') } },
  { zones, deliveryHref: href },
);
assert.equal(byId(noCakes, 'cakes'), undefined, 'нет раздела праздничных тортов — нет вопроса');

// ── связь: заглушка Max не попадает, настоящая ссылка выводится ────────────
// the fixture carries the real Max link since 26.10.2026; the stub is built here
// в фикстуре с 26.10.2026 настоящая ссылка Max; заглушка собирается здесь
const stubbed = buildDeliveryFaq({ ...content, settings: { ...content.settings, max: 'https://max.ru/' } }, { zones, deliveryHref: href });
const help = byId(stubbed, 'help')!;
assert.ok(plain(help.a).startsWith('Позвоните по номеру +7 987 955-25-65 или напишите в Telegram.'));
for (const text of [help.a, help.aHtml!]) assert.doesNotMatch(text, /Max|max\.ru/, 'заглушка Max не выводится');
assert.ok(help.aHtml!.includes('href="tel:+79879552565"'));
assert.match(content.settings.max ?? '', /^https:\/\/max\.ru\/join\//, 'в фикстуре настоящая ссылка Max');
assert.match(byId(faq, 'help')!.aHtml!, /href="https:\/\/max\.ru\/join\/[^"]+"/, 'настоящая ссылка Max выводится');
assert.ok(help.aHtml!.includes(`<a href="${href}">условиях доставки и оплаты</a>`));
const withMax = buildDeliveryFaq({ ...content, settings: { ...content.settings, max: 'https://max.ru/u/abc' } }, { zones, deliveryHref: href });
assert.ok(byId(withMax, 'help')!.a.includes('напишите в Telegram или Max'), 'настоящий Max — выводится');
const noDoc = buildDeliveryFaq(content, { zones });
assert.doesNotMatch(byId(noDoc, 'help')!.a, /условиях/, 'нет страницы условий — нет и ссылки на неё');

// ── экранирование: имя зоны из админки не ломает HTML ───────────────────────
const evil = buildDeliveryFaq(content, { zones: [{ name: 'Зона <b>& «x»', price: 500, free_from: 7000, min_order: 0 }], deliveryHref: href });
assert.ok(byId(evil, 'zones')!.aHtml!.includes('Зона &lt;b&gt;&amp; «x»'));

// ── FAQPage: простой текст, тот же, что на странице ─────────────────────────
const ld = faqJsonLd(faq, 'https://vkus-com.ru/catalog/');
assert.equal(ld['@type'], 'FAQPage');
assert.equal(ld['@id'], 'https://vkus-com.ru/catalog/#faq');
assert.equal(ld.mainEntity.length, faq.length);
for (const [i, entry] of ld.mainEntity.entries()) {
  assert.equal(entry.name, faq[i].q);
  assert.equal(entry.acceptedAnswer.text, faq[i].a);
  assert.doesNotMatch(entry.acceptedAnswer.text, /<|&[a-z]+;/, 'в разметке нет тегов и сущностей');
}

console.log(`вопросы о доставке: ${faq.length} ответов из фикстуры и зон, цены до рубля, без заглушки Max — проверки прошли`);
