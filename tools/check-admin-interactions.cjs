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
  let role = "staff";
  const context = vm.createContext({ window: {}, document, Map, Date, WEEK: [], getWhoami: async () => ({ role }) });
  vm.runInContext(extract("  window.__pmNominationMoveApprovals =", "  // 保存APIの応答"), context);
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
  assert.equal(active.querySelector(".pm-move-confirm-ok").disabled, true, "指名確認でも対応外へは移動できない");
  active.querySelector(".pm-move-confirm-cancel").listeners.click();
  assert.equal(await forbidden, false);
  checks += 4;

  delete data.bookings[0].nominated_staff_id;
  for (role of ["staff", "manager", "admin"]) {
    const blocked = context.window.__pmConfirmBookingMove(move, data);
    const blockedOk = active.querySelector(".pm-move-confirm-ok");
    assert.equal(blockedOk.disabled, true, role + "も対応外へは移動できない");
    assert.equal(blockedOk.textContent, "移動できません");
    assert.ok(!active.querySelector(".pm-move-confirm-warn").textContent.includes("承認"), "例外承認を案内しない");
    blockedOk.listeners.click();
    assert.equal(active.isConnected, true, "無効なボタン操作でも保存に進まない");
    active.querySelector(".pm-move-confirm-cancel").listeners.click();
    assert.equal(await blocked, false);
    checks++;
  }
  data.assignments = [{ booking_id: "test", staff_id: "b" }];
  const sameStaff = context.window.__pmConfirmBookingMove({ ...move, before: { ...move.before, staffId: "b" } }, data);
  assert.equal(active.querySelector(".pm-move-confirm-ok").disabled, true, "現在の担当の時間変更も現在のチェックを必須にする");
  active.querySelector(".pm-move-confirm-cancel").listeners.click();
  assert.equal(await sameStaff, false);
  data.staff[1].courses = '["course"]';
  const supported = context.window.__pmConfirmBookingMove(move, data);
  assert.equal(active.querySelector(".pm-move-confirm-ok").disabled, false, "指名なしの対応可能スタッフへは通常確認で進める");
  active.querySelector(".pm-move-confirm-ok").listeners.click();
  assert.equal(await supported, true);
  assert.equal(context.window.__pmNominationMoveApprovals.size, 0, "指名なしに指名承認は付けない");
  assert.equal(context.window.__pmMoveApprovals, undefined, "対応外承認の状態を作らない");
  checks += 3;

  const posts = [];
  context.window.fetch = async (_url, init) => { posts.push(JSON.parse(init.body)); return { ok: false }; };
  vm.runInContext(extract("  const origFetch =", "  // 狭い画面"), context);
  const send = () => context.window.fetch("/api/demo/schedule", { method: "POST", body: JSON.stringify({ action: "moveBooking", ...move, allowCourseMismatch: true, confirmNominationMove: true }) });
  await send();
  assert.equal(posts.at(-1).confirmNominationMove, false, "確認印だけを渡しても承認にはならない");
  assert.equal(Object.hasOwn(posts.at(-1), "allowCourseMismatch"), false, "対応外承認の指定は送らない");
  context.window.__pmNominationMoveApprovals.set(context.window.__pmMoveKey(move), Date.now());
  await send(); assert.equal(posts.at(-1).confirmNominationMove, true);
  await send(); assert.equal(posts.at(-1).confirmNominationMove, false, "確認は1回限り");
  context.window.__pmNominationMoveApprovals.set(context.window.__pmMoveKey(move), Date.now() - 120001);
  await send(); assert.equal(posts.at(-1).confirmNominationMove, false, "古い確認は再利用しない");
  checks += 5;
}

function dragSkills() {
  const date = "2026-10-22", dayMs = Date.parse(date + "T00:00:00+09:00");
  const staff = [
    { id: "a", name: "テストA", gender: "male", courses: '["course"]' },
    { id: "b", name: "テストB", gender: "male", courses: '["course"]' },
  ];
  const data = { staff, assignments: [{ booking_id: "test", staff_id: "a" }],
    shifts: staff.map(s => ({ date, staff_id: s.id, start_at: dayMs + 600 * 60000, end_at: dayMs + 1080 * 60000 })) };
  const context = vm.createContext({ window: {},
    staffIn: (d, id) => d.staff.find(s => s.id === id), dayLabel: d => d, hm: String,
    minOf: (_d, ms) => (ms - dayMs) / 60000,
    ERR: { staffCannotDoCourse: "対応外", staffGenderOnly: "性別条件", staffInfoMissing: "情報不足", staffLocked: "受付停止" } });
  vm.runInContext(extract("  window.__pmStaffMismatch =", "  window.__pmConfirmBookingMove =") +
    extract("  function judge(", "  // ---- 押す") + ";this.judge=judge;", context);
  const p = { date, data, item: { type: "booking", id: "test", staffId: "a", start: 780, end: 840 },
    booking: { course: "course", course_name: "テスト整体" } };
  const t = { kind: "row", date, staffId: "b", start: 840, end: 900 };
  assert.equal(context.judge(p, t).level, "ok", "チェックありの別担当に移動可能");
  staff[1].courses = '["other"]';
  assert.equal(context.judge(p, t).level, "ng", "チェックなしは警告ではなく移動不可");
  data.assignments.push({ booking_id: "test", staff_id: "b" });
  assert.equal(context.judge(p, t).level, "ng", "既に同じ予約を担当していてもチェックなしは移動不可");
  staff[0].courses = '["other"]';
  assert.equal(context.judge(p, { ...t, staffId: "a" }).level, "ng", "同じ担当の時間変更もチェックなしは不可");
  staff[0].courses = '["course"]';
  p.booking.course_name = "女性スタッフオイル";
  assert.equal(context.judge(p, { ...t, staffId: "a" }).level, "ng", "現在の担当でも性別条件を再確認");
  p.booking.course_name = "テスト整体";
  assert.equal(context.judge(p, { ...t, staffId: "a" }).level, "ok", "対応可能な現在担当の時間変更は可能");
  assert.equal(context.judge({ ...p, booking: null }, t).level, "ng", "メニュー情報を確認できないときは移動不可");
  assert.equal(context.judge({ ...p, item: { ...p.item, type: "block" } }, t).level, "ok", "業務枠は施術スキルによる制限を受けない");
  checks += 8;
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

function hoverTip() {
  const listeners = {}, windowListeners = {}, timers = new Map();
  let nextTimer = 0, shown = 0, visible = false, dragging = false, dialog = false, delay = 0;
  const child = {};
  const card = { isConnected: true, classList: { contains() { return false; } }, contains(el) { return el === this || el === child; }, closest() { return this; } };
  child.closest = () => card;
  const document = {
    body: { classList: { contains() { return dragging; } } },
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelector() { return dialog ? {} : null; },
    getElementById() { return visible ? { remove() { visible = false; } } : null; },
  };
  const context = vm.createContext({ document, window: { addEventListener(type, fn) { windowListeners[type] = fn; } },
    setTimeout(fn, ms) { delay = ms; timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); },
    showEventTip() { shown++; visible = true; } });
  vm.runInContext(extract("  function bindEventTips()", "  // 空欄は省略。") + ";bindEventTips();", context);
  const enter = (extra = {}) => listeners.pointerover({ target: card, pointerType: "mouse", buttons: 0, relatedTarget: null, ...extra });
  const leave = () => listeners.pointerout({ relatedTarget: null });
  const flush = () => { const tasks = [...timers.values()]; timers.clear(); tasks.forEach(fn => fn()); };
  enter(); assert.equal(visible, false); assert.equal(delay, 350); flush(); assert.equal(visible, true);
  listeners.pointerout({ relatedTarget: child }); enter({ target: child, relatedTarget: card });
  assert.equal(visible, true); assert.equal(shown, 1, "枠内の文字の上で点滅させない");
  listeners.pointerdown(); assert.equal(visible, false, "つかんだ瞬間に消す");
  windowListeners.pointerup(); enter(); flush(); assert.equal(visible, false, "離しても同じ枠の上で復活しない");
  leave(); enter(); listeners.pointerdown(); flush(); assert.equal(visible, false, "待機中につかんでも遅れて表示しない");
  windowListeners.pointerup();
  for (const event of ["click", "keydown", "focusin", "contextmenu", "scroll", "wheel"]) {
    leave(); enter(); flush(); assert.equal(visible, true); listeners[event](); assert.equal(visible, false, event + "で消す");
  }
  for (const event of ["blur", "resize"]) {
    leave(); enter(); flush(); windowListeners[event](); assert.equal(visible, false, event + "で消す");
  }
  leave(); enter({ pointerType: "touch" }); flush(); assert.equal(visible, false, "タッチ操作では表示しない");
  enter({ buttons: 1 }); flush(); assert.equal(visible, false);
  leave(); dragging = true; enter(); flush(); assert.equal(visible, false, "ドラッグ中は表示しない");
  leave(); dragging = false; dialog = true; enter(); flush(); assert.equal(visible, false, "別の入力画面が開いている間は表示しない");
  leave(); dialog = false; enter(); card.isConnected = false; flush(); assert.equal(visible, false, "画面切替後に古い予約を表示しない");
  checks += 17;
}

(async () => {
  await confirmation(); dragSkills(); touch(); detail(); hoverTip();
  console.log(`PASS admin interactions: ${checks} checks (skills, nomination, touch, detail, tickets, hover dismissal); synthetic data only`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
