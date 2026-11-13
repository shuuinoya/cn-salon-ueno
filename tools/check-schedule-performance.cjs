'use strict';
// 送信無効のコピーで変更前後の台帳・空き状況を比較。保存・外部通信なし。
// node tools/check-schedule-performance.cjs <変更前コピー> <変更後コピー>
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), { performance } = require('node:perf_hooks');
assert(process.argv[2] && process.argv[3], '変更前・変更後の検証コピーを指定してください');
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_|BOOKING_MAIL|STORE_MAIL)/.test(k)) delete process.env[k];
global.fetch = async () => { throw Error('external network forbidden'); };
const revive = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
async function load(root) {
  root = fs.realpathSync(root);
  assert.notEqual(root, fs.realpathSync(path.join(__dirname, '..')));
  assert(!fs.existsSync(path.join(root, 'mail-config.json')));
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json'), 'utf8'), revive);
  assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && snapshot.state.mails.length === 0);
  const persist = require(path.join(root, 'persist.js'));
  persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot });
  persist.startSaver = () => {}; persist.requestSave = () => {};
  const file = path.join(root, 'demo-api.js'), mod = new Module(file);
  mod.filename = file; mod.paths = Module._nodeModulePaths(root);
  mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,courseStore,getSchedule,getAvailability,staffCanDo,staffMismatch,bookingMismatch,publicStaffList};', file);
  await mod.exports.ready;
  return mod.exports.audit;
}
// 起動ごとに変わる通知用番号だけを除外。日付・金額・担当・編集トークンは比較する。
const comparable = value => JSON.stringify(value, (k, v) => k === 'syncVersion' ? undefined : v);
const timing = fn => { const start = performance.now(); fn(); return +(performance.now() - start).toFixed(2); };
(async () => {
  const before = await load(process.argv[2]), after = await load(process.argv[3]);
  const dates = ['2026-11-13', '2026-11-15', '2026-11-29'];
  let comparisons = 0;
  function equal(a, b, label) {
    assert(comparable(a) === comparable(b), label + ' が変更前後で異なります'); comparisons++;
  }
  for (const date of dates) equal(before.getSchedule(date), after.getSchedule(date), '台帳');
  const ids = [...before.courseStore.keys()];
  for (let i = 0; i < before.state.staff.length; i++) for (const id of [...ids, 'invalid-course']) {
    equal(before.staffCanDo(before.state.staff[i], id), after.staffCanDo(after.state.staff[i], id), 'スタッフのチェック');
    equal(before.staffMismatch(before.state.staff[i], id), after.staffMismatch(after.state.staff[i], id), '男女・対応メニュー');
  }
  for (const date of dates) for (const id of ids.filter((_, i) => i % 8 === 0)) for (const people of ['1', '3']) {
    const query = new URLSearchParams({ date, course: id, people, staff: 'none' });
    equal(before.getAvailability(query), after.getAvailability(query), '予約の空き状況');
  }
  const st = { id: 'test-speed', name: 'テスト担当', gender: 'male', courses: '[]' };
  // 同じオブジェクトの設定変更でも、直後の候補と台帳に反映すること。
  for (const courses of [JSON.stringify([ids[0]]), JSON.stringify([ids[1]]), '[]', 'null', '{}', '[', '[0]', '', undefined]) {
    st.courses = courses;
    for (const id of [...ids, 'invalid-course', 0]) equal(before.staffCanDo(st, id), after.staffCanDo(st, id), 'チェック変更直後');
  }
  const a = before.state.staff[0], b = after.state.staff[0];
  for (const courses of [JSON.stringify([ids[0]]), JSON.stringify([ids[1]]), '[]']) {
    a.courses = b.courses = courses;
    equal(before.getSchedule(dates[1]), after.getSchedule(dates[1]), 'チェック変更後の台帳');
  }
  a.gender = b.gender = 'female';
  equal(before.getSchedule(dates[1]), after.getSchedule(dates[1]), '性別変更後の台帳');
  equal(before.state.mails.length, 0, '変更前のメール'); equal(after.state.mails.length, 0, '変更後のメール');
  const timings = { beforeMs: [], afterMs: [] };
  for (let i = 0; i < 7; i++) {
    timings.beforeMs.push(timing(() => before.getSchedule(dates[1])));
    timings.afterMs.push(timing(() => after.getSchedule(dates[1])));
  }
  console.log(JSON.stringify({ ok: true, comparisons, staff: after.state.staff.length, courses: ids.length,
    schedule: timings, productionWrites: false, externalNetwork: false }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
