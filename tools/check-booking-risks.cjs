'use strict';
// 本番から送信設定・顧客情報を取り除いた独立コピー専用。保存・通信せず、架空予約だけをメモリ内で検査。
// node tools/check-booking-risks.cjs <検証用コードのフォルダ> [結果.json]
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict');
assert(process.argv[2], '送信を無効にした検証コピーを指定してください');
const root = path.resolve(process.argv[2]);
assert(!fs.existsSync(path.join(root, 'mail-config.json')));
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(k)) delete process.env[k];
const revive = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
const source = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json'), 'utf8'), revive);
assert(!source.state.mailRelay?.url && !source.state.mailRelay?.secret && source.state.mails.length === 0);
const persist = require(path.join(root, 'persist.js'));
persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: source }); persist.startSaver = () => {};
const file = path.join(root, 'demo-api.js'), mod = new Module(file);
mod.filename = file; mod.paths = Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,courseStore,createPublicBooking,cancelBooking,postSchedule,getAvailability,findBooking,publicStaffList,todayJst,addDays,minToMs,profileOf,hpNotify};', file);
const encode = v => JSON.stringify(v, (_, x) => x instanceof Map ? { __pm_map__: [...x] } : x instanceof Set ? { __pm_set__: [...x] } : x);

(async () => {
  await mod.exports.ready;
  const a = mod.exports.audit, state = a.state, course = '364323-4822701';
  const date = a.addDays(a.todayJst(), 1), next = a.addDays(date, 1), manager = { user: 'test-admin', role: 'admin' };
  const capableIds = new Set(a.publicStaffList().filter(s => s.courses.includes(course)).map(s => s.id));
  const originalStaff = state.staff.filter(s => capableIds.has(s.id)).slice(0, 3);
  assert.equal(originalStaff.length, 3, '本番コピーに検証対象の担当者が足りません');
  const photos = new Map(originalStaff.map(s => [s.id, state.photos.get(s.id)]));
  const [A, B, C] = originalStaff.map(s => s.id);
  const results = [], realNow = Date.now;
  let seq = 0;
  function reset() {
    Date.now = realNow;
    state.staff = originalStaff.map((s, i) => ({ ...s, name: 'テスト担当' + i, active: 1, courses: JSON.stringify([course]),
      profile: JSON.stringify({ ...a.profileOf(s), nickname: 'テスト表示' + i, personalNomination: true, nominationFee: 500, message: 'テスト紹介文' }) }));
    state.photos = new Map(photos); state.mailRelay = { url: '', secret: '' }; state.mails = [];
    state.events = new Map(); state.days = new Map(); state.shifts = new Map();
    state.bookingIndex = new Map(); state.requestKeys = new Map(); state.tickets = new Map();
    state.ticketUseByBooking = new Map(); state.members = new Map();
    state.hpKeys = new Map(); state.hpLog = [];
    state.settings.freeMessage = { visible: true, required: false, maxLength: 2000 };
    state.settings.shopMaster.resStart = 600; state.settings.shopMaster.resEnd = 1560;
    for (const d of [date, next]) {
      state.days.set(d, { version: 0, enabled: true });
      state.events.set(d, { bookings: [], blocks: [], assignments: [] });
      state.shifts.set(d, state.staff.map(s => ({ staff_id: s.id, date: d, start_at: a.minToMs(d, 600), end_at: a.minToMs(d, 1620), note: '' })));
    }
  }
  const member = (email = 'test-a@example.test') => ({ email, name: 'テスト会員', phone: '0000000000', bookings: [], tickets: [] });
  const body = (extra = {}) => ({ requestKey: 'test-risk-' + (++seq), course, date, start: a.minToMs(date, 720), people: 1,
    staff: 'none', staffId: A, expectedNominationFee: 500, name: 'テスト予約', email: 'test-a@example.test', phone: '0000000000', consent: true, ...extra });
  const booking = r => a.findBooking(r.id).bk;
  const records = () => encode({ events: state.events, bookingIndex: state.bookingIndex, tickets: state.tickets,
    ticketUseByBooking: state.ticketUseByBooking, mails: state.mails, members: state.members });
  const reject = (fn, expected) => assert.throws(fn, e => expected ? e.message === expected : e.status >= 400 && e.status < 500);
  const rejectUnchanged = (fn, expected) => { const before = records(); reject(fn, expected); assert.equal(records(), before, '失敗時に予約・回数券・メールが変化'); };
  const rev = d => state.days.get(d)?.version || 0;
  const move = (bk, extra) => a.postSchedule({ action: 'moveBooking', date: bk.service_date, revision: rev(bk.service_date), id: bk.id,
    staffId: B, start: 900, end: 960, confirmNominationMove: true, ...extra }, manager);
  const ticket = (uses = 1, extra = {}) => {
    const t = { id: 'test-ticket', token: 'test-ticket-token', plan_id: 'tp-5', plan_name: 'テスト回数券',
      buyer_name: 'テスト会員', buyer_email: 'test-a@example.test', member_email: 'test-a@example.test',
      uses_total: uses, uses_left: uses, menu_scope: 'all', valid_months: 12, history: [],
      purchased_at: new Date().toISOString(), expires_at: realNow() + 365 * 864e5, ...extra };
    state.tickets.set(t.id, t); return t;
  };
  async function check(name, fn) {
    reset();
    try { await fn(); assert(state.mails.every(m => !m.real)); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e.message.split('\n').slice(0, 3).join(' ') }); }
    finally { Date.now = realNow; }
  }

  await check('同じキー・同じ内容の再送は予約とメールを増やさない', () => {
    const b = body(), r = a.createPublicBooking(b), before = records();
    assert.deepEqual(a.createPublicBooking(b), r); assert.equal(records(), before);
  });
  await check('同じ入力の項目順序が変わっても同じ予約として再送できる', () => {
    const b = body(), r = a.createPublicBooking(b), before = records();
    assert.deepEqual(a.createPublicBooking(Object.fromEntries(Object.entries(b).reverse())), r); assert.equal(records(), before);
  });
  await check('照合情報がない旧形式の再送キーでは予約トークンを返さない', () => {
    const b = body(), r = a.createPublicBooking(b); state.requestKeys.set(b.requestKey, r);
    rejectUnchanged(() => a.createPublicBooking(b));
  });
  await check('同じキー・別の予約内容は拒否', () => {
    const b = body(); a.createPublicBooking(b);
    rejectUnchanged(() => a.createPublicBooking({ ...b, start: a.minToMs(date, 900) }));
  });
  await check('同じキー・別メールは以前の予約トークンを返さない', () => {
    const b = body(); a.createPublicBooking(b);
    rejectUnchanged(() => a.createPublicBooking({ ...b, email: 'test-b@example.test' }));
  });
  await check('同じキー・別会員は以前の予約トークンを返さない', () => {
    const b = body(); a.createPublicBooking(b, member());
    rejectUnchanged(() => a.createPublicBooking(b, member('test-b@example.test')));
  });
  await check('同じ担当・時刻を別キーで再予約しても重複しない', () => {
    a.createPublicBooking(body()); rejectUnchanged(() => a.createPublicBooking(body()), 'soldOut');
  });
  await check('3名予約では異なる担当3人を確保し、埋まった枠を断る', () => {
    const r = a.createPublicBooking(body({ people: 3, staffId: '' }));
    const assigned = state.events.get(date).assignments.filter(x => x.booking_id === r.id).map(x => x.staff_id);
    assert.equal(new Set(assigned).size, 3); rejectUnchanged(() => a.createPublicBooking(body()), 'soldOut');
  });
  await check('予約サイトの人数に小数を認めない', () => rejectUnchanged(() => a.createPublicBooking(body({ people: 1.5 })), 'invalid'));
  await check('管理画面の人数に負数を認めない', () => rejectUnchanged(() => a.postSchedule({ action: 'createBooking', date, revision: rev(date),
    staffId: A, start: 720, course, people: -1, consent: true, name: 'テスト店頭予約' }, manager), 'invalid'));
  await check('空き確認の人数に小数を認めない', () => reject(() => a.getAvailability(new URLSearchParams({ course, date, people: '1.5' })), 'invalid'));
  await check('存在しない営業日は空き確認しない', () => reject(() => a.getAvailability(new URLSearchParams({ course, date: '2026-11-31', people: '1' })), 'invalid'));
  await check('個人指名を止めた担当に指名可能な空きを出さない', () => {
    const s = state.staff[0]; s.profile = JSON.stringify({ ...a.profileOf(s), personalNomination: false });
    const r = a.getAvailability(new URLSearchParams({ course, date, people: '1', staffId: A }));
    assert(r.days.every(d => d.slots.every(s => !s.available)));
    rejectUnchanged(() => a.createPublicBooking(body()), 'staffUnavailable');
  });
  await check('確認後にスキルを外した担当へは確定しない', () => {
    state.staff[0].courses = JSON.stringify(['364323-4822664']);
    rejectUnchanged(() => a.createPublicBooking(body()), 'staffUnavailable');
  });
  await check('移動先が埋まっている場合は元予約とメールを保持', () => {
    const r = a.createPublicBooking(body()); a.createPublicBooking(body({ staffId: B, start: a.minToMs(date, 900) }));
    rejectUnchanged(() => move(booking(r), {}), 'soldOut');
  });
  await check('指名予約の移動は確認なしで保存しない', () => {
    const r = a.createPublicBooking(body()); rejectUnchanged(() => move(booking(r), { confirmNominationMove: false }), 'nominatedConfirmationRequired');
  });
  await check('確認後にスキルを外した移動先へは保存しない', () => {
    const r = a.createPublicBooking(body()); state.staff[1].courses = JSON.stringify(['364323-4822664']);
    rejectUnchanged(() => move(booking(r), { allowCourseMismatch: true }), 'staffCannotDoCourse');
  });
  await check('指名なしはチェックのある別担当・別時間へ移動できる', () => {
    const r = a.createPublicBooking(body({ staffId: '' })), bk = booking(r);
    move(bk, { confirmNominationMove: false });
    assert.equal(bk.start_at, a.minToMs(date, 900)); assert.equal(bk.nominated_staff_id, null);
    assert.deepEqual(state.events.get(date).assignments.filter(x => x.booking_id === r.id).map(x => x.staff_id), [B]);
  });
  await check('複数名の予約を既存の別担当へ動かしても担当IDを重複させない', () => {
    const r = a.createPublicBooking(body({ staffId: '', people: 3 })), bk = booking(r);
    move(bk, { staffId: C, expect: { staffId: A, start: 720 }, confirmNominationMove: false });
    const ids = state.events.get(date).assignments.filter(x => x.booking_id === r.id).map(x => x.staff_id);
    assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3);
  });
  await check('残り1回の券・再送・別予約で二重消費しない', () => {
    const t = ticket(), b = body({ ticketId: t.id, ticketToken: t.token }), r = a.createPublicBooking(b);
    assert.equal(t.uses_left, 0); assert.deepEqual(a.createPublicBooking(b), r);
    rejectUnchanged(() => a.createPublicBooking(body({ start: a.minToMs(date, 900), ticketId: t.id, ticketToken: t.token })), 'ticketEmpty');
    assert.equal(t.history.filter(h => h.type === 'use').length, 1);
  });
  await check('最後の1回で取った予約も重なる時間へ変更でき、券は増減しない', () => {
    const t = ticket(), m = member(), r = a.createPublicBooking(body({ ticketId: t.id, ticketToken: t.token }), m);
    const b = body({ rescheduleId: r.id, start: a.minToMs(date, 750), ticketId: t.id, ticketToken: t.token });
    const nr = a.createPublicBooking(b, m); assert.equal(booking(r).status, 'cancelled'); assert.equal(booking(nr).status, 'confirmed');
    assert.equal(t.uses_left, 0); assert.equal(state.ticketUseByBooking.size, 1);
    const before = records(); assert.deepEqual(a.createPublicBooking(b, m), nr); assert.equal(records(), before);
  });
  await check('変更先が埋まっていたら元の回数券予約を保持', () => {
    const t = ticket(), m = member(), r = a.createPublicBooking(body({ ticketId: t.id, ticketToken: t.token }), m);
    a.createPublicBooking(body({ start: a.minToMs(date, 900) }));
    rejectUnchanged(() => a.createPublicBooking(body({ rescheduleId: r.id, start: a.minToMs(date, 900), ticketId: t.id, ticketToken: t.token }), m), 'soldOut');
    assert.equal(booking(r).status, 'confirmed'); assert.equal(t.uses_left, 0);
  });
  await check('処理中に元予約の開始時刻を越えても日時変更を二重成立させない', () => {
    const m = member(), r = a.createPublicBooking(body(), m), old = booking(r);
    let tick = old.start_at - 1;
    Date.now = () => tick++;
    const before = records();
    try {
      const nr = a.createPublicBooking(body({ date: next, start: a.minToMs(next, 720), rescheduleId: r.id }), m);
      assert.equal(old.status, 'cancelled'); assert.equal(booking(nr).status, 'confirmed');
    } catch (e) { assert.equal(records(), before, '開始時刻の境界で失敗したのに新しい予約・メールが残る'); }
  });
  await check('処理中に券の期限を越えた日時変更も、失敗なら返却を含め全て原状保持', () => {
    for (let gap = 0; gap < 30; gap++) {
      reset(); const t = ticket(), m = member(), r = a.createPublicBooking(body({ ticketId: t.id, ticketToken: t.token }), m);
      t.expires_at = realNow() + 1000;
      let tick = t.expires_at - gap;
      Date.now = () => tick++;
      const before = records();
      try {
        const nr = a.createPublicBooking(body({ date: next, start: a.minToMs(next, 720), rescheduleId: r.id, ticketId: t.id, ticketToken: t.token }), m);
        assert.equal(booking(r).status, 'cancelled'); assert.equal(booking(nr).status, 'confirmed'); assert.equal(t.uses_left, 0);
      } catch (e) { assert.equal(records(), before, '有効期限境界で失敗したのに券の返却・メールが残る（残り ' + gap + ' ms）'); }
    }
  });
  await check('対象メニュー外の券では予約を作らず、残数も保持', () => {
    const t = ticket(1, { menu_scope: ['364323-4822664'] });
    rejectUnchanged(() => a.createPublicBooking(body({ ticketId: t.id, ticketToken: t.token })), 'ticketMenu');
  });
  await check('他人の券のトークンでは予約を作らず、残数も保持', () => {
    const t = ticket();
    rejectUnchanged(() => a.createPublicBooking(body({ ticketId: t.id, ticketToken: 'test-wrong-token' })), 'ticketInvalid');
    assert.equal(t.uses_left, 1);
  });
  await check('取消の再送で回数券を二度戻さない', () => {
    const t = ticket(), r = a.createPublicBooking(body({ ticketId: t.id, ticketToken: t.token }));
    a.cancelBooking(booking(r), date); assert.equal(t.uses_left, 1);
    rejectUnchanged(() => a.cancelBooking(booking(r), date), 'alreadyCancelled');
    assert.equal(t.history.filter(h => h.type === 'refund').length, 1);
  });
  await check('回数券予約の別日・別担当移動で回数券と支払情報を保持', () => {
    const t = ticket(), r = a.createPublicBooking(body({ ticketId: t.id, ticketToken: t.token }));
    const before = encode(t), bk = booking(r), fee = bk.nomination_fee;
    move(bk, { toDate: next, toRevision: rev(next) });
    assert.equal(encode(t), before); assert.equal(bk.service_date, next); assert.equal(bk.nomination_fee, fee);
    assert.equal(bk.base_price, 0); assert.equal(state.ticketUseByBooking.get(r.id), t.id);
    assert.equal(state.events.get(date).assignments.length, 0);
  });
  await check('営業日の24時以降も同じ担当の重複を断る', () => {
    a.createPublicBooking(body({ start: a.minToMs(date, 1410) }));
    rejectUnchanged(() => a.createPublicBooking(body({ start: a.minToMs(date, 1440) })), 'soldOut');
  });
  await check('別営業日の表示でも絶対時刻が重なる担当は重複登録しない', () => {
    a.createPublicBooking(body({ start: a.minToMs(date, 1410) }));
    state.shifts.get(next)[0].start_at = a.minToMs(next, 0);
    rejectUnchanged(() => a.postSchedule({ action: 'createBooking', date: next, revision: rev(next), staffId: A, start: 0,
      course, people: 1, consent: true, name: 'テスト翌日予約' }, manager));
  });
  await check('翌日の0時予約があるときも前営業日の24時予約を断る', () => {
    state.shifts.get(next)[0].start_at = a.minToMs(next, 0);
    a.postSchedule({ action: 'createBooking', date: next, revision: rev(next), staffId: A, start: 0,
      course, people: 1, consent: true, name: 'テスト翌日予約' }, manager);
    rejectUnchanged(() => a.createPublicBooking(body({ start: a.minToMs(date, 1440) })), 'soldOut');
  });
  await check('外部予約の取消で担当を外し、取消や受信の再送で復活・重複させない', () => {
    const b = { reservationId: 'test-risk-hp', date, start: '12:00', minutes: 60, price: 6600,
      name: 'テスト外部予約', menu: '全身整体 60分', staffName: state.staff[0].name };
    const r = a.hpNotify(b, 'check'); assert.equal(r.status, 200);
    assert.equal(a.hpNotify({ reservationId: b.reservationId, action: 'cancel' }, 'check').status, 200);
    assert.equal(booking(r.json).status, 'cancelled');
    assert.equal(state.events.get(date).assignments.filter(x => x.booking_id === r.json.id).length, 0);
    const before = records(); a.hpNotify({ reservationId: b.reservationId, action: 'cancel' }, 'check'); a.hpNotify(b, 'check');
    assert.equal(records(), before);
  });
  assert(!state.mailRelay.url && !state.mailRelay.secret);
  const report = { ok: results.every(r => r.ok), checks: results.length, passed: results.filter(r => r.ok).length,
    failures: results.filter(r => !r.ok), results, externalMail: false, persistentWrites: false };
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, results: undefined }));
  process.exit(report.ok ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
