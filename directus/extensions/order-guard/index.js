/**
 * Orders from the site's cart. The public role may only create an order and
 * never read one back, so everything the browser sends is checked here before
 * the row is written: the phone is normalised, the lines are rebuilt from the
 * catalog with today's prices, the total is counted on the server, the status
 * and the source are set by us, and one address may not flood the inbox. After
 * the row is written, editors and administrators get a notification in the
 * admin (and a letter, once SMTP is configured).
 *
 * Заказы из корзины сайта. Публичная роль может только создать заказ и не
 * может прочитать его обратно, поэтому всё, что прислал браузер, проверяется
 * здесь до записи: телефон приводится к одному виду, строки собираются заново
 * из каталога по сегодняшним ценам, сумма считается на сервере, статус и
 * источник ставим мы, а один адрес не может завалить заказами. После записи
 * редакторы и администраторы получают уведомление в админке (и письмо, когда
 * настроен SMTP).
 *
 * The rules mirror `src/lib/order.ts` on the site: the form refuses the same
 * things before sending, this hook is the part a script cannot skip.
 * Правила повторяют `src/lib/order.ts` сайта: форма отказывает в том же до
 * отправки, а этот хук — та часть, которую скрипт обойти не может.
 *
 * Delivery (since 22.10.2026): the zone is found by the address on the server
 * (`../delivery/geo.js` and the geocoder of `../delivery/photon.js` — the same
 * rules and the same cache as the cart's `/delivery/quote`), the delivery is
 * priced by the zone, an order below the zone's minimum is refused, and every
 * order gets «К оплате» = dishes − discount − points + delivery.
 * Доставка (с 22.10.2026): зона ищется по адресу на сервере (`../delivery/geo.js`
 * и геокодер `../delivery/photon.js` — те же правила и тот же кэш, что у
 * `/delivery/quote` корзины), стоимость — по зоне, заказ меньше минимума зоны
 * не принимается, а «К оплате» = блюда − скидка − баллы + доставка получает
 * каждый заказ.
 *
 * No build step: this file is the extension. / Без сборки: этот файл и есть расширение.
 */
import { deliveryCost, minOrderError, normalizeAddress, quote, toZones } from '../delivery/geo.js';
import { geocoder } from '../delivery/photon.js';

const LIMITS = {
  lines: 40,
  qty: 50,
  name: 80,
  address: 200,
  details: 120,
  when: 80,
  comment: 1000,
};
// one visitor, ten minutes, six orders: enough for a mistake and a retry,
// too few for a script
// один посетитель, десять минут, шесть заказов: хватит на ошибку и повтор,
// мало для скрипта
const RATE = { max: 6, windowMs: 10 * 60 * 1000 };
// who hears about a new order / кто узнаёт о новом заказе
const NOTIFY_ROLES = ['Administrator', 'Редактор'];

// Directus turns an error named `DirectusError` into a proper HTTP answer with
// its status and message; anything else becomes a faceless 500
// Directus превращает ошибку с именем `DirectusError` в ответ со своим статусом
// и текстом; всё остальное становится безликим 500
class OrderError extends Error {
  name = 'DirectusError';
  constructor(message, status = 400, code = 'INVALID_PAYLOAD') {
    super(message);
    this.status = status;
    this.code = code;
    this.extensions = { reason: message };
  }
}

/**
 * «30гр», «1,5кг» → «30 г», «1,5 кг» with a non-breaking space — the same rule
 * as the site's `weightText` (`src/lib/catalog.ts`), so a size typed «1,5кг» in
 * the admin and «1,5 кг» sent by the page are the same size.
 * «30гр», «1,5кг» → «30 г», «1,5 кг» с неразрывным пробелом — то же правило,
 * что `weightText` сайта (`src/lib/catalog.ts`): размер, набранный в админке
 * как «1,5кг», и «1,5 кг» со страницы — один и тот же размер.
 */
export const weightText = (value) =>
  String(value)
    .replace(/(\d)\s*(?:гр|г)\.?(?=$|[\s,;/)])/giu, '$1 г')
    .replace(/(\d)\s*кг\.?(?=$|[\s,;/)])/giu, '$1 кг')
    .replace(/(\d)\s*мл\.?(?=$|[\s,;/)])/giu, '$1 мл')
    .replace(/(\d)\s*л\.?(?=$|[\s,;/)])/giu, '$1 л')
    .replace(/(\d)\s*шт\.?(?=$|[\s,;/)])/giu, '$1 шт.')
    .replace(/(\d),\s+(\d)/g, '$1,$2')
    .trim();

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const rub = (n) => `${new Intl.NumberFormat('ru-RU').format(n)} ₽`;

/** «8 (987) 955 25 65» → «+7 987 955-25-65»; null — не российский мобильный/городской */
export const normalizePhone = (value) => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  if (!/^7[3-9]\d{9}$/.test(digits)) return null;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
};

/** «1210-4821»: день, месяц и четыре цифры — короткий номер, который гость назовёт по телефону */
const freshNumber = () => {
  const now = new Date();
  const day = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Samara', day: '2-digit', month: '2-digit' })
    .format(now)
    .replace('.', '');
  return `${day}-${String(Math.floor(1000 + Math.random() * 9000))}`;
};

// a guest signed in on the site (the `guest-auth` extension) carries this role
// гость, вошедший на сайте (расширение `guest-auth`), несёт эту роль
const GUEST_ROLE = 'Гость';

// what the manager reads when the address gave no zone / что читает менеджер, когда зоны по адресу нет
export const NOTE_NOT_FOUND = 'Адрес не найден на карте — стоимость доставки назвать при звонке.';
export const NOTE_OUTSIDE = 'Адрес вне зон доставки — предложить самовывоз или назвать стоимость при звонке.';

/**
 * The delivery line of the manager's notification: «зона «…» · 400 ₽»,
 * «… · бесплатно (от 7 000 ₽)» or «стоимость назвать при звонке».
 * Строка доставки в уведомлении менеджеру.
 * @param {{ zone?: string | null, cost?: number | null, freeFrom?: number | null }} delivery
 */
export const deliveryText = ({ zone, cost, freeFrom = null }) => {
  if (cost === null || cost === undefined) return 'стоимость назвать при звонке';
  const where = zone ? `зона «${zone}» · ` : '';
  if (Number(cost) > 0) return `${where}${rub(Number(cost))}`;
  return `${where}бесплатно${freeFrom ? ` (от ${rub(freeFrom)})` : ''}`;
};

export default ({ filter, action }, { services, logger, emitter = null, database: root = null }) => {
  const hits = new Map();
  const isGuest = async (accountability, database) =>
    Boolean(accountability?.user && accountability.role) &&
    (await database('directus_roles').where({ id: accountability.role }).first('name'))?.name === GUEST_ROLE;

  const tooMany = (ip) => {
    if (!ip) return false;
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs);
    recent.push(now);
    hits.set(ip, recent);
    // the map must not grow forever on a public endpoint
    // на публичном адресе карта не должна расти бесконечно
    if (hits.size > 5000) for (const [key, times] of hits) if (now - times.at(-1) > RATE.windowMs) hits.delete(key);
    return recent.length > RATE.max;
  };

  /**
   * Zones in force. Read outside the order's transaction when the hook has
   * its own connection: a missing table must not break the order's write.
   * Действующие зоны. Читаются вне транзакции заказа, если у хука есть своё
   * соединение: отсутствующая таблица не должна ломать запись заказа.
   */
  const zonesNow = async (database, schema) => {
    if (schema?.collections && !schema.collections.delivery_zones) return [];
    try {
      return toZones(await (root ?? database)('delivery_zones').select('id', 'name', 'price', 'free_from', 'min_order', 'polygon', 'sort', 'status'));
    } catch {
      return [];
    }
  };

  filter('orders.items.create', async (payload, _meta, { accountability, database, schema }) => {
    // editors entering a phone order and internal calls pass as they are; a
    // guest signed in on the site is checked like the public and owns the order
    // редактор, вбивающий заказ по телефону, и внутренние вызовы проходят как
    // есть; вошедший на сайте гость проверяется как публичный и владеет заказом
    const customer = (await isGuest(accountability, database)) ? accountability.user : null;
    if (!accountability || (accountability.user && !customer)) return payload;

    if (tooMany(accountability.ip))
      throw new OrderError('Слишком много заказов подряд. Позвоните нам — примем по телефону.', 429, 'REQUESTS_EXCEEDED');

    const name = text(payload.customer_name, LIMITS.name);
    if (!name) throw new OrderError('Укажите имя.');
    const phone = normalizePhone(payload.phone);
    if (!phone) throw new OrderError('Телефон не похож на российский номер.');
    if (payload.consent !== true) throw new OrderError('Нужно согласие на обработку данных.');

    const fulfillment = payload.fulfillment === 'pickup' ? 'pickup' : payload.fulfillment === 'delivery' ? 'delivery' : null;
    if (!fulfillment) throw new OrderError('Выберите доставку или самовывоз.');
    const address = text(payload.address, LIMITS.address);
    let place = null;
    if (fulfillment === 'delivery' && address.length < 5) throw new OrderError('Укажите адрес доставки.');
    if (fulfillment === 'pickup') {
      place = Number(payload.place);
      const known = Number.isInteger(place) && (await database('places').where({ id: place }).first('id'));
      if (!known) throw new OrderError('Выберите точку самовывоза.');
    }

    // lines are rebuilt from the catalog: the browser names the dish, the
    // variant and the quantity, the price is ours
    // строки собираются из каталога заново: браузер называет блюдо, вариант
    // и количество, цена — наша
    const lines = Array.isArray(payload.items) ? payload.items : [];
    if (!lines.length) throw new OrderError('Корзина пуста.');
    if (lines.length > LIMITS.lines) throw new OrderError(`В одном заказе до ${LIMITS.lines} позиций.`);
    const ids = [...new Set(lines.map((line) => Number(line?.product)).filter(Number.isInteger))];
    const rows = ids.length
      ? await database('products')
          .whereIn('id', ids)
          .select('id', 'title', 'price', 'weight', 'variants', 'fillings', 'available', 'status')
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));

    const items = lines.map((line) => {
      const product = byId.get(Number(line?.product));
      const qty = Number(line?.qty);
      if (!product || product.status !== 'published')
        throw new OrderError(`«${text(line?.title, 80) || 'Позиция'}» больше нет в каталоге. Обновите страницу.`);
      if (!product.available) throw new OrderError(`«${product.title}» закончилось. Уберите его из корзины.`);
      if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.qty)
        throw new OrderError(`Количество «${product.title}» — от 1 до ${LIMITS.qty}.`);
      const json = (value) => (typeof value === 'string' ? JSON.parse(value) : value ?? []);
      // only real sizes count: the site folds a single one into the dish price
      // в счёт идут только настоящие размеры: один размер сайт сворачивает в цену блюда
      const variants = json(product.variants).filter((v) => v?.name && Number(v?.price) > 0);
      const wanted = text(line?.variant, 80);
      const variant = wanted ? variants.find((v) => weightText(v.name) === weightText(wanted)) : null;
      if (wanted && !variant) throw new OrderError(`У «${product.title}» нет размера «${wanted}». Обновите страницу.`);
      if (!wanted && variants.length > 1) throw new OrderError(`Выберите размер «${product.title}».`);
      const fillings = json(product.fillings);
      const filling = text(line?.filling, 80) || null;
      if (fillings.length && !fillings.includes(filling)) throw new OrderError(`Выберите начинку «${product.title}».`);
      const price = Number(variant?.price ?? product.price);
      // the line's title carries the choice: «Торт «Лего» (2 кг, Сникерс)» —
      // the admin shows the order as `qty × title — sum`, and its template
      // prints an empty size or filling as «--»; the size and the filling stay
      // in their own fields too
      // название строки несёт выбор: «Торт «Лего» (2 кг, Сникерс)» — админка
      // показывает заказ как `кол-во × название — сумма`, а её шаблон печатает
      // пустой размер или начинку как «--»; размер и начинка остаются и в своих полях
      const size = variant ? weightText(variant.name) : null;
      const choice = [size, fillings.length ? filling : null].filter(Boolean);
      return {
        product: product.id,
        title: choice.length ? `${product.title} (${choice.join(', ')})` : product.title,
        variant: size,
        filling: fillings.length ? filling : null,
        weight: (variant?.weight || product.weight) ? weightText(variant?.weight || product.weight) : null,
        qty,
        price,
        sum: price * qty,
      };
    });
    const total = items.reduce((sum, line) => sum + line.sum, 0);

    // the guest saw the build-time prices; if the admin changed one since, the
    // manager learns it before the call, not from the guest
    // гость видел цены на момент сборки; если в админке их с тех пор поменяли,
    // менеджер узнаёт об этом до звонка, а не от гостя
    const seen = Number(payload.total);
    const note =
      Number.isFinite(seen) && seen !== total
        ? `На сайте гость видел ${rub(seen)}, по текущим ценам ${rub(total)} — уточнить при звонке.`
        : null;

    // Delivery by zone: the zone is found here again, whatever the cart showed.
    // Free from the zone's threshold, counted on the dishes before the discount
    // and the points; below the zone's minimum the order is refused. No zone
    // (the address is not on the map, or outside every zone) — the order goes
    // through, the delivery is priced on the call. Pickup costs nothing.
    // Доставка по зонам: зона ищется здесь заново, что бы ни показала корзина.
    // Бесплатно от порога зоны, считая блюда до скидки и баллов; меньше минимума
    // зоны — отказ. Нет зоны (адреса нет на карте или он вне всех зон) — заказ
    // проходит, стоимость доставки называют при звонке. Самовывоз — 0 ₽.
    const delivery = { zone: null, cost: fulfillment === 'pickup' ? 0 : null, note: null };
    if (fulfillment === 'delivery') {
      const zones = await zonesNow(database, schema);
      if (zones.length) {
        const found = await quote(address, {
          zones,
          geocode: geocoder.locate,
          geocodeRaw: geocoder.locateRaw,
          log: (error) => logger.warn(`order-guard: адрес «${normalizeAddress(address)}» не проверен — ${error.message}`),
        });
        if (found.found) {
          const refused = minOrderError(found.zone, total);
          if (refused) throw new OrderError(refused);
          delivery.zone = found.zone.name;
          delivery.cost = deliveryCost(found.zone, total);
        } else delivery.note = found.outside ? NOTE_OUTSIDE : NOTE_NOT_FOUND;
      }
    }

    // «Вкусные баллы» (the `loyalty` extension) decide how much of the order a
    // signed-in guest pays with points and the birthday discount; without that
    // extension nothing is taken off the total
    // «Вкусные баллы» (расширение `loyalty`) решают, сколько заказа вошедший
    // гость оплачивает баллами, и скидку именинника; без этого расширения из
    // суммы ничего не вычитается
    const loyalty = customer && emitter
      ? await emitter.emitFilter(
          'orders.checkout',
          { customer, total, delivery: delivery.cost ?? 0, requested: payload.bonus_spent, bonus_spent: 0, discount: 0, note: null },
          { collection: 'orders' },
          { database, accountability },
        )
      : null;

    let number = /^\d{4}-\d{4}$/.test(String(payload.number ?? '')) ? payload.number : freshNumber();
    if (await database('orders').where({ number }).first('id')) number = `${number}-${Math.floor(Math.random() * 90 + 10)}`;

    return {
      number,
      status: 'new',
      source: 'site',
      customer_name: name,
      phone,
      fulfillment,
      place,
      address: fulfillment === 'delivery' ? address : null,
      address_details: fulfillment === 'delivery' ? text(payload.address_details, LIMITS.details) || null : null,
      desired_time: text(payload.desired_time, LIMITS.when) || 'Как можно скорее',
      comment: text(payload.comment, LIMITS.comment) || null,
      items,
      total,
      consent: true,
      manager_note: [note, delivery.note, loyalty?.note].filter(Boolean).join('\n') || null,
      // how the guest wants to pay, when the site offered the choice; the rest
      // of `payment_*` (paid or not) is never taken from here — the `pay`
      // extension writes it from the bank's answer
      // как гость хочет платить, если сайт предложил выбор; остальные
      // `payment_*` (оплачен или нет) отсюда не берутся никогда — их пишет
      // расширение `pay` по ответу банка
      ...(payload.payment_method ? { payment_method: payload.payment_method === 'online' ? 'online' : 'on_delivery' } : {}),
      delivery_zone: delivery.zone,
      delivery_cost: delivery.cost,
      // «К оплате» for every order: what the online payment asks and the
      // manager takes; `delivery_cost` null (priced on the call) adds nothing
      // «К оплате» у каждого заказа: столько просит онлайн-оплата и берёт
      // менеджер; `delivery_cost` null (назовут при звонке) ничего не добавляет
      to_pay: total - (loyalty?.discount ?? 0) - (loyalty?.bonus_spent ?? 0) + (delivery.cost ?? 0),
      ...(customer && {
        customer,
        bonus_spent: loyalty?.bonus_spent ?? 0,
        discount: loyalty?.discount ?? 0,
      }),
    };
  });

  action('orders.items.create', async ({ key, payload }, { database, schema }) => {
    try {
      const roles = await database('directus_roles').whereIn('name', NOTIFY_ROLES).pluck('id');
      const users = roles.length
        ? await database('directus_users').whereIn('role', roles).where({ status: 'active' }).pluck('id')
        : [];
      if (!users.length) return;
      const lines = (payload.items ?? []).map((line) => `- ${line.title} × ${line.qty} — ${rub(line.sum ?? 0)}`);
      // «бесплатно (от 7 000 ₽)» needs the zone's threshold; the order keeps only the zone's name
      // «бесплатно (от 7 000 ₽)» нужен порог зоны; в заказе лежит только её имя
      const freeFrom =
        payload.delivery_zone && Number(payload.delivery_cost) === 0
          ? ((await database('delivery_zones').where({ name: payload.delivery_zone }).first('free_from').catch(() => null))?.free_from ?? null)
          : null;
      // an order entered by an editor carries no delivery fields: its line stays as it was
      // у заказа, который вбил редактор, полей доставки нет: его строка остаётся как была
      const priced = 'delivery_cost' in payload || payload.source === 'site';
      const how =
        payload.fulfillment === 'pickup'
          ? 'Самовывоз'
          : `Доставка: ${payload.address ?? ''}${payload.address_details ? `, ${payload.address_details}` : ''}${
              priced ? ` · ${deliveryText({ zone: payload.delivery_zone, cost: payload.delivery_cost, freeFrom })}` : ''
            }`;
      const toPay = payload.to_pay ?? payload.total ?? 0;
      const message = [
        `**${payload.customer_name}**, ${payload.phone}`,
        `${how}. Когда: ${payload.desired_time ?? 'как можно скорее'}.`,
        '',
        ...lines,
        '',
        `Итого (блюда): ${rub(payload.total ?? 0)}`,
        `К оплате: **${rub(toPay)}**`,
        payload.comment ? `\nКомментарий: ${payload.comment}` : '',
        payload.manager_note ? `\n${payload.manager_note}` : '',
      ].join('\n');
      const notifications = new services.NotificationsService({ schema, knex: database });
      for (const recipient of users) {
        await notifications.createOne({
          recipient,
          subject: `Новый заказ ${payload.number ?? key} · ${rub(toPay)}`,
          message,
          collection: 'orders',
          item: String(key),
        });
      }
    } catch (error) {
      // a lost notification must not lose the order: it is already written
      // потерянное уведомление не должно терять заказ: он уже записан
      logger.warn(`order-guard: уведомление о заказе ${key} не создано — ${error.message}`);
    }
  });
};
