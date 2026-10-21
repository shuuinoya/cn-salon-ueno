'use strict';
// メール送信設定を除いた本番コピー専用。お客様の情報は出力しない。
// node tools/check-staff-consistency.cjs <検証用コード> <送信無効化済みsnapshot> [確認結果.json]
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || ''), snapshot = process.argv[3];
assert(snapshot, '送信無効化済みのコピーを指定してください');
assert(!fs.existsSync(path.join(root, 'mail-config.json')), 'メール設定があるフォルダでは実行できません');
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(k)) delete process.env[k];
const data = JSON.parse(fs.readFileSync(snapshot, 'utf8'), (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v);
assert(!data.state.mailRelay?.url && !data.state.mailRelay?.secret, '送信設定を空にしてください');
assert.equal(data.state.mails.length, 0, '送信待ちメールを除いてください');
const persist = require(path.join(root, 'persist.js'));
persist.loadSnapshotWithRemote = async () => ({ enabled: false, data }); persist.startSaver = () => {};
const file = path.join(root, 'demo-api.js'), mod = new Module(file);
mod.filename = file; mod.paths = Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,courseStore,getSchedule,publicStaffList,getAvailability,todayJst,addDays};', file);
(async () => {
  await mod.exports.ready;
  const {state, courseStore, getSchedule, publicStaffList, getAvailability, todayJst, addDays} = mod.exports.audit;
  const staff = state.staff, courses = [...courseStore.values()], ids = new Set(staff.map(s => s.id));
  assert.equal(ids.size, staff.length, '登録IDの重複');
  let shifts = 0;
  for (const [date, entries] of state.shifts) {
    assert.equal(new Set(entries.map(s => s.staff_id)).size, entries.length, '同日同一スタッフのシフト重複');
    for (const s of entries) {
      assert(ids.has(s.staff_id), '未登録スタッフのシフト'); assert.equal(s.date, date);
      assert(s.end_at > s.start_at, '勤務時間が逆転'); shifts++;
    }
  }
  const prof = s => JSON.parse(s.profile || '{}');
  const ready = s => Array.isArray(JSON.parse(s.courses || '[]')) && state.photos.has(s.id) && !!String(prof(s).message || '').trim();
  const listed = s => s.active === 1 && ready(s) && !!prof(s).personalNomination;
  const gender = c => /女性/.test(c.name) ? 'female' : /男性/.test(c.name) ? 'male' : 'none';
  const capable = (s,c) => {
    const checked = JSON.parse(s.courses || '[]');
    return (!checked.length || checked.includes(c.id)) && (gender(c) === 'none' || gender(c) === s.gender);
  };
  const publicList = publicStaffList(), today = todayJst(), sc = getSchedule(today);
  assert.deepEqual(sc.staff.map(s=>s.id), sc.allStaff.map(s=>s.id));
  assert.deepEqual(new Set(sc.staff.map(s=>s.id)), ids);
  const rows = staff.map(s => {
    const menus = courses.filter(c=>capable(s,c));
    const meta = sc.staff.find(x=>x.id===s.id).booking_status;
    assert.equal(meta.listed, listed(s), '指名掲載条件の不一致');
    assert.deepEqual(meta.course_ids, menus.map(c=>c.id), '対応メニューの不一致');
    const p = publicList.find(x=>x.id===s.id);
    assert.equal(!!p, listed(s), '予約サイトと管理画面の掲載状態の不一致');
    if(p) { assert.equal(p.name, prof(s).nickname || s.name); assert.deepEqual(p.courses, meta.course_ids); }
    return { id:s.id, name:s.name, gender:s.gender, menuNames:menus.map(c=>c.name), menuIds:menus.map(c=>c.id), listed:listed(s), reasons:meta.reasons };
  });
  // 月の途中から開いても月初の保存済みシフトを落とさない。
  const months = new Set([...state.shifts.keys()].map(d=>d.slice(0,7)));
  for (const month of months) {
    const schedule = getSchedule(month+'-15');
    const want = [...state.shifts.entries()].filter(([d])=>d.startsWith(month)).flatMap(([,s])=>s);
    for (const sh of want) assert(schedule.shifts.some(s=>s.staff_id===sh.staff_id && s.date===sh.date && s.start_at===sh.start_at && s.end_at===sh.end_at), '月間のシフト欠落');
  }
  const date = addDays(today,1);
  const midnight = d => Date.parse(d+'T00:00:00+09:00');
  let combinations = 0, slots = 0;
  for (const c of courses) for (const s of staff) {
    const response = getAvailability(new URLSearchParams({course:c.id,date,people:'1',staff:'none',staffId:s.id}));
    assert.deepEqual(response.staff.map(x=>x.id), staff.filter(x=>listed(x)&&capable(x,c)).sort((a,b)=>a.sort_order-b.sort_order).map(x=>x.id), '指名候補の不一致');
    for (const day of response.days) for (const slot of day.slots) {
      const end = slot.start + c.minutes*60000;
      const sh = (state.shifts.get(day.date)||[]).find(x=>x.staff_id===s.id);
      const ev = state.events.get(day.date) || {bookings:[],blocks:[],assignments:[]};
      const assigned = new Set(ev.assignments.filter(a=>a.staff_id===s.id).map(a=>a.booking_id));
      const busy = [...ev.blocks.filter(b=>b.staff_id===s.id), ...ev.bookings.filter(b=>b.status==='confirmed'&&assigned.has(b.id))].some(b=>b.start_at<end && b.end_at>slot.start);
      const locked = (state.days.get(day.date)?.locked || []).includes(s.id);
      const expected = !!(s.active===1 && ready(s) && capable(s,c) && !locked && sh && sh.start_at<=slot.start && sh.end_at>=end && !busy);
      assert.equal(slot.start, midnight(day.date)+slot.minute*60000);
      assert.equal(slot.available, expected, 'スタッフ・メニュー・シフト・空き表示の不一致: '+s.id.slice(0,8)+' / '+c.id+' / '+day.date+' / '+slot.minute);
      slots++;
    }
    combinations++;
  }
  assert.equal(state.mails.length, 0, '照合でメールが作られた');
  const result = {staff:staff.length, courses:courses.length, savedShifts:shifts, months:months.size, combinations, slots, listed:publicList.length, rows};
  if(process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify(result,null,2), {mode:0o600});
  console.log(JSON.stringify({...result,rows:undefined}));
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
