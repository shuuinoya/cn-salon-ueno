"use strict";
// 掲載順は営業日ごとに保存する。管理台帳の sort_order・シフト・予約は変えない。
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
// 台帳と同じ安定ソート。同順位なら登録済み配列の順を保つ。
const shiftOrder = staff => [...staff].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
// 管理画面だけの並び。掲載順位や保存済みの sort_order は書き換えない。
// 固定の2人は登録IDで判定するため、表示名を編集しても先頭を保つ。
const ADMIN_FIRST = ["10000001-0000-4000-8000-000000000001", "10000018-0000-4000-8000-000010000018"];
function adminView(state, date) {
  const month = date.slice(0, 7), days = new Map(state.staff.map(s => [s.id, new Set()]));
  for (const [day, shifts] of state.shifts) {
    if (!day.startsWith(month + "-")) continue;
    for (const shift of shifts) {
      if (shift.date === day && Number.isFinite(shift.start_at) && Number.isFinite(shift.end_at) && shift.end_at > shift.start_at) days.get(shift.staff_id)?.add(day);
    }
  }
  const counts = new Map([...days].map(([id, dates]) => [id, dates.size]));
  const priority = id => ADMIN_FIRST.includes(id) ? ADMIN_FIRST.indexOf(id) : ADMIN_FIRST.length;
  const staff = shiftOrder(state.staff).sort((a, b) => priority(a.id) - priority(b.id) || counts.get(b.id) - counts.get(a.id));
  return { staff, counts, month };
}
const businessDate = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
function validDate(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date + "T00:00:00Z")) && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
}
function migrate(state, date) {
  if (!(state.staffListingDays instanceof Map)) state.staffListingDays = new Map();
  if (state.staffListingDailyVersion === 1) return;
  // 更新前に手動で設定した並びは更新当日だけ引き継ぐ。翌日へは持ち越さない。
  const old = [...state.staff].sort(compare), base = shiftOrder(state.staff);
  if (validDate(date) && old.some((s, i) => s.id !== base[i].id) && !state.staffListingDays.has(date)) {
    state.staffListingDays.set(date, { revision: 1, orders: old.map(s => ({ id: s.id, listingOrder: s.listing_order })) });
  }
  state.staffListingDailyVersion = 1;
}
function view(state, date) {
  const base = shiftOrder(state.staff), saved = state.staffListingDays?.get(date);
  const live = new Set(base.map(s => s.id)), ranks = new Map(), used = new Set();
  for (const row of saved?.orders || []) {
    if (live.has(row.id) && !ranks.has(row.id) && validOrder(row.listingOrder) && !used.has(row.listingOrder)) {
      ranks.set(row.id, row.listingOrder); used.add(row.listingOrder);
    }
  }
  let high = Math.max(0, ...ranks.values());
  // 並べ替え後に登録された人は末尾へ。当日の設定を持たない日は全員がシフト順。
  for (const s of base) if (!ranks.has(s.id)) ranks.set(s.id, ++high);
  return { staff: base.sort((a, b) => ranks.get(a.id) - ranks.get(b.id)), ranks, custom: !!saved };
}
function comparator(state, date) {
  const { ranks } = view(state, date);
  return (a, b) => ranks.get(a.id) - ranks.get(b.id);
}
function ordered(state, date) {
  const working = workingIds(state.shifts, date);
  return view(state, date).staff.sort((a, b) => Number(working.has(b.id)) - Number(working.has(a.id)));
}
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function version(state, date) {
  return hash({ date, day: state.staffListingDays?.get(date) || null,
    baseOrder: shiftOrder(state.staff).map(s => s.id),
    staff: [...state.staff].sort(byId).map(s => ({ id: s.id, revision: s.profile_revision || 0,
      name: s.name, active: s.active, gender: s.gender, courses: s.courses, profile: s.profile })),
    shifts: (state.shifts.get(date) || []).map(s => [s.staff_id, s.start_at, s.end_at]).sort() });
}
function save(state, body, actor, err, today = businessDate()) {
  if (!actor || !["admin", "manager"].includes(actor.role)) throw err(403, "forbidden");
  if (!body || !validDate(body.date)) throw err(400, "staffOrderingDateRequired");
  if (typeof body.version !== "string" || !Array.isArray(body.orders) ||
      typeof body.requestKey !== "string" || !body.requestKey || body.requestKey.length > 150) throw err(400, "invalid");
  const fingerprint = hash({ actor: actor.user, date: body.date, version: body.version, orders: body.orders });
  const previous = state.staffOrderingKeys?.get(body.requestKey);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw err(409, "requestChanged");
    return { ...previous.result };
  }
  // 前日から開いたままの入力を、翌日の掲載順として保存してはいけない。
  if (body.date < today) throw err(409, "staffOrderingDayChanged");
  if (body.version !== version(state, body.date)) throw err(409, "staffOrderingConflict");
  const staffIds = new Set(state.staff.map(s => s.id)), ids = new Set(), numbers = new Set();
  if (body.orders.length !== staffIds.size) throw err(400, "staffOrderingInvalid");
  for (const row of body.orders) {
    if (!row || typeof row.id !== "string" || !staffIds.has(row.id) || ids.has(row.id) || !validOrder(row.listingOrder)) throw err(400, "staffOrderingInvalid");
    if (numbers.has(row.listingOrder)) throw err(409, "staffOrderingDuplicate");
    ids.add(row.id); numbers.add(row.listingOrder);
  }
  if (!(state.staffListingDays instanceof Map)) state.staffListingDays = new Map();
  const revision = (state.staffListingDays.get(body.date)?.revision || 0) + 1;
  state.staffListingDays.set(body.date, { revision, orders: body.orders.map(({ id, listingOrder }) => ({ id, listingOrder })) });
  const result = { ok: true, date: body.date, version: version(state, body.date) };
  if (!(state.staffOrderingKeys instanceof Map)) state.staffOrderingKeys = new Map();
  state.staffOrderingKeys.set(body.requestKey, { fingerprint, result });
  while (state.staffOrderingKeys.size > 100) state.staffOrderingKeys.delete(state.staffOrderingKeys.keys().next().value);
  return { ...result };
}
module.exports = { initialize, nextOrder, compare, ordered, workingIds, version, save, validOrder, validDate, migrate, view, comparator, adminView };
