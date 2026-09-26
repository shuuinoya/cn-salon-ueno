// 本物の管理システム（Peak Manager）のレイアウトに合わせるための補完スクリプト。
// React（保存済みチャンク）が描き直しても消えないよう、定期的に不足分を足し直す。
(function () {
  "use strict";
  const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

  // 保存APIの応答に warning が含まれていたら管理者に知らせる
  // （例：対応可能メニューから外したメニューの予約が残っている場合）
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await origFetch(input, init);
    try {
      const u = typeof input === "string" ? input : input?.url || "";
      if (u.includes("/api/demo/schedule") && init && init.method === "POST" && res.ok) {
        const j = await res.clone().json().catch(() => null);
        if (j && j.warning) setTimeout(() => window.alert(j.warning), 100);
      }
    } catch {}
    return res;
  };

  function ensure() {
    const app = document.querySelector(".ledger-app");
    if (!app) return;

    // 1) 日付表示を「2026-09-25 金」形式に
    const time = document.querySelector(".ledger-date-trigger time");
    if (time) {
      const d = time.getAttribute("datetime");
      if (d) {
        const w = WEEK[new Date(d + "T00:00:00Z").getUTCDay()];
        const want = d + " " + w;
        if (time.textContent !== want) time.textContent = want;
      }
    }

    // 2) 再読込ボタンの隣に天気ボタン＋雲アイコン
    const refresh = document.querySelector(".ledger-refresh");
    if (refresh && !document.getElementById("pm-weather")) {
      const b = document.createElement("button");
      b.id = "pm-weather";
      b.className = "pm-weather";
      b.type = "button";
      b.title = "デモ版では天気情報はありません";
      b.textContent = "天気";
      refresh.insertAdjacentElement("afterend", b);
      const c = document.createElement("span");
      c.id = "pm-cloud";
      c.className = "pm-cloud";
      b.insertAdjacentElement("afterend", c);
    }

    // 3) ヘッダー右に警告バッジ、ユーザー表示は本物と同じ省略表記に
    const brand = document.querySelector(".ledger-brand");
    if (brand) {
      if (!document.getElementById("pm-alert")) {
        const s = document.createElement("span");
        s.id = "pm-alert";
        s.className = "pm-alert";
        s.textContent = "⚠ 3836";
        brand.insertAdjacentElement("beforebegin", s);
      }
      if (brand.textContent !== "CN He...") brand.textContent = "CN He...";
      // クリックで「ログアウト」メニューを開閉（本物と同じ挙動）
      if (!brand.dataset.pmMenuBound) {
        brand.dataset.pmMenuBound = "1";
        brand.addEventListener("click", (e) => {
          e.stopPropagation();
          let menu = document.getElementById("pm-usermenu");
          if (menu) { menu.remove(); return; }
          menu = document.createElement("div");
          menu.id = "pm-usermenu";
          const item = document.createElement("button");
          item.type = "button";
          item.textContent = "ログアウト";
          item.addEventListener("click", () => { location.href = "/admin/login?out=1"; });
          menu.appendChild(item);
          document.body.appendChild(menu);
          const r = brand.getBoundingClientRect();
          menu.style.top = r.bottom + 6 + "px";
          menu.style.right = Math.max(8, window.innerWidth - r.right) + "px";
          const close = (ev) => {
            if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("click", close); }
          };
          setTimeout(() => document.addEventListener("click", close), 0);
        });
      }
    }

    // 3c) 青い「オンライン予約が入りました」トースト（本物と同じ表示）
    if (!window.__pmToastTimer) {
      window.__pmToastTimer = setTimeout(() => {
        if (document.getElementById("pm-toast")) return;
        const now = new Date(Date.now() + 9 * 3600e3); // 日本時間
        const later = new Date(now.getTime() + 90 * 60e3);
        const hh = String(later.getUTCHours()).padStart(2, "0");
        const mm = String(Math.floor(later.getUTCMinutes() / 10) * 10).padStart(2, "0");
        const t = document.createElement("div");
        t.id = "pm-toast";
        t.innerHTML = "オンライン予約が入りました。<br/>" +
          now.toISOString().slice(0, 10) + " " + hh + ":" + mm + " 新予約";
        t.title = "クリックで閉じる";
        t.addEventListener("click", () => t.remove());
        document.body.appendChild(t);
      }, 4000);
    }

    // 3a2) 左上のロゴは押しても何も起きないようにする（予約サイトへ飛ばない）
    const logo = document.querySelector(".ledger-logo");
    if (logo && !logo.dataset.pmNoNav) {
      logo.dataset.pmNoNav = "1";
      logo.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, true);
      logo.style.cursor = "default";
    }

    // 3b) スタッフ行ごとの装飾（★数・ピンク強調・左端の色バー）と、
    //      鍵（予約受付停止）トグル。鍵の状態はサーバーの実データと連動する。
    const DECOR = {
      "藤倉 和美": { star: "50", pink: true, female: true },
      "山田 恵": { female: true },
      "川井": { female: true },
      "佐藤みずき": { female: true },
      "平沼 穂香": { female: true },
    };
    refreshLocks();
    document.querySelectorAll(".ledger-row").forEach((row) => {
      const cell = row.querySelector(".ledger-staff-cell");
      const name = cell?.querySelector("b")?.textContent || "";
      if (!cell) return;
      const d = DECOR[name] || {};
      const star = "★" + (d.star || "0");
      if (cell.dataset.pmstar !== star) cell.dataset.pmstar = star;
      row.classList.toggle("pm-pink", !!d.pink);
      row.classList.toggle("pm-acc-f", !!d.female);
      row.classList.toggle("pm-acc-m", !d.female);
      const lockInfo = window.__pmLocks?.[name];
      row.classList.toggle("pm-blue", !!lockInfo?.locked);
      row.classList.toggle("pm-locked", !!lockInfo?.locked);
      if (lockInfo && !cell.querySelector(".pm-lockbtn")) {
        const b = document.createElement("span");
        b.className = "pm-lockbtn";
        b.setAttribute("role", "button");
        b.tabIndex = 0;
        b.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const cur = window.__pmLocks?.[name];
          if (!cur || b.dataset.busy) return;
          b.dataset.busy = "1";
          try {
            await fetch("/api/demo/schedule", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "lockStaff",
                date: new Date(Date.now() + 9 * 3600e3 - 108e5).toISOString().slice(0, 10),
                staffId: cur.id,
                locked: cur.locked ? 0 : 1,
              }),
            });
            await refreshLocks(true);
          } finally { delete b.dataset.busy; }
        }, true);
        cell.appendChild(b);
      }
      const btn = cell.querySelector(".pm-lockbtn");
      if (btn && lockInfo) {
        btn.title = lockInfo.locked
          ? name + " は予約受付停止中（クリックで再開）"
          : name + " の予約受付を停止する";
      }
    });

    // 3c2) 「予約台帳」メニューを本物と同じ項目構成にする
    //      （予約受付＝日別スケジュール表示。装飾項目はデモでは飾り）
    const navMenu = document.querySelector(".ledger-nav-menu > div");
    if (navMenu && !navMenu.dataset.pmMenu) {
      navMenu.dataset.pmMenu = "1";
      const orig = [...navMenu.querySelectorAll("button")];
      const dayBtn = orig.find((b) => b.textContent === "日別予約台帳");
      const monthBtn = orig.find((b) => b.textContent === "月間シフト作成");
      orig.forEach((b) => { b.style.display = "none"; });
      const items = [
        ["トップ", () => dayBtn?.click()],
        ["予約受付", () => dayBtn?.click()],
        ["予約一覧", () => {
          dayBtn?.click();
          setTimeout(() => {
            [...document.querySelectorAll(".ledger-underbar button")]
              .find((b) => b.textContent === "予約一覧")?.click();
          }, 150);
        }],
        ["支払・レジ", null],
        ["物販販売", null],
        ["返客一覧", null],
        ["月間シフト入力", () => monthBtn?.click()],
        ["本日のオンライン設定状況", null],
        ["シフトひな型設定", null],
        ["シフトパターン設定", null],
        ["データ不備のお知らせ", null],
      ];
      for (const [label, fn] of items) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (fn) b.addEventListener("click", fn);
        else { b.title = "デモ版では使用できません"; b.style.opacity = "0.55"; }
        navMenu.appendChild(b);
      }
    }

    // 3c3) 「店舗情報」メニューも本物と同じ項目構成にする
    //      （店舗情報＝フリーメッセージなど予約ページ設定、スタッフ情報＝本来の画面）
    const shopMenuRoot = [...document.querySelectorAll(".ledger-nav-menu")]
      .find((d) => d.querySelector("summary")?.textContent.includes("店舗情報"));
    const shopMenu = shopMenuRoot?.querySelector(":scope > div");
    if (shopMenu && !shopMenu.dataset.pmMenu) {
      shopMenu.dataset.pmMenu = "1";
      const staffBtn = [...shopMenu.querySelectorAll("button")].find((b) => b.textContent === "スタッフ情報");
      [...shopMenu.children].forEach((el) => { el.style.display = "none"; });
      const shopItems = [
        ["店舗情報", openShopSettings],
        ["スタッフ情報", () => staffBtn?.click()],
        ["ブース情報", null],
        ["経費マスタ", null],
        ["クレジットカード会社情報", null],
        ["電子マネー情報", null],
        ["TORICOM設定", null],
        ["ユーザ情報", null],
      ];
      for (const [label, fn] of shopItems) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (fn) b.addEventListener("click", fn);
        else { b.title = "デモ版では使用できません"; b.style.opacity = "0.55"; }
        shopMenu.appendChild(b);
      }
    }

    // 3d) 現在時刻の列を時間別概況でハイライト
    const nowJst = new Date(Date.now() + 9 * 3600e3);
    const hourIdx = (nowJst.getUTCHours() - 10 + 24) % 24;
    document.querySelectorAll(".ledger-overview button").forEach((b, i) => {
      b.classList.toggle("pm-now", i === hourIdx);
    });

    // 3e) 左レール：編集欄が開いているときは「開く」→「閉じる」
    const sideOpen = !!document.querySelector(".ledger-side");
    document.querySelectorAll(".ledger-rail button").forEach((b) => {
      const sm = b.querySelector("small"), ic = b.querySelector("b");
      if (!sm || !ic) return;
      if (sm.textContent === "開く" && sideOpen) { sm.textContent = "閉じる"; ic.textContent = "←"; }
      else if (sm.textContent === "閉じる" && !sideOpen) { sm.textContent = "開く"; ic.textContent = "➜"; }
    });

    // 7b) メール管理タブに、生成メールを確認するリンクを追加
    const mailSec = document.querySelector(".ledger-mail");
    if (mailSec && !document.getElementById("pm-maillink")) {
      const a = document.createElement("a");
      a.id = "pm-maillink";
      a.className = "pm-red";
      a.href = "/admin/mails";
      a.textContent = "送信メールを確認（デモ）";
      a.style.cssText = "display:inline-block;text-decoration:none;margin-left:8px;";
      mailSec.querySelector("button")?.insertAdjacentElement("afterend", a);
    }

    // 7c) 月間シフト作成画面を本物の「月間シフト作成/目標設定」構成にする
    decorateMonth();

    // 8) 予約詳細パネルを本物と同じレイアウトに組み替える
    decoratePanel();

    // 9) 下部の集計を本物と同じ3段（赤・黒・青）にする
    decorateStats();

    // 4) 左レールのラベルを本物に合わせる
    document.querySelectorAll(".ledger-rail button small").forEach((sm) => {
      const map = { "戻る": "返客", "集計": "会計", "登録": "カード" };
      if (map[sm.textContent]) sm.textContent = map[sm.textContent];
    });

    // 5) 絞り込みボタンの名称
    document.querySelectorAll(".ledger-category-row button").forEach((b) => {
      if (b.textContent === "スタッフ別 絞り込み・設定") b.textContent = "カテゴリ別 絞り込み";
    });

    // 6) 下部に本物と同じボタン群（デモでは飾り）と目標・総販売額
    const underbar = document.querySelector(".ledger-underbar");
    if (underbar && !document.getElementById("pm-extra")) {
      const frag = document.createElement("span");
      frag.id = "pm-extra";
      frag.style.display = "contents";
      ["インターバル:ON", "ひな型登録", "ひな型読込"].forEach((label) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pm-deco";
        b.title = "デモ版では使用できません";
        b.textContent = label;
        frag.appendChild(b);
      });
      underbar.appendChild(frag);
    }
    const summary = document.querySelector(".ledger-summary");
    if (summary && !document.getElementById("pm-target")) {
      const p = document.createElement("div");
      p.id = "pm-target";
      p.className = "pm-target";
      p.textContent = "目標：0円　総販売額：0円";
      summary.insertAdjacentElement("beforebegin", p);
    }

    // 7) 台帳の最後に「未定」行
    const grid = document.querySelector(".ledger-grid");
    if (grid && grid.querySelector(".ledger-row") && !document.getElementById("pm-undecided")) {
      const row = document.createElement("div");
      row.id = "pm-undecided";
      row.className = "ledger-row pm-undecided";
      row.innerHTML =
        '<button type="button" class="ledger-staff-cell" title="デモ版では未定枠は使用できません"><b>未定</b></button>' +
        '<div class="ledger-track"></div>';
      grid.appendChild(row);
    } else if (grid && !grid.querySelector(".ledger-row:not(.pm-undecided)")) {
      // スタッフ絞り込みなどで行が無くなったら未定行も消す
      document.getElementById("pm-undecided")?.remove();
    }
  }

  // 予約詳細パネルを本物（PeakManager）と同じ構成に見せる。
  // Reactが管理するフォームは隠しておき、「編集」を押したときだけ表示する。
  function decoratePanel() {
    const side = document.querySelector(".ledger-side");
    const form = document.querySelector(".ledger-side-form");
    const dl = form?.querySelector(".ledger-booking-detail");
    if (side) {
      side.classList.add("pm-side");
      const inp = side.querySelector(".ledger-side-search input");
      if (inp && inp.placeholder !== "顧客を検索") inp.placeholder = "顧客を検索";
    }
    if (form) form.classList.toggle("pm-booking", !!dl);
    const old = document.getElementById("pm-pd");
    if (!side || !form || !dl) { old?.remove(); return; }

    // dlと入力欄から現在の予約情報を読み取る
    const val = (label) => {
      const dts = [...dl.querySelectorAll("dt")];
      const i = dts.findIndex((d) => d.textContent === label);
      return i >= 0 ? dts[i].nextElementSibling : null;
    };
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const ref = val("予約ID")?.textContent || "";
    const bookingId = "24725" + (ref.replace(/\D/g, "").slice(-4) || "8666"); // 本物と同じ9桁表記
    const prevDay = dateISOMinus1(form.querySelector("p time")?.getAttribute("datetime") || "");
    const name = (val("お名前")?.textContent || "").trim();
    const menu = (val("メニュー")?.textContent || "").trim();
    const telLines = (val("連絡先")?.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const tel = telLines.find((s) => /^[-\d+ ]+$/.test(s)) || "08091951969";
    const dateISO = form.querySelector("p time")?.getAttribute("datetime") || "";
    const tsel = form.querySelectorAll(".ledger-time-input select");
    const hh = String(tsel[0]?.value ?? "").padStart(2, "0");
    const mm = String(tsel[1]?.value ?? "").padStart(2, "0");
    const staffSel = form.querySelector("label select");
    const staffName = staffSel?.selectedOptions?.[0]?.textContent || "";
    

    const html =
      '<div class="pm-shoprow"><label><input type="checkbox" checked/> 自店のみ</label><button type="button" class="pm-red" data-act="none">検索</button></div>' +
      '<div class="pm-cust">' +
        '<div class="pm-cust-rank">ランク:★★★　会員番号：<br/>TEL:' + esc(tel) + "</div>" +
        '<div class="pm-cust-name"><span class="pm-gender">♀</span> ' + (esc(name) || "&nbsp;") + '<span class="pm-count">回数:5/5</span></div>' +
      "</div>" +
      '<div class="pm-icons">' +
        [["顧客", "♙"], ["カード", "▦"], ["履歴", "↺"], ["会計", "▤"], ["返客", "↶"]]
          .map(([t, g]) => '<button type="button" data-act="none"><small>' + t + "</small><b>" + g + "</b></button>").join("") +
      "</div>" +
      '<div class="pm-idbox">' +
        '<div class="pm-idrow"><span>ID:' + esc(bookingId) + "<br/>" + esc(prevDay) + " 23:42　Un</span>" +
        '<span class="pm-idbtns"><button type="button" class="pm-red" data-act="none">完了</button><button type="button" class="pm-x" data-act="close">X</button></span></div>' +
        '<div class="pm-tabrow"><span class="pm-tab">' + (esc(name) || "予約") + '</span><button type="button" class="pm-plus" data-act="none">＋</button></div>' +
        '<div class="pm-btnrow"><button type="button" class="pm-outline" data-act="none">精算</button><span></span><button type="button" class="pm-red" data-act="cancel">削除</button></div>' +
        '<div class="pm-btnrow"><label class="pm-mini"><input type="checkbox"/> 他店</label><button type="button" class="pm-red" data-act="none">検索</button><button type="button" class="pm-red" data-act="none">＋ 新規</button></div>' +
        '<div class="pm-dtrow"><span class="pm-cap">日時</span><b>' + esc(dateISO) + " " + hh + ":" + mm + "〜</b></div>" +
        '<div class="pm-chips"><span class="pm-chip">' + esc(menu.slice(0, 22)) + '</span><button type="button" class="pm-plus" data-act="none">＋</button></div>' +
        '<div class="pm-btnrow pm-right"><button type="button" class="pm-red" data-act="edit">編集</button><button type="button" class="pm-red" data-act="cancel">削除</button></div>' +
        '<table class="pm-table"><tbody>' +
          [["時間", hh + ":" + mm], ["ブース", "新規1(1)"], ["スタッフ", esc(staffName) + ' <span class="pm-star">★</span>'],
           ["コース", esc(menu.slice(0, 24))], ["オプション", ""], ["こだわり", ""],
           ["予約タグ", "TORICOM"], ["施術タグ", ""], ["施術コメント", ""]]
            .map(([k, v]) => "<tr><th>" + k + "</th><td>" + v + "</td></tr>").join("") +
        "</tbody></table>" +
      "</div>";

    let pd = old;
    if (!pd) {
      pd = document.createElement("div");
      pd.id = "pm-pd";
      side.appendChild(pd);
      pd.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        const buttons = [...form.querySelectorAll(".ledger-form-actions button")];
        if (act === "close") buttons.find((b) => b.textContent === "戻る")?.click();
        else if (act === "cancel") buttons.find((b) => b.textContent === "予約取消")?.click();
        else if (act === "edit") form.classList.toggle("pm-editing");
      });
    }
    if (pd.dataset.html !== html) { pd.dataset.html = html; pd.innerHTML = html; }
  }

  // 月間シフト作成画面：本物と同じツールバー（一括作成・シフト作成・変更/削除・出力）を組み込む
  function decorateMonth() {
    const month = document.querySelector(".ledger-month");
    document.body.classList.toggle("pm-month-on", !!month);
    if (!month) { document.getElementById("pm-month-title")?.remove(); return; }
    month.classList.add("pm-month");

    // 黄色いタイトルバー
    if (!document.getElementById("pm-month-title")) {
      const t = document.createElement("div");
      t.id = "pm-month-title";
      t.textContent = "月間シフト作成/目標設定";
      month.insertAdjacentElement("afterbegin", t);
    }

    // 見出し行の◀▶を「前月」「翌月」ピルに
    const heading = month.querySelector(".ledger-month-heading");
    if (heading) {
      const btns = [...heading.querySelectorAll("button")];
      const prev = btns.find((b) => b.textContent === "◀" || b.textContent === "前月");
      const next = btns.find((b) => b.textContent === "▶" || b.textContent === "翌月");
      if (prev && prev.textContent !== "前月") prev.textContent = "前月";
      if (next && next.textContent !== "翌月") next.textContent = "翌月";
      prev?.classList.add("pm-pill", "pm-prev");
      next?.classList.add("pm-pill");
      const create = heading.querySelector(".ledger-create");
      if (create) create.style.display = "none"; // 実体は残し、緑/青ボタンから呼ぶ

      if (!document.getElementById("pm-month-tools")) {
        // 左：目標保存＋「n人分・スタッフ・一括作成」の枠
        const left = document.createElement("div");
        left.id = "pm-month-left";
        const goal = document.createElement("button");
        goal.type = "button"; goal.className = "pm-red"; goal.textContent = "目標保存";
        goal.title = "デモ版では使用できません";
        const grp = document.createElement("span");
        grp.id = "pm-bulk-group";
        const cnt = document.createElement("select");
        cnt.id = "pm-bulk-count";
        cnt.innerHTML = [1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join("");
        const sel = document.createElement("select");
        sel.id = "pm-bulk-staff";
        const bulk = document.createElement("button");
        bulk.type = "button"; bulk.className = "pm-red"; bulk.textContent = "一括作成";
        bulk.title = "選んだスタッフの1か月分のマスをまとめて選択します";
        bulk.addEventListener("click", () => {
          const name = sel.value;
          const table = month.querySelector("table");
          if (!table) return;
          const heads = [...table.querySelectorAll("thead th")].map((th) => th.childNodes[0]?.textContent || th.textContent);
          table.querySelectorAll("tbody tr").forEach((tr) => {
            [...tr.children].forEach((td, i) => {
              if (i === 0) return;
              if (name !== "未定" && heads[i] !== name) return;
              const cb = td.querySelector('input[type="checkbox"]');
              if (cb && !cb.checked) cb.click();
            });
          });
        });
        grp.append(cnt, " 人分 ", sel, " ", bulk);
        left.append(goal, grp);
        heading.appendChild(left);
        // 右：シフト作成（緑）／ヘルプ作成（赤）／シフト変更・削除（青）
        const bar = document.createElement("div");
        bar.id = "pm-month-tools";
        const mkBtn = (label, cls, fn, deco) => {
          const b = document.createElement("button");
          b.type = "button"; b.className = cls; b.textContent = label;
          if (fn) b.addEventListener("click", fn);
          if (deco) b.title = "デモ版では使用できません";
          return b;
        };
        const openModal = () => month.querySelector(".ledger-create")?.click();
        bar.append(mkBtn("シフト作成", "pm-green", openModal),
          mkBtn("ヘルプ作成", "pm-red", null, true),
          mkBtn("シフト変更・削除", "pm-blue", openModal));
        heading.appendChild(bar);
      }
      // スタッフ選択肢を最新化
      const sel = document.getElementById("pm-bulk-staff");
      if (sel && window.__pmLocks) {
        const names = ["未定", ...Object.keys(window.__pmLocks)];
        if (sel.options.length !== names.length) {
          sel.innerHTML = names.map((n) => `<option>${n}</option>`).join("");
        }
      }
    }

    // 表：本物と同じ「日次予算(目標)・目標コメント」列を追加し、日付表記を合わせる
    const headRow = month.querySelector("thead tr");
    if (headRow && !headRow.querySelector(".pm-goal-th")) {
      const budget = document.createElement("th");
      budget.className = "pm-goal-th"; budget.textContent = "日次予算(目標)";
      const comment = document.createElement("th");
      comment.className = "pm-goal-th"; comment.textContent = "目標コメント";
      headRow.children[0].after(budget, comment);
    }
    month.querySelectorAll("tbody tr").forEach((tr) => {
      if (!tr.querySelector(".pm-goal")) {
        const budget = document.createElement("td");
        budget.className = "pm-goal";
        budget.innerHTML = '<input type="text" inputmode="numeric" value="0" title="日次予算（デモ）">';
        const comment = document.createElement("td");
        comment.className = "pm-goal";
        comment.innerHTML = '<input type="text" title="目標コメント（デモ）">';
        tr.children[0].after(budget, comment);
      }
      // 「9月26日（土）」→「09月26日 (土)」
      const th = tr.querySelector("th");
      if (th) {
        for (const n of th.childNodes) {
          if (n.nodeType !== 3) continue;
          if (/^\d{1,2}$/.test(n.textContent)) n.textContent = n.textContent.padStart(2, "0");
          else if (n.textContent === "日（") n.textContent = "日 (";
          else if (n.textContent === "）") n.textContent = ")";
        }
      }
    });

    // セルの時間表記を本物と同じ「10:00-22:00」に
    month.querySelectorAll("tbody label").forEach((l) => {
      for (const n of l.childNodes) {
        if (n.nodeType === 3 && n.textContent.includes("〜")) n.textContent = n.textContent.replace("〜", "-");
      }
    });

    // 下部の操作列（目標保存・シフト作成・シフト出力）
    if (!document.getElementById("pm-month-bottom")) {
      const bar = document.createElement("div");
      bar.id = "pm-month-bottom";
      const mk = (label, cls, fn, deco) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = cls; b.textContent = label;
        if (fn) b.addEventListener("click", fn);
        if (deco) b.title = "デモ版では使用できません";
        return b;
      };
      bar.append(
        mk("目標保存", "pm-red", null, true),
        mk("シフト作成", "pm-green", () => month.querySelector(".ledger-create")?.click()),
        mk("シフト出力", "pm-orange", exportShiftsCsv),
      );
      month.appendChild(bar);
    }

    // 一括登録モーダル：タイトルを本物に合わせ、「削除」ボタンを追加
    const modal = [...document.querySelectorAll(".ledger-modal")].find((m) => m.textContent.includes("シフト登録（"));
    if (modal) {
      const h2 = modal.querySelector("h2");
      if (h2 && !h2.dataset.pmKeep) h2.insertAdjacentHTML("beforebegin",
        '<div class="pm-modal-note"><b>シフト一括登録</b><span>選択したスタッフのシフトを一括登録します。</span></div>');
      if (h2) h2.dataset.pmKeep = "1";
      const actions = modal.querySelector(".ledger-form-actions");
      if (actions && !actions.querySelector(".pm-bulk-del")) {
        const del = document.createElement("button");
        del.type = "button"; del.className = "pm-red pm-bulk-del"; del.textContent = "削除";
        del.title = "選択した枠のシフトを削除します（休憩・業務も一緒に削除。予約が残る日は削除できません）";
        del.addEventListener("click", async () => {
          if (!window.confirm("選択した枠のシフトを削除しますか？")) return;
          const cells = [...document.querySelectorAll('.ledger-month tbody input[type="checkbox"]:checked')]
            .map((cb) => (cb.getAttribute("aria-label") || "").split(" "))
            .filter((a) => a.length >= 2);
          if (!cells.length) return;
          try {
            const today = new Date(Date.now() + 9 * 3600e3 - 108e5).toISOString().slice(0, 10);
            const sched = await (await fetch("/api/demo/schedule?date=" + cells[0][0], { cache: "no-store" })).json();
            const rev = {};
            for (const d of sched.days) rev[d.date] = d.version;
            const ids = {};
            for (const st of sched.staff) ids[st.name] = st.id;
            const payload = {
              action: "bulkShift", remove: true, date: today, revision: 0,
              cells: cells.map(([d, ...n]) => ({ date: d, staffId: ids[n.join(" ")], revision: rev[d] ?? 0 })),
            };
            const r = await fetch("/api/demo/schedule", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error);
            [...modal.querySelectorAll("button")].find((b) => b.textContent === "閉じる")?.click();
            // 選択を解除する（画面は数秒以内の自動再取得で最新になる）
            document.querySelectorAll('.ledger-month tbody input:checked').forEach((cb) => cb.click());
          } catch (e) {
            alert(e.message === "scheduleConflict"
              ? "お客様の予約が残っている日が含まれているため削除できませんでした。"
              : "削除できませんでした。");
          }
        });
        actions.insertBefore(del, actions.lastElementChild);
      }
    }
  }

  // 店舗情報：予約フォームのフリーメッセージ欄の設定（保存すると予約サイトへ即時反映）
  async function openShopSettings() {
    document.getElementById("pm-shop-modal")?.remove();
    let s = { visible: true, required: false, label: "", placeholder: "", description: "", maxLength: 2000 };
    try {
      const r = await fetch("/api/demo/settings", { cache: "no-store" });
      s = (await r.json()).freeMessage || s;
    } catch {}
    const wrap = document.createElement("div");
    wrap.id = "pm-shop-modal";
    wrap.innerHTML =
      '<section role="dialog" aria-modal="true">' +
      "<h2>店舗マスタ｜予約用ホームページ</h2>" +
      '<p class="pm-shop-sub">予約フォームの「フリーメッセージ（ご要望・ご相談）」欄の設定です。保存すると予約サイトに即時反映されます。</p>' +
      '<label class="pm-shop-check"><input type="checkbox" id="pm-fm-visible"> 入力欄を表示する</label>' +
      '<label class="pm-shop-check"><input type="checkbox" id="pm-fm-required"> 入力を必須にする</label>' +
      '<label>見出し（空欄なら標準の文言）<input type="text" id="pm-fm-label" maxlength="60"></label>' +
      '<label>入力欄のヒント（placeholder）<input type="text" id="pm-fm-placeholder" maxlength="200"></label>' +
      '<label>説明文（欄の下に表示）<input type="text" id="pm-fm-description" maxlength="300"></label>' +
      '<label>文字数制限（1〜2000）<input type="number" id="pm-fm-maxlength" min="1" max="2000"></label>' +
      '<div class="pm-shop-actions"><button type="button" class="pm-red" id="pm-fm-save">保存</button>' +
      '<button type="button" id="pm-fm-close">閉じる</button></div>' +
      "</section>";
    document.body.appendChild(wrap);
    const g = (id) => wrap.querySelector("#" + id);
    g("pm-fm-visible").checked = s.visible !== false;
    g("pm-fm-required").checked = s.required === true;
    g("pm-fm-label").value = s.label || "";
    g("pm-fm-placeholder").value = s.placeholder || "";
    g("pm-fm-description").value = s.description || "";
    g("pm-fm-maxlength").value = s.maxLength || 2000;
    const close = () => wrap.remove();
    g("pm-fm-close").addEventListener("click", close);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    g("pm-fm-save").addEventListener("click", async () => {
      try {
        const r = await fetch("/api/demo/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            freeMessage: {
              visible: g("pm-fm-visible").checked,
              required: g("pm-fm-required").checked,
              label: g("pm-fm-label").value,
              placeholder: g("pm-fm-placeholder").value,
              description: g("pm-fm-description").value,
              maxLength: Number(g("pm-fm-maxlength").value) || 2000,
            },
          }),
        });
        if (!r.ok) throw new Error();
        close();
        window.alert("保存しました。予約サイトのフリーメッセージ欄に反映されます。");
      } catch {
        window.alert("保存できませんでした。接続を確認して再度お試しください。");
      }
    });
  }

  // 表示中の月のシフトをCSVでダウンロードする
  async function exportShiftsCsv() {
    const monthLabel = document.querySelector(".ledger-month-heading b")?.textContent || "";
    const m = monthLabel.match(/(\d{4})年\s*(\d{1,2})月/);
    if (!m) return;
    const ym = `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;
    const today = new Date(Date.now() + 9 * 3600e3 - 108e5).toISOString().slice(0, 10);
    const from = ym === today.slice(0, 7) ? today : ym + "-01";
    const sched = await (await fetch("/api/demo/schedule?date=" + from, { cache: "no-store" })).json();
    const names = {};
    for (const st of sched.staff) names[st.id] = st.name;
    const hhmm = (ms, d) => {
      const base = Date.parse(d + "T00:00:00+09:00");
      const min = Math.round((ms - base) / 60000);
      return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    };
    const rows = [["日付", "スタッフ", "開始", "終了"]];
    for (const sh of sched.shifts.filter((x) => x.date.startsWith(ym)).sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([sh.date, names[sh.staff_id] || sh.staff_id, hhmm(sh.start_at, sh.date), hhmm(sh.end_at, sh.date)]);
    }
    const csv = "﻿" + rows.map((r) => r.join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `shift_${ym}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // 鍵（予約受付停止）状態の取得。3秒キャッシュで管理画面と予約サイトに追従する。
  async function refreshLocks(force) {
    const now = Date.now();
    if (!force && window.__pmLocksAt && now - window.__pmLocksAt < 3000) return;
    window.__pmLocksAt = now;
    try {
      const r = await fetch("/api/demo/locks", { cache: "no-store" });
      const d = await r.json();
      const map = {};
      for (const l of d.locks) map[l.name] = l;
      window.__pmLocks = map;
    } catch {}
  }

  function dateISOMinus1(d) {
    if (!d) return "";
    return new Date(Date.parse(d + "T00:00:00Z") - 86400e3).toISOString().slice(0, 10);
  }

  // 下部の集計バー（赤・黒・青の3段）
  function decorateStats() {
    const sum = document.querySelector(".ledger-summary");
    if (!sum || sum.hidden) { document.getElementById("pm-stats")?.remove(); return; }
    const text = sum.textContent || "";
    const num = (re) => Number((text.match(re) || [])[1] || 0);
    const total = (text.match(/予約合計\s*([\d,]+)/) || [])[1] || "0";
    const count = num(/予約件数\s*(\d+)/);
    const people = num(/予約人数\s*(\d+)/);
    const fresh = Math.ceil(people / 2), repeat = people - fresh;
    const html =
      '<div class="pm-stat-black">新規：' + fresh + "名　リピート：" + repeat + "名　総来店人数：" + people +
        "名　施術件数：" + count + "件　客単価：0円　取消：3件　無断キャンセル：0件　返客：0件</div>" +
      '<div class="pm-stat-blue">施術：0円/' + total + "円　物販：0円/0円　回数券販売：0円/0円　プリベイド販売：0円/0円</div>";
    let el = document.getElementById("pm-stats");
    if (!el) {
      el = document.createElement("div");
      el.id = "pm-stats";
      sum.appendChild(el);
    }
    if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
  }

  setInterval(ensure, 600);
  document.addEventListener("DOMContentLoaded", ensure);
})();
