"use strict";
// 休憩・業務の実際の画面コードを、架空のスタッフ・通信で検査する。本番へ接続しない。
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(process.argv[2]||path.join(__dirname,"../public/pm-layout.js"),"utf8");
const issues=[];let checks=0;
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a,start);return source.slice(a,b);};
async function test(name,fn){try{await fn();checks++;}catch(e){issues.push({name,error:e.message});}}
function judgeSetup(){
  const date="2026-10-22",base=Date.parse(date+"T00:00:00+09:00"),ms=n=>base+n*60000;
  const staff=[{id:"a",name:"テストA",gender:"male",courses:'["other"]',info_missing:[]},{id:"b",name:"テストB",gender:"female",courses:'["other"]',info_missing:["画像","フリーメッセージ"],locked:true,active:0}];
  const data={staff,shifts:staff.map(s=>({date,staff_id:s.id,start_at:ms(600),end_at:ms(1080)})),blocks:[],bookings:[],assignments:[]};
  const context=vm.createContext({window:{},staffIn:(d,id)=>d.staff.find(s=>s.id===id),minOf:(_d,t)=>(t-base)/60000,dayLabel:d=>d,hm:String,ERR:{staffInfoMissing:"情報不足",staffLocked:"受付停止",outsideShift:"勤務外",staffCannotDoCourse:"対応外",staffGenderOnly:"性別指定"}});
  vm.runInContext(part("  window.__pmStaffMismatch =","  window.__pmConfirmBookingMove =")+part("  function judge(","  // ---- 押す")+";this.judge=judge;",context);
  const p={date,data,item:{type:"block",id:"test-block",staffId:"a",start:600,end:660},booking:{course:"course",course_name:"男性オイル"}};
  const target={kind:"row",date,staffId:"b",start:900,end:960};return{context,p,target,data,ms};
}
async function destinationTests(){
  for(const kind of ["break","work"])await test(kind+"は写真紹介・予約受付停止・スキル条件で移動を止めない",()=>{const x=judgeSetup();x.p.item.kind=kind;assert.equal(x.context.judge(x.p,x.target).level,"ok");});
  await test("予約枠は写真紹介不足の別担当へ移せない",()=>{const x=judgeSetup();x.p.item.type="booking";assert.equal(x.context.judge(x.p,x.target).level,"ng");});
  await test("予約枠のスキル制限を維持",()=>{const x=judgeSetup();x.p.item.type="booking";x.data.staff[1].info_missing=[];x.data.staff[1].locked=false;assert.equal(x.context.judge(x.p,x.target).reason,"対応外");});
  await test("業務枠も勤務外へは移動不可",()=>{const x=judgeSetup();assert.equal(x.context.judge(x.p,{...x.target,start:1050,end:1110}).level,"ng");});
  await test("業務枠も未登録スタッフへは移動不可",()=>{const x=judgeSetup();assert.equal(x.context.judge(x.p,{...x.target,staffId:"missing"}).level,"ng");});
  await test("業務枠も別の業務・休憩との重複は不可",()=>{const x=judgeSetup();x.data.blocks=[{id:"other",staff_id:"b",start_at:x.ms(930),end_at:x.ms(990)}];assert.equal(x.context.judge(x.p,x.target).level,"ng");});
  await test("業務枠も予約との重複は不可",()=>{const x=judgeSetup();x.data.bookings=[{id:"test-booking",status:"confirmed",start_at:x.ms(930),end_at:x.ms(990)}];x.data.assignments=[{booking_id:"test-booking",staff_id:"b"}];assert.equal(x.context.judge(x.p,x.target).level,"ng");});
  await test("動かしている業務枠自身を重複扱いしない",()=>{const x=judgeSetup();x.data.blocks=[{id:"test-block",staff_id:"a",start_at:x.ms(600),end_at:x.ms(660)}];assert.equal(x.context.judge(x.p,{...x.target,staffId:"a",start:630,end:690}).level,"ok");});
  await test("業務・休憩を別日移動の札へは入れない",()=>{const x=judgeSetup();assert.equal(x.context.judge(x.p,{kind:"park"}).level,"ng");});
}
async function durationTests(){
  const posts=[],input={value:"75"};let dragging=false;
  const context=vm.createContext({window:{fetch:async(_url,init)=>{posts.push(JSON.parse(init.body));return{ok:false};}},Response,
    document:{body:{classList:{contains:()=>dragging}},querySelector:()=>input}});
  vm.runInContext(part("  const origFetch =","  // 狭い画面"),context);
  const send=body=>context.window.fetch("/api/demo/schedule",{method:"POST",body:JSON.stringify({action:"block",date:"2026-10-22",staffId:"b",start:600,end:630,kind:"work",...body})});
  await test("フォームの自由入力75分を登録へ反映",async()=>{await send({});assert.equal(posts.at(-1).end,675);});
  await test("フォームの75分が別枠の30分ドラッグを上書きしない",async()=>{dragging=true;await send({id:"test-block"});assert.equal(posts.at(-1).end,630);dragging=false;});
  await test("削除時に自由入力を適用しない",async()=>{await send({id:"test-block",remove:true});assert.equal(posts.at(-1).end,630);});
  await test("空欄なら選択済みの終了時刻を維持",async()=>{input.value="";await send({});assert.equal(posts.at(-1).end,630);});
  for(const value of ["4","1021","75.5","-1"])await test("不正な自由入力"+value+"を丸めて登録しない",async()=>{input.value=value;const count=posts.length,r=await send({});assert.equal(r.status,400);assert.equal(posts.length,count);assert.equal((await r.json()).error,"invalid");});
}
async function saveTests(){
  for(const kind of ["break","work"])await test(kind+"のドラッグは長さ・種別・メモを保ち1回だけ保存",async()=>{
    const posts=[];let landed=0;
    const context=vm.createContext({window:{__pmConfirmBookingMove:()=>assert.fail("業務枠にお客様の指名確認は不要")},versionOf:async()=>7,AbortSignal,
      fetch:async(_url,init)=>{posts.push(JSON.parse(init.body));return{status:200,json:async()=>({ok:true})};},land:async()=>{landed++;},toast(){}});
    vm.runInContext(part("  async function commit(","  // その日の台帳の版")+";this.commit=commit;",context);
    const p={date:"2026-10-22",item:{type:"block",id:"test-block",staffId:"a",start:600,end:630,kind,note:"テスト業務メモ"},clone:{classList:{add(){}}}};
    await context.commit(p,{date:p.date,staffId:"b",start:720,end:750});assert.equal(posts.length,1);assert.equal(posts[0].id,"test-block");assert.equal(posts[0].staffId,"b");assert.equal(posts[0].end-posts[0].start,30);assert.equal(posts[0].kind,kind);assert.equal(posts[0].note,"テスト業務メモ");assert.equal(posts[0].revision,7);assert.equal(landed,1);
  });
}
(async()=>{await destinationTests();await durationTests();await saveTests();console.log(JSON.stringify({checks,issues},null,2));if(issues.length)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1});
