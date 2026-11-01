"use strict";
// 同行者には予約者本人を含めない。連絡先を追加収集しない。
function validateNames(value, people, err, required = true) {
  if (value === undefined && !required) return [];
  const names = value === undefined && people === 1 ? [] : value;
  if (!Array.isArray(names) || names.length !== people - 1 || names.some(name =>
    typeof name !== "string" || !name.trim() || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name))) throw err(400, "invalid");
  return names.map(name => name.trim());
}
function namesOf(bk) {
  return Array.isArray(bk.companion_names) ? bk.companion_names.filter(n => typeof n === "string").slice(0, Math.max(0, (bk.people || 1) - 1)) : [];
}
module.exports = { validateNames, namesOf };
