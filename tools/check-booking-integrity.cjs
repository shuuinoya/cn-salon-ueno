#!/usr/bin/env node
"use strict";

// 保存データを読むだけの検査。サーバーを起動せず、顧客氏名・連絡先・予約ID・認証情報は出力しない。
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function audit(snapshot, today, courses) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("検査基準日を YYYY-MM-DD で指定してください");
  const state = snapshot.state || snapshot;
  const issues = [];
  const counts = { past: {}, today: {}, future: {} };
  const period = date => date < today ? "past" : date === today ? "today" : "future";
  const count = (date, key, n = 1) => { const row = counts[period(date)]; row[key] = (row[key] || 0) + n; };
  const profile = st => { try { return JSON.parse(st.profile || "{}"); } catch { return {}; } };
  const staff = new Map();
  const sourceIds = new Set();
  const issue = (code, date, staffId, details = {}) => {
    const st = staff.get(staffId);
    issues.push({ code, period: date ? period(date) : "master", ...(date ? { date } : {}),
      ...(staffId ? { staff: st ? profile(st).nickname || st.name : "登録のないスタッフ" } : {}), ...details });
  };
  for (const st of state.staff || []) {
    if (staff.has(st.id)) issue("duplicateStaffId", null, st.id);
    staff.set(st.id, st);
    const sid = profile(st).peakManagerId;
    if (sid && sourceIds.has(sid)) issue("duplicateSourceStaffId", null, st.id);
    if (sid) sourceIds.add(sid);
  }
  const courseMap = new Map((state.courses || courses || []).map(c => [c.id, c]));
  const isTime = x => Number.isFinite(x) && x > 0;
  const timeValid = x => isTime(x.start_at) && isTime(x.end_at) && x.end_at > x.start_at;
  const overlaps = (a, b) => a.start_at < b.end_at && b.start_at < a.end_at;
  const slots = new Map();
  const shiftsByStaff = new Map();
  const addInterval = (map, sid, x) => { if (!map.has(sid)) map.set(sid, []); map.get(sid).push(x); };
  const allBookings = new Map();
  const blocksSeen = new Set();
  let bookings = 0, assignments = 0, shiftCount = 0, blockCount = 0;

  for (const [date, rows] of state.shifts || []) {
    const seen = new Set();
    count(date, "shifts", rows.length);
    for (const sh of rows) {
      shiftCount++;
      if (seen.has(sh.staff_id)) issue("multipleShiftsSameStaffDay", date, sh.staff_id);
      seen.add(sh.staff_id);
      if (!staff.has(sh.staff_id)) issue("shiftUnknownStaff", date, sh.staff_id);
      if (sh.date !== date) issue("shiftDateMismatch", date, sh.staff_id);
      if (!timeValid(sh)) issue("invalidShiftTime", date, sh.staff_id);
      else addInterval(shiftsByStaff, sh.staff_id, { ...sh, date });
    }
  }
  for (const [date, ev] of state.events || []) {
    const local = new Map();
    const assignees = new Map();
    for (const b of ev.bookings || []) {
      bookings++;
      count(date, b.status === "confirmed" ? "confirmedBookings" : "otherBookings");
      if (allBookings.has(b.id)) issue("duplicateBookingId", date, null, { previousDate: allBookings.get(b.id).date });
      allBookings.set(b.id, { date, b });
      local.set(b.id, b);
      if (b.service_date !== date) issue("bookingDateMismatch", date);
      if (!timeValid(b)) issue("invalidBookingTime", date);
      if (!Number.isInteger(b.people) || b.people < 1) issue("invalidBookingPeople", date);
      if (state.bookingIndex?.get(b.id) !== date) issue("bookingIndexMismatch", date);
    }
    for (const a of ev.assignments || []) {
      assignments++;
      count(date, "assignments");
      if (!assignees.has(a.booking_id)) assignees.set(a.booking_id, []);
      const ids = assignees.get(a.booking_id);
      if (ids.includes(a.staff_id)) issue("duplicateBookingAssignment", date, a.staff_id);
      ids.push(a.staff_id);
      if (!staff.has(a.staff_id)) issue("assignmentUnknownStaff", date, a.staff_id);
      const b = local.get(a.booking_id);
      if (!b) { issue("orphanAssignment", date, a.staff_id); continue; }
      if (b.status !== "confirmed") { issue("assignmentForInactiveBooking", date, a.staff_id); continue; }
      if (timeValid(b)) addInterval(slots, a.staff_id, { ...b, date, kind: "booking", bookingId: b.id });
      const sh = (state.shifts?.get(date) || []).find(x => x.staff_id === a.staff_id && x.start_at <= b.start_at && x.end_at >= b.end_at);
      if (!sh) issue("bookingOutsideShift", date, a.staff_id);
      const st = staff.get(a.staff_id), course = courseMap.get(b.course);
      if (st && course) {
        let selected;
        try { selected = JSON.parse(st.courses || "[]"); } catch {}
        if (!Array.isArray(selected) || (selected.length && !selected.includes(b.course))) issue("bookingCurrentSkillMismatch", date, a.staff_id);
        const required = course.name.includes("女性") ? "female" : course.name.includes("男性") ? "male" : "none";
        if (required !== "none" && required !== st.gender) issue("bookingGenderMismatch", date, a.staff_id);
      } else if (!course) issue("bookingUnknownCourse", date, a.staff_id);
    }
    for (const b of ev.bookings || []) {
      if (b.status !== "confirmed") continue;
      const ids = assignees.get(b.id) || [];
      if (new Set(ids).size !== b.people) issue("bookingAssignmentCountMismatch", date, null, { expected: Number.isInteger(b.people) ? b.people : "invalid", actual: new Set(ids).size });
      if (b.nominated_staff_id && !ids.includes(b.nominated_staff_id)) issue("nominatedStaffNotAssigned", date, b.nominated_staff_id);
    }
    for (const bl of ev.blocks || []) {
      blockCount++;
      count(date, "blocks");
      if (blocksSeen.has(bl.id)) issue("duplicateBlockId", date, bl.staff_id);
      blocksSeen.add(bl.id);
      if (!staff.has(bl.staff_id)) issue("blockUnknownStaff", date, bl.staff_id);
      if (bl.date !== date) issue("blockDateMismatch", date, bl.staff_id);
      if (!timeValid(bl)) issue("invalidBlockTime", date, bl.staff_id);
      else addInterval(slots, bl.staff_id, { ...bl, date, kind: "block" });
      if (!(state.shifts?.get(date) || []).some(sh => sh.staff_id === bl.staff_id && sh.start_at <= bl.start_at && sh.end_at >= bl.end_at)) issue("blockOutsideShift", date, bl.staff_id);
    }
  }
  for (const [id, date] of state.bookingIndex || []) if (!allBookings.has(id)) issue("orphanBookingIndex", date);
  function checkOverlaps(map, isShift) {
    for (const [sid, intervals] of map) {
      intervals.sort((a, b) => a.start_at - b.start_at);
      for (let i = 0; i < intervals.length; i++) for (let j = i + 1; j < intervals.length && intervals[j].start_at < intervals[i].end_at; j++) {
        const a = intervals[i], b = intervals[j];
        if (!overlaps(a, b)) continue;
        if (!isShift && a.kind === "booking" && b.kind === "booking" && a.bookingId === b.bookingId) continue;
        issue(isShift ? "overlappingShifts" : a.kind === b.kind ? (a.kind === "booking" ? "overlappingBookings" : "overlappingBlocks") : "bookingBlockConflict", b.date, sid,
          { ...(a.date !== b.date ? { otherDate: a.date } : {}) });
      }
    }
  }
  checkOverlaps(shiftsByStaff, true);
  checkOverlaps(slots, false);
  const byCode = {};
  for (const x of issues) byCode[x.code] = (byCode[x.code] || 0) + 1;
  return { asOf: today, readOnly: true, master: { staff: staff.size, linkedSourceStaff: sourceIds.size, courses: courseMap.size },
    totals: { bookings, assignments, shifts: shiftCount, blocks: blockCount }, counts, issueCounts: byCode, issues };
}

if (require.main === module) {
  const [, , input, today] = process.argv;
  if (!input || !today) { console.error("使い方: node tools/check-booking-integrity.cjs snapshot.json YYYY-MM-DD"); process.exitCode = 2; }
  else {
    try {
      const snapshot = JSON.parse(fs.readFileSync(input, "utf8"), (k, v) => v && v.__pm_map__ ? new Map(v.__pm_map__) : v);
      const source = fs.readFileSync(path.join(__dirname, "..", "demo-api.js"), "utf8");
      const literal = source.match(/const COURSE_SEED = (\{[\s\S]*?\n\});/);
      if (!literal) throw new Error("メニュー定義を読み取れません");
      const seed = vm.runInNewContext("(" + literal[1] + ")", {}, { timeout: 1000 });
      const report = audit(snapshot, today, Object.entries(seed).map(([id, c]) => ({ id, ...c })));
      console.log(JSON.stringify(report, null, 2));
      if (report.issues.length) process.exitCode = 1;
    } catch { console.error("予約整合性の検査に失敗しました。保存データ・基準日・メニュー定義を確認してください。"); process.exitCode = 2; }
  }
}

module.exports = { audit };
