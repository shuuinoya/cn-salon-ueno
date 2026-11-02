import {r as runtime} from "./rolldown-runtime-hePW80VL.js";
import {i as framework,r as jsxRuntime} from "./framework-DTZGTDtF.js";
const React = runtime(framework(), 1), jsx = jsxRuntime();
const KEY = "cn-companion-names-v1";
const translate = (text, vars, language) => window.CNI18N?.t(text, vars, language) || text.replace(/\{n\}/g, vars?.n ?? "");
export function clearCompanionDraft() { try { sessionStorage.removeItem(KEY); } catch {} }
export function CompanionInputs({ people, language }) {
  const tr = (text, vars) => translate(text, vars, language);
  // 前の画面で入力された実名の下書きは再利用しない。
  React.useEffect(clearCompanionDraft, []);
  if (people < 2) return null;
  return jsx.jsxs("div", { className: "booking-companions", children: [
    jsx.jsx("h3", { children: tr("同行者") }),
    jsx.jsx("p", { className: "privacy-note", children: tr("同行者のお名前の入力は不要です。") }),
    jsx.jsx("ul", { children: Array.from({ length: people - 1 }, (_, i) =>
      jsx.jsx("li", { children: tr("同行者{n}", { n: i + 1 }) }, i)) })
  ] });
}
export function CompanionSummary({ names, language }) {
  const tr = (text, vars) => translate(text, vars, language);
  if (!Array.isArray(names) || !names.length) return null;
  return jsx.jsxs(jsx.Fragment, { children: [
    jsx.jsx("dt", { children: tr("同行者") }),
    jsx.jsx("dd", { children: names.map((name, i) => name === `同行者${i + 1}` ? tr("同行者{n}", { n: i + 1 }) : name).join(" / ") })
  ] });
}
