'use strict';
// 送信無効の本番コピーだけで、ID変更と指定端末からの通常ログインを確認する。
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), crypto = require('node:crypto'), { EventEmitter } = require('node:events');
const root = path.resolve(process.argv[2] || '');
assert(process.argv[2] && fs.existsSync(path.join(root, 'safe-state.json')));
assert(!fs.existsSync(path.join(root, 'mail-config.json')));
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_|BOOKING_MAIL_TO)/.test(k)) delete process.env[k];
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
Object.assign(process.env, { DEMO_EPHEMERAL: '1', CLOUD: '0', HP_MAIL: '0', TRUST_PROXY: 'tailscale',
  ADMIN_LOGIN_ID: 'test-new-owner', ADMIN_LOGIN_PREVIOUS_ID: 'test-old-owner', ADMIN_PASS_HASH: hash('test-new-password'),
  ADMIN_OWNER_USER: 'test-new-owner', ADMIN_OWNER_MODE: 'device-password', ADMIN_OWNER_TAILSCALE_LOGIN: 'test-owner@github',
  ADMIN_OWNER_DEVICE_IPS: '100.64.1.2,100.64.1.3,fd7a:115c:a1e0::1234' });
const noNetwork = () => { throw Error('検証中の外部通信は禁止'); };
global.fetch = noNetwork;
for (const name of ['node:net', 'node:tls']) require(name).connect = noNetwork;
for (const name of ['node:http', 'node:https']) { require(name).request = noNetwork; require(name).get = noNetwork; }
const revive = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
const base = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json')), revive);
assert(!base.state.mailRelay?.url && !base.state.mailRelay?.secret && !base.state.mails.length);
const persist = require(path.join(root, 'persist.js'));
persist.startSaver = () => {}; persist.requestSave = () => {};
const file = path.join(root, 'demo-api.js');
const code = fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,adminSessions};';
async function load(snapshot) {
  persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot });
  const mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(root);
  mod._compile(code, file); await mod.exports.ready; return mod.exports;
}
function fixture() {
  const s = structuredClone(base);
  s.state.accounts = new Map([['test-old-owner', { user: 'test-old-owner', name: 'テスト管理者', role: 'admin', active: true,
    pass: hash('test-old-password'), createdAt: 123 }]]);
  s.state.loginFails = new Map([['test-new-owner', { n: 10, until: Date.now() + 60000 }]]);
  s.sessions = [['aaaa', { user: 'test-old-owner', created: Date.now() }]];
  return s;
}
const request = (ip = '100.64.1.2', cookie = '') => ({ headers: { cookie, host: 'localhost',
  'x-forwarded-for': ip, 'tailscale-user-login': 'test-owner@github' }, socket: { remoteAddress: '127.0.0.1' }, clientIp: ip });
function api(app, method, route, body, options = {}) {
  return new Promise((resolve, reject) => {
    const req = Object.assign(new EventEmitter(), request(options.ip, options.cookie), { method, destroy() { reject(Error('destroyed')); } });
    options.change?.(req);
    const res = new EventEmitter(); let status = 200, headers = {};
    res.setHeader = (k, v) => headers[k] = v;
    res.writeHead = (s, h) => { status = s; Object.assign(headers, h || {}); };
    res.end = data => { let json; try { json = JSON.parse(data); } catch { json = data; } res.emit('finish'); resolve({ status, headers, json }); };
    assert(app.handleDemoApi(req, res, new URL(route, 'http://localhost')));
    if (body) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end');
  });
}
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('OK ' + name); }
async function main() {
  const initial = fixture(), app = await load(initial), a = app.audit;
  const auth = require(path.join(root, 'admin-owner-auth.js'));
  const login = (target = app, ip = '100.64.1.2') => api(target, 'POST', '/api/demo/login', { user: 'test-new-owner', pass: 'test-new-password' }, { ip });
  const cookieOf = r => r.headers['Set-Cookie'].split(';')[0];
  let cookie;
  await check('本人のIDだけ変更し、古いログインと試行制限を解除', () => {
    assert.equal(a.state.accounts.size, 1); assert(!a.state.accounts.has('test-old-owner'));
    assert.equal(a.state.accounts.get('test-new-owner').createdAt, 123);
    assert.equal(a.state.accounts.get('test-new-owner').pass, hash('test-new-password'));
    assert.equal(a.adminSessions.size, 0); assert(!a.state.loginFails.has('test-new-owner'));
    for (const k of ['staff', 'shifts', 'events', 'members', 'tickets']) if (initial.state[k]) assert.deepEqual(a.state[k], initial.state[k]);
  });
  await check('以前のID・パスワード・ログイン状態は使用不可', async () => {
    assert.equal((await api(app, 'POST', '/api/demo/login', { user: 'test-old-owner', pass: 'test-old-password' })).status, 401);
    assert.equal((await api(app, 'POST', '/api/demo/login', { user: 'test-new-owner', pass: 'test-old-password' })).status, 401);
    assert.equal((await api(app, 'GET', '/api/demo/accounts', null, { cookie: 'pm_session=aaaa' })).status, 401);
  });
  await check('登録MacBookは確認メールを送らずIDとパスワードでログイン', async () => {
    const r = await login(); assert.equal(r.status, 200); assert(r.json.ok); assert(!r.json.needsOwnerCode); cookie = cookieOf(r);
    assert.equal((await api(app, 'GET', '/api/demo/accounts', null, { cookie })).status, 200);
    assert.equal(a.state.mails.length, 0);
  });
  await check('登録スマホも通常ログイン、別端末のログイン状態は流用不可', async () => {
    assert.equal((await api(app, 'GET', '/api/demo/accounts', null, { cookie, ip: '100.64.1.3' })).status, 401);
    const r = await login(app, '100.64.1.3'); assert.equal(r.status, 200); assert(!r.json.needsOwnerCode);
    assert.equal((await api(app, 'GET', '/api/demo/accounts', null, { cookie: cookieOf(r), ip: '100.64.1.3' })).status, 200);
    assert.equal((await login(app, 'fd7a:115c:a1e0::1234')).status, 200);
  });
  await check('同じ所有者の別Mac・公開回線・偽装情報・未登録端末を拒否', async () => {
    const changes = [r => { r.clientIp = '100.64.1.4'; r.headers['x-forwarded-for'] = '100.64.1.4'; },
      r => r.headers['x-forwarded-for'] = '100.64.1.2,100.64.1.4', r => r.headers['tailscale-user-login'] = 'other@github',
      r => r.headers['tailscale-funnel-request'] = '1', r => r.headers['tailscale-funnel-request'] = '',
      r => delete r.headers['tailscale-user-login'], r => delete r.headers['x-forwarded-for'], r => r.socket.remoteAddress = '192.168.1.2'];
    for (const change of changes) {
      assert.equal((await api(app, 'GET', '/api/demo/accounts', null, { cookie, change })).status, 403);
      assert.equal((await api(app, 'POST', '/api/demo/login', { user: 'test-new-owner', pass: 'test-new-password' }, { change })).status, 403);
    }
  });
  await check('端末設定の欠落・不正は開放せず拒否', () => {
    for (const diff of [{ ADMIN_OWNER_DEVICE_IPS: '' }, { ADMIN_OWNER_DEVICE_IPS: '100.64.1.2,wrong' },
      { ADMIN_OWNER_MODE: 'unknown' }, { ADMIN_OWNER_TAILSCALE_LOGIN: '' }]) assert(!auth.networkAllowed(request(), { ...process.env, ...diff }));
  });
  await check('端末限定のログインでは確認番号の発行・再利用をしない', async () => {
    const ch = new auth.OwnerChallenges();
    await assert.rejects(ch.issue(request(), a.state.accounts.get('test-new-owner'), noNetwork));
    assert.equal((await api(app, 'POST', '/api/demo/owner-verify', { code: '123456' })).status, 401);
  });
  await check('再起動しても旧IDに戻らず、新IDと保存済みログインだけ有効', async () => {
    const restarted = await load(structuredClone({ state: a.state, sessions: [...a.adminSessions] }));
    assert.equal(restarted.audit.state.accounts.size, 1); assert(!restarted.audit.state.accounts.has('test-old-owner'));
    assert.equal((await login(restarted)).status, 200);
    assert.equal((await api(restarted, 'GET', '/api/demo/accounts', null, { cookie })).status, 200);
  });
  await check('パスワードの再変更では既存ログインを無効化', async () => {
    process.env.ADMIN_PASS_HASH = hash('test-next-password');
    const restarted = await load(structuredClone({ state: a.state, sessions: [...a.adminSessions] }));
    assert.equal(restarted.audit.adminSessions.size, 0); assert.equal((await login(restarted)).status, 401);
    process.env.ADMIN_PASS_HASH = hash('test-new-password');
  });
  await check('日本時間の開始直前は共通ログイン、開始時刻から2端末だけ・旧ログイン無効', async () => {
    const realNow = Date.now;
    const begins = Date.parse('2026-11-13T00:00:00+09:00');
    let now = begins - 1;
    Date.now = () => now;
    process.env.ADMIN_OWNER_START_AT = '2026-11-13T00:00:00+09:00';
    const outside = r => { r.headers['tailscale-funnel-request'] = '1'; delete r.headers['tailscale-user-login']; };
    try {
      assert(!auth.config().enabled);
      const r = await api(app, 'POST', '/api/demo/login', { user: 'test-new-owner', pass: 'test-new-password' }, { ip: '203.0.113.9', change: outside });
      assert.equal(r.status, 200); assert(r.json.ok && !r.json.needsOwnerCode);
      const sharedCookie = cookieOf(r);
      assert.equal((await api(app, 'GET', '/api/demo/accounts', null, { cookie: sharedCookie, ip: '203.0.113.9', change: outside })).status, 200);
      now = begins;
      assert(auth.config().enabled);
      assert.equal((await api(app, 'GET', '/api/demo/accounts', null, { cookie: sharedCookie, ip: '203.0.113.9', change: outside })).status, 403);
      assert.equal((await api(app, 'GET', '/api/demo/accounts', null, { cookie: sharedCookie })).status, 401);
      for (const ip of ['100.64.1.2', '100.64.1.3']) {
        const own = await login(app, ip); assert.equal(own.status, 200); assert(!own.json.needsOwnerCode);
        assert.equal((await api(app, 'GET', '/api/demo/accounts', null, { cookie: cookieOf(own), ip })).status, 200);
      }
      assert.equal((await login(app, '100.64.1.4')).status, 403);
      assert.equal((await api(app, 'GET', '/api/demo/settings', null, { ip: '203.0.113.9', change: outside })).status, 200);
      now = begins + 86400000;
      assert(auth.config().enabled); assert.equal((await login(app, '100.64.1.4')).status, 403);
      for (const invalid of ['invalid', '2026-11-13T00:00:00']) {
        assert(!auth.networkAllowed(request(), { ...process.env, ADMIN_OWNER_START_AT: invalid }));
      }
      now = begins - 1;
      assert(!auth.networkAllowed(request(), { ...process.env, ADMIN_OWNER_DEVICE_IPS: '' }));
    } finally { Date.now = realNow; delete process.env.ADMIN_OWNER_START_AT; }
  });
  await check('ID重複・対象不明・管理者以外は上書きせず停止', async () => {
    const conflict = fixture(); conflict.state.accounts.set('test-new-owner', { user: 'test-new-owner', role: 'staff' });
    await assert.rejects(load(conflict), /使用済み/); assert.equal(conflict.state.accounts.size, 2);
    const missing = fixture(); missing.state.accounts.clear(); await assert.rejects(load(missing), /見つかりません/);
    const wrongRole = fixture(); wrongRole.state.accounts.get('test-old-owner').role = 'staff'; await assert.rejects(load(wrongRole), /一致しない/);
  });
  console.log(`${checks}項目通過（外部送信なし）`);
}
main().then(() => process.exit(0), e => { console.error(e.stack); process.exit(1); });
