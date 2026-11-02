'use strict';
// 送信・保存を無効にした本番コピーで、本人照合済みの紹介文変更を検査する。
// 原本・写真・変更計画は保管場所に含めず、引数で私有の一時ファイルを渡す。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module'),vm=require('node:vm');
assert(process.argv[2]&&process.argv[3],'検証コピーと照合計画を指定してください');
const root=path.resolve(process.argv[2]),plan=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
assert(!fs.existsSync(path.join(root,'mail-config.json')));
process.env.DEMO_EPHEMERAL='1';process.env.CLOUD='0';process.env.HP_MAIL='0';
for(const k of Object.keys(process.env))if(/^(MAIL_|GH_|ADMIN_PASS)/.test(k))delete process.env[k];
global.fetch=async()=>{throw Error('External network disabled');};
const encode=x=>JSON.stringify(x,(_,v)=>v instanceof Map?{__pm_map__:[...v]}:v instanceof Set?{__pm_set__:[...v]}:v);
const bytes=fs.readFileSync(path.join(root,'safe-state.json'));
const snapshot=JSON.parse(bytes,(_,v)=>v?.__pm_map__?new Map(v.__pm_map__):v?.__pm_set__?new Set(v.__pm_set__):v);
assert(!snapshot.state.mailRelay?.url&&!snapshot.state.mailRelay?.secret&&snapshot.state.mails.length===0);
const persist=require(path.join(root,'persist.js'));persist.loadSnapshotWithRemote=async()=>({enabled:false,data:snapshot});persist.startSaver=()=>{};persist.requestSave=()=>{};
const file=path.join(root,'demo-api.js'),m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(root);
m._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.audit={state,postSchedule,publicStaffList,nominationOf,nominatableStaff,staffPickerDirectory,minToMs};',file);
let passed=0;const eq=(a,b)=>{assert.deepEqual(a,b);passed++;};
(async()=>{
 await m.exports.ready;const a=m.exports.audit,s=a.state,actor={user:'test-message-audit',role:'admin',active:true};
 const before=JSON.parse(encode(s));eq(s.staff,plan.staffBefore);
 for(const row of plan.updates){
   const st=s.staff.find(x=>x.id===row.body.id);eq(st,row.before);
   eq(a.postSchedule(row.body,actor).ok,true);
   const now=s.staff.find(x=>x.id===st.id),p=JSON.parse(st.profile);
   eq(now,{...st,profile:JSON.stringify({...p,message:row.body.profile.message}),profile_revision:(st.profile_revision||0)+1});
   const retryBefore=encode(s);eq(a.postSchedule(row.body,actor).ok,true);eq(encode(s),retryBefore);
 }
 const created=[];
 for(const row of plan.additions){
   assert(!s.staff.some(x=>JSON.parse(x.profile).peakManagerId===row.sourceId));passed++;
   eq(a.postSchedule(row.body,actor).ok,true);
   const added=s.staff.filter(x=>JSON.parse(x.profile).peakManagerId===row.sourceId);eq(added.length,1);created.push(added[0]);
   eq(s.photos.get(added[0].id),row.body.photo);eq(JSON.parse(added[0].profile).message,row.body.profile.message);
   eq(JSON.parse(added[0].profile).sourceSkillChecks,row.body.sourceSkillChecks);eq(JSON.parse(added[0].courses),row.body.courses);
   const retryBefore=encode(s);eq(a.postSchedule(row.body,actor).ok,true);eq(encode(s),retryBefore);
 }
 const after=JSON.parse(encode(s));
 for(const k of Object.keys(before))if(!['staff','photos','staffIdHigh','staffSkillKeys'].includes(k))eq(after[k],before[k]);
 const changedIds=new Set(plan.updates.map(r=>r.body.id));
 for(const old of before.staff)if(!changedIds.has(old.id))eq(after.staff.find(x=>x.id===old.id),old);
 for(const [id,photo]of before.photos.__pm_map__)eq(s.photos.get(id),photo);
 const sourceById=new Map(plan.source.map(r=>[r.id,r]));
 for(const row of plan.matched)eq(JSON.parse(s.staff.find(st=>st.id===row.localId).profile).message||'',sourceById.get(row.sourceId).message);
 // 新規登録だけでシフトや予約を作らず、当日掲載対象を増やさない。
 for(const added of created)eq(a.publicStaffList('2026-11-02').some(st=>st.id===added.id),false);
 // コピーだけに勤務を合成し、全員の紹介・指名・メニュー選択が同じ本文を返すことを確認。
 const date='2026-11-10';s.shifts.set(date,s.staff.map(st=>({staff_id:st.id,date,start_at:a.minToMs(date,600),end_at:a.minToMs(date,1200)})));
 const listed=a.publicStaffList(date);
 for(const st of s.staff){
   const p=JSON.parse(st.profile),pub=listed.find(x=>x.id===st.id);assert(pub);passed++;eq(pub.message,p.message||'');
   const nom=a.nominationOf(st.id,date);if(pub.nominatable){assert(nom);passed++;eq(nom.message,p.message||'');}else eq(nom,null);
   for(const course of JSON.parse(st.courses).slice(0,2)){
     const pick=a.staffPickerDirectory(course,'none',date).find(x=>x.id===st.id);eq(pick.message,p.message||'');
     const candidate=a.nominatableStaff(course,'none',date).find(x=>x.id===st.id);if(candidate)eq(candidate.message,p.message||'');
   }
 }
 // 指名カードは全文を安全に表示し、空欄なら余分な紹介欄を作らない。
 const tweaks=fs.readFileSync(path.join(__dirname,'../public/booking-tweaks.js'),'utf8');
 const fn=tweaks.slice(tweaks.indexOf('  function decorateNomination()'),tweaks.indexOf('  // 画面の部品の準備ができたら'));
 for(const message of ['テスト紹介\n\n<丸括弧ではないタグ> & "引用"\n末尾','']){
   let bar;const stack={querySelectorAll:()=>[],before:x=>{bar=x;}};
   const ctx={NOM_ID:'test',nomStaff:{name:'テスト担当',nominationFee:500,courses:['a'],message},location:{pathname:'/book'},
     document:{querySelector:()=>stack,getElementById:()=>null,createElement:()=>({})},window:{},I18N:null,T:x=>x,
     esc2:x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')};
   vm.runInNewContext(fn+'\ndecorateNomination();',ctx);
   eq(bar.innerHTML.includes('fm-nom-message'),!!message);
   if(message){assert(bar.innerHTML.includes(ctx.esc2(message)));assert(!bar.innerHTML.includes('<丸括弧ではないタグ>'));assert(bar.innerHTML.includes('white-space:pre-wrap'));passed+=3;}
 }
 eq(fs.readFileSync(path.join(root,'safe-state.json')),bytes);
 console.log(JSON.stringify({passed,updated:plan.updates.length,added:created.length,protectedRecordsUnchanged:true,externalMailSent:false}));
 process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1);});
