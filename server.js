// 保存した元サイトのファイルを、元サイトと同じURLで返すローカルサーバーです。
// pages/ と public/ の中身は元サイトから受け取ったまま（無加工）です。
// 起動: VS Codeで F5 、またはターミナルで `node server.js`
const http = require("http");
const fs = require("fs");
const path = require("path");

const { handleDemoApi, isAdminSession, clearSession } = require("./demo-api");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "routes.json"), "utf8"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

// サイト名の付け替え（配信時にのみ置き換える。保存ファイル自体は無加工のまま）
// 予約サイト＝CN Ueno health & beauty ／ 管理画面＝CNsalon@board
const OLD_BRAND = "UENO CN health＆beauty salon";
const BOOKING_BRAND = "CN Ueno health & beauty";
const ADMIN_BRAND = "CNsalon@board";
function brandFor(file, url) {
  // 管理画面のページタイトルだけ管理システム名（CNsalon@board）。
  // JSチャンク内の同名文字列は「店舗名」の定数（店舗セレクト等）なので、
  // 管理画面でも店舗名（CN Ueno health & beauty）のままにする。
  const isAdminPage = url &&
    (url.pathname === "/admin" || url.pathname.startsWith("/admin/") || url.pathname === "/demo/admin");
  return isAdminPage ? ADMIN_BRAND : BOOKING_BRAND;
}

// サイト名そのままの入口URL。転送ではなくその場で表示し、
// アドレスバーには名前のURLが残る（予約サイト＝店名／管理画面＝CNsalon@board）
// 上書きスクリプト類の更新時刻（キャッシュ破棄用の版番号）
function fileVer(name) {
  try { return String(Math.floor(fs.statSync(path.join(__dirname, "public", name)).mtimeMs)); } catch { return "1"; }
}
const TWEAKS_VER = fileVer("booking-tweaks.js");
const PM_VER = fileVer("pm-layout.js") + "-" + fileVer("pm-layout.css");

const ENTRY_URLS = {
  "/cn-ueno-health-and-beauty": "/",
  "/cnsalon-board": "/admin/login",
};

// URLの ?course= / ?courses= でページの中身が変わるので、保存したページを選び分ける
function routeKey(url) {
  if (url.pathname === "/menus/menu") {
    const c = url.searchParams.get("course");
    if (c) return `/menus/menu?course=${c}`;
  }
  if (url.pathname === "/book/select-datetime") {
    const c = url.searchParams.get("courses") ?? url.searchParams.get("course");
    if (c) return `/book/select-datetime?courses=${c}`;
  }
  return url.pathname;
}

function sendFile(res, file, status, type, head, url) {
  fs.readFile(file, (err, data) => {
    if (err) return send404(res, head);
    let body = data;
    const isHtml = type.startsWith("text/html");
    if (isHtml || type.startsWith("text/javascript")) {
      let text = data.toString("utf8");
      // 保存HTMLにはルーターの初期URL（searchParams）が保存時の値のまま埋め込まれている。
      // 実際のリクエストのクエリパラメータを注入しないと、確認・完了ページなどが
      // 「メニューを選択してください」表示になってしまうため、配信時に置き換える。
      if (url && isHtml) {
        const nav = JSON.stringify({
          pathname: url.pathname,
          searchParams: [...url.searchParams.entries()],
        });
        text = text.replace(
          /nav:\{"pathname":"[^"]*","searchParams":\[(?:\[[^\]]*\],?)*\]\}/,
          "nav:" + nav
        );
        // 予約ページには、管理画面のフリーメッセージ設定を反映するスクリプトを差し込む
        if (url.pathname.startsWith("/book")) {
          // ?v=更新時刻 を付けて、ブラウザに古いキャッシュを使わせない
          text = text.replace("</body>", '<script src="/booking-tweaks.js?v=' + TWEAKS_VER + '" defer></script></body>');
        }
        // ファビコン：予約サイト＝店のマーク（丸いロゴ）／管理画面＝4枚花びらのクローバーで統一
        // （版番号を付けて、ブラウザの頑固なファビコンキャッシュにも確実に反映させる）
        if (brandFor(file, url) === BOOKING_BRAND) {
          text = text.split("/favicon.svg").join("/fm-favicon.svg?v=" + fileVer("fm-favicon.svg"));
        } else {
          text = text.split("/favicon.svg").join("/pm-clover.svg?v=" + fileVer("pm-clover.svg"));
        }
        // 管理画面の上書きスクリプト・CSSにも版番号を付け、古いキャッシュが残らないようにする
        text = text
          .split('href="/pm-layout.css"').join('href="/pm-layout.css?v=' + PM_VER + '"')
          .split('src="/pm-layout.js"').join('src="/pm-layout.js?v=' + PM_VER + '"');
      }
      // サイト名の付け替え（HTML本文・RSCペイロード・JSチャンクをまとめて揃える）
      if (text.includes(OLD_BRAND)) text = text.split(OLD_BRAND).join(brandFor(file, url));
      body = Buffer.from(text);
    }
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(head ? undefined : body);
  });
}

function send404(res, head) {
  const r = routes.__404__;
  sendFile(res, path.join(ROOT, r.file), 404, r.contentType, head);
}

// ---- セキュリティ ----
// ・接続を受け付けるのは「このパソコン」と「同じネットワーク（Wi-Fi/LAN）のプライベートIP」のみ。
//   インターネット側のアドレスからの接続は下の検査で全て拒否します
// ・LANに開いても、管理画面と管理APIはすべてサーバー側でログイン・権限を検証します
//   （URLを知っているだけでは、ページも内部データも一切見えません）
// ・データはこのパソコンのメモリ上のみ（Single Source of Truth）。どの端末から
//   開いても、このサーバーが返す同じ最新データが表示されます
// ・下のHost/Origin検査で、悪意あるWebサイト経由のアクセス（DNSリバインディング・CSRF）も遮断します
// 数字なしのURL用ホスト名（「〜.localhost」はブラウザが自分のPCに解決、
// 「〜.local」はmDNS(Bonjour)配信により同じネットワークの他の端末から届く）
const NAME_HOSTS = {
  "cn-ueno-health-and-beauty.localhost": "/",
  "cnsalon-board.localhost": "/admin/login",
  // 他の端末（iPhone・iPad・別のPC）用のmDNS名
  "cn-ueno-health-and-beauty.local": "/",
  "cnsalon-board.local": "/admin/login",
  // 「.localhost」なしの短い名前（Macのhostsに登録すると使える）
  "cn-ueno-health-and-beauty": "/",
  "cnsalon-board": "/admin/login",
};
// 許可するホスト名は正式URL＋mDNS名＋localhost/プライベートIPのみ（その他の名前は拒否）
const HOST_NAMES = "cn-ueno-health-and-beauty(\\.localhost|\\.local)?|cnsalon-board(\\.localhost|\\.local)?";
const PRIVATE_IPS = "10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|169\\.254\\.\\d{1,3}\\.\\d{1,3}";
const LOCAL_HOST_RE = new RegExp(`^(127\\.0\\.0\\.1|\\[::1\\]|localhost|${HOST_NAMES}|${PRIVATE_IPS})(:\\d+)?$`, "i");
const LOCAL_ORIGIN_RE = new RegExp(`^http:\\/\\/(127\\.0\\.0\\.1|\\[::1\\]|localhost|${HOST_NAMES}|${PRIVATE_IPS})(:\\d+)?$`, "i");

const handler = (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const head = req.method === "HEAD";

  // 接続元の検査：このパソコン（ループバック）と、同じネットワークのプライベートIP
  // （Wi-Fi/LAN上のスタッフ端末）だけを許可し、インターネット側からの接続は全て拒否する。
  // ※LANの端末にも、管理画面・管理APIはログインと権限のサーバー側検証が必ずかかる
  const ra = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  const raOk = ra === "127.0.0.1" || ra === "::1" ||
    /^(10\.|192\.168\.|169\.254\.)/.test(ra) || /^172\.(1[6-9]|2\d|3[01])\./.test(ra) ||
    /^(fe80:|fd)/i.test(ra);
  if (!raOk) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }


  // Hostヘッダ検証：外部ドメイン名経由でローカルサーバーへ到達させる攻撃を遮断
  if (!LOCAL_HOST_RE.test(req.headers.host || "")) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }
  // 別サイトのページからの書き込み（予約作成・設定変更など）を遮断（CSRF対策）
  const origin = req.headers.origin;
  if (req.method !== "GET" && req.method !== "HEAD" && origin && !LOCAL_ORIGIN_RE.test(origin)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "forbidden" }));
  }
  // 基本のセキュリティヘッダ（内容の型偽装・他サイトへの埋め込み・参照元の漏えいを防ぐ）
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  // 名前ホスト（数字なしURL）のトップは、それぞれの入口ページを表示する
  const hostName = (req.headers.host || "").toLowerCase().replace(/:\d+$/, "");

  // ファビコンはホスト名で実体ごと出し分ける（リンク差し替えに加え、
  // 古いURL（/favicon.svg・/favicon.ico）を直接キャッシュしているブラウザにも効かせる）
  if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg") {
    const isAdminHost = hostName.startsWith("cnsalon-board");
    const isBookingHost = hostName.startsWith("cn-ueno");
    if (isAdminHost || isBookingHost || url.pathname === "/favicon.ico") {
      const fav = isAdminHost ? "pm-clover.svg" : "fm-favicon.svg";
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      if (!head) return fs.createReadStream(path.join(__dirname, "public", fav)).pipe(res);
      return res.end();
    }
  }
  if (NAME_HOSTS[hostName] && url.pathname === "/") {
    url.pathname = NAME_HOSTS[hostName];
  }

  // 管理画面はログイン必須（ID・パスワードはログイン画面から）
  const isAdminPage = url.pathname === "/admin" || url.pathname === "/demo/admin" ||
    url.pathname === "/admin-original" ||
    (url.pathname.startsWith("/admin/") && url.pathname !== "/admin/login");
  if (isAdminPage && !isAdminSession(req)) {
    res.writeHead(302, { Location: "/admin/login" });
    return res.end();
  }
  // ログアウト経由でログイン画面に来たらセッションを破棄する
  if (url.pathname === "/admin/login" && url.searchParams.get("out") === "1") {
    clearSession(req, res);
  }


  // 管理画面（操作デモ）用のAPIは、メモリ上の架空データで再現しています
  if (handleDemoApi(req, res, url)) return;

  // 予約・空き状況・ログインなどは元サイトのサーバーの機能なので、この保存版では使えません
  if (url.pathname.startsWith("/api/")) {
    res.writeHead(503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "unavailable" }));
  }
  if (!head && req.method !== "GET") {
    res.writeHead(405);
    return res.end();
  }

  // 画像・JavaScript・CSS・フォント
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send404(res, head);
  }
  // 入口URL：/cn-ueno-health-and-beauty（予約サイト）・/cnsalon-board（管理画面）
  // アドレスバーに名前を残すため、転送せずその場で本来のページを表示する
  const entry = ENTRY_URLS[pathname.toLowerCase()];
  if (entry) {
    const er = routes[entry];
    if (er && er.file) {
      const eu = new URL(url);
      eu.pathname = entry; // ページ内部のルーターには本来のパスを渡す
      return sendFile(res, path.join(ROOT, er.file), er.status, er.contentType, head, eu);
    }
  }

  const file = path.normalize(path.join(PUBLIC, pathname));
  if (file.startsWith(PUBLIC + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return sendFile(res, file, 200, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", head);
  }

  // 末尾が「/」のURLは元サイトと同じく「/」なしへ転送
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    res.writeHead(308, { Location: url.pathname.replace(/\/+$/, "") + url.search });
    return res.end();
  }

  // ページ（ページ移動時の裏側の通信 _rsc にも同じHTMLを返し、通常のページ読み込みにする）
  const r = routes[routeKey(url)] || routes[url.pathname];
  if (!r || !r.file) {
    // チャットやメモのリンクをクリックすると、URLの直後の全角文字まで
    // リンクに含まれてしまうことがある（例: /admin（管理画面））。
    // 末尾の非ASCII文字を取り除いた先が存在する場合はそちらへ転送する。
    const stripped = pathname.replace(/[^\x21-\x7e].*$/s, "") || "/";
    if (stripped !== pathname && (routes[stripped] || stripped === "/")) {
      res.writeHead(302, { Location: encodeURI(stripped) + url.search });
      return res.end();
    }
    return send404(res, head);
  }
  sendFile(res, path.join(ROOT, r.file), r.status, r.contentType, head, url);
};
const server = http.createServer(handler);

// ほかのサイト（localhost:3000 など）と混ざらないよう、専用の番号で起動する
const HOST = "127.0.0.1";
let port = Number(process.env.PORT) || 5520;
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    port += 1;
    server.listen(port, HOST);
  } else {
    throw e;
  }
});
server.on("listening", () => {
  process.env.DEMO_ORIGIN = `http://${HOST}:${port}`; // メール内のリンク生成用
  console.log("起動しました。");
  // 数字なしのURL（ポート80）。使用中などで開けない場合は番号つきURLを案内する
  const server80 = http.createServer(handler);
  server80.on("error", () => {
    console.log(`  予約サイト【${BOOKING_BRAND}】 : http://${HOST}:${port}/cn-ueno-health-and-beauty`);
    console.log(`  管理画面 【${ADMIN_BRAND}】 : http://${HOST}:${port}/cnsalon-board`);
  });
  server80.on("listening", () => {
    console.log(`  予約サイト【${BOOKING_BRAND}】 : http://cn-ueno-health-and-beauty.localhost/`);
    console.log(`  管理画面 【${ADMIN_BRAND}】 : http://cnsalon-board.localhost/`);
    // 同じWi-Fi/LANの他の端末（iPhone・iPad・別のPC・別のブラウザ）向けに、
    // mDNS(Bonjour)で「〜.local」の名前を配信する（macOS標準のdns-sdを使用。失敗しても本体は動く）
    try {
      const os = require("os");
      const { spawn, execFileSync } = require("child_process");
      if (process.platform === "darwin") {
        const ip = Object.values(os.networkInterfaces()).flat()
          .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
        if (ip) {
          // 前回起動の配信プロセスが残っていれば止める（IP変更後の古い配信を防ぐ）
          try { execFileSync("/usr/bin/pkill", ["-f", "dns-sd -P (cn-ueno-health-and-beauty|cnsalon-board)"]); } catch {}
          for (const h of ["cn-ueno-health-and-beauty", "cnsalon-board"]) {
            const c = spawn("/usr/bin/dns-sd", ["-P", h, "_http._tcp", "local", "80", `${h}.local`, ip], { stdio: "ignore" });
            c.on("error", () => {});
            process.on("exit", () => { try { c.kill(); } catch {} });
          }
          console.log("  ほかの端末（同じWi-Fi）から:");
          console.log(`    予約サイト : http://cn-ueno-health-and-beauty.local/`);
          console.log(`    管理画面   : http://cnsalon-board.local/`);
          console.log(`    名前で開けない端末は : http://${ip}/ （管理画面は http://${ip}/cnsalon-board ）`);
        }
      }
    } catch {}
  });
  // macOSは 127.0.0.1 指定だと80番を開けないため全体で待ち、上のループバック検査で守る
  if (port === 5520) server80.listen(80);
  else {
    console.log(`  予約サイト【${BOOKING_BRAND}】 : http://${HOST}:${port}/cn-ueno-health-and-beauty`);
    console.log(`  管理画面 【${ADMIN_BRAND}】 : http://${HOST}:${port}/cnsalon-board`);
  }
});
server.listen(port, HOST);
