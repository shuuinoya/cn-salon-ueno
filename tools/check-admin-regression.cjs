'use strict';
// npm run check:admin -- <送信無効・顧客情報を伏せた本番コピーのフォルダ>
// 本番へ接続せず、検証用コピー内の合成データと画面処理を検査する。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '..');
assert(process.argv[2], '送信無効の検証コピーを指定してください');
const copy = fs.realpathSync(process.argv[2]);
assert.notEqual(copy, fs.realpathSync(source), '作業フォルダではなく検証コピーを使ってください');
assert(!fs.existsSync(path.join(copy, 'mail-config.json')));
const snapshot = JSON.parse(fs.readFileSync(path.join(copy, 'safe-state.json'), 'utf8'));
assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && snapshot.state.mails.length === 0);
for (const file of ['demo-api.js', 'persist.js', 'staff-skills.js', 'staff-ordering.js', 'ledger-operations.js']) {
  assert(fs.readFileSync(path.join(copy, file)).equals(fs.readFileSync(path.join(source, file))), file + ' の検証コピーが古くなっています');
}
const suites = [
  ['check-staff-blocks.cjs', copy], ['check-ledger-operations.cjs', copy],
  ['check-schedule-recovery.cjs'], ['check-block-ui.cjs'], ['check-lock-control.cjs'],
  ['check-admin-interactions.cjs'], ['check-booking-ui-risks.cjs'], ['check-ledger-operations-ui.cjs'],
  ['check-booking-details-ui.cjs'], ['check-popup-behavior.cjs'], ['check-booking-form.cjs'],
  ['check-staff-picker-selection.cjs'], ['check-staff-skills-ui.cjs'],
  ['check-staff-ordering-ui.cjs'], ['check-staff-ordering-drag.cjs'],
];
const failures = [];
for (const [file, ...args] of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { cwd: source, encoding: 'utf8', timeout: 60000 });
  process.stdout.write(file + '\n' + (r.stdout || '') + (r.stderr || ''));
  if (r.status !== 0) failures.push({ file, error: r.error?.message || '検査に失敗' });
}
console.log(JSON.stringify({ suites: suites.length, passed: suites.length - failures.length, failures }));
process.exitCode = failures.length ? 1 : 0;
