#!/usr/bin/env node
"use strict";

// 送信を無効にした検証コピーだけを対象にする。接続先は変更できない。
// 実行: node tools/check-booking-http-risks.cjs <コピーのフォルダ> YYYY-MM-DD
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const BASE = new URL("http://127.0.0.1:5568");
const runId = Date.now() + "-" + crypto.randomBytes(3).toString("hex");
const output = "/private/tmp/cnsalon-http-risks-" + runId + ".json";
const report = { target: BASE.origin, date: process.argv[3], cases: [], created: [], passed: false };
let cookie = "";

function save() { fs.writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 }); }
function record(name) { report.cases.push({ name, passed: true }); save(); }
function request(route, body, authenticated = false) {
  const url = new URL(route, BASE);
  assert.equal(url.origin, "http://127.0.0.1:5568", "検証専用の接続先以外は禁止です");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5568");
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { Accept: "application/json", Origin: BASE.origin };
  if (authenticated) headers.Cookie = cookie;
  if (data) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = data.length; }
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: data ? "POST" : "GET", headers, timeout: 15000 }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")), cookies: res.headers["set-cookie"] || [] }); }
        catch { reject(new Error("検証用サーバーがJSON以外を返しました")); }
      });
    });
    req.on("error", e => reject(new Error("検証用サーバーへの接続に失敗しました: " + (/^[A-Z_]+$/.test(e.code || "") ? e.code : "network"))));
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (data) req.write(data);
    req.end();
  });
}
function safeFailure(response, expected, label) {
  assert.equal(response.status, 409, label + ": 状態コード");
  assert.equal(response.body.error, expected, label + ": 拒否理由");
  assert(!Object.hasOwn(response.body, "token") && !Object.hasOwn(response.body, "id"), label + ": 予約情報の漏れ");
}

(async () => {
  const root = path.resolve(process.argv[2] || "");
  assert(root.startsWith("/private/tmp/"), "独立した検証コピーだけを指定してください");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(report.date || ""), "検証日を指定してください");
  assert(report.date >= "2026-10-23", "画面検査と重ならない日付を指定してください");
  assert(!fs.existsSync(path.join(root, "mail-config.json")), "送信設定が残っています");
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, "safe-state.json"), "utf8"));
  assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret, "メール連携が有効です");
  assert.equal(snapshot.state.mails.length, 0, "送信待ちが残っています");
  assert(fs.readFileSync(path.join(root, "copy-api.cjs"), "utf8").includes("DEMO_EPHEMERAL"), "検証コピーではありません");
  save();
  report.stage = "login";
  const login = await request("/api/demo/login", { user: "test-admin", pass: "test-preview-pass" });
  assert.equal(login.status, 200, "検証専用アカウントでログインできません");
  assert.equal(login.body.role, "admin");
  cookie = login.cookies.map(x => x.split(";")[0]).join("; ");
  assert(cookie.startsWith("pm_session="), "ログイン状態を確認できません");
  const schedule = () => request("/api/demo/schedule?date=" + report.date, undefined, true);
  report.stage = "find-slots";
  const initial = await schedule();
  assert.equal(initial.status, 200);
  const course = "364323-4822701", minutes = 60;
  const query = sid => "/api/availability?" + new URLSearchParams({ course, date: report.date, people: "1", staff: "none", ...(sid ? { staffId: sid } : {}) });
  const candidates = await request(query());
  assert.equal(candidates.status, 200);
  let selected;
  for (const person of candidates.body.staff) {
    const available = await request(query(person.id));
    assert.equal(available.status, 200);
    const slots = available.body.days.find(x => x.date === report.date)?.slots || [];
    const separate = [];
    for (const slot of slots.filter(x => x.available)) {
      if (!separate.length || slot.start >= separate[separate.length - 1].start + minutes * 60000) separate.push(slot);
      if (separate.length === 4) break;
    }
    if (separate.length === 4) { selected = { person, slots: separate }; break; }
  }
  assert(selected, "同じスタッフで4つの検証枠を確保できません");
  const { person, slots } = selected;
  report.staff = { id: person.id, name: person.name };
  const body = (slot, tag) => ({ requestKey: "http-risk-" + runId + "-" + tag, course, date: report.date,
    start: slot.start, people: 1, staff: "none", staffId: person.id, expectedNominationFee: person.nominationFee,
    name: "テスト HTTP同時操作 " + tag, email: "http-risk-" + runId + "-" + Buffer.from(tag).toString("hex") + "@example.test",
    phone: "00000000000", comment: "テスト HTTP同時操作", consent: true, language: "ja" });
  const saveCreated = (result, slot, tag) => {
    report.created.push({ id: result.id, date: report.date, staffId: person.id, staffName: person.name,
      start: slot.start, end: slot.start + minutes * 60000, tag: "テスト HTTP同時操作 " + tag });
    save();
  };
  const same = body(slots[0], "20回再送");
  report.stage = "twenty-concurrent-requests";
  const twenty = await Promise.all(Array.from({ length: 20 }, () => request("/api/bookings", same)));
  for (const r of twenty) { assert.equal(r.status, 200, "同内容の再送が成立しません"); assert(r.body.id && r.body.token, "予約結果が不完全です"); }
  assert.equal(new Set(twenty.map(r => r.body.id)).size, 1, "同時再送で複数予約が作られました");
  assert.equal(new Set(twenty.map(r => r.body.token)).size, 1, "再送結果が一致しません");
  saveCreated(twenty[0].body, slots[0], "20回再送");
  const afterTwenty = await schedule();
  assert.equal(afterTwenty.body.bookings.length, initial.body.bookings.length + 1, "再送後の保存件数が一致しません");
  record("同一キー・同一内容を20回同時送信して1予約だけ成立");

  report.stage = "duplicate-and-changed-input";
  const duplicate = await request("/api/bookings", { ...same, requestKey: same.requestKey + "-another" });
  safeFailure(duplicate, "soldOut", "別キーで同じ枠");
  record("別キーで同じ担当・時間の予約を拒否");
  const changed = await Promise.all([
    request("/api/bookings", { ...same, email: "changed@example.test" }),
    request("/api/bookings", { ...same, name: "テスト HTTP同時操作 内容変更" }),
    request("/api/bookings", { ...same, start: slots[1].start }),
  ]);
  changed.forEach(r => safeFailure(r, "requestChanged", "同じキーで入力変更"));
  record("同じキーで宛先・氏名・時刻を変える3件を拒否し予約ID/トークンを返さない");
  report.stage = "concurrent-moves";
  const movers = [];
  for (let i = 1; i <= 2; i++) {
    const created = await request("/api/bookings", body(slots[i], "移動" + i));
    assert.equal(created.status, 200, "移動検証用の予約が成立しません");
    saveCreated(created.body, slots[i], "移動" + i);
    movers.push({ id: created.body.id, slot: slots[i] });
  }
  const beforeMove = await schedule();
  const revision = beforeMove.body.days.find(x => x.date === report.date).version;
  const moved = await Promise.all(movers.map(x => request("/api/demo/schedule", {
    action: "moveBooking", date: report.date, revision, id: x.id, staffId: person.id,
    start: slots[3].minute, end: slots[3].minute + minutes,
    expect: { staffId: person.id, start: x.slot.minute }, confirmNominationMove: true,
  }, true)));
  assert.equal(moved.filter(x => x.status === 200).length, 1, "同時移動の成立件数が1件ではありません");
  safeFailure(moved.find(x => x.status !== 200), "scheduleConflict", "同じ更新番号での同時移動");
  record("同じ更新番号で2予約を同じ枠へ同時移動し片方だけ成立");
  report.stage = "final-integrity";
  const final = await schedule();
  assert.equal(final.status, 200);
  assert.equal(final.body.bookings.length, initial.body.bookings.length + 3, "保存された予約件数が増減しています");
  const testIds = new Set(report.created.map(x => x.id));
  const testBookings = final.body.bookings.filter(x => testIds.has(x.id));
  assert.equal(testBookings.length, 3);
  assert.equal(new Set(testBookings.map(x => x.id)).size, 3);
  assert.equal(testBookings.filter(x => x.start_at === slots[3].start).length, 1, "移動先が二重予約です");
  for (const b of testBookings) {
    const assigned = final.body.assignments.filter(x => x.booking_id === b.id);
    assert.equal(assigned.length, 1, "割当が重複しています");
    assert.equal(assigned[0].staff_id, person.id);
    const row = report.created.find(x => x.id === b.id);
    row.start = b.start_at; row.end = b.end_at;
  }
  const allAssigned = new Set(final.body.assignments.filter(x => x.staff_id === person.id).map(x => x.booking_id));
  const intervals = final.body.bookings.filter(x => x.status === "confirmed" && allAssigned.has(x.id)).sort((a, b) => a.start_at - b.start_at);
  for (let i = 1; i < intervals.length; i++) assert(intervals[i - 1].end_at <= intervals[i].start_at, "保存後に担当時間の重複があります");
  record("保存後の予約ID・担当割当・予約時間に重複なし");
  const mailResult = await request("/api/demo/mails", undefined, true);
  assert.equal(mailResult.status, 200);
  const bookingMails = mailResult.body.mails.filter(m => testIds.has(m.bookingId));
  assert(!bookingMails.some(m => m.type === "remind"), "予約リマインドが作成されています");
  for (const id of testIds) assert.equal(bookingMails.filter(m => m.bookingId === id && m.kind === "customer" && m.type === "confirm").length, 1);
  assert(!bookingMails.some(m => m.real), "検証から実メールを送信しています");
  record("20回再送後もお客様の予約確認は各1通・自動リマインドなし・外部送信なし");
  report.passed = true;
  report.summary = { concurrentRequests: 20, createdBookings: 3, changedInputRejected: 3, moveSucceeded: 1, moveRejected: 1 };
  save();
  console.log(JSON.stringify({ passed: true, checks: report.cases.length, summary: report.summary, artifact: output }));
})().catch(e => {
  report.passed = false;
  report.failure = "検証に失敗しました。接続先や応答内容などの秘密情報は記録していません。";
  if (/^検証用サーバーへの接続に失敗しました: /.test(e.message || "")) report.failure = e.message;
  report.errorType = e.name === "AssertionError" ? "assertion" : "execution";
  save();
  console.error(JSON.stringify({ passed: false, completedChecks: report.cases.length, artifact: output }));
  process.exitCode = 1;
});
