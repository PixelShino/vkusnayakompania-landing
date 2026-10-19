/**
 * Order and catering-request alerts by mail and Telegram. A new order or
 * request from the site goes to the addresses and chats in «Оповещения»
 * (`notify_settings`); every delivery is written to «Журнал оповещений»
 * (`notify_log`) and summed up in the card's «Оповещения» field, so a manager
 * sees at once whether the owner got it. Without SMTP the letter is «not sent:
 * SMTP is not configured» and the order is not touched; mail turns on with
 * EMAIL_TRANSPORT and its block in `directus/.env`.
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
 * И `POST /notify/test` (только администратор): пример заказа по тем же каналам
 * для проверки настроек.
 *
 * A bundle without a build step: this file is the API entry, `lib.js` the logic.
 * Бандл без сборки: этот файл — точка входа API, логика — в `lib.js`.
 */
import {
  deliver,
  demoModel,
  mailState,
  normalizeSettings,
  orderModel,
  requestModel,
  statusModel,
} from './lib.js';

// orders and requests typed in by the staff are not announced: they already know
// заказы и заявки, которые завёл сам персонал, не рассылаются — о них и так знают
const MANUAL_SOURCES = new Set(['phone', 'messenger']);
const LOG_KEEP_DAYS = 180;
const DAY = 86_400_000;

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
  if (collection === 'orders') return { row, model: orderModel(row, { place, adminUrl }) };
  const format = row.format ? (await database('catering_formats').where({ id: row.format }).first('title'))?.title : null;
  return { row, model: requestModel(row, { place, format, adminUrl }) };
};

const mailer = (services, database, schema) => async (message) => {
  const mail = new services.MailService({ schema, knex: database });
  await mail.send(message);
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

const hook = ({ action, init }, { services, env, logger, database: db, getSchema }) => {
  let pruned = 0;

  const run = async (event, collection, key, { database = db, schema } = {}, status) => {
    try {
      const settings = await loadSettings(database);
      if (status && !settings.status_changes) return;
      const loaded = await loadModel(database, env, collection, key);
      if (!loaded) return;
      const { row } = loaded;
      if (MANUAL_SOURCES.has(row.source) && !status) {
        await database(collection).where({ id: key }).update({ notify_result: 'не рассылалось: заведено в админке вручную' });
        return;
      }
      const model = status ? statusModel(loaded.model, status) : loaded.model;
      const { results, summary } = await deliver({
        model,
        settings,
        mail: mailState(env),
        sendMail: mailer(services, database, schema ?? (await getSchema())),
        secrets: secretsOf(env, settings),
      });
      await writeLog(database, event, model, key, results);
      // a status change keeps the first line: it answers «did the owner hear about the order»
      // смена статуса не перетирает строку: она отвечает на «узнала ли владелица о заказе»
      if (!status) await database(collection).where({ id: key }).update({ notify_result: summary });
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

  // actions run after the row is committed and do not hold the guest's answer
  // действия идут после записи и не задерживают ответ гостю
  action('orders.items.create', ({ key }, context) => run('order_new', 'orders', key, context));
  action('catering_requests.items.create', ({ key }, context) => run('request_new', 'catering_requests', key, context));
  for (const [collection, event] of [
    ['orders', 'order_status'],
    ['catering_requests', 'request_status'],
  ]) {
    action(`${collection}.items.update`, ({ keys, payload }, context) => {
      if (!payload || !('status' in payload)) return;
      for (const key of keys ?? []) run(event, collection, key, context, payload.status);
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
