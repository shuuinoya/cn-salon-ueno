"use strict";
// 管理者が照合済みのスタッフ・勤務表をまとめて反映する。
// 読み取り→差分確認→同じ版に対する一括反映。予約・会員・回数券には触れない。
const crypto = require("crypto");
const digest = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const entries = (map, from, to) => [...map].filter(([d]) => d >= from && d <= to).sort(([a], [b]) => a.localeCompare(b));
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && Number.isFinite(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
const clone = (v) => JSON.parse(JSON.stringify(v));

function reconcile(state, body, { courses, today, minToMs, err }) {
  const fail = (message, status = 400) => { throw err(status, message); };
  const { from, to, staff, shifts, blocks, locks, retireIds = [] } = body;
  if (!validDate(from) || !validDate(to) || from < today || to < from || Date.parse(to) - Date.parse(from) > 2 * 366 * 864e5)
    fail("reconcileRange");
  if (![staff, shifts, blocks, locks, retireIds].every(Array.isArray) || !staff.length || staff.length > 300 || shifts.length > 100000)
    fail("invalid");
  const sourceHash = digest({ from, to, staff, shifts, blocks, locks, retireIds });
  if (state.staffReconciliation?.sourceHash === sourceHash && !body.dryRun)
    return { ok: true, already: true, ...state.staffReconciliation.summary };
  const version = digest({ staff: state.staff, photos: [...state.photos], shifts: entries(state.shifts, from, to),
    days: entries(state.days, from, to), events: entries(state.events, from, to), high: state.staffIdHigh });
  if (!body.dryRun && body.expectedVersion !== version) fail("scheduleConflict", 409);

  const oldById = new Map(state.staff.map(s => [s.id, s])), nextById = new Map(oldById);
  const knownCourses = new Map(courses.map(c => [c.id, c]));
  const ids = new Set(), sourceIds = new Set();
  const photos = new Map(state.photos);
  let high = Math.max(state.staffIdHigh || 10000000, ...state.staff.map(s => Number(s.id.slice(0, 8)) || 0));
  let added = 0, updated = 0;
  for (const row of staff) {
    if (!row || !/^\d{8}-0000-4000-8000-\d{12}$/.test(row.id || "") || ids.has(row.id) ||
      !/^\d+$/.test(row.sourceId || "") || sourceIds.has(row.sourceId) || !String(row.name || "").trim() ||
      !["male", "female", "none"].includes(row.gender) || ![0, 1].includes(row.active) ||
      !Number.isInteger(row.sortOrder) || !Array.isArray(row.courses) || !row.courses.length ||
      new Set(row.courses).size !== row.courses.length) fail("reconcileStaff");
    for (const cid of row.courses) {
      const c = knownCourses.get(cid);
      if (!c) fail("reconcileCourse");
      const g = /女性/.test(c.name) ? "female" : /男性/.test(c.name) ? "male" : "none";
      if (g !== "none" && g !== row.gender) fail("staffCourseGender", 409);
    }
    const old = oldById.get(row.id);
    const prior = old ? JSON.parse(old.profile || "{}") : {};
    if (prior.peakManagerId && prior.peakManagerId !== row.sourceId) fail("reconcileIdentity", 409);
    if (!old && Number(row.id.slice(0, 8)) <= high) fail("reconcileIdentity", 409);
    if (!old) { high = Number(row.id.slice(0, 8)); added++; } else updated++;
    const profile = { ...prior, peakManagerId: row.sourceId };
    const allowed = ["nickname", "familyName", "givenName", "furigana", "familyKana", "givenKana", "personalNomination", "genderNomination",
      "message", "nominationFee", "imageKey", "peakActiveBegin", "peakActiveEnd", "peakNominationFeeId", "skillOverride"];
    if (!row.profile || typeof row.profile !== "object" || Array.isArray(row.profile)) fail("reconcileProfile");
    for (const k of allowed) if (Object.hasOwn(row.profile, k)) profile[k] = row.profile[k];
    if (row.photo !== undefined) {
      if (typeof row.photo !== "string" || row.photo.length > 20 * 1024 * 1024 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(row.photo)) fail("reconcilePhoto");
      photos.set(row.id, row.photo); profile.imageKey = "uploaded";
    }
    nextById.set(row.id, { ...old, id: row.id, name: row.name.trim(), gender: row.gender, active: row.active, locked: 0,
      sort_order: row.sortOrder, courses: JSON.stringify(row.courses), profile: JSON.stringify(profile),
      profile_revision: (Number(old?.profile_revision) || 0) + 1 });
    ids.add(row.id); sourceIds.add(row.sourceId);
  }
  if (new Set(retireIds).size !== retireIds.length) fail("reconcileStaff");
  for (const id of retireIds) {
    if (!oldById.has(id) || ids.has(id)) fail("reconcileStaff");
    nextById.set(id, { ...oldById.get(id), active: 0 });
  }
  // 対象スタッフの登録漏れ・二重対応付けは一括反映を止める。
  if (state.staff.some(s => !ids.has(s.id) && !retireIds.includes(s.id))) fail("reconcileMissingStaff");
  const allSourceIds = [...nextById.values()].map(s => JSON.parse(s.profile || "{}").peakManagerId).filter(Boolean);
  if (new Set(allSourceIds).size !== allSourceIds.length) fail("reconcileIdentity", 409);
  const nextShifts = new Map(), nextBlocks = new Map(), nextLocks = new Map();
  for (let ms = Date.parse(from + "T00:00:00Z"); ms <= Date.parse(to + "T00:00:00Z"); ms += 864e5) {
    const date = new Date(ms).toISOString().slice(0, 10);
    nextShifts.set(date, []); nextBlocks.set(date, []); nextLocks.set(date, []);
  }
  const shiftKeys = new Set(), blockKeys = new Set();
  const checkTime = (row) => {
    if (!nextShifts.has(row.date) || !ids.has(row.staffId) || !Number.isInteger(row.start) || !Number.isInteger(row.end) ||
      row.start < 0 || row.end > 2880 || row.start >= row.end) fail("reconcileTime");
  };
  for (const row of shifts) {
    checkTime(row); const key = row.date + "/" + row.staffId;
    if (shiftKeys.has(key)) fail("reconcileDuplicate");
    shiftKeys.add(key);
    const old = (state.shifts.get(row.date) || []).find(s => s.staff_id === row.staffId);
    nextShifts.get(row.date).push({ ...old, staff_id: row.staffId, date: row.date,
      start_at: minToMs(row.date, row.start), end_at: minToMs(row.date, row.end), note: old?.note || "" });
  }
  for (const row of blocks) {
    checkTime(row);
    const sh = nextShifts.get(row.date).find(s => s.staff_id === row.staffId);
    const start_at = minToMs(row.date, row.start), end_at = minToMs(row.date, row.end);
    if (!sh || start_at < sh.start_at || end_at > sh.end_at || !["work", "break"].includes(row.kind)) fail("reconcileBlock");
    const key = [row.date, row.staffId, row.start, row.end, row.kind].join("/");
    if (blockKeys.has(key)) fail("reconcileDuplicate");
    blockKeys.add(key);
    const old = (state.events.get(row.date)?.blocks || []).find(b => b.staff_id === row.staffId && b.start_at === start_at && b.end_at === end_at && b.kind === row.kind);
    nextBlocks.get(row.date).push(old || { id: "peak-" + digest(key).slice(0, 24), staff_id: row.staffId, date: row.date, start_at, end_at, kind: row.kind, note: "" });
  }
  for (const row of locks) {
    if (!nextLocks.has(row.date) || !ids.has(row.staffId) || !shiftKeys.has(row.date + "/" + row.staffId)) fail("reconcileLock");
    if (nextLocks.get(row.date).includes(row.staffId)) fail("reconcileDuplicate");
    nextLocks.get(row.date).push(row.staffId);
  }
  // 新しく入った予約があれば、勤務外・担当外・業務との重なりを検出して全体を止める。
  for (const [date, ev] of entries(state.events, from, to)) for (const b of ev.bookings.filter(b => b.status === "confirmed")) {
    for (const a of ev.assignments.filter(a => a.booking_id === b.id)) {
      const sh = nextShifts.get(date).find(s => s.staff_id === a.staff_id), st = nextById.get(a.staff_id);
      if (!sh || b.start_at < sh.start_at || b.end_at > sh.end_at || !st?.active ||
        (b.course && !JSON.parse(st.courses).includes(b.course)) || nextLocks.get(date).includes(a.staff_id) ||
        nextBlocks.get(date).some(x => x.staff_id === a.staff_id && x.start_at < b.end_at && x.end_at > b.start_at)) fail("reconcileBookingConflict", 409);
    }
  }
  const oldShiftCount = entries(state.shifts, from, to).reduce((n, [, rows]) => n + rows.length, 0);
  const summary = { from, to, staff: staff.length, added, updated, retired: retireIds.length, oldShifts: oldShiftCount, shifts: shifts.length, blocks: blocks.length, locks: locks.length };
  if (body.dryRun) return { ok: true, expectedVersion: version, sourceHash, ...summary };
  // 復旧用の直前記録。予約・顧客データは含めない。全検証が成功するまで元の状態を変えない。
  const before = { staff: clone(state.staff), photos: [...state.photos], staffIdHigh: state.staffIdHigh,
    shifts: clone(entries(state.shifts, from, to)), days: clone(entries(state.days, from, to)),
    blocks: clone(entries(state.events, from, to).map(([d, ev]) => [d, ev.blocks])) };
  // 表示順序が同じスタッフも、照合元の並び順を保持する。
  state.staff = [...staff.map(row => nextById.get(row.id)), ...retireIds.map(id => nextById.get(id))];
  state.photos = photos; state.staffIdHigh = high;
  for (const [date, rows] of nextShifts) {
    state.shifts.set(date, rows);
    const day = state.days.get(date) || { version: 0, enabled: true };
    state.days.set(date, { ...day, locked: nextLocks.get(date), version: day.version + 1 });
    const ev = state.events.get(date);
    if (ev || nextBlocks.get(date).length) state.events.set(date, { ...(ev || { bookings: [], assignments: [] }), blocks: nextBlocks.get(date) });
  }
  state.staffReconciliation = { at: new Date().toISOString(), sourceHash, summary, before };
  return { ok: true, ...summary };
}
module.exports = { reconcile };
