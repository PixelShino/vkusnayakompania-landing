/**
 * The stub bank for local and staging checks: the same provider shape as
 * `alfa.js`, a «payment page» of our own with «Pay» and «Decline» buttons,
 * the bank's memory in a Map. Works only in test mode (`resolveSettings` turns
 * it off in production): it never takes money, so it must never face a guest.
 * Банк-заглушка для локальной и предбоевой проверки: та же форма провайдера,
 * что у `alfa.js`, своя «страница оплаты» с кнопками «Оплатить» и «Отклонить»,
 * память банка — в Map. Работает только в тестовом режиме (`resolveSettings`
 * выключает её в боевом): денег она не берёт, гостю её показывать нельзя.
 */
import { randomUUID } from 'node:crypto';

// one bank for the whole process, so the page and the API see the same orders
// один «банк» на процесс: страница и API видят одни и те же заказы
const orders = new Map();

export const mockOrders = orders;

export const mock = (_settings, { publicUrl }) => ({
  id: 'mock',
  label: 'Заглушка',
  async register({ orderNumber, amount, description, returnUrl, failUrl, bundle, sessionSeconds }) {
    if (orders.size > 500) for (const key of orders.keys()) if (orders.size > 400) orders.delete(key);
    const id = `mock-${randomUUID()}`;
    orders.set(id, {
      id,
      orderNumber,
      amount,
      description,
      returnUrl,
      failUrl,
      bundle,
      state: 'pending',
      until: Date.now() + sessionSeconds * 1000,
    });
    return { id, url: `${publicUrl}/pay/mock/${id}` };
  },
  // answers in the gateway's own codes (0 waits, 2 paid, 6 declined, -2007
  // timed out), so the service treats the stub and the bank alike
  // отвечает кодами самого шлюза (0 ждёт, 2 оплачен, 6 отклонён, -2007 истекло
  // время), чтобы сервис обращался с заглушкой и банком одинаково
  async status(id) {
    const order = orders.get(id);
    // forgotten after a restart: that page can never be paid any more
    // забыт после перезапуска: эту страницу уже никогда не оплатить
    if (!order) return { state: 'failed', amount: 0, code: 6, note: 'заглушка забыла заказ после перезапуска' };
    if (order.state === 'pending' && Date.now() > order.until) order.state = 'expired';
    const state = order.state === 'expired' ? 'failed' : order.state;
    return {
      state,
      amount: order.amount,
      code: { pending: 0, paid: 2, failed: 6, expired: 6 }[order.state],
      action: order.state === 'expired' ? -2007 : null,
      note: order.state === 'expired' ? 'время на оплату истекло' : order.state === 'failed' ? 'отклонено на странице заглушки' : null,
      orderNumber: order.orderNumber,
    };
  },
  async check() {
    return { ok: true, message: 'Заглушка: денег не берёт, работает только в тестовом режиме' };
  },
});
