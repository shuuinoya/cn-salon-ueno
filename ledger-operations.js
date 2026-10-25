"use strict";
// 管理台帳の日常記録。決済会社への請求・返金、回数券や外部ポイントの残高操作は行わない。
// 変更前に全入力を検証し、既存予約と保存済み履歴を保護する。
const crypto = require("node:crypto");
const METHODS = new Set(["cash", "card", "qr", "eMoney", "ticket", "voucher", "prepaid", "point", "epark", "other"]);
const MANAGER = new Set(["productSave", "productDelete", "templateSave", "templateDelete", "patternSave", "patternDelete", "goalSave"]);
const ACTIONS = new Set([...MANAGER, "checkout", "checkoutVoid", "retailSale", "retailVoid", "returnSave", "returnDelete", "templateApply", "patternApply", "onlineBlockSave", "onlineBlockDelete"]);
const emptyEvents = () => ({ bookings: [], assignments: [], blocks: [] });
const clone = x => JSON.parse(JSON.stringify(x));
const uid = prefix => prefix + "-" + crypto.randomBytes(12).toString("hex");
const text = (v, max = 2000) => String(v ?? "").trim().slice(0, max);
function createState() {
  return { version: 0, products: [], sales: [], returns: [], templates: [], patterns: [], checkouts: [], applications: [], onlineBlocks: [], requestKeys: new Map() };
}
// 旧版の精算済み記録を現在保存されている営業日で固定する。予約本体や回数券は変更しない。
function migrate(state) {
  if (!state.ledger) state.ledger = createState();
  const defaults = createState(); for (const [k, v] of Object.entries(defaults)) if (state.ledger[k] === undefined) state.ledger[k] = v;
  const l = state.ledger, recorded = new Set(l.checkouts.map(x => x.bookingId));
  for (const [date, ev] of state.events) for (const b of ev.bookings) {
    if (recorded.has(b.id) || !(b.paid_at || b.paid_amount > 0)) continue;
    l.checkouts.push({ id: uid("pay"), bookingId: b.id, reference: b.reference, date, amount: b.paid_amount || 0,
      payments: b.payment_breakdown || (b.paid_amount ? [{ method: "other", amount: b.paid_amount, detail: "旧版の受領記録（支払方法未記録）" }] : []),
      status: "paid", createdAt: b.paid_at || null, createdBy: "legacy", legacy: true,
      snapshot: { name: b.name, menu: b.course_name || "", total: b.total, start: (b.start_at - Date.parse(date + "T00:00:00+09:00")) / 60000,
        gender: ["web", "hotpepper"].includes(b.source) ? "none" : b.customer_gender || "none", staffIds: ev.assignments.filter(x => x.booking_id === b.id).map(x => x.staff_id) } });
    recorded.add(b.id);
  }
}
function requireRole(actor, manager, err) {
  if (!actor || !(manager ? ["admin", "manager"] : ["admin", "manager", "staff"]).includes(actor.role)) throw err(403, "forbidden");
}
function paymentLines(value, amount, err) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000 || !Array.isArray(value) || value.length > 20) throw err(400, "invalid");
  const rows = value.map(x => {
    if (!x || !METHODS.has(x.method) || !Number.isSafeInteger(x.amount) || x.amount < 0 || x.amount > 1000000000) throw err(400, "invalid");
    return { method: x.method, amount: x.amount, detail: text(x.detail, 100) };
  });
  if (rows.reduce((n, x) => n + x.amount, 0) !== amount) throw err(400, "paymentMismatch");
  return rows;
}
function onlineBlocked(state, date, staffId, start, end, c) {
  const from = c.minToMs(date, start), to = c.minToMs(date, end);
  return state.ledger.onlineBlocks.some(b => b.staffIds.includes(staffId) && c.minToMs(b.date, b.start) < to && c.minToMs(b.date, b.end) > from);
}
function goalOf(state, date) {
  const r = state.reports.get(date) || {};
  return { date, amount: r.goalAmount ?? null, note: r.goalNote || "", todayPlan: r.todayPlan || "", review: r.review || "" };
}
function sorted(rows) { return [...rows].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name, "ja")); }
function bookingFingerprint(state, date, b) {
  return crypto.createHash("sha256").update(JSON.stringify({ id: b.id, date, start: b.start_at, end: b.end_at, total: b.total,
    course: b.course, people: b.people, status: b.status, ticket: b.ticket_id, ticketRefunded: b.ticket_refunded,
    assigned: (state.events.get(date)?.assignments || []).filter(x => x.booking_id === b.id).map(x => x.staff_id).sort() })).digest("hex");
}
function summary(state, date) {
  const allBookings = state.events.get(date)?.bookings || [], bookings = allBookings.filter(b => b.status === "confirmed"), payments = {};
  const ledgerBookingIds = new Set(state.ledger.checkouts.map(x => x.bookingId));
  const legacyPaid = allBookings.filter(b => !ledgerBookingIds.has(b.id) && (b.paid_at || b.paid_amount > 0));
  const paid = state.ledger.checkouts.filter(x => x.date === date && x.status === "paid");
  const retail = state.ledger.sales.filter(s => s.date === date && s.status === "sold");
  const servicePaid = paid.reduce((n, x) => n + x.amount, 0) + legacyPaid.reduce((n, b) => n + (b.paid_amount || 0), 0), serviceExpected = bookings.reduce((n, b) => n + (b.total || 0), 0);
  const retailPaid = retail.reduce((n, s) => n + s.amount, 0);
  for (const row of [...paid.flatMap(x => x.payments), ...legacyPaid.flatMap(b => b.payment_breakdown || [{ method: "other", amount: b.paid_amount || 0 }]), ...retail.flatMap(s => s.payments)]) payments[row.method] = (payments[row.method] || 0) + row.amount;
  return { sales: servicePaid + retailPaid, servicePaid, serviceExpected, retailPaid,
    returns: state.ledger.returns.filter(r => r.date === date && r.status !== "void").length, payments };
}
function dashboard(state, c) {
  const today = c.todayJst(), month = today.slice(0, 7), yesterday = c.addDays(today, -1), now = Date.now();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(today + "T00:00:00Z"); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 5 + i);
    return { month: d.toISOString().slice(0, 7), visitors: 0, sales: 0 };
  });
  const byMonth = new Map(months.map(x => [x.month, x])), previousDay = { date: yesterday, visitors: 0, sales: 0 }, rankings = new Map();
  const ledgerBookingIds = new Set(state.ledger.checkouts.map(x => x.bookingId));
  const ranked = id => { if (!rankings.has(id)) rankings.set(id, { staffId: id, name: c.staffDisplayName(state.staff.find(s => s.id === id)) || "登録なし", visitors: 0, sales: 0 }); return rankings.get(id); };
  const shareSales = (ids, amount) => ids.forEach((id, i) => { ranked(id).sales += Math.floor(amount / ids.length) + (i < amount % ids.length ? 1 : 0); });
  const dates = new Set([...state.events.keys(), ...state.ledger.sales.map(x => x.date), ...state.ledger.checkouts.map(x => x.date)]);
  for (const d of dates) {
    if (d > today) continue;
    const bookings = (state.events.get(d)?.bookings || []).filter(b => b.status === "confirmed" && b.start_at <= now);
    const visitors = bookings.reduce((n, b) => n + (b.people || 1), 0), sales = summary(state, d).sales;
    if (d === yesterday) Object.assign(previousDay, { visitors, sales });
    const m = byMonth.get(d.slice(0, 7)); if (m) { m.visitors += visitors; m.sales += sales; }
    if (d.slice(0, 7) !== month) continue;
    for (const b of bookings) {
      const ids = [...new Set((state.events.get(d)?.assignments || []).filter(x => x.booking_id === b.id).map(x => x.staff_id))];
      ids.forEach(id => ranked(id).visitors++);
      if (!ledgerBookingIds.has(b.id)) shareSales(ids, b.paid_amount || 0);
    }
  }
  for (const p of state.ledger.checkouts.filter(x => x.status === "paid" && x.date <= today && x.date.slice(0, 7) === month)) shareSales([...new Set(p.snapshot?.staffIds || [])], p.amount);
  return { previousDay, currentMonth: { ...byMonth.get(month) }, months,
    ranking: [...rankings.values()].sort((a, b) => b.sales - a.sales || b.visitors - a.visitors), visitorBasis: "scheduledBeforeNow", rankingBasis: "servicePaidSplit" };
}
function get(state, query, actor, c) {
  requireRole(actor, false, c.err);
  const { view, date } = query, l = state.ledger;
  if (!c.validDay(date)) throw c.err(400, "invalid");
  const day = state.days.get(date) || { version: 0, enabled: true }, ev = state.events.get(date) || emptyEvents();
  const staff = state.staff.map(s => ({ id: s.id, name: c.staffDisplayName(s), registeredName: s.name, active: s.active, info_missing: c.staffInfoMissing(s), booking_info_missing: c.staffBookingMissing(s) }));
  const base = { view, date, revision: l.version, dayRevision: day.version, canManage: ["admin", "manager"].includes(actor.role), staff };
  const history = rows => rows.filter(x => x.date === date).map(clone);
  switch (view) {
    case "checkout": return { ...base, bookings: ev.bookings.map(b => {
      const paid = [...l.checkouts].reverse().find(x => x.bookingId === b.id && x.status === "paid");
      const t = b.ticket_id && state.tickets.get(b.ticket_id);
      return { bookingId: b.id, reference: b.reference, name: b.name, menu: b.course_name || c.courseNameOf(b.course),
        total: b.total || 0, status: b.status, start: c.msToMin(date, b.start_at), time: c.msToMin(date, b.start_at), gender: ["web", "hotpepper"].includes(b.source) ? "none" : b.customer_gender || "none",
        paid_at: b.paid_at || null, paid_amount: b.paid_amount || 0, payments: paid?.payments || b.payment_breakdown || [], checkoutId: paid?.id || null, bookingFingerprint: bookingFingerprint(state, date, b),
        ticket: t ? { id: t.id, name: t.plan_name, used: !b.ticket_refunded, uses: b.ticket_refunded ? 0 : 1 } : null };
    }), checkouts: history(l.checkouts).map(x => {
      const currentDate = state.bookingIndex.get(x.bookingId), current = state.events.get(currentDate)?.bookings.find(b => b.id === x.bookingId);
      const s = x.snapshot || {};
      return { ...x, name: s.name ?? current?.name ?? "", menu: s.menu ?? current?.course_name ?? "", start: s.start ?? null,
        gender: s.gender || "none", currentDate: currentDate || null };
    }) };
    case "retail": return { ...base, products: sorted(l.products).map(clone), sales: history(l.sales) };
    case "bookings": {
      const from = query.from || date, to = query.to || date;
      if (!c.validDay(from) || !c.validDay(to) || from > to || c.minToMs(to, 0) - c.minToMs(from, 0) > 366 * 86400000) throw c.err(400, "invalid");
      const bookings = [];
      for (const [d, e] of state.events) if (d >= from && d <= to) for (const b of e.bookings) {
        if (query.status && query.status !== "all" && b.status !== query.status) continue;
        if (query.q && ![b.id, b.reference, b.name].some(x => String(x || "").toLocaleLowerCase().includes(String(query.q).toLocaleLowerCase()))) continue;
        const ids = e.assignments.filter(a => a.booking_id === b.id).map(a => a.staff_id);
        bookings.push({ bookingId: b.id, reference: b.reference, date: d, start: c.msToMin(d, b.start_at), time: c.msToMin(d, b.start_at),
          name: b.name, gender: ["web", "hotpepper"].includes(b.source) ? "none" : b.customer_gender || "none", is_new: b.is_new ?? null,
          staffName: ids.map(id => c.staffDisplayName(state.staff.find(s => s.id === id)) || "登録なし").join("、"), menu: b.course_name || c.courseNameOf(b.course),
          total: b.total || 0, paid_at: b.paid_at || null, paid_amount: b.paid_amount || 0, note: b.comment || b.note || b.memo || "", source: b.source || "", cancelled_at: b.cancelled_at || null, status: b.status });
      }
      return { ...base, from, to, bookings: bookings.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start) };
    }
    case "dashboard": return { ...base, ...dashboard(state, c) };
    case "goals": {
      const month = date.slice(0, 7), n = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      const goals = Array.from({ length: n }, (_, i) => goalOf(state, month + "-" + String(i + 1).padStart(2, "0")));
      return { ...base, goal: goalOf(state, date), goals, days: goals.map(x => ({ date: x.date, revision: state.days.get(x.date)?.version || 0 })) };
    }
    case "returns": {
      const from = query.from || date, to = query.to || date;
      if (!c.validDay(from) || !c.validDay(to) || from > to || c.minToMs(to, 0) - c.minToMs(from, 0) > 366 * 86400000) throw c.err(400, "invalid");
      return { ...base, from, to, returns: l.returns.filter(x => x.date >= from && x.date <= to).map(clone) };
    }
    case "templates": case "patterns": return { ...base, [view]: sorted(l[view].filter(x => x.active !== 0)).map(clone), archived: sorted(l[view].filter(x => x.active === 0)).map(clone),
      applications: l.applications.filter(x => x.kind === view).map(clone),
      days: Array.from({ length: 91 }, (_, i) => { const d = c.addDays(c.todayJst(), i); return { date: d, revision: state.days.get(d)?.version || 0 }; }) };
    case "online": return { ...base, enabled: day.enabled !== false, locked: [...(day.locked || [])],
      staff: staff.map(s => { const sh = (state.shifts.get(date) || []).find(x => x.staff_id === s.id); return { ...s,
        start: sh ? c.msToMin(date, sh.start_at) : null, end: sh ? c.msToMin(date, sh.end_at) : null, locked: (day.locked || []).includes(s.id) }; }), blocks: clone(ev.blocks), onlineBlocks: history(l.onlineBlocks) };
    case "integrity": {
      const issues = inspect(state, date, c);
      return { ...base, issues, summary: { total: issues.length, errors: issues.filter(x => x.severity === "error").length, warnings: issues.filter(x => x.severity === "warning").length } };
    }
    default: throw c.err(400, "invalid");
  }
}
function inspect(state, date, c) {
  const issues = [], ev = state.events.get(date) || emptyEvents(), shifts = state.shifts.get(date) || [];
  const staff = new Map(state.staff.map(s => [s.id, s]));
  const add = (code, sid, message, extra = {}, severity = "error") => issues.push({ code, date, staffId: sid || "", staffName: c.staffDisplayName(staff.get(sid)), message, severity, ...extra });
  const seen = new Set(), names = new Map();
  for (const s of state.staff) {
    if (seen.has(s.id)) add("duplicateStaff", s.id, "同じスタッフ ID が重複しています"); seen.add(s.id);
    const name = String(s.name).normalize("NFKC").replace(/\s/g, "");
    if (names.has(name)) add("duplicateName", s.id, "同じ登録名のスタッフがいます。別人か確認してください", {}, "warning"); names.set(name, s.id);
    const missing = c.staffInfoMissing(s); if (missing.length) add("staffInfoMissing", s.id, missing.join("・") + "が未入力です", {}, "warning");
  }
  const shiftSeen = new Set();
  for (const sh of shifts) {
    if (!staff.has(sh.staff_id)) add("missingStaff", sh.staff_id, "シフトの担当スタッフが登録されていません");
    if (shiftSeen.has(sh.staff_id)) add("duplicateShift", sh.staff_id, "同じ日のシフトが重複しています"); shiftSeen.add(sh.staff_id);
  }
  const within = (sid, x) => shifts.some(s => s.staff_id === sid && s.start_at <= x.start_at && s.end_at >= x.end_at);
  const allocationSeen = new Set();
  for (const a of ev.assignments) {
    const key = a.booking_id + "|" + a.staff_id;
    if (allocationSeen.has(key)) add("duplicateAssignment", a.staff_id, "同じ予約の担当登録が重複しています", { bookingId: a.booking_id }); allocationSeen.add(key);
    if (!ev.bookings.some(b => b.id === a.booking_id && b.status === "confirmed")) add("orphanAssignment", a.staff_id, "有効な予約がない担当登録です", { bookingId: a.booking_id });
  }
  for (const b of ev.bookings.filter(x => x.status === "confirmed")) {
    const roomIssue = c.bookingBoothIssue?.(b, date);
    if (roomIssue) add(roomIssue, "", roomIssue === "boothUnassigned" ? "実在ブースの割り当てが未確認です。ブース情報で確認してください" : "ブースの空き・メニュー対応・人数を確認してください", { bookingId: b.id }, date < c.todayJst() ? "warning" : "error");
    const assigned = ev.assignments.filter(x => x.booking_id === b.id), ids = new Set(assigned.map(x => x.staff_id));
    if (ids.size !== (b.people || 1)) add("assignmentCount", "", "予約人数と担当人数が一致しません", { bookingId: b.id });
    for (const sid of ids) {
      if (!staff.has(sid)) add("missingStaff", sid, "予約担当が登録されていません", { bookingId: b.id });
      else if (c.bookingMismatch(staff.get(sid), b)) add("staffSkillMismatch", sid, "予約メニューの対応スキルまたは性別条件が一致しません", { bookingId: b.id });
      if (!within(sid, b)) add("outsideShift", sid, "予約が勤務時間外です", { bookingId: b.id });
    }
  }
  for (const b of ev.blocks) {
    if (!staff.has(b.staff_id)) add("missingStaff", b.staff_id, "業務・休憩の担当が登録されていません");
    if (!within(b.staff_id, b)) add("outsideShift", b.staff_id, "業務・休憩が勤務時間外です");
  }
  const occupied = [];
  for (const d of [c.addDays(date, -1), date, c.addDays(date, 1)]) {
    const e = state.events.get(d) || emptyEvents();
    for (const b of e.blocks) occupied.push({ ...b, date: d });
    for (const b of e.bookings.filter(x => x.status === "confirmed")) for (const a of e.assignments.filter(x => x.booking_id === b.id)) occupied.push({ ...b, staff_id: a.staff_id, date: d });
  }
  for (let i = 0; i < occupied.length; i++) for (let j = i + 1; j < occupied.length; j++) {
    const x = occupied[i], y = occupied[j];
    if ((x.date === date || y.date === date) && x.staff_id === y.staff_id && x.id !== y.id && x.start_at < y.end_at && y.start_at < x.end_at) add("scheduleOverlap", x.staff_id, "予約・業務・休憩の時間が重複しています");
  }
  return issues;
}
function validatedPattern(body, c) {
  if (!text(body.name, 100) || !c.validSpan(body.start, body.end) || !Array.isArray(body.blocks || [])) throw c.err(400, "invalid");
  const blocks = (body.blocks || []).map(b => {
    if (!c.validSpan(b.start, b.end) || b.start < body.start || b.end > body.end || !["work", "break"].includes(b.kind)) throw c.err(400, "invalid");
    return { start: b.start, end: b.end, kind: b.kind, note: text(b.note) };
  });
  if (blocks.length > 50) throw c.err(400, "invalid");
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) if (blocks[i].start < blocks[j].end && blocks[j].start < blocks[i].end) throw c.err(409, "scheduleConflict");
  return { name: text(body.name, 100), start: body.start, end: body.end, blocks, sort_order: Number.isSafeInteger(body.sort_order) ? body.sort_order : 0 };
}
// 全対象日のコピーを先に組み立てる。1件でも不適切なら元の台帳を変更しない。
function prepareApply(state, cells, mode, c) {
  if (!["merge", "replace"].includes(mode) || !Array.isArray(cells) || !cells.length || cells.length > 3000) throw c.err(400, "invalid");
  const drafts = new Map(), pairs = new Set();
  let onlineDraft = clone(state.ledger.onlineBlocks);
  for (const cell of cells) {
    const { date, staffId, revision, start, end } = cell, key = date + "|" + staffId;
    if (!c.validDay(date) || date < c.todayJst() || date > c.addDays(c.todayJst(), 90) || !c.validSpan(start, end) || pairs.has(key)) throw c.err(400, "invalid");
    pairs.add(key);
    if (revision !== (state.days.get(date)?.version || 0)) throw c.err(409, "scheduleConflict");
    const st = state.staff.find(s => s.id === staffId);
    if (!st) throw c.err(400, "invalid");
    if (!drafts.has(date)) drafts.set(date, { shifts: clone(state.shifts.get(date) || []), events: clone(state.events.get(date) || emptyEvents()) });
    const draft = drafts.get(date), idx = draft.shifts.findIndex(s => s.staff_id === staffId);
    const sh = { staff_id: staffId, date, start_at: c.minToMs(date, start), end_at: c.minToMs(date, end), note: "" };
    if (mode === "merge" && idx >= 0 && (draft.shifts[idx].start_at !== sh.start_at || draft.shifts[idx].end_at !== sh.end_at)) throw c.err(409, "scheduleConflict");
    if (idx >= 0) draft.shifts[idx] = sh; else draft.shifts.push(sh);
    if (mode === "replace") draft.events.blocks = draft.events.blocks.filter(b => b.staff_id !== staffId);
    for (const b of cell.blocks || []) {
      if (!c.validSpan(b.start, b.end) || b.start < start || b.end > end || !["work", "break"].includes(b.kind)) throw c.err(400, "invalid");
      const rec = { id: uid("blk"), staff_id: staffId, date, start_at: c.minToMs(date, b.start), end_at: c.minToMs(date, b.end), kind: b.kind, note: text(b.note) };
      if (!draft.events.blocks.some(x => x.staff_id === staffId && x.start_at === rec.start_at && x.end_at === rec.end_at && x.kind === rec.kind && x.note === rec.note)) draft.events.blocks.push(rec);
    }
    if (cell.onlineBlocks !== undefined) {
      if (mode === "replace") onlineDraft = onlineDraft.map(b => b.date === date ? { ...b, staffIds: b.staffIds.filter(s => s !== staffId) } : b).filter(b => b.staffIds.length);
      for (const b of cell.onlineBlocks) {
        if (!c.validSpan(b.start, b.end) || b.start < start || b.end > end) throw c.err(400, "invalid");
        if (!onlineDraft.some(x => x.date === date && x.staffIds.includes(staffId) && x.start === b.start && x.end === b.end && x.note === text(b.note))) onlineDraft.push({ id: uid("online"), date, staffIds: [staffId], start: b.start, end: b.end, note: text(b.note) });
      }
    }
  }
  for (const [date, draft] of drafts) {
    for (const b of onlineDraft.filter(x => x.date === date)) for (const staffId of b.staffIds) {
      if (!pairs.has(date + "|" + staffId)) continue;
      if (!draft.shifts.some(s => s.staff_id === staffId && s.start_at <= c.minToMs(date, b.start) && s.end_at >= c.minToMs(date, b.end))) throw c.err(409, "outsideShift");
      if (onlineDraft.some(x => x.id !== b.id && x.staffIds.includes(staffId) && c.minToMs(x.date, x.start) < c.minToMs(date, b.end) && c.minToMs(x.date, x.end) > c.minToMs(date, b.start))) throw c.err(409, "scheduleConflict");
    }
    const mine = [...draft.events.blocks, ...draft.events.bookings.filter(b => b.status === "confirmed").flatMap(b => draft.events.assignments.filter(a => a.booking_id === b.id).map(a => ({ ...b, staff_id: a.staff_id })))];
    for (const x of mine) {
      if (!pairs.has(date + "|" + x.staff_id)) continue;
      if (!draft.shifts.some(s => s.staff_id === x.staff_id && s.start_at <= x.start_at && s.end_at >= x.end_at)) throw c.err(409, "outsideShift");
      for (const d of [c.addDays(date, -1), date, c.addDays(date, 1)]) {
        const e = drafts.get(d)?.events || state.events.get(d) || emptyEvents();
        const other = [...e.blocks, ...e.bookings.filter(b => b.status === "confirmed").flatMap(b => e.assignments.filter(a => a.booking_id === b.id).map(a => ({ ...b, staff_id: a.staff_id })))];
        if (other.some(y => y.staff_id === x.staff_id && y.id !== x.id && y.start_at < x.end_at && y.end_at > x.start_at)) throw c.err(409, "scheduleConflict");
      }
    }
  }
  return () => { state.ledger.onlineBlocks = onlineDraft; for (const [date, draft] of drafts) { state.shifts.set(date, draft.shifts); state.events.set(date, draft.events); c.bump(date); } };
}
function post(state, body, actor, c, options = {}) {
  const l = state.ledger, action = body.action, date = body.date;
  requireRole(actor, MANAGER.has(action), c.err);
  if (!ACTIONS.has(action) || !c.validDay(date)) throw c.err(400, "invalid");
  const key = text(body.requestKey, 150), fingerprint = crypto.createHash("sha256").update(JSON.stringify({ ...body, revision: undefined, requestKey: undefined, actor: actor.user })).digest("hex");
  if (!options.legacy && (!key || key !== body.requestKey)) throw c.err(400, "invalid");
  if (key && l.requestKeys.has(key)) {
    const old = l.requestKeys.get(key); if (old.fingerprint !== fingerprint) throw c.err(409, "requestChanged"); return clone(old.result);
  }
  if (!options.legacy && body.revision !== l.version) throw c.err(409, "ledgerChanged");
  const now = Date.now(), by = text(actor.user, 100), stamp = { updatedAt: now, updatedBy: by };
  const edit = (rows, id) => { const idx = rows.findIndex(x => x.id === id); if (id && idx < 0) throw c.err(404, "notFound"); return idx; };
  let result = {}, apply;
  switch (action) {
    case "goalSave": {
      if (body.dayRevision !== (state.days.get(date)?.version || 0)) throw c.err(409, "scheduleConflict");
      if (!Number.isSafeInteger(body.amount) || body.amount < 0 || body.amount > 1000000000) throw c.err(400, "invalid");
      const rec = { ...(state.reports.get(date) || {}), goalAmount: body.amount, goalNote: text(body.note), todayPlan: text(body.todayPlan), review: text(body.review), ...stamp };
      apply = () => { state.reports.set(date, rec); c.bump(date); }; break;
    }
    case "onlineBlockSave": {
      if (body.dayRevision !== (state.days.get(date)?.version || 0)) throw c.err(409, "scheduleConflict");
      const idx = edit(l.onlineBlocks, body.id), staffIds = body.staffIds || (body.staffId ? [body.staffId] : []);
      if (idx >= 0 && l.onlineBlocks[idx].date !== date) throw c.err(404, "notFound");
      if (!Array.isArray(staffIds) || !staffIds.length || new Set(staffIds).size !== staffIds.length || !c.validSpan(body.start, body.end) || body.start % 5 || body.end % 5) throw c.err(400, "invalid");
      for (const staffId of staffIds) {
        if (!state.staff.some(s => s.id === staffId)) throw c.err(400, "invalid");
        if (!(state.shifts.get(date) || []).some(s => s.staff_id === staffId && s.start_at <= c.minToMs(date, body.start) && s.end_at >= c.minToMs(date, body.end))) throw c.err(409, "outsideShift");
        if (l.onlineBlocks.some(b => b.id !== body.id && b.staffIds.includes(staffId) && c.minToMs(b.date, b.start) < c.minToMs(date, body.end) && c.minToMs(b.date, b.end) > c.minToMs(date, body.start))) throw c.err(409, "scheduleConflict");
      }
      const rec = { id: body.id || uid("online"), date, staffIds: [...staffIds], start: body.start, end: body.end, note: text(body.note), ...stamp };
      apply = () => { if (idx >= 0) l.onlineBlocks[idx] = rec; else l.onlineBlocks.push(rec); c.bump(date); }; result.id = rec.id; break;
    }
    case "onlineBlockDelete": {
      if (body.dayRevision !== (state.days.get(date)?.version || 0)) throw c.err(409, "scheduleConflict");
      const idx = edit(l.onlineBlocks, body.id); if (idx < 0 || l.onlineBlocks[idx].date !== date) throw c.err(404, "notFound");
      apply = () => { l.onlineBlocks.splice(idx, 1); c.bump(date); }; break;
    }
    case "checkout": case "checkoutVoid": {
      const ev = state.events.get(date) || emptyEvents();
      const matches = ev.bookings.filter(b => body.bookingId ? b.id === body.bookingId : b.reference === String(body.reference));
      if (matches.length !== 1) throw c.err(404, "notFound"); const bk = matches[0];
      if (!options.legacy && body.dayRevision !== (state.days.get(date)?.version || 0)) throw c.err(409, "scheduleConflict");
      if (!options.legacy && body.bookingFingerprint !== bookingFingerprint(state, date, bk)) throw c.err(409, "bookingChanged");
      const paid = [...l.checkouts].reverse().find(x => x.bookingId === bk.id && x.status === "paid");
      if (action === "checkout") {
        if (bk.status !== "confirmed") throw c.err(409, "bookingChanged");
        if (paid || bk.paid_at || bk.paid_amount > 0) throw c.err(409, "alreadyPaid");
        const amount = options.legacy ? Number(body.amount) : body.amount;
        if (Number.isFinite(amount) && amount > (bk.total || 0)) throw c.err(400, "paymentExceedsTotal");
        if (!options.legacy && !Array.isArray(body.payments)) throw c.err(400, "invalid");
        const payments = paymentLines(body.payments || (amount ? [{ method: "other", amount, detail: "従来画面での受領記録" }] : []), amount, c.err);
        const rec = { id: uid("pay"), bookingId: bk.id, reference: bk.reference, date, amount, payments, note: text(body.note), status: "paid", createdAt: now, createdBy: by,
          snapshot: { name: bk.name, menu: bk.course_name || c.courseNameOf(bk.course), total: bk.total, start: c.msToMin(date, bk.start_at),
            services: clone(bk.services || []), bulkDiscountType: bk.bulk_discount_type || "none", bulkDiscount: bk.bulk_discount || 0, nominationFee: bk.nomination_fee || 0,
            gender: ["web", "hotpepper"].includes(bk.source) ? "none" : bk.customer_gender || "none", staffIds: ev.assignments.filter(x => x.booking_id === bk.id).map(x => x.staff_id) } };
        apply = () => { l.checkouts.push(rec); bk.paid_amount = amount; bk.paid_at = now; bk.payment_breakdown = payments; c.bump(date); }; result.id = rec.id;
      } else {
        if (!text(body.reason)) throw c.err(400, "invalid");
        if (!paid && !bk.paid_at && !(bk.paid_amount > 0)) throw c.err(409, "notPaid");
        const record = paid || { id: uid("pay"), bookingId: bk.id, reference: bk.reference, date, amount: bk.paid_amount || 0, payments: bk.payment_breakdown || [], createdAt: bk.paid_at || null, createdBy: "legacy" };
        apply = () => { if (!paid) l.checkouts.push(record); Object.assign(record, { status: "void", voidedAt: now, voidedBy: by, voidReason: text(body.reason) }); delete bk.paid_at; delete bk.paid_amount; delete bk.payment_breakdown; c.bump(date); }; result.id = record.id;
      }
      break;
    }
    case "productSave": {
      const idx = edit(l.products, body.id);
      if (!text(body.name, 100) || !Number.isSafeInteger(body.price) || body.price < 0 || body.price > 1000000000 || ![0, 1, true, false].includes(body.active ?? 1)) throw c.err(400, "invalid");
      const rec = { id: body.id || uid("product"), name: text(body.name, 100), category: text(body.category, 100), price: body.price, active: body.active === false || body.active === 0 ? 0 : 1, sort_order: Number.isSafeInteger(body.sort_order) ? body.sort_order : 0, ...stamp };
      apply = () => { if (idx >= 0) l.products[idx] = rec; else l.products.push(rec); }; result.id = rec.id; break;
    }
    case "productDelete": {
      const idx = edit(l.products, body.id); if (idx < 0) throw c.err(404, "notFound");
      apply = () => { l.products[idx] = { ...l.products[idx], active: 0, ...stamp }; }; break;
    }
    case "retailSale": {
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) throw c.err(400, "invalid");
      const seen = new Set(), items = body.items.map(i => {
        const p = l.products.find(x => x.id === i.productId && x.active === 1);
        if (!p || !Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.quantity > 10000 || seen.has(p.id)) throw c.err(400, "invalid"); seen.add(p.id);
        return { productId: p.id, name: p.name, category: p.category, unitPrice: p.price, quantity: i.quantity, total: p.price * i.quantity };
      });
      const amount = items.reduce((n, i) => n + i.total, 0), payments = paymentLines(body.payments, amount, c.err);
      const rec = { id: uid("sale"), date, name: text(body.name, 100), items, amount, payments, note: text(body.note), status: "sold", createdAt: now, createdBy: by };
      apply = () => l.sales.push(rec); result.id = rec.id; break;
    }
    case "retailVoid": {
      const rec = l.sales.find(x => x.id === body.id && x.date === date); if (!rec) throw c.err(404, "notFound");
      if (rec.status !== "sold") throw c.err(409, "alreadyVoided"); if (!text(body.reason)) throw c.err(400, "invalid");
      apply = () => Object.assign(rec, { status: "void", voidedAt: now, voidedBy: by, voidReason: text(body.reason) }); break;
    }
    case "returnSave": {
      const idx = edit(l.returns, body.id);
      if (!text(body.name, 100) || !text(body.reason) || (body.staffId && !state.staff.some(s => s.id === body.staffId)) || (body.time != null && (!Number.isSafeInteger(body.time) || body.time < 0 || body.time > 1620))) throw c.err(400, "invalid");
      if (idx >= 0 && (l.returns[idx].date !== date || l.returns[idx].status === "void")) throw c.err(409, "recordChanged");
      const rec = { id: body.id || uid("return"), date, time: body.time ?? null, name: text(body.name, 100), kind: text(body.kind, 100), reason: text(body.reason), waitStatus: text(body.waitStatus, 100), note: text(body.note), tags: text(body.tags, 300), staffId: body.staffId || "", status: "active", createdAt: idx >= 0 ? l.returns[idx].createdAt : now, createdBy: idx >= 0 ? l.returns[idx].createdBy : by, ...stamp };
      apply = () => { if (idx >= 0) l.returns[idx] = rec; else l.returns.push(rec); }; result.id = rec.id; break;
    }
    case "returnDelete": {
      const rec = l.returns.find(x => x.id === body.id && x.date === date); if (!rec) throw c.err(404, "notFound");
      if (rec.status === "void") throw c.err(409, "alreadyVoided");
      apply = () => Object.assign(rec, { status: "void", voidedAt: now, voidedBy: by }); break;
    }
    case "patternSave": {
      const idx = edit(l.patterns, body.id), rec = { id: body.id || uid("pattern"), ...validatedPattern(body, c), active: 1, ...stamp };
      apply = () => { if (idx >= 0) l.patterns[idx] = rec; else l.patterns.push(rec); }; result.id = rec.id; break;
    }
    case "templateSave": {
      const idx = edit(l.templates, body.id), sourceDate = body.sourceDate || date;
      if (!text(body.name, 100) || !c.validDay(sourceDate)) throw c.err(400, "invalid");
      if (body.sourceRevision !== (state.days.get(sourceDate)?.version || 0)) throw c.err(409, "scheduleConflict");
      const shifts = (state.shifts.get(sourceDate) || []).map(s => ({ staffId: s.staff_id, start: c.msToMin(sourceDate, s.start_at), end: c.msToMin(sourceDate, s.end_at) }));
      if (!shifts.length || shifts.some(s => !state.staff.some(t => t.id === s.staffId)) || new Set(shifts.map(s => s.staffId)).size !== shifts.length) throw c.err(400, "invalid");
      const blocks = (state.events.get(sourceDate)?.blocks || []).map(b => ({ staffId: b.staff_id, start: c.msToMin(sourceDate, b.start_at), end: c.msToMin(sourceDate, b.end_at), kind: b.kind, note: b.note || "" }));
      for (const sh of shifts) validatedPattern({ name: body.name, ...sh, blocks: blocks.filter(b => b.staffId === sh.staffId) }, c);
      if (blocks.some(b => !shifts.some(s => s.staffId === b.staffId))) throw c.err(400, "invalid");
      const onlineBlocks = l.onlineBlocks.filter(b => b.date === sourceDate).map(b => ({ staffIds: [...b.staffIds], start: b.start, end: b.end, note: b.note }));
      const rec = { id: body.id || uid("template"), name: text(body.name, 100), sourceDate, sourceRevision: body.sourceRevision, shifts, blocks, onlineBlocks, active: 1, sort_order: Number.isSafeInteger(body.sort_order) ? body.sort_order : 0, ...stamp };
      apply = () => { if (idx >= 0) l.templates[idx] = rec; else l.templates.push(rec); }; result.id = rec.id; break;
    }
    case "templateDelete": case "patternDelete": {
      const rows = action === "templateDelete" ? l.templates : l.patterns, idx = edit(rows, body.id); if (idx < 0) throw c.err(404, "notFound");
      if (rows[idx].active === 0) throw c.err(409, "alreadyVoided");
      apply = () => { rows[idx] = { ...rows[idx], active: 0, ...stamp }; }; break;
    }
    case "templateApply": {
      const tpl = l.templates.find(x => x.id === body.id && x.active !== 0); if (!tpl) throw c.err(404, "notFound");
      if (!Array.isArray(body.targetDates) || !body.targetDates.length || body.targetDates.length > 91) throw c.err(400, "invalid");
      const cells = body.targetDates.flatMap(d => tpl.shifts.map(s => ({ ...s, date: d.date, revision: d.revision, blocks: tpl.blocks.filter(b => b.staffId === s.staffId), onlineBlocks: (tpl.onlineBlocks || []).filter(b => b.staffIds.includes(s.staffId)) })));
      const commit = prepareApply(state, cells, body.mode || "merge", c);
      apply = () => { commit(); l.applications.push({ id: uid("apply"), kind: "templates", templateId: tpl.id, name: tpl.name, dates: body.targetDates.map(x => x.date), mode: body.mode || "merge", cells: clone(cells), createdAt: now, createdBy: by }); }; result.applied = cells.length; break;
    }
    case "patternApply": {
      const p = l.patterns.find(x => x.id === body.id && x.active !== 0); if (!p) throw c.err(404, "notFound");
      if (!Array.isArray(body.cells)) throw c.err(400, "invalid");
      const cells = body.cells.map(x => ({ ...x, start: p.start, end: p.end, blocks: p.blocks }));
      const commit = prepareApply(state, cells, body.mode || "merge", c);
      apply = () => { commit(); l.applications.push({ id: uid("apply"), kind: "patterns", patternId: p.id, name: p.name, mode: body.mode || "merge", cells: clone(cells), createdAt: now, createdBy: by }); }; result.applied = body.cells.length; break;
    }
  }
  apply(); l.version++; result = { ok: true, revision: l.version, ...result };
  if (key) l.requestKeys.set(key, { fingerprint, result });
  c.touch(); return clone(result);
}
module.exports = { createState, migrate, get, post, paymentLines, inspect, summary, onlineBlocked, goalOf };
