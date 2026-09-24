// 管理画面（操作デモ）用のモックAPIです。
// 元サイトの /api/demo/schedule 相当を、保存版のためにメモリ上の架空データで再現します。
// サーバーを再起動するとデータは初期状態に戻ります。
"use strict";

// ---- 架空データの素材 -------------------------------------------------

const COURSES = {
  "364321-4822671": { name: "【本日限定】全身整体60分＋足裏マッサージ60分", price: 12000, minutes: 120 },
  "364323-4822664": { name: "全身整体 60分", price: 6600, minutes: 60 },
  "364323-4822706": { name: "【当店人気メニュー】ヘッドスパ 60分", price: 7700, minutes: 60 },
  "364325-4822707": { name: "小顔矯正 60分", price: 9900, minutes: 60 },
  "364326-4822708": { name: "【男性スタッフ】オイルリンパマッサージ 60分", price: 11500, minutes: 60 },
  "364326-4822709": { name: "【男性スタッフ】オイルリンパマッサージ 90分", price: 16500, minutes: 90 },
  "364327-4822712": { name: "フェイシャル 60分", price: 9900, minutes: 60 },
  "364328-4822716": { name: "タイ古式マッサージ 60分", price: 8800, minutes: 60 },
  "364331-4822719": { name: "フットマッサージ(足湯＋足裏〜ふくらぎ) 30分", price: 3300, minutes: 30 },
};
const COURSE_IDS = Object.keys(COURSES);

const STAFF_SEED = [
  { id: "demo-staff-01", name: "青山 ひかり", gender: "female", nickname: "ひかり" },
  { id: "demo-staff-02", name: "石田 桃子", gender: "female", nickname: "ももこ" },
  { id: "demo-staff-03", name: "上野 蓮", gender: "male", nickname: "れん" },
  { id: "demo-staff-04", name: "遠藤 美咲", gender: "female", nickname: "みさき" },
  { id: "demo-staff-05", name: "小川 大輝", gender: "male", nickname: "だいき" },
];

const CUSTOMERS = [
  "田中 花子", "鈴木 一郎", "高橋 結衣", "伊藤 健", "渡辺 さくら",
  "山本 直樹", "中村 玲奈", "小林 隼人", "加藤 美月", "吉田 悠真",
];

// ---- 時刻ユーティリティ（日本時間・分単位） ---------------------------

const dayStartMs = (date) => Date.parse(date + "T00:00:00+09:00");
const minToMs = (date, min) => dayStartMs(date) + min * 60000;
const msToMin = (date, ms) => Math.round((ms - dayStartMs(date)) / 60000);
const todayJst = () => new Date(Date.now() + 32400000 - 10800000).toISOString().slice(0, 10); // 3時切替
const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// 日付文字列から決まる簡易乱数（毎回同じ架空データを生成するため）
function seededRand(seedStr) {
  let h = 2166136261;
  for (const c of seedStr) h = (h ^ c.charCodeAt(0)) * 16777619 >>> 0;
  return () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
}

// ---- メモリ上の状態 ----------------------------------------------------

const state = {
  staff: STAFF_SEED.map((s, i) => ({
    id: s.id,
    name: s.name,
    gender: s.gender,
    active: 1,
    courses: "[]", // 空=全メニュー対応
    profile: JSON.stringify({ nickname: s.nickname, personalNomination: true, genderNomination: false, nominationFee: i % 2 ? 500 : 0, message: "", imageKey: "" }),
    sort_order: i + 1,
    profile_revision: 0,
  })),
  photos: new Map(),   // staffId -> dataURL
  days: new Map(),     // date -> {version, enabled}
  shifts: new Map(),   // date -> [{staff_id, date, start_at, end_at, note}]
  events: new Map(),   // date -> {bookings: [], blocks: [], assignments: []}
  notifications: [{ status: "pending", count: 0 }, { status: "cancelled", count: 0 }],
  bookingSerial: 100,
};

function ensureDay(date) {
  // version は 0 始まりにする。管理画面は未取得の日付の revision を 0 とみなして
  // 送ってくるため、1 始まりだと遠い将来の日付の一括シフト登録が必ず競合になってしまう。
  if (!state.days.has(date)) state.days.set(date, { version: 0, enabled: true });
  return state.days.get(date);
}

function ensureShifts(date) {
  if (state.shifts.has(date)) return state.shifts.get(date);
  const rand = seededRand("shift:" + date);
  const list = [];
  state.staff.forEach((s, i) => {
    if (rand() < 0.2) return; // 2割は休み
    const early = rand() < 0.5;
    const start = early ? 600 : 720 + (i % 2) * 60;   // 10:00 または 12:00/13:00
    const end = early ? 1200 + (i % 3) * 60 : 1620;   // 20〜22時 または 27:00
    list.push({ staff_id: s.id, date, start_at: minToMs(date, start), end_at: minToMs(date, end), note: "" });
  });
  state.shifts.set(date, list);
  return list;
}

function ensureEvents(date) {
  if (state.events.has(date)) return state.events.get(date);
  const rand = seededRand("event:" + date);
  const shifts = ensureShifts(date);
  const bookings = [], blocks = [], assignments = [];
  for (const sh of shifts) {
    const sStart = msToMin(date, sh.start_at), sEnd = msToMin(date, sh.end_at);
    // 休憩を1件（14時前後または18時前後）
    const brStart = Math.min(Math.max(sStart + 120, rand() < 0.5 ? 840 : 1080), sEnd - 60);
    if (brStart > sStart) {
      blocks.push({ id: "blk-" + date + "-" + sh.staff_id, staff_id: sh.staff_id, date, start_at: minToMs(date, brStart), end_at: minToMs(date, brStart + 60), kind: "break", note: "休憩" });
    }
    // 予約を1〜3件、シフト内で順番に配置
    let cursor = sStart + Math.floor(rand() * 4) * 30;
    const count = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) {
      const courseId = COURSE_IDS[Math.floor(rand() * COURSE_IDS.length)];
      const c = COURSES[courseId];
      const start = cursor + Math.floor(rand() * 3) * 30;
      const end = start + c.minutes;
      if (end > sEnd) break;
      if (start < brStart + 60 && end > brStart) { cursor = brStart + 60; k--; continue; }
      const people = rand() < 0.85 ? 1 : 2;
      const late = start >= 1320 ? 2000 * people : 0;
      const id = "bk-" + date + "-" + sh.staff_id + "-" + k;
      state.bookingSerial++;
      bookings.push({
        id, reference: "DM" + String(state.bookingSerial).padStart(6, "0"),
        service_date: date, status: "confirmed",
        start_at: minToMs(date, start), end_at: minToMs(date, end),
        people, course: courseId, course_name: c.name,
        name: CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)],
        email: "demo@example.com", phone: "090-0000-0000",
        comment: rand() < 0.3 ? "強めの圧を希望します。" : "",
        total: c.price * people + late, base_price: c.price,
        nomination_fee: 0, nominated_staff_id: null, nominated_staff_name: null,
      });
      assignments.push({ booking_id: id, staff_id: sh.staff_id });
      cursor = end + 15;
    }
  }
  const ev = { bookings, blocks, assignments };
  state.events.set(date, ev);
  return ev;
}

// スタッフの1日分の予定（予約・休憩・業務）が重ならないかを確認
function overlaps(date, staffId, start, end, ignoreId) {
  const ev = ensureEvents(date);
  const items = [
    ...ev.bookings.filter((b) => b.status === "confirmed" && ev.assignments.some((a) => a.booking_id === b.id && a.staff_id === staffId)),
    ...ev.blocks.filter((b) => b.staff_id === staffId),
  ];
  return items.some((it) => it.id !== ignoreId && msToMin(date, it.start_at) < end && msToMin(date, it.end_at) > start);
}

function shiftOf(date, staffId) {
  return ensureShifts(date).find((s) => s.staff_id === staffId);
}

function withinShift(date, staffId, start, end) {
  const sh = shiftOf(date, staffId);
  return !!sh && msToMin(date, sh.start_at) <= start && end <= msToMin(date, sh.end_at);
}

// ---- リクエスト処理 ----------------------------------------------------

function getSchedule(date) {
  const today = todayJst();
  const days = [], shifts = [];
  for (let i = -1; i <= 62; i++) {
    const d = addDays(date, i);
    const day = ensureDay(d);
    days.push({ date: d, version: day.version, enabled: day.enabled });
    if (d >= today) shifts.push(...ensureShifts(d));
  }
  const ev = ensureEvents(date);
  return {
    staff: [...state.staff].sort((a, b) => a.sort_order - b.sort_order),
    shifts,
    bookings: ev.bookings,
    blocks: ev.blocks,
    assignments: ev.assignments,
    days,
    mailReady: false, // デモではメール送信しない
    notifications: state.notifications,
  };
}

function err(code, message) {
  const e = new Error(message);
  e.status = code;
  return e;
}

function postSchedule(body) {
  const { action, date } = body;
  if (!action || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw err(400, "invalid");
  const day = ensureDay(date);
  const checkRevision = () => { if (body.revision !== day.version) throw err(409, "scheduleConflict"); };
  const bump = (d = date) => { ensureDay(d).version++; };

  switch (action) {
    case "shift": {
      checkRevision();
      const { staffId, start, end, remove } = body;
      if (!state.staff.some((s) => s.id === staffId)) throw err(400, "invalid");
      const list = ensureShifts(date);
      const idx = list.findIndex((s) => s.staff_id === staffId);
      if (remove) {
        if (overlaps(date, staffId, 0, 100000)) throw err(409, "scheduleConflict");
        if (idx >= 0) list.splice(idx, 1);
        bump();
        return { ok: true };
      }
      if (!(Number.isFinite(start) && Number.isFinite(end) && start < end)) throw err(400, "invalid");
      // 予約・休憩・業務が新しいシフトの外に残る短縮は保存しない
      const ev = ensureEvents(date);
      const mine = [
        ...ev.bookings.filter((b) => b.status === "confirmed" && ev.assignments.some((a) => a.booking_id === b.id && a.staff_id === staffId)),
        ...ev.blocks.filter((b) => b.staff_id === staffId),
      ];
      if (mine.some((it) => msToMin(date, it.start_at) < start || msToMin(date, it.end_at) > end)) throw err(409, "scheduleConflict");
      const rec = { staff_id: staffId, date, start_at: minToMs(date, start), end_at: minToMs(date, end), note: String(body.note ?? "") };
      if (idx >= 0) list[idx] = rec; else list.push(rec);
      bump();
      return { ok: true };
    }
    case "bulkShift": {
      const { start, end, cells } = body;
      if (!(Number.isFinite(start) && Number.isFinite(end) && start < end) || !Array.isArray(cells)) throw err(400, "invalid");
      for (const c of cells) {
        if (c.revision !== ensureDay(c.date).version) throw err(409, "scheduleConflict");
      }
      for (const c of cells) {
        const list = ensureShifts(c.date);
        const idx = list.findIndex((s) => s.staff_id === c.staffId);
        const ev = ensureEvents(c.date);
        const mine = [
          ...ev.bookings.filter((b) => b.status === "confirmed" && ev.assignments.some((a) => a.booking_id === b.id && a.staff_id === c.staffId)),
          ...ev.blocks.filter((b) => b.staff_id === c.staffId),
        ];
        if (mine.some((it) => msToMin(c.date, it.start_at) < start || msToMin(c.date, it.end_at) > end)) throw err(409, "scheduleConflict");
        const rec = { staff_id: c.staffId, date: c.date, start_at: minToMs(c.date, start), end_at: minToMs(c.date, end), note: "" };
        if (idx >= 0) list[idx] = rec; else list.push(rec);
        bump(c.date);
      }
      return { ok: true };
    }
    case "block": {
      checkRevision();
      const { staffId, start, end, kind, remove, id } = body;
      const ev = ensureEvents(date);
      if (remove) {
        const idx = ev.blocks.findIndex((b) => b.id === id);
        if (idx < 0) throw err(404, "notFound");
        ev.blocks.splice(idx, 1);
        bump();
        return { ok: true };
      }
      if (!state.staff.some((s) => s.id === staffId) || !(start < end) || ![`break`, `work`].includes(kind)) throw err(400, "invalid");
      if (!withinShift(date, staffId, start, end)) throw err(409, "outsideShift");
      if (overlaps(date, staffId, start, end, id)) throw err(409, "scheduleConflict");
      const rec = { id: id || "blk-" + Date.now(), staff_id: staffId, date, start_at: minToMs(date, start), end_at: minToMs(date, end), kind, note: String(body.note ?? "") };
      const idx = ev.blocks.findIndex((b) => b.id === rec.id);
      if (idx >= 0) ev.blocks[idx] = rec; else ev.blocks.push(rec);
      bump();
      return { ok: true };
    }
    case "moveBooking": {
      checkRevision();
      const { id, staffId, start, end } = body;
      const ev = ensureEvents(date);
      const bk = ev.bookings.find((b) => b.id === id && b.status === "confirmed");
      if (!bk) throw err(404, "notFound");
      if (!state.staff.some((s) => s.id === staffId)) throw err(400, "invalid");
      if (!withinShift(date, staffId, start, end)) throw err(409, "outsideShift");
      if (overlaps(date, staffId, start, end, id)) throw err(409, "soldOut");
      bk.start_at = minToMs(date, start);
      bk.end_at = minToMs(date, end);
      const late = start >= 1320 ? 2000 * bk.people : 0;
      bk.total = bk.base_price * bk.people + late + (bk.nomination_fee || 0);
      const as = ev.assignments.find((a) => a.booking_id === id);
      if (as) as.staff_id = staffId; else ev.assignments.push({ booking_id: id, staff_id: staffId });
      state.notifications.find((n) => n.status === "pending").count++;
      bump();
      return { ok: true };
    }
    case "createBooking": {
      checkRevision();
      const { staffId, start, course, people, consent } = body;
      const c = COURSES[course];
      if (!consent || !c || !state.staff.some((s) => s.id === staffId)) throw err(400, "invalid");
      const end = start + c.minutes;
      if (!withinShift(date, staffId, start, end)) throw err(409, "outsideShift");
      if (overlaps(date, staffId, start, end)) throw err(409, "soldOut");
      const ev = ensureEvents(date);
      state.bookingSerial++;
      const id = "bk-new-" + state.bookingSerial;
      const n = Number(people) || 1;
      ev.bookings.push({
        id, reference: "DM" + String(state.bookingSerial).padStart(6, "0"),
        service_date: date, status: "confirmed",
        start_at: minToMs(date, start), end_at: minToMs(date, end),
        people: n, course, course_name: c.name,
        name: String(body.name || "（店頭受付）"), email: String(body.email || ""), phone: String(body.phone || ""),
        comment: String(body.comment || ""),
        total: c.price * n + (start >= 1320 ? 2000 * n : 0), base_price: c.price,
        nomination_fee: 0, nominated_staff_id: null, nominated_staff_name: null,
      });
      ev.assignments.push({ booking_id: id, staff_id: staffId });
      state.notifications.find((n2) => n2.status === "pending").count++;
      bump();
      return { ok: true };
    }
    case "cancel": {
      checkRevision();
      const ev = ensureEvents(date);
      const bk = ev.bookings.find((b) => b.id === body.id && b.status === "confirmed");
      if (!bk) throw err(404, "notFound");
      bk.status = "cancelled";
      const idx = ev.assignments.findIndex((a) => a.booking_id === bk.id);
      if (idx >= 0) ev.assignments.splice(idx, 1);
      state.notifications.find((n) => n.status === "pending").count += 2; // お客様＋店舗
      bump();
      return { ok: true };
    }
    case "toggle": {
      checkRevision();
      day.enabled = !!body.enabled;
      bump();
      return { ok: true };
    }
    case "staff": {
      const p = body;
      if (!p.id || !p.name || ![`male`, `female`].includes(p.gender)) throw err(400, "invalid");
      const profile = { ...(p.profile || {}) };
      delete profile.nominationFeePending;
      if (p.photo) {
        state.photos.set(p.id, p.photo);
        profile.imageKey = "uploaded";
      } else if (p.photo === null) {
        state.photos.delete(p.id);
        profile.imageKey = "";
      }
      const rec = {
        id: p.id,
        name: String(p.name),
        gender: p.gender,
        active: p.active ? 1 : 0,
        courses: JSON.stringify(p.allCourses ? [] : p.courses || []),
        profile: JSON.stringify(profile),
        sort_order: Number(p.sortOrder) || 0,
        profile_revision: (Number(p.staffRevision) || 0) + 1,
      };
      const idx = state.staff.findIndex((s) => s.id === p.id);
      if (idx >= 0) state.staff[idx] = rec; else state.staff.push(rec);
      return { ok: true };
    }
    case "retryMail":
      return { ok: true };
    default:
      throw err(400, "invalid");
  }
}

// server.js から呼ばれる入口。処理した場合は true を返す。
function handleDemoApi(req, res, url) {
  if (url.pathname === "/api/demo/staff-photo") {
    const dataUrl = state.photos.get(url.searchParams.get("id") || "");
    if (!dataUrl) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "notFound" }));
      return true;
    }
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(dataUrl);
    if (!m) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalidImage" }));
      return true;
    }
    res.writeHead(200, { "Content-Type": m[1], "Cache-Control": "no-store" });
    res.end(Buffer.from(m[2], "base64"));
    return true;
  }

  if (url.pathname !== "/api/demo/schedule") return false;

  if (req.method === "GET" || req.method === "HEAD") {
    const date = url.searchParams.get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid" }));
      return true;
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify(getSchedule(date)));
    return true;
  }

  if (req.method === "POST") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try {
        const result = postSchedule(JSON.parse(raw || "{}"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(e.status || 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.status ? e.message : "unavailable" }));
      }
    });
    return true;
  }

  res.writeHead(405);
  res.end();
  return true;
}

module.exports = { handleDemoApi };
