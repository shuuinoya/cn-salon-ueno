"use strict";
// 実際の画面処理を、外部通信も顧客データもない小さな画面モデルで検査する。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/pm-layout.js"), "utf8");
function extract(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
function node() {
  return {
    dataset: {}, children: [], listeners: {}, disabled: false, checked: false, hidden: false,
    isConnected: true, textContent: "", classList: { add() {}, toggle() {} },
    append(...items) { this.children.push(...items); },
    setAttribute() {}, focus() {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    remove() { this.isConnected = false; },
    querySelectorAll() { return []; },
  };
}
let checks = 0;

async function confirmation() {
  let active;
  const document = {
    activeElement: node(),
    getElementById() { return active?.isConnected ? active : null; },
    createElement(tag) {
      const el = node();
      if (tag === "dialog") {
        const elements = new Map();
        el.querySelector = (selector) => {
          if (!elements.has(selector)) elements.set(selector, node());
          return elements.get(selector);
        };
        el.querySelector(".pm-move-confirm-ack input").parentElement = node();
        el.showModal = () => { el.open = true; active = el; };
        el.close = () => { el.open = false; el.listeners.close?.(); };
      }
      return el;
    },
    body: { appendChild() {} },
  };
  const context = vm.createContext({ window: {}, document, Map, Date, WEEK: [], getWhoami: async () => ({ role: "staff" }) });
  vm.runInContext(extract("  window.__pmMoveApprovals =", "  // 保存APIの応答"), context);
  const move = { id: "test", date: "2026-10-20", staffId: "b", start: 840, end: 900,
    before: { staffId: "a", start: 780, end: 840 } };
  const data = { staff: [{ id: "a", name: "テストA", courses: "[]" }, { id: "b", name: "テストB", courses: "[]" }],
    bookings: [{ id: "test", name: "テスト指名予約", course: "course", nominated_staff_id: "a", nomination_fee: 500 }] };
  let resolved = false;
  const pending = context.window.__pmConfirmBookingMove(move, data).then((v) => { resolved = true; return v; });
  const ok = active.querySelector(".pm-move-confirm-ok");
  assert.equal(ok.disabled, true);
  ok.listeners.click();
  await Promise.resolve();
  assert.equal(resolved, false, "指名予約は確認チェック前に進まない");
  const ack = active.querySelector(".pm-move-confirm-ack input");
  ack.checked = true; ack.listeners.change();
  assert.equal(ok.disabled, false);
  ok.listeners.click();
  assert.equal(await pending, true);
  assert.ok(context.window.__pmNominationMoveApprovals.has(context.window.__pmMoveKey(move)));
  const cancelled = context.window.__pmConfirmBookingMove(move, data);
  active.listeners.cancel({ preventDefault() {} });
  assert.equal(await cancelled, false);
  assert.equal(context.window.__pmNominationMoveApprovals.size, 0, "キャンセルは前の承認も残さない");
  data.staff[1].courses = '["other"]';
  const forbidden = context.window.__pmConfirmBookingMove(move, data);
  await new Promise((resolve) => setImmediate(resolve));
  const forbiddenAck = active.querySelector(".pm-move-confirm-ack input");
  forbiddenAck.checked = true; forbiddenAck.listeners.change();
  assert.equal(active.querySelector(".pm-move-confirm-ok").disabled, true, "指名確認で対応外の権限を解除しない");
  active.querySelector(".pm-move-confirm-cancel").listeners.click();
  assert.equal(await forbidden, false);
  checks += 4;

  const posts = [];
  context.window.fetch = async (_url, init) => { posts.push(JSON.parse(init.body)); return { ok: false }; };
  vm.runInContext(extract("  const origFetch =", "  // 狭い画面"), context);
  const send = () => context.window.fetch("/api/demo/schedule", { method: "POST", body: JSON.stringify({ action: "moveBooking", ...move, confirmNominationMove: true }) });
  await send();
  assert.equal(posts.at(-1).confirmNominationMove, false, "確認印だけを渡しても承認にはならない");
  context.window.__pmNominationMoveApprovals.set(context.window.__pmMoveKey(move), Date.now());
  await send(); assert.equal(posts.at(-1).confirmNominationMove, true);
  await send(); assert.equal(posts.at(-1).confirmNominationMove, false, "確認は1回限り");
  context.window.__pmNominationMoveApprovals.set(context.window.__pmMoveKey(move), Date.now() - 120001);
  await send(); assert.equal(posts.at(-1).confirmNominationMove, false, "古い確認は再利用しない");
  checks += 4;
}

function touch() {
  let armed, opens = 0, drags = 0, captures = 0;
  const scroller = { scrollLeft: 100, scrollTop: 0 };
  const el = { setPointerCapture() { captures++; }, hasPointerCapture() { return true; },
    releasePointerCapture() { captures--; }, closest() { return scroller; } };
  const context = vm.createContext({
    THRESH: 6, TOUCH_HOLD: 280, window: { addEventListener() {}, removeEventListener() {}, scrollBy() {} },
    setTimeout(fn) { armed = fn; return 1; }, clearTimeout() {}, cancelAnimationFrame() {},
    requestAnimationFrame() { return 1; }, frame() {},
    beginDrag(p) { drags++; p.dragging = true; }, back() {}, drop: async () => {},
  });
  vm.runInContext("let press=null;" + extract("  function startPress(", "  function beginDrag(") +
    ";this.start=startPress;this.move=onMove;this.up=onUp;this.cancel=onCancel;this.getPress=()=>press;", context);
  const event = (x, type = "touch") => ({ pointerId: 1, pointerType: type, clientX: x, clientY: 100 });
  const start = (type) => context.start(event(100, type), { el, open() { opens++; } });
  start(); context.up(event(100));
  assert.equal(opens, 1, "タップで詳細を開く");
  assert.equal(captures, 0);
  start(); context.move(event(70)); context.up(event(70));
  assert.equal(opens, 1, "スワイプで詳細を開かない");
  assert.equal(drags, 0, "スワイプで予約を動かさない");
  assert.equal(scroller.scrollLeft, 130);
  start(); armed(); context.move(event(115));
  assert.equal(drags, 1, "長押し後の移動だけドラッグ");
  context.cancel();
  // 新しいマウスの操作は待ち時間なし。
  vm.runInContext("press=null", context);
  start("mouse"); context.move(event(115, "mouse"));
  assert.equal(drags, 2);
  context.cancel();
  assert.equal(captures, 0, "キャンセル後はポインターを解放");
  checks += 5;
}

function detail() {
  const mobileHead = node(); mobileHead.querySelector = () => node();
  const side = node(); side.querySelector = (selector) => selector === ".pm-mobile-panel-head" ? mobileHead : null;
  let current = { reference: "TEST-102", name: "テスト予約", course_name: "女性スタッフの長いメニュー".repeat(4) };
  const val = (key) => ({ "予約ID": current.reference, "お名前": current.name, "メニュー": current.course_name, "コメント": "なし" }[key] || "");
  const dl = { querySelectorAll() { return ["予約ID", "お名前", "メニュー", "コメント"].map((key) => ({ textContent: key, nextElementSibling: { textContent: val(key) } })); } };
  const form = node();
  form.querySelector = (s) => s === ".ledger-booking-detail" ? dl : s === "p time" ? { getAttribute() { return "2026-10-20"; } } :
    s === "label select" ? { selectedOptions: [{ textContent: "テスト担当" }] } : null;
  form.querySelectorAll = () => [{ value: "14" }, { value: "00" }];
  let pd;
  side.appendChild = (el) => { pd = el; };
  const context = vm.createContext({
    window: { __pmSchedData: { bookings: [current] } },
    document: { querySelector(s) { return s === ".ledger-side" ? side : form; }, getElementById() { return pd; }, createElement: node },
    fillMoveTargets() {}, submitMove() {}, openCheckout() {}, URLSearchParams, location: {},
  });
  vm.runInContext(extract("  function decoratePanel()", "  // ---- 予約の移動"), context);
  context.decoratePanel();
  assert.ok(pd.innerHTML.includes("ID:TEST-102"), "実際の予約IDを保持");
  assert.ok(pd.innerHTML.includes("TEL:未登録"));
  assert.ok(!/08091951969|23:42|TORICOM|回数:1\/1|♀|♂/.test(pd.innerHTML), "見本の個人情報を補わない");
  assert.ok(pd.innerHTML.includes(current.course_name), "メニュー名を途中で切らない");
  assert.equal(pd.dataset.cgender, "", "メニューからお客様の性別を推測しない");
  current = { ...current, phone: "000-0000-0000", created_at: Date.parse("2026-10-19T12:34:00+09:00"),
    nominated_staff_id: "test-staff", nominated_staff_name: "テスト指名担当", nomination_fee: 500,
    ticket_id: "test-ticket", ticket_name: "テスト5回券", ticket_left_after: 4 };
  context.window.__pmSchedData.bookings = [current];
  pd.dataset.mvKey = "stale";
  context.decoratePanel();
  assert.ok(pd.innerHTML.includes("000-0000-0000"));
  assert.ok(pd.innerHTML.includes("2026-10-19 12:34"));
  assert.ok(pd.innerHTML.includes("テスト指名担当"));
  assert.ok(pd.innerHTML.includes("テスト5回券（残り4回）"), "回数券表示を保持");
  assert.equal(pd.dataset.mvKey, undefined, "詳細再描画後は移動候補を取り直す");
  checks += 6;
}

(async () => {
  await confirmation(); touch(); detail();
  console.log(`PASS admin interactions: ${checks} checks (nomination, one-time confirmation, touch, detail, tickets); synthetic data only`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
