"use strict";
(() => {
  const API = "/api/demo/booths";
  const COLORS = ["Green", "Pink", "Yellow", "Gold", "Skyblue", "Purple", "Lime", "Deeppink", "Chocolate", "Seagreen"];
  const messages = {
    invalid: "入力内容を確認してください。", invalidBoothConfiguration: "名前・人数・表示順序・適用日などの入力内容を確認してください。",
    invalidBooth: "ブースの指定を確認してください。", boothConfiguration: "ブースの設定に重複または未登録の番号があります。",
    boothInUse: "このブースは予約履歴で使われているため削除できません。使用を終えた後は、履歴を残して無効にできます。",
    futureBookingConflict: "今後または施術中の予約に影響するため保存できません。先に該当する予約のブースを確認してください。",
    boothPolicyMissing: "メニューの利用可能ブースを確認してください。", conflict: "別の端末で設定が変更されました。最新情報を読み直してください。",
    scheduleConflict: "別の端末で設定が変更されました。最新情報を読み直してください。", boothChanged: "別の端末で設定が変更されました。最新情報を読み直してください。", forbidden: "この設定の変更には管理者またはマネージャーの権限が必要です。",
    requestChanged: "送信内容が変わりました。最新情報を読み直してください。", notFound: "対象が見つかりません。最新情報を読み直してください。",
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  const field = (label, name, value, type = "text", attrs = "") => '<label class="bs-field"><span>' + esc(label) + '</span><input name="' + esc(name) + '" type="' + esc(type) + '" value="' + esc(value) + '" ' + attrs + '></label>';
  const select = (label, name, rows, value) => '<label class="bs-field"><span>' + esc(label) + '</span><select name="' + esc(name) + '" aria-label="' + esc(label) + '">' + rows.map(([v,t]) => '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(t) + '</option>').join("") + '</select></label>';
  const flag = (label, name, value) => select(label, name, [["1", "有効"], ["0", "無効"]], value === false || value === 0 || value === "0" ? "0" : "1");
  const key = () => "booth-" + (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,"0")).join(""));
  let app;
  function notice(text, bad = false) {
    if (!app) return;
    const node = app.dialog.querySelector(".bs-message"); node.textContent = text; node.classList.toggle("bs-error", bad);
  }
  async function load() {
    const current = app; if (!current) return;
    notice("読み込んでいます…");
    try {
      const res = await fetch(API, { credentials: "same-origin", cache: "no-store" });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(messages[data.error || data.code] || "ブース情報を読み込めませんでした。");
      if (app !== current) return;
      current.data = data; current.pending = null; current.editor = null; current.dirty = false;
      render(); current.dialog.scrollTop = 0; notice("最新の設定を表示しています。");
    } catch (error) { if (app === current) notice(error.message || "読み込めませんでした。もう一度お試しください。", true); }
  }
  async function save(payload) {
    if (!app || app.busy) return;
    if (app.data.canManage === false) { notice(messages.forbidden, true); return; }
    const current = app, fingerprint = JSON.stringify({ ...payload, expectedVersion: current.data.version });
    if (!current.pending || current.pending.fingerprint !== fingerprint) current.pending = { fingerprint, body: { ...payload, expectedVersion: current.data.version, requestKey: key() } };
    current.busy = true;
    current.dialog.querySelectorAll("button,input,select").forEach(el => { el.disabled = true; });
    notice("保存しています…");
    try {
      const res = await fetch(API, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(current.pending.body) });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(messages[data.error || data.code] || "保存できませんでした。入力内容と最新の予約を確認してください。");
      if (app !== current) return;
      current.busy = false; await load();
      if (app === current) notice("保存しました。");
    } catch (error) {
      if (app === current) { notice(error.message || "通信を確認して、もう一度保存してください。", true); current.dialog.querySelectorAll("button,input,select").forEach(el => { el.disabled = false; }); }
    } finally { if (app === current) { current.busy = false; current.dialog.querySelectorAll("button,input,select").forEach(el => { el.disabled = false; }); } }
  }
  function render() {
    if (!app?.data) return;
    const { booths = [], courses = [] } = app.data;
    const main = app.dialog.querySelector(".bs-main");
    main.innerHTML = '<div class="bs-tabs"><button type="button" data-tab="rooms" aria-pressed="' + (app.tab === "rooms") + '">ブース情報</button><button type="button" data-tab="courses" aria-pressed="' + (app.tab === "courses") + '">メニューとの対応</button></div>' +
      (app.tab === "rooms" ?
        '<div class="bs-tools"><p>予約で使う部屋、受付の可否、表示順を設定します。</p><button type="button" class="bs-primary" data-new>新規作成</button></div><div class="bs-table-wrap"><table class="bs-rooms-table"><thead><tr><th>ID</th><th>名前</th><th>略称</th><th>収容人数</th><th>予約端末</th><th>オンライン予約</th><th>状態</th><th>表示順序</th><th>操作</th></tr></thead><tbody>' +
        booths.map(b => '<tr><td>' + esc(b.id) + '</td><td><button type="button" class="bs-link" data-room="' + esc(b.id) + '">' + esc(b.name) + '</button></td><td>' + esc(b.shortName) + '</td><td>' + esc(b.capacity) + '</td><td>' + (b.terminal ? "有効" : "無効") + '</td><td>' + (b.online ? "有効" : "無効") + '</td><td>' + (b.active ? "有効" : "無効") + '</td><td>' + esc(b.sort) + '</td><td><button type="button" data-room="' + esc(b.id) + '">詳細</button></td></tr>').join("") +
        '</tbody></table></div>' :
        '<p class="bs-help">メニューごとに利用できるブースを設定します。チェックがないメニューはブースを割り当てて受け付けられません。</p><div class="bs-table-wrap"><table><thead><tr><th>メニュー</th><th>利用できるブース</th><th>操作</th></tr></thead><tbody>' +
        courses.map(c => '<tr><td>' + esc(c.name) + '</td><td>' + (Array.isArray(c.boothIds) ? c.boothIds.map(id => esc(booths.find(b => String(b.id) === String(id))?.name || "未登録のブース")).join("、") || "設定なし" : "設定が必要です") + '</td><td><button type="button" data-course="' + esc(c.id) + '">編集</button></td></tr>').join("") + '</tbody></table></div>') +
      '<div class="bs-editor"></div>';
    main.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { app.tab = b.dataset.tab; app.editor = null; render(); }));
    const createButton = main.querySelector("[data-new]");
    if (createButton) { createButton.disabled = app.data.canManage === false; createButton.addEventListener("click", () => roomEditor()); }
    main.querySelectorAll("[data-room]").forEach(b => b.addEventListener("click", () => roomEditor(b.dataset.room)));
    main.querySelectorAll("[data-course]").forEach(b => b.addEventListener("click", () => courseEditor(b.dataset.course)));
  }
  function bindCancel(editor) {
    editor.querySelector("[data-cancel]")?.addEventListener("click", () => { app.editor = null; editor.innerHTML = ""; });
    if (app.data.canManage === false) {
      editor.querySelectorAll("input,select,button:not([data-cancel])").forEach(el => { el.disabled = true; });
      notice("閲覧のみです。設定の変更は管理者またはマネージャーが行えます。");
      editor.querySelector("[data-cancel]")?.focus(); return;
    }
    editor.querySelector("input:not([readonly]),select")?.focus();
  }
  function roomEditor(id) {
    const booths = app.data.booths || [], existing = id && booths.find(b => String(b.id) === id);
    if (id && !existing) { notice("対象が見つかりません。最新情報を読み直してください。", true); return; }
    const b = existing || { name: "", shortName: "", capacity: 1, sort: Math.max(0,...booths.map(x=>Number(x.sort)||0)) + 1, color: "Green", active: true, male: true, female: true, terminal: true, online: true };
    const editor = app.dialog.querySelector(".bs-editor"); app.editor = { type: "room", id };
    editor.innerHTML = '<form class="bs-form"><h3>' + (id ? "ブース情報" : "ブースを新規作成") + '</h3><div class="bs-fields">' +
      field("ID", "id", b.id || "保存時に発行", "text", "readonly") + field("管理コード", "code", b.code || "", "text", 'maxlength="100"') +
      field("名前 *", "name", b.name, "text", 'required maxlength="100"') + field("略称 *", "shortName", b.shortName, "text", 'required maxlength="100"') +
      field("収容人数 *", "capacity", b.capacity, "number", 'required min="1" max="100" step="1"') + field("社内単価", "priceHouse", b.priceHouse, "number", 'min="0" step="1"') +
      flag("男性可", "male", b.male) + flag("女性可", "female", b.female) + flag("予約端末", "terminal", b.terminal) + flag("オンライン予約", "online", b.online) +
      field("表示順序 *", "sort", b.sort, "number", 'required min="0" step="1"') + select("ボタンの色", "color", COLORS.map(x=>[x,x]), b.color) +
      field("適用開始日", "activeBegin", b.activeBegin || "", "date") + field("適用終了日", "activeEnd", b.activeEnd || "", "date") + flag("有効化フラグ", "active", b.active) +
      '</div><p class="bs-help">予約履歴があるブースは削除できません。今後の予約に影響する変更は保存時に止めます。</p><div class="bs-actions"><button class="bs-primary" type="submit">保存</button><button type="button" data-cancel>閉じる</button>' + (id ? '<button type="button" class="bs-danger" data-delete>削除</button>' : '') + '</div><div class="bs-delete-confirm"></div></form>';
    bindCancel(editor);
    editor.querySelector("form").addEventListener("submit", e => {
      e.preventDefault(); if (!e.target.reportValidity()) return;
      const f = new FormData(e.target), record = { ...b, name: String(f.get("name")).trim(), shortName: String(f.get("shortName")).trim(), code: String(f.get("code")).trim(),
        capacity: Number(f.get("capacity")), sort: Number(f.get("sort")), priceHouse: f.get("priceHouse") === "" ? "" : Number(f.get("priceHouse")), color: String(f.get("color")),
        activeBegin: String(f.get("activeBegin")), activeEnd: String(f.get("activeEnd")) };
      for (const flag of ["male","female","terminal","online","active"]) record[flag] = f.get(flag) === "1";
      if (!id) delete record.id;
      save({ action: "saveBooth", booth: record });
    });
    editor.querySelector("[data-delete]")?.addEventListener("click", () => {
      const box = editor.querySelector(".bs-delete-confirm");
      box.innerHTML = '<p>「' + esc(b.name) + '」を削除します。予約履歴がある場合は削除できません。</p><button type="button" class="bs-danger" data-confirm-delete>削除する</button><button type="button" data-back>戻る</button>';
      box.querySelector("[data-confirm-delete]").addEventListener("click", () => save({ action: "deleteBooth", boothId: id }));
      box.querySelector("[data-back]").addEventListener("click", () => { box.innerHTML = ""; });
    });
    editor.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function courseEditor(id) {
    const c = (app.data.courses || []).find(c => String(c.id) === id); if (!c) return;
    const editor = app.dialog.querySelector(".bs-editor"); app.editor = { type: "course", id };
    editor.innerHTML = '<form class="bs-form"><h3>利用できるブース</h3><p>' + esc(c.name) + '</p><div class="bs-checks">' +
      (app.data.booths || []).map(b => '<label><input type="checkbox" name="boothIds" value="' + esc(b.id) + '"' + ((c.boothIds || []).map(String).includes(String(b.id)) ? " checked" : "") + '> <span>' + esc(b.name) + (b.active ? "" : "（無効）") + (b.online ? "" : "（オンライン不可）") + '</span></label>').join("") +
      '</div><p class="bs-help">現在予約が入っているブースを対象から外す場合は、先に今後の予約を確認してください。</p><div class="bs-actions"><button type="submit" class="bs-primary">保存</button><button type="button" data-cancel>閉じる</button></div></form>';
    bindCancel(editor);
    editor.querySelector("form").addEventListener("submit", e => { e.preventDefault(); save({ action: "saveCourseBooths", courseId: id, boothIds: new FormData(e.target).getAll("boothIds").map(String) }); });
    editor.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  window.__pmOpenBooths = async () => {
    if (app) { app.dialog.focus(); return; }
    const previousFocus = document.activeElement, dialog = document.createElement("dialog");
    dialog.className = "bs-dialog"; dialog.setAttribute("aria-labelledby", "bs-title");
    dialog.innerHTML = '<header class="bs-header"><h2 id="bs-title">ブース情報</h2><div><button type="button" data-reload>最新情報を読み直す</button><button type="button" data-close aria-label="ブース情報を閉じる">×</button></div></header><p class="bs-message" role="status" aria-live="polite"></p><main class="bs-main"></main>';
    document.body.appendChild(dialog); app = { dialog, previousFocus, tab: "rooms", data: null, busy: false, pending: null, editor: null };
    const close = () => { if (app?.busy) return; if (app?.dirty && !window.confirm("保存していない変更を破棄して閉じますか？")) return; dialog.close(); dialog.remove(); app = null; if (previousFocus?.isConnected) previousFocus.focus(); };
    dialog.addEventListener("input", () => { if (app) app.dirty = true; });
    dialog.addEventListener("change", () => { if (app) app.dirty = true; });
    dialog.querySelector("[data-close]").addEventListener("click", close);
    dialog.querySelector("[data-reload]").addEventListener("click", () => { if (!app.busy) load(); });
    dialog.addEventListener("cancel", e => { e.preventDefault(); close(); });
    dialog.showModal(); await load();
  };
})();
