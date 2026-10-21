#!/usr/bin/env node
"use strict";

// 純粋な判定だけを検査。サーバー起動・保存・送信・顧客情報読取は行わない。
const assert = require("node:assert/strict");
const policy = require("../booth-policy");
let checks = 0;
function check(name, fn) { fn(); checks++; }
const defaults = policy.sourceDefaults();
const course = { id: defaults.courses[0].ownId, name: defaults.courses[0].name };
const date = "2026-10-23";
const at = (d, min) => Date.parse(d + "T00:00:00+09:00") + min * 60000;
const state = (...bookings) => ({ events: new Map([[date, { bookings }]]) });
const booking = (id, start, end, boothIds, extra = {}) => ({
  id, name: "テスト ブース検証", service_date: date, status: "confirmed", people: boothIds.length, course: course.id,
  start_at: at(date, start), end_at: at(date, end), booth_ids: boothIds, ...extra,
});
const available = (extra = {}) => policy.boothAvailability({ state: state(), course, date, start: 600, end: 660, ...extra });
check("元の11室・オンライン9室", () => {
  assert.equal(policy.resolveBooths({}).length, 11);
  assert.equal(available().availableBooths.length, 11);
  assert.equal(available({ online: true }).availableBooths.length, 9);
});
check("元の25コースと名前を照合", () => {
  assert.equal(defaults.courses.length, 25);
  for (const c of defaults.courses) assert.deepEqual(policy.resolveCourseBoothIds({ id: c.ownId, name: c.name }), c.boothIds);
  assert.equal(policy.resolveCourseBoothIds({ ...course, name: "別のメニュー" }), null);
  assert.equal(policy.resolveCourseBoothIds({ id: "unknown", name: course.name }), null);
});
check("名前の全半角・空白だけは同一", () => {
  assert.deepEqual(policy.resolveCourseBoothIds({ ...course, name: "  " + course.name.replace(/ /g, "　") + " " }), policy.resolveCourseBoothIds(course));
});
check("準備時間は総時間に内包・15コースのみ", () => {
  assert.equal(defaults.courses.filter(c => c.minutesBefore || c.minutesAfter).length, 15);
  assert.deepEqual(policy.sourceCourseTiming(course), { minutesBefore: 5, minutesBody: 110, minutesAfter: 5 });
  assert.equal(policy.sourceCourseTiming({ ...course, name: "別" }), null);
});
check("ヘッドスパは4室限定", () => {
  const c = defaults.courses.find(c => c.sourceId === "4822664");
  const p = { id: c.ownId, name: c.name };
  assert.equal(available({ course: p }).availableBooths.length, 4);
  assert.equal(available({ course: p, boothId: "109908" }).code, "invalidBooth");
});
check("5コースは9室限定", () => {
  const limited = defaults.courses.filter(c => c.boothIds.length === 9);
  assert.equal(limited.length, 5);
  for (const c of limited) assert.equal(available({ course: { id: c.ownId, name: c.name } }).availableBooths.length, 9);
});
check("保存された設定を優先", () => {
  const rooms = [{ id: "custom", name: "テスト室", capacity: 1, active: true, online: true }];
  const result = available({ state: { booths: rooms }, course: { id: "new", name: "テスト", boothIds: ["custom"] } });
  assert.equal(result.booths[0].id, "custom");
  assert.equal(available({ state: { booths: [] } }).code, "boothConfiguration");
});
check("明示メニュー制限を優先", () => {
  assert.deepEqual(policy.resolveCourseBoothIds({ ...course, boothIds: ["109905"] }), ["109905"]);
  assert.equal(available({ course: { ...course, boothIds: [] } }).code, "boothSoldOut");
  assert.equal(available({ course: { ...course, boothIds: ["no-room"] } }).code, "boothConfiguration");
  assert.equal(available({ course: { ...course, boothIds: ["109902", "109902"] } }).code, "boothPolicyMissing");
});
check("同室同時間は拒否、別室は可", () => {
  const s = state(booking("テスト1", 600, 660, ["109902"]));
  assert.equal(available({ state: s, boothId: "109902" }).code, "boothSoldOut");
  assert.equal(available({ state: s, boothId: "109903" }).ok, true);
});
check("終了時刻と次開始の一致は可", () => {
  assert.equal(available({ state: state(booking("テスト1", 540, 600, ["109902"])), boothId: "109902" }).ok, true);
  assert.equal(available({ state: state(booking("テスト1", 660, 720, ["109902"])), boothId: "109902" }).ok, true);
});
check("取消は占有しない", () => {
  assert.equal(available({ state: state(booking("テスト1", 600, 660, ["109902"], { status: "cancelled" })), boothId: "109902" }).ok, true);
});
check("移動する本人だけ除外", () => {
  const s = state(booking("テスト1", 600, 660, ["109902"]));
  assert.equal(available({ state: s, boothId: "109902", excludeBookingId: "テスト1" }).ok, true);
  assert.equal(available({ state: s, boothId: "109902", excludeBookingId: "別" }).ok, false);
});
check("人数分の異なる部屋を確保", () => {
  assert.equal(new Set(available({ people: 3 }).booths.map(b => b.id)).size, 3);
  assert.equal(available({ people: 2, boothIds: ["109902", "109902"] }).code, "invalidBooth");
  assert.equal(available({ people: 2, boothIds: ["109902"] }).code, "invalidBooth");
  assert.equal(available({ people: 2, boothIds: ["109902", "109903"] }).ok, true);
});
check("人数より空きが少なければ拒否", () => {
  const booked = defaults.booths.slice(0, 10).map((b, i) => booking("テスト" + i, 600, 660, [b.id]));
  assert.equal(available({ state: state(...booked), people: 2 }).code, "boothSoldOut");
});
check("日跨ぎは他営業日も照合", () => {
  const prev = booking("テスト前日", 0, 1, ["109902"], { service_date: "2026-10-22", start_at: at("2026-10-22", 1500), end_at: at("2026-10-22", 1560) });
  const s = { events: new Map([["2026-10-22", { bookings: [prev] }]]) };
  assert.equal(available({ state: s, start: 60, end: 120, boothId: "109902" }).code, "boothSoldOut");
  assert.equal(available({ state: s, start: 120, end: 180, boothId: "109902" }).ok, true);
});
check("過去の仮名/HP/未割当を推測しない", () => {
  for (const label of ["新規1(1)", "新規1(9)", "HP", ""]) {
    const b = booking("テスト1", 600, 660, [], { people: 1, booth: label });
    assert.equal(available({ state: state(b) }).code, "unknownOccupancy");
    assert.deepEqual(policy.bookingBoothIds(b), []);
  }
});
check("未知の重なり予約だけ保守的に止める", () => {
  const b = booking("テスト1", 0, 60, [], { people: 1 });
  assert.equal(available({ state: state(b) }).ok, true);
  assert.equal(available({ state: state(b), start: 30, end: 90 }).code, "unknownOccupancy");
});
check("互換IDと配列優先", () => {
  const b = booking("テスト1", 600, 660, ["109902"]);
  delete b.booth_ids; b.booth_id = "109902";
  assert.equal(available({ state: state(b), boothId: "109902" }).code, "boothSoldOut");
  b.booth_ids = [];
  assert.equal(available({ state: state(b) }).code, "unknownOccupancy");
});
check("人数不足/未知室/重複室/重複予約は拒否", () => {
  for (const b of [
    booking("テスト1", 600, 660, ["109902"], { people: 2 }),
    booking("テスト1", 600, 660, ["missing"]),
    booking("テスト1", 600, 660, ["109902", "109902"]),
  ]) assert.equal(available({ state: state(b) }).code, "unknownOccupancy");
  const b = booking("テスト1", 600, 660, ["109902"]);
  assert.equal(available({ state: state(b, { ...b }) }).code, "unknownOccupancy");
});
check("同じ室の収容上限を同時刻単位で照合", () => {
  const booths = [{ id: "test-room", name: "テスト室", capacity: 2 }];
  const c = { id: "test-course", name: "テスト", boothIds: ["test-room"] };
  const rows = [booking("テスト1", 600, 630, ["test-room"]), booking("テスト2", 630, 660, ["test-room"])];
  assert.equal(available({ state: { ...state(...rows), booths }, course: c }).ok, true);
  rows.push(booking("テスト3", 620, 640, ["test-room"]));
  assert.equal(available({ state: { ...state(...rows), booths }, course: c }).code, "boothSoldOut");
});
check("非稼働/オンライン不可/性別/有効期間", () => {
  const room = { id: "test-room", name: "テスト室", capacity: 1 };
  const c = { name: "テスト", boothIds: ["test-room"] };
  for (const change of [{ active: false }, { terminal: false }, { activeBegin: "2026-10-24" }, { activeEnd: "2026-10-22" }]) {
    assert.equal(available({ state: { booths: [{ ...room, ...change }] }, course: c }).code, "boothSoldOut");
  }
  assert.equal(available({ state: { booths: [{ ...room, online: false }] }, course: c, online: true }).code, "boothSoldOut");
  assert.equal(available({ state: { booths: [{ ...room, male: false }] }, course: c, gender: "female" }).ok, true);
  assert.equal(available({ state: { booths: [{ ...room, male: false }] }, course: c }).ok, false);
});
check("設定破損と不正入力を拒否", () => {
  const room = { id: "test-room", name: "テスト室", capacity: 1 };
  for (const booths of [[room, { ...room }], [{ ...room, activeEnd: "2026-02-30" }], [{ ...room, capacity: 0 }]]) {
    assert.equal(available({ state: { booths } }).code, "boothConfiguration");
  }
  for (const change of [{ date: "2026-02-30" }, { start: -1 }, { start: 660 }, { people: 1.5 }, { end: Infinity }]) {
    assert.equal(available(change).code, "invalid");
  }
});
check("設定と予約を変更せず返却を分離", () => {
  const s = state(booking("テスト1", 540, 600, ["109902"])), before = JSON.stringify([...s.events]);
  const result = available({ state: s }); result.booths[0].name = "変更";
  assert.equal(JSON.stringify([...s.events]), before);
  assert.equal(available().booths[0].name, "新規1(1)");
  const seed = policy.sourceDefaults(); seed.booths[0].name = "変更";
  assert.equal(policy.resolveBooths({})[0].name, "新規1(1)");
});
const config = () => ({ booths: policy.resolveBooths({}), courses: [{ ...course, boothIds: policy.resolveCourseBoothIds(course) }] });
const validate = (s, next) => policy.validateConfiguration(s, next, { now: at(date, 500) });
check("設定保存は整形だけで元を変更しない", () => {
  const s = state(), next = config(), before = JSON.stringify(next);
  assert.equal(validate(s, next).ok, true);
  assert.equal(JSON.stringify(next), before);
});
check("過去予約の割当済み室は削除不可・無効化可", () => {
  const s = state(booking("テスト過去", 100, 200, ["109902"]));
  const next = config(); next.booths = next.booths.filter(b => b.id !== "109902"); next.courses[0].boothIds = next.courses[0].boothIds.filter(id => id !== "109902");
  assert.equal(validate(s, next).code, "boothInUse");
  const off = config(); off.booths[0].active = false;
  assert.equal(validate(s, off).ok, true);
});
check("取消済み室参照も削除せず保存", () => {
  const next = config(); next.booths = next.booths.filter(b => b.id !== "109902"); next.courses[0].boothIds = next.courses[0].boothIds.filter(id => id !== "109902");
  assert.equal(validate(state(booking("テスト取消", 600, 660, ["109902"], { status: "cancelled" })), next).code, "boothInUse");
});
check("将来予約室の無効化・期間外・対象メニュー外は拒否", () => {
  const s = state(booking("テスト将来", 600, 660, ["109902"]));
  for (const change of [{ active: false }, { activeEnd: "2026-10-22" }, { activeBegin: "2026-10-24" }, { female: false }]) {
    const next = config(); Object.assign(next.booths[0], change);
    assert.equal(validate(s, next).code, "futureBookingConflict");
  }
  const next = config(); next.courses[0].boothIds = next.courses[0].boothIds.filter(id => id !== "109902");
  assert.equal(validate(s, next).code, "futureBookingConflict");
});
check("受付経路の停止は既存予約を取り消さない", () => {
  const next = config(); Object.assign(next.booths[0], { online: false, terminal: false });
  assert.equal(validate(state(booking("テスト将来", 600, 660, ["109902"])), next).ok, true);
});
check("将来の同室同時予約を定員で検査", () => {
  const s = state(booking("テスト1", 600, 660, ["109902"]), booking("テスト2", 630, 690, ["109902"]));
  const next = config(); next.booths[0].capacity = 2;
  assert.equal(validate(s, next).ok, true);
  next.booths[0].capacity = 1;
  assert.equal(validate(s, next).code, "futureBookingConflict");
});
check("未割当の旧予約を設定保存で割り当てない", () => {
  const s = state(booking("テスト旧", 600, 660, [], { people: 1, booth: "HP" })), before = JSON.stringify([...s.events]);
  assert.equal(validate(s, config()).ok, true);
  assert.equal(JSON.stringify([...s.events]), before);
});
check("部屋・コースの設定破損を拒否", () => {
  for (const change of [{ name: "" }, { capacity: 0 }, { online: "false" }, { color: "unknown" }, { activeBegin: "2026-02-30" }, { sort: -1 }, { priceHouse: -1 }]) {
    const next = config(); Object.assign(next.booths[0], change);
    assert.equal(validate(state(), next).code, "invalidBoothConfiguration");
  }
  const next = config(); next.courses[0].boothIds = ["unknown"];
  assert.equal(validate(state(), next).code, "invalidBoothConfiguration");
});
check("連続コースの2番目以降の部屋制限も保護", () => {
  const next = config(); next.courses.push({ id: "test-second", name: "テスト連続", boothIds: ["109902", "109903"] });
  const s = state(booking("テスト連続", 600, 720, ["109902"], { services: [{ courseId: course.id }, { courseId: "test-second" }] }));
  assert.equal(validate(s, next).ok, true);
  next.courses[1].boothIds = ["109903"];
  assert.equal(validate(s, next).code, "futureBookingConflict");
});
console.log(JSON.stringify({ ok: true, checks, sourceBooths: 11, sourceCourses: 25, liveChanges: 0 }));
