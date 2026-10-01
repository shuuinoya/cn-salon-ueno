// 予約サイトの会員ログイン（右上の「ログイン」→ メールアドレス＋パスワードのモーダル）
// ・未登録のメールアドレスなら、そのまま会員登録（無料）してログイン
// ・ログイン中は右上のボタンが「マイページ」になる
// ・このブラウザに保存されていた予約・回数券（予約完了時に記録されたID＋トークン）は、
//   ログイン時に会員へ自動的に紐付く
// ・本人確認・権限はすべてサーバー側（/api/member/*）。この画面は表示と入力だけ
(function () {
  "use strict";
  if (window.CNMember) return;

  const lang = (() => { try { return String(localStorage.getItem("cn-salon-language") || "ja").slice(0, 2); } catch { return "ja"; } })();
  const en = lang === "en";
  const T = en ? {
    login: "Log in", mypage: "My page", email: "Email address", pass: "Password",
    forgot: "Forgot your password?", social: "Social login", cancel: "Cancel",
    with: (s) => "Log in with " + s,
    note: "First time here? Enter your email and a password (6+ characters) and press Log in — your free membership is created instantly.",
    registered: "Your membership has been created. Welcome!",
    invalid: "The email address or password is incorrect.",
    shortPass: "Please use a password of at least 6 characters.",
    tooMany: "Too many attempts. Please wait a minute and try again.",
    badEmail: "Please enter a valid email address.",
    fail: "Could not log in. Please try again later.",
    resetAsk: "Enter your registered email address. We will send a temporary password.",
    resetDone: "If the address is registered, a temporary password has been sent.",
    socialSoon: "Social login is coming soon. Please log in with your email address.",
    heading: "Log in / Sign up",
  } : {
    login: "ログイン", mypage: "マイページ", email: "メールアドレス", pass: "パスワード",
    forgot: "パスワードを忘れた方はこちら", social: "ソーシャルログイン", cancel: "キャンセル",
    with: (s) => s + "でログイン",
    note: "初めての方は、メールアドレスとパスワード（6文字以上）を入力して「ログイン」を押すと、そのまま会員登録（無料）が完了します。",
    registered: "会員登録が完了しました。ご登録ありがとうございます。",
    invalid: "メールアドレスまたはパスワードが違います。",
    shortPass: "パスワードは6文字以上で入力してください。",
    tooMany: "試行回数が多すぎます。1分ほど待ってからお試しください。",
    badEmail: "メールアドレスの形式を確認してください。",
    fail: "ログインできませんでした。時間をおいてお試しください。",
    resetAsk: "ご登録のメールアドレスを入力してください。仮パスワードをお送りします。",
    resetDone: "ご登録のアドレスであれば、仮パスワードをお送りしました。メールをご確認ください。",
    socialSoon: "ソーシャルログインは準備中です。メールアドレスでログインしてください。",
    heading: "ログイン / 会員登録",
  };

  const ls = (k) => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const CNMember = window.CNMember = { me: null, data: null, ready: null, open, close, logout, refresh };
  function refresh() {
    CNMember.ready = fetch("/api/member/me", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { CNMember.data = j; CNMember.me = j ? j.member : null; return CNMember.me; })
      .catch(() => null);
    return CNMember.ready;
  }
  refresh();

  // ---- 見た目（本物のログインモーダルと同じ構成） ----
  const CSS =
    "#cn-login-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:28px 16px;overflow:auto}" +
    ".cn-login-card{background:#fff;border-radius:12px;width:100%;max-width:480px;box-shadow:0 12px 40px rgba(0,0,0,.25);font-family:inherit;color:#222}" +
    ".cn-lh{padding:20px 22px;border-bottom:1px solid #e6e6e6}.cn-lh h2{margin:0;font-size:20px;font-weight:700}" +
    ".cn-lf{padding:18px 22px 10px}.cn-lf label{display:block;font-size:17px;margin:0 0 14px}" +
    ".cn-in{display:flex;align-items:center;border:1px solid #cfcfcf;border-radius:8px;height:52px;margin-top:8px;padding:0 12px;background:#fff}" +
    ".cn-in svg{width:20px;height:20px;fill:none;stroke:#8a8a8a;stroke-width:1.8;flex:none;margin-right:10px}" +
    ".cn-in input{border:0;outline:0;flex:1;font-size:17px;background:transparent;min-width:0}" +
    ".cn-gold{display:block;width:100%;border:0;border-radius:8px;background:#c5a15e;color:#fff;font-size:20px;font-weight:700;height:56px;cursor:pointer;margin-top:6px}" +
    ".cn-gold[disabled]{opacity:.6;cursor:default}" +
    ".cn-forgot{display:block;text-align:center;color:#666;font-size:15px;margin:14px 0 6px;text-decoration:none}" +
    ".cn-note{font-size:12.5px;color:#777;line-height:1.7;margin:4px 0 8px}" +
    ".cn-err{color:#c0392b;font-size:14px;margin:-4px 0 10px}" +
    ".cn-social{padding:18px 22px;border-top:1px solid #e6e6e6}.cn-social h3{margin:0 0 16px;font-size:18px;font-weight:700}" +
    ".cn-sb{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;height:56px;border:1px solid #cfcfcf;border-radius:10px;background:#fff;font-size:18px;font-weight:600;color:#222;cursor:pointer;margin-bottom:12px}" +
    ".cn-sb svg{width:24px;height:24px;flex:none}.cn-sb b{font-size:22px;color:#7cb518;font-weight:800;line-height:1}" +
    ".cn-lfoot{padding:18px 22px;border-top:1px solid #e6e6e6;text-align:center}" +
    ".cn-cancel{border:1px solid #9a9a9a;background:#fff;border-radius:8px;padding:14px 34px;font-size:17px;color:#333;cursor:pointer}" +
    ".cn-inline .cn-lf{padding:6px 22px 0}.cn-inline .cn-social{padding:16px 22px 14px}" +
    "@media (max-width:480px){#cn-login-ov{padding:12px 10px}.cn-lf,.cn-social,.cn-lh,.cn-lfoot{padding-left:18px;padding-right:18px}}";
  function ensureStyle() {
    if (document.getElementById("cn-login-style")) return;
    const st = document.createElement("style");
    st.id = "cn-login-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const ICON_MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
  const ICON_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/></svg>';
  const ICON_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.4 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.6z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-3.9-13.5-9.3l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
  const ICON_APPLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#000" d="M16.4 12.7c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.8-1.7 0-3.2 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.2 3.1-2.5.9-1.4 1.3-2.7 1.4-2.8-.1 0-2.9-1.1-2.9-4.1zM14 5.3c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"/></svg>';

  function formHtml(inline) {
    return (
      '<form class="cn-lf" novalidate>' +
      "<label>" + T.email + '<span class="cn-in">' + ICON_MAIL + '<input type="email" name="email" autocomplete="email" inputmode="email" required></span></label>' +
      "<label>" + T.pass + '<span class="cn-in">' + ICON_LOCK + '<input type="password" name="pass" autocomplete="current-password" required></span></label>' +
      '<p class="cn-err" hidden></p>' +
      '<button type="submit" class="cn-gold">' + T.login + "</button>" +
      '<a href="#" class="cn-forgot">' + T.forgot + "</a>" +
      '<p class="cn-note">' + T.note + "</p>" +
      "</form>" +
      '<div class="cn-social"><h3>' + T.social + "</h3>" +
      '<button type="button" class="cn-sb" data-social="Google">' + ICON_G + "<span>" + T.with("Google") + "</span></button>" +
      '<button type="button" class="cn-sb" data-social="Apple">' + ICON_APPLE + "<span>" + T.with("Apple") + "</span></button>" +
      '<button type="button" class="cn-sb" data-social="EPARK"><b>E</b><span>' + T.with("EPARK") + "</span></button>" +
      "</div>" +
      (inline ? "" : '<div class="cn-lfoot"><button type="button" class="cn-cancel">' + T.cancel + "</button></div>")
    );
  }

  function open() {
    ensureStyle();
    if (document.getElementById("cn-login-ov")) return;
    const ov = document.createElement("div");
    ov.id = "cn-login-ov";
    ov.innerHTML = '<div class="cn-login-card" role="dialog" aria-modal="true" aria-label="' + T.login + '">' +
      '<div class="cn-lh"><h2>' + T.login + "</h2></div>" + formHtml(false) + "</div>";
    document.body.appendChild(ov);
    document.body.style.overflow = "hidden";
    wire(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    setTimeout(() => ov.querySelector('input[name="email"]')?.focus(), 50);
  }
  function close() {
    document.getElementById("cn-login-ov")?.remove();
    document.body.style.overflow = "";
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // フォームの動作（モーダル・/login ページ共通）
  function wire(root) {
    const form = root.querySelector("form.cn-lf");
    const errBox = root.querySelector(".cn-err");
    const showErr = (msg) => { errBox.textContent = msg; errBox.hidden = !msg; };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      showErr("");
      const email = form.email.value.trim();
      const pass = form.pass.value;
      if (!email || !email.includes("@")) return showErr(T.badEmail);
      if (!pass) return showErr(T.shortPass);
      const btn = form.querySelector(".cn-gold");
      btn.disabled = true;
      try {
        const link = {
          bookings: ls("cn-mypage").map((x) => ({ id: x.id, token: x.token })),
          tickets: ls("cn-tickets").map((x) => ({ id: x.id, token: x.token })),
        };
        const r = await fetch("/api/member/login", { method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, pass, link }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) {
          showErr({ invalidLogin: T.invalid, shortPass: T.shortPass, tooManyAttempts: T.tooMany, badEmail: T.badEmail }[j.error] || T.fail);
          btn.disabled = false;
          return;
        }
        if (j.registered) window.alert(T.registered);
        if (location.pathname === "/login") location.href = "/mypage";
        else location.reload();
      } catch {
        showErr(T.fail);
        btn.disabled = false;
      }
    });
    root.querySelector(".cn-forgot").addEventListener("click", async (e) => {
      e.preventDefault();
      const email = window.prompt(T.resetAsk, form.email.value.trim());
      if (!email) return;
      try {
        await fetch("/api/member/reset", { method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      } catch {}
      window.alert(T.resetDone);
    });
    root.querySelectorAll(".cn-sb").forEach((b) => b.addEventListener("click", () => window.alert(T.socialSoon)));
    root.querySelector(".cn-cancel")?.addEventListener("click", close);
  }

  async function logout() {
    try { await fetch("/api/member/logout", { method: "POST", credentials: "same-origin" }); } catch {}
    CNMember.me = null; CNMember.data = null;
    location.href = "/";
  }

  // ---- 右上の「ログイン」ボタン：未ログインならモーダル、ログイン中は「マイページ」へ ----
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a.login-button");
    if (!a || CNMember.me) return;
    e.preventDefault();
    open();
  }, true);
  function applyHeader() {
    const me = CNMember.me;
    document.querySelectorAll("a.login-button").forEach((a) => {
      const want = me ? "mypage" : "login";
      if (a.dataset.cnState === want) return;
      a.dataset.cnState = want;
      const b = a.querySelector("b");
      if (me) { a.setAttribute("href", "/mypage"); if (b) b.textContent = T.mypage; }
      else { a.setAttribute("href", "/login"); if (b) b.textContent = T.login; }
    });
  }
  // /login ページ：カードの中身をログインフォームにする（レイアウトは他ページと同じまま）
  function applyLoginPage() {
    if (location.pathname !== "/login") return;
    const card = document.querySelector(".login-card");
    if (!card || card.dataset.cnReady) return;
    if (CNMember.me) { location.replace("/mypage"); return; }
    ensureStyle();
    card.dataset.cnReady = "1";
    card.classList.add("cn-inline");
    card.innerHTML = "<h2>" + esc(T.heading) + "</h2>" + formHtml(true);
    wire(card);
  }
  CNMember.ready.then(() => {
    applyHeader(); applyLoginPage();
    // ?login=1 付きのURL（メール等からのリンク）では、未ログインならログイン画面を自動で開く
    try { if (!CNMember.me && new URLSearchParams(location.search).get("login") === "1" && location.pathname !== "/login") open(); } catch {}
  });
  setInterval(() => { applyHeader(); applyLoginPage(); }, 700);
})();
