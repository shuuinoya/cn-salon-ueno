"use strict";
// 実際の画面コードを使い、通信の応答順序と連打を外部通信なしで検査する。
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, ".."), read = file => fs.readFileSync(path.join(root, file), "utf8");
const layout = read("public/pm-layout.js");
const problems = []; let checks = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function part(source, start, end) { const a=source.indexOf(start),b=source.indexOf(end,a); assert(a>=0&&b>a,start); return source.slice(a,b); }
async function test(name, fn) { try { await fn(); checks++; } catch(e) { problems.push({name,error:e.message}); } }
function scheduleContext() {
  let shown="2026-10-22"; const pending=[];
  const context=vm.createContext({window:{},Date,
    document:{querySelector:()=>({getAttribute:()=>shown})},
    fetch:()=>{const d=deferred();pending.push(d);return d.promise;} });
  vm.runInContext(part(layout,"  async function refreshSched(","  // 台帳データが届いたら")+";this.refresh=refreshSched;",context);
  return {context,pending,show:d=>{shown=d;},reply:(i,version,status=200)=>pending[i].resolve({ok:status===200,status,json:async()=>({days:[{date:shown,version}],staff:[],bookings:[],blocks:[],assignments:[]})})};
}
async function refreshRisks() {
  await test("旧日付の遅い応答が表示中の日付を上書きしない",async()=>{const x=scheduleContext();const a=x.context.refresh(true);x.show("2026-10-23");const b=x.context.refresh(true);x.reply(1,2);await b;x.reply(0,1);await a;assert.equal(x.context.window.__pmSchedData.__date,"2026-10-23");});
  await test("同じ日の古い応答が新しい応答を上書きしない",async()=>{const x=scheduleContext();const a=x.context.refresh(true),b=x.context.refresh(true);x.reply(1,2);await b;x.reply(0,1);await a;assert.equal(x.context.window.__pmSchedData.days[0].version,2);});
  await test("失敗応答で正常な台帳データを置き換えない",async()=>{const x=scheduleContext();const a=x.context.refresh(true);x.reply(0,2);await a;const b=x.context.refresh(true);x.reply(1,0,401);await b;assert.equal(x.context.window.__pmSchedData.days[0].version,2);});
  await test("通知の旧版が新しい台帳データを上書きしない",async()=>{
    const date="2026-10-22",data=version=>({staff:[],bookings:[],days:[{date,version}],__date:date});let decorated=0;
    const context=vm.createContext({window:{__pmSchedData:data(3),__pmSchedFor:date},document:{querySelector:()=>({getAttribute:()=>date})},URLSearchParams,Date,decorateEvents:()=>{decorated++;},refreshLocks(){},prefetchNear(){}});
    vm.runInContext(part(layout,"  const onApi =", "  const prefetchNear =")+";this.receive=onApi;",context);
    context.receive({detail:{path:"/api/demo/schedule",search:"?date="+date,text:JSON.stringify(data(2))}});
    assert.equal(context.window.__pmSchedData.days[0].version,3);assert.equal(decorated,0);
    context.receive({detail:{path:"/api/demo/schedule",search:"?date="+date,text:JSON.stringify(data(4))}});
    assert.equal(context.window.__pmSchedData.days[0].version,4);assert.equal(decorated,1);
  });
}
async function autoRefreshDuringDrag() {
  for(const file of ["public/_next/static/chunks/AdminSchedule-pm2.js","public/_next/static/chunks/AdminSchedule-7iLokhEf.js"]) await test(path.basename(file)+" ドラッグ中の自動更新保留",async()=>{
    const source=read(file),body=part(source,"let e=!1,t=async()=>{","},[q]);let Oe");let timer,calls=0,dragging=true;
    const context=vm.createContext({Te:{current:false},Ee:{current:false},be:{current:0},q:async()=>{calls++;},
      window:{setInterval:f=>{timer=f;return 1;},clearInterval(){},addEventListener(){},removeEventListener(){}},
      document:{visibilityState:"visible",getElementById:()=>null,body:{classList:{contains:()=>dragging}},addEventListener(){},removeEventListener(){}}});
    vm.runInContext("(()=>{"+body+"})()",context);await timer();await tick();assert.equal(calls,0);dragging=false;await timer();await tick();assert.equal(calls,1);
  });
  for(const file of ["public/_next/static/chunks/AdminSchedule-pm2.js","public/_next/static/chunks/AdminSchedule-7iLokhEf.js"]) await test(path.basename(file)+" 取得中にドラッグ開始した場合も描画を保留",async()=>{
    const source=read(file),body=part(source,"async(e=!1)=>{let t=++be.current;","},[m,p]);");let dragging=false,applied=0;const pending=deferred();
    const context=vm.createContext({be:{current:0},Te:{current:false},se(){},we(){},C:()=>{applied++;},m:"2026-10-22",p:"/api/demo/schedule",ae:{},AbortSignal,
      document:{body:{classList:{contains:()=>dragging}}},fetch:()=>pending.promise});
    vm.runInContext("this.reload="+body+"}",context);const request=context.reload(true);dragging=true;pending.resolve({ok:true,json:async()=>({staff:[]})});await request;assert.equal(applied,0);
  });
}
async function cacheRisk() {
  await test("保存前GETの遅着で古い台帳を再キャッシュしない",async()=>{
    const pending=[],events=[];class ES{constructor(){this.listeners={}}addEventListener(k,f){this.listeners[k]=f}emit(v){this.listeners.message({data:v})}}
    const response=v=>new Response(JSON.stringify({version:v}),{headers:{"Content-Type":"application/json"}});
    const window={fetch:(_url,init)=>{if(init?.method==="POST")return Promise.resolve(response(2));const d=deferred();pending.push(d);return d.promise;},EventSource:ES,dispatchEvent:e=>events.push(e),addEventListener(){}};
    const context=vm.createContext({window,location:{href:"https://test.invalid/admin",origin:"https://test.invalid"},document:{readyState:"loading"},URL,Request,Response,DOMException,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail}},setTimeout:()=>0,clearTimeout(){},AbortController,Date});
    vm.runInContext(read("public/cn-fast.js"),context);new window.EventSource("/api/demo/events").emit("1");
    const url="/api/demo/schedule?date=2026-10-22",old=window.fetch(url);await window.fetch("/api/demo/schedule",{method:"POST",body:"{}"});
    const fresh=window.fetch(url);pending[1].resolve(response(2));await fresh;pending[0].resolve(response(1));await old;
    const cached=await (await window.fetch(url)).json();assert.equal(cached.version,2);
    const notifications=events.filter(e=>e.type==="cn:api");assert.equal(JSON.parse(notifications.at(-1).detail.text).version,2);
  });
}
async function publicSubmit() {
  await test("予約確定の連打・通信失敗再送は同じ予約キー1個を使用",async()=>{
    const s=read("public/_next/static/chunks/page-WafCof8Y.js"),source=part(s,"async function Z(","return(0,x.jsx)(m,");
    const posts=[],pending=[],redirects=[];
    const context=vm.createContext({F:{current:false},P:{current:""},I:true,C:{id:"test-course"},X:true,k:"test-staff",W:{nominationFee:500},
      w:100,T:"2026-10-22",E:1,O:"none",e:"ja",j(){},N(){},J(){},U(){},f:()=>"test-request-key",AbortSignal,Error,
      FormData:class{get(k){return {name:"テスト確認",email:"test@example.test",phone:"000",consent:"on"}[k]||""}},
      window:{location:{replace:p=>redirects.push(p)}},fetch:(_u,init)=>{posts.push(JSON.parse(init.body));const d=deferred();pending.push(d);return d.promise;}});
    vm.runInContext(source+";this.submit=Z;",context);const ev={preventDefault(){},currentTarget:{}};
    const first=context.submit(ev),double=context.submit(ev);assert.equal(posts.length,1);pending[0].reject(new Error("network"));await first;await double;
    const retry=context.submit(ev);assert.equal(posts.length,2);assert.equal(posts[0].requestKey,posts[1].requestKey);assert.equal(posts[1].name,"テスト確認");
    pending[1].resolve({ok:true,json:async()=>({id:"test-booking",token:"test-token"})});await retry;assert.equal(redirects.length,1);
    context.X=false;await context.submit(ev);assert.equal(posts.length,2,"確認条件が変わったら再確認まで送信しない");
  });
}
async function moveRetryRisks() {
  await test("移動の通信結果不明は再送せず再取得して確認する",async()=>{
    let posts=0,reloads=0,backs=0;const notices=[];
    const context=vm.createContext({window:{__pmConfirmBookingMove:async()=>true},versionOf:async()=>4,AbortSignal,ERR:{},
      fetch:async()=>{posts++;throw Error("network");},toast:m=>notices.push(m),reloadLedger:async()=>{reloads++;},back:()=>{backs++;},land:async()=>assert.fail("失敗時は成功演出にしない"),setParked(){}});
    vm.runInContext(part(layout,"  async function commit(","  // その日の台帳の版")+";this.commit=commit;",context);
    const p={date:"2026-10-22",item:{type:"booking",id:"test-booking",staffId:"a",start:600,end:660},clone:{classList:{add(){}}},data:{}};
    await context.commit(p,{date:p.date,staffId:"b",start:720,end:780});
    assert.equal(posts,1);assert.equal(reloads,1);assert.equal(backs,1);assert(notices.some(m=>m.includes("保存できたか分からない")));
  });
  await test("pointerupの重複で同じドラッグを2回保存しない",async()=>{
    let drops=0;const p={pointerId:5,dragging:true,el:{}};
    const context=vm.createContext({press:p,clearTimeout(){},stopListening(){},releasePointer(){},drop:async()=>{drops++;},back(){}});
    vm.runInContext(part(layout,"  function onUp(","  function onCancel(")+";this.up=onUp;",context);
    const event={pointerId:5,clientX:100,clientY:200};context.up(event);context.up(event);await tick();assert.equal(drops,1);
  });
}
function parkedFixture() {
  const date="2026-10-22",targetDate="2026-10-23",base=Date.parse(date+"T00:00:00+09:00");
  const booking={id:"test-parked",name:"テスト指名予約",course:"test-course",course_name:"テスト整体",people:1,status:"confirmed",start_at:base+600*60000,end_at:base+660*60000,nominated_staff_id:"a",nominated_staff_name:"テスト担当",nomination_fee:500};
  const x={source:{bookings:[booking],assignments:[{booking_id:booking.id,staff_id:"a"}],staff:[{id:"a",name:"テスト担当"}],days:[{date,version:4}]},gets:[],posts:[],confirmations:[],cleared:0,reloaded:0,returned:0,notices:[],getError:false};
  x.p={kind:"chip",date,shown:targetDate,staffName:"テスト担当",item:{id:booking.id,type:"booking",staffId:"a",start:600,end:660},booking:{...booking},data:{days:[{date:targetDate,version:9}]},clone:{classList:{add(){}}}};
  x.target={date:targetDate,staffId:"b",start:720,end:780};
  const context=vm.createContext({Date,AbortSignal,encodeURIComponent,ERR:{scheduleConflict:"台帳が変更されました"},
    minOf:(d,ms)=>(ms-Date.parse(d+"T00:00:00+09:00"))/60000,staffIn:(d,id)=>d.staff.find(s=>s.id===id),
    window:{__pmConfirmBookingMove:async move=>{x.confirmations.push(move);x.onConfirm?.();return true;}},
    fetch:async(url,init)=>{if(init?.method==="POST"){x.posts.push(JSON.parse(init.body));if(x.onPost)return x.onPost();return {status:200,json:async()=>({ok:true})};}x.gets.push(url);if(x.getError)throw Error("network");return {ok:true,json:async()=>structuredClone(x.source)};},
    setParked:value=>{assert.equal(value,null);x.cleared++;},reloadLedger:async()=>{x.reloaded++;},back:()=>{x.returned++;},land:async()=>{},toast:text=>x.notices.push(text)});
  vm.runInContext(part(layout,"  async function inspectParkedBooking(","  // 台帳を読み直す")+";this.commit=commit;",context);
  x.commit=()=>context.commit(x.p,x.target);return x;
}
async function parkedRisks() {
  await test("別日札は最新の元予約を確認し、その版と元担当・時刻を保存へ引き継ぐ",async()=>{
    const x=parkedFixture();await x.commit();assert.equal(x.gets.length,1);assert(x.gets[0].includes("moveCheck="));assert.equal(x.confirmations.length,1);
    assert.equal(x.confirmations[0].booking.nominated_staff_id,"a");assert.equal(x.posts.length,1);assert.equal(x.posts[0].revision,4);assert.equal(x.posts[0].toRevision,9);
    assert.equal(x.posts[0].expect.staffId,"a");assert.equal(x.posts[0].expect.start,600);assert.equal(x.cleared,1);
  });
  const changes=[
    ["お客様名",x=>{x.source.bookings[0].name="テスト変更後";}],
    ["メニュー",x=>{x.source.bookings[0].course="other-course";}],
    ["メニュー表示名",x=>{x.source.bookings[0].course_name="テスト別メニュー";}],
    ["人数",x=>{x.source.bookings[0].people=2;}],
    ["指名担当",x=>{x.source.bookings[0].nominated_staff_id="b";}],
    ["指名料",x=>{x.source.bookings[0].nomination_fee=1000;}],
    ["開始時刻",x=>{x.source.bookings[0].start_at+=60000;}],
    ["終了時刻",x=>{x.source.bookings[0].end_at+=60000;}],
    ["元担当",x=>{x.source.assignments[0].staff_id="c";}],
    ["取消",x=>{x.source.bookings[0].status="cancelled";}],
    ["別日への移動",x=>{x.source.bookings=[];}],
  ];
  for(const [label,change]of changes)await test("別日札の"+label+"変更は古い確認画面を出さず中止",async()=>{
    const x=parkedFixture();change(x);const before=JSON.stringify(x.source);await x.commit();assert.equal(x.confirmations.length,0);assert.equal(x.posts.length,0);assert.equal(x.cleared,1);assert.equal(x.returned,1);assert.equal(JSON.stringify(x.source),before,"予約自体は変更しない");
  });
  await test("別日札の元予約を取得できなければ札を残し保存しない",async()=>{const x=parkedFixture();x.getError=true;await x.commit();assert.equal(x.confirmations.length,0);assert.equal(x.posts.length,0);assert.equal(x.cleared,0);});
  await test("元予約の確認中に別タブで台帳が変わっても新しい版へ差し替えない",async()=>{
    const x=parkedFixture();x.onConfirm=()=>{x.source.days[0].version=5;};x.onPost=()=>({status:409,json:async()=>({error:"scheduleConflict"})});await x.commit();assert.equal(x.posts.length,1);assert.equal(x.posts[0].revision,4);assert.equal(x.cleared,0);assert.equal(x.returned,1);
  });
  await test("応答不明でも元予約の移動を読取確認できた場合は古い札だけ解除",async()=>{
    const x=parkedFixture();x.onPost=()=>{x.source.bookings=[];throw Error("network");};await x.commit();assert.equal(x.posts.length,1);assert.equal(x.gets.length,2);assert.equal(x.cleared,1);assert.equal(x.returned,1);assert(x.notices.some(n=>n.includes("札を解除")));
  });
  await test("応答不明で元予約に変化がない場合は再送せず札を保持",async()=>{
    const x=parkedFixture();x.onPost=()=>{throw Error("network");};await x.commit();assert.equal(x.posts.length,1);assert.equal(x.gets.length,2);assert.equal(x.cleared,0);assert.equal(x.returned,1);
  });
}
async function staffDecorationRisks() {
  await test("スタッフ行の装飾を100回繰り返しても星の文字や鍵を増殖させない",()=>{
    const names=["テスト担当A","テスト担当B","テスト担当C"],rows=[];let writes=0,listeners=0;
    for(const name of names){let star;const dataset={};Object.defineProperty(dataset,"pmstar",{get:()=>star,set:v=>{star=v;writes++;}});
      const cell={dataset,children:[{tagName:"B",textContent:name},{tagName:"SMALL",textContent:"10:00〜18:00"}],appendChild:n=>cell.children.push(n),
        querySelector:s=>s==="b"?cell.children[0]:s===".pm-lockbtn"?cell.children.find(n=>n.className==="pm-lockbtn"):null};
      rows.push({dataset:{staffId:"test-"+rows.length},cell,querySelector:()=>cell,classList:{toggle(){}}});
    }
    const context=vm.createContext({window:{__pmLocks:Object.fromEntries(names.map((name,i)=>["test-"+i,{id:"test-"+i,gender:i%2?"female":"male",locked:0}]))},refreshLocks(){},ledgerDate:()=>"2026-10-22",
      document:{querySelectorAll:()=>rows,createElement:()=>({dataset:{},setAttribute(){},addEventListener(){listeners++;}})}});
    const source=part(layout,"    const DECOR =", "    // 3c2)");for(let i=0;i<100;i++)vm.runInContext("(()=>{"+source+"})()",context);
    assert.equal(writes,names.length,"同じ星の値は繰り返し書き換えない");assert.equal(listeners,names.length*2,"鍵ボタンのクリック・キーボード登録は一人各1回");
    for(const row of rows){assert.equal(row.cell.children.length,3,"スタッフ名・勤務表示・鍵1個のみ");assert.equal(row.cell.children.filter(n=>String(n.textContent||"").includes("★")).length,0,"星の素の文字ノードは追加しない");assert.equal(row.cell.dataset.pmstar,"★0");}
    const css=read("public/pm-layout.css");assert.equal((css.match(/content:\s*attr\(data-pmstar\)/g)||[]).length,1,"星表示はCSS疑似要素1箇所のみ");
  });
}
(async()=>{await refreshRisks();await autoRefreshDuringDrag();await cacheRisk();await publicSubmit();await moveRetryRisks();await parkedRisks();await staffDecorationRisks();console.log(JSON.stringify({checks,problems},null,2));if(problems.length)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1});
