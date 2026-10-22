'use strict';
// 送信無効・顧客情報を伏せた本番コピーで、業務/休憩の操作と予約受付をメモリ内だけで確認する。
// node tools/check-staff-blocks.cjs <検証用コピーのフォルダ> [結果.json]
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict');
assert(process.argv[2], '送信無効の検証コピーを指定してください');
const root = path.resolve(process.argv[2]);
assert(!fs.existsSync(path.join(root, 'mail-config.json')));
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(k)) delete process.env[k];
const revive = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json'), 'utf8'), revive);
assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && snapshot.state.mails.length === 0);
const persist = require(path.join(root, 'persist.js'));
persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot }); persist.startSaver = () => {};
const file = path.join(root, 'demo-api.js'), mod = new Module(file);
mod.filename = file; mod.paths = Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,postSchedule,getSchedule,freeStaffIds,publicStaffList,nominatableStaff,getAvailability,staffInfoMissing,createPublicBooking,todayJst,addDays,minToMs};', file);
const encode = v => JSON.stringify(v, (_, x) => x instanceof Map ? { __pm_map__: [...x] } : x instanceof Set ? { __pm_set__: [...x] } : x);

(async () => {
  await mod.exports.ready;
  const a = mod.exports.audit, state = a.state, course = '364323-4822701', realNow = Date.now;
  const date = a.addDays(a.todayJst(), 1), next = a.addDays(date, 1), actor = { user: 'test-manager', role: 'manager' };
  const publicIds = new Set(a.publicStaffList().filter(s => s.courses.includes(course) && !a.staffInfoMissing(state.staff.find(x=>x.id===s.id)).length).map(s => s.id));
  const ready = state.staff.filter(s => publicIds.has(s.id)).slice(0, 2);
  const bare = state.staff.find(s => a.staffInfoMissing(s).length > 0);
  assert.equal(ready.length, 2); assert(bare);
  const original = [ready[0], bare, ready[1]], [A, B, C] = original.map(s => s.id);
  const originalPhotos = new Map(ready.map(s => [s.id, state.photos.get(s.id)]));
  const results = [];
  function reset() {
    Date.now = realNow;
    state.staff = original.map((s, i) => ({ ...s, name: 'テスト担当' + i, active: 1, courses: JSON.stringify([course]),
      profile: JSON.stringify({ ...JSON.parse(s.profile || '{}'), nickname: 'テスト表示' + i,
        message: i === 1 ? '' : 'テスト紹介文', personalNomination: true, nominationFee: 500 }) }));
    state.photos = new Map(originalPhotos); state.mailRelay = { url: '', secret: '' }; state.mails = [];
    state.events = new Map(); state.days = new Map(); state.shifts = new Map();
    state.bookingIndex = new Map(); state.requestKeys = new Map();
    state.settings.freeMessage = { visible: true, required: false, maxLength: 2000 };
    state.settings.shopMaster.resStart = 600; state.settings.shopMaster.resEnd = 1560;
    for (const d of [date, next]) {
      state.days.set(d, { version: 0, enabled: true });
      state.events.set(d, { bookings: [], assignments: [], blocks: [] });
      state.shifts.set(d, state.staff.map(s => ({ staff_id: s.id, date: d,
        start_at: a.minToMs(d, d === next ? 0 : 600), end_at: a.minToMs(d, 1620), note: '' })));
    }
  }
  const protectedState = () => encode({ staff: state.staff, photos: state.photos, shifts: state.shifts,
    events: state.events, days: state.days, mails: state.mails, tickets: state.tickets, members: state.members, bookingIndex: state.bookingIndex });
  const version = d => state.days.get(d)?.version || 0;
  const block = (extra = {}) => {
    const d = extra.date || date;
    return a.postSchedule({ action: 'block', date: d, revision: version(d), staffId: A, start: 720, end: 780, kind: 'work', note: 'テスト業務', ...extra }, actor);
  };
  const list = (d = date) => state.events.get(d).blocks;
  const rejectUnchanged = (fn, code) => {
    const before = protectedState(); assert.throws(fn, e => e.message === code);
    assert.equal(protectedState(), before, '拒否した操作で元の記録が変化');
  };
  const reserve = (sid = A, start = 720) => a.createPublicBooking({ requestKey: 'test-block-booking', date, start: a.minToMs(date, start),
    course, people: 1, staff: 'none', staffId: sid, expectedNominationFee: 500, name: 'テスト予約',
    email: 'test-block@example.test', phone: '0000000000', consent: true });
  async function check(name, fn) {
    reset();
    try { await fn(); assert(state.mails.every(m => !m.real)); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e.message.split('\n').slice(0, 3).join(' ') }); }
    finally { Date.now = realNow; }
  }

  await check('写真と紹介文が不足していても、既存勤務内に業務を追加', () => {
    assert(a.staffInfoMissing(state.staff[1]).length > 0);
    block({ staffId: B }); assert.equal(list()[0].staff_id, B); assert.equal(list()[0].kind, 'work');
    assert.equal(state.mails.length, 0);
  });
  await check('写真と紹介文が不足した担当の休憩を追加・延長・担当移動・削除', () => {
    block({ staffId: B, kind: 'break' }); const id = list()[0].id;
    block({ id, staffId: B, start: 750, end: 840, kind: 'break', note: 'テスト休憩変更' });
    assert.equal(list().length, 1); assert.equal(list()[0].start_at, a.minToMs(date, 750));
    block({ id, staffId: C, start: 900, end: 960, kind: 'work' });
    assert.equal(list()[0].id, id); assert.equal(list()[0].staff_id, C);
    block({ id, remove: true }); assert.equal(list().length, 0); assert.equal(state.mails.length, 0);
  });
  await check('情報不足の担当へ業務を移動でき、IDと1件だけを維持', () => {
    block(); const id = list()[0].id; block({ id, staffId: B, start: 900, end: 960 });
    assert.equal(list().length, 1); assert.equal(list()[0].staff_id, B); assert.equal(list()[0].id, id);
  });
  await check('受付停止中の既存スタッフでも勤務内の業務を管理', () => {
    state.staff[1].active = 0; state.days.get(date).locked = [B];
    block({ staffId: B }); assert.equal(list()[0].staff_id, B);
  });
  await check('新規のスタッフ登録後も、シフトなしには業務を入れない', () => {
    state.shifts.set(date, state.shifts.get(date).filter(s => s.staff_id !== B));
    rejectUnchanged(() => block({ staffId: B }), 'outsideShift');
  });
  await check('存在しないスタッフに業務を入れない', () => rejectUnchanged(() => block({ staffId: 'test-missing' }), 'invalid'));
  await check('勤務時間外へは追加・移動せず元の枠を保持', () => {
    block(); const id = list()[0].id; rejectUnchanged(() => block({ id, start: 570, end: 630 }), 'outsideShift');
  });
  await check('予約と重なる業務は追加しない', () => {
    reserve(); rejectUnchanged(() => block({ start: 750, end: 810 }), 'scheduleConflict');
  });
  await check('業務・休憩同士が重なる移動は元に戻す', () => {
    block(); const first = list()[0].id; block({ staffId: C, start: 900, end: 960, kind: 'break' });
    rejectUnchanged(() => block({ id: first, staffId: C, start: 930, end: 990 }), 'scheduleConflict');
  });
  await check('隣接営業日の0時と前営業日の24時を重複させない', () => {
    block({ start: 1410, end: 1470 });
    rejectUnchanged(() => block({ date: next, start: 0, end: 60 }), 'scheduleConflict');
  });
  await check('枠の終わりと次の開始が同じなら追加できる', () => {
    block(); block({ start: 780, end: 840, kind: 'break' }); assert.equal(list().length, 2);
  });
  await check('同じミリ秒の複数追加でもID重複や上書きを起こさない', () => {
    const now = realNow(); Date.now = () => now;
    block(); block({ staffId: C }); assert.equal(list().length, 2); assert.equal(new Set(list().map(b => b.id)).size, 2);
  });
  await check('存在しない業務IDの編集では新規作成しない', () => rejectUnchanged(() => block({ id: 'test-missing-block' }), 'notFound'));
  await check('削除した業務を古い編集画面から復活させない', () => {
    block(); const id = list()[0].id; block({ id, remove: true }); rejectUnchanged(() => block({ id }), 'notFound');
  });
  await check('予約IDを業務IDとして使って予約の上に枠を作らない', () => {
    const r = reserve(); rejectUnchanged(() => block({ id: r.id }), 'notFound');
  });
  await check('別の日の業務IDでは同じ枠を複製しない', () => {
    block(); const id = list()[0].id; rejectUnchanged(() => block({ date: next, id }), 'notFound');
  });
  await check('古い更新番号の追加・編集・削除は保存しない', () => {
    block(); const id = list()[0].id;
    for (const extra of [{ staffId: C }, { id, start: 900, end: 960 }, { id, remove: true }]) {
      rejectUnchanged(() => block({ ...extra, revision: 0 }), 'scheduleConflict');
    }
  });
  await check('不正な日付・時刻・種別を保存しない', () => {
    for (const extra of [{ date: '2026-11-31' }, { start: -1 }, { start: 720.5 }, { end: 1621 }, { end: 720 }, { kind: 'invalid' }]) {
      rejectUnchanged(() => block(extra), 'invalid');
    }
  });
  await check('業務の時間は予約受付から除外し、移動と削除も直ちに反映', () => {
    assert(a.freeStaffIds(date, 720, 780, course, 'none').includes(A));
    block(); const id = list()[0].id; assert(!a.freeStaffIds(date, 720, 780, course, 'none').includes(A));
    rejectUnchanged(() => reserve(), 'soldOut');
    block({ id, start: 900, end: 960 }); assert(a.freeStaffIds(date, 720, 780, course, 'none').includes(A));
    assert(!a.freeStaffIds(date, 900, 960, course, 'none').includes(A));
    block({ id, remove: true }); assert(a.freeStaffIds(date, 900, 960, course, 'none').includes(A));
  });
  await check('写真紹介不足も紹介・指名へ載せ、業務中は予約拒否して勤務内の空きへ受け付ける', () => {
    block({ staffId: B });
    assert(a.publicStaffList(date).some(s => s.id === B && s.nominatable));assert(a.nominatableStaff(course, 'none', date).some(s => s.id === B));
    assert(a.freeStaffIds(date, 900, 960, course, 'none').includes(B));
    rejectUnchanged(() => reserve(B), 'soldOut');
    assert(reserve(B,900).id);
    rejectUnchanged(() => a.postSchedule({ action: 'shift', date: next, revision: version(next), staffId: B, start: 600, end: 1200 }, actor), 'staffInfoMissing');
  });
  const report = { ok: results.every(x => x.ok), checks: results.length, passed: results.filter(x => x.ok).length,
    failures: results.filter(x => !x.ok), results, externalMail: false, persistentWrites: false };
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, results: undefined })); process.exit(report.ok ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
