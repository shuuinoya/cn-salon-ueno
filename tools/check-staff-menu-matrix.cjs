'use strict';
// 原本はUIから読んだチェックだけ。本番コピーをメモリに読み、保存・通信なしで検査する。
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const [rootArg,copyFile,peakFile,outFile]=process.argv.slice(2);assert(rootArg&&copyFile&&peakFile);
const root=path.resolve(rootArg);assert(!fs.existsSync(path.join(root,'mail-config.json')));
process.env.DEMO_EPHEMERAL='1';process.env.HP_MAIL='0';process.env.CLOUD='0';
for(const k of Object.keys(process.env))if(/^(MAIL_|GH_|ADMIN_PASS)/.test(k))delete process.env[k];
global.fetch=async()=>{throw Error('external network disabled')};
const revive=(_,v)=>v?.__pm_map__?new Map(v.__pm_map__):v?.__pm_set__?new Set(v.__pm_set__):v;
const encode=x=>JSON.stringify(x,(_,v)=>v instanceof Map?{__pm_map__:[...v]}:v instanceof Set?{__pm_set__:[...v]}:v);
const clone=x=>JSON.parse(encode(x),revive),snapshot=JSON.parse(fs.readFileSync(copyFile),revive),peak=JSON.parse(fs.readFileSync(peakFile));
assert.deepEqual(snapshot.state.mailRelay,{});assert.equal(snapshot.state.mails.length,0);assert.equal(peak.readOnly,true);
const persist=require(path.join(root,'persist'));persist.loadSnapshotWithRemote=async()=>({enabled:false,data:snapshot});persist.startSaver=()=>{};persist.requestSave=()=>{};
const file=path.join(root,'demo-api.js'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.audit={state,courseStore,postSchedule,createPublicBooking,getAvailability,freeStaffIds,staffCanDo,bookingMismatch,profileOf,todayJst,addDays,minToMs,findBooking};',file);
(async()=>{
 await mod.exports.ready;const a=mod.exports.audit,state=a.state,manager={user:'test-matrix',role:'admin',active:true},date=a.addDays(a.todayJst(),1);
 const results=[],run=(name,fn)=>{try{fn();results.push({name,ok:true})}catch(e){results.push({name,ok:false,error:e.message.split('\n').slice(0,2).join(' ')})}};
 const skills=require(path.join(root,'staff-skills')),catalog=state.staffSkillCatalog,items=skills.itemsOf(catalog),courses=[...a.courseStore.values()],bySource=new Map(state.staff.map(s=>[a.profileOf(s).peakManagerId,s]));
 const protectedData=()=>encode({photos:state.photos,shifts:state.shifts,days:state.days,events:state.events,tickets:state.tickets,members:state.members,mails:state.mails,courses:state.courses});
 const before=protectedData(),changes=[],exclusions=[];
 assert.equal(new Set(peak.staff.map(s=>s.id)).size,peak.staff.length);assert.equal(peak.staff.length,state.staff.filter(s=>a.profileOf(s).peakManagerId).length);
 for(const row of peak.staff){
  const st=bySource.get(row.id);assert(st,'登録スタッフの対応がありません');const profile=a.profileOf(st);
  run('原本の項目・原本チェック '+row.id,()=>{
   assert.equal(row.items.length,items.length);assert.equal(new Set(row.items.map(i=>i.id)).size,row.items.length);
   for(const it of row.items){const original=items.find(x=>x.sourceId===it.id),group=catalog.groups.find(g=>g.items.some(x=>x.sourceId===it.id));assert(original);assert.equal(original.name,it.name);assert.equal(group.name,it.group);}
   assert(skills.sameSet(row.items.filter(i=>i.checked).map(i=>i.id),profile.sourceSkillOriginalChecks));
  });
  const raw=row.items.filter(i=>i.checked).map(i=>i.id),checks=items.filter(i=>raw.includes(i.sourceId)&&(i.gender==='none'||i.gender===st.gender)).map(i=>i.sourceId);
  const mapped=items.filter(i=>i.courseId&&checks.includes(i.sourceId)).map(i=>i.courseId);assert(mapped.length);
  exclusions.push(...items.filter(i=>raw.includes(i.sourceId)&&!checks.includes(i.sourceId)).map(i=>({staffId:st.id,sourceId:i.sourceId})));
  if(!skills.sameSet(checks,profile.sourceSkillChecks)){
   const body={action:'staff',date:a.todayJst(),id:st.id,name:st.name,gender:st.gender,active:st.active,sortOrder:st.sort_order,staffRevision:st.profile_revision,
    staffSkillCatalogVersion:catalog.version,sourceSkillChecks:checks,courses:mapped,allCourses:false,profile:{skillOverride:'2026-10-23 PeakManagerのチェックに統一（男女の担当制限を維持）'},requestKey:'peak-skills-20261023-'+row.id};
   const result=a.postSchedule(body,manager);assert(result.ok);changes.push({sourceId:row.id,name:st.name,body,warning:result.warning||''});
  }
 }
 assert.equal(protectedData(),before,'スキルの保存で予約・シフト等が変化');
 const registered=clone(state.staff.filter(s=>a.profileOf(s).peakManagerId));
 for(const st of registered)for(const course of courses)run('登録チェックと担当可否 '+st.id.slice(0,8)+' / '+course.id,()=>{
  const item=items.find(i=>i.courseId===course.id),checked=a.profileOf(st).sourceSkillChecks.includes(item.sourceId);
  assert.equal(a.staffCanDo(st,course.id),checked);assert.equal(a.bookingMismatch(st,{course:course.id})===null,checked);
 });
 // 実際の将来シフトで、勤務・チェック・休憩・業務・既存予約・鍵を別計算して照合。
 const originalState=clone(state),futureDates=[...state.shifts.keys()].filter(d=>d>=a.todayJst()&&d<=a.addDays(a.todayJst(),7)).sort();
 const intervals=[];for(const [,ev]of state.events){for(const b of ev.blocks||[])intervals.push({...b});for(const b of ev.bookings||[])if(b.status==='confirmed')for(const ass of ev.assignments||[])if(ass.booking_id===b.id)intervals.push({...b,staff_id:ass.staff_id});}
 for(const day of futureDates)for(const course of courses)for(const minute of [600,780,1020,1320,1500])run('実勤務の空き '+day+' / '+course.id+' / '+minute,()=>{
  const from=a.minToMs(day,minute),to=a.minToMs(day,minute+course.minutes),gender=/女性/.test(course.name)?'female':/男性/.test(course.name)?'male':'none';
  const expected=registered.filter(s=>s.active===1&&JSON.parse(s.courses).includes(course.id)&&(gender==='none'||s.gender===gender)&&!(state.days.get(day)?.locked||[]).includes(s.id)&&
   (state.shifts.get(day)||[]).some(sh=>sh.staff_id===s.id&&sh.start_at<=from&&to<=sh.end_at)&&!intervals.some(b=>b.staff_id===s.id&&b.start_at<to&&from<b.end_at)).map(s=>s.id).sort();
  assert.deepEqual(a.freeStaffIds(day,minute,minute+course.minutes,course.id,gender).sort(),expected);
 });
 const ops=require(path.join(root,'ledger-operations')),policy=require(path.join(root,'booth-policy'));let seq=0;
 function reset(course){
  const eligible=registered.filter(s=>JSON.parse(s.courses).includes(course.id));assert(eligible.length,'対応スタッフ不足');
  const first=eligible[0],second=eligible[1]||first;
  state.staff=[{...clone(first),id:'test-A'},{...clone(second),id:'test-B'},{...clone(first),id:'test-C',courses:JSON.stringify([courses.find(c=>c.id!==course.id).id])}].map((s,i)=>({...s,name:'テスト担当'+i,profile:JSON.stringify({...a.profileOf(s),personalNomination:true,nominationFee:500})}));
  state.photos=new Map(state.staff.map(s=>[s.id,'data:image/jpeg;base64,/9j/']));state.events=new Map();state.shifts=new Map();state.days=new Map();state.bookingIndex=new Map();state.requestKeys=new Map();state.mails=[];state.mailRelay={};state.members=new Map();state.tickets=new Map();state.ticketUseByBooking=new Map();state.ledger=ops.createState();
  state.booths=policy.sourceDefaults().booths;state.settings.freeMessage={visible:true,required:false,maxLength:2000};state.settings.shopMaster.resStart=600;state.settings.shopMaster.resEnd=1560;
  for(let i=-1;i<8;i++){const day=a.addDays(date,i);state.days.set(day,{version:0,enabled:true});state.events.set(day,{bookings:[],blocks:[],assignments:[]});state.shifts.set(day,state.staff.map(s=>({staff_id:s.id,date:day,start_at:a.minToMs(day,600),end_at:a.minToMs(day,1620)})));}
 }
 const stateRecords=()=>encode({events:state.events,days:state.days,bookingIndex:state.bookingIndex,mails:state.mails,tickets:state.tickets,requestKeys:state.requestKeys});
 const reject=(fn,code)=>{const old=stateRecords();assert.throws(fn,e=>e.message===code);assert.equal(stateRecords(),old,'拒否した予約・移動が保存された');};
 function publicBook(course,extra={}){return a.createPublicBooking({requestKey:'test-matrix-'+ ++seq,date,start:a.minToMs(date,720),course:course.id,people:1,staff:'none',staffId:'test-A',expectedNominationFee:500,name:'テスト予約',email:'matrix@example.test',phone:'0000000000',consent:true,...extra});}
 const revise=(body)=>a.postSchedule({date,revision:state.days.get(date).version,...body},manager);
 function adminBook(course,id='test-A',start=720){revise({action:'createBooking',staffId:id,start,course:course.id,people:1,consent:true,name:'テスト予約'});return state.events.get(date).bookings.at(-1);}
 const move=(b,extra={})=>revise({action:'moveBooking',id:b.id,staffId:'test-B',start:1020,end:1020+(b.end_at-b.start_at)/60000,...extra});
 const block=(kind,start=1020,end=1080,day=date)=>state.events.get(day).blocks.push({id:'test-block',staff_id:'test-B',start_at:a.minToMs(day,start),end_at:a.minToMs(day,end),kind});
 const cases={
  '対応外は7日すべて×':course=>{const x=a.getAvailability(new URLSearchParams({date,course:course.id,people:'1',staff:'none',staffId:'test-C'}));assert(x.days.some(d=>d.slots.length));assert(x.days.every(d=>d.slots.every(s=>!s.available)));},
  '対応外の指名予約を拒否':course=>reject(()=>publicBook(course,{staffId:'test-C'}),'staffUnavailable'),
  '対応者の指名予約が成立':course=>{const r=publicBook(course);assert(r.id);assert(state.events.get(date).assignments.some(x=>x.booking_id===r.id&&x.staff_id==='test-A'));},
  '指名なしは対応者だけへ割当':course=>{const r=publicBook(course,{staffId:''});assert(state.events.get(date).assignments.filter(x=>x.booking_id===r.id).every(x=>x.staff_id!=='test-C'));},
  '二重予約を拒否':course=>{publicBook(course);reject(()=>publicBook(course),'soldOut');},
  '同じ内容の再送は重複なし':course=>{const requestKey='test-repeat';const r=publicBook(course,{requestKey});assert.deepEqual(publicBook(course,{requestKey}),r);assert.equal(state.events.get(date).bookings.length,1);},
  '他の対応者の空き時間へ移動':course=>{const b=adminBook(course);assert(move(b).ok);assert(state.events.get(date).assignments.some(x=>x.booking_id===b.id&&x.staff_id==='test-B'));},
  '対応外への管理画面移動を拒否':course=>{const b=adminBook(course);reject(()=>move(b,{staffId:'test-C'}),'staffCannotDoCourse');},
  '勤務なしへの移動を拒否':course=>{const b=adminBook(course);state.shifts.set(date,state.shifts.get(date).filter(s=>s.staff_id!=='test-B'));reject(()=>move(b),'outsideShift');},
  '勤務開始前を拒否':course=>{const b=adminBook(course);state.shifts.get(date).find(s=>s.staff_id==='test-B').start_at=a.minToMs(date,1080);reject(()=>move(b),'outsideShift');},
  '施術終了が退勤後なら拒否':course=>{const b=adminBook(course);state.shifts.get(date).find(s=>s.staff_id==='test-B').end_at=a.minToMs(date,1020+course.minutes-1);reject(()=>move(b),'outsideShift');},
  '退勤時刻ちょうどの終了は可':course=>{const b=adminBook(course);state.shifts.get(date).find(s=>s.staff_id==='test-B').end_at=a.minToMs(date,1020+course.minutes);assert(move(b).ok);},
  '休憩との重なりを拒否':course=>{const b=adminBook(course);block('break');reject(()=>move(b),'soldOut');},
  '業務との重なりを拒否':course=>{const b=adminBook(course);block('work');reject(()=>move(b),'soldOut');},
  '既存予約との重なりを拒否':course=>{const b=adminBook(course);adminBook(course,'test-B',1020);reject(()=>move(b),'soldOut');},
  '休憩終了ちょうどから移動可':course=>{const b=adminBook(course);block('break',960,1020);assert(move(b).ok);},
  '当日ブロックした別スタッフへ移動不可':course=>{const b=adminBook(course);state.days.get(date).locked=['test-B'];reject(()=>move(b),'staffLocked');},
  '指名予約の確認を省略できない':course=>{const r=publicBook(course),b=a.findBooking(r.id).bk;reject(()=>move(b),'nominatedConfirmationRequired');},
  '指名予約は確認して移動可':course=>{const r=publicBook(course),b=a.findBooking(r.id).bk;assert(move(b,{confirmNominationMove:true}).ok);assert.equal(b.nominated_staff_id,'test-B');},
  '別日もスキルと空きを確認':course=>{const b=adminBook(course),toDate=a.addDays(date,1);assert(move(b,{toDate,toRevision:0}).ok);assert(!state.events.get(date).bookings.some(x=>x.id===b.id));assert(state.events.get(toDate).bookings.some(x=>x.id===b.id));}
 };
 for(const course of courses)for(const [name,fn]of Object.entries(cases)){reset(course);run(name+' / '+course.id,()=>{fn(course);assert(state.mails.every(m=>!m.real));});}
 const report={sourceStaff:peak.staff.length,sourceItems:items.length,sourceCheckboxes:peak.staff.reduce((n,s)=>n+s.items.length,0),saleCourses:courses.length,genderExcluded:exclusions.length,updatedStaff:changes.map(x=>({sourceId:x.sourceId,name:x.name,warning:!!x.warning})),registeredPairs:registered.length*courses.length,realShiftCases:futureDates.length*courses.length*5,reservationCases:courses.length*Object.keys(cases).length,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok)};
 if(outFile)fs.writeFileSync(outFile,JSON.stringify({report,changes,results},null,2));console.log(JSON.stringify(report,null,2));if(report.failed.length)process.exitCode=1;
})().catch(e=>{console.error(e.stack);process.exitCode=1});
