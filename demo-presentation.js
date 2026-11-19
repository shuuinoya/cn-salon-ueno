"use strict";
// デモの名前は応答のコピーだけに適用する。予約判定・保存データ・送信履歴には触れない。
const fs = require("node:fs"), crypto = require("node:crypto");
const sourceMenus = require("./demo-menu-source.json");
const LANGS = ["ja", "en", "zh", "ko", "fr", "es", "it", "de"];
const menuWords = ["【テスト】メニュー", "Test Menu ", "测试项目", "테스트 메뉴 ", "Soin test ", "Tratamiento de prueba ", "Trattamento di prova ", "Testbehandlung "];
const genders = {
  male: ["男性スタッフ", "Male therapist", "男性技师", "남성 직원", "Praticien homme", "Terapeuta hombre", "Operatore uomo", "Männliche Fachkraft"],
  female: ["女性スタッフ", "Female therapist", "女性技师", "여성 직원", "Praticienne femme", "Terapeuta mujer", "Operatrice donna", "Weibliche Fachkraft"],
};
const parseProfile = st => { try { return JSON.parse(st.profile || "{}"); } catch { return {}; } };
const pad = n => String(n).padStart(2, "0");
const genderOf = name => String(name).includes("女性") ? "female" : String(name).includes("男性") ? "male" : "none";
function menuLabel(n, gender, lang = "ja") {
  const i = Math.max(0, LANGS.indexOf(lang));
  return menuWords[i] + pad(n) + (genders[gender] ? (i === 0 ? "（" : " (") + genders[gender][i] + (i === 0 ? "）" : ")") : "");
}
function create(getState, getCourses, configFile) {
  let checkedAt = 0, config = null, cached = null, signature = "";
  function enabled() {
    if (process.env.DEMO_PRESENTATION === "1") return true;
    if (process.env.DEMO_PRESENTATION === "0") return false;
    if (!checkedAt || Date.now() - checkedAt > 500) {
      checkedAt = Date.now();
      try { config = JSON.parse(fs.readFileSync(configFile, "utf8")); } catch { config = null; }
    }
    return config?.enabled === true;
  }
  function context() {
    if (!enabled()) return null;
    const state = getState(), courses = getCourses();
    const sig = JSON.stringify([state.staff.map(s => [s.id, s.name, s.profile]), courses, state.staffSkillCatalog, hiddenPhotoIds()]);
    if (cached && signature === sig) return cached;
    signature = sig;
    const staff = new Map(), course = new Map(), skill = new Map(), groups = new Map(), replacements = new Map();
    const staffNames = new Map();
    [...state.staff].sort((a,b) => a.id.localeCompare(b.id)).forEach((s,i) => {
      const p = parseProfile(s), number = pad(i + 1), name = "デモスタッフ" + number;
      const profile = { ...p, nickname: name, familyName: "デモスタッフ", givenName: number,
        familyKana: "デモスタッフ", givenKana: number, furigana: "デモスタッフ" + number };
      if (photoHidden(s.id)) profile.imageKey = "";
      // 自己紹介中の本人名も置換。他人やお客様の名前を一括置換しない。
      for (const old of [s.name, p.nickname, [p.familyName, p.givenName].filter(Boolean).join(" "), p.givenName].filter(x => x && x.length >= 2)) {
        if (typeof profile.message === "string") profile.message = profile.message.split(old).join(name);
      }
      const entry = { name, number, nameLatin: "Demo Staff " + number, profile, original: s };
      staff.set(s.id, entry);
      for (const old of [s.name, p.nickname].filter(Boolean)) staffNames.set(old, name);
    });
    const all = new Map(sourceMenus.map(c => [c.id, { id: c.id, name: c.names.ja }]));
    courses.forEach(c => all.set(c.id, c));
    [...all.values()].sort((a,b) => a.id.localeCompare(b.id)).forEach((c,i) => {
      const gender = genderOf(c.name), names = Object.fromEntries(LANGS.map(l => [l, menuLabel(i+1, gender, l)]));
      course.set(c.id, { names, original: c });
      replacements.set(c.name, names.ja);
      const src = sourceMenus.find(x => x.id === c.id);
      if (src) for (const l of LANGS) replacements.set(src.names[l], names[l]);
    });
    let n = course.size;
    (state.staffSkillCatalog?.groups || []).forEach((g,i) => {
      groups.set(g.id, "テストカテゴリ" + pad(i+1));
      for (const item of g.items) {
        const name = course.get(item.courseId)?.names.ja || menuLabel(++n, item.gender);
        skill.set(item.sourceId, name);
        // 販売メニューと同名の原本項目は販売メニュー側を優先。
        if (!replacements.has(item.name)) replacements.set(item.name, name);
      }
    });
    const pairs = [...replacements].filter(([a,b]) => a && a !== b).sort((a,b) => b[0].length-a[0].length);
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = pairs.length ? new RegExp(pairs.map(([s]) => escape(s)).join("|"), "g") : null;
    const text = s => pattern ? s.replace(pattern, value => replacements.get(value)) : s;
    for (const entry of staff.values()) if (typeof entry.profile.message === "string") entry.profile.message = text(entry.profile.message);
    const staffText = s => s.split("、").map(x => staffNames.get(x) || x).join("、");
    cached = { staff, course, skill, groups, pairs, text, staffText,
      version: crypto.createHash("sha256").update(sig).digest("hex").slice(0,12) };
    return cached;
  }
  function project(value, c = context(), key = "") {
    if (!c || value == null) return value;
    if (typeof value === "string") {
      if (/^(staffName|staff_name|nominatedStaffName|nominated_staff_name|registeredName|display_name)$/.test(key)) return c.staffText(value);
      // 顧客名・連絡先・本人確認用文字列は対象外。
      if (/^(name|email|phone|token|customer_token|version|fingerprint|pass|subject|body|html)$/.test(key)) return value;
      return c.text(value);
    }
    if (Array.isArray(value)) return value.map(v => project(v,c,key));
    if (typeof value !== "object") return value;
    const out = Object.fromEntries(Object.entries(value).map(([k,v]) => [k,project(v,c,k)]));
    const st = c.staff.get(value.id);
    if (st) {
      for (const k of ["name","registeredName","display_name"]) if (k in out) out[k] = st.name;
      if ("nameLatin" in out) out.nameLatin = st.nameLatin;
      if ("message" in out) out.message = st.profile.message || "";
      if ("profile" in out) out.profile = typeof value.profile === "string" ? JSON.stringify(st.profile) : { ...st.profile };
      if (photoHidden(value.id)) {
        if ("photo" in out) out.photo = "";
        if ("hasPhoto" in out) out.hasPhoto = false;
      }
    }
    if (c.course.has(value.id) && "name" in out) out.name = c.course.get(value.id).names.ja;
    if (c.skill.has(value.sourceId) && "name" in out) out.name = c.skill.get(value.sourceId);
    if (c.groups.has(value.id) && Array.isArray(value.items)) out.name = c.groups.get(value.id);
    const nominated = c.staff.get(value.nominated_staff_id || value.nominatedStaffId);
    if (nominated) for (const k of ["nominated_staff_name","nominatedStaffName"]) if (k in out) out[k] = nominated.name;
    if (c.staff.has(value.staffId) && "staffName" in out) out.staffName = c.staff.get(value.staffId).name;
    const cid = value.courseId || value.course;
    if (c.course.has(cid)) {
      for (const k of ["course_name","courseName","menu"]) if (typeof out[k] === "string") out[k] = c.text(out[k]);
      if (value.courseId && "name" in out) out.name = c.course.get(cid).names.ja;
    }
    for (const k of ["course_name","courseName","menu","title"]) if (typeof out[k] === "string") out[k] = c.text(out[k]);
    return out;
  }
  // 編集画面から表示名がそのまま返ったときだけ元の値に戻す。別の項目の編集は通常どおり保存する。
  function restoreStaff(body) {
    const c = context(), st = c?.staff.get(body?.id);
    if (!st) return body;
    const result = { ...body }, old = parseProfile(st.original);
    if (result.name === st.name) result.name = st.original.name;
    if (result.profile && typeof result.profile === "object") {
      result.profile = { ...result.profile };
      for (const k of ["nickname","familyName","givenName","familyKana","givenKana","furigana","message","imageKey"]) {
        if (result.profile[k] === st.profile[k]) {
          if (k in old) result.profile[k] = old[k]; else delete result.profile[k];
        }
      }
    }
    return result;
  }
  function restoreCourse(body) {
    const c = context(), menu = c?.course.get(body?.id);
    return menu && body.name === menu.names.ja ? { ...body, name: menu.original.name } : body;
  }
  function hiddenPhotoIds() {
    return [...new Set([...(Array.isArray(config?.hiddenPhotoIds) ? config.hiddenPhotoIds : []),
      ...(process.env.DEMO_PRESENTATION_HIDE_PHOTOS || "").split(",").filter(Boolean)])];
  }
  function photoHidden(id) { return enabled() && hiddenPhotoIds().includes(id); }
  function asset(text) {
    const c = context(); if (!c) return text;
    // JSの文字列とHTMLの文字参照の両方。ID・URL・価格・分数は置換しない。
    if (!c.assetPattern) {
      c.assetVariants = new Map();
      for (const [a,b] of c.pairs) {
        c.assetVariants.set(a,b);
        c.assetVariants.set(a.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),b);
        c.assetVariants.set(JSON.stringify(a).slice(1,-1),JSON.stringify(b).slice(1,-1));
      }
      c.assetPattern = new RegExp([...c.assetVariants.keys()].sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|"),"g");
    }
    return text.replace(c.assetPattern, s => c.assetVariants.get(s));
  }
  function wrapResponse(res) {
    if (!enabled() || res.demoNameWrapped) return;
    res.demoNameWrapped = true;
    const end = res.end, head = res.writeHead;
    let json = false;
    res.writeHead = function(code, ...args) {
      for (const h of args) if (h && typeof h === "object") for (const [k,v] of Object.entries(h)) if (k.toLowerCase() === "content-type") json = /json/.test(v);
      return head.call(this,code,...args);
    };
    res.end = function(body, ...args) {
      if (body && (json || /json/.test(String(res.getHeader?.("Content-Type") || "")))) {
        body = JSON.stringify(project(JSON.parse(String(body))));
      }
      return end.call(this,body,...args);
    };
  }
  return { enabled, context, project, asset, restoreStaff, restoreCourse, wrapResponse, photoHidden,
    version: () => context()?.version || "normal" };
}
module.exports = { create, menuLabel };
