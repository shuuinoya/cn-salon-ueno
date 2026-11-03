"use strict";
const crypto = require("node:crypto");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalize = value => String(value || "").normalize("NFKC").trim().toLowerCase();
function planVersion(plan) {
  return hash([plan.id, plan.name, plan.price, plan.uses, plan.valid_months || 12,
    plan.menu_scope ?? "all", plan.active, plan.revive !== false, plan.revive_group || ""]);
}
function row(id, name, email, phone, source) {
  // 検索のNFKC変換を会員の識別に使うと、全角メールを別会員へ結び付けてしまう。
  email = String(email || "").trim().toLowerCase();
  if (!String(name || "").trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const value = { id, name: String(name).trim(), email, phone: String(phone || ""), source };
  return { ...value, version: hash(value) };
}
function customer(state, id) {
  if (typeof id !== "string") return null;
  if (id.startsWith("member:")) {
    const m = state.members.get(id.slice(7));
    return m ? row(id, m.name, m.email, m.phone, "会員") : null;
  }
  return null;
}
function customers(state, query) {
  const q = normalize(query).slice(0, 120);
  if (q.length < 2) return [];
  const result = [], seen = new Set();
  const add = value => {
    if (!value || result.length >= 20) return;
    const identity = JSON.stringify([value.email, normalize(value.name), normalize(value.phone)]);
    if (seen.has(identity)) return;
    const text = normalize([value.name, value.email, value.phone].join(" "));
    if (!text.includes(q) && !text.replace(/[\s()-]/g, "").includes(q.replace(/[\s()-]/g, ""))) return;
    seen.add(identity); result.push(value);
  };
  for (const m of state.members.values()) add(row("member:" + m.email, m.name, m.email, m.phone, "会員"));
  return result;
}
module.exports = { planVersion, customer, customers };
