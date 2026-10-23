/**
 * Проверка «Вкусных баллов»: уровень, лимит списания, сгорание по FIFO, окно
 * дня рождения, сверка заказа с балансом. Каждый случай прогоняется дважды —
 * через `src/lib/loyalty.ts` сайта и через `rules.js` хука Directus: правило,
 * изменённое только в одном месте, роняет проверку.
 * Запуск: `pnpm test` (Node читает TypeScript сам).
 */
import assert from 'node:assert/strict';
import * as site from './loyalty.ts';

const server = (await import('../../directus/extensions/loyalty/rules.js')) as unknown as typeof site;

const suite = (lib: typeof site, who: string) => {
  const { tierFor, maxSpend, accrualFor, ledger, expiriesDue, birthdayWindow, reconcileOrder, toProgram, cleanTiers, expiryFor, birthdayDiscountFor } = lib;
  const tiers = site.DEFAULT_TIERS;

  // ── уровень по сумме покупок ──────────────────────────────────────────────
  const zero = tierFor(0, tiers);
  assert.equal(zero.tier.name, '1', who);
  assert.equal(zero.tier.percent, 3, who);
  assert.equal(zero.next?.name, '2', who);
  assert.equal(zero.left, 10000, who);
  assert.equal(tierFor(9999, tiers).tier.name, '1', who);
  assert.equal(tierFor(9999, tiers).left, 1, who);
  // порог включительно: ровно 10 000 ₽ — уже уровень 2
  assert.equal(tierFor(10000, tiers).tier.name, '2', who);
  assert.equal(tierFor(20000, tiers).progress, 0.5, who);
  const top = tierFor(45000, tiers);
  assert.equal(top.tier.name, '3', who);
  assert.equal(top.next, null, who);
  assert.equal(top.left, 0, who);
  assert.equal(top.progress, 1, who);

  // уровни, набранные в админке как попало: пустые имена выпадают, порядок по
  // порогу, первая ступень всегда от 0 ₽, повтор порога не плодит ступень
  const messy = cleanTiers([
    { name: 'Гурман', from: 30000, percent: 7 },
    { name: '', from: 5000, percent: 4 },
    { name: 'Новичок', from: 500, percent: 150 },
    { name: 'Свой', from: 10000, percent: 5 },
    { name: 'Дубль', from: 10000, percent: 6 },
  ]);
  assert.deepEqual(messy.map((t) => [t.name, t.from, t.percent]), [['Новичок', 0, 100], ['Свой', 10000, 5], ['Гурман', 30000, 7]], who);
  assert.equal(cleanTiers(null).length, 3, who);

  // ── сколько можно списать и сколько начислить ──────────────────────────────
  assert.equal(maxSpend({ total: 2000, balance: 1000, sharePercent: 30 }), 600, who);
  assert.equal(maxSpend({ total: 2000, balance: 100, sharePercent: 30 }), 100, who);
  // доля считается от суммы после скидки именинника
  assert.equal(maxSpend({ total: 2000, balance: 1000, sharePercent: 30, discount: 200 }), 540, who);
  assert.equal(maxSpend({ total: 2000, balance: 1000, sharePercent: 0 }), 0, who);
  assert.equal(maxSpend({ total: 999, balance: 1000, sharePercent: 30 }), 299, who);
  assert.equal(maxSpend({ total: 500, balance: -50, sharePercent: 30 }), 0, who);
  assert.equal(accrualFor(1450, 5), 72, who);
  assert.equal(accrualFor(-10, 5), 0, who);
  assert.equal(birthdayDiscountFor(1750, 10), 175, who);
  assert.equal(expiryFor('2026-10-19', 365), '2027-10-19', who);
  assert.equal(expiryFor('2026-10-19', 0), null, who);

  // ── книга баллов: FIFO по дню сгорания ────────────────────────────────────
  const TODAY = '2026-10-19';
  const signup = { id: 1, type: 'signup' as const, amount: 200, date: '2025-10-01T09:00:00Z', expires: '2026-10-01' };
  const accrual = { id: 2, type: 'accrual' as const, amount: 100, date: '2026-01-10T09:00:00Z', expires: '2027-01-10' };
  // списание берёт сначала то, что сгорает раньше: 200 регистрационных и 50 из начисления
  const all = ledger([signup, accrual, { id: 3, type: 'spend', amount: -250, date: '2026-02-01T09:00:00Z' }], TODAY);
  assert.equal(all.available, 50, who);
  assert.equal(all.burnt.length, 0, who);
  assert.equal(all.book, 50, who);

  // не потратил всё — остаток регистрационных сгорел 1 октября и ждёт списания
  const partial = [signup, accrual, { id: 3, type: 'spend' as const, amount: -150, date: '2026-02-01T09:00:00Z' }];
  const before = ledger(partial, TODAY);
  assert.equal(before.available, 100, who);
  assert.equal(before.book, 150, who);
  assert.deepEqual(before.burnt.map((lot) => lot.left), [50], who);
  const due = expiriesDue(partial, TODAY);
  assert.deepEqual(due, [{ type: 'expire', amount: -50, comment: 'Сгорели баллы от 01.10.2025' }], who);
  // проведённое сгорание закрывает партию: второй прогон ничего не находит
  const after = [...partial, { id: 4, type: 'expire' as const, amount: -50, date: '2026-10-19T00:05:00Z' }];
  assert.equal(ledger(after, TODAY).available, 100, who);
  assert.equal(ledger(after, TODAY).book, 100, who);
  assert.deepEqual(expiriesDue(after, TODAY), [], who);

  // баллы ко дню рождения живут неделю и уходят раньше годового начисления
  const birthday = ledger(
    [
      { id: 1, type: 'accrual', amount: 1000, date: '2026-03-01T09:00:00Z', expires: '2027-03-01' },
      { id: 2, type: 'birthday', amount: 500, date: '2026-10-18T21:00:00Z', expires: '2026-10-25' },
      { id: 3, type: 'spend', amount: -300, date: '2026-10-19T10:00:00Z' },
    ],
    TODAY,
  );
  assert.deepEqual(birthday.expiring, [{ day: '2026-10-25', amount: 200 }, { day: '2027-03-01', amount: 1000 }], who);
  assert.equal(birthday.available, 1200, who);

  // сгоревшая партия, ещё не списанная ночью, не тратится: списание берёт из живой
  const stale = ledger(
    [
      { id: 1, type: 'accrual', amount: 100, date: '2025-10-01T09:00:00Z', expires: '2026-10-01' },
      { id: 2, type: 'accrual', amount: 100, date: '2026-05-01T09:00:00Z', expires: '2027-05-01' },
      { id: 3, type: 'spend', amount: -100, date: '2026-10-05T09:00:00Z' },
    ],
    TODAY,
  );
  assert.equal(stale.available, 0, who);
  assert.deepEqual(stale.burnt.map((lot) => lot.left), [100], who);

  // откат начисления после того, как баллы уже потрачены, — долг; его гасит следующее начисление
  const debt = ledger(
    [
      { id: 1, type: 'refund', amount: -100, date: '2026-10-01T09:00:00Z' },
      { id: 2, type: 'accrual', amount: 300, date: '2026-10-02T09:00:00Z', expires: '2027-10-02' },
    ],
    TODAY,
  );
  assert.equal(debt.available, 200, who);
  assert.equal(debt.debt, 0, who);
  // сутки по Самаре: 23:30 UTC 30 сентября — это уже 1 октября, партия сгорела
  assert.equal(ledger([{ type: 'manual', amount: 50, date: '2026-09-30T23:30:00Z', expires: '2026-10-01' }], '2026-10-01').available, 0, who);

  // ── окно дня рождения ──────────────────────────────────────────────────────
  const win = birthdayWindow('1990-10-21', TODAY, 3)!;
  assert.equal(win.inWindow, true, who);
  assert.equal(win.day, '2026-10-21', who);
  assert.equal(win.distance, -2, who);
  assert.equal(win.burns, '2026-10-25', who);
  assert.equal(birthdayWindow('1990-10-21', '2026-10-25', 3)!.inWindow, false, who);
  assert.equal(birthdayWindow('1990-10-21', '2026-10-24', 3)!.inWindow, true, who);
  // через Новый год: подарок 30 декабря 2026 — за день рождения 2027 года
  const ny = birthdayWindow('1985-01-01', '2026-12-30', 3)!;
  assert.equal(ny.year, 2027, who);
  assert.equal(ny.inWindow, true, who);
  // 29 февраля в невисокосный год празднуется 28-го
  assert.equal(birthdayWindow('2000-02-29', '2026-02-27', 3)!.day, '2026-02-28', who);
  assert.equal(birthdayWindow(null, TODAY, 3), null, who);
  assert.equal(birthdayWindow('', TODAY, 3), null, who);

  // ── заказ и баланс сходятся при любом порядке статусов ─────────────────────
  type Applied = { type: site.TxType; amount: number };
  const order = { status: 'new', bonus_spent: 300, total: 1750, to_pay: 1450 };
  const fresh = reconcileOrder(order, [], 5);
  assert.deepEqual(fresh.map((tx) => [tx.type, tx.amount]), [['spend', -300]], who);
  const applied: Applied[] = [{ type: 'spend', amount: -300 }];
  assert.deepEqual(reconcileOrder(order, applied, 5), [], who);
  assert.deepEqual(reconcileOrder({ ...order, status: 'in_work' }, applied, 5), [], who);
  // заказ со списанными баллами выполнен: начисления нет (правило владельца 23.10.2026)
  assert.deepEqual(reconcileOrder({ ...order, status: 'done' }, applied, 5), [], who);
  assert.deepEqual(reconcileOrder({ ...order, status: 'done' }, applied, 7), [], who);
  // отмена после выполнения: баллы возвращаются
  const cancel = reconcileOrder({ ...order, status: 'cancelled' }, applied, 5);
  assert.deepEqual(cancel.map((tx) => [tx.type, tx.amount]), [['refund', 300]], who);
  applied.push({ type: 'refund', amount: 300 });
  assert.deepEqual(reconcileOrder({ ...order, status: 'cancelled' }, applied, 5), [], who);
  // и обратно в «выполнен» — снова списание, начисления по-прежнему нет
  const back = reconcileOrder({ ...order, status: 'done' }, applied, 5);
  assert.deepEqual(back.map((tx) => [tx.type, tx.amount]), [['spend', -300]], who);
  // старое начисление у заказа со списанием (до правила) при отмене снимается
  const legacy: Applied[] = [{ type: 'spend', amount: -300 }, { type: 'accrual', amount: 72 }];
  assert.deepEqual(reconcileOrder({ ...order, status: 'cancelled' }, legacy, 5).map((tx) => [tx.type, tx.amount]), [['refund', 300], ['refund', -72]], who);
  // заказ без баллов: начисление при «выполнен», повторно — нет, отмена снимает
  const clean = { status: 'done', bonus_spent: 0, total: 1750, to_pay: 1750 };
  const got = reconcileOrder(clean, [], 5);
  assert.deepEqual(got.map((tx) => [tx.type, tx.amount]), [['accrual', 87]], who);
  assert.deepEqual(reconcileOrder(clean, [{ type: 'accrual', amount: 87 }], 7), [], who);
  assert.deepEqual(reconcileOrder({ ...clean, status: 'cancelled' }, [{ type: 'accrual', amount: 87 }], 5).map((tx) => [tx.type, tx.amount]), [['refund', -87]], who);
  // без `to_pay` (заказ по телефону) — от суммы
  assert.deepEqual(reconcileOrder({ status: 'done', total: 1000 }, [], 3).map((tx) => [tx.type, tx.amount]), [['accrual', 30]], who);
  assert.deepEqual(reconcileOrder({ status: 'new', total: 1000 }, [], 3), [], who);

  // ── настройки из админки ──────────────────────────────────────────────────
  const program = toProgram({ enabled: true, program_name: ' ', max_share_percent: 150, tiers: JSON.stringify(tiers), birthday_window_days: null });
  assert.equal(program.name, 'Вкусные баллы', who);
  assert.equal(program.maxSharePercent, 100, who);
  assert.equal(program.birthdayWindow, 3, who);
  assert.equal(program.tiers.length, 3, who);
  assert.equal(toProgram(null).enabled, true, who);
  assert.equal(toProgram({ enabled: false }).enabled, false, who);
};

suite(site, 'сайт');
suite(server, 'хук Directus');

// слова — только на сайте
assert.equal(site.points(1), '1 балл');
assert.equal(site.points(3), '3 балла');
assert.equal(site.points(11), '11 баллов');
assert.equal(site.points(21), '21 балл');
assert.equal(site.plural(5, 'день', 'дня', 'дней'), '5\u00a0дней');
assert.equal(site.plural(22, 'день', 'дня', 'дней'), '22\u00a0дня');
assert.equal(site.plural(1, 'год', 'года', 'лет'), '1\u00a0год');
assert.match(site.points(1250), /^1\s250 баллов$/);

console.log('loyalty.check: ok');
