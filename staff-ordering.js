"use strict";
// 公開の掲載Noは同じスタッフIDに保存する。管理台帳の表示順 sort_order は変えない。
const crypto = require("node:crypto");
const MAX_ORDER = 999999;
const validOrder = n => Number.isSafeInteger(n) && n >= 1 && n <= MAX_ORDER;
const byId = (a, b) => String(a.id).localeCompare(String(b.id), "en");
const legacyOrder = (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || byId(a, b);
function initialize(staff) {
  const used = new Set();
  let high = Math.max(0, ...staff.filter(s => validOrder(s.listing_order)).map(s => s.listing_order));
  // 旧管理画面の安定ソートと同じ。同じ表示順序の人は保存済み配列順を保つ。
  for (const s of [...staff].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))) {
    if (validOrder(s.listing_order) && !used.has(s.listing_order)) { used.add(s.listing_order); continue; }
    s.listing_order = ++high; used.add(s.listing_order);
  }
}
function nextOrder(staff) { return Math.max(0, ...staff.map(s => validOrder(s.listing_order) ? s.listing_order : 0)) + 1; }
function compare(a, b) {
  const x = validOrder(a.listing_order) ? a.listing_order : Infinity;
  const y = validOrder(b.listing_order) ? b.listing_order : Infinity;
  return (x === y ? 0 : x < y ? -1 : 1) || legacyOrder(a, b);
}
function workingIds(shifts, date) {
  return new Set((shifts.get(date) || []).filter(s => s.date === date && Number.isFinite(s.start_at) &&
    Number.isFinite(s.end_at) && s.end_at > s.start_at).map(s => s.staff_id));
}
function ordered(staff, shifts, date) {
  const working = workingIds(shifts, date);
  return [...staff].sort((a, b) => Number(working.has(b.id)) - Number(working.has(a.id)) || compare(a, b));
}
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function version(state) {
  return hash([...state.staff].sort(byId).map(s => ({ id: s.id, order: s.listing_order, revision: s.profile_revision || 0,
    name: s.name, active: s.active, gender: s.gender, courses: s.courses, profile: s.profile })));
}
function save(state, body, actor, err) {
  if (!actor || !["admin", "manager"].includes(actor.role)) throw err(403, "forbidden");
  if (!body || typeof body.version !== "string" || !Array.isArray(body.orders) ||
      typeof body.requestKey !== "string" || !body.requestKey || body.requestKey.length > 150) throw err(400, "invalid");
  const fingerprint = hash({ actor: actor.user, version: body.version, orders: body.orders });
  const previous = state.staffOrderingKeys?.get(body.requestKey);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw err(409, "requestChanged");
    return { ...previous.result };
  }
  if (body.version !== version(state)) throw err(409, "staffOrderingConflict");
  const staffIds = new Set(state.staff.map(s => s.id)), ids = new Set(), numbers = new Set();
  if (body.orders.length !== staffIds.size) throw err(400, "staffOrderingInvalid");
  for (const row of body.orders) {
    if (!row || typeof row.id !== "string" || !staffIds.has(row.id) || ids.has(row.id) || !validOrder(row.listingOrder)) throw err(400, "staffOrderingInvalid");
    if (numbers.has(row.listingOrder)) throw err(409, "staffOrderingDuplicate");
    ids.add(row.id); numbers.add(row.listingOrder);
  }
  // 検査完了後にNoだけを一括更新。シフト・担当・写真・金額は変更しない。
  const orders = new Map(body.orders.map(x => [x.id, x.listingOrder]));
  for (const s of state.staff) s.listing_order = orders.get(s.id);
  const result = { ok: true, version: version(state) };
  if (!(state.staffOrderingKeys instanceof Map)) state.staffOrderingKeys = new Map();
  state.staffOrderingKeys.set(body.requestKey, { fingerprint, result });
  while (state.staffOrderingKeys.size > 100) state.staffOrderingKeys.delete(state.staffOrderingKeys.keys().next().value);
  return { ...result };
}
module.exports = { initialize, nextOrder, compare, ordered, workingIds, version, save, validOrder };
