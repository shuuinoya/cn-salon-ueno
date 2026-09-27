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
  // ---- 利用規約：正式文書「CN health & beauty salon オンライン予約サービス利用規約」をそのまま掲載 ----
  const TERMS_DOC = [
    ["sub", "CN health & beauty salon オンライン予約サービス利用規約"],
    ["sub", "2026年9月27日　制定・施行"],
    ["sub", "CN health & beauty salon"],
    ["ch", "第１章　総則"],
    ["ar", "第１条（総則）"],
    ["p", "１．本規約は、CN health & beauty salon（以下「当サロン」という）が提供するCN health & beauty salonオンライン予約サービス（第２条で定義する）の利用に関して、利用者（以下「利用者」という）が遵守すべき事項を定めたものである。"],
    ["p", "２．利用者は、CN health & beauty salonオンライン予約サービスの利用に関し、本規約のほか、本規約の下位規約、ルール等（総称して以下「本規約等」という）を遵守するものとする。"],
    ["p", "３．当サロンは、利用者がCN health & beauty salonオンライン予約サービスを利用した場合、当該利用者が本規約に同意したものとみなす。"],
    ["p", "４．利用者がCN health & beauty salonオンライン予約サービスを利用するにあたり登録した情報に基づき、当サロンの顧客として登録されるものとし、当サロンから書面・FAX・電話・電子メール等により、当サロンが取り扱う各種サービスの案内等が送られることについて、予め同意する。"],
    ["ar", "第２条（CN health & beauty salonオンライン予約サービス）"],
    ["p", "「CN health & beauty salonオンライン予約サービス」とは、オンライン予約サービス（以下「予約サービス」という）を提供するとともに、リラクゼーション・ビューティ情報、ユーザアンケート、その他の関連情報の紹介（総称して以下「情報サービス」という）を行うサービスである。"],
    ["ch", "第２章　CN health & beauty salonオンライン予約サービスの利用"],
    ["ar", "第３条（利用方法）"],
    ["p", "１．利用者は、「CN health & beauty salonオンライン予約サービス」において予約サービスまたは情報サービスを利用するに際し、本規約等の内容を十分に確認のうえ利用するものとする。"],
    ["p", "２．利用者は、当サロンが運営するサロン店舗（リラクゼーションサロン、ネイルサロン、エステサロン等を指しますが、それらに限られません。）（以下、「店舗運営者」という）であって、お客様に対して、取引の対象となる役務または商品を提供または販売する者が提供するサービスを利用するときは、当該店舗運営者が定める規約、約款、ガイドライン、ルール等を十分に確認のうえ利用するものとする。"],
    ["ch", "第３章　サービス利用にあたっての注意事項"],
    ["ar", "第４条（利用者への連絡方法）"],
    ["p", "当サロンおよび店舗運営者は、利用者に対し、必要に応じて、予約時または情報登録時に取得した電子メールアドレス、住所、電話番号等を利用して連絡できるものとする。いずれかの方法により連絡するかについては、当該連絡を行う当サロンまたはサービス提供者の判断によるものとする。"],
    ["ch", "第４章　個人情報の取扱"],
    ["ar", "第５条（個人情報）"],
    ["p", "１．当サロンは、利用者の個人情報を別途定める「個人情報保護方針」に従い取り扱うものとし、利用者は、これに同意するものとする。"],
    ["p", "２．当サロンは、本規約に係らず、裁判所もしくは正規の法的執行機関からの問い合わせに応じて、利用者の個人情報の公開を求められた場合には、問い合わせに応じる可能性があるものとする。"],
    ["ar", "第６条（パスワードの管理）"],
    ["p", "１．パスワードは、他人に知られることがないよう利用者本人が責任をもって管理するものとする。"],
    ["p", "２．入力されたメールアドレスおよびパスワードが登録されたものと一致することを所定の方法により確認した場合、利用者本人による利用があったものとみなし、それらが盗用、不正使用その他の事情により会員以外の者が利用している場合であっても、それにより生じた損害について、当サロンは一切責任を負わないものとする。"],
    ["ar", "第７条（店舗運営者による個人情報の取扱）"],
    ["p", "１．店舗運営者は、利用者に提供するサービスの向上のために、再来店した際に「CN health & beauty salonオンライン予約サービス」を利用して、利用者の過去のサービス利用内容、ご要望や特徴など、関連情報を記録することができる。"],
    ["p", "２．これらの関連情報は、他の店舗運営者や第三者とは共有されない。ただし、グループ経営の同系列の店舗運営者間で関連情報が共有される場合があることを利用者は同意するものとする。"],
    ["p", "３．当サロンは、「CN health & beauty salonオンライン予約サービス」のシステムに保存されている情報のバックアップのためにコピーを作成する。"],
    ["ch", "第５章　電子メールに関する取扱"],
    ["ar", "第８条（電子メール）"],
    ["p", "１．利用者は、「CN health & beauty salonオンライン予約サービス」を利用した際に、当サロンもしくは店舗運営者から定期的な電子メールを受信することを選択した場合は、当サロンもしくは店舗運営者が電子メールを送信することに同意したものとする。"],
    ["p", "２．利用者が、当サロンもしくは店舗運営者から定期的な電子メールを受信することを選択しなかった場合であっても、予約の確認・変更・取消に関するメール、予約の無断キャンセルに関するメール、その他、予約に関連するその他の電子メールを受信することを同意するものとする。"],
    ["ch", "第６章　料金および決済"],
    ["ar", "第９条（深夜料金）"],
    ["p", "１．22時を過ぎる業務または施術（22時以降に開始する施術、および22時を過ぎて継続する施術を含む）については、通常の施術料金とは別に、深夜料金として2,000円を申し受けるものとする。"],
    ["p", "２．利用者は、前項の深夜料金が発生する時間帯に予約を行った場合、当該深夜料金の支払いに同意したものとみなす。"],
    ["ar", "第１０条（決済手数料）"],
    ["p", "１．利用者が現金以外の方法（クレジットカード、電子マネー、QRコード決済等を含むが、これらに限られない）により料金を支払う場合は、お支払い金額の5％を決済手数料として申し受けるものとする。"],
    ["p", "２．現金でお支払いの場合は、前項の決済手数料はかからないものとする。"],
    ["ch", "第７章　一般条項"],
    ["ar", "第１１条（禁止事項）"],
    ["p", "１．利用者は、「CN health & beauty salonオンライン予約サービス」の利用に際して、次の各号の行為を行わないものとする。"],
    ["p", "（１）本規約等に違反する行為"],
    ["p", "（２）サービス提供者、他の利用者、その他第三者に対し、その権利を侵害し、不利益を与え、または不快感を抱かせる行為"],
    ["p", "（３）当サロンが承認した以外の方法で「CN health & beauty salonオンライン予約サービス」を利用する行為"],
    ["p", "（４）有害なコンピュータプログラム等を送信または書き込む行為"],
    ["p", "（５）スパムメール、チェーンレター、ジャンクメール等を送信する行為"],
    ["p", "（６）法令または公序良俗に反する行為"],
    ["p", "（７）その他当サロンが禁止する行為"],
    ["p", "２．当サロンは、利用者が前項各号の一の行為に該当すると判断した場合には、事前に通知することなく、当該利用者に対し、「CN health & beauty salonオンライン予約サービス」の利用停止を行うことができるものとし、これにより当該利用者に何らかの損害が生じたとしても、当サロンは一切責任を負わないものとする。"],
    ["ar", "第１２条（免責事項）"],
    ["p", "１．予約サービスにおける当サロンの責任は、利用者と店舗運営者の間で予約が成立した場合に、予約情報を伝達することに限定され、これ以外については、本規約等で特に定める場合を除き、一切の責任を負わない。"],
    ["p", "２．利用者と店舗運営者との間でトラブル、紛争等が生じた場合は、利用者と当該店舗運営者との間で直接解決するものとし、当サロンは一切の責任を負わない。"],
    ["p", "３．当サロンは、別途明示された規定がある場合を除き、予約の成立前における通信回線やコンピュータ等の障害によるシステムの中断・遅滞・中止・データの焼失、データへの不正アクセスにより生じた損害、ならびに「CN health & beauty salonオンライン予約サービス」の情報サービス利用に関して利用者に生じた損害について、一切の責任を負わない。"],
    ["p", "４．当サロンは、利用者の電子メール環境または伝達経路の不備により、当サロンが配信した電子メールが当該利用者に到着しなかったことにより生じた損害について、一切の責任を負わない。"],
    ["p", "５．利用者は、「CN health & beauty salonオンライン予約サービス」の利用に際し、自ら行った行為について責任を負うものとし、第三者に損害を与えた場合、自己の責任と費用負担で解決するものとする。"],
    ["p", "６．当サロンは、利用者に対し、適宜情報提供やアドバイスを行うことがあるが、それにより責任を負うものではない。"],
    ["p", "７．当サロンは、利用者が本規約等に違反したことによって生じた損害について、一切の責任を負わない。"],
    ["p", "８．当サロンは、「CN health & beauty salonオンライン予約サービス」が提供しているＷＥＢページ、サーバ、ドメイン等から送られるメールならびに予約サービスおよび情報サービスのコンテンツ等に、コンピュータウィルス等の有害なものが含まれないことを保証しない。"],
    ["p", "９．当サロンは、システムの定期保守や緊急保守を行う場合、システムに負荷が集中した場合、利用者のセキュリティを確保する必要が生じた場合、その他必要があると判断した場合には、事前に通知することなく「CN health & beauty salonオンライン予約サービス」のサービスの全部または一部の提供を中断または停止することができるものとする。当サロンは、この場合に利用者に発生した損害について、一切の責任を負わない。"],
    ["p", "１０．当サロンは、利用者に対し、当サロンまたはサービス提供者が「CN health & beauty salonオンライン予約サービス」に掲示した情報の真偽、正確性、信頼性等につき一切保証しないものとし、当該情報に起因して利用者に発生した損害について、一切の責任を負わない。"],
    ["ar", "第１３条（本規約等の変更）"],
    ["p", "１．当サロンは、利用者に対する事前の通知なく本規約等を改定できるものとし、本規約等改定後は、改定後の本規約等を適用するものとする。なお、利用者が「CN health & beauty salonオンライン予約サービス」を利用した場合、改定後の本規約等に同意したものとする。"],
    ["p", "２．当サロンは、その判断により利用者に事前に通知・連絡することなく、「CN health & beauty salonオンライン予約サービス」のサービスの全部または一部を変更・廃止することができるものとする。"],
    ["ar", "第１４条（準拠法、合意管轄）"],
    ["p", "本規約は日本法に基づき解釈されるものとし、本規約に関し訴訟の必要が生じた場合には、東京地方裁判所を第一審の専属的合意管轄裁判所とする。"],
    ["cp", "Copyright 2026 CN health & beauty salon. All Rights Reserved."],
  ];
  const PRIVACY_JA = [
    ["1. 取得する情報", "当店は、予約の受付にあたり、お名前・メールアドレス・電話番号・ご要望等の情報を取得します。"],
    ["2. 利用目的", "取得した個人情報は、(1)予約の受付・確認・変更・キャンセルのご連絡 (2)施術サービスの提供 (3)お問い合わせへの対応 のために利用し、それ以外の目的には利用しません。"],
    ["3. 第三者提供", "法令に基づく場合を除き、ご本人の同意なく個人情報を第三者に提供することはありません。"],
    ["4. 安全管理", "個人情報への不正アクセス、紛失、漏えい等を防止するため、適切な安全管理措置を講じます。"],
    ["5. 開示・訂正・削除", "ご本人からの個人情報の開示・訂正・削除のお申し出には、本人確認のうえ速やかに対応します。"],
    ["6. お問い合わせ窓口", "個人情報の取扱いに関するお問い合わせ：cnsalon2021@gmail.com／03-6806-0324（CN Ueno health & beauty）"],
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
    const items = doc === "privacy" ? (en ? PRIVACY_EN : PRIVACY_JA) : null;
    const title = doc === "privacy" ? (en ? "Privacy Policy" : "プライバシーポリシー") : "利用規約";
    const wrap = document.createElement("div");
    wrap.id = "fm-doc-modal";
    wrap.innerHTML =
      '<div class="fm-doc-card" role="dialog" aria-modal="true" aria-label="' + title + '">' +
        '<div class="fm-doc-head"><b>' + title + '</b><button type="button" class="fm-doc-x" aria-label="閉じる">×</button></div>' +
        '<div class="fm-doc-body">' +
          (doc === "privacy"
            ? "<p>" + (en
                ? "CN Ueno health & beauty handles your personal information as follows."
                : "CN Ueno health & beauty（以下「当店」）は、お客様の個人情報を以下のとおり取り扱います。") + "</p>" +
              items.map(([h, b]) => "<h3>" + h + "</h3><p>" + b + "</p>").join("")
            : TERMS_DOC.map(([t, x]) =>
                t === "ch" ? '<h2 class="fm-doc-ch">' + x + "</h2>" :
                t === "ar" ? "<h3>" + x + "</h3>" :
                t === "sub" ? '<p class="fm-doc-sub">' + x + "</p>" :
                t === "cp" ? '<p class="fm-doc-cp">' + x + "</p>" : "<p>" + x + "</p>").join("")) +
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
        "#fm-doc-modal .fm-doc-body .fm-doc-ch{font-size:14px;font-weight:700;margin:20px 0 4px;color:#6b4f2a}" +
        "#fm-doc-modal .fm-doc-body .fm-doc-sub{margin:0;color:#555}" +
        "#fm-doc-modal .fm-doc-body .fm-doc-cp{margin-top:18px;color:#888;font-size:12px}" +
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
