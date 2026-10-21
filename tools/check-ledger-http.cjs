#!/usr/bin/env node
"use strict";
// 本番には接続しない。送信無効のコピーと固定ローカルポートだけを使う。
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const BASE = new URL("http://127.0.0.1:5568"), root = path.resolve(process.argv[2] || ""), date = process.argv[3];
let cookie = "";
const cases = [], runId = crypto.randomUUID();
function request(route, body, authenticated = false) {
  const url = new URL(route, BASE);
  assert.equal(url.origin, "http://127.0.0.1:5568", "検証専用の接続先以外は禁止です");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5568");
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { Accept: "application/json", Origin: BASE.origin };
  if (authenticated) headers.Cookie = cookie;
  if (data) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = data.length; }
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: data ? "POST" : "GET", headers, timeout: 15000 }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")), cookies: res.headers["set-cookie"] || [] }); }
        catch { reject(new Error("検証用サーバーがJSON以外を返しました")); }
      });
    });
    req.on("error", e => reject(new Error("検証用サーバーへの接続に失敗しました: " + (/^[A-Z_]+$/.test(e.code || "") ? e.code : "network"))));
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  assert(root.startsWith("/private/tmp/")); assert(/^\d{4}-\d{2}-\d{2}$/.test(date || ""));
  assert(!fs.existsSync(path.join(root,"mail-config.json")));
  const snap = JSON.parse(fs.readFileSync(path.join(root,"safe-state.json"),"utf8"));
  assert(!snap.state.mailRelay?.url && !snap.state.mailRelay?.secret && snap.state.mails.length === 0);
  assert(fs.readFileSync(path.join(root,"copy-api.cjs"),"utf8").includes("DEMO_EPHEMERAL"));
  let r = await request("/api/demo/ledger?view=checkout&date=" + date);
  assert.equal(r.status,401); cases.push("未ログインの会計情報取得を拒否");
  const login = await request("/api/demo/login", { user:"test-admin",pass:"test-preview-pass" }); assert.equal(login.status,200);
  cookie = login.cookies.map(x=>x.split(";")[0]).join("; ");
  const get = async view => {const x=await request("/api/demo/ledger?view="+view+"&date="+date,undefined,true);assert.equal(x.status,200);return x.body;};
  for (const v of ["checkout","retail","returns","online","templates","patterns","integrity","dashboard","bookings"]) await get(v);
  cases.push("台帳9画面を認証付きHTTPで取得");
  const original = await get("retail"), key="ledger-http-"+runId;
  const product={action:"productSave",date,revision:original.revision,requestKey:key,name:"テスト HTTP商品",price:1200,active:1};
  const copies=await Promise.all(Array.from({length:20},()=>request("/api/demo/ledger",product,true)));
  copies.forEach(x=>assert.equal(x.status,200)); assert.equal(new Set(copies.map(x=>x.body.id)).size,1);
  const productId=copies[0].body.id, after=await get("retail");
  assert.equal(after.products.length,original.products.length+1); cases.push("物販商品20回同時送信でも1件だけ保存");
  r=await request("/api/demo/ledger",{...product,price:999},true);assert.equal(r.status,409);assert.equal(r.body.error,"requestChanged");
  r=await request("/api/demo/ledger",{...product,requestKey:key+"-stale"},true);assert.equal(r.status,409);assert.equal(r.body.error,"ledgerChanged");
  cases.push("同じキーの内容変更と古い画面からの上書きを拒否");
  const post=async body=>request("/api/demo/ledger",{date,revision:(await get("retail")).revision,requestKey:crypto.randomUUID(),...body},true);
  r=await post({action:"retailSale",name:"テスト HTTP販売",items:[{productId,quantity:2}],payments:[{method:"cash",amount:2400}]});assert.equal(r.status,200); const saleId=r.body.id;
  r=await post({action:"retailVoid",id:saleId,reason:"テスト 入力訂正"});assert.equal(r.status,200);
  let retail=await get("retail");assert.equal(retail.sales.find(x=>x.id===saleId).status,"void");
  cases.push("物販販売と理由付き取消を記録し履歴を保持");
  r=await post({action:"returnSave",name:"テスト HTTP待機",reason:"希望時間なし",kind:"キャンセル待ち",waitStatus:"待機中",time:900});assert.equal(r.status,200);const returnId=r.body.id;
  r=await post({action:"returnSave",id:returnId,name:"テスト HTTP待機",reason:"希望時間なし",kind:"キャンセル待ち",waitStatus:"案内済み",time:900});assert.equal(r.status,200);
  assert.equal((await get("returns")).returns.find(x=>x.id===returnId).waitStatus,"案内済み");
  r=await post({action:"returnDelete",id:returnId});assert.equal(r.status,200);assert.equal((await get("returns")).returns.find(x=>x.id===returnId).status,"void");
  cases.push("キャンセル待ちの新規・編集・取消を保存後に照合");
  const goal=await get("goals");
  r=await post({action:"goalSave",amount:12345,note:"テスト 目標",todayPlan:"テスト 計画",review:"テスト 振返り",dayRevision:goal.dayRevision});assert.equal(r.status,200);
  const dayReport=await request("/api/demo/report?date="+date,undefined,true);assert.equal(dayReport.body.today.goal,12345);
  r=await request("/api/demo/report",{date,revision:dayReport.body.revision-1,requestKey:crypto.randomUUID(),todayPlan:"テスト 古い変更"},true);assert.equal(r.status,409);
  cases.push("日次目標と日報が同じ値を表示し、古い編集を拒否");
  const bookingDate=process.argv[4] || date;
  const bs=await request("/api/demo/ledger?view=bookings&date="+bookingDate,undefined,true);
  const b=bs.body.bookings.find(x=>String(x.name).startsWith("テスト HTTP同時操作"));assert(b,"予約HTTP検査で作成したコピー内予約が必要です");
  const customerRoute="/api/demo/customer-records?bookingId="+encodeURIComponent(b.bookingId);
  const customer=await request(customerRoute,undefined,true);assert.equal(customer.status,200);
  const customerBody={bookingId:b.bookingId,revision:customer.body.revision,requestKey:crypto.randomUUID(),fields:{...customer.body.fields,name:"テスト 顧客共有確認",comment:"テスト 別端末共有"}};
  r=await request("/api/demo/customer-records",customerBody,true);assert.equal(r.status,200);
  const secondLogin=await request("/api/demo/login",{user:"test-admin",pass:"test-preview-pass"});cookie=secondLogin.cookies.map(x=>x.split(";")[0]).join("; ");
  const shared=await request(customerRoute,undefined,true);assert.equal(shared.body.fields.comment,"テスト 別端末共有");
  r=await request("/api/demo/customer-records",{...customerBody,requestKey:crypto.randomUUID()},true);assert.equal(r.status,409);
  r=await request("/api/demo/customer-records",customerBody,true);assert.equal(r.status,200);
  cases.push("顧客記録を別ログイン端末から取得・古い更新拒否・再送重複なし");
  const report=await request("/api/demo/report?date="+date,undefined,true);assert.equal(report.status,200);assert.equal(report.body.today.salesNet,null);assert.equal(report.body.today.profit,null);
  const out="/private/tmp/cnsalon-ledger-http-"+runId+".json";
  fs.writeFileSync(out,JSON.stringify({passed:true,cases},null,2),{mode:0o600});console.log(JSON.stringify({passed:true,checks:cases.length,artifact:out}));
})().catch(e=>{console.error(JSON.stringify({passed:false,completedChecks:cases.length,error:e.code || e.name,message:e.message.slice(0,160)}));process.exitCode=1;});
