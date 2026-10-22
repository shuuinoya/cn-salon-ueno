'use strict';
// 架空のメモリ内データだけで照合の保護を検査する。API・外部通信・保存設定は読み込まない。
const assert = require('node:assert/strict');
const { reconcile } = require('../staff-reconcile');
const id = n => `${10000000+n}-0000-4000-8000-${String(10000000+n).padStart(12,'0')}`;
const A = id(1), D = '2026-10-23', P = '2026-10-22', E = '2026-10-24';
const ms = (date, minute) => Date.parse(date+'T00:00:00+09:00')+minute*60000;
const encode = x => JSON.stringify(x,(_,v)=>v instanceof Map?{__pm_map__:[...v]}:v);
const courses = [{id:'c1',name:'テスト整体'},{id:'c2',name:'テスト足裏'}];
const ctx = {courses,today:P,minToMs:ms,err:(status,message)=>Object.assign(new Error(message),{status})};
const event = () => ({bookings:[],assignments:[],blocks:[]});
function fixture() {
  const profile = {peakManagerId:'101',nickname:'テスト表示',message:'テスト既存紹介',personalNomination:true,genderNomination:false,imageKey:'uploaded'};
  const state = {staff:[{id:A,name:'テスト担当',gender:'male',active:1,locked:0,sort_order:3,listing_order:8,
    courses:JSON.stringify(['c1','c2']),profile:JSON.stringify(profile),profile_revision:2}],staffIdHigh:10000001,
    photos:new Map([[A,'data:image/png;base64,dGVzdA==']]),shifts:new Map(),days:new Map(),events:new Map(),members:[{id:'test-member'}],tickets:[{id:'test-ticket'}],mails:[]};
  for (const date of [P,D,E]) {state.days.set(date,{version:1,enabled:true});state.events.set(date,event());state.shifts.set(date,[]);}
  const plan = {from:D,to:E,staff:[{id:A,sourceId:'101',name:'テスト担当',gender:'male',active:1,sortOrder:20,courses:['c1','c2'],profile:{...profile}}],
    shifts:[{date:D,staffId:A,start:600,end:1080},{date:E,staffId:A,start:600,end:1080}],blocks:[],locks:[],retireIds:[]};
  return {state,plan};
}
function booking(f,date,start,end,services=['c1']) {
  const ev=f.state.events.get(date)||event();
  ev.bookings.push({id:'test-'+date,status:'confirmed',course:services[0],services:services.map(courseId=>({courseId})),start_at:ms(date,start),end_at:ms(date,end)});
  ev.assignments.push({booking_id:'test-'+date,staff_id:A});f.state.events.set(date,ev);
}
function reject(f,code,body={...f.plan,dryRun:true}) {
  const before=encode(f.state);assert.throws(()=>reconcile(f.state,body,ctx),e=>e.message===code);assert.equal(encode(f.state),before,'拒否時の部分反映');
}
function apply(f) {const dry=reconcile(f.state,{...f.plan,dryRun:true},ctx);return reconcile(f.state,{...f.plan,expectedVersion:dry.expectedVersion},ctx);}
const checks=[];function check(name,fn){fn();checks.push(name);}
check('事前確認は無変更、管理順更新でも掲載Noと既存写真を維持',()=>{
  const f=fixture(),before=encode(f.state);reconcile(f.state,{...f.plan,dryRun:true},ctx);assert.equal(encode(f.state),before);
  f.plan.staff[0].listing_order=1;apply(f);assert.equal(f.state.staff[0].listing_order,8);assert.equal(f.state.staff[0].sort_order,20);assert.equal(f.state.photos.get(A),'data:image/png;base64,dGVzdA==');
});
check('原本の空欄で自社の紹介文・表示名・写真キーを消さない',()=>{
  const f=fixture();f.plan.staff[0].profile={message:'  ',nickname:'',imageKey:''};apply(f);const p=JSON.parse(f.state.staff[0].profile);
  assert.equal(p.message,'テスト既存紹介');assert.equal(p.nickname,'テスト表示');assert.equal(p.imageKey,'uploaded');
});
check('未読の指名設定・不正プロフィール値は拒否',()=>{
  for(const profile of [{personalNomination:null},{genderNomination:'false'},{message:{}},{nominationFee:NaN}]){const f=fixture();f.plan.staff[0].profile=profile;reject(f,'reconcileProfile');}
});
check('連続予約の2件目を対応外にする照合を拒否',()=>{const f=fixture();booking(f,D,660,780,['c1','c2']);f.plan.staff[0].courses=['c1'];reject(f,'reconcileBookingConflict');});
check('連続予約の全コース対応時は予約・担当をそのまま維持',()=>{const f=fixture();booking(f,D,660,780,['c1','c2']);const before=encode(f.state.events.get(D));apply(f);assert.equal(encode(f.state.events.get(D)),before);});
check('前日の深夜勤務と次の日の勤務が重なる照合を拒否',()=>{
  const f=fixture();f.plan.shifts[0]={date:D,staffId:A,start:30,end:120};f.state.shifts.set(P,[{date:P,staff_id:A,start_at:ms(P,1380),end_at:ms(P,1500)}]);reject(f,'reconcileShiftOverlap');
});
check('日をまたいでも終端と始端が同じ勤務は重複しない',()=>{
  const f=fixture();f.plan.shifts[0]={date:D,staffId:A,start:0,end:120};f.state.shifts.set(P,[{date:P,staff_id:A,start_at:ms(P,1380),end_at:ms(P,1440)}]);booking(f,P,1380,1440);const old=encode(f.state.events.get(P));apply(f);assert.equal(encode(f.state.events.get(P)),old);
});
check('前日の予約と次の日に追加する業務の重複を拒否',()=>{
  const f=fixture();f.plan.shifts[0]={date:D,staffId:A,start:0,end:120};f.plan.blocks=[{date:D,staffId:A,start:0,end:60,kind:'work'}];booking(f,P,1410,1470);reject(f,'reconcileBookingConflict');
});
check('前日に残る業務と今回期間内の予約の重複を拒否',()=>{
  const f=fixture();f.plan.shifts[0]={date:D,staffId:A,start:0,end:120};booking(f,D,0,60);f.state.events.get(P).blocks.push({id:'test-old-block',staff_id:A,start_at:ms(P,1410),end_at:ms(P,1470),kind:'break'});reject(f,'reconcileBookingConflict');
});
check('日をまたぐ業務同士の重複を拒否',()=>{
  const f=fixture();f.plan.shifts[0]={date:D,staffId:A,start:0,end:120};f.plan.blocks=[{date:D,staffId:A,start:0,end:60,kind:'break'}];f.state.events.get(P).blocks.push({id:'test-old-block',staff_id:A,start_at:ms(P,1410),end_at:ms(P,1470),kind:'work'});reject(f,'reconcileBlockOverlap');
});
check('現在版が同じ再送だけ反映済みとして無変更で返す',()=>{
  const f=fixture(),dry=reconcile(f.state,{...f.plan,dryRun:true},ctx);reconcile(f.state,{...f.plan,expectedVersion:dry.expectedVersion},ctx);const before=encode(f.state);
  assert.equal(reconcile(f.state,{...f.plan,expectedVersion:dry.expectedVersion},ctx).already,true);assert.equal(encode(f.state),before);
});
check('新規スタッフの掲載No.初期化後の版で再送を確認する',()=>{
  const f=fixture();f.plan.staff.push({...f.plan.staff[0],id:id(2),sourceId:'102',name:'テスト追加',profile:{message:'テスト紹介'}});
  const context={...ctx,initializeStaff:require('../staff-ordering').initialize};
  const before=encode(f.state),dry=reconcile(f.state,{...f.plan,dryRun:true},context);assert.equal(encode(f.state),before);
  reconcile(f.state,{...f.plan,expectedVersion:dry.expectedVersion},context);assert.equal(f.state.staff[0].listing_order,8);assert.equal(f.state.staff[1].listing_order,9);
  const after=encode(f.state);assert.equal(reconcile(f.state,{...f.plan,expectedVersion:dry.expectedVersion},context).already,true);assert.equal(encode(f.state),after);
});
check('同じ計画でも店側で変更した勤務・掲載Noを反映済みと誤認しない',()=>{
  for(const mutate of [f=>f.state.shifts.get(D)[0].end_at-=60000,f=>f.state.staff[0].listing_order=2]){
    const f=fixture(),dry=reconcile(f.state,{...f.plan,dryRun:true},ctx);reconcile(f.state,{...f.plan,expectedVersion:dry.expectedVersion},ctx);mutate(f);reject(f,'scheduleConflict',{...f.plan,expectedVersion:dry.expectedVersion});
  }
});
check('旧反映記録に現在版の印がない場合も一致したと推測しない',()=>{const f=fixture(),dry=reconcile(f.state,{...f.plan,dryRun:true},ctx);reconcile(f.state,{...f.plan,expectedVersion:dry.expectedVersion},ctx);delete f.state.staffReconciliation.appliedVersion;reject(f,'scheduleConflict',{...f.plan,expectedVersion:dry.expectedVersion});});
check('事前確認後の前日予約・前日勤務変更も競合として止める',()=>{
  for(const mutate of [f=>booking(f,P,1410,1470),f=>f.state.shifts.get(P).push({date:P,staff_id:A,start_at:ms(P,1380),end_at:ms(P,1500)})]){const f=fixture(),dry=reconcile(f.state,{...f.plan,dryRun:true},ctx);mutate(f);reject(f,'scheduleConflict',{...f.plan,expectedVersion:dry.expectedVersion});}
});
check('対象より前の勤務・業務・受付停止・会員・券を維持',()=>{
  const f=fixture();f.state.shifts.set(P,[{date:P,staff_id:A,start_at:ms(P,600),end_at:ms(P,1080)}]);f.state.days.get(P).locked=[A];f.state.events.get(P).blocks=[{staff_id:A,start_at:ms(P,720),end_at:ms(P,780),kind:'work'}];
  const protectedState=()=>encode([f.state.shifts.get(P),f.state.events.get(P),f.state.days.get(P),f.state.members,f.state.tickets,f.state.mails]);const before=protectedState();apply(f);assert.equal(protectedState(),before);
});
function withSkills(f) {
  f.plan.skillCatalog={groups:[{id:'test-main',name:'テスト分類',items:[
    {sourceId:'201',name:'テスト整体',gender:'none',courseId:'c1'},
    {sourceId:'202',name:'テスト足裏',gender:'none',courseId:'c2'},
    {sourceId:'203',name:'テスト女性担当',gender:'female',courseId:null},
    {sourceId:'204',name:'テスト男性担当',gender:'male',courseId:null}]}]};
  Object.assign(f.plan.staff[0].profile,{sourceSkillChecks:['201','202','204'],sourceSkillOriginalChecks:['201','202','203','204']});
  return f;
}
check('原本チェックをそのまま残し有効チェックと分類を別保存',()=>{
  const f=withSkills(fixture()),before=encode(f.state);reconcile(f.state,{...f.plan,dryRun:true},ctx);assert.equal(encode(f.state),before);
  apply(f);const p=JSON.parse(f.state.staff[0].profile);assert.deepEqual(p.sourceSkillChecks,['201','202','204']);assert.deepEqual(p.sourceSkillOriginalChecks,['201','202','203','204']);
  assert.equal(f.state.staffSkillCatalog.groups[0].items.length,4);assert.equal(f.state.staffSkillCatalog.version.length,64);assert.equal(f.state.staffReconciliation.before.staffSkillCatalog,null);
});
check('販売メニューと有効チェックの食い違いは一括反映を拒否',()=>{const f=withSkills(fixture());f.plan.staff[0].profile.sourceSkillChecks=['201','204'];reject(f,'reconcileSkills');});
check('販売外メニューも異性の有効チェックを拒否',()=>{const f=withSkills(fixture());f.plan.staff[0].profile.sourceSkillChecks.push('203');reject(f,'staffCourseGender');});
check('原本チェックの未知IDと二重登録を拒否',()=>{for(const ids of [['201','999'],['201','201']]){const f=withSkills(fixture());f.plan.staff[0].profile.sourceSkillOriginalChecks=ids;reject(f,'reconcileSkills');}});
check('空の分類を不正入力として安全に拒否',()=>{const f=fixture();f.plan.skillCatalog=null;reject(f,'staffSkillInvalid');});
check('分類だけ変更されても古い事前確認で上書きしない',()=>{const f=withSkills(fixture());apply(f);const dry=reconcile(f.state,{...f.plan,dryRun:true},ctx);f.state.staffSkillCatalog.groups[0].name='テスト別分類';reject(f,'scheduleConflict',{...f.plan,expectedVersion:dry.expectedVersion});});
check('分類反映後の同じ再送は無変更で返す',()=>{const f=withSkills(fixture());apply(f);const before=encode(f.state);assert.equal(reconcile(f.state,{...f.plan},ctx).already,true);assert.equal(encode(f.state),before);});
check('保存済み分類とチェックを省略時にも照合して維持',()=>{const f=withSkills(fixture());apply(f);delete f.plan.skillCatalog;delete f.plan.staff[0].profile.sourceSkillChecks;delete f.plan.staff[0].profile.sourceSkillOriginalChecks;apply(f);const p=JSON.parse(f.state.staff[0].profile);assert.deepEqual(p.sourceSkillChecks,['201','202','204']);assert.deepEqual(p.sourceSkillOriginalChecks,['201','202','203','204']);});
check('停止対象も編集版を進め古い画面の再開を防ぐ',()=>{
  const f=fixture(),retired={...f.state.staff[0],id:id(2),name:'テスト停止対象',profile:'{}',profile_revision:3,listing_order:9};
  f.state.staff.push(retired);f.state.staffIdHigh=10000002;f.plan.retireIds=[retired.id];
  const before=encode(f.state);reconcile(f.state,{...f.plan,dryRun:true},ctx);assert.equal(encode(f.state),before);
  apply(f);const st=f.state.staff.find(s=>s.id===retired.id);assert.equal(st.active,0);assert.equal(st.profile_revision,4);assert.equal(st.listing_order,9);
  const after=encode(f.state);assert.equal(reconcile(f.state,f.plan,ctx).already,true);assert.equal(encode(f.state),after);
});
console.log(JSON.stringify({ok:true,checks:checks.length,externalNetwork:false,productionWrites:false}));
