"use strict";
// メール設定のない独立したコピーで実行。回数券の表示と案内設定を実APIで確認する。
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), vm = require("node:vm"), { EventEmitter } = require("node:events");
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, "..");
assert.equal(fs.existsSync(path.join(root, "mail-config.json")), false, "メール設定のない検証用コピーが必要です");
process.env.DEMO_EPHEMERAL = "1";
process.env.HP_MAIL = "0";
for (const key of Object.keys(process.env)) if (/^(MAIL_|GH_)/.test(key)) delete process.env[key];
const m = new Module(path.join(root, "demo-api.js"));
m.filename = path.join(root, "demo-api.js"); m.paths = Module._nodeModulePaths(root);
m._compile(fs.readFileSync(m.filename, "utf8") + "\nmodule.exports.checks={state,adminSessions,ticketPublicJson,ticketSettingsJson};", m.filename);
(async () => {
  await m.exports.ready;
  const { state, adminSessions, ticketPublicJson, ticketSettingsJson } = m.exports.checks;
  state.mailRelay = { url: "", secret: "" }; state.mails = [];
  state.accounts.set("ticket-test", { user: "ticket-test", role: "manager", active: true });
  state.accounts.set("ticket-staff-test", { user: "ticket-staff-test", role: "staff", active: true });
  adminSessions.set("ab".repeat(32), { user: "ticket-test", created: Date.now() });
  adminSessions.set("cd".repeat(32), { user: "ticket-staff-test", created: Date.now() });
  const api = (url, body, cookie = "pm_session=" + "ab".repeat(32)) => new Promise((resolve) => {
    const req = new EventEmitter();
    Object.assign(req, { method: body ? "POST" : "GET", headers: { cookie }, socket: { remoteAddress: "127.0.0.1" } });
    let status;
    const res = new EventEmitter();
    Object.assign(res, { writeHead(n) { status = n; this.statusCode = n; }, end(data) { this.emit("finish"); resolve({ status, json: data ? JSON.parse(data) : null }); } });
    assert.equal(m.exports.handleDemoApi(req, res, new URL(url, "http://localhost")), true);
    if (body) { req.emit("data", JSON.stringify(body)); req.emit("end"); }
  });
  const originalPlans = JSON.stringify([...state.ticketPlans]);
  const defaults = ticketSettingsJson();
  assert.deepEqual([defaults.monthlyOffer.enabled, defaults.monthlyOffer.startDay, defaults.monthlyOffer.endDay], [true, 8, 14]);
  const ticket = { id: "test-ticket", plan_id: "test-plan", plan_name: "テスト 整体5回券", purchased_at: "2026-10-02T16:00:00.000Z",
    menu_scope: ["364323-4822701"], uses_total: 5, uses_left: 4, expires_at: Date.now() + 86400000 * 365, history: [] };
  const publicTicket = ticketPublicJson(ticket);
  assert.equal(publicTicket.purchased_at, ticket.purchased_at);
  assert.equal(publicTicket.plan_name, ticket.plan_name);
  assert.deepEqual(publicTicket.menu_scope, ticket.menu_scope);
  assert.ok(publicTicket.menu_names[0].includes("全身整体"));
  state.tickets.set(ticket.id, ticket);
  const keptTicket = JSON.stringify(ticket);
  const langs = ["ja", "en", "zh", "ko", "fr", "es", "it", "de"];
  const configured = { enabled: true, startDay: 9, endDay: 15, details: Object.fromEntries(langs.map((lang) => [lang, "test " + lang])) };
  const saved = await api("/api/demo/ticket-plans", { action: "settings", monthlyOffer: configured });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.settings.monthlyOffer, configured);
  assert.deepEqual((await api("/api/tickets/plans")).json.settings.monthlyOffer, configured);
  assert.equal(JSON.stringify([...state.ticketPlans]), originalPlans, "案内だけでは価格や販売設定は変えない");
  assert.equal(JSON.stringify(ticket), keptTicket, "購入済みの券・残数は変えない");
  assert.deepEqual(ticketSettingsJson().remindDays, defaults.remindDays, "リマインド設定を保持");
  for (const patch of [
    { startDay: 0 }, { endDay: 32 }, { startDay: 20, endDay: 10 }, { startDay: 8.5 },
    { enabled: "false" }, { details: { ja: "日本語だけ" } }, { details: Object.fromEntries(langs.map(l => [l, "a".repeat(401)])) },
  ]) {
    assert.equal((await api("/api/demo/ticket-plans", { action: "settings", monthlyOffer: { ...configured, ...patch } })).status, 400);
    assert.deepEqual(ticketSettingsJson().monthlyOffer, configured, "不正な入力では既存設定を変えない");
  }
  assert.equal((await api("/api/demo/ticket-plans", { action: "settings", monthlyOffer: configured }, "pm_session=" + "cd".repeat(32))).status, 403);
  state.members.set("test@example.test", { email: "test@example.test", name: "テスト 会員", bookings: [], tickets: [ticket.id] });
  state.memberSessions.set("ef".repeat(32), { email: "test@example.test", created: Date.now() });
  const own = await api("/api/member/me", null, "cn_member=" + "ef".repeat(32));
  assert.equal(own.status, 200);
  assert.deepEqual(own.json.ticketSettings.monthlyOffer, configured);
  assert.deepEqual(own.json.tickets[0].menu_names, publicTicket.menu_names);
  assert.deepEqual((await api("/api/member/me", null, "")).json, { member: null });

  // 実際に配信する辞書と共通描画を使って、日本時間・8言語・文字の安全な表示を確認する。
  const context = vm.createContext({
    window: { addEventListener() {}, dispatchEvent() {} }, localStorage: { getItem() { return null; }, setItem() {} },
    document: { documentElement: { lang: "ja" }, addEventListener() {} }, setInterval() {}, Event: class {},
  });
  vm.runInContext(fs.readFileSync(path.join(root, "public/cn-i18n.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "public/ticket-display.js"), "utf8"), context);
  const display = context.window.CNTickets, i18n = context.window.CNI18N;
  assert.match(display.summary(publicTicket), /10月3日/);
  assert.match(display.summary(publicTicket), /全身整体/);
  assert.match(display.summary({ ...publicTicket, kind: "revival" }), /復活した日/);
  assert.match(display.summary({ ...publicTicket, purchased_at: null }), /記録なし/);
  assert.match(display.summary({ ...publicTicket, purchased_at: "bad date" }), /記録なし/);
  assert.match(display.summary({ ...publicTicket, plan_name: '<img src=x onerror="alert(1)">' }), /&lt;img/);
  assert.equal(display.offer({}), "");
  for (const lang of langs) {
    i18n.use(lang);
    i18n.missing.clear();
    const text = display.summary({ ...publicTicket, plan_name: "回数券 5回券" }) + display.offer({ monthlyOffer: configured });
    assert.ok(text.includes("test " + lang));
    assert.ok(text.includes("9") && text.includes("15"));
    if (lang !== "ja") assert.ok(!/対象メニュー|購入日|毎月|限定料金でご案内/.test(text));
  }
  assert.equal(i18n.missing.size, 0);
  assert.equal(display.offer({ monthlyOffer: { ...configured, enabled: false } }), "");
  assert.equal(state.mails.length, 0, "案内設定・閲覧はメールを発生させない");
  console.log("PASS: ticket purchase date, menu scope, JST, revival labels, safe missing dates, eight languages, settings validation, permissions, read API, unchanged prices/balances/reminders, no mail");
})().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
