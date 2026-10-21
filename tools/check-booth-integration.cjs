'use strict';
// 送信無効の本番コピーで実際の予約/API処理をメモリ内検査。HTTPサーバーや外部決済は起動しない。
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
assert(process.argv[2]); const root = path.resolve(process.argv[2]); assert(!fs.existsSync(path.join(root, 'mail-config.json')));
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(k)) delete process.env[k];
const revive = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json'), 'utf8'), revive);
assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && !snapshot.state.mails.length);
const persist = require(path.join(root, 'persist.js')); persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot }); persist.startSaver = () => {};
const file = path.join(root, 'demo-api.js'), mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,courseStore,postSchedule,getSchedule,ledgerContext,createPublicBooking,getAvailability,hpNotify,adminSessions};', file);
const ops = require(path.join(root, 'ledger-operations.js')), policy = require(path.join(root, 'booth-policy.js'));
const encode = v => JSON.stringify(v, (_, x) => x instanceof Map ? { __pm_map__: [...x] } : x instanceof Set ? { __pm_set__: [...x] } : x);
(async () => {
  await mod.exports.ready;
  const a = mod.exports.audit, { state } = a, c = a.ledgerContext(), date = c.addDays(c.todayJst(), 1), next = c.addDays(date, 1), course = '364323-4822701';
  const courses = [...a.courseStore.values()].map(x => ({ ...x })), manager = { user: 'test-manager', role: 'manager', active: true }, staff = { user: 'test-staff', role: 'staff', active: true };
  const results = [], first = '109902', second = '109903';
  function reset() {
    state.events = new Map(); state.days = new Map(); state.shifts = new Map(); state.bookingIndex = new Map(); state.requestKeys = new Map(); state.hpKeys = new Map(); state.hpLog = [];
    state.mails = []; state.mailRelay = { url: '', secret: '' }; state.ledger = ops.createState(); state.reports = new Map();
    state.booths = policy.sourceDefaults().booths.map(b => ({ ...b, active: [first, second].includes(b.id) })); state.boothRevision = 0; state.boothRequestKeys = new Map();
    state.staffReconciliation = { version: 1 }; state.staff = ['A', 'B', 'C'].map(id => ({ id, name: 'テスト担当' + id, active: 1, gender: 'male', courses: '[]', sort_order: id.charCodeAt(0), profile: JSON.stringify({ message: 'テスト紹介', personalNomination: true, nominationFee: 500 }) }));
    state.photos = new Map(state.staff.map(s => [s.id, 'data:image/jpeg;base64,/9j/']));
    state.settings.freeMessage = { visible: true, required: false, maxLength: 2000 }; state.settings.shopMaster.resStart = 600; state.settings.shopMaster.resEnd = 1560;
    a.courseStore.clear(); for (const x of courses) a.courseStore.set(x.id, { ...x }); state.courses = null;
    for (const d of [date, next]) {
      state.days.set(d, { version: 0, enabled: true }); state.events.set(d, { bookings: [], blocks: [], assignments: [] });
      state.shifts.set(d, state.staff.map(s => ({ staff_id: s.id, date: d, start_at: c.minToMs(d, d === next ? 0 : 600), end_at: c.minToMs(d, 1620), note: '' })));
    }
    state.accounts.set(manager.user, manager); state.accounts.set(staff.user, staff);
    a.adminSessions.clear(); a.adminSessions.set('aaaa', { user: manager.user, created: Date.now() }); a.adminSessions.set('bbbb', { user: staff.user, created: Date.now() });
  }
  const ev = (d = date) => state.events.get(d), booking = (id, d = date) => ev(d).bookings.find(x => x.id === id);
  const pub = (extra = {}) => a.createPublicBooking({ requestKey: require('node:crypto').randomUUID(), date, start: c.minToMs(date, 720), course, people: 1, staff: 'none', staffId: 'A', expectedNominationFee: 500, name: 'テスト予約', email: 'booth-test@example.test', phone: '0000000000', consent: true, ...extra });
  const schedule = extra => a.postSchedule({ date, revision: state.days.get(extra.date || date)?.version || 0, ...extra }, manager);
  const unchanged = (fn, code) => { const before = encode({ state, courses: [...a.courseStore] }); assert.throws(fn, e => e.message === code); assert(encode({ state, courses: [...a.courseStore] }) === before, '拒否時に元記録が変化'); };
  const api = (method, route, body, role = 'manager') => {
    const req = new EventEmitter(); Object.assign(req, { method, headers: { cookie: role === 'manager' ? 'pm_session=aaaa' : role === 'staff' ? 'pm_session=bbbb' : '' }, socket: { remoteAddress: '127.0.0.1' }, destroy() {} });
    let status, data; const res = new EventEmitter(); Object.assign(res, { setHeader() {}, writeHead(code) { status = code; }, end(raw) { data = raw ? JSON.parse(raw) : null; this.emit('finish'); } });
    assert(mod.exports.handleDemoApi(req, res, new URL(route, 'http://localhost'))); if (method === 'POST') { req.emit('data', JSON.stringify(body)); req.emit('end'); }
    return { status, data };
  };
  const boothPost = (body, role = 'manager') => api('POST', '/api/demo/booths', { expectedVersion: state.boothRevision, requestKey: require('node:crypto').randomUUID(), ...body }, role);
  const check = async (name, fn) => { reset(); try { await fn(); assert(state.mails.every(m => !m.real)); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: e.message.split('\n').slice(0, 3).join(' ') }); } };

  await check('予約サイトは実室を割り当て、全室使用中の枠を確定させない', () => {
    const x = pub(), y = pub({ staffId: 'B' }); assert.deepEqual(booking(x.id).booth_ids, [first]); assert.deepEqual(booking(y.id).booth_ids, [second]);
    unchanged(() => pub({ staffId: 'C' }), 'soldOut');
    const avail = a.getAvailability(new URLSearchParams({ course, date, people: '1', staff: 'none', staffId: 'C' })); assert.equal(avail.days[0].slots.find(x => x.minute === 720).available, false);
  });
  await check('取消で実室が再受付でき、旧割当履歴を保持', () => {
    const x = pub(); schedule({ action: 'cancel', id: x.id }); const y = pub({ staffId: 'B' });
    assert.deepEqual(booking(y.id).booth_ids, [first]); assert.deepEqual(booking(x.id).booth_ids, [first]); assert.equal(booking(x.id).status, 'cancelled');
  });
  await check('複数名は人数分の別室が必須、失敗時予約や回数券不変', () => {
    unchanged(() => pub({ people: 3, staffId: '' }), 'soldOut'); const p = pub({ people: 2, staffId: '' }); assert.equal(new Set(booking(p.id).booth_ids).size, 2);
  });
  await check('店頭追加も実室制約と人数を守る', () => {
    schedule({ action: 'createBooking', staffId: 'A', start: 720, course, people: 2, consent: true, name: 'テスト店頭' });
    assert.equal(ev().bookings[0].booth_ids.length, 2);
    unchanged(() => schedule({ action: 'createBooking', staffId: 'C', start: 720, course, people: 1, consent: true, name: 'テスト店頭2' }), 'boothSoldOut');
  });
  await check('オンライン不可室は公開予約に使わず店頭のみ明示割当できる', () => {
    state.booths.find(x => x.id === second).online = false; pub(); unchanged(() => pub({ staffId: 'B' }), 'soldOut');
    schedule({ action: 'createBooking', staffId: 'B', start: 720, course, people: 1, consent: true, name: 'テスト店頭', boothIds: [second] }); assert.equal(ev().bookings[1].booth_id, second);
  });
  await check('担当/時間の移動も部屋を再検査し旧室からの履歴を保持', () => {
    const x = pub(); pub({ staffId: 'B', start: c.minToMs(date, 900) });
    schedule({ action: 'moveBooking', id: x.id, staffId: 'A', start: 900, end: 960, confirmNominationMove: true });
    assert.equal(booking(x.id).booth_id, second); assert.equal(booking(x.id).booth_history[0].from.ids[0], first);
  });
  await check('部屋だけの移動は指名確認・元部屋照合を必須にする', () => {
    const p = pub(); unchanged(() => schedule({ action: 'moveBooth', id: p.id, boothIds: [second], expectBoothIds: [first] }), 'nominatedConfirmationRequired');
    unchanged(() => schedule({ action: 'moveBooth', id: p.id, boothIds: [second], expectBoothIds: [], confirmNominationMove: true }), 'bookingChanged');
    const before = { ...booking(p.id) };
    schedule({ action: 'moveBooth', id: p.id, boothIds: [second], expectBoothIds: [first], confirmNominationMove: true });
    assert.equal(booking(p.id).start_at, before.start_at); assert.equal(booking(p.id).nominated_staff_id, before.nominated_staff_id); assert.equal(booking(p.id).booth_id, second);
  });
  await check('旧HP/仮ブースの重複時は自動推測せず受付を停止', () => {
    const p = pub(); const b = booking(p.id); delete b.booth_ids; delete b.booth_id; b.booth = 'HP';
    unchanged(() => pub({ staffId: 'B' }), 'soldOut');
    schedule({ action: 'moveBooth', id: p.id, boothIds: [first], expectBoothIds: [], confirmNominationMove: true });
    assert.equal(b.booth_history[0].from.label, 'HP'); assert.equal(b.booth_id, first);
  });
  await check('HP取込も空室を確認し同じ通知で二重作成しない', () => {
    const body = { reservationId: 'TEST-HP-ROOM', date, start: '12:00', minutes: 60, price: 6600, name: 'テストHP', menu: a.courseStore.get(course).name, staffName: 'テスト担当A' };
    const r = a.hpNotify(body, 'テスト'); assert.equal(r.status, 200); assert.equal(booking(r.json.id).booth_id, first); assert(a.hpNotify(body, 'テスト').json.duplicated);
    pub({ staffId: 'B' }); assert.equal(a.hpNotify({ ...body, reservationId: 'TEST-HP-FULL', staffName: 'テスト担当C' }, 'テスト').status, 409);
  });
  await check('24時以降と翌日0時の部屋を重複させない', () => {
    state.booths.find(x => x.id === second).active = false; pub({ start: c.minToMs(date, 1410) });
    unchanged(() => schedule({ action: 'createBooking', date: next, staffId: 'B', start: 0, course, people: 1, consent: true, name: 'テスト翌日' }), 'boothSoldOut');
  });
  await check('公開・HP予約の本人性別を担当希望から推測しない', () => {
    const p = pub({ staff: 'male' }); assert.equal(booking(p.id).customer_gender, '');
    const h = a.hpNotify({ reservationId: 'TEST-GENDER', date, start: '15:00', minutes: 60, price: 6600, name: 'テストHP', menu: a.courseStore.get(course).name, staffName: 'テスト担当B' }, 'テスト'); assert.equal(booking(h.json.id).customer_gender, '');
  });
  await check('ブース設定GETの認証とPOSTのmanager権限', () => {
    assert.equal(api('GET', '/api/demo/booths', null, 'none').status, 401); assert.equal(api('GET', '/api/demo/booths', null, 'staff').data.booths.length, 11);
    assert.equal(boothPost({ action: 'saveBooth', booth: { ...state.booths[0], name: 'テスト変更' } }, 'staff').status, 403);
  });
  await check('ブース設定保存・再送・古い版・別内容キーを確認', () => {
    const body = { action: 'saveBooth', requestKey: 'test-room-config', booth: { ...state.booths[0], name: 'テスト部屋' } };
    const r = boothPost(body); assert.equal(r.status, 200); assert.deepEqual(boothPost({ ...body, expectedVersion: 0 }).data, r.data);
    assert.equal(boothPost({ ...body, booth: { ...body.booth, name: '別名' } }).data.error, 'requestChanged');
    assert.equal(boothPost({ action: 'saveBooth', expectedVersion: 0, booth: { ...state.booths[0], name: 'テスト旧版' } }).data.error, 'boothChanged');
  });
  await check('未来予約がある室の停止/削除/コース除外を拒否し原状保持', () => {
    pub(); const before = encode({ booths: state.booths, courses: [...a.courseStore], version: state.boothRevision });
    assert.equal(boothPost({ action: 'saveBooth', booth: { ...state.booths[0], active: false } }).data.error, 'futureBookingConflict');
    assert.equal(boothPost({ action: 'deleteBooth', boothId: first }).data.error, 'boothInUse');
    assert.equal(boothPost({ action: 'saveCourseBooths', courseId: course, boothIds: [second] }).data.error, 'futureBookingConflict');
    assert(encode({ booths: state.booths, courses: [...a.courseStore], version: state.boothRevision }) === before);
  });
  await check('メニュー対象室の設定は価格・文章を保持して空きへ反映', () => {
    const before = { ...a.courseStore.get(course) }; const r = boothPost({ action: 'saveCourseBooths', courseId: course, boothIds: [second] }); assert.equal(r.status, 200);
    assert.equal(a.courseStore.get(course).price, before.price); assert.equal(a.courseStore.get(course).name, before.name);
    const p = pub(); assert.deepEqual(booking(p.id).booth_ids, [second]);
  });
  await check('日報保存は目標と同じ日次版で競合を防ぎ金額を保持', () => {
    const firstReport = api('GET', '/api/demo/report?date=' + date).data;
    const result = api('POST', '/api/demo/report', { date, revision: firstReport.revision, requestKey: 'test-report-save', manager: 'テスト担当', todayPlan: 'テスト実施', send: true }); assert.equal(result.status, 200); assert.equal(result.data.revision, 1);
    const old = api('POST', '/api/demo/report', { date, revision: 0, requestKey: 'test-report-stale', todayPlan: 'テスト古い画面' }); assert.equal(old.status, 409); assert.equal(state.reports.get(date).todayPlan, 'テスト実施');
  });
  const report = { ok: results.every(x => x.ok), checks: results.length, passed: results.filter(x => x.ok).length, failures: results.filter(x => !x.ok), results, externalMail: false, persistentWrites: false };
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, results: undefined })); process.exit(report.ok ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
