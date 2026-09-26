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

  // ---- マイページ連携：予約成立時に予約ID・トークンをこのブラウザに記録する ----
  const MYKEY = "cn-mypage";
  const store = () => { try { return JSON.parse(localStorage.getItem(MYKEY) || "[]"); } catch { return []; } };
  const saveStore = (list) => { try { localStorage.setItem(MYKEY, JSON.stringify(list.slice(-20))); } catch {} };
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await origFetch(input, init);
    try {
      const u = typeof input === "string" ? input : input?.url || "";
      if (u.includes("/api/bookings") && !u.includes("cancel") && init?.method === "POST" && res.ok) {
        const j = await res.clone().json();
        const body = JSON.parse(init.body || "{}");
        if (j.id && j.token) {
          const list = store().filter((x) => x.id !== j.id);
          list.push({ id: j.id, token: j.token, name: body.name || "", lang: body.language || "ja" });
          saveStore(list);
          try { localStorage.setItem("fm-lang", body.language || "ja"); } catch {}
        }
      }
    } catch {}
    return res;
  };

  // ---- 同意部分：本物と同じ「ご来店に際しての注意事項＋確認しました＋同意して予約する」に ----
  function decorateConsent() {
    const form = document.querySelector("form.booking-form");
    if (!form) return;
    const cb = [...form.querySelectorAll('input[type="checkbox"]')].find((b) => {
      const t = b.closest("label")?.textContent || "";
      return t.includes("予約内容と個人情報") || t.includes("checked my booking");
    });
    if (!cb) return;
    const lab = cb.closest("label");
    const en = /checked my booking/.test(lab.textContent);
    lab.style.display = "none";
    // 個人情報の注記も隠す
    [...form.querySelectorAll("p, small")].forEach((p) => {
      const t = p.textContent || "";
      if (t.includes("お名前・連絡先は予約管理") || t.includes("Your name and contact details")) p.style.display = "none";
    });
    const submit = [...form.querySelectorAll("button")].find((b) =>
      b.type === "submit" || /この内容で予約を確定する|Confirm this booking|同意して予約する|Agree and book/.test(b.textContent));
    if (submit) {
      const want = en ? "Agree and book" : "同意して予約する";
      if (submit.textContent !== want && !/予約を確定しています|Saving/.test(submit.textContent)) submit.textContent = want;
    }
    if (!document.getElementById("fm-notice")) {
      const sec = document.createElement("section");
      sec.id = "fm-notice";
      sec.innerHTML =
        '<h2 class="fm-h">' + (en ? "Notes for your visit" : "ご来店に際しての注意事項") + "</h2>" +
        '<div class="fm-box"><p>' +
        (en
          ? "If you need to change your booking or will be late, we would appreciate it if you could contact us in advance.<br/>Contact: cnsalon2021@gmail.com<br/><br/>Thank you very much."
          : "ご予約の変更や遅刻される場合は、事前にご連絡いただけますと幸いです。<br/>ご連絡先：cnsalon2021@gmail.com<br/><br/>どうぞよろしくお願いいたします。") +
        "</p>" +
        '<div class="fm-agree-wrap"><button type="button" class="fm-agree"><span class="fm-ck"></span>' +
        (en ? "Confirmed" : "確認しました") + "</button></div></div>";
      lab.before(sec);
      sec.querySelector(".fm-agree").addEventListener("click", () => cb.click());
      const terms = document.createElement("p");
      terms.id = "fm-terms";
      const lk = (t) => '<a href="#" onclick="return false">' + t + '<svg viewBox="0 0 12 12" width="11" height="11"><path fill="none" stroke="%23b08d4f" stroke-width="1.3" d="M4.5 2H2v8h8V7.5M7 1.5h3.5V5M10.2 1.8 5.5 6.5" transform="scale(1)"/></svg></a>';
      terms.innerHTML = en
        ? "Booking requires agreement to the " + lk("Terms of Service") + " and " + lk("Privacy Policy") + "."
        : "予約には " + lk("利用規約") + " および " + lk("プライバシーポリシー") + " への同意が必要です。";
      (submit || lab).before(terms);
      const st = document.createElement("style");
      st.textContent =
        "#fm-notice{margin:18px 0 6px}" +
        "#fm-notice .fm-h{font-size:15px;font-weight:700;margin:0 0 12px}" +
        "#fm-notice .fm-box{background:#f6ecd9;border-radius:8px;padding:18px 20px 20px;font-size:14px;line-height:1.9}" +
        "#fm-notice .fm-box p{margin:0 0 14px}" +
        "#fm-notice .fm-agree-wrap{text-align:center}" +
        "#fm-notice .fm-agree{font:inherit;display:inline-flex;align-items:center;gap:9px;background:#fff;border:1px solid #c5a15e;border-radius:6px;color:#b08d4f;font-weight:700;padding:12px 26px;cursor:pointer}" +
        "#fm-notice .fm-ck{width:16px;height:16px;border:1px solid #c5a15e;border-radius:3px;display:inline-block;position:relative;background:#fff}" +
        "#fm-notice.fm-on .fm-ck{background:#b08d4f}" +
        "#fm-notice.fm-on .fm-ck::after{content:'';position:absolute;left:4px;top:1px;width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}" +
        "#fm-terms{font-size:14px;margin:16px 0 14px}" +
        "#fm-terms a{color:#b08d4f;text-decoration:none;margin:0 2px}" +
        "#fm-terms a svg{vertical-align:-1px;margin-left:2px}";
      document.head.appendChild(st);
    }
    document.getElementById("fm-notice")?.classList.toggle("fm-on", cb.checked);
  }

  // ---- 予約完了ページ：予約ID表記・オプション行・「マイページへ」ボタン ----
  function decorateComplete() {
    if (!location.pathname.startsWith("/book/complete")) return;
    const dts = [...document.querySelectorAll("dt")];
    if (!dts.length) return;
    const en = dts.some((d) => /Booking (reference|number)|Name/.test(d.textContent));
    const renames = en
      ? { "Booking reference": "Booking ID", "Booking number": "Booking ID", "Selected menu": "Menu" }
      : { "予約番号": "予約ID", "選択中のメニュー": "メニュー" };
    for (const dt of dts) {
      const t = dt.textContent.trim();
      if (renames[t]) dt.textContent = renames[t];
    }
    const dl = dts[0].closest("dl");
    // 予約番号は <p>予約番号<strong> 構造なので、dl先頭の「予約ID」行に移す
    const refEl = document.querySelector(".receipt-reference");
    if (refEl && dl && !dl.dataset.fmId) {
      dl.dataset.fmId = "1";
      refEl.closest("p").style.display = "none";
      const dt = document.createElement("dt");
      dt.textContent = en ? "Booking ID" : "予約ID";
      const dd = document.createElement("dd");
      dd.textContent = refEl.textContent;
      dl.prepend(dd);
      dl.prepend(dt);
    }
    if (dl && dl.dataset.fmId && !dl.dataset.fmOrder) {
      dl.dataset.fmOrder = "1";
      // オプション行を追加し、画像と同じ並び順にする
      const label = (t) => [...dl.querySelectorAll("dt")].find((d) => d.textContent.trim() === t);
      if (!label(en ? "Options" : "オプション")) {
        const dt = document.createElement("dt");
        dt.textContent = en ? "Options" : "オプション";
        const dd = document.createElement("dd");
        dd.textContent = en ? "None" : "なし";
        dl.append(dt, dd);
      }
      const order = en
        ? ["Booking ID", "Name", "Date and time", "Guests", "Menu", "Options", "Staff", "Total"]
        : ["予約ID", "お名前", "来店日時", "人数", "メニュー", "オプション", "スタッフ", "合計"];
      for (const t of order) {
        const dt = label(t);
        if (dt) { const dd = dt.nextElementSibling; dl.append(dt); if (dd?.tagName === "DD") dl.append(dd); }
      }
    }
    // 見出しの文言
    document.querySelectorAll("h1, h2, p").forEach((h) => {
      if (h.childElementCount) return;
      if (h.textContent.trim() === "予約が完了しました") h.textContent = "ご予約ありがとうございました。";
      if (h.textContent.trim() === "Booking complete") h.textContent = "Thank you for your booking.";
    });
    // 印刷ボタン → マイページへ
    const pr = [...document.querySelectorAll("button, a")].find((b) => /予約内容を印刷・保存|Print/.test(b.textContent));
    if (pr && !document.getElementById("fm-mypage-btn")) {
      pr.style.display = "none";
      const a = document.createElement("a");
      a.id = "fm-mypage-btn";
      a.href = "/mypage";
      a.textContent = en ? "My page" : "マイページへ";
      a.style.cssText = "display:inline-block;background:#c5a15e;color:#fff;font-weight:700;border-radius:6px;padding:13px 34px;text-decoration:none;font-size:14px;";
      pr.before(a);
      const wrap = a.parentElement;
      if (wrap) wrap.style.textAlign = "center";
    }
  }

  load().then(apply);
  setInterval(() => { apply(); decorateConsent(); decorateComplete(); }, 700);
  setInterval(() => { load(); }, 15000);
})();
