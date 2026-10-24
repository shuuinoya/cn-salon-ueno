'use strict';
// 設定・保有者・メニューの照合。書込みは送信無効の一時コピー内の架空データのみ。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), Module = require('node:module');
const assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '../public/pm-layout.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function ticketOwnerKey('), source.indexOf('  // 店舗情報：回数券管理')) + '\nglobalThis.check={ticketOwnerKey,ticketMatchesFilter,ticketPlanScopeLabel};', context);
const { ticketOwnerKey, ticketMatchesFilter: match, ticketPlanScopeLabel: scope } = context.check;
let passed = 0;
function check(fn) { fn(); passed++; }
const t = { id: 'ticket-a', plan_id: 'plan-a', plan_name: '購入時の名前', member_email: ' Owner@Example.test ', buyer_name: 'テスト 同姓同名', buyer_email: 'old@example.test', buyer_phone: '00011112222', status: '有効', menu_scope: ['course-a'], menu_names: ['テスト 整体60分'] };
check(() => assert.equal(ticketOwnerKey(t), ticketOwnerKey({ ...t, id: 'second', member_email: 'owner@example.test' })));
check(() => assert.notEqual(ticketOwnerKey(t), ticketOwnerKey({ ...t, member_email: 'other@example.test' })));
check(() => assert.notEqual(ticketOwnerKey({ id: 'a' }), ticketOwnerKey({ id: 'b' })));
for (const query of ['同姓同名', 'OWNER@EXAMPLE.TEST', '０００１１１１２２２２', '整体60分', '購入時の名前', 'ticket-a']) check(() => assert(match(t, { query })));
check(() => assert(!match(t, { query: '見つからないテスト' })));
check(() => assert(match(t, { plan: 'plan-a' })));
check(() => assert(!match({ ...t, plan_id: 'different-plan' }, { plan: 'plan-a' })));
check(() => assert(match(t, { plan: 'plan-a', menu: 'course-a', status: '有効', query: '同姓同名' })));
check(() => assert(!match(t, { status: '期限切れ' })));
check(() => assert(!match(t, { menu: 'course-b' })));
check(() => assert(match({ ...t, menu_scope: 'all' }, { menu: 'course-b' })));
check(() => assert(match({ ...t, plan_id: 'deleted-plan', status: '使い切り' }, { plan: 'deleted-plan', status: '使い切り' })));
check(() => assert.equal(scope({ menu_scope: 'all' }, []), 'すべてのメニュー'));
check(() => assert.equal(scope(t, [{ id: 'course-a', name: '変更後のメニュー名' }]), '変更後のメニュー名'));
check(() => assert.match(scope(t, []), /未登録メニュー/));
check(() => assert.match(scope({ menu_scope: [] }, []), /確認/));

// 保有券が販売設定より先に届いても、販売終了と誤表示しない。取得失敗も0人にしない。
const fields = new Map(), contextText = {}, contextButton = {}, holderButton = { dataset: { planId: 'plan-a' } };
context.wrap = {
  querySelector(selector) {
    if (!fields.has(selector)) fields.set(selector, { value: '', querySelector: key => key === 'span' ? contextText : contextButton });
    return fields.get(selector);
  },
  querySelectorAll: selector => selector === '.tk-holders' ? [holderButton] : [],
};
Object.assign(context, { plans: [], ownedTickets: [t], courses: [], selectedPlan: 'plan-a', ticketsLoaded: true, ticketsFailed: false, plansLoaded: false, plansFailed: false, esc: String });
vm.runInContext(source.slice(source.indexOf('    function filterTickets()'), source.indexOf("    wrap.querySelector('.pm-tk-search').addEventListener")) + source.slice(source.indexOf('    function refreshTicketFilters()'), source.indexOf('    function openPlanSettings(')), context);
context.refreshTicketFilters();
check(() => assert(!fields.get('.pm-tk-plan-filter').innerHTML.includes('販売終了')));
check(() => assert.equal(contextText.textContent, '回数券の設定を確認中'));
context.plansFailed = true; context.refreshTicketFilters();
check(() => assert.match(contextText.textContent, /読み込めません/));
check(() => assert(!fields.get('.pm-tk-plan-filter').innerHTML.includes('販売終了')));
context.plansLoaded = true; context.plansFailed = false; context.refreshTicketFilters();
check(() => assert(fields.get('.pm-tk-plan-filter').innerHTML.includes('販売終了')));
context.plans = [{ id: 'plan-a', name: '更新後の販売名' }]; context.refreshTicketFilters();
check(() => assert.equal(contextText.textContent, '更新後の販売名 のお客様'));
check(() => assert.equal(holderButton.textContent, '保有者を見る（1人）'));
context.ticketsLoaded = false; context.ticketsFailed = true; context.refreshTicketFilters();
check(() => assert.equal(fields.get('.pm-tk-count').textContent, '確認できません'));
check(() => assert.equal(holderButton.textContent, '保有者を確認できません'));
check(() => assert.equal(holderButton.disabled, true));

(async () => {
  const root = fs.realpathSync(process.argv[2]); assert(root.startsWith('/private/tmp/')); assert(!fs.existsSync(path.join(root, 'mail-config.json')));
  for (const key of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(key)) delete process.env[key];
  process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
  global.fetch = async () => { throw Error('外部通信は禁止'); };
  const decode = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json'), 'utf8'), decode);
  assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && snapshot.state.mails.length === 0);
  const persist = require(path.join(root, 'persist.js')); persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot }); persist.startSaver = () => {};
  const file = path.join(root, 'demo-api.js'), mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(root);
  mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.check={state,adminSessions};', file); await mod.exports.ready;
  const { state, adminSessions } = mod.exports.check;
  state.mailRelay = {}; state.mails = [];
  state.accounts.set('test-directory', { user: 'test-directory', role: 'manager', active: true });
  adminSessions.set('a'.repeat(64), { user: 'test-directory', created: Date.now() });
  const api = (url, body, auth = true) => new Promise(resolve => {
    const req = new EventEmitter(); Object.assign(req, { method: body ? 'POST' : 'GET', headers: { cookie: auth ? 'pm_session=' + 'a'.repeat(64) : '' }, socket: { remoteAddress: '127.0.0.1' } });
    const res = new EventEmitter(); let status; Object.assign(res, { writeHead(n) { status = n; this.statusCode = n; }, end(bytes) { this.emit('finish'); resolve({ status, body: bytes ? JSON.parse(bytes) : null }); } });
    assert(mod.exports.handleDemoApi(req, res, new URL(url, 'http://localhost'))); if (body) { req.emit('data', JSON.stringify(body)); req.emit('end'); }
  });
  const originalTickets = JSON.stringify([...state.tickets]);
  check(() => assert(state.ticketPlans.size > 0));
  const create = await api('/api/demo/ticket-plans', { action: 'add', name: 'テスト 照合用整体券', price: 30000, uses: 5, valid_months: 6, menu_scope: ['364323-4822701'] });
  check(() => assert.equal(create.status, 200));
  const id = create.body.plans.find(p => p.name === 'テスト 照合用整体券').id;
  async function compare() {
    const admin = await api('/api/demo/ticket-plans'), pub = await api('/api/tickets/plans', null, false);
    check(() => assert.deepEqual(pub.body.plans.map(p => p.id), admin.body.plans.filter(p => p.active === 1).map(p => p.id)));
    for (const p of pub.body.plans) {
      const a = admin.body.plans.find(a => a.id === p.id);
      for (const key of ['name', 'price', 'uses', 'valid_months', 'menu_scope']) check(() => assert.deepEqual(p[key], a[key]));
    }
    const plan = pub.body.plans.find(p => p.id === id);
    if (plan) { const courses = (await api('/api/demo/courses')).body.courses; check(() => assert.equal(scope(plan, courses), plan.menu_scope === 'all' ? 'すべてのメニュー' : plan.menu_names.join('・'))); }
  }
  await compare();
  // タイトルだけの保存で価格・回数・期限・適用メニュー・販売設定が変わらない。
  const beforeTitle = create.body.plans.find(p => p.id === id);
  const titleOnly = await api('/api/demo/ticket-plans', { action: 'update', id, name: 'テスト 全身整体60分 5回券' });
  check(() => assert.equal(titleOnly.status, 200));
  const afterTitle = titleOnly.body.plans.find(p => p.id === id);
  check(() => assert.equal(afterTitle.name, 'テスト 全身整体60分 5回券'));
  for (const key of Object.keys(beforeTitle).filter(key => key !== 'name')) check(() => assert.deepEqual(afterTitle[key], beforeTitle[key]));
  check(() => assert.equal(JSON.stringify([...state.tickets]), originalTickets));
  await compare();
  const emptyTitle = await api('/api/demo/ticket-plans', { action: 'update', id, name: '   ' });
  check(() => assert.equal(emptyTitle.status, 400));
  check(() => assert.equal(state.ticketPlans.get(id).name, afterTitle.name));
  // 各施術の券は作成時から選んだメニューだけに限定される。
  const availableCourses = (await api('/api/demo/courses')).body.courses;
  for (const pattern of [/全身整体/, /小顔/, /オイル/]) {
    const course = availableCourses.find(c => pattern.test(c.name));
    check(() => assert(course));
    const name = 'テスト ' + course.name.slice(0, 80) + ' 5回券';
    const added = await api('/api/demo/ticket-plans', { action: 'add', name, price: 20000, uses: 5, menu_scope: [course.id] });
    check(() => assert.equal(added.status, 200));
    const plan = added.body.plans.find(p => p.name === name);
    const publicPlan = (await api('/api/tickets/plans', null, false)).body.plans.find(p => p.id === plan.id);
    check(() => assert.equal(publicPlan.name, name));
    check(() => assert.deepEqual(publicPlan.menu_scope, [course.id]));
    check(() => assert.deepEqual(publicPlan.menu_names, [course.name]));
  }
  const edited = await api('/api/demo/ticket-plans', { action: 'update', id, name: 'テスト 改名済み券', price: 32000, uses: 6, valid_months: 9, menu_scope: 'all', show_banner: false });
  check(() => assert.equal(edited.status, 200)); await compare();
  check(() => assert.equal((edited.body.plans.find(p => p.id === id)).show_banner, false));
  check(() => assert.equal(JSON.stringify([...state.tickets]), originalTickets));
  const hidden = await api('/api/demo/ticket-plans', { action: 'update', id, active: false }); check(() => assert.equal(hidden.status, 200)); await compare();
  check(() => assert.equal(JSON.stringify([...state.tickets]), originalTickets));
  check(() => assert.equal(state.mails.length, 0));
  console.log(JSON.stringify({ passed, failed: 0, externalMail: false, persistentWrites: false }));
})().catch(e => { console.error(e); process.exitCode = 1; });
