'use strict';
// スタッフ情報（コース・画像・フリーメッセージ。性別は条件にしない）がそろっていない人には、シフト・休憩・業務・予約を入れられず、
// 台帳・月間シフト作成・予約サイト・ホットペッパーの割り当てに出ないことを確かめる（2026-10-20 お店の人の指定）。
// 記録はすべて架空。メール設定のない検証用チェックアウトで実行する（メールは送らない）
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
process.env.DEMO_EPHEMERAL = '1';
process.env.HP_MAIL = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_)/.test(k)) delete process.env[k];
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
assert.equal(fs.existsSync(path.join(root, 'mail-config.json')), false, 'メール設定のない検証用チェックアウトで実行してください');
const m = new Module(path.join(root, 'demo-api.js'));
m.filename = path.join(root, 'demo-api.js'); m.paths = Module._nodeModulePaths(root);
m._compile(fs.readFileSync(m.filename, 'utf8') +
  '\nmodule.exports.checks={state,postSchedule,getSchedule,freeStaffIds,nominatableStaff,publicStaffList,hpNotify,staffInfoMissing,minToMs,todayJst,addDays};', m.filename);
(async () => {
  await m.exports.ready;
  const { state, postSchedule, getSchedule, freeStaffIds, nominatableStaff, publicStaffList, hpNotify, staffInfoMissing, minToMs, todayJst, addDays } = m.exports.checks;
  state.mailRelay = { url: '', secret: '' }; state.mails = [];
  const COURSE = '364323-4822701'; // 全身整体 60分（性別の指定なし）
  const date = addDays(todayJst(), 1), next = addDays(date, 1);
  const prof = (message) => JSON.stringify({ personalNomination: true, nominationFee: 500, message });
  const ready = { id: 'chk-ready', name: 'テスト 確認 完了', gender: 'male', active: 1, locked: 0, sort_order: 1, courses: '[]', profile: prof('紹介文'), profile_revision: 1 };
  // 名前だけで登録した人（以前の宮崎さんと同じ形：性別は未設定・コースは1つ・画像と紹介文なし）
  const bare = { id: 'chk-bare', name: 'テスト 確認 未入力', gender: 'none', active: 1, locked: 0, sort_order: 2, courses: JSON.stringify([COURSE]), profile: prof(''), profile_revision: 1 };
  state.staff = [ready, bare];
  state.photos = new Map([[ready.id, 'data:image/jpeg;base64,/9j/']]);
  state.days = new Map(); state.events = new Map();
  const shift = (sid, d, s, e) => ({ staff_id: sid, date: d, start_at: minToMs(d, s), end_at: minToMs(d, e), note: '' });
  // すでに入ってしまっているシフトと業務（台帳・予約サイトには出さない）
  state.shifts = new Map([[date, [shift(ready.id, date, 600, 1320), shift(bare.id, date, 660, 1320)]], [next, [shift(ready.id, next, 600, 1320)]]]);
  state.events.set(date, { bookings: [], blocks: [{ id: 'blk-bare', staff_id: bare.id, date, start_at: minToMs(date, 660), end_at: minToMs(date, 720), kind: 'work', note: '' }], assignments: [] });
  const rev = (d = date) => state.days.get(d)?.version ?? 0;
  const code = (c) => (e) => e.message === c;

  assert.deepEqual(staffInfoMissing(bare), ['画像', 'フリーメッセージ']);
  assert.deepEqual(staffInfoMissing(ready), []);

  // 台帳：未入力の人の行・シフト・業務は出さない。スタッフ情報の画面用の一覧（allStaff）には全員と未入力の項目
  let sc = getSchedule(date);
  assert.deepEqual(sc.staff.map((s) => s.id), [ready.id]);
  assert.deepEqual(sc.allStaff.map((s) => [s.id, s.info_missing]), [[ready.id, []], [bare.id, ['画像', 'フリーメッセージ']]]);
  assert.ok(!sc.shifts.some((x) => x.staff_id === bare.id), '未入力の人のシフトは台帳に出さない');
  assert.ok(!sc.blocks.some((x) => x.staff_id === bare.id), '未入力の人の業務は台帳に出さない');

  // 予約サイト：空き枠・指名候補・スタッフ紹介に出さない
  assert.deepEqual(freeStaffIds(date, 720, 780, COURSE, 'none'), [ready.id]);
  assert.ok(!nominatableStaff(COURSE, 'none').some((s) => s.id === bare.id));
  assert.ok(!publicStaffList().some((s) => s.id === bare.id));

  // シフト・まとめてシフト・休憩/業務・予約の登録は断る（何も変えない）
  const before = JSON.stringify([...state.shifts]);
  assert.throws(() => postSchedule({ action: 'shift', date: next, revision: rev(next), staffId: bare.id, start: 600, end: 1200 }), code('staffInfoMissing'));
  assert.throws(() => postSchedule({ action: 'bulkShift', date, start: 600, end: 1200, cells: [{ date: next, staffId: ready.id, revision: rev(next) }, { date: next, staffId: bare.id, revision: rev(next) }] }), code('staffInfoMissing'));
  assert.throws(() => postSchedule({ action: 'bulkShift', date, start: 600, end: 1200, cells: [{ date: next, staffId: 'no-such-staff', revision: rev(next) }] }), code('invalid'));
  assert.equal(JSON.stringify([...state.shifts]), before, '断ったときはどのシフトも変えない');
  assert.throws(() => postSchedule({ action: 'block', date, revision: rev(), staffId: bare.id, start: 900, end: 960, kind: 'break' }), code('staffInfoMissing'));
  assert.throws(() => postSchedule({ action: 'createBooking', date, revision: rev(), staffId: bare.id, start: 720, course: COURSE, people: 1, consent: true, name: 'テスト 確認 店頭' }), code('staffInfoMissing'));
  // シフトの削除はできる
  assert.equal(postSchedule({ action: 'bulkShift', date, remove: true, cells: [{ date, staffId: bare.id, revision: rev() }] }).ok, true);
  assert.ok(!state.shifts.get(date).some((x) => x.staff_id === bare.id));
  state.shifts.get(date).push(shift(bare.id, date, 660, 1320));
  // 入力がそろっている人には入れられる
  assert.equal(postSchedule({ action: 'bulkShift', date, start: 600, end: 1200, cells: [{ date: addDays(date, 2), staffId: ready.id, revision: rev(addDays(date, 2)) }] }).ok, true);

  // ホットペッパー：未入力の人の名前で来ても割り当てない。名前の指定がなければ入力済みの人に割り当てる
  const hp = (rid, staffName) => hpNotify({ reservationId: rid, date, start: '12:00', minutes: 60, price: 6600, name: 'テスト 確認 客', menu: '全身整体 60分', staffName }, 'check');
  assert.equal(hp('CHK-1', bare.name).status, 409);
  assert.equal(hp('CHK-2', '').status, 200);
  const hpBk = state.events.get(date).bookings.find((b) => b.reference === 'CHK-2');
  assert.deepEqual(state.events.get(date).assignments.filter((a) => a.booking_id === hpBk.id).map((a) => a.staff_id), [ready.id]);
  // 予約を未入力の人へ移すことはできない
  assert.throws(() => postSchedule({ action: 'moveBooking', date, revision: rev(), id: hpBk.id, staffId: bare.id, start: 720, end: 780 }), code('staffInfoMissing'));

  // 予約の担当がある人の情報があとで欠けても、その日の台帳には残す（予約が見えなくならない）。新しい予約は入れられない
  state.photos.delete(ready.id);
  sc = getSchedule(date);
  assert.deepEqual(sc.staff.map((s) => [s.id, s.info_missing]), [[ready.id, ['画像']]]);
  assert.ok(sc.shifts.some((x) => x.staff_id === ready.id && x.date === date));
  assert.equal(postSchedule({ action: 'moveBooking', date, revision: rev(), id: hpBk.id, staffId: ready.id, start: 750, end: 810 }).ok, true, 'いまの担当のまま時間を変えるのはよい');
  assert.throws(() => postSchedule({ action: 'createBooking', date, revision: rev(), staffId: ready.id, start: 900, course: COURSE, people: 1, consent: true, name: 'テスト 確認 店頭' }), code('staffInfoMissing'));
  assert.deepEqual(getSchedule(next).staff, [], '予約のない日には出さない');
  state.photos.set(ready.id, 'data:image/jpeg;base64,/9j/');

  // スタッフ情報の保存：足りない項目を知らせる。そろえて保存すると、入っていたシフトがそのまま台帳・予約サイトに戻る
  const save = (extra) => postSchedule({ action: 'staff', date, id: bare.id, name: bare.name, active: 1, courses: [COURSE], sortOrder: 2, staffRevision: 1, profile: { personalNomination: true, nominationFee: 500, message: '' }, ...extra });
  assert.match(save({ gender: 'female' }).warning, /「画像・フリーメッセージ」が未入力/);
  assert.equal(save({ gender: 'female', photo: 'data:image/jpeg;base64,/9j/', profile: { personalNomination: true, nominationFee: 500, message: '紹介文' } }).warning, undefined);
  sc = getSchedule(date);
  assert.deepEqual(sc.staff.map((s) => s.id), [ready.id, bare.id]);
  assert.ok(sc.shifts.some((x) => x.staff_id === bare.id && x.date === date));
  assert.ok(freeStaffIds(date, 1080, 1140, COURSE, 'female').includes(bare.id));
  assert.ok(publicStaffList().some((s) => s.id === bare.id));
  assert.ok(state.mails.every((x) => !x.real), 'メールは実際には送らない（送信設定がないので記録だけ）');
  console.log('PASS: staff info required for shifts, breaks, bookings, hot pepper, ledger and booking site; hidden shifts return after the info is saved; synthetic records only');
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
