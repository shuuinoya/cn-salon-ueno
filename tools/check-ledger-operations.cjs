'use strict';
// 本番の送信無効コピーを読み込み、合成の台帳だけをメモリ内で変更する。実決済・メール・保存なし。
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict');
assert(process.argv[2], '送信無効コピーが必要です');
const root = path.resolve(process.argv[2]);
assert(!fs.existsSync(path.join(root, 'mail-config.json')));
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(k)) delete process.env[k];
const revive = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json'), 'utf8'), revive);
assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && !snapshot.state.mails.length);
const persist = require(path.join(root, 'persist.js')); persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot }); persist.startSaver = () => {};
const file = path.join(root, 'demo-api.js'), mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,postSchedule,ledgerContext,freeStaffIds,reportStats};', file);
const ops = require(path.join(root, 'ledger-operations.js'));
const encode = v => JSON.stringify(v, (_, x) => x instanceof Map ? { __pm_map__: [...x] } : x instanceof Set ? { __pm_set__: [...x] } : x);
(async () => {
  await mod.exports.ready;
  const { state, postSchedule, ledgerContext, freeStaffIds } = mod.exports.audit, c = ledgerContext();
  const manager = { user: 'test-manager', role: 'manager' }, staff = { user: 'test-staff', role: 'staff' };
  const date = c.addDays(c.todayJst(), 1), next = c.addDays(date, 1), after = c.addDays(date, 2), course = '364323-4822701';
  const results = [];
  const ev = d => state.events.get(d);
  function reset() {
    state.ledger = ops.createState(); state.events = new Map(); state.days = new Map(); state.shifts = new Map();
    state.bookingIndex = new Map(); state.reports = new Map(); state.mails = []; state.mailRelay = { url: '', secret: '' }; state.staffReconciliation = { version: 1 };
    state.staff = ['A', 'B'].map(id => ({ id, name: 'テスト担当' + id, active: 1, gender: 'male', courses: JSON.stringify([course]), profile: JSON.stringify({ message: 'テスト紹介', personalNomination: true }) }));
    state.photos = new Map(state.staff.map(s => [s.id, 'data:image/jpeg;base64,/9j/']));
    for (const d of [date, next, after]) {
      state.days.set(d, { version: 0, enabled: true }); state.events.set(d, { bookings: [], blocks: [], assignments: [] });
      state.shifts.set(d, state.staff.map(s => ({ staff_id: s.id, date: d, start_at: c.minToMs(d, 600), end_at: c.minToMs(d, 1320), note: '' })));
    }
    const booking = { id: 'test-booking', reference: 'TEST-LEDGER', date, name: 'テスト予約', course, course_name: 'テスト整体', status: 'confirmed', people: 1, total: 6600, start_at: c.minToMs(date, 720), end_at: c.minToMs(date, 780) };
    ev(date).bookings.push(booking); ev(date).assignments.push({ booking_id: booking.id, staff_id: 'A' }); state.bookingIndex.set(booking.id, date);
  }
  const post = (extra, actor = manager) => {
    const d = extra.date || date, b = get('checkout', { date: d }).bookings.find(x => x.bookingId === (extra.bookingId || 'test-booking'));
    return ops.post(state, { date, revision: state.ledger.version, requestKey: require('node:crypto').randomUUID(),
      dayRevision: state.days.get(d)?.version || 0, bookingFingerprint: b?.bookingFingerprint, ...extra }, actor, c);
  };
  const get = (view, extra = {}, actor = manager) => ops.get(state, { view, date, ...extra }, actor, c);
  const check = async (name, fn) => { reset(); try { await fn(); assert.equal(state.mails.length, 0); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: e.message.split('\n').slice(0, 3).join(' ') }); } };
  const unchanged = (fn, code) => { const before = encode(state); assert.throws(fn, e => e.message === code); assert.equal(encode(state), before); };
  const pay = extra => post({ action: 'checkout', bookingId: 'test-booking', amount: 6600, payments: [{ method: 'cash', amount: 6600 }], ...extra });
  const product = extra => post({ action: 'productSave', name: 'テスト商品', price: 1000, active: 1, ...extra }).id;
  const pattern = extra => post({ action: 'patternSave', name: 'テスト勤務', start: 600, end: 1320, blocks: [{ start: 840, end: 900, kind: 'break' }], ...extra }).id;
  const template = () => post({ action: 'templateSave', sourceDate: date, sourceRevision: state.days.get(date)?.version || 0, name: 'テストひな型' }).id;

  await check('全7画面を読み取れる・読み取りで台帳は変わらない', () => {
    const before = encode(state); for (const v of ['checkout', 'retail', 'returns', 'online', 'templates', 'patterns', 'integrity', 'dashboard', 'bookings']) assert.equal(get(v).view, v); assert.equal(encode(state), before);
  });
  await check('未認証とスタッフのマスタ編集を拒否', () => {
    unchanged(() => get('checkout', {}, null), 'forbidden'); unchanged(() => post({ action: 'productSave', name: 'テスト', price: 0 }, staff), 'forbidden');
    unchanged(() => post({ action: 'patternSave', name: 'テスト', start: 600, end: 900 }, staff), 'forbidden');
  });
  await check('現金カード混合の精算を保存・スタッフ権限で日常操作可', () => {
    post({ action: 'checkout', bookingId: 'test-booking', amount: 6600, payments: [{ method: 'cash', amount: 3000 }, { method: 'card', amount: 3600, detail: 'VISA' }] }, staff);
    assert.equal(get('checkout').bookings[0].payments.length, 2); assert.equal(ev(date).bookings[0].paid_amount, 6600);
  });
  await check('0円精算も精算済として保存し二重精算禁止', () => {
    pay({ amount: 0, payments: [] }); assert(ev(date).bookings[0].paid_at); unchanged(() => pay(), 'alreadyPaid');
  });
  await check('支払内訳と合計の不一致・負数・小数・不明方法を拒否', () => {
    unchanged(() => pay({ payments: [{ method: 'cash', amount: 6500 }] }), 'paymentMismatch');
    for (const amount of [-1, 1.5, NaN, Infinity]) unchanged(() => pay({ amount, payments: [] }), 'invalid');
    unchanged(() => pay({ payments: [{ method: 'invalid', amount: 6600 }] }), 'invalid');
  });
  await check('同じリクエストの再送は1件・別内容/別操作者は拒否', () => {
    const first = pay({ requestKey: 'test-pay' }); assert.deepEqual(pay({ requestKey: 'test-pay', revision: 0, dayRevision: 0 }), first); assert.equal(state.ledger.checkouts.length, 1);
    unchanged(() => pay({ requestKey: 'test-pay', amount: 0, payments: [] }), 'requestChanged');
    unchanged(() => post({ action: 'checkout', bookingId: 'test-booking', amount: 6600, payments: [{ method: 'cash', amount: 6600 }], requestKey: 'test-pay' }, staff), 'requestChanged');
  });
  await check('古い台帳番号では保存しない', () => { pay(); unchanged(() => product({ revision: 0 }), 'ledgerChanged'); });
  await check('取消予約を精算しない', () => { ev(date).bookings[0].status = 'cancelled'; unchanged(() => pay(), 'bookingChanged'); });
  await check('会計取消に理由必須・記録保持・再精算可', () => {
    pay(); unchanged(() => post({ action: 'checkoutVoid', bookingId: 'test-booking' }), 'invalid');
    post({ action: 'checkoutVoid', bookingId: 'test-booking', reason: 'テスト取消' }); assert.equal(state.ledger.checkouts[0].status, 'void'); assert(!ev(date).bookings[0].paid_at);
    unchanged(() => post({ action: 'checkoutVoid', bookingId: 'test-booking', reason: '再度' }), 'notPaid'); pay(); assert.equal(state.ledger.checkouts.length, 2);
  });
  await check('回数券の使用・残数は精算/取消で変化しない', () => {
    ev(date).bookings[0].ticket_id = 'test-ticket'; state.tickets.set('test-ticket', { id: 'test-ticket', plan_name: 'テスト回数券', uses_left: 4 });
    const before = encode(state.tickets); pay({ amount: 0, payments: [] }); assert.equal(get('checkout').bookings[0].ticket.uses, 1);
    post({ action: 'checkoutVoid', bookingId: 'test-booking', reason: 'テスト修正' }); assert.equal(encode(state.tickets), before);
  });
  await check('従来会計入口も内訳保存・二重精算禁止・更新番号必須', () => {
    postSchedule({ action: 'checkout', date, revision: 0, reference: 'TEST-LEDGER', amount: '6600' }, staff);
    assert.equal(state.ledger.checkouts.length, 1); assert.equal(state.ledger.checkouts[0].payments[0].method, 'other');
    unchanged(() => postSchedule({ action: 'checkout', date, revision: 1, reference: 'TEST-LEDGER', amount: 6600 }, staff), 'alreadyPaid');
  });
  await check('物販単価は商品マスタから計算し過去売上を変えない', () => {
    const id = product(); post({ action: 'retailSale', name: 'テスト購入', items: [{ productId: id, quantity: 2, unitPrice: 1 }], payments: [{ method: 'cash', amount: 2000 }] }, staff);
    product({ id, price: 1500 }); assert.equal(get('retail').sales[0].items[0].unitPrice, 1000); assert.equal(get('retail').sales[0].amount, 2000);
  });
  await check('物販の同一送信は1件・取消履歴を保持', () => {
    const id = product(), body = { action: 'retailSale', requestKey: 'test-sale', items: [{ productId: id, quantity: 1 }], payments: [{ method: 'cash', amount: 1000 }] };
    const first = post(body); assert.deepEqual(post(body), first); assert.equal(state.ledger.sales.length, 1);
    post({ action: 'retailVoid', id: first.id, reason: 'テスト返品記録' }); assert.equal(get('retail').sales[0].status, 'void');
    unchanged(() => post({ action: 'retailVoid', id: first.id, reason: '再度' }), 'alreadyVoided');
  });
  await check('販売停止/未登録商品・二重品目・不正数量は販売しない', () => {
    const id = product(); const sale = items => post({ action: 'retailSale', items, payments: [] });
    for (const quantity of [0, -1, 1.5, 10001]) unchanged(() => sale([{ productId: id, quantity }]), 'invalid');
    unchanged(() => sale([{ productId: id, quantity: 1 }, { productId: id, quantity: 1 }]), 'invalid');
    post({ action: 'productDelete', id }); unchanged(() => sale([{ productId: id, quantity: 1 }]), 'invalid');
  });
  await check('返客記録の作成編集取消・期間検索', () => {
    const id = post({ action: 'returnSave', name: 'テスト返客', reason: '満席', time: 720, staffId: 'A', waitStatus: '待ち' }, staff).id;
    post({ action: 'returnSave', id, name: 'テスト返客', reason: '時間が合わない', time: 780 });
    assert.equal(get('returns', { from: date, to: next }).returns[0].time, 780);
    post({ action: 'returnDelete', id }); assert.equal(get('returns').returns[0].status, 'void');
    unchanged(() => post({ action: 'returnSave', id, name: 'テスト', reason: '復活' }), 'recordChanged');
  });
  await check('返客不正日時・担当と過大検索期間を拒否', () => {
    unchanged(() => post({ action: 'returnSave', name: 'テスト', reason: '理由', staffId: 'missing' }), 'invalid');
    unchanged(() => post({ action: 'returnSave', name: 'テスト', reason: '理由', time: 1621 }), 'invalid');
    unchanged(() => get('returns', { from: '2026-11-31' }), 'invalid');
  });
  await check('勤務パターンを保存編集削除', () => {
    const id = pattern(); pattern({ id, name: 'テスト変更' }); assert.equal(get('patterns').patterns[0].name, 'テスト変更'); post({ action: 'patternDelete', id }); assert.equal(get('patterns').patterns.length, 0);
  });
  await check('不正な勤務パターンと休憩重複を拒否', () => {
    unchanged(() => pattern({ start: 1320, end: 600 }), 'invalid'); unchanged(() => pattern({ end: 1920 }), 'invalid');
    unchanged(() => pattern({ blocks: [{ start: 500, end: 700, kind: 'break' }] }), 'invalid');
    unchanged(() => pattern({ blocks: [{ start: 840, end: 900, kind: 'break' }, { start: 850, end: 910, kind: 'work' }] }), 'scheduleConflict');
  });
  await check('パターンを複数日へ一括適用・再適用しても枠を増やさない', () => {
    const id = pattern(); post({ action: 'patternApply', id, cells: [{ date: next, staffId: 'A', revision: 0 }, { date: after, staffId: 'B', revision: 0 }] }, staff);
    assert.equal(ev(next).blocks.length, 1); assert.equal(ev(after).blocks.length, 1);
    post({ action: 'patternApply', id, cells: [{ date: next, staffId: 'A', revision: 1 }] }); assert.equal(ev(next).blocks.length, 1);
  });
  await check('複数日途中の競合では先の日も含め原状保持', () => {
    const id = pattern(); state.days.get(after).version = 1;
    unchanged(() => post({ action: 'patternApply', id, cells: [{ date: next, staffId: 'A', revision: 0 }, { date: after, staffId: 'B', revision: 0 }] }), 'scheduleConflict');
  });
  await check('写真紹介不足も勤務パターンを使え、未登録担当・重複セルは禁止', () => {
    const id = pattern(); state.photos.delete('B');
    post({ action: 'patternApply', id, cells: [{ date: next, staffId: 'A', revision: 0 }, { date: after, staffId: 'B', revision: 0 }] });
    assert.equal(ev(next).blocks.length,1);assert.equal(ev(after).blocks.length,1);
    unchanged(() => post({ action: 'patternApply', id, cells: [{ date: next, staffId: 'missing', revision: state.days.get(next).version }] }), 'invalid');
    unchanged(() => post({ action: 'patternApply', id, cells: [{ date: next, staffId: 'A', revision: state.days.get(next).version }, { date: next, staffId: 'A', revision: state.days.get(next).version }] }), 'invalid');
  });
  await check('置換で予約を勤務外に出さない・既存予約を変更しない', () => {
    const id = pattern({ start: 840, end: 1320 }); unchanged(() => post({ action: 'patternApply', id, mode: 'replace', cells: [{ date, staffId: 'A', revision: 0 }] }), 'outsideShift');
    const p = pattern({ start: 600, end: 1200 }); const before = encode(ev(date).bookings);
    post({ action: 'patternApply', id: p, mode: 'replace', cells: [{ date, staffId: 'A', revision: 0 }] }); assert.equal(encode(ev(date).bookings), before);
  });
  await check('休憩が予約と重なるパターンは保存せず予約を保持', () => {
    const id = pattern({ blocks: [{ start: 720, end: 780, kind: 'break' }] }); unchanged(() => post({ action: 'patternApply', id, cells: [{ date, staffId: 'A', revision: 0 }] }), 'scheduleConflict');
  });
  await check('隣接営業日の予約と24時以降の休憩を重ねない', () => {
    const id = pattern({ start: 600, end: 1500, blocks: [{ start: 1440, end: 1470, kind: 'break' }] });
    ev(next).blocks.push({ id: 'test-next', staff_id: 'A', date: next, start_at: c.minToMs(next, 0), end_at: c.minToMs(next, 30), kind: 'work' });
    unchanged(() => post({ action: 'patternApply', id, mode: 'replace', cells: [{ date, staffId: 'A', revision: 0 }] }), 'scheduleConflict');
  });
  await check('ひな型はシフト業務だけ保存し、顧客や予約を複製しない', () => {
    ev(date).blocks.push({ id: 'test-block', staff_id: 'B', date, start_at: c.minToMs(date, 840), end_at: c.minToMs(date, 900), kind: 'work', note: 'テスト業務' });
    const id = template(); assert(!encode(get('templates').templates).includes('テスト予約'));
    post({ action: 'templateApply', id, targetDates: [{ date: next, revision: 0 }] }); assert.equal(ev(next).bookings.length, 0); assert.equal(ev(next).blocks.length, 1);
    assert.equal(ev(date).bookings.length, 1); assert.equal(state.shifts.get(next).length, 2);
  });
  await check('古い元日付番号ではひな型を保存しない・削除後適用不可', () => {
    unchanged(() => post({ action: 'templateSave', name: 'テスト', sourceDate: date, sourceRevision: 5 }), 'scheduleConflict');
    const id = template(); post({ action: 'templateDelete', id }); unchanged(() => post({ action: 'templateApply', id, targetDates: [{ date: next, revision: 0 }] }), 'notFound');
  });
  await check('業務適用後は予約受付から対象時間を除外', () => {
    const id = pattern(); assert(freeStaffIds(next, 840, 900, course, 'none').includes('A'));
    post({ action: 'patternApply', id, cells: [{ date: next, staffId: 'A', revision: 0 }] }); assert(!freeStaffIds(next, 840, 900, course, 'none').includes('A'));
  });
  await check('データ不備は未登録/重複/対応外/勤務外/写真不足を報告', () => {
    state.photos.delete('A'); state.staff[0].courses = '["other"]'; state.shifts.get(date).push({ ...state.shifts.get(date)[0] });
    ev(date).blocks.push({ id: 'test-invalid', staff_id: 'missing', date, start_at: c.minToMs(date, 700), end_at: c.minToMs(date, 800), kind: 'work' });
    const codes = new Set(get('integrity').issues.map(x => x.code)); for (const code of ['staffInfoMissing', 'staffSkillMismatch', 'duplicateShift', 'missingStaff', 'outsideShift']) assert(codes.has(code));
  });
  await check('オンライン状況は既存受付設定と勤務をそのまま表示', () => {
    state.days.get(date).enabled = false; state.days.get(date).locked = ['A']; const row = get('online'); assert.equal(row.enabled, false); assert(row.staff.find(s => s.id === 'A').locked); assert.equal(row.staff[0].start, 600);
  });
  await check('全台帳データと再送防止キーを保存形式で復元できる', () => {
    pay({ requestKey: 'test-persist' }); product(); pattern(); template();
    const restored = JSON.parse(encode({ ledger: state.ledger }), revive).ledger; assert(restored.requestKeys instanceof Map); assert.equal(encode(restored), encode(state.ledger));
    state.ledger = restored; assert.equal(pay({ requestKey: 'test-persist', dayRevision: 0 }).ok, true); assert.equal(state.ledger.checkouts.length, 1);
  });
  await check('予約変更前の会計画面は保存せず再確認が必要', () => {
    const old = get('checkout').bookings[0].bookingFingerprint;
    state.days.get(date).version++; unchanged(() => pay({ dayRevision: 0 }), 'scheduleConflict');
    ev(date).bookings[0].total = 5500; unchanged(() => pay({ bookingFingerprint: old }), 'bookingChanged');
    unchanged(() => pay(), 'paymentExceedsTotal');
  });
  await check('新APIは再送防止キーが必須', () => {
    unchanged(() => product({ requestKey: '' }), 'invalid'); unchanged(() => product({ requestKey: ' '.repeat(5) }), 'invalid');
  });
  await check('会計後に予約取消や別日移動をしても受領日を動かさない', () => {
    pay(); const b = ev(date).bookings[0]; b.status = 'cancelled'; assert.equal(ops.summary(state, date).servicePaid, 6600);
    ev(date).bookings = []; ev(next).bookings = [b]; b.date = next; state.bookingIndex.set(b.id, next);
    assert.equal(ops.summary(state, date).sales, 6600); assert.equal(ops.summary(state, next).sales, 0);
    post({ action: 'checkoutVoid', date: next, bookingId: b.id, reason: 'テスト返金記録' }); assert.equal(ops.summary(state, date).sales, 0);
  });
  await check('精算/物販/取消の集計と日報を同じ金額にする', () => {
    pay(); const id = product(); const sale = post({ action: 'retailSale', items: [{ productId: id, quantity: 2 }], payments: [{ method: 'qr', amount: 2000 }] });
    assert.deepEqual(ops.summary(state, date).payments, { cash: 6600, qr: 2000 }); assert.equal(ops.summary(state, date).sales, 8600);
    const report = mod.exports.audit.reportStats(date); assert.equal(report.today.salesGross, 8600); assert.equal(report.today.salesNet, null); assert.equal(report.today.profit, null);
    post({ action: 'retailVoid', id: sale.id, reason: 'テスト取消' }); assert.equal(ops.summary(state, date).sales, 6600);
  });
  await check('受付停止とスタッフ受付停止は古い更新番号で変えない', () => {
    postSchedule({ action: 'toggle', date, revision: 0, enabled: false }, staff);
    unchanged(() => postSchedule({ action: 'lockStaff', date, revision: 0, staffId: 'A', locked: true }, staff), 'scheduleConflict');
    postSchedule({ action: 'lockStaff', date, revision: 1, staffId: 'A', locked: true }, staff);
    assert.deepEqual(state.days.get(date).locked, ['A']); assert.equal(state.days.get(date).enabled, false);
  });
  await check('ひな型/パターン取消と適用履歴を保存する', () => {
    const id = pattern(); post({ action: 'patternApply', id, cells: [{ date: next, staffId: 'A', revision: 0 }] });
    post({ action: 'patternDelete', id }); const result = get('patterns'); assert.equal(result.patterns.length, 0); assert.equal(result.archived.length, 1); assert.equal(result.applications.length, 1);
  });
  await check('予約一覧の期間検索と取消状態・顧客性別の誤表示を防ぐ', () => {
    const b = ev(date).bookings[0]; b.source = 'web'; b.staff_pref = 'female'; b.customer_gender = 'f'; b.status = 'cancelled';
    assert.equal(get('bookings', { from: date, to: next, status: 'cancelled', q: 'テスト予約' }).bookings.length, 1);
    assert.equal(get('bookings').bookings[0].gender, 'none'); assert.equal(get('bookings', { status: 'confirmed' }).bookings.length, 0);
  });
  await check('旧版の有料/0円精算を一度だけ引き継ぎ予約本体は不変', () => {
    const b = ev(date).bookings[0]; b.paid_at = Date.now(); b.paid_amount = 0; const before = encode(b);
    ops.migrate(state); ops.migrate(state); assert.equal(state.ledger.checkouts.length, 1); assert.equal(encode(b), before); assert.equal(state.ledger.checkouts[0].amount, 0);
  });
  await check('表示名を台帳/返客選択/予約一覧/日報で一致させる', () => {
    state.staff[0].profile = JSON.stringify({ message: 'テスト紹介', nickname: 'テスト表示名' });
    assert.equal(get('returns').staff[0].name, 'テスト表示名'); assert.equal(get('returns').staff[0].registeredName, 'テスト担当A');
    assert.equal(get('bookings').bookings[0].staffName, 'テスト表示名'); assert(mod.exports.audit.reportStats(date).staffNames.includes('テスト表示名'));
  });
  await check('日次目標未設定と0円を区別し日報と同じ保存先を使う', () => {
    assert.equal(get('goals').goal.amount, null);
    post({ action: 'goalSave', amount: 0, note: 'テスト目標', todayPlan: 'テスト実施', review: 'テスト振り返り' });
    assert.equal(get('goals').goal.amount, 0); assert.equal(state.reports.get(date).todayPlan, 'テスト実施');
    const report = mod.exports.audit.reportStats(date); assert.equal(report.today.goal, 0); assert.equal(report.today.achievement, null); assert.equal(report.revision, 1);
  });
  await check('日次目標は権限・金額・日次番号を検証', () => {
    unchanged(() => post({ action: 'goalSave', amount: 10000 }, staff), 'forbidden');
    unchanged(() => post({ action: 'goalSave', amount: -1 }), 'invalid');
    post({ action: 'goalSave', amount: 10000 }); unchanged(() => post({ action: 'goalSave', amount: 20000, dayRevision: 0 }), 'scheduleConflict');
  });
  await check('時間帯オンライン停止は対象スタッフだけ、手入力と既存予約は維持', () => {
    const before = encode(ev(date)); post({ action: 'onlineBlockSave', staffIds: ['A'], start: 900, end: 960, note: 'テスト受付停止' }, staff);
    assert.equal(encode(ev(date)), before); assert.equal(get('online').onlineBlocks.length, 1);
    assert(freeStaffIds(date, 900, 960, course, 'none').includes('A')); assert(!freeStaffIds(date, 900, 960, course, 'none', undefined, true).includes('A'));
    assert(freeStaffIds(date, 900, 960, course, 'none', undefined, true).includes('B'));
  });
  await check('オンライン停止の未登録担当・勤務外・重複・古い番号を拒否', () => {
    unchanged(() => post({ action: 'onlineBlockSave', staffIds: ['missing'], start: 900, end: 960 }), 'invalid');
    unchanged(() => post({ action: 'onlineBlockSave', staffIds: ['A'], start: 500, end: 600 }), 'outsideShift');
    unchanged(() => post({ action: 'onlineBlockSave', staffIds: ['A', 'A'], start: 900, end: 960 }), 'invalid');
    post({ action: 'onlineBlockSave', staffIds: ['A'], start: 900, end: 960 });
    unchanged(() => post({ action: 'onlineBlockSave', staffIds: ['A', 'B'], start: 930, end: 990 }), 'scheduleConflict');
    unchanged(() => post({ action: 'onlineBlockDelete', id: get('online').onlineBlocks[0].id, dayRevision: 0 }), 'scheduleConflict');
  });
  await check('オンライン停止の編集削除は公開空きへ即時反映', () => {
    const id = post({ action: 'onlineBlockSave', staffIds: ['A'], start: 900, end: 960 }).id;
    post({ action: 'onlineBlockSave', id, staffIds: ['B'], start: 1020, end: 1080 });
    assert(freeStaffIds(date, 900, 960, course, 'none', undefined, true).includes('A'));
    assert(!freeStaffIds(date, 1020, 1080, course, 'none', undefined, true).includes('B'));
    post({ action: 'onlineBlockDelete', id }); assert(freeStaffIds(date, 1020, 1080, course, 'none', undefined, true).includes('B'));
  });
  await check('シフトひな型はオンライン停止時間もコピーし予約を複製しない', () => {
    post({ action: 'onlineBlockSave', staffIds: ['A', 'B'], start: 900, end: 960 }); const id = template();
    assert.equal(get('templates').templates[0].onlineBlocks.length, 1);
    post({ action: 'templateApply', id, targetDates: [{ date: next, revision: 0 }] });
    assert.equal(ev(next).bookings.length, 0); assert.equal(freeStaffIds(next, 900, 960, course, 'none', undefined, true).length, 0);
  });
  await check('パターン変更で受付停止時間を勤務外に取り残さない', () => {
    post({ action: 'onlineBlockSave', date: next, staffIds: ['A'], start: 1200, end: 1260 });
    const id = pattern({ start: 600, end: 1140 }); unchanged(() => post({ action: 'patternApply', id, mode: 'replace', cells: [{ date: next, staffId: 'A', revision: 1 }] }), 'outsideShift');
  });
  await check('通常シフトの短縮/削除もオンライン停止枠を勤務外に残さない', () => {
    post({action:'onlineBlockSave',date:next,staffIds:['A'],start:1200,end:1260});
    unchanged(()=>postSchedule({action:'shift',date:next,staffId:'A',start:600,end:1140,revision:1},staff),'scheduleConflict');
    unchanged(()=>postSchedule({action:'shift',date:next,staffId:'A',remove:true,revision:1},staff),'shiftRelatedConfirmationRequired');
    unchanged(()=>postSchedule({action:'bulkShift',date:next,start:600,end:1140,cells:[{date:next,staffId:'A',revision:1},{date:after,staffId:'B',revision:0}]},staff),'scheduleConflict');
  });
  await check('一括勤務削除は対象のオンライン停止だけ除き他担当分を保持', () => {
    post({action:'onlineBlockSave',date:next,staffIds:['A','B'],start:1200,end:1260});const version=state.ledger.version;
    postSchedule({action:'bulkShift',date:next,remove:true,cells:[{date:next,staffId:'A',revision:1}]},staff);
    assert.deepEqual(state.ledger.onlineBlocks[0].staffIds,['B']);assert.equal(state.ledger.version,version+1);
    assert(!state.shifts.get(next).some(s=>s.staff_id==='A'));assert(state.shifts.get(next).some(s=>s.staff_id==='B'));
  });
  const report = { ok: results.every(x => x.ok), checks: results.length, passed: results.filter(x => x.ok).length, failures: results.filter(x => !x.ok), results, externalMail: false, persistentWrites: false };
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, results: undefined })); process.exit(report.ok ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
