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
  window.CNTickets = { date, scope, summary, offer };
})();
