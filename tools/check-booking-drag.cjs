'use strict';
// 台帳の予約カードのドラッグで使うサーバー側の移動（moveBooking）を確かめる（2026-10-20）。
// 同じスタッフの別時間・別スタッフ・両方同時・別の日、重なり・シフト外、ほかの画面での先の変更、二重送信、
// 対応メニュー外の承認（マネージャー以上）、性別指定、移動の記録。記録はすべて架空。メール設定のない検証用チェックアウトで実行する
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
  '\nmodule.exports.checks={state,postSchedule,getSchedule,findBooking,minToMs,msToMin,todayJst,addDays};', m.filename);
(async () => {
  await m.exports.ready;
  const { state, postSchedule, getSchedule, findBooking, minToMs, msToMin, todayJst, addDays } = m.exports.checks;
  state.mailRelay = { url: '', secret: '' }; state.mails = [];
  const BODY = '364323-4822701';   // 全身整体 60分（性別の指定なし）
  const MALE = '364326-4822708';   // 【男性スタッフ】オイルリンパマッサージ 60分
  const day = addDays(todayJst(), 1), day2 = addDays(day, 2);
  const prof = JSON.stringify({ personalNomination: true, nominationFee: 500, message: '紹介文' });
  const staff = (id, gender, courses, i) => ({ id, name: '確認 ' + id, gender, active: 1, locked: 0, sort_order: i, courses: JSON.stringify(courses), profile: prof, profile_revision: 1 });
  const A = staff('chk-a', 'male', [], 1), B = staff('chk-b', 'female', [], 2), C = staff('chk-c', 'male', [MALE], 3), F = staff('chk-f', 'female', [], 4);
  state.staff = [A, B, C, F];
  state.photos = new Map(state.staff.map((s) => [s.id, 'data:image/jpeg;base64,/9j/']));
  state.days = new Map(); state.events = new Map(); state.bookingIndex = new Map();
  const shift = (sid, d) => ({ staff_id: sid, date: d, start_at: minToMs(d, 600), end_at: minToMs(d, 1320), note: '' });
  state.shifts = new Map([day, day2].map((d) => [d, state.staff.map((s) => shift(s.id, d))]));
  const rev = (d = day) => getSchedule(d).days.find((x) => x.date === d).version;
  const code = (c) => (e) => e.message === c;
  const manager = { user: 'chk-manager', role: 'manager' }, clerk = { user: 'chk-clerk', role: 'staff' };
  const make = (staffId, start, course = BODY) => {
    postSchedule({ action: 'createBooking', date: day, revision: rev(), staffId, start, course, people: 1, consent: true, name: '確認 お客様' }, manager);
    return state.events.get(day).bookings.at(-1);
  };
  const where = (bk) => {
    const f = findBooking(bk.id);
    return { date: f.date, staff: state.events.get(f.date).assignments.filter((a) => a.booking_id === bk.id).map((a) => a.staff_id),
      start: msToMin(f.date, f.bk.start_at), end: msToMin(f.date, f.bk.end_at) };
  };
  const move = (bk, extra, actor = manager) => postSchedule({ action: 'moveBooking', date: where(bk).date, revision: rev(where(bk).date), id: bk.id, ...extra }, actor);

  // 1) 同じスタッフの別時間（11:10〜12:10 → 15:00〜16:00）。施術時間・お客様・メニュー・料金は変わらない
  const bk = make(A.id, 670);
  const keep = JSON.stringify({ name: bk.name, course: bk.course, course_name: bk.course_name, base_price: bk.base_price, total: bk.total, people: bk.people });
  assert.equal(move(bk, { staffId: A.id, start: 900, end: 960, expect: { staffId: A.id, start: 670 } }).ok, true);
  assert.deepEqual(where(bk), { date: day, staff: [A.id], start: 900, end: 960 });
  // 2) 別スタッフ（同じ時刻）  3) 両方同時（斜め）
  assert.equal(move(bk, { staffId: B.id, start: 900, end: 960, expect: { staffId: A.id, start: 900 } }).ok, true);
  assert.deepEqual(where(bk), { date: day, staff: [B.id], start: 900, end: 960 });
  assert.equal(move(bk, { staffId: A.id, start: 720, end: 780, expect: { staffId: B.id, start: 900 } }).ok, true);
  assert.deepEqual(where(bk), { date: day, staff: [A.id], start: 720, end: 780 });
  assert.equal(JSON.stringify({ name: bk.name, course: bk.course, course_name: bk.course_name, base_price: bk.base_price, total: bk.total, people: bk.people }), keep, '移動していない項目は変えない');

  // 4) ほかの画面で先に動かされていた（ドラッグを始めたときの担当・時刻と違う）→ 動かさない
  assert.throws(() => move(bk, { staffId: B.id, start: 1000, end: 1060, expect: { staffId: A.id, start: 900 } }), code('bookingChanged'));
  // 5) 古い画面の版のまま送った（連打・同時操作）→ 2回目は断られ、二重に変わらない
  const r0 = rev();
  postSchedule({ action: 'moveBooking', date: day, revision: r0, id: bk.id, staffId: A.id, start: 780, end: 840, expect: { staffId: A.id, start: 720 } }, manager);
  assert.throws(() => postSchedule({ action: 'moveBooking', date: day, revision: r0, id: bk.id, staffId: A.id, start: 840, end: 900, expect: { staffId: A.id, start: 720 } }, manager), code('scheduleConflict'));
  assert.deepEqual(where(bk), { date: day, staff: [A.id], start: 780, end: 840 });

  // 6) 重なり・シフト外は断る
  const other = make(B.id, 600);
  assert.throws(() => move(bk, { staffId: B.id, start: 630, end: 690 }), code('soldOut'));
  assert.throws(() => move(bk, { staffId: A.id, start: 1290, end: 1350 }), code('outsideShift'));
  assert.deepEqual(where(other), { date: day, staff: [B.id], start: 600, end: 660 });

  // 7) 対応メニュー外（C は男性メニューだけ）：承認なし→断る／スタッフ権限で承認→断る／マネージャーが承認→移す（記録・対応外の印）
  assert.throws(() => move(bk, { staffId: C.id, start: 780, end: 840 }), code('staffCannotDoCourse'));
  assert.throws(() => move(bk, { staffId: C.id, start: 780, end: 840, allowCourseMismatch: true }, clerk), code('courseOverrideForbidden'));
  assert.throws(() => move(bk, { staffId: C.id, start: 780, end: 840, allowCourseMismatch: true }, null), code('courseOverrideForbidden'));
  assert.deepEqual(where(bk).staff, [A.id], '断ったときは変えない');
  const ov = move(bk, { staffId: C.id, start: 780, end: 840, allowCourseMismatch: true });
  assert.equal(ov.ok, true); assert.equal(ov.courseOverride, true);
  assert.deepEqual(where(bk).staff, [C.id]);
  assert.equal(bk.move_log.at(-1).course_override, true);
  assert.equal(bk.move_log.at(-1).by, 'chk-manager');
  assert.ok(getSchedule(day).capabilityWarnings.some((w) => w.booking_id === bk.id && w.staff_id === C.id && w.reason === 'course'), '台帳に「対応外」の印');
  assert.equal(state.staff.find((s) => s.id === C.id).courses, JSON.stringify([MALE]), 'スタッフ情報の「コース」は変えない');
  // 8) 性別指定のメニュー（男性メニュー）は、承認しても女性スタッフへは移せない
  const maleBk = make(A.id, 1000, MALE);
  assert.throws(() => move(maleBk, { staffId: F.id, start: 1000, end: 1060, allowCourseMismatch: true }), code('staffGenderOnly'));
  assert.throws(() => move(maleBk, { staffId: F.id, start: 1000, end: 1060 }), code('staffGenderOnly'));

  // 9) 別の日へ（置き場から別の日の台帳へ）：予約IDはそのまま、日付・時間・担当だけ変わる
  const d0 = rev(day), t0 = rev(day2);
  const x = move(bk, { staffId: A.id, start: 900, end: 960, toDate: day2, toRevision: t0, expect: { staffId: C.id, start: 780 } });
  assert.equal(x.ok, true); assert.equal(x.date, day2);
  assert.deepEqual(where(bk), { date: day2, staff: [A.id], start: 900, end: 960 });
  assert.equal(bk.service_date, day2);
  assert.ok(!state.events.get(day).bookings.some((b) => b.id === bk.id), '元の日からは消える');
  assert.ok(!state.events.get(day).assignments.some((a) => a.booking_id === bk.id));
  assert.ok(rev(day) > d0 && rev(day2) > t0, '両方の日の台帳に変更の合図');
  assert.deepEqual(bk.move_log.at(-1).from.date, day);
  assert.deepEqual(bk.move_log.at(-1).to, { date: day2, staff_id: A.id, start_at: minToMs(day2, 900), end_at: minToMs(day2, 960) });
  // 移動先の日の版が古い・過去の日・指名の予約は断る
  assert.throws(() => move(bk, { staffId: A.id, start: 600, end: 660, toDate: day, toRevision: rev(day) - 1 }), code('scheduleConflict'));
  assert.throws(() => move(bk, { staffId: A.id, start: 600, end: 660, toDate: addDays(todayJst(), -1), toRevision: 0 }), code('invalid'));
  const nom = make(B.id, 1100);
  nom.nominated_staff_id = B.id;
  assert.throws(() => move(nom, { staffId: B.id, start: 1100, end: 1160, toDate: day2, toRevision: rev(day2) }), code('nominatedLocked'));
  assert.throws(() => move(nom, { staffId: B.id, start: 1130, end: 1190 }), code('nominatedLocked'));

  // 10) 管理画面のアカウントの権限：スタッフ権限でも、対応メニュー内の通常の移動はできる
  assert.equal(move(other, { staffId: B.id, start: 630, end: 690, expect: { staffId: B.id, start: 600 } }, clerk).ok, true);

  // 11) 複数名の予約（A・B・D の3人）：担当の1人（B）に鍵（受付停止）がかかっていても、ほかの担当はそのまま一緒に移る
  //     （以前は全員を選び直していたため、鍵の人が外れて人数が足りず、どの時間にも動かせなかった）
  postSchedule({ action: 'createBooking', date: day, revision: rev(), staffId: A.id, start: 1200, course: BODY, people: 3, consent: true, name: '確認 3名' }, manager);
  const grp = state.events.get(day).bookings.at(-1);
  const sorted = (b) => [...where(b).staff].sort();
  assert.deepEqual(sorted(grp), [A.id, B.id, F.id].sort());
  postSchedule({ action: 'lockStaff', date: day, staffId: B.id, locked: true }, manager);
  assert.equal(move(grp, { staffId: A.id, start: 1260, end: 1320, expect: { staffId: A.id, start: 1200 } }).ok, true);
  assert.deepEqual([where(grp).start, sorted(grp)], [1260, [A.id, B.id, F.id].sort()], '鍵の人も担当のまま一緒に移る');
  // 2人目（鍵の B）の枠を動かす：誤って「ほかの画面で変更」と断らず、B のまま時間だけ変わる
  assert.equal(move(grp, { staffId: B.id, start: 1230, end: 1290, expect: { staffId: B.id, start: 1260 } }).ok, true);
  assert.deepEqual([where(grp).start, sorted(grp)], [1230, [A.id, B.id, F.id].sort()]);
  assert.equal(grp.move_log.at(-1).from.staff_id, B.id, '記録の移動元は動かした枠の担当');
  // 鍵の人へ新しく担当させることはできない
  const solo = make(A.id, 720);
  assert.throws(() => move(solo, { staffId: B.id, start: 720, end: 780 }), code('staffLocked'));
  // 12) 対応外として承認して移した担当のまま、時間だけ変えるのは承認なしでできる
  assert.equal(move(solo, { staffId: C.id, start: 720, end: 780, allowCourseMismatch: true }).ok, true);
  assert.equal(move(solo, { staffId: C.id, start: 750, end: 810, expect: { staffId: C.id, start: 720 } }, clerk).ok, true);
  assert.deepEqual([where(solo).staff, where(solo).start], [[C.id], 750]);
  assert.ok(state.mails.every((x) => !x.real), 'メールは実際には送らない（送信設定がないので記録だけ）');
  console.log('PASS: same-staff time, staff change, diagonal, other day, overlap/shift refusal, stale screen, double submit, course override (manager only), gender lock, nominated lock, move log, group booking with a locked co-staff, time change of an approved off-menu assignment; synthetic records only');
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
