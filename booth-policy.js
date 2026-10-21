"use strict";

// 2026-10-21 の原本画面を読み取り確認した店舗設定。顧客情報は含めない。
// 既存の仮のブース名・HP・未割当は実在する部屋へ推測で置き換えない。
const SOURCE_BOOTHS = [
  {
    "active": true,
    "activeBegin": "2025-05-07",
    "capacity": 1,
    "code": "",
    "color": "Green",
    "female": true,
    "id": "109902",
    "male": true,
    "name": "新規1(1)",
    "online": true,
    "priceHouse": "",
    "shortName": "新規1(1)",
    "sort": 1,
    "terminal": true,
    "activeEnd": ""
  },
  {
    "active": true,
    "activeBegin": "2025-05-07",
    "capacity": 1,
    "code": "",
    "color": "Green",
    "female": true,
    "id": "109903",
    "male": true,
    "name": "新規1(2)",
    "online": true,
    "priceHouse": "",
    "shortName": "新規1(2)",
    "sort": 2,
    "terminal": true,
    "activeEnd": ""
  },
  {
    "active": true,
    "activeBegin": "2025-05-07",
    "capacity": 1,
    "code": "",
    "color": "Green",
    "female": true,
    "id": "109904",
    "male": true,
    "name": "新規1(3)",
    "online": true,
    "priceHouse": "",
    "shortName": "新規1(3)",
    "sort": 3,
    "terminal": true,
    "activeEnd": ""
  },
  {
    "active": true,
    "activeBegin": "2025-05-07",
    "capacity": 1,
    "code": "",
    "color": "Green",
    "female": true,
    "id": "109905",
    "male": true,
    "name": "新規1(4)",
    "online": true,
    "priceHouse": "",
    "shortName": "新規1(4)",
    "sort": 4,
    "terminal": true,
    "activeEnd": ""
  },
  {
    "active": true,
    "activeBegin": "2025-05-07",
    "capacity": 1,
    "code": "",
    "color": "Skyblue",
    "female": true,
    "id": "109906",
    "male": true,
    "name": "新規2(1)",
    "online": true,
    "priceHouse": "",
    "shortName": "新規2(1)",
    "sort": 5,
    "terminal": true,
    "activeEnd": ""
  },
  {
    "active": true,
    "activeBegin": "2025-05-07",
    "capacity": 1,
    "code": "",
    "color": "Skyblue",
    "female": true,
    "id": "109907",
    "male": true,
    "name": "新規2(2)",
    "online": true,
    "priceHouse": "",
    "shortName": "新規2(2)",
    "sort": 6,
    "terminal": true,
    "activeEnd": ""
  },
  {
    "active": true,
    "activeBegin": "2025-05-07",
    "capacity": 1,
    "code": "",
    "color": "Yellow",
    "female": true,
    "id": "109908",
    "male": true,
    "name": "ハイパーナイフ1",
    "online": true,
    "priceHouse": "",
    "shortName": "ハイパーナイフ1",
    "sort": 7,
    "terminal": true,
    "activeEnd": ""
  },
  {
    "active": true,
    "activeBegin": "2025-05-07",
    "capacity": 1,
    "code": "",
    "color": "Gold",
    "female": true,
    "id": "109909",
    "male": true,
    "name": "再来1(1)",
    "online": true,
    "priceHouse": "",
    "shortName": "再来1(1)",
    "sort": 8,
    "terminal": true,
    "activeEnd": ""
  },
  {
    "active": true,
    "activeBegin": "2025-05-07",
    "capacity": 1,
    "code": "",
    "color": "Gold",
    "female": true,
    "id": "109910",
    "male": true,
    "name": "再来1(2)",
    "online": true,
    "priceHouse": "",
    "shortName": "再来1(2)",
    "sort": 9,
    "terminal": true,
    "activeEnd": ""
  },
  {
    "active": true,
    "activeBegin": "2025-05-07",
    "capacity": 1,
    "code": "",
    "color": "Pink",
    "female": true,
    "id": "109911",
    "male": true,
    "name": "再来2(1)",
    "online": false,
    "priceHouse": "",
    "shortName": "再来2(1)",
    "sort": 10,
    "terminal": true,
    "activeEnd": ""
  },
  {
    "active": true,
    "activeBegin": "2025-05-07",
    "capacity": 1,
    "code": "",
    "color": "Pink",
    "female": true,
    "id": "109912",
    "male": true,
    "name": "再来2(2)",
    "online": false,
    "priceHouse": "",
    "shortName": "再来2(2)",
    "sort": 11,
    "terminal": true,
    "activeEnd": ""
  }
];
const SOURCE_COURSES = [
  {
    "ownId": "364321-4822671",
    "sourceId": "4822671",
    "name": "【本日限定】全身整体60分＋足裏マッサージ 60分 通常料金13200円→12000円",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 110,
    "minutesAfter": 5
  },
  {
    "ownId": "364321-4822710",
    "sourceId": "4822710",
    "name": "今月限定キャンペーン：男性スタッフオイルマッサージ 120分20500円→18500円",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 110,
    "minutesAfter": 5
  },
  {
    "ownId": "364321-4822711",
    "sourceId": "4822711",
    "name": "今月限定キャンペーン：女性スタッフオイルマッサージ 120分20500円→18500円",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 110,
    "minutesAfter": 5
  },
  {
    "ownId": "364326-4893798",
    "sourceId": "4893798",
    "name": "【★女性スタッフ】足裏マッサージ30分＋オイルマッサージ90分　120分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 110,
    "minutesAfter": 5
  },
  {
    "ownId": "364326-4893799",
    "sourceId": "4893799",
    "name": "【★男性スタッフ】足裏マッサージ30分＋オイルマッサージ90分　120分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 110,
    "minutesAfter": 5
  },
  {
    "ownId": "364326-4822708",
    "sourceId": "4822708",
    "name": "【男性スタッフ】オイルリンパマッサージ 60分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 50,
    "minutesAfter": 5
  },
  {
    "ownId": "364326-4823112",
    "sourceId": "4823112",
    "name": "【女性スタッフ】オイルリンパマッサージ 60分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910"
    ],
    "minutesBefore": 5,
    "minutesBody": 50,
    "minutesAfter": 5
  },
  {
    "ownId": "364326-4822709",
    "sourceId": "4822709",
    "name": "【男性スタッフ】オイルリンパマッサージ 90分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 80,
    "minutesAfter": 5
  },
  {
    "ownId": "364326-4823113",
    "sourceId": "4823113",
    "name": "【女性スタッフ】オイルリンパマッサージ 90分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 80,
    "minutesAfter": 5
  },
  {
    "ownId": "364326-4823102",
    "sourceId": "4823102",
    "name": "【人気No.1★男性スタッフ】極上の癒し☆オイルリンパマッサージ120分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 110,
    "minutesAfter": 5
  },
  {
    "ownId": "364326-4823114",
    "sourceId": "4823114",
    "name": "【人気No.1★女性スタッフ】極上の癒し☆オイルリンパマッサージ120分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 0,
    "minutesBody": 120,
    "minutesAfter": 0
  },
  {
    "ownId": "364326-4827938",
    "sourceId": "4827938",
    "name": "オススメ【男性スタッフ】腸もみオイルリンパマッサージ 120分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 110,
    "minutesAfter": 5
  },
  {
    "ownId": "364326-4827940",
    "sourceId": "4827940",
    "name": "オススメ【女性スタッフ】腸もみオイルリンパマッサージ 120分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 110,
    "minutesAfter": 5
  },
  {
    "ownId": "364326-4822715",
    "sourceId": "4822715",
    "name": "ハイパーナイフ6【ボディ＆フェイス】オイルマッサージと組み合わせが最適",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910"
    ],
    "minutesBefore": 0,
    "minutesBody": 20,
    "minutesAfter": 0
  },
  {
    "ownId": "364326-4921051",
    "sourceId": "4921051",
    "name": "出張マッサージ（120分）25,500円 施術内容はご要望に応じて自由にカスタマイズできます。",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 110,
    "minutesAfter": 5
  },
  {
    "ownId": "364328-4822716",
    "sourceId": "4822716",
    "name": "フェイシャル 60分 自然で明るい“本来の笑顔”を引き出し",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 0,
    "minutesBody": 60,
    "minutesAfter": 0
  },
  {
    "ownId": "364323-4822706",
    "sourceId": "4822706",
    "name": "タイ古式マッサージ",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 5,
    "minutesBody": 50,
    "minutesAfter": 5
  },
  {
    "ownId": "364323-4822664",
    "sourceId": "4822664",
    "name": "【当店人気メニュー】首肩コリ、頭痛な方にオススメ ヘッドスパ 60分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905"
    ],
    "minutesBefore": 5,
    "minutesBody": 50,
    "minutesAfter": 5
  },
  {
    "ownId": "364323-4822701",
    "sourceId": "4822701",
    "name": "全身整体 60分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 0,
    "minutesBody": 60,
    "minutesAfter": 0
  },
  {
    "ownId": "364325-4822707",
    "sourceId": "4822707",
    "name": "矯正整体(骨盤、姿勢、O脚) 60分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 0,
    "minutesBody": 60,
    "minutesAfter": 0
  },
  {
    "ownId": "364324-4822705",
    "sourceId": "4822705",
    "name": "小顔矯正 60分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910"
    ],
    "minutesBefore": 0,
    "minutesBody": 60,
    "minutesAfter": 0
  },
  {
    "ownId": "364327-4822712",
    "sourceId": "4822712",
    "name": "フットマッサージ(足湯＋足裏～ふくらぎ) 60分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910"
    ],
    "minutesBefore": 0,
    "minutesBody": 60,
    "minutesAfter": 0
  },
  {
    "ownId": "364329-4822717",
    "sourceId": "4822717",
    "name": "ハイパーナイフ6【ボディ】腹、背、腕、脚など 選べる1部位10分＋マッサージ10分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910"
    ],
    "minutesBefore": 0,
    "minutesBody": 20,
    "minutesAfter": 0
  },
  {
    "ownId": "364331-4822719",
    "sourceId": "4822719",
    "name": "シャワールーム 30分",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 0,
    "minutesBody": 30,
    "minutesAfter": 0
  },
  {
    "ownId": "364331-4822720",
    "sourceId": "4822720",
    "name": "レンタルルーム 60分　2500円",
    "boothIds": [
      "109902",
      "109903",
      "109904",
      "109905",
      "109906",
      "109907",
      "109908",
      "109909",
      "109910",
      "109911",
      "109912"
    ],
    "minutesBefore": 0,
    "minutesBody": 60,
    "minutesAfter": 0
  }
];
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const normalizeName = value => String(value || "").normalize("NFKC").replace(/\s+/g, "");
const enabled = (value, fallback = true) => value == null ? fallback : value === true || value === 1 || value === "1";
const list = value => value instanceof Map ? [...value.values()] : Array.isArray(value) ? value : [];
const copy = value => JSON.parse(JSON.stringify(value));

function resolveBooths(state = {}) {
  const rows = own(state, "booths") ? list(state.booths) : SOURCE_BOOTHS;
  return rows.map(b => ({
    ...b, id: String(b.id == null ? "" : b.id), name: String(b.name || ""),
    shortName: String(b.shortName || b.name || ""), capacity: Number(b.capacity == null ? 1 : b.capacity),
    active: enabled(b.active), online: enabled(b.online), terminal: enabled(b.terminal),
    male: enabled(b.male), female: enabled(b.female), sort: Number(b.sort == null ? b.sort_order || 0 : b.sort),
    activeBegin: String(b.activeBegin || ""), activeEnd: String(b.activeEnd || ""),
  })).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

function sourceCourse(course) {
  if (!course || typeof course !== "object") return null;
  const id = String(course.id || "");
  const sourceId = String(course.sourceId || course.peakManagerCourseId || "");
  return SOURCE_COURSES.find(c =>
    (c.ownId === id || c.sourceId === id || c.sourceId === sourceId) &&
    normalizeName(c.name) === normalizeName(course.name)) || null;
}

function resolveCourseBoothIds(course) {
  if (!course || typeof course !== "object") return null;
  if (own(course, "boothIds")) {
    if (!Array.isArray(course.boothIds) || course.boothIds.some(x => !["string", "number"].includes(typeof x) || !String(x))) return null;
    const ids = course.boothIds.map(String);
    return new Set(ids).size === ids.length ? ids : null;
  }
  const source = sourceCourse(course);
  return source ? [...source.boothIds] : null;
}

function sourceCourseTiming(course) {
  const keys = ["minutesBefore", "minutesBody", "minutesAfter"];
  if (course && keys.some(k => own(course, k))) {
    const values = keys.map(k => course[k]);
    return values.every(v => Number.isInteger(v) && v >= 0 && v % 5 === 0) && values[1] > 0 && values.reduce((a,b) => a+b,0) === course.minutes
      ? Object.fromEntries(keys.map((k,i) => [k,values[i]])) : null;
  }
  const source = sourceCourse(course);
  return source && (course.minutes == null || source.minutesBefore + source.minutesBody + source.minutesAfter === course.minutes)
    ? { minutesBefore: source.minutesBefore, minutesBody: source.minutesBody, minutesAfter: source.minutesAfter } : null;
}

function bookingBoothIds(booking) {
  if (own(booking, "booth_ids")) return Array.isArray(booking.booth_ids) ? booking.booth_ids.map(String) : [];
  if (own(booking, "boothIds")) return Array.isArray(booking.boothIds) ? booking.boothIds.map(String) : [];
  const single = booking && (booking.booth_id != null ? booking.booth_id : booking.boothId);
  return single == null || single === "" ? [] : [String(single)];
}

function eventRows(events) {
  if (events instanceof Map) return [...events.values()];
  if (Array.isArray(events)) return events.map(x => Array.isArray(x) ? x[1] : x);
  return events && typeof events === "object" ? Object.values(events) : [];
}

function dayStart(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return NaN;
  const ms = Date.parse(date + "T00:00:00+09:00");
  return Number.isFinite(ms) && new Date(ms + 9 * 3600000).toISOString().slice(0, 10) === date ? ms : NaN;
}

function validDateBound(value) { return value === "" || Number.isFinite(dayStart(value)); }
function fail(code) { return { ok: false, code, booths: [] }; }

// start/end は営業日からの分、予約は絶対時刻msで比較する。全日を調べて日跨ぎを取りこぼさない。
// booth_ids は1人に1室。人数分の異なる室を返し、同室に複数名を勝手に詰め込まない。
function boothAvailability(options = {}) {
  const { state = {}, course, date, start, end, online = false, excludeBookingId, gender } = options;
  const people = options.people == null ? 1 : options.people;
  const midnight = dayStart(date);
  if (!Number.isFinite(midnight) || !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end > 2880 || end <= start || !Number.isInteger(people) || people < 1 || people > 100) return fail("invalid");
  const booths = resolveBooths(state), known = new Map(booths.map(b => [b.id, b]));
  if (!booths.length || known.size !== booths.length || booths.some(b =>
    !b.id || !b.name || !Number.isInteger(b.capacity) || b.capacity < 1 || !Number.isFinite(b.sort) ||
    !validDateBound(b.activeBegin) || !validDateBound(b.activeEnd) ||
    (b.activeBegin && b.activeEnd && b.activeEnd < b.activeBegin))) return fail("boothConfiguration");
  const allowed = resolveCourseBoothIds(course);
  if (allowed == null) return fail("boothPolicyMissing");
  if (allowed.some(id => !known.has(id))) return fail("boothConfiguration");
  const eligible = booths.filter(b => allowed.includes(b.id) && b.active &&
    (online ? b.online : b.terminal) &&
    (!b.activeBegin || b.activeBegin <= date) && (!b.activeEnd || b.activeEnd >= date) &&
    (gender === "male" ? b.male : gender === "female" ? b.female : b.male && b.female));
  let requested = null;
  if (own(options, "boothIds")) {
    if (!Array.isArray(options.boothIds) || options.boothIds.some(x => !["string", "number"].includes(typeof x))) return fail("invalidBooth");
    requested = options.boothIds.map(String);
  } else if (options.boothId != null && options.boothId !== "") requested = [String(options.boothId)];
  if (requested && (requested.length !== people || new Set(requested).size !== requested.length ||
      requested.some(id => !eligible.some(b => b.id === id)))) return fail("invalidBooth");
  const startMs = midnight + start * 60000, endMs = midnight + end * 60000;
  const occupied = new Map(booths.map(b => [b.id, []]));
  const seen = new Set();
  for (const ev of eventRows(state.events)) for (const b of (ev && ev.bookings) || []) {
    if (b.status !== "confirmed" || (excludeBookingId != null && String(b.id) === String(excludeBookingId))) continue;
    if (!Number.isFinite(b.start_at) || !Number.isFinite(b.end_at) || b.end_at <= b.start_at) return fail("unknownOccupancy");
    if (b.start_at >= endMs || b.end_at <= startMs) continue;
    if (!b.id || seen.has(b.id)) return fail("unknownOccupancy");
    seen.add(b.id);
    const ids = bookingBoothIds(b), count = b.people == null ? 1 : Number(b.people);
    if (!Number.isInteger(count) || count < 1 || ids.length !== count ||
        new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) return fail("unknownOccupancy");
    for (const id of ids) occupied.get(id).push([Math.max(startMs, b.start_at), Math.min(endMs, b.end_at)]);
  }
  // 互いに重ならない既存予約を合算して満室扱いにしない。端点が一致する入替も許可。
  const available = eligible.filter(b => {
    const points = occupied.get(b.id).flatMap(([s, e]) => [[s, 1], [e, -1]]).sort((a, z) => a[0] - z[0] || a[1] - z[1]);
    let n = 0;
    for (const [, delta] of points) { n += delta; if (n >= b.capacity) return false; }
    return true;
  });
  const chosen = requested ? requested.map(id => available.find(b => b.id === id)).filter(Boolean) : available.slice(0, people);
  if (chosen.length !== people) return fail("boothSoldOut");
  return { ok: true, code: null, booths: chosen.map(b => ({ ...b })), booth: { ...chosen[0] }, availableBooths: available.map(b => ({ ...b })) };
}

// 設定変更の下書き検証。現 state / 予約 / コースを直接変更しない。
function validateConfiguration(state, next, options = {}) {
  const bad = code => ({ ok: false, code, booths: [] });
  if (!next || !Array.isArray(next.booths) || !Array.isArray(next.courses) || next.booths.length > 200) return bad("invalidBoothConfiguration");
  const colors = new Set(["Green", "Pink", "Yellow", "Gold", "Skyblue", "Purple", "Lime", "Deeppink", "Chocolate", "Seagreen"]);
  const flags = ["active", "online", "terminal", "male", "female"];
  for (const b of next.booths) {
    if (!b || typeof b !== "object" || !/^[a-zA-Z0-9_-]{1,80}$/.test(String(b.id || "")) ||
        typeof b.name !== "string" || !b.name.trim() || b.name.length > 100 ||
        (b.shortName != null && (typeof b.shortName !== "string" || !b.shortName.trim() || b.shortName.length > 100)) ||
        (b.code != null && (typeof b.code !== "string" || b.code.length > 100)) ||
        !Number.isInteger(Number(b.capacity)) || Number(b.capacity) < 1 || Number(b.capacity) > 100 ||
        !Number.isSafeInteger(Number(b.sort == null ? b.sort_order || 0 : b.sort)) ||
        Number(b.sort == null ? b.sort_order || 0 : b.sort) < 0 ||
        (b.priceHouse != null && b.priceHouse !== "" && (!Number.isSafeInteger(Number(b.priceHouse)) || Number(b.priceHouse) < 0)) ||
        (b.color != null && !colors.has(b.color)) ||
        flags.some(k => b[k] != null && ![true, false, 0, 1, "0", "1"].includes(b[k]))) return bad("invalidBoothConfiguration");
  }
  const booths = resolveBooths({ booths: next.booths });
  const ids = new Set(booths.map(b => b.id));
  if (ids.size !== booths.length || booths.some(b => !validDateBound(b.activeBegin) || !validDateBound(b.activeEnd) ||
      (b.activeBegin && b.activeEnd && b.activeEnd < b.activeBegin))) return bad("invalidBoothConfiguration");
  const courses = [], courseIds = new Set();
  for (const c of next.courses) {
    if (!c || !c.id || courseIds.has(String(c.id))) return bad("invalidBoothConfiguration");
    courseIds.add(String(c.id));
    const allowed = resolveCourseBoothIds(c);
    if (own(c, "boothIds") && allowed == null) return bad("boothPolicyMissing");
    if (allowed && allowed.some(id => !ids.has(id))) return bad("invalidBoothConfiguration");
    courses.push({ ...c, ...(allowed ? { boothIds: allowed } : {}) });
  }
  const previousIds = new Set(resolveBooths(state).map(b => b.id));
  const removed = new Set([...previousIds].filter(id => !ids.has(id)));
  const courseById = new Map(courses.map(c => [String(c.id), c]));
  const byId = new Map(booths.map(b => [b.id, b]));
  const now = options.now == null ? Date.now() : options.now;
  if (!Number.isFinite(now)) return bad("invalidBoothConfiguration");
  const occupancy = new Map(booths.map(b => [b.id, []]));
  for (const ev of eventRows(state.events)) for (const b of (ev && ev.bookings) || []) {
    const assigned = bookingBoothIds(b);
    if (assigned.some(id => removed.has(id))) return bad("boothInUse");
    if (b.status !== "confirmed" || !Number.isFinite(b.end_at) || b.end_at <= now) continue;
    // 原本から引き継いだ未割当や仮名は、この設定保存で解決したことにしない。
    const known = assigned.filter(id => previousIds.has(id));
    if (!known.length) continue;
    if (!Number.isFinite(b.start_at) || b.end_at <= b.start_at || new Set(known).size !== known.length) return bad("futureBookingConflict");
    const d = b.service_date || new Date(b.start_at + 9 * 3600000).toISOString().slice(0, 10);
    const serviceIds = Array.isArray(b.services) && b.services.length ? b.services.map(s => String(s.courseId || "")) : [String(b.course)];
    const restrictions = serviceIds.map(id => resolveCourseBoothIds(courseById.get(id)));
    if (restrictions.some(allowed => allowed == null)) return bad("boothPolicyMissing");
    const allowed = restrictions.reduce((both, next) => both.filter(id => next.includes(id)));
    for (const id of known) {
      const room = byId.get(id), g = b.customer_gender;
      if (!room || !room.active || !allowed.includes(id) || (room.activeBegin && room.activeBegin > d) ||
          (room.activeEnd && room.activeEnd < d) || (g === "male" ? !room.male : g === "female" ? !room.female : !room.male || !room.female)) return bad("futureBookingConflict");
      occupancy.get(id).push([Math.max(now, b.start_at), b.end_at]);
    }
  }
  for (const [id, spans] of occupancy) {
    let n = 0;
    const points = spans.flatMap(([s, e]) => [[s, 1], [e, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, delta] of points) { n += delta; if (n > byId.get(id).capacity) return bad("futureBookingConflict"); }
  }
  return { ok: true, booths, courses };
}

module.exports = {
  resolveBooths, resolveCourseBoothIds, sourceCourseTiming, bookingBoothIds, boothAvailability, validateConfiguration,
  sourceDefaults: () => ({ booths: copy(SOURCE_BOOTHS), courses: copy(SOURCE_COURSES) }),
};
