'use strict';
// 保存形式・変更検出・保存失敗時の再試行を独立フォルダで検査。外部送信なし。
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const vm = require('node:vm'), assert = require('node:assert/strict'), { performance } = require('node:perf_hooks');
const source = fs.readFileSync(path.join(__dirname, '..', 'persist.js'), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-save-speed-'));
let writes = 0, failRename = false;
const timers = [], signals = new Map();
const sandbox = {
  require: name => name === 'fs' ? { ...fs,
    writeSync(...args) { writes++; return fs.writeSync(...args); },
    renameSync(...args) { if (failRename) { failRename = false; throw Error('synthetic disk error'); } return fs.renameSync(...args); },
  } : require(name),
  module: { exports: {} }, __dirname: dir, Buffer, Map, Set,
  console: { log() {} },
  process: { env: { DEMO_PERSIST: '1', DEMO_DATA: path.join(dir, 'state.json') }, on: (name, fn) => signals.set(name, fn) },
  setInterval(fn, ms) { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
  setTimeout(fn, ms) { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
  fetch() { throw Error('external network forbidden'); },
};
vm.runInNewContext(source + '\nmodule.exports.audit={createSnapshotComparison,replacer,reviver};', sandbox);
const api = sandbox.module.exports, a = api.audit;
const encode = x => JSON.stringify(x, a.replacer);
const results = [];
function check(name, fn) { fn(); results.push(name); }
try {
  check('同じ写真・ネストしたMap/Setは同じ比較結果', () => {
    const compare = a.createSnapshotComparison();
    const value = { photos: new Map([['a', 'x'.repeat(20000)]]), nested: { set: new Set(['a', 'b']) } };
    const copy = JSON.parse(encode(value), a.reviver);
    assert.equal(compare(value), compare(copy));
    copy.nested.set.add('c'); assert.notEqual(compare(value), compare(copy));
  });
  check('予約・シフト・写真・復旧用写真の直接変更を検出', () => {
    const compare = a.createSnapshotComparison();
    const value = { photos: new Map([['a', 'x'.repeat(20000)]]), before: { photos: [['a', 'y'.repeat(20000)]] }, bookings: [{ time: 1 }], shifts: new Map([['a', { time: 1 }]]) };
    for (const edit of [() => value.bookings[0].time++, () => value.shifts.get('a').time++,
      () => value.photos.set('a', 'z'.repeat(20000)), () => value.before.photos[0][1] = 'q'.repeat(20000),
      () => value.photos.delete('a'), () => value.before.photos.length = 0]) {
      const old = compare(value); edit(); assert.notEqual(compare(value), old);
    }
  });
  check('比較用の印と同じ文字を入力しても混同しない', () => {
    const compare = a.createSnapshotComparison();
    const large = 'a'.repeat(20000), token = JSON.parse(compare({ text: large })).text;
    assert.notEqual(compare({ text: large }), compare({ text: token }));
    assert.notEqual(compare({ text: token }), compare({ text: '\u0000cn-snapshot:literal:' + token }));
  });
  check('Unicode・単独サロゲート・キャッシュ破棄後も比較は正確', () => {
    const compare = a.createSnapshotComparison({ minLength: 2, maxChars: 8 });
    const values = ['\ud800\ud800', '\ud801\ud801', '😀😀', 'あいうえお', 'z'.repeat(100)];
    const original = values.map(text => compare({ text }));
    assert.equal(new Set(original).size, values.length);
    assert.deepEqual(values.map(text => compare({ text })), original);
  });
  check('削除・null・空文字・配列の順番・Mapの順番を区別', () => {
    const compare = a.createSnapshotComparison();
    const values = [{}, { a: null }, { a: '' }, { a: [] }, { a: [1, 2] }, { a: [2, 1] },
      { a: new Map([['x', 1], ['y', 2]]) }, { a: new Map([['y', 2], ['x', 1]]) }];
    assert.equal(new Set(values.map(compare)).size, values.length);
    assert.equal(compare({ a: undefined }), compare({}));
  });
  let snapshot = { savedAt: 1, state: { bookings: [{ name: 'テスト保存', time: 1 }], photos: new Map([['a', 'x'.repeat(20000)]]), mails: [] }, sessions: [] };
  const save = api.startSaver(() => snapshot), file = path.join(dir, 'state.json');
  const matches = () => assert.equal(fs.readFileSync(file, 'utf8'), encode(snapshot));
  check('従来と同じJSON形式で全内容を保存', () => { assert(save()); matches(); assert.equal(fs.statSync(file).mode & 0o777, 0o600); });
  check('変更なし・保存時刻だけの更新で再書込しない', () => {
    const before = writes; snapshot.savedAt++; for (let n = 0; n < 10; n++) assert(save()); assert.equal(writes, before);
  });
  check('小さな予約変更でも写真を含む全内容を保存', () => {
    snapshot.state.bookings[0].time++; assert(save()); matches();
    snapshot.state.photos.set('a', 'y'.repeat(20000)); assert(save()); matches();
  });
  check('保存失敗で変更済みと誤記録せず、次回に再試行', () => {
    const old = fs.readFileSync(file, 'utf8'); snapshot.state.bookings[0].time++; failRename = true;
    assert.equal(save(), false); assert.equal(fs.readFileSync(file, 'utf8'), old);
    assert(save()); matches();
  });
  check('循環データの失敗で元の保存を壊さず復旧できる', () => {
    const old = fs.readFileSync(file, 'utf8'); snapshot.state.loop = snapshot.state;
    assert.equal(save(), false); assert.equal(fs.readFileSync(file, 'utf8'), old);
    delete snapshot.state.loop; snapshot.state.mails.push({ status: 'pending' }); assert(save()); matches();
  });
  check('1秒の確認・即時保存・終了時保存を維持', () => {
    snapshot.state.mails[0].status = 'sent'; timers.find(t => t.ms === 1000).fn(); matches();
    snapshot.state.bookings[0].time++; assert(api.flushNow()); matches();
    snapshot.state.bookings[0].time++; signals.get('exit')(); matches();
    snapshot.state.bookings[0].time++; api.requestSave(); timers.find(t => t.ms === 60).fn(); matches();
  });
  let benchmark;
  if (process.argv[2]) {
    const snap = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'), a.reviver);
    assert(!snap.state.mailRelay?.url && !snap.state.mailRelay?.secret && snap.state.mails.length === 0, '送信無効のコピーが必要です');
    const { savedAt, ...body } = snap, compare = a.createSnapshotComparison();
    compare(body);
    const measure = fn => { const t = performance.now(); fn(); return +(performance.now() - t).toFixed(2); };
    const old = [], optimized = [];
    for (let n = 0; n < 4; n++) { old.push(measure(() => encode(body))); optimized.push(measure(() => compare(body))); }
    benchmark = { bytes: Buffer.byteLength(encode(body)), oldMs: old, optimizedMs: optimized };
  }
  console.log(JSON.stringify({ ok: true, checks: results.length, results, benchmark, externalNetwork: false, productionWrites: false }, null, 2));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
