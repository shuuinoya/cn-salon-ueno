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
      const lk = (t, doc) => '<a href="#" data-fm-doc="' + doc + '">' + t + '<svg viewBox="0 0 12 12" width="11" height="11"><path fill="none" stroke="%23b08d4f" stroke-width="1.3" d="M4.5 2H2v8h8V7.5M7 1.5h3.5V5M10.2 1.8 5.5 6.5" transform="scale(1)"/></svg></a>';
      terms.innerHTML = en
        ? "Booking requires agreement to the " + lk("Terms of Service", "terms") + " and " + lk("Privacy Policy", "privacy") + "."
        : "予約には " + lk("利用規約", "terms") + " および " + lk("プライバシーポリシー", "privacy") + " への同意が必要です。";
      (submit || lab).before(terms);
      terms.addEventListener("click", (e) => {
        const doc = e.target.closest("[data-fm-doc]")?.dataset.fmDoc;
        if (!doc) return;
        e.preventDefault();
        openTermsModal(doc, en);
      });
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

  // ---- 利用規約・プライバシーポリシー：リンクを押すとポップアップで本文を表示 ----
  const TERMS_JA = [
    ["第1条（適用）", "本規約は、CN Ueno health & beauty（以下「当店」）が提供する施術サービスおよびオンライン予約の利用条件を定めるものです。お客様は、予約の申込みをもって本規約に同意したものとみなします。"],
    ["第2条（予約の成立）", "予約は、予約フォームの送信後、当店からの予約確認メールの送信をもって成立します。予約時間は施術の開始時刻です。開始10分前を目安にお越しください。"],
    ["第3条（変更・キャンセル）", "予約の変更・キャンセルは、マイページまたはお電話（03-6806-0324）にて、予約時間の前までにご連絡ください。ご連絡のないキャンセル（無断キャンセル）が続いた場合、以後のご予約をお断りすることがあります。"],
    ["第4条（遅刻）", "予約時間に遅れてお越しの場合、施術時間を短縮させていただくことがあります。15分以上ご連絡なく遅れた場合は、キャンセル扱いとさせていただくことがあります。"],
    ["第5条（施術をお断りする場合）", "以下に該当する場合、施術をお断りすることがあります。(1)飲酒されている場合 (2)伝染性の疾患・皮膚疾患がある場合 (3)妊娠中で医師の許可がない場合 (4)スタッフへの迷惑行為・セクシュアルハラスメントに当たる行為があった場合"],
    ["第6条（体調・健康状態）", "持病・けが・通院中など健康に不安のある方は、必ず事前にお申し出ください。施術は治療行為ではなく、リラクゼーションを目的としたものです。"],
    ["第7条（貴重品）", "貴重品はお客様ご自身で管理をお願いいたします。店内での紛失・盗難について、当店は責任を負いかねます。"],
    ["第8条（免責）", "お客様の申告漏れ、または当店の責によらない事由により生じた損害について、当店は責任を負わないものとします。"],
    ["第9条（規約の変更）", "本規約は必要に応じて変更されることがあります。変更後の規約は、当店ウェブサイトに掲載した時点で効力を生じます。"],
  ];
  const PRIVACY_JA = [
    ["1. 取得する情報", "当店は、予約の受付にあたり、お名前・メールアドレス・電話番号・ご要望等の情報を取得します。"],
    ["2. 利用目的", "取得した個人情報は、(1)予約の受付・確認・変更・キャンセルのご連絡 (2)施術サービスの提供 (3)お問い合わせへの対応 のために利用し、それ以外の目的には利用しません。"],
    ["3. 第三者提供", "法令に基づく場合を除き、ご本人の同意なく個人情報を第三者に提供することはありません。"],
    ["4. 安全管理", "個人情報への不正アクセス、紛失、漏えい等を防止するため、適切な安全管理措置を講じます。"],
    ["5. 開示・訂正・削除", "ご本人からの個人情報の開示・訂正・削除のお申し出には、本人確認のうえ速やかに対応します。"],
    ["6. お問い合わせ窓口", "個人情報の取扱いに関するお問い合わせ：cnsalon2021@gmail.com／03-6806-0324（CN Ueno health & beauty）"],
  ];
  const TERMS_EN = [
    ["Article 1 (Scope)", "These terms set out the conditions for using the treatment services and online booking provided by CN Ueno health & beauty (the \"Salon\"). By submitting a booking you are deemed to have agreed to these terms."],
    ["Article 2 (Booking)", "A booking is confirmed when the Salon sends a booking confirmation email. The booked time is the treatment start time; please arrive about 10 minutes early."],
    ["Article 3 (Changes / Cancellation)", "Please change or cancel via My Page or by phone (03-6806-0324) before your booked time. Repeated no-shows may result in future bookings being declined."],
    ["Article 4 (Late arrival)", "If you arrive late, the treatment time may be shortened. Arrivals more than 15 minutes late without notice may be treated as a cancellation."],
    ["Article 5 (Refusal of service)", "Service may be refused if you (1) are intoxicated, (2) have an infectious or skin disease, (3) are pregnant without a doctor's approval, or (4) engage in harassment toward staff."],
    ["Article 6 (Health conditions)", "Please inform us in advance of any illness, injury, or ongoing medical treatment. Treatments are for relaxation and are not medical care."],
    ["Article 7 (Valuables)", "Please look after your valuables yourself. The Salon is not responsible for loss or theft on the premises."],
    ["Article 8 (Liability)", "The Salon is not liable for damage arising from undisclosed conditions or causes not attributable to the Salon."],
    ["Article 9 (Amendments)", "These terms may be amended as necessary. Amended terms take effect when posted on the Salon's website."],
  ];
  const PRIVACY_EN = [
    ["1. Information we collect", "We collect your name, email address, phone number, and requests when you make a booking."],
    ["2. Purpose of use", "We use this information only to (1) handle booking confirmations, changes, and cancellations, (2) provide treatment services, and (3) respond to inquiries."],
    ["3. Third parties", "We do not provide personal information to third parties without your consent, except as required by law."],
    ["4. Security", "We take appropriate measures to prevent unauthorized access to, loss of, or leakage of personal information."],
    ["5. Disclosure, correction, deletion", "We respond promptly to requests to disclose, correct, or delete your personal information after verifying your identity."],
    ["6. Contact", "Inquiries about personal information: cnsalon2021@gmail.com / 03-6806-0324 (CN Ueno health & beauty)"],
  ];
  function openTermsModal(doc, en) {
    document.getElementById("fm-doc-modal")?.remove();
    const items = doc === "privacy" ? (en ? PRIVACY_EN : PRIVACY_JA) : (en ? TERMS_EN : TERMS_JA);
    const title = doc === "privacy" ? (en ? "Privacy Policy" : "プライバシーポリシー") : (en ? "Terms of Service" : "利用規約");
    const wrap = document.createElement("div");
    wrap.id = "fm-doc-modal";
    wrap.innerHTML =
      '<div class="fm-doc-card" role="dialog" aria-modal="true" aria-label="' + title + '">' +
        '<div class="fm-doc-head"><b>' + title + '</b><button type="button" class="fm-doc-x" aria-label="閉じる">×</button></div>' +
        '<div class="fm-doc-body">' +
          (doc === "privacy"
            ? "<p>" + (en
                ? "CN Ueno health & beauty handles your personal information as follows."
                : "CN Ueno health & beauty（以下「当店」）は、お客様の個人情報を以下のとおり取り扱います。") + "</p>"
            : "") +
          items.map(([h, b]) => "<h3>" + h + "</h3><p>" + b + "</p>").join("") +
        "</div>" +
        '<div class="fm-doc-foot"><button type="button" class="fm-doc-close">' + (en ? "Close" : "閉じる") + "</button></div>" +
      "</div>";
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.closest(".fm-doc-x, .fm-doc-close")) wrap.remove();
    });
    document.body.appendChild(wrap);
    if (!document.getElementById("fm-doc-style")) {
      const st = document.createElement("style");
      st.id = "fm-doc-style";
      st.textContent =
        "#fm-doc-modal{position:fixed;inset:0;background:rgb(0 0 0/.45);display:flex;align-items:center;justify-content:center;z-index:2000;padding:20px}" +
        "#fm-doc-modal .fm-doc-card{background:#fff;border-radius:10px;max-width:640px;width:100%;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgb(0 0 0/.25)}" +
        "#fm-doc-modal .fm-doc-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #ead9bd}" +
        "#fm-doc-modal .fm-doc-head b{font-size:16px;color:#333}" +
        "#fm-doc-modal .fm-doc-x{font:inherit;font-size:22px;line-height:1;border:0;background:none;color:#999;cursor:pointer;padding:0 2px}" +
        "#fm-doc-modal .fm-doc-body{overflow-y:auto;padding:6px 22px 14px;font-size:13.5px;line-height:1.9;color:#444}" +
        "#fm-doc-modal .fm-doc-body h3{font-size:13.5px;margin:14px 0 2px;color:#8a6a33}" +
        "#fm-doc-modal .fm-doc-body p{margin:0 0 4px}" +
        "#fm-doc-modal .fm-doc-foot{padding:12px 20px;border-top:1px solid #ead9bd;text-align:center}" +
        "#fm-doc-modal .fm-doc-close{font:inherit;background:#b08d4f;color:#fff;border:0;border-radius:6px;padding:10px 42px;font-weight:700;cursor:pointer}";
      document.head.appendChild(st);
    }
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
