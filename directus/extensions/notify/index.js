/**
 * Order and catering-request alerts by mail and Telegram. A new order or
 * request from the site goes to the addresses and chats in «Оповещения»
 * (`notify_settings`); every delivery is written to «Журнал оповещений»
 * (`notify_log`) and summed up in the card's «Оповещения» field, so a manager
 * sees at once whether the owner got it. Without SMTP the letter is «not sent:
 * SMTP is not configured» and the order is not touched; mail turns on with
 * EMAIL_TRANSPORT and its block in `directus/.env`.
 *
 * Since 23.10.2026 the order's Telegram message is alive: buttons under it move
 * the order («В работу», «Выполнен», «Отменить» with a second step), a status
 * change from anywhere — a button or the admin — rewrites that message with
 * «В работе — Дмитрий, 12:40» instead of posting a new one. An order paid
 * online is announced only once the bank confirmed the payment (an unpaid one
 * stays in the admin as «Ждём оплату» and never reaches the chat); the message
 * then already says «оплачен онлайн». Presses are fetched by long polling
 * (`getUpdates`) through the relay;
 * `TELEGRAM_BUTTONS=off` turns the polling off (a second copy of Directus with
 * the same bot would steal the presses).
 * Also `POST /notify/test` (administrators only): a demo order through the
 * same channels, to check the settings.
 *
 * Оповещения о заказах и заявках на кейтеринг — почтой и в Telegram. Новый
 * заказ или заявка с сайта уходит на адреса и в чаты из «Оповещений»
 * (`notify_settings`); каждая отправка пишется в «Журнал оповещений»
 * (`notify_log`) и одной строкой в поле «Оповещения» карточки — менеджер сразу
 * видит, дошло ли до владелицы. Без SMTP письмо «не отправлено: SMTP не
 * настроен», заказ при этом не страдает; почта включается EMAIL_TRANSPORT и его
 * блоком в `directus/.env`.
 *
 * С 23.10.2026 сообщение заказа в Telegram живое: кнопки под ним переводят
 * заказ («В работу», «Выполнен», «Отменить» со вторым шагом), смена статуса
 * откуда угодно — кнопкой или из админки — переписывает это сообщение строкой
 * «В работе — Дмитрий, 12:40», а не шлёт новое. Заказ с оплатой онлайн
 * объявляется только после подтверждения банка (неоплаченный остаётся в
 * админке как «Ждём оплату» и в чат не попадает); в сообщении тогда уже стоит
 * «оплачен онлайн». Нажатия забираются долгим опросом (`getUpdates`) через
 * ретранслятор;
 * `TELEGRAM_BUTTONS=off` выключает опрос (вторая копия Directus с тем же ботом
 * отбирала бы нажатия).
 * И `POST /notify/test` (только администратор): пример заказа по тем же каналам
 * для проверки настроек.
 *
 * A bundle without a build step: this file is the API entry, `lib.js` the logic.
 * Бандл без сборки: этот файл — точка входа API, логика — в `lib.js`.
 */
import {
  TELEGRAM_API,
  answerCallback,
  decideCallback,
  deliver,
  demoModel,
  editTelegram,
  editTelegramKeyboard,
  mailState,
  normalizeSettings,
  orderModel,
  parseCallback,
  pollTelegram,
  pressedBy,
  relayJob,
  requestModel,
  statusLogLine,
  statusModel,
  telegramBases,
  telegramChats,
  telegramKeyboard,
  telegramMeta,
  telegramText,
} from './lib.js';

// orders and requests typed in by the staff are not announced: they already know
// заказы и заявки, которые завёл сам персонал, не рассылаются — о них и так знают
const MANUAL_SOURCES = new Set(['phone', 'messenger']);
const LOG_KEEP_DAYS = 180;
const DAY = 86_400_000;
// the history under the order does not grow forever / история под заказом не растёт бесконечно
const HISTORY_KEEP = 20;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const adminLink = (env, collection, key) => {
  const base = String(env.PUBLIC_URL ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return null;
  return `${base}/admin/content/${collection}${key === undefined ? '' : `/${key}`}`;
};

const loadSettings = async (database) => normalizeSettings(await database('notify_settings').first());

/** Model of a stored order or request, related titles included. / Модель записанного заказа или заявки, со связями. */
const loadModel = async (database, env, collection, key) => {
  const row = await database(collection).where({ id: key }).first();
  if (!row) return null;
  const adminUrl = adminLink(env, collection, key);
  const place = row.place ? (await database('places').where({ id: row.place }).first('name'))?.name : null;
  if (collection === 'orders') return { row, place, model: orderModel(row, { place, adminUrl }) };
  const format = row.format ? (await database('catering_formats').where({ id: row.format }).first('title'))?.title : null;
  return { row, place, model: requestModel(row, { place, format, adminUrl }) };
};

// one MailService per delivery: its constructor checks the SMTP connection
// один MailService на рассылку: его конструктор проверяет соединение с SMTP
const mailer = (services, database, schema) => {
  let mail = null;
  return async (message) => {
    mail ??= new services.MailService({ schema, knex: database });
    await mail.send(message);
  };
};

const secretsOf = (env, settings) => [settings.telegram_token, env.EMAIL_SMTP_PASSWORD, env.EMAIL_MAILGUN_API_KEY].filter(Boolean);

const writeLog = async (database, event, model, key, results) => {
  if (!results.length) return;
  const now = new Date();
  await database('notify_log').insert(
    results.map((r) => ({
      date_created: now,
      event,
      channel: r.channel,
      recipient: r.recipient,
      status: r.status,
      error: r.error,
      attempts: r.attempts,
      order: model?.collection === 'orders' && key !== undefined ? key : null,
      request: model?.collection === 'catering_requests' && key !== undefined ? key : null,
      subject: model?.headline ?? null,
    })),
  );
};

/** The order's Telegram memory written back. / Память заказа о Telegram, записанная обратно. */
const saveMeta = (database, key, meta) =>
  database('orders')
    .where({ id: key })
    .update({ telegram_meta: JSON.stringify({ messages: meta.messages, history: meta.history.slice(-HISTORY_KEEP), announced: meta.announced === true }) });

/** The messages a delivery produced, remembered so they can be edited later. / Сообщения рассылки — чтобы потом их править. */
const rememberSent = async (database, key, row, results, { announced = false } = {}) => {
  const sent = results.filter((r) => r.channel === 'telegram' && (r.messageId || r.job));
  const meta = telegramMeta(row);
  if (announced) meta.announced = true;
  if (!sent.length) {
    if (announced) {
      await saveMeta(database, key, meta);
      row.telegram_meta = meta;
    }
    return;
  }
  for (const r of sent) {
    const found = meta.messages.find((m) => String(m.chat) === String(r.chat));
    const entry = r.messageId ? { chat: String(r.chat), message_id: r.messageId } : { chat: String(r.chat), job: r.job };
    if (found) Object.assign(found, entry);
    else meta.messages.push(entry);
  }
  await saveMeta(database, key, meta);
  row.telegram_meta = meta;
};

const hook = ({ action, init }, { services, env, logger, database: db, getSchema }) => {
  let pruned = 0;
  // who pressed the button, waiting for the status action that the press causes
  // кто нажал кнопку — ждёт действия смены статуса, которое это нажатие вызовет
  const actors = new Map();
  // one order's events run one after another: the message must exist before it is edited
  // события одного заказа идут по очереди: сообщение должно появиться раньше, чем его правят
  const chains = new Map();
  const serial = (key, fn) => {
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn).finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
    chains.set(key, next);
    return next;
  };

  const senders = async (database, schema) => ({
    mail: mailState(env),
    sendMail: mailer(services, database, schema ?? (await getSchema())),
    bases: telegramBases(env),
  });

  /** Whether the order was already announced to the channels. / Объявлен ли заказ каналам. */
  const announced = (row) => telegramMeta(row).announced === true;
  /** An online order waits for the bank: no message until the money is in. / Заказ с оплатой онлайн ждёт банк: без оплаты сообщения нет. */
  const awaitsPayment = (row) => row.payment_method === 'online' && row.payment_status !== 'paid';

  /**
   * A new order or request: the message to every channel. An order paid
   * online is announced when the bank confirms, not when the guest fills the
   * form: the kitchen sees paid orders only.
   * Новый заказ или заявка: сообщение по всем каналам. Заказ с оплатой онлайн
   * объявляется, когда банк подтвердил, а не когда гость заполнил форму: кухня
   * видит только оплаченные.
   */
  const announce = async (event, collection, key, { database = db, schema } = {}) => {
    try {
      const settings = await loadSettings(database);
      const loaded = await loadModel(database, env, collection, key);
      if (!loaded) return;
      const { row, model } = loaded;
      if (MANUAL_SOURCES.has(row.source)) {
        await database(collection).where({ id: key }).update({ notify_result: 'не рассылалось: заведено в админке вручную' });
        return;
      }
      if (collection === 'orders') {
        if (announced(row)) return;
        if (awaitsPayment(row)) {
          await database(collection).where({ id: key }).update({ notify_result: 'ждёт оплату онлайн — уйдёт, когда банк подтвердит' });
          return;
        }
      }
      const { results, summary } = await deliver({ model, settings, secrets: secretsOf(env, settings), ...(await senders(database, schema)) });
      await writeLog(database, event, model, key, results);
      await database(collection).where({ id: key }).update({ notify_result: summary });
      if (collection === 'orders') await rememberSent(database, key, row, results, { announced: true });
      const failed = results.filter((r) => r.status === 'failed');
      if (failed.length) logger.warn(`notify: ${event} ${key} — ${summary}`);
      else logger.info(`notify: ${event} ${key} — ${summary}`);
      if (Date.now() - pruned > DAY) {
        pruned = Date.now();
        await database('notify_log').where('date_created', '<', new Date(Date.now() - LOG_KEEP_DAYS * DAY)).delete();
      }
    } catch (error) {
      // an alert that failed must not fail the order: it is already written
      // сбой оповещения не должен ронять заказ: он уже записан
      logger.warn(`notify: ${event} ${key} не разослано — ${error.message}`);
    }
  };

  /**
   * The order's messages in Telegram rewritten for its current state. A
   * message the relay still holds gets its id from the relay's ticket; one
   * Telegram no longer finds is forgotten. Returns the chats that now show
   * the fresh text.
   * Сообщения заказа в Telegram, переписанные под его текущее состояние.
   * Сообщение, которое ретранслятор ещё держит, получает id по талону; то,
   * которого Telegram уже не находит, забывается. Возвращает чаты, где текст
   * теперь свежий.
   */
  const refresh = async (database, settings, key, row, model, event) => {
    const meta = telegramMeta(row);
    const edited = new Set();
    if (!meta.messages.length || !settings.telegram_enabled || !settings.telegram_token) return { edited, meta };
    const bases = telegramBases(env);
    const relay = bases[0] !== TELEGRAM_API ? bases[0] : null;
    const text = telegramText(model);
    const keyboard = model.keyboard ?? null;
    const keep = [];
    const results = [];
    let changed = false;
    for (const m of meta.messages) {
      let messageId = m.message_id ?? null;
      if (!messageId && m.job) {
        const fate = await relayJob({ base: relay, token: settings.telegram_token, job: m.job });
        if (fate?.lost) {
          changed = true;
          continue;
        }
        if (fate?.messageId) {
          messageId = fate.messageId;
          Object.assign(m, { message_id: messageId });
          delete m.job;
          changed = true;
        }
      }
      if (!messageId) {
        keep.push(m);
        continue;
      }
      const r = await editTelegram({ token: settings.telegram_token, chatId: m.chat, messageId, text, keyboard, bases });
      if (r.status === 'failed' && /message to edit not found|message can't be edited|MESSAGE_ID_INVALID/i.test(r.error ?? '')) {
        changed = true;
        continue;
      }
      keep.push(m);
      if (r.status !== 'failed') edited.add(String(m.chat));
      const chat = telegramChats(settings, 'order', true).find((c) => c.id === String(m.chat));
      results.push({ channel: 'telegram', recipient: chat?.label ? `${chat.label} (${m.chat})` : String(m.chat), status: r.status, error: r.error, attempts: r.attempts });
    }
    if (changed || keep.length !== meta.messages.length) {
      meta.messages = keep;
      await saveMeta(database, key, meta);
    }
    await writeLog(database, event, model, key, results);
    return { edited, meta };
  };

  /** Who changed the status, when it was not a button: the admin user, else the machine. / Кто сменил статус, если не кнопкой. */
  const actorOf = async (database, key, accountability) => {
    const pressed = actors.get(key);
    if (pressed) {
      actors.delete(key);
      return pressed;
    }
    if (accountability?.user) {
      const user = await database('directus_users').where({ id: accountability.user }).first('first_name', 'last_name', 'email');
      const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || String(user?.email ?? '').split('@')[0] || 'сотрудник';
      return { who: name, via: 'admin' };
    }
    return { who: 'автоматически', via: 'system' };
  };

  /** The status moved: the history, the message rewritten, the old-style notice where there is nothing to rewrite. / Статус сменился. */
  const onStatus = async (collection, key, status, { database = db, schema, accountability } = {}) => {
    try {
      const settings = await loadSettings(database);
      const event = collection === 'orders' ? 'order_status' : 'request_status';
      if (collection !== 'orders') {
        if (!settings.status_changes) return;
        const loaded = await loadModel(database, env, collection, key);
        if (!loaded) return;
        const model = statusModel(loaded.model, status);
        const { results } = await deliver({ model, settings, secrets: secretsOf(env, settings), ...(await senders(database, schema)) });
        await writeLog(database, event, model, key, results);
        return;
      }
      const actor = await actorOf(database, key, accountability);
      const first = await database('orders').where({ id: key }).first();
      if (!first) return;
      const meta = telegramMeta(first);
      // an order nobody heard of (unpaid online) keeps its history to itself
      // заказ, о котором никто не слышал (неоплаченный онлайн), историю никому не шлёт
      const quiet = !announced(first);
      const entry = { status, who: actor.who, via: actor.via, at: new Date().toISOString() };
      meta.history.push(entry);
      const line = statusLogLine(entry);
      await database('orders')
        .where({ id: key })
        .update({
          telegram_meta: JSON.stringify({ messages: meta.messages, history: meta.history.slice(-HISTORY_KEEP) }),
          status_log: first.status_log ? `${first.status_log}\n${line}` : line,
        });
      if (quiet) return;
      const loaded = await loadModel(database, env, collection, key);
      if (!loaded) return;
      const { edited } = await refresh(database, settings, key, loaded.row, loaded.model, event);
      logger.info(`notify: ${event} ${key} — «${status}» ${actor.who}${edited.size ? `, сообщение обновлено в ${edited.size} чат(ах)` : ''}`);
      // the separate notice, as before the buttons: mail, and chats with no message to rewrite
      // отдельное сообщение, как до кнопок: почта и чаты, где переписывать нечего
      if (!settings.status_changes) return;
      const model = statusModel(loaded.model, status);
      const rest = { ...settings, telegram_chats: settings.telegram_chats.filter((c) => !edited.has(String(c?.chat_id ?? '').trim())) };
      const { results } = await deliver({ model, settings: rest, secrets: secretsOf(env, settings), ...(await senders(database, schema)) });
      await writeLog(database, event, model, key, results);
    } catch (error) {
      logger.warn(`notify: статус ${collection} ${key} — ${error.message}`);
    }
  };

  /**
   * The payment moved. A paid order not announced yet goes out now, already
   * with «оплачен онлайн»; an announced one has its message rewritten. No
   * extra message either way.
   * Оплата сменилась. Оплаченный, но ещё не объявленный заказ уходит сейчас,
   * уже с «оплачен онлайн»; объявленный — переписывается. Лишних сообщений
   * нет в обоих случаях.
   */
  const onPayment = async (key, payload, context = {}) => {
    const { database = db } = context;
    try {
      const first = await database('orders').where({ id: key }).first();
      if (!first) return;
      if (!announced(first)) {
        // paid, or the guest chose to pay on delivery after all: now it is a real order
        // оплачен — или гость всё-таки выбрал оплату при получении: теперь это настоящий заказ
        if (payload.payment_status === 'paid' || (payload.payment_method === 'on_delivery' && !awaitsPayment(first))) await announce('order_new', 'orders', key, context);
        return;
      }
      const settings = await loadSettings(database);
      const loaded = await loadModel(database, env, 'orders', key);
      if (!loaded) return;
      await refresh(database, settings, key, loaded.row, loaded.model, 'order_payment');
    } catch (error) {
      logger.warn(`notify: оплата заказа ${key} — ${error.message}`);
    }
  };

  /** A button under an order was pressed. / Нажата кнопка под заказом. */
  const onPress = async (query, settings) => {
    const token = settings.telegram_token;
    const bases = telegramBases(env);
    const chat = String(query.message?.chat?.id ?? '');
    const messageId = query.message?.message_id ?? null;
    const answer = (text) => answerCallback({ token, callbackId: query.id, text, bases }).catch(() => {});
    const redraw = (row, confirm = false) =>
      messageId ? editTelegramKeyboard({ token, chatId: chat, messageId, keyboard: telegramKeyboard(row, { confirm }), bases }) : Promise.resolve();
    const press = parseCallback(query.data);
    if (!press) return answer('Эта кнопка больше не работает');
    if (!telegramChats(settings, 'order', true).some((c) => c.id === chat)) return answer('Этот чат не подключён к заказам');
    const row = await db('orders').where({ id: press.id }).first();
    if (!row) return answer('Заказ не найден');
    const verdict = decideCallback(row, press.what);
    if (verdict.kind === 'toast') {
      // stale buttons: show the real ones / устаревшие кнопки: показать настоящие
      await answer(verdict.toast);
      await redraw(row);
      return;
    }
    if (verdict.kind === 'confirm' || verdict.kind === 'keep') {
      await redraw(row, verdict.kind === 'confirm');
      await answer(verdict.toast);
      return;
    }
    // an order from before the buttons has no message on record: this one is it
    // у заказа, сделанного до кнопок, сообщение не записано: вот оно
    if (messageId) {
      const meta = telegramMeta(row);
      if (!meta.messages.some((m) => String(m.chat) === chat)) {
        meta.messages.push({ chat, message_id: messageId });
        await saveMeta(db, row.id, meta);
      }
    }
    actors.set(row.id, { who: pressedBy(query.from), via: 'telegram' });
    const items = new services.ItemsService('orders', { schema: await getSchema(), knex: db });
    await items.updateOne(row.id, { status: verdict.status });
    await answer(verdict.toast);
    logger.info(`notify: заказ ${row.id} → «${verdict.status}» кнопкой, ${pressedBy(query.from)}`);
  };

  /** The long poll for presses, forever, quiet until something changes. / Долгий опрос нажатий, навсегда, молча, пока ничего не меняется. */
  const pollForever = async () => {
    let offset = null;
    let lastError = '';
    for (;;) {
      try {
        const settings = await loadSettings(db);
        if (!settings.telegram_enabled || !settings.telegram_token || !settings.telegram_chats.length) {
          await sleep(20_000);
          continue;
        }
        const r = await pollTelegram({ token: settings.telegram_token, offset, bases: telegramBases(env) });
        if (r.error) {
          if (r.error !== lastError) logger.warn(`notify: опрос кнопок Telegram — ${r.error}`);
          lastError = r.error;
          // 409 — another copy polls the same bot: back off longer / 409 — тот же бот опрашивает кто-то ещё
          await sleep(r.code === 409 ? 60_000 : 10_000);
          continue;
        }
        if (lastError) logger.info('notify: опрос кнопок Telegram снова работает');
        lastError = '';
        for (const update of r.updates) {
          if (!update.callback_query) continue;
          await onPress(update.callback_query, settings).catch((error) => logger.warn(`notify: нажатие кнопки — ${error.message}`));
        }
        offset = r.offset;
      } catch (error) {
        logger.warn(`notify: опрос кнопок Telegram — ${error.message}`);
        await sleep(10_000);
      }
    }
  };

  // actions run after the row is committed and do not hold the guest's answer
  // действия идут после записи и не задерживают ответ гостю
  action('orders.items.create', ({ key }, context) => serial(key, () => announce('order_new', 'orders', key, context)));
  action('catering_requests.items.create', ({ key }, context) => announce('request_new', 'catering_requests', key, context));
  for (const collection of ['orders', 'catering_requests']) {
    action(`${collection}.items.update`, ({ keys, payload }, context) => {
      if (!payload || typeof payload !== 'object') return;
      for (const key of keys ?? []) {
        if ('status' in payload) {
          if (collection === 'orders') serial(key, () => onStatus(collection, key, payload.status, context));
          else onStatus(collection, key, payload.status, context);
        }
        if (collection === 'orders' && ('payment_status' in payload || 'payment_method' in payload)) serial(key, () => onPayment(key, payload, context));
      }
    });
  }

  // what the admin shows under «Состояние почты»: decided by env, so refreshed on every start
  // что админка показывает в «Состоянии почты»: зависит от env, обновляется при каждом старте
  init('app.after', async () => {
    try {
      const mail = mailState(env);
      const text = mail.ok ? `Включена: ${mail.label}, от ${env.EMAIL_FROM ?? '—'}` : `Письма не уходят: ${mail.reason}`;
      const state = { email_state: text, email_ready: mail.ok };
      const row = await db('notify_settings').first('id');
      if (row) await db('notify_settings').where({ id: row.id }).update(state);
      else await db('notify_settings').insert(state);
    } catch (error) {
      logger.warn(`notify: состояние почты не записано — ${error.message}`);
    }
    if (String(env.TELEGRAM_BUTTONS ?? 'on').toLowerCase() === 'off') {
      logger.info('notify: опрос кнопок Telegram выключен (TELEGRAM_BUTTONS=off)');
      return;
    }
    pollForever();
  });
};

const endpoint = (router, { services, env, logger, database, getSchema }) => {
  /**
   * POST /notify/test { channel?: 'all' | 'email' | 'telegram', kind?: 'order' | 'request', to?: 'a@b.ru' }
   * A demo order (or request) to every listed address and chat, ticks ignored.
   * Пример заказа (или заявки) на все адреса и в чаты из списка, галочки не учитываются.
   */
  router.post('/test', async (req, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ errors: [{ message: 'Проверка оповещений — только для администратора', extensions: { code: 'FORBIDDEN' } }] });
    }
    try {
      const body = req.body ?? {};
      const settings = await loadSettings(database);
      const channel = ['email', 'telegram'].includes(body.channel) ? body.channel : 'all';
      const kind = body.kind === 'request' ? 'request' : 'order';
      if (typeof body.to === 'string' && body.to.trim()) settings.email_recipients = [{ email: body.to.trim() }];
      if (channel === 'email') settings.telegram_enabled = false;
      if (channel === 'telegram') settings.email_enabled = false;
      const model = demoModel(kind, adminLink(env, 'notify_log'));
      const { results, summary } = await deliver({
        model,
        settings,
        mail: mailState(env),
        sendMail: mailer(services, database, await getSchema()),
        secrets: secretsOf(env, settings),
        bases: telegramBases(env),
      });
      await writeLog(database, 'test', model, undefined, results);
      logger.info(`notify: проверка — ${summary}`);
      res.json({ data: { summary, results } });
    } catch (error) {
      logger.warn(`notify: проверка не прошла — ${error.message}`);
      res.status(500).json({ errors: [{ message: `Проверка не прошла: ${error.message}` }] });
    }
  });
};

export default {
  hooks: [{ name: 'notify-hook', config: hook }],
  endpoints: [{ name: 'notify-endpoint', config: { id: 'notify', handler: endpoint } }],
  operations: [],
};
