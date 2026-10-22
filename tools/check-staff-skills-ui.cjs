'use strict';
// 原本79欄の管理UIを合成データで描画。販売対象25との同時保存・男女制限を確認する。
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/_next/static/chunks/AdminSchedule-pm2.js'), 'utf8');
const items = Array.from({ length: 79 }, (_, k) => ({ sourceId: String(1000 + k), name: 'テストメニュー ' + k, gender: k % 3 === 0 ? 'female' : k % 3 === 1 ? 'male' : 'none', courseId: k < 25 ? 'public-' + k : null }));
const catalog = { version: 'catalog-v1', groups: [{ id: 'g1', name: 'テストカテゴリ1', items: items.slice(0, 35) }, { id: 'g2', name: 'テストカテゴリ2', items: items.slice(35) }] };
const oldGroups = [{ titleKey: 'legacy', items: items.slice(0, 25).map(item => ({ id: item.courseId, name: { ja: (item.gender === 'none' ? '' : item.gender === 'male' ? '男性' : '女性') + item.name } })) }];
function setup(gender = 'male', saved = ['1001', '1002', '1050']) {
  const state = []; let index = 0, key = 0, saveResult = false; const sent = [];
  const node = (type, props, key) => ({ type, props: props || {}, key });
  const React = { useRef(init) { const at = index++; if (!(at in state)) state[at] = { current: init }; return state[at]; }, useState(init) { const at = index++; if (!(at in state)) state[at] = typeof init === 'function' ? init() : init; return [state[at], value => { state[at] = typeof value === 'function' ? value(state[at]) : value; }]; }, useEffect() {} };
  const profile = { nickname: 'テスト担当', message: 'テスト紹介', personalNomination: true, genderNomination: false, nominationFee: 0, sourceSkillChecks: saved };
  const staff = { id: 'a', name: 'テスト登録名', gender, courses: '["public-1","public-2"]', profile: JSON.stringify(profile), profile_revision: 3, active: 1, listing_order: 9, sort_order: 2 };
  const ctx = vm.createContext({ i: oldGroups, g: s => JSON.parse(s.profile || '{}'), m: () => ({}), h: 'テスト店舗', l: () => ({ t: x => x }), u: React, d: { jsx: node, jsxs: node, Fragment: 'fragment' }, ee: () => 'key-' + ++key, requestAnimationFrame: fn => fn(), window: { scrollTo() {} }, Date });
  vm.runInContext(source.slice(source.indexOf('function staffCourseAllowed('), source.indexOf('var re={staff:')), ctx);
  const props = { staff: [staff], busy: false, demo: true, onSave: async payload => { sent.push(payload); return saveResult; }, onEditingChange() {}, shiftDate: '2026-10-23', shifts: [], staffSkillCatalog: catalog };
  const render = () => { index = 0; return ctx.ne(props); };
  return { ctx, staff, props, render, sent, setResult: value => saveResult = value };
}
function nodes(tree) { const result = []; const visit = x => { if (Array.isArray(x)) x.forEach(visit); else if (x && typeof x === 'object' && 'props' in x) { result.push(x); visit(x.props.children); } }; visit(tree); return result; }
const one = (tree, test) => { const n = nodes(tree).find(test); assert.ok(n); return n; };
function open(x) { one(x.render(), n => n.type === 'button' && n.props.className === 'staff-name').props.onClick(); return x.render(); }
function skillTree(tree) { return one(tree, n => n.props.className === 'staff-course-groups'); }
function checkboxes(tree) { return nodes(skillTree(tree)).filter(n => n.type === 'input' && n.props.type === 'checkbox'); }
function individual(tree) { return nodes(skillTree(tree)).filter(n => n.type === 'label' && /^1\d{3}$/.test(n.key || '')).map(n => ({ id: n.key, box: nodes(n).find(x => x.type === 'input') })); }
function form(tree) { return one(tree, n => n.type === 'form' && nodes(n).some(x => x.props.className === 'staff-course-groups')); }
let passed = 0, failed = [];
async function test(name, fn) { try { await fn(); passed++; } catch (error) { failed.push({ name, error: error.stack }); } }
(async () => {
  await test('全て→2カテゴリ→79個別欄を既存フォームに描画', () => { const x = setup(), tree = open(x); assert.equal(checkboxes(tree).length, 82); assert.equal(individual(tree).length, 79); assert.equal(nodes(skillTree(tree)).filter(n => n.type === 'fieldset').length, 3); });
  await test('管理用79欄でも販売25データを変更しない', () => { const x = setup(); open(x); assert.equal(oldGroups[0].items.length, 25); assert.equal(items.filter(x => x.courseId).length, 25); });
  for (const gender of ['male', 'female', 'none']) await test('性別に合わないチェック欄を無効化 ' + gender, () => { const x = setup(gender), rows = individual(open(x)); for (const row of rows) { const item = items.find(i => i.sourceId === row.id), allowed = item.gender === 'none' || item.gender === gender; assert.equal(row.box.props.disabled, !allowed); if (!allowed) assert.equal(row.box.props.checked, false); } });
  await test('明示チェックなしを全対応に読み替えない', () => { const x = setup('male', []); assert.equal(individual(open(x)).filter(x => x.box.props.checked).length, 0); });
  await test('原本の有効チェックだけを読み、元の未補正チェックは表示しない', () => { const x = setup('male', ['1001', '1002']); const pr = JSON.parse(x.staff.profile); pr.sourceSkillOriginalChecks = ['1004']; x.staff.profile = JSON.stringify(pr); const selected = individual(open(x)).filter(x => x.box.props.checked).map(x => x.id); assert.deepEqual(selected, ['1001', '1002']); });
  await test('全てで現在79欄の性別適合分だけ選択', () => { const x = setup(), tree = open(x); checkboxes(tree)[0].props.onChange({ target: { checked: true } }); const rows = individual(x.render()); assert.equal(rows.filter(x => x.box.props.checked).length, items.filter(x => x.gender !== 'female').length); });
  await test('カテゴリ操作は別カテゴリのチェックを変更しない', () => { const x = setup('male', ['1040']), tree = open(x); checkboxes(tree)[1].props.onChange({ target: { checked: true } }); const rows = individual(x.render()); assert.equal(rows.find(x => x.id === '1040').box.props.checked, true); assert.equal(rows.find(x => x.id === '1041').box.props.checked, false); assert.equal(rows.find(x => x.id === '1001').box.props.checked, true); });
  await test('79の選択と25への変換を同じ保存要求に含める', async () => { const x = setup('male', ['1001', '1002', '1040']); await form(open(x)).props.onSubmit({ preventDefault() {} }); const out = x.sent[0]; assert.equal(JSON.stringify(out.sourceSkillChecks), JSON.stringify(['1001', '1002', '1040'])); assert.equal(JSON.stringify(out.courses), JSON.stringify(['public-1', 'public-2'])); assert.equal(out.allCourses, false); assert.equal(out.staffSkillCatalogVersion, 'catalog-v1'); assert.equal(out.staffRevision, 3); });
  await test('同じ内容の再送は同じrequestKey、チェック編集後は別キー', async () => { const x = setup('male', ['1001', '1002']); let tree = open(x); await form(tree).props.onSubmit({ preventDefault() {} }); await form(x.render()).props.onSubmit({ preventDefault() {} }); assert.equal(x.sent[0].requestKey, x.sent[1].requestKey); tree = x.render(); individual(tree).find(x => x.id === '1004').box.props.onChange({ target: { checked: true } }); await form(x.render()).props.onSubmit({ preventDefault() {} }); assert.notEqual(x.sent[1].requestKey, x.sent[2].requestKey); });
  await test('再描画前の連続送信でも保存を二重に開始しない', async () => { const x = setup('male', ['1001']); let release; x.setResult(new Promise(r => release = r)); const submit = form(open(x)).props.onSubmit, first = submit({ preventDefault() {} }); await submit({ preventDefault() {} }); assert.equal(x.sent.length, 1); release(false); await first; await submit({ preventDefault() {} }); assert.equal(x.sent.length, 2); assert.equal(x.sent[0].requestKey, x.sent[1].requestKey); });
  await test('販売対象なしでcourses=[]の全対応設定を送らない', async () => { const x = setup('male', ['1040']); await form(open(x)).props.onSubmit({ preventDefault() {} }); assert.equal(x.sent.length, 0); assert.ok(nodes(x.render()).some(n => n.props.role === 'alert' && String(n.props.children).includes('販売メニュー'))); });
  await test('新規登録は未選択から開始', () => { const x = setup(); one(x.render(), n => n.type === 'button' && n.props.children === '新規作成').props.onClick(); const rows = individual(x.render()); assert.equal(rows.length, 79); assert.equal(rows.filter(x => x.box.props.checked).length, 0); });
  await test('未同期の環境は既存25コース編集を維持', () => { const x = setup(); x.props.staffSkillCatalog = null; const tree = open(x); assert.equal(checkboxes(tree).length, 27); });
  await test('編集中のカタログ版は保存時まで固定', async () => { const x = setup('male', ['1001']); open(x); x.props.staffSkillCatalog = { ...catalog, version: 'catalog-v2' }; await form(x.render()).props.onSubmit({ preventDefault() {} }); assert.equal(x.sent[0].staffSkillCatalogVersion, 'catalog-v1'); });
  console.log(JSON.stringify({ passed, failed }, null, 2)); if (failed.length) process.exitCode = 1;
})();
