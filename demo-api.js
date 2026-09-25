// 管理画面（操作デモ）用のモックAPIです。
// 元サイトの /api/demo/schedule 相当を、保存版のためにメモリ上の架空データで再現します。
// サーバーを再起動するとデータは初期状態に戻ります。
"use strict";

// ---- 架空データの素材 -------------------------------------------------

const COURSES = {
  "364321-4822671": { name: "【本日限定】全身整体60分＋足裏マッサージ 60分 通常料金13200円→12000円", price: 12000, minutes: 120 },
  "364321-4822710": { name: "今月限定キャンペーン：男性スタッフオイルマッサージ 120分20500円→18500円", price: 18500, minutes: 120 },
  "364321-4822711": { name: "今月限定キャンペーン：女性スタッフオイルマッサージ 120分20500円→18500円", price: 18500, minutes: 120 },
  "364326-4893798": { name: "【★女性スタッフ】足裏マッサージ30分＋オイルマッサージ90分　120分", price: 20500, minutes: 120 },
  "364326-4893799": { name: "【★男性スタッフ】足裏マッサージ30分＋オイルマッサージ90分　120分", price: 20500, minutes: 120 },
  "364326-4822708": { name: "【男性スタッフ】オイルリンパマッサージ 60分", price: 11500, minutes: 60 },
  "364326-4823112": { name: "【女性スタッフ】オイルリンパマッサージ 60分", price: 11500, minutes: 60 },
  "364326-4822709": { name: "【男性スタッフ】オイルリンパマッサージ 90分", price: 16500, minutes: 90 },
  "364326-4823113": { name: "【女性スタッフ】オイルリンパマッサージ 90分", price: 16500, minutes: 90 },
  "364326-4823102": { name: "【人気No.1★男性スタッフ】極上の癒し☆オイルリンパマッサージ120分", price: 20500, minutes: 120 },
  "364326-4823114": { name: "【人気No.1★女性スタッフ】極上の癒し☆オイルリンパマッサージ120分", price: 20500, minutes: 120 },
  "364326-4827938": { name: "オススメ【男性スタッフ】腸もみオイルリンパマッサージ 120分", price: 23500, minutes: 120 },
  "364326-4827940": { name: "オススメ【女性スタッフ】腸もみオイルリンパマッサージ 120分", price: 23500, minutes: 120 },
  "364326-4822715": { name: "ハイパーナイフ6【ボディ＆フェイス】オイルマッサージと組み合わせが最適", price: 4000, minutes: 20 },
  "364326-4921051": { name: "出張マッサージ（120分）25,500円 施術内容はご要望に応じて自由にカスタマイズできます。", price: 25500, minutes: 120 },
  "364328-4822716": { name: "フェイシャル 60分 自然で明るい“本来の笑顔”を引き出し", price: 9900, minutes: 60 },
  "364323-4822706": { name: "タイ古式マッサージ", price: 8800, minutes: 60 },
  "364323-4822664": { name: "【当店人気メニュー】首肩コリ、頭痛な方にオススメ ヘッドスパ 60分", price: 7700, minutes: 60 },
  "364323-4822701": { name: "全身整体 60分", price: 6600, minutes: 60 },
  "364325-4822707": { name: "矯正整体(骨盤、姿勢、O脚) 60分", price: 7700, minutes: 60 },
  "364324-4822705": { name: "小顔矯正 60分", price: 9900, minutes: 60 },
  "364327-4822712": { name: "フットマッサージ(足湯＋足裏～ふくらぎ) 60分", price: 6600, minutes: 60 },
  "364329-4822717": { name: "ハイパーナイフ6【ボディ】腹、背、腕、脚など 選べる1部位10分＋マッサージ10分", price: 4000, minutes: 20 },
  "364331-4822719": { name: "シャワールーム 30分", price: 1000, minutes: 30 },
  "364331-4822720": { name: "レンタルルーム 60分　2500円", price: 2500, minutes: 60 },
};
const COURSE_IDS = Object.keys(COURSES);

const STAFF_SEED = [
  { id: "aaaaaa01-0000-4000-8000-000000000001", name: "豊", gender: "male", nickname: "" },
  { id: "aaaaaa02-0000-4000-8000-000000000002", name: "中山 優吾", gender: "male", nickname: "" },
  { id: "aaaaaa03-0000-4000-8000-000000000003", name: "平良 陽太", gender: "male", nickname: "" },
  { id: "aaaaaa04-0000-4000-8000-000000000004", name: "酒井 勝也", gender: "male", nickname: "" },
  { id: "aaaaaa05-0000-4000-8000-000000000005", name: "藤倉 和美", gender: "female", nickname: "" },
  { id: "aaaaaa06-0000-4000-8000-000000000006", name: "山崎琢心", gender: "male", nickname: "" },
  { id: "aaaaaa07-0000-4000-8000-000000000007", name: "小林 楓也", gender: "male", nickname: "" },
  { id: "aaaaaa08-0000-4000-8000-000000000008", name: "川井", gender: "female", nickname: "" },
  { id: "aaaaaa09-0000-4000-8000-000000000009", name: "山田 恵", gender: "female", nickname: "" },
  { id: "aaaaaa10-0000-4000-8000-000000000010", name: "中村敏樹", gender: "male", nickname: "" },
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
  bookingIndex: new Map(), // 予約ID -> 日付
  requestKeys: new Map(),  // 予約サイトの多重送信防止キー -> 結果
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
    let start, end;
    if (s.id === "aaaaaa09-0000-4000-8000-000000000009") {        // 山田 恵：夜シフト固定
      start = 1080; end = 1620;
    } else if (s.id === "aaaaaa10-0000-4000-8000-000000000010") { // 中村敏樹：終日シフト固定
      start = 600; end = 1620;
    } else {
      if (rand() < 0.25) return; // 一部は休み
      const early = rand() < 0.5;
      start = early ? 600 : 720 + (i % 2) * 60;      // 10:00 または 12:00/13:00
      end = early ? 1200 + (i % 3) * 60 : 1620;      // 20〜22時 または 27:00
    }
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
    // 架空のお客様の予約は自動生成しない（実際に入れた予約だけが台帳に載る）
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
        staff: "none", customer_token: null,
      });
      state.bookingIndex.set(id, date);
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


// ---- 予約サイト用の公開API（管理画面と同じデータを参照） -----------------

// コース名からの性別指定（予約サイト側と同じ判定）
function courseGender(courseId) {
  const name = COURSES[courseId]?.name || "";
  return name.includes("女性") ? "female" : name.includes("男性") ? "male" : "none";
}

function staffCanDo(st, courseId) {
  const list = JSON.parse(st.courses || "[]");
  return list.length === 0 || list.includes(courseId);
}

function profileOf(st) {
  try { return JSON.parse(st.profile || "{}"); } catch { return {}; }
}

// 指名候補スタッフ一覧（受付中・個人指名あり・コース対応・性別条件）
function nominatableStaff(courseId, genderPref) {
  return state.staff
    .filter((st) => st.active === 1 && staffCanDo(st, courseId))
    .filter((st) => genderPref === "none" || st.gender === genderPref)
    .filter((st) => profileOf(st).personalNomination)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((st) => {
      const pr = profileOf(st);
      return {
        id: st.id,
        name: pr.nickname || st.name,
        nominationFee: Number(pr.nominationFee) || 0,
        revision: st.profile_revision || 0,
        hasPhoto: state.photos.has(st.id),
        message: pr.message || "",
      };
    });
}

// 指定時間帯に施術できるスタッフID一覧
function freeStaffIds(date, startMin, endMin, courseId, genderPref) {
  const shifts = ensureShifts(date);
  const ev = ensureEvents(date);
  const busy = (staffId) => {
    const items = [
      ...ev.bookings.filter((b) => b.status === "confirmed" && ev.assignments.some((a) => a.booking_id === b.id && a.staff_id === staffId)),
      ...ev.blocks.filter((b) => b.staff_id === staffId),
    ];
    return items.some((it) => msToMin(date, it.start_at) < endMin && msToMin(date, it.end_at) > startMin);
  };
  return state.staff
    .filter((st) => st.active === 1 && staffCanDo(st, courseId))
    .filter((st) => genderPref === "none" || st.gender === genderPref)
    .filter((st) => {
      const sh = shifts.find((x) => x.staff_id === st.id);
      return sh && msToMin(date, sh.start_at) <= startMin && endMin <= msToMin(date, sh.end_at);
    })
    .filter((st) => !busy(st.id))
    .map((st) => st.id);
}

function nowMinJst() {
  const t = todayJst();
  return Math.round((Date.now() - dayStartMs(t)) / 60000);
}

function getAvailability(q) {
  const courseId = q.get("course");
  const date = q.get("date");
  const people = Number(q.get("people"));
  const pref = q.get("staff") || "none";
  const staffId = q.get("staffId") || "";
  const course = COURSES[courseId];
  const today = todayJst();
  if (!course || !/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !(people >= 1 && people <= 3) ||
      !["none", "male", "female"].includes(pref)) throw err(400, "invalid");
  const dur = course.minutes;
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(date, i);
    const day = ensureDay(d);
    const open = day.enabled && d >= today && d <= addDays(today, 84);
    const slots = [];
    for (let m = 600; m <= 1500; m += 10) {
      let ok = open;
      if (ok && d === today && m <= nowMinJst()) ok = false; // 過ぎた時間は不可
      if (ok) {
        const free = freeStaffIds(d, m, m + dur, courseId, pref);
        ok = free.length >= people && (!staffId || free.includes(staffId));
      }
      slots.push({ minute: m, available: ok, start: minToMs(d, m) });
    }
    days.push({ date: d, enabled: day.enabled, slots });
  }
  return { staff: nominatableStaff(courseId, pref), days };
}

function createPublicBooking(body) {
  const course = COURSES[body.course];
  const date = body.date;
  const people = Number(body.people);
  const pref = ["none", "male", "female"].includes(body.staff) ? body.staff : "none";
  const staffId = String(body.staffId || "");
  if (String(body.website || "")) throw err(400, "invalid"); // ボット対策の隠し欄
  if (!course || !/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !(people >= 1 && people <= 3) ||
      body.consent !== true || !String(body.name || "").trim() || !String(body.email || "").trim() ||
      !String(body.phone || "").trim()) throw err(400, "invalid");
  const today = todayJst();
  if (date < today || date > addDays(today, 84)) throw err(400, "invalid");
  if (!ensureDay(date).enabled) throw err(409, "soldOut");
  const m = Math.round((Number(body.start) - dayStartMs(date)) / 60000);
  if (!(Number.isInteger(m) && m >= 600 && m <= 1500 && m % 5 === 0)) throw err(400, "invalid");
  if (date === today && m <= nowMinJst()) throw err(409, "soldOut");

  // 多重送信は同じ結果を返す
  const rk = String(body.requestKey || "");
  if (rk && state.requestKeys.has(rk)) return state.requestKeys.get(rk);

  let nominated = null;
  if (staffId) {
    nominated = nominatableStaff(body.course, pref).find((st) => st.id === staffId);
    if (!nominated) throw err(409, "staffUnavailable");
    if (Number(body.expectedNominationFee) !== nominated.nominationFee) throw err(409, "priceChanged");
  }
  const dur = course.minutes;
  const free = freeStaffIds(date, m, m + dur, body.course, pref);
  if (free.length < people || (staffId && !free.includes(staffId))) throw err(409, "soldOut");

  const assignee = staffId || free[0];
  state.bookingSerial++;
  const id = "web-" + state.bookingSerial + "-" + Math.random().toString(16).slice(2, 8);
  const token = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  const late = m >= 1320 ? 2000 * people : 0;
  const fee = nominated ? nominated.nominationFee : 0;
  const ev = ensureEvents(date);
  ev.bookings.push({
    id, reference: "2472" + String(state.bookingSerial).padStart(5, "0"),
    service_date: date, status: "confirmed",
    start_at: minToMs(date, m), end_at: minToMs(date, m + dur),
    people, course: body.course, course_name: course.name,
    name: String(body.name).slice(0, 120), email: String(body.email).slice(0, 254),
    phone: String(body.phone).slice(0, 40), comment: String(body.comment || "").slice(0, 2000),
    total: course.price * people + late + fee, base_price: course.price,
    nomination_fee: fee, nominated_staff_id: nominated ? nominated.id : null,
    nominated_staff_name: nominated ? nominated.name : null,
    staff: pref, customer_token: token, language: String(body.language || "ja"),
  });
  ev.assignments.push({ booking_id: id, staff_id: assignee });
  state.bookingIndex.set(id, date);
  state.notifications.find((n) => n.status === "pending").count += 2; // お客様＋店舗
  ensureDay(date).version++;
  const result = { id, token };
  if (rk) state.requestKeys.set(rk, result);
  return result;
}

function getPublicBooking(id, token) {
  const date = state.bookingIndex.get(id || "");
  if (!date) throw err(404, "notFound");
  const bk = ensureEvents(date).bookings.find((b) => b.id === id);
  if (!bk || !bk.customer_token || bk.customer_token !== token) throw err(404, "notFound");
  return {
    booking: {
      id: bk.id, reference: bk.reference, status: bk.status,
      start: bk.start_at, courseId: bk.course, courseName: bk.course_name,
      name: bk.name, people: bk.people, staff: bk.staff || "none",
      nominatedStaffName: bk.nominated_staff_name, nominationFee: bk.nomination_fee,
      total: bk.total,
    },
    notifications: [{ kind: "customer", status: "pending" }, { kind: "store", status: "pending" }],
  };
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

  // ---- 予約サイト用の公開エンドポイント ----
  if (url.pathname === "/api/availability" && (req.method === "GET" || req.method === "HEAD")) {
    try {
      const data = getAvailability(url.searchParams);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(data));
    } catch (e) {
      res.writeHead(e.status || 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.status ? e.message : "unavailable" }));
    }
    return true;
  }
  if (url.pathname === "/api/staff" && (req.method === "GET" || req.method === "HEAD")) {
    const courseId = url.searchParams.get("course");
    const pref = url.searchParams.get("staff") || "none";
    if (!COURSES[courseId] || !["none", "male", "female"].includes(pref)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid" }));
      return true;
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({ staff: nominatableStaff(courseId, pref) }));
    return true;
  }
  if (url.pathname === "/api/staff/photo") {
    const dataUrl = state.photos.get(url.searchParams.get("id") || "");
    const m2 = dataUrl && /^data:(image\/[a-z+]+);base64,(.*)$/.exec(dataUrl);
    if (!m2) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "notFound" }));
      return true;
    }
    res.writeHead(200, { "Content-Type": m2[1], "Cache-Control": "no-store" });
    res.end(Buffer.from(m2[2], "base64"));
    return true;
  }
  if (url.pathname === "/api/bookings") {
    if (req.method === "GET" || req.method === "HEAD") {
      try {
        const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        const data = getPublicBooking(url.searchParams.get("id"), token);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(req.method === "HEAD" ? undefined : JSON.stringify(data));
      } catch (e) {
        res.writeHead(e.status || 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.status ? e.message : "unavailable" }));
      }
      return true;
    }
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on("end", () => {
        try {
          const result = createPublicBooking(JSON.parse(raw || "{}"));
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
