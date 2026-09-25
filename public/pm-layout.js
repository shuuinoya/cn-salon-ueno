// 本物の管理システム（Peak Manager）のレイアウトに合わせるための補完スクリプト。
// React（保存済みチャンク）が描き直しても消えないよう、定期的に不足分を足し直す。
(function () {
  "use strict";
  const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

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

    // 3b) スタッフ行ごとの装飾（★数・鍵・青スロット・ピンク強調・左端の色バー）
    const DECOR = {
      "藤倉 和美": { star: "50", pink: true, female: true },
      "山田 恵": { lock: true, blue: true, female: true },
      "中村敏樹": { lock: true, blue: true },
      "川井": { female: true },
    };
    document.querySelectorAll(".ledger-row").forEach((row) => {
      const cell = row.querySelector(".ledger-staff-cell");
      const name = cell?.querySelector("b")?.textContent || "";
      if (!cell) return;
      const d = DECOR[name] || {};
      const star = "★" + (d.star || "0");
      if (cell.dataset.pmstar !== star) cell.dataset.pmstar = star;
      if (!!d.lock !== (cell.dataset.pmlock === "1")) {
        if (d.lock) cell.dataset.pmlock = "1"; else delete cell.dataset.pmlock;
      }
      row.classList.toggle("pm-blue", !!d.blue);
      row.classList.toggle("pm-pink", !!d.pink);
      row.classList.toggle("pm-acc-f", !!d.female);
      row.classList.toggle("pm-acc-m", !d.female);
    });

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
