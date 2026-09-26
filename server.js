// 保存した元サイトのファイルを、元サイトと同じURLで返すローカルサーバーです。
// pages/ と public/ の中身は元サイトから受け取ったまま（無加工）です。
// 起動: VS Codeで F5 、またはターミナルで `node server.js`
const http = require("http");
const fs = require("fs");
const path = require("path");

const { handleDemoApi } = require("./demo-api");

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
  const isAdmin = url
    ? url.pathname === "/admin" || url.pathname.startsWith("/admin/") || url.pathname === "/demo/admin"
    : /AdminSchedule/.test(file);
  return isAdmin ? ADMIN_BRAND : BOOKING_BRAND;
}

// 覚えやすい入口URL（どちらも本来のページへ転送する）
const ENTRY_URLS = {
  "/cn-ueno-health-and-beauty": "/",
  "/cn-ueno": "/",
  "/cnsalon@board": "/admin/login",
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
          text = text.replace("</body>", '<script src="/booking-tweaks.js" defer></script></body>');
        }
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
// ・サーバーは 127.0.0.1 のみで待ち受けるため、同じネットワークの他の端末や
//   インターネットからは一切接続できません（予約・顧客・会社情報は外に出ません）
// ・データはこのパソコンのメモリ上のみ。メールも実際には送信しません
// ・下の2つの検査で、悪意あるWebサイト経由のアクセス（DNSリバインディング・CSRF）も遮断します
const LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
const LOCAL_ORIGIN_RE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const head = req.method === "HEAD";

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
  // 入口URL：/cn-ueno-health-and-beauty（予約サイト）・/CNsalon@board（管理画面）
  const entry = ENTRY_URLS[pathname.toLowerCase()];
  if (entry) {
    res.writeHead(302, { Location: entry });
    return res.end();
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
});

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
  console.log(`起動しました。`);
  console.log(`  予約サイト【${BOOKING_BRAND}】 : http://${HOST}:${port}/cn-ueno-health-and-beauty`);
  console.log(`  管理画面 【${ADMIN_BRAND}】 : http://${HOST}:${port}/CNsalon@board`);
});
server.listen(port, HOST);
