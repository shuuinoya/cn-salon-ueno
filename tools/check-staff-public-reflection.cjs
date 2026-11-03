'use strict';
// 送信無効の本番コピーだけで、保存した掲載順と全スタッフの紹介文を反復照合する。
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto');
assert(process.argv[2], '送信無効の検証コピーを指定してください');
const root=fs.realpathSync(process.argv[2]);
assert.notEqual(root,fs.realpathSync(path.join(__dirname,'..')));
assert(!fs.existsSync(path.join(root,'mail-config.json')));
Object.assign(process.env,{DEMO_EPHEMERAL:'1',HP_MAIL:'0',CLOUD:'0'});
for(const k of Object.keys(process.env))if(/^(MAIL_|GH_|ADMIN_PASS)/.test(k))delete process.env[k];
global.fetch=async()=>{throw Error('External network disabled');};
const encode=x=>JSON.stringify(x,(_,v)=>v instanceof Map?{__pm_map__:[...v]}:v instanceof Set?{__pm_set__:[...v]}:v);
const bytes=fs.readFileSync(path.join(root,'safe-state.json'));
const snapshot=JSON.parse(bytes,(_,v)=>v?.__pm_map__?new Map(v.__pm_map__):v?.__pm_set__?new Set(v.__pm_set__):v);
assert(!snapshot.state.mailRelay?.url&&!snapshot.state.mailRelay?.secret&&snapshot.state.mails.length===0);
const persist=require(path.join(root,'persist.js'));
persist.loadSnapshotWithRemote=async()=>({enabled:false,data:snapshot});persist.startSaver=()=>{};persist.requestSave=()=>{};
const file=path.join(root,'demo-api.js'),m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(root);
m._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.audit={state,courseStore,getStaffOrdering,publicStaffList,nominationOf,nominatableStaff,staffPickerDirectory,todayJst,addDays,minToMs};',file);
const ordering=require(path.join(root,'staff-ordering.js'));
(async()=>{
 await m.exports.ready;
 const a=m.exports.audit,s=a.state,today=a.todayJst(),actor={user:'test-reflection',role:'admin',active:true};
 let checks=0,seed=20261103;
 const eq=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
 const ids=rows=>rows.map(x=>x.id), profile=st=>JSON.parse(st.profile||'{}');
 const byId=new Map(s.staff.map(st=>[st.id,st]));
 const protectedData=()=>encode({staff:s.staff,photos:s.photos,shifts:s.shifts,events:s.events,days:s.days,tickets:s.tickets,members:s.members,settings:s.settings,mails:s.mails});
 const dates=[...s.shifts.keys()].filter(d=>d>=today).sort().slice(0,28);if(!dates.length)dates.push(today);
 const courses=[...a.courseStore.keys()];assert(courses.length);
 function verify(rows){
  eq(new Set(ids(rows)).size,rows.length);
  for(let i=0;i<rows.length;i++){
   const row=rows[i],st=byId.get(row.id),p=profile(st);
   eq(row.message,p.message||'');eq(row.name,p.nickname||st.name);
   if(i)eq(row.listingOrder>rows[i-1].listingOrder,true);
  }
 }
 const before=protectedData();
 for(let round=0;round<100;round++){
  const date=dates[round%dates.length],other=a.addDays(date,1),otherOrder=ids(ordering.view(s,other).staff),permutation=[...s.staff];
  for(let i=permutation.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[permutation[i],permutation[j]]=[permutation[j],permutation[i]];}
  const body={date,version:ordering.version(s,date),orders:permutation.map((st,i)=>({id:st.id,listingOrder:i+1})),requestKey:crypto.randomUUID()};
  const saved=ordering.save(s,body,actor,(status,code)=>Object.assign(Error(code),{status}),today);
  eq(ordering.save(s,body,actor,()=>Error('unexpected'),today),saved);
  eq(ids(a.getStaffOrdering(date,actor).staff),ids(permutation));
  const working=ordering.workingIds(s.shifts,date),expected=permutation.filter(st=>working.has(st.id));
  const publicRows=a.publicStaffList(date);eq(ids(publicRows),ids(expected));verify(publicRows);
  const course=courses[round%courses.length],directory=a.staffPickerDirectory(course,'none',date);
  eq(ids(directory),ids(expected));verify(directory);verify(a.nominatableStaff(course,'none',date));
  for(const row of publicRows)eq(a.nominationOf(row.id,date)?.message??null,row.nominatable?profile(byId.get(row.id)).message||'':null);
  eq(ids(ordering.view(s,other).staff),otherOrder);eq(protectedData(),before);
 }
 // 出勤予定のないスタッフも、コピー内だけに勤務を作って全員・全メニューを検査。
 const date=a.addDays(today,40);
 s.shifts.set(date,s.staff.map(st=>({staff_id:st.id,date,start_at:a.minToMs(date,600),end_at:a.minToMs(date,1200)})));
 eq(a.publicStaffList(date).length,s.staff.length);verify(a.publicStaffList(date));
 for(const course of courses){verify(a.staffPickerDirectory(course,'none',date));verify(a.nominatableStaff(course,'none',date));}
 // 同じスタッフの紹介文を更新しても、並びや他の人の文章を取り違えない。
 const originalProfiles=s.staff.map(st=>st.profile),orderBefore=ids(a.publicStaffList(date));
 for(const st of s.staff){st.profile=JSON.stringify({...profile(st),message:'テスト紹介 '+st.id+'\n改行 <>& "引用"'});}
 for(const st of s.staff){const row=a.publicStaffList(date).find(x=>x.id===st.id);eq(row.message,profile(st).message);eq(a.nominationOf(st.id,date)?.message??null,row.nominatable?profile(st).message:null);}
 eq(ids(a.publicStaffList(date)),orderBefore);
 s.staff.forEach((st,i)=>{st.profile=originalProfiles[i];});
 eq(s.mails.length,0);eq(fs.readFileSync(path.join(root,'safe-state.json')),bytes);
 console.log(JSON.stringify({rounds:100,dates:dates.length,staff:s.staff.length,courses:courses.length,checks,mismatches:0,sourceUnchanged:true,externalMail:false}));
 process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
