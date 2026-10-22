"use strict";
// 原本の階層スキルを管理用に保存する。販売メニューは明示ID対応だけで結び付ける。
const crypto = require("node:crypto");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validText = (v, max) => typeof v === "string" && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
function normalizeCatalog(input, courses, err) {
  const fail = () => { throw err(400, "staffSkillInvalid"); };
  if (!input || !Array.isArray(input.groups) || !input.groups.length || input.groups.length > 100) fail();
  const known = new Set(courses.map(c => c.id)), sourceIds = new Set(), courseIds = new Set(), groupIds = new Set();
  const groups = input.groups.map(group => {
    if (!group || !validText(group.id, 100) || groupIds.has(group.id) || !validText(group.name, 200) ||
        !Array.isArray(group.items) || !group.items.length) fail();
    groupIds.add(group.id);
    const items = group.items.map(item => {
      if (!item || typeof item.sourceId !== "string" || !/^\d{1,20}$/.test(item.sourceId) || sourceIds.has(item.sourceId) ||
          !validText(item.name, 1000) || !["male", "female", "none"].includes(item.gender)) fail();
      sourceIds.add(item.sourceId);
      const courseId = item.courseId == null ? null : item.courseId;
      if (courseId !== null && (typeof courseId !== "string" || !known.has(courseId) || courseIds.has(courseId))) fail();
      // 既存の自社IDは category-sourceID 形式。実IDの対応が違う指定は名称一致でも認めない。
      if (courseId !== null && /^\d+-\d+$/.test(courseId) && courseId.split("-").at(-1) !== item.sourceId) fail();
      const namedGender = item.name.includes("女性") ? "female" : item.name.includes("男性") ? "male" : "none";
      if (item.gender !== namedGender) fail();
      if (courseId !== null) courseIds.add(courseId);
      return { sourceId: item.sourceId, name: item.name, gender: item.gender, courseId };
    });
    return { id: group.id, name: group.name, items };
  });
  if (sourceIds.size > 500 || [...known].some(id => !courseIds.has(id))) fail();
  return { version: hash(groups), groups };
}
function itemsOf(catalog) { return catalog?.groups?.flatMap(g => g.items) || []; }
function validateSourceIds(catalog, checks, err) {
  if (!Array.isArray(checks) || checks.length > 500 || checks.some(x => typeof x !== "string") || new Set(checks).size !== checks.length) throw err(400, "staffSkillInvalid");
  const known = new Set(itemsOf(catalog).map(c => c.sourceId));
  if (checks.some(id => !known.has(id))) throw err(400, "staffSkillInvalid");
  return new Set(checks);
}
function validateChecks(catalog, checks, gender, err) {
  const selected = validateSourceIds(catalog, checks, err), items = itemsOf(catalog);
  if (items.some(item => selected.has(item.sourceId) && item.gender !== "none" && item.gender !== gender)) throw err(409, "staffCourseGender");
  // [] は既存システムでは「全対応」を意味する。販売対象が0件の設定をそこへ変換してはいけない。
  const courses = items.filter(item => item.courseId && selected.has(item.sourceId)).map(item => item.courseId);
  if (!courses.length) throw err(400, "noCourses");
  return courses;
}
function sameSet(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && new Set(a).size === a.length && a.every(x => b.includes(x)); }
function prepare(state, body, previous, gender, courses, actor, err) {
  if (!state.staffSkillCatalog) return null;
  if (!actor || !["admin", "manager"].includes(actor.role)) throw err(403, "forbidden");
  if (typeof body.requestKey !== "string" || !body.requestKey || body.requestKey.length > 150) throw err(400, "invalid");
  const { date, revision, requestKey, ...input } = body;
  const fingerprint = hash({ actor: actor.user, input });
  const seen = state.staffSkillKeys?.get(body.requestKey);
  if (seen) {
    if (seen.fingerprint !== fingerprint) throw err(409, "requestChanged");
    return { replay: { ...seen.result } };
  }
  // 現在の販売メニューも照合する。原本の名前から未知のメニュー対応を推測しない。
  const catalog = normalizeCatalog(state.staffSkillCatalog, courses, err);
  if (body.staffSkillCatalogVersion !== catalog.version) throw err(409, "staffSkillCatalogChanged");
  if (previous && body.staffRevision !== (previous.profile_revision || 0)) throw err(409, "staffChanged");
  const mapped = validateChecks(catalog, body.sourceSkillChecks, gender, err);
  if (body.allCourses === true || !sameSet(body.courses, mapped)) throw err(400, "staffSkillInvalid");
  return { courses: mapped, checks: itemsOf(catalog).filter(c => body.sourceSkillChecks.includes(c.sourceId)).map(c => c.sourceId), fingerprint };
}
function remember(state, body, prepared, result) {
  if (!prepared || prepared.replay) return result;
  if (!(state.staffSkillKeys instanceof Map)) state.staffSkillKeys = new Map();
  state.staffSkillKeys.set(body.requestKey, { fingerprint: prepared.fingerprint, result: { ...result } });
  while (state.staffSkillKeys.size > 100) state.staffSkillKeys.delete(state.staffSkillKeys.keys().next().value);
  return result;
}
module.exports = { normalizeCatalog, validateSourceIds, validateChecks, itemsOf, sameSet, prepare, remember };
