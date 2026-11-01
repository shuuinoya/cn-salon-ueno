import {r as runtime} from "./rolldown-runtime-hePW80VL.js";
import {i as framework,r as jsxRuntime} from "./framework-DTZGTDtF.js";
const React = runtime(framework(), 1), jsx = jsxRuntime();
const KEY = "cn-companion-names-v1";
const translate = (text, vars, language) => window.CNI18N?.t(text, vars, language) || text.replace(/\{n\}/g, vars?.n ?? "");
function loadDraft() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY));
    if (saved?.at > Date.now() - 30 * 60000 && Array.isArray(saved.names)) return saved.names.slice(0, 2).map(n => typeof n === "string" ? n.slice(0, 120) : "");
    sessionStorage.removeItem(KEY);
  } catch {}
  return [];
}
export function clearCompanionDraft() { try { sessionStorage.removeItem(KEY); } catch {} }
export function CompanionInputs({ people, language }) {
  const tr = (text, vars) => translate(text, vars, language);
  const [names, setNames] = React.useState(loadDraft);
  // Component state survives language changes; session draft survives back/reload.
  const change = (index, field) => {
    const next = [...names]; next[index] = field.value;
    field.setCustomValidity(field.value.trim() ? "" : tr("同行者のお名前を入力してください。"));
    setNames(next);
    try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), names: next })); } catch {}
  };
  if (people < 2) return null;
  return jsx.jsxs("div", { className: "booking-companions", children: [
    jsx.jsx("h3", { children: tr("同行者のお名前") }),
    jsx.jsx("p", { className: "privacy-note", children: tr("予約者ご本人以外の方は、お名前のみ入力してください。") }),
    ...Array.from({ length: people - 1 }, (_, i) => jsx.jsxs("label", { children: [
      tr("同行者{n}のお名前", { n: i + 1 }),
      jsx.jsx("input", { name: "companionName", autoComplete: "off", maxLength: 120, required: true,
        value: names[i] || "", onChange: event => change(i, event.target) })
    ] }, i))
  ] });
}
export function CompanionSummary({ names, language }) {
  const tr = (text, vars) => translate(text, vars, language);
  if (!Array.isArray(names) || !names.length) return null;
  return jsx.jsxs(jsx.Fragment, { children: names.flatMap((name, i) => [
    jsx.jsx("dt", { children: tr("同行者{n}のお名前", { n: i + 1 }) }, "dt" + i),
    jsx.jsx("dd", { children: name }, "dd" + i)
  ]) });
}
