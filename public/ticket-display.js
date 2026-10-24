// 保有回数券の表示を、会員メニュー・マイページで共通にする。
(function () {
  "use strict";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tr = (s, args) => window.CNI18N ? window.CNI18N.t(s, args) : s.replace(/\{(\w+)\}/g, (_, k) => args?.[k] ?? "");
  function date(value) {
    if (!value) return tr("記録なし");
    const ms = typeof value === "number" ? value : Date.parse(value);
    if (!Number.isFinite(ms)) return tr("記録なし");
    const day = new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
    return window.CNI18N ? window.CNI18N.date(day) : day;
  }
  function scope(ticket) {
    if (ticket.menu_scope === "all") return tr("すべてのメニュー");
    const names = ticket.menu_names;
    if (!Array.isArray(names) || !names.length || names.some((s) => !s)) return tr("対象メニューの情報を確認できません");
    return names.map((s) => window.CNI18N ? window.CNI18N.menu(s) : s).join(" / ");
  }
  function summary(ticket) {
    const name = window.CNI18N ? window.CNI18N.plan(ticket.plan_name || "") : ticket.plan_name;
    const row = (key, value) => "<div><dt>" + esc(tr(key)) + "</dt><dd>" + esc(value) + "</dd></div>";
    return '<article class="cn-ticket-summary"><div class="cn-ticket-heading"><strong>' + esc(name) +
      '</strong><b>' + esc(tr("残り {n}回", { n: ticket.uses_left })) + "</b></div>" +
      (ticket.status && ticket.status !== "有効" ? '<p class="cn-ticket-status">' + esc(tr(ticket.status)) + "</p>" : "") +
      "<dl>" + row("対象メニュー", scope(ticket)) +
      row(ticket.kind === "revival" ? "復活した日" : "購入日", date(ticket.purchased_at)) +
      row("有効期限", date(ticket.expires_at)) + "</dl></article>";
  }
  function offer(settings) {
    const o = settings?.monthlyOffer;
    // 設定を取得できていないときは、独自の案内を推測して出さない。
    if (!o || o.enabled !== true) return "";
    const lang = window.CNI18N?.lang() || "ja";
    const detail = o.details?.[lang] || "";
    return '<aside class="cn-ticket-offer"><strong>' +
      esc(tr("毎月{start}〜{end}日は、回数券をお持ちの方限定料金でご案内します。", { start: o.startDay, end: o.endDay })) +
      "</strong>" + (detail ? "<p>" + esc(detail) + "</p>" : "") + "</aside>";
  }
  // URLに載せるのは券の番号だけ。本人確認用のトークンは載せない。
  const bookingHref = ticket => "/book?ticket=" + encodeURIComponent(ticket.id);
  const usable = (ticket, now = Date.now()) => !!ticket && ticket.status === "有効" && ticket.uses_left > 0 && Number(ticket.expires_at) >= now;
  const allows = (ticket, course) => !!ticket && (ticket.menu_scope === "all" ||
    (Array.isArray(ticket.menu_scope) && !!course && course.split(",").every(id => ticket.menu_scope.includes(id))));
  function bookingIssue(ticket, course, people = 1) {
    if (!usable(ticket)) return "選択した回数券は現在使用できません。回数券を選び直してください。";
    if (Number(people) !== 1) return "回数券は1名の予約で使用できます。人数を1名に戻してください。";
    if (course && !allows(ticket, course)) return "この回数券は、選択したメニューではご利用いただけません。";
    return "";
  }
  const choiceKey = "cn-booking-ticket";
  let memoryChoice;
  function choice() {
    if (memoryChoice !== undefined) return memoryChoice;
    try { const saved = JSON.parse(sessionStorage.getItem(choiceKey) || "null"); memoryChoice = typeof saved?.id === "string" ? saved.id : ""; }
    catch { memoryChoice = ""; }
    return memoryChoice;
  }
  function choose(id) {
    memoryChoice = String(id || "");
    try { if (memoryChoice) sessionStorage.setItem(choiceKey, JSON.stringify({ id: memoryChoice, at: Date.now() })); else sessionStorage.removeItem(choiceKey); } catch {}
  }
  function useLink(ticket) {
    const hasMenu = ticket?.menu_scope === 'all' || ticket?.menu_names?.some(name => !!name);
    return usable(ticket) && hasMenu ? '<a class="cn-ticket-use" href="' + esc(bookingHref(ticket)) + '">' + esc(tr("使用する")) + '</a>' : "";
  }
  if (typeof location !== "undefined" && location.pathname && !location.pathname.startsWith("/book")) choose("");
  window.CNTickets = { date, scope, summary, offer, bookingHref, usable, allows, bookingIssue, choice, choose, useLink };
})();
