// 予約フォームのフリーメッセージ欄に、管理画面の設定
// （表示・必須・見出し・placeholder・説明文・文字数制限）を反映する。
// React が描き直しても消えないよう、定期的に適用し直す。
(function () {
  "use strict";
  let settings = null;

  async function load() {
    try {
      const r = await fetch("/api/demo/settings", { cache: "no-store" });
      settings = (await r.json()).freeMessage || null;
    } catch {}
  }

  function apply() {
    if (!settings) return;
    const ta = document.querySelector('form.booking-form textarea[name="comment"]');
    if (!ta) return;
    const label = ta.closest("label");
    const fm = settings;
    if (label) label.style.display = fm.visible ? "" : "none";
    if (!fm.visible) return;
    if (fm.label && label && label.firstChild && label.firstChild.nodeType === 3 &&
        label.firstChild.textContent !== fm.label) {
      label.firstChild.textContent = fm.label;
    }
    if (ta.placeholder !== (fm.placeholder || "")) ta.placeholder = fm.placeholder || "";
    if (ta.maxLength !== (fm.maxLength || 2000)) ta.maxLength = fm.maxLength || 2000;
    if (ta.required !== !!fm.required) ta.required = !!fm.required;
    // 必須マークと説明文
    let note = label && label.querySelector(".fm-note");
    const noteText = (fm.required ? "（必須）" : "") + (fm.description ? " " + fm.description : "");
    if (noteText.trim()) {
      if (!note && label) {
        note = document.createElement("small");
        note.className = "fm-note";
        note.style.cssText = "display:block;color:#6b7280;font-size:12px;margin-top:4px;";
        label.appendChild(note);
      }
      if (note && note.textContent !== noteText.trim()) note.textContent = noteText.trim();
    } else if (note) {
      note.remove();
    }
  }

  load().then(apply);
  setInterval(() => { apply(); }, 700);
  setInterval(() => { load(); }, 15000);
})();
