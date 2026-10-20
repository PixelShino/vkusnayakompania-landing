/**
 * Every fixed line of the page that is not content (buttons, section headings,
 * captions) lives in the admin, «Тексты сайта», grouped by page section. The
 * values here are the defaults: an empty field in the admin falls back to them,
 * so a cleared field never leaves a hole, and fixture builds need no data.
 * `scripts/texts-sync.mjs` creates the fields and fills the empty ones from here.
 * Aria labels, stub captions and the open/closed status stay in code: they are
 * not copy but behaviour.
 * Все постоянные строки страницы, которые не контент (кнопки, заголовки
 * разделов, подписи), правятся в админке, «Тексты сайта», по разделам страницы.
 * Значения здесь — по умолчанию: пустое поле в админке берёт их, поэтому
 * стёртое поле не оставляет дыру, а сборке на фикстуре данные не нужны.
 * `scripts/texts-sync.mjs` заводит поля и заполняет пустые отсюда. Подписи для
 * скринридера, плашки заглушек и статус «открыто/закрыто» остаются в коде:
 * это не тексты, а поведение.
 */

/** `long` — многострочное поле, `note` — подсказка редактору под полем. */
type Field = { key: string; label: string; value: string; long?: boolean; note?: string };
type Group = { key: string; title: string; fields: readonly Field[] };

export const TEXT_GROUPS = [
  {
    key: 'g_header',
    title: 'Шапка и общие кнопки',
    fields: [
      { key: 'nav_home', label: 'Меню шапки: главная', value: 'Главная' },
      { key: 'nav_afisha', label: 'Меню шапки: афиша', value: 'Афиша' },
      { key: 'nav_delivery', label: 'Меню шапки: доставка', value: 'Доставка' },
      { key: 'nav_about', label: 'Меню шапки: о нас', value: 'О нас' },
      { key: 'nav_menu', label: 'Меню шапки: меню', value: 'Меню' },
      { key: 'nav_contacts', label: 'Меню шапки: контакты', value: 'Контакты' },
      {
        key: 'btn_book',
        label: 'Кнопка брони',
        value: 'Забронировать стол',
        note: 'В шапке, на первом экране и в афише',
      },
      {
        key: 'btn_delivery',
        label: 'Кнопка доставки',
        value: 'Заказать доставку',
        note: 'В шапке, на первом экране и в нижней панели телефона',
      },
      {
        key: 'btn_call',
        label: 'Кнопка звонка',
        value: 'Позвонить',
        note: 'Нижняя панель телефона, окно брони, страница 404',
      },
      { key: 'book_title', label: 'Заголовок окна брони', value: 'Бронь стола' },
    ],
  },
  {
    key: 'g_hero',
    title: 'Первый экран',
    fields: [
      {
        key: 'seal_top',
        label: 'Печать: верхняя дуга',
        value: 'ТОРТ НА ЗАКАЗ',
        note: 'Круглая печать справа внизу. До 14 знаков, иначе не уместится на дуге',
      },
      {
        key: 'seal_bottom',
        label: 'Печать: нижняя дуга',
        value: 'ЗА 48 ЧАСОВ',
        note: 'До 12 знаков',
      },
    ],
  },
  {
    key: 'g_venues',
    title: 'О нас: точки и услуги',
    fields: [
      { key: 'venue_today', label: 'Перед часами работы точки', value: 'Сегодня' },
      { key: 'venue_book', label: 'Кнопка брони у точки', value: 'Забронировать' },
      { key: 'venue_menu', label: 'Кнопка меню у точки', value: 'Меню' },
      { key: 'service_menu', label: 'Кондитерская: ссылка на меню', value: 'Меню' },
      { key: 'service_app', label: 'Кондитерская: ссылка на приложение', value: 'В приложении' },
      { key: 'service_catering', label: 'Кейтеринг: ссылка на сайт', value: 'На сайт кейтеринга' },
      { key: 'service_banquet', label: 'Банкеты: ссылка', value: 'Обсудить банкет' },
      { key: 'banquet_title', label: 'Банкеты: заголовок окна брони', value: 'Банкет' },
      {
        key: 'banquet_note',
        label: 'Банкеты: подсказка в окне брони',
        value: 'Скажите дату, число гостей и повод',
      },
    ],
  },
  {
    key: 'g_numbers',
    title: 'Цифры',
    fields: [
      {
        key: 'nums_places',
        label: 'Подпись к числу точек',
        value: 'в Самаре',
        note: 'Идёт после слова «точки»: «2 точки в Самаре»',
      },
      { key: 'nums_hours_value', label: 'Срок торта, часов', value: '48', note: 'Только число' },
      { key: 'nums_hours', label: 'Подпись к сроку торта', value: 'часов на торт' },
      {
        key: 'nums_cakes',
        label: 'Подпись к числу тортов',
        value: 'в меню',
        note: 'Идёт после слова «тортов»: «12 тортов в меню»',
      },
    ],
  },
  {
    key: 'g_gallery',
    title: 'Фотогалерея',
    fields: [{ key: 'gallery_title', label: 'Заголовок', value: 'Фотогалерея' }],
  },
  {
    key: 'g_afisha',
    title: 'Афиша и акции',
    fields: [
      { key: 'afisha_title', label: 'Заголовок афиши', value: 'Афиша' },
      { key: 'afisha_more', label: 'Ссылка «подробнее» в афише', value: 'Подробнее' },
      { key: 'promos_title', label: 'Заголовок акций', value: 'Акции' },
      {
        key: 'promos_both',
        label: 'Акция без точки',
        value: 'Обе точки',
        note: 'Печатается у акции, где не выбрана точка',
      },
    ],
  },
  {
    key: 'g_menu',
    title: 'Меню',
    fields: [
      { key: 'menu_title', label: 'Заголовок', value: 'Меню' },
      { key: 'menu_order', label: 'Кнопка заказа', value: 'Заказать в приложении' },
      {
        key: 'menu_confectionery',
        label: 'Подпись кондитерской',
        value: 'Пирожные, торты, конфеты',
        note: 'У кафе и ресторана подпись берётся из «Точек»',
      },
      { key: 'menu_open', label: 'Кнопка открытия меню', value: 'Открыть PDF' },
      { key: 'menu_soon', label: 'Меню ещё нет', value: 'Меню скоро появится' },
      { key: 'menu_soon_tag', label: 'Пометка «скоро»', value: 'скоро' },
      { key: 'menu_sample_tag', label: 'Пометка у меню-образца', value: 'образец' },
      {
        key: 'menu_updated',
        label: 'Пометка обновления',
        value: 'обновлено',
        note: 'Дальше сайт сам подставит дату: «обновлено 24 сентября»',
      },
    ],
  },
  {
    key: 'g_cakes',
    title: 'Торты',
    fields: [
      {
        key: 'cake_custom',
        label: 'Кнопка торта на заказ',
        value: 'Торт на заказ',
        note: 'Он же заголовок окна брони',
      },
      {
        key: 'cake_custom_note',
        label: 'Подсказка в окне торта на заказ',
        value: 'Пришлите картинку, посчитаем в тот же день',
      },
      { key: 'cakes_ready', label: 'Кнопка тортов в наличии', value: 'Торты в наличии' },
      { key: 'cakes_more', label: 'Кнопка «показать ещё»', value: 'Показать ещё' },
      { key: 'cakes_less', label: 'Кнопка «свернуть»', value: 'Свернуть' },
    ],
  },
  {
    key: 'g_delivery',
    title: 'Доставка',
    fields: [{ key: 'delivery_shop', label: 'Кнопка магазина', value: 'Открыть магазин' }],
  },
  {
    key: 'g_reviews',
    title: 'Отзывы',
    fields: [
      { key: 'reviews_title', label: 'Заголовок', value: 'Что говорят гости' },
      {
        key: 'reviews_lead',
        label: 'Текст под заголовком',
        long: true,
        value:
          'Ничего не переписываем и не отбираем — ниже живой виджет Яндекс Карт со всеми отзывами, как есть.',
      },
      { key: 'reviews_all', label: 'Ссылка на все отзывы', value: 'Все отзывы' },
    ],
  },
  {
    key: 'g_marquee',
    title: 'Бегущая строка',
    fields: [
      {
        key: 'marquee',
        label: 'Фразы',
        long: true,
        note: 'Одна фраза — одна строка',
        value: [
          'Завтраки с восьми утра',
          'Супы и паста днём',
          'Торты на заказ за 48 часов',
          'Пирожные и конфеты',
          'Банкеты под ключ',
          'Кейтеринг',
          'Детские праздники',
          'Доставка по Самаре',
        ].join('\n'),
      },
    ],
  },
  {
    key: 'g_contacts',
    title: 'Контакты',
    fields: [
      { key: 'contacts_title', label: 'Заголовок', value: 'Контакты' },
      { key: 'contacts_lead', label: 'Строка под заголовком', value: 'Две точки в городе' },
      { key: 'contacts_phone', label: 'Подпись телефона', value: 'Телефон' },
      { key: 'contacts_hours', label: 'Подпись часов', value: 'Часы' },
      { key: 'contacts_route', label: 'Кнопка маршрута', value: 'Построить маршрут' },
      { key: 'contacts_map', label: 'Ссылка на Яндекс Карты', value: 'На Яндекс Картах' },
      { key: 'contacts_write', label: 'Заголовок «написать нам»', value: 'Написать нам' },
    ],
  },
  {
    key: 'g_footer',
    title: 'Подвал',
    fields: [
      { key: 'footer_shop', label: 'Ссылка на магазин', value: 'Магазин доставки' },
      { key: 'footer_catering', label: 'Ссылка на кейтеринг', value: 'Кейтеринг и банкеты' },
      { key: 'footer_policy', label: 'Ссылка на политику', value: 'Политика конфиденциальности' },
      { key: 'footer_offer', label: 'Ссылка на оферту', value: 'Оферта' },
    ],
  },
  {
    key: 'g_404',
    title: 'Страница 404',
    fields: [
      { key: 'nf_kicker', label: 'Надпись над заголовком', value: 'Ошибка 404' },
      { key: 'nf_title', label: 'Заголовок', value: 'Такой страницы нет' },
      {
        key: 'nf_text',
        label: 'Текст',
        long: true,
        value:
          'Возможно, адрес набран с опечаткой или страница переехала. Всё о кафе, ресторане и кондитерской — на главной.',
      },
      { key: 'nf_home', label: 'Кнопка на главную', value: 'На главную' },
    ],
  },
] as const satisfies readonly Group[];

type Key = (typeof TEXT_GROUPS)[number]['fields'][number]['key'];
export type Texts = Record<Key, string>;

export const TEXT_DEFAULTS = Object.fromEntries(
  TEXT_GROUPS.flatMap((group) => group.fields.map((field) => [field.key, field.value])),
) as Texts;

/** Тексты из админки поверх значений по умолчанию; пустое и пробельное поле не считается. */
export const mergeTexts = (raw: Partial<Record<string, unknown>> | null | undefined): Texts => {
  const out = { ...TEXT_DEFAULTS };
  for (const key of Object.keys(out) as Key[]) {
    const value = raw?.[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
};

/** Фразы бегущей строки: по одной на строку, пустые строки пропускаются. */
export const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
