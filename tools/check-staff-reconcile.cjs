'use strict';
// 送信無効の本番コピーと、照合済みの計画だけを使用。実データはリポジトリに含めない。
// node tools/check-staff-reconcile.cjs <検証用フォルダ> <計画.json>
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
process.env.DEMO_EPHEMERAL='1';process.env.HP_MAIL='0';process.env.CLOUD='0';
for(const key of Object.keys(process.env))if(/^(GH_|GITHUB_|MAIL_)/.test(key))delete process.env[key];
assert(process.argv[2]&&process.argv[3],'検証用フォルダと計画JSONを指定してください');
const root=path.resolve(process.argv[2]),plan=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
assert(!fs.existsSync(path.join(root,'mail-config.json')));
const api=require(path.join(root,'copy-api.cjs'));
const encode=v=>JSON.stringify(v,(_,x)=>x instanceof Map?{__pm_map__:[...x]}:x instanceof Set?{__pm_set__:[...x]}:x);
(async()=>{await api.ready;const {state,postSchedule,getSchedule,publicStaffList,minToMs}=api.audit;
 assert(!state.mailRelay.url&&!state.mailRelay.secret);assert.equal(state.mails.length,0);
 const actor={user:'test-admin',role:'admin'},before=encode(state);
 const dry=postSchedule({...plan,dryRun:true},actor);assert.equal(encode(state),before,'事前確認だけでデータが変化');
 const rejects=(b,message,who=actor)=>{const s=encode(state);assert.throws(()=>postSchedule(b,who),e=>e.message===message);assert.equal(encode(state),s,'失敗時の部分反映');};
 rejects({...plan,dryRun:true},'forbidden',{role:'staff'});
 rejects({...plan,dryRun:true},'forbidden',{role:'manager'});
 rejects({...plan,expectedVersion:'old'},'scheduleConflict');
 rejects({...plan,dryRun:true,from:'2026-99-01'},'reconcileRange');
 rejects({...plan,dryRun:true,staff:[...plan.staff,plan.staff[0]]},'reconcileStaff');
 rejects({...plan,dryRun:true,shifts:[...plan.shifts,plan.shifts[0]]},'reconcileDuplicate');
 rejects({...plan,dryRun:true,shifts:[{...plan.shifts[0],staffId:'missing'}]},'reconcileTime');
 const female=plan.staff.find(s=>s.gender==='female');
 const wrong=[...api.audit.courseStore.values()].find(c=>api.audit.courseGender(c.id)==='male').id;
 rejects({...plan,dryRun:true,staff:plan.staff.map(s=>s===female?{...s,courses:[wrong]}:s)},'staffCourseGender');
 const d=plan.from,existing=state.events.get(d),s=plan.shifts[0];
 state.events.set(d,{bookings:[{id:'test-booking',name:'テスト 確認',status:'confirmed',course:plan.staff.find(x=>x.id===s.staffId).courses[0],start_at:minToMs(d,0),end_at:minToMs(d,60)}],assignments:[{booking_id:'test-booking',staff_id:s.staffId}],blocks:[]});
 rejects({...plan,dryRun:true},'reconcileBookingConflict');
 if(existing)state.events.set(d,existing);else state.events.delete(d);
 assert.equal(encode(state),before);
 const protectedBefore=encode({members:state.members,tickets:state.tickets,mails:state.mails,
   oldShifts:[...state.shifts].filter(([d])=>d<plan.from),oldDays:[...state.days].filter(([d])=>d<plan.from),
   bookings:[...state.events].map(([d,e])=>[d,e.bookings,e.assignments])});
 const result=postSchedule({...plan,expectedVersion:dry.expectedVersion},actor);
 assert.equal(result.shifts,plan.shifts.length);assert.equal(new Set(state.staff.map(s=>s.id)).size,state.staff.length);
 assert.deepEqual(state.staff.filter(s=>!plan.retireIds.includes(s.id)).map(s=>s.id),plan.staff.map(s=>s.id),'同じ表示順序のスタッフの並び');
 const refs=state.staff.map(s=>JSON.parse(s.profile).peakManagerId).filter(Boolean);assert.equal(new Set(refs).size,plan.staff.length);
 for(const row of plan.staff){const st=state.staff.find(s=>s.id===row.id);assert.equal(st.name,row.name.trim());assert.equal(st.gender,row.gender);assert.deepEqual(JSON.parse(st.courses),row.courses);assert.equal(JSON.parse(st.profile).peakManagerId,row.sourceId);}
 for(const row of plan.shifts){const found=state.shifts.get(row.date).filter(s=>s.staff_id===row.staffId);assert.equal(found.length,1);assert.equal(found[0].start_at,minToMs(row.date,row.start));assert.equal(found[0].end_at,minToMs(row.date,row.end));}
 const count=[...state.shifts].filter(([d])=>d>=plan.from&&d<=plan.to).reduce((n,[,r])=>n+r.length,0);assert.equal(count,plan.shifts.length);
 assert.equal(protectedBefore,encode({members:state.members,tickets:state.tickets,mails:state.mails,
   oldShifts:[...state.shifts].filter(([d])=>d<plan.from),oldDays:[...state.days].filter(([d])=>d<plan.from),
   bookings:[...state.events].map(([d,e])=>[d,e.bookings,e.assignments])}),'予約・回数券・履歴の変化');
 const after=encode(state);assert.equal(postSchedule({...plan,expectedVersion:dry.expectedVersion},actor).already,true);assert.equal(encode(state),after,'同じ操作で重複');
 const sc=getSchedule(plan.from);for(const row of plan.staff){assert.equal(sc.staff.find(s=>s.id===row.id).name,row.profile.nickname||row.name);assert.equal(sc.allStaff.find(s=>s.id===row.id).name,row.name);}
 const far='2028-01-01';getSchedule(far);assert.equal((state.shifts.get(far)||[]).length,0,'未登録日のシフトが自動で増える');
 assert.equal(state.mails.length,0);
 const raw=JSON.parse(fs.readFileSync(path.join(root,'safe-state.json'),'utf8'));
 // 閲覧検査によって生成される将来日の空行を、反映済みデータへ混ぜない。
 raw.state=JSON.parse(after);fs.writeFileSync(path.join(root,'reconciled-safe-state.json'),JSON.stringify(raw),{mode:0o600});
 console.log(JSON.stringify({ok:true,checks:'権限・競合・重複・不正日付・男女制限・履歴保持・再実行・登録名と表示名・自動生成停止',...result,publicStaff:publicStaffList().length}));process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
