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
    // 保存HTMLにはルーターの初期URL（searchParams）が保存時の値のまま埋め込まれている。
    // 実際のリクエストのクエリパラメータを注入しないと、確認・完了ページなどが
    // 「メニューを選択してください」表示になってしまうため、配信時に置き換える。
    if (url && type.startsWith("text/html")) {
      const nav = JSON.stringify({
        pathname: url.pathname,
        searchParams: [...url.searchParams.entries()],
      });
      let html = data.toString("utf8").replace(
        /nav:\{"pathname":"[^"]*","searchParams":\[(?:\[[^\]]*\],?)*\]\}/,
        "nav:" + nav
      );
      // 予約ページには、管理画面のフリーメッセージ設定を反映するスクリプトを差し込む
      if (url.pathname.startsWith("/book")) {
        html = html.replace("</body>", '<script src="/booking-tweaks.js" defer></script></body>');
      }
      body = Buffer.from(html);
    }
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(head ? undefined : body);
  });
}

function send404(res, head) {
  const r = routes.__404__;
  sendFile(res, path.join(ROOT, r.file), 404, r.contentType, head);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const head = req.method === "HEAD";

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
  console.log(`UENO CN health＆beauty salon（保存版）を起動しました: http://${HOST}:${port}`);
});
server.listen(port, HOST);
