'use strict';
// メール設定のない独立コピーだけで実行。架空のスタッフ・予約をメモリ内で照合する。
// node tools/check-hotpepper-staff-names.cjs <検証用コードのフォルダ>
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || '');
assert(process.argv[2], 'メール設定のない検証用コピーを指定してください');
assert(!fs.existsSync(path.join(root, 'mail-config.json')), 'メール設定があるフォルダでは実行できません');
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(k)) delete process.env[k];
const persist = require(path.join(root, 'persist.js'));
persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: null });
persist.startSaver = () => {};
const file = path.join(root, 'demo-api.js'), mod = new Module(file);
mod.filename = file; mod.paths = Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,hpNotify,todayJst,addDays,minToMs};', file);

(async () => {
  await mod.exports.ready;
  const { state, hpNotify, todayJst, addDays, minToMs } = mod.exports.audit;
  const date = addDays(todayJst(), 1), course = '364323-4822701';
  const staff = (id, name, nickname) => ({ id, name, gender: 'male', active: 1, locked: 0,
    sort_order: id === 'test-first' ? 1 : 2, courses: JSON.stringify([course]),
    profile: JSON.stringify({ nickname, personalNomination: true, message: 'テスト紹介文' }) });
  const first = staff('test-first', 'テスト 中山　駿輝', 'テスト 中山　優吾');
  const other = staff('test-other', 'テスト 別スタッフ', 'テスト 別の表示名');
  let checks = 0;
  function reset(rows = [first, other]) {
    state.staff = JSON.parse(JSON.stringify(rows));
    state.mailRelay = { url: '', secret: '' }; state.mails = [];
    state.days = new Map([[date, { version: 0, enabled: true }]]);
    state.events = new Map([[date, { bookings: [], assignments: [], blocks: [] }]]);
    state.photos = new Map(rows.map(s => [s.id, 'data:image/jpeg;base64,/9j/']));
    state.shifts = new Map([[date, rows.map(s => ({ staff_id: s.id, date,
      start_at: minToMs(date, 600), end_at: minToMs(date, 1320), note: '' }))]]);
    state.hpKeys = new Map(); state.bookingIndex = new Map(); state.hpLog = [];
  }
  const receive = (staffName, extra = {}) => hpNotify({ reservationId: 'HP-TEST-' + checks,
    date, start: '12:00', minutes: 60, price: 6600, name: 'テスト 確認 客',
    menu: '全身整体 60分', staffName, ...extra }, 'check');
  function assigned(name, expected = first.id) {
    const result = receive(name);
    assert.equal(result.status, 200);
    assert.deepEqual(state.events.get(date).assignments.map(a => a.staff_id), [expected]);
    assert.equal(state.mails.length, 0); checks++;
  }
  function rejected(name, error = 'noCapableStaff', extra = {}) {
    const before = JSON.stringify(state.events.get(date));
    const result = receive(name, extra);
    assert.equal(result.status, 409); assert.equal(result.json.error, error);
    assert.equal(JSON.stringify(state.events.get(date)), before, '拒否した通知で予約・担当を作らない');
    assert.equal(state.hpKeys.size, 0); assert.equal(state.bookingIndex.size, 0);
    assert.equal(state.mails.length, 0); checks++;
  }
  // 登録名・台帳の表示名・半角/全角スペースは同じ登録IDに一致する。
  for (const name of [first.name, 'テスト 中山　優吾', ' テスト中山 優吾 ', 'テスト中山駿輝']) {
    reset(); assigned(name);
  }
  reset(); assigned('テスト 別の表示名', other.id);
  reset(); assigned(''); // スタッフ指定なしは、これまでどおり対応できる空き担当へ。
  reset(); rejected('テスト 中山'); // 部分一致では別人を選ばない。
  // 同じ人の登録名と表示名の一致は1人として扱う。
  reset([staff(first.id, first.name, first.name), other]); assigned(first.name);
  // 名前の重複は勤務・メニュー・受付状態で勝手に絞らず、担当者不明として止める。
  for (const duplicate of [
    staff(other.id, other.name, 'テスト中山優吾'),
    staff(other.id, 'テスト中山優吾', other.name),
    { ...staff(other.id, other.name, 'テスト中山優吾'), active: 0 },
    { ...staff(other.id, other.name, 'テスト中山優吾'), courses: JSON.stringify(['364326-4822708']) },
  ]) { reset([first, duplicate]); rejected('テスト中山優吾'); }
  // 名前が一致しても、従来の受付条件を緩めたり別のスタッフへ振り替えたりしない。
  reset(); state.staff[0].active = 0; rejected('テスト中山優吾');
  reset(); state.photos.delete(first.id); rejected('テスト中山優吾');
  reset(); state.staff[0].courses = JSON.stringify(['364326-4822708']); rejected('テスト中山優吾');
  reset(); state.days.get(date).locked = [first.id]; rejected('テスト中山優吾');
  reset(); state.shifts.get(date)[0].end_at = minToMs(date, 700); rejected('テスト中山優吾', 'slotTaken');
  reset(); state.events.get(date).blocks.push({ id: 'test-break', staff_id: first.id,
    start_at: minToMs(date, 720), end_at: minToMs(date, 780), kind: 'break' });
  rejected('テスト中山優吾', 'slotTaken');
  reset(); state.staff[0].courses = '[]';
  rejected('テスト中山優吾', 'noCapableStaff', { menu: 'テスト女性専用メニュー' });
  assert(!state.mailRelay.url && !state.mailRelay.secret);
  console.log(JSON.stringify({ ok: true, checks, scope: '登録名・表示名・空白・同名拒否・受付条件維持・拒否時の予約未作成', mail: '送信なし' }));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
