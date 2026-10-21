"use strict";
// 管理画面の詳細予約。料金・時間・技能・部屋を全件検査してから一度だけ保存する。
const crypto = require("node:crypto");
const copy = x => JSON.parse(JSON.stringify(x));
const text = (v, n = 2000) => String(v ?? "").trim().slice(0, n);
const hash = x => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
const roles = ["admin", "manager", "staff"];
function staffIds(state, date, id) { return (state.events.get(date)?.assignments || []).filter(a => a.booking_id === id).map(a => a.staff_id); }
function fingerprint(state, date, bk) { return hash({ date, bk, staffIds: staffIds(state, date, bk.id) }); }
function discount(amount, type, value, err) {
  if (!["none", "amount", "percent"].includes(type) || !Number.isFinite(value) || value < 0) throw err(400, "invalid");
  if (type === "none") { if (value !== 0) throw err(400, "invalid"); return amount; }
  if (type === "percent") { if (value > 100) throw err(400, "invalid"); return Math.floor(amount * (100 - value) / 100); }
  if (!Number.isSafeInteger(value) || value > amount) throw err(400, "invalid");
  return amount - value;
}
function servicesOf(bk, c) {
  if (Array.isArray(bk.services) && bk.services.length) return bk.services.map((s, i) => ({ ...s, serviceId: s.serviceId || bk.id + ":" + i, expectedPrice: s.price }));
  const course = c.getCourse(bk.course); if (!course) return [];
  const duration = Math.round((bk.end_at - bk.start_at) / 60000), source = c.sourceTiming(course);
  const timing = source && source.minutesBefore + source.minutesBody + source.minutesAfter === duration ? source : { minutesBefore: 0, minutesBody: duration, minutesAfter: 0 };
  const price = !bk.ticket_id && Number.isSafeInteger(bk.base_price) ? bk.base_price : course.price;
  return [{ serviceId: bk.id + ":0", courseId: course.id, name: course.name, price, expectedPrice: price, ...timing, discountType: "none", discount: 0 }];
}
function combinedCourse(services, c) {
  const items = services.map(s => c.getCourse(s.courseId));
  if (!items.length || items.some(x => !x)) return null;
  const sets = items.map(x => c.courseBoothIds(x));
  if (sets.some(x => x === null)) return null;
  return { id: items[0].id, name: items.map(x => x.name).join("＋"), boothIds: sets[0].filter(id => sets.every(s => s.includes(id))) };
}
function totalAtStart(bk, start, err) {
  if (!Array.isArray(bk.services) || !bk.services.length) return bk.total;
  const serviceTotal = bk.ticket_id ? 0 : discount(bk.services.reduce((sum, s) => sum + discount(s.price, s.discountType, s.discount, err) * bk.people, 0), bk.bulk_discount_type || "none", bk.bulk_discount || 0, err);
  return serviceTotal + (bk.source !== "hotpepper" && start >= 1320 ? 2000 * bk.people : 0) + (bk.nomination_fee || 0);
}
function get(state, query, actor, c) {
  if (!actor || !roles.includes(actor.role)) throw c.err(403, "forbidden");
  if (!c.validDay(query.date)) throw c.err(400, "invalid");
  const date = query.date, bk = query.id ? (state.events.get(date)?.bookings || []).find(b => b.id === query.id) : null;
  if (query.id && !bk) throw c.err(404, "notFound");
  return { date, revision: state.days.get(date)?.version || 0, bookingFingerprint: bk ? fingerprint(state, date, bk) : null,
    feeNightStart: 1320, feeNightPerPerson: 2000,
    booking: bk ? { id: bk.id, reference: bk.reference, status: bk.status, source: bk.source,
      name: bk.name, email: bk.email || "", phone: bk.phone || "", start: c.msToMin(date, bk.start_at), people: bk.people || 1,
      staffIds: staffIds(state, date, bk.id), nominatedStaffId: bk.nominated_staff_id || "", nominationFee: bk.nomination_fee || 0,
      services: servicesOf(bk, c), unknownMenu: bk.course_name || "", bulkDiscountType: bk.bulk_discount_type || "none", bulkDiscount: bk.bulk_discount || 0,
      preferences: bk.preferences || "", tags: bk.tags || "", comment: bk.comment || "", total: bk.total, paid_at: bk.paid_at || null,
      paid_amount: bk.paid_amount || 0, ticket_id: bk.ticket_id || null, nightFeeExempt: bk.source === "hotpepper" } : null,
    courses: c.courses().map(x => ({ id: x.id, name: x.name, price: x.price, minutes: x.minutes, gender: c.courseGender(x.id),
      ...(c.sourceTiming(x) || { minutesBefore: 0, minutesBody: x.minutes, minutesAfter: 0 }), boothIds: c.courseBoothIds(x) })),
    staff: state.staff.map(s => {
      const sh = (state.shifts.get(date) || []).find(x => x.staff_id === s.id), p = c.profileOf(s);
      let courses = null; try { courses = JSON.parse(s.courses); } catch {}
      return { id: s.id, name: p.nickname || s.name, registeredName: s.name, gender: s.gender, active: s.active, courses,
        info_missing: c.staffInfoMissing(s), personalNomination: !!p.personalNomination, nominationFee: Number(p.nominationFee) || 0,
        start: sh ? c.msToMin(date, sh.start_at) : null, end: sh ? c.msToMin(date, sh.end_at) : null, locked: (state.days.get(date)?.locked || []).includes(s.id) };
    }), booths: c.booths() };
}
function post(state, body, actor, c) {
  if (!actor || !roles.includes(actor.role)) throw c.err(403, "forbidden");
  const date = body.date, isNew = body.action === "create";
  if (!["create", "update"].includes(body.action) || !c.validDay(date) || typeof body.requestKey !== "string" || !body.requestKey || body.requestKey.length > 150) throw c.err(400, "invalid");
  const requestFingerprint = hash({ ...body, revision: undefined, requestKey: undefined, actor: actor.user });
  const previous = state.bookingDetailsKeys.get(body.requestKey);
  if (previous) { if (previous.fingerprint !== requestFingerprint) throw c.err(409, "requestChanged"); return copy(previous.result); }
  if (body.revision !== (state.days.get(date)?.version || 0)) throw c.err(409, "scheduleConflict");
  const ev = state.events.get(date) || { bookings: [], blocks: [], assignments: [] };
  const old = !isNew && ev.bookings.find(b => b.id === body.id);
  if (!isNew && !old) throw c.err(404, "notFound");
  if (old && old.status !== "confirmed") throw c.err(409, "bookingChanged");
  if (old && body.bookingFingerprint !== fingerprint(state, date, old)) throw c.err(409, "bookingChanged");
  const people = body.people, ids = body.staffIds;
  if (!Number.isInteger(people) || people < 1 || people > 5 || !Array.isArray(ids) || ids.length !== people || new Set(ids).size !== people ||
      !Array.isArray(body.services) || !body.services.length || body.services.length > 10 || body.consent !== true || !text(body.name, 120)) throw c.err(400, "invalid");
  for (const [key, max] of [["name",120],["email",254],["phone",40]]) {
    const v = body[key]; if (v !== undefined && (typeof v !== "string" || v.length > max || /[\u0000-\u001f\u007f]/.test(v))) throw c.err(400, "invalid");
  }
  if (typeof body.name !== "string" || !body.name.trim() || (body.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) ||
      (body.phone?.trim() && !/^[0-9+()\- .]+$/.test(body.phone.trim()))) throw c.err(400, "invalid");
  c.rejectTestData({ name: body.name, email: body.email });
  const oldServices = old ? servicesOf(old, c) : [];
  const serviceIds = new Set();
  const services = body.services.map((s, i) => {
    if (!s || typeof s !== "object") throw c.err(400, "invalid");
    const course = c.getCourse(s.courseId); if (!course) throw c.err(400, "invalid");
    if (s.serviceId !== undefined && (typeof s.serviceId !== "string" || serviceIds.has(s.serviceId) || !oldServices.some(x => x.serviceId === s.serviceId))) throw c.err(400, "invalid");
    if (s.serviceId) serviceIds.add(s.serviceId);
    const prior = s.serviceId ? oldServices.find(x => x.serviceId === s.serviceId) : null;
    const original = prior?.courseId === s.courseId ? prior : null;
    const price = original ? original.price : course.price;
    if (s.expectedPrice !== price) throw c.err(409, "priceChanged");
    for (const v of [s.minutesBefore, s.minutesBody, s.minutesAfter]) if (!Number.isInteger(v) || v < 0 || v > 600 || v % 5) throw c.err(400, "invalid");
    const minutes = s.minutesBefore + s.minutesBody + s.minutesAfter;
    if (minutes < 5 || minutes > 600) throw c.err(400, "invalid");
    const discountType = s.discountType || "none", value = s.discount ?? 0;
    discount(price, discountType, value, c.err);
    return { serviceId: prior?.serviceId || crypto.randomUUID(), courseId: course.id, name: course.name, price, minutesBefore: s.minutesBefore, minutesBody: s.minutesBody, minutesAfter: s.minutesAfter, discountType, discount: value };
  });
  const start = body.start, duration = services.reduce((n, s) => n + s.minutesBefore + s.minutesBody + s.minutesAfter, 0), end = start + duration;
  if (!c.validSpan(start, end) || start % 5 || duration > 600) throw c.err(400, "invalid");
  const oldIds = old ? staffIds(state, date, old.id) : [];
  for (const id of ids) {
    const s = state.staff.find(x => x.id === id); if (!s) throw c.err(400, "invalid");
    if (s.active !== 1) throw c.err(409, "staffUnavailable");
    if (!oldIds.includes(id)) {
      if (c.staffInfoMissing(s).length) throw c.err(409, "staffInfoMissing");
      if ((state.days.get(date)?.locked || []).includes(id)) throw c.err(409, "staffLocked");
    }
    for (const item of services) { const why = c.staffMismatch(s, item.courseId); if (why) throw c.err(409, why === "gender" ? "staffGenderOnly" : "staffCannotDoCourse"); }
    if (!(state.shifts.get(date) || []).some(sh => sh.staff_id === id && sh.start_at <= c.minToMs(date, start) && sh.end_at >= c.minToMs(date, end))) throw c.err(409, "outsideShift");
    if (c.overlaps(date, id, start, end, old?.id)) throw c.err(409, "soldOut");
  }
  const nominated = body.nominatedStaffId === undefined ? old?.nominated_staff_id || "" : String(body.nominatedStaffId || "");
  if (nominated && !ids.includes(nominated)) throw c.err(400, "invalid");
  const nominee = nominated ? state.staff.find(x => x.id === nominated) : null;
  let fee = 0;
  if (nominee) {
    if (old?.nominated_staff_id) fee = old.nomination_fee || 0;
    else {
      const p = c.profileOf(nominee); if (!p.personalNomination) throw c.err(409, "staffUnavailable");
      fee = Number(p.nominationFee) || 0; if (body.expectedNominationFee !== fee) throw c.err(409, "priceChanged");
    }
  }
  const moving = old && (start !== c.msToMin(date, old.start_at) || end !== c.msToMin(date, old.end_at) ||
    JSON.stringify([...ids].sort()) !== JSON.stringify([...oldIds].sort()) || nominated !== (old.nominated_staff_id || "") ||
    JSON.stringify(services.map(s => s.courseId)) !== JSON.stringify(oldServices.map(s => s.courseId)));
  if (moving && (old.nominated_staff_id || nominated) && body.confirmNominationMove !== true) throw c.err(409, "nominatedConfirmationRequired");
  const bulkType = body.bulkDiscountType || "none", bulkValue = body.bulkDiscount ?? 0;
  const serviceTotal = discount(services.reduce((n, s) => n + discount(s.price, s.discountType, s.discount, c.err) * people, 0), bulkType, bulkValue, c.err);
  if (old?.ticket_id && (people !== (old.people || 1) || services.length !== oldServices.length ||
      services.some((s, i) => s.courseId !== oldServices[i].courseId || s.discountType !== oldServices[i].discountType || s.discount !== oldServices[i].discount) ||
      bulkType !== (old.bulk_discount_type || "none") || bulkValue !== (old.bulk_discount || 0))) throw c.err(409, "hasTicket");
  const amount = (old?.ticket_id ? 0 : serviceTotal) + (old?.source !== "hotpepper" && start >= 1320 ? 2000 * people : 0) + fee;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) throw c.err(400, "invalid");
  if (old && (old.paid_at || old.paid_amount > 0) && amount !== old.total) throw c.err(409, "alreadyPaid");
  const combined = combinedCourse(services, c); if (!combined) throw c.err(409, "boothPolicyMissing");
  const rooms = c.planBooths(date, start, end, combined, people, { ignoreId: old?.id, existing: old, boothIds: body.boothIds });
  if (!rooms.ok) throw c.err(409, rooms.code);
  const now = Date.now(), bk = old ? copy(old) : { id: "bk-new-" + (state.bookingSerial + 1), reference: "DM" + String(state.bookingSerial + 1).padStart(6, "0"),
    service_date: date, status: "confirmed", created_at: now, source: "admin", staff: "none", customer_token: null, customer_gender: "" };
  Object.assign(bk, { start_at: c.minToMs(date, start), end_at: c.minToMs(date, end), people,
    services, course: services[0].courseId, course_name: services.map(s => s.name).join("＋"),
    bulk_discount_type: bulkType, bulk_discount: bulkValue, total: amount, base_price: old?.ticket_id ? 0 : serviceTotal / people,
    name: text(body.name, 120), email: text(body.email, 254), phone: text(body.phone, 40), comment: text(body.comment), preferences: text(body.preferences), tags: text(body.tags, 500),
    nominated_staff_id: nominated || null, nominated_staff_name: nominee ? c.profileOf(nominee).nickname || nominee.name : null, nomination_fee: fee });
  if (Object.hasOwn(bk, "course_label")) bk.course_label = bk.course_name;
  const firstCourse = c.getCourse(services[0].courseId), timing = c.sourceTiming(firstCourse) || { minutesBefore: 0, minutesBody: firstCourse.minutes, minutesAfter: 0 };
  bk.details_customized = services.length > 1 || duration !== firstCourse.minutes || bulkType !== "none" || services.some(s => s.discountType !== "none" || s.price !== c.getCourse(s.courseId).price) || people > 3 ||
    ["minutesBefore", "minutesBody", "minutesAfter"].some(key => services[0][key] !== timing[key]);
  c.setBookingBooths(bk, rooms, actor, now);
  const historyFields = b => ({ name: b.name, email: b.email || "", phone: b.phone || "", comment: b.comment || "", preferences: b.preferences || "", tags: b.tags || "",
    bulkDiscountType: b.bulk_discount_type || "none", bulkDiscount: b.bulk_discount || 0, nominationFee: b.nomination_fee || 0 });
  if (old) bk.details_history = [...(old.details_history || []), { at: now, by: actor.user, before: { ...historyFields(old), services: oldServices, people: old.people, total: old.total,
    start_at: old.start_at, end_at: old.end_at, staffIds: oldIds, nominatedStaffId: old.nominated_staff_id }, after: { ...historyFields(bk), services: copy(services), people, total: amount, start_at: bk.start_at, end_at: bk.end_at, staffIds: [...ids], nominatedStaffId: nominated || null }, nomination_confirmed: !!body.confirmNominationMove }];
  if (bk.sb_done) { bk.sb_done = false; bk.sb_changed = true; }
  // ここまで状態の変更なし。検証済みの予約と全担当を一度に差し替える。
  if (old) ev.bookings[ev.bookings.findIndex(x => x.id === old.id)] = bk;
  else { state.bookingSerial++; ev.bookings.push(bk); }
  ev.assignments = ev.assignments.filter(x => x.booking_id !== bk.id).concat(ids.map(id => ({ booking_id: bk.id, staff_id: id })));
  state.events.set(date, ev); state.bookingIndex.set(bk.id, date);
  if (old) c.queueChangeMails(bk); else c.queueBookingMails(bk);
  c.bump(date); c.touch();
  const result = { ok: true, id: bk.id, reference: bk.reference, revision: state.days.get(date).version };
  state.bookingDetailsKeys.set(body.requestKey, { fingerprint: requestFingerprint, result });
  return copy(result);
}
module.exports = { get, post, servicesOf, combinedCourse, totalAtStart, fingerprint };
