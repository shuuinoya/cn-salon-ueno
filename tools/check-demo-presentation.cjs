'use strict';
// 送信無効の本番コピーだけで表示・編集の往復を検査する。
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
assert(process.argv[2]);const root=fs.realpathSync(process.argv[2]);
assert.notEqual(root,fs.realpathSync(path.join(__dirname,'..')));assert(!fs.existsSync(path.join(root,'mail-config.json')));
process.env.DEMO_EPHEMERAL='1';process.env.CLOUD='0';process.env.HP_MAIL='0';process.env.DEMO_PRESENTATION='0';
process.env.DEMO_PRESENTATION_HIDE_PHOTOS='10000018-0000-4000-8000-000010000018';
for(const k of Object.keys(process.env))if(/^(MAIL_|GH_|ADMIN_|BOOKING_MAIL|STORE_MAIL)/.test(k))delete process.env[k];
global.fetch=async()=>{throw Error('external network forbidden');};
const revive=(_,v)=>v?.__pm_map__?new Map(v.__pm_map__):v?.__pm_set__?new Set(v.__pm_set__):v;
const encode=v=>JSON.stringify(v,(_,x)=>x instanceof Map?{__pm_map__:[...x]}:x instanceof Set?{__pm_set__:[...x]}:x);
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'safe-state.json')),revive);
assert(!snapshot.state.mailRelay?.url&&!snapshot.state.mailRelay?.secret&&!snapshot.state.mails.length);
const persist=require(path.join(root,'persist.js'));persist.loadSnapshotWithRemote=async()=>({enabled:false,data:snapshot});persist.startSaver=()=>{};persist.requestSave=()=>{};
const file=path.join(root,'demo-api.js'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.audit={state,courseStore,postSchedule,getSchedule,getAvailability,publicStaffList,staffMismatch,courseGender,adminSessions};',file);
(async()=>{
  await mod.exports.ready;const a=mod.exports.audit,p=mod.exports.demoPresentation,dates=['2026-11-19','2026-11-29','2026-12-01'];
  const schedules=dates.map(d=>a.getSchedule(d)),publics=dates.map(d=>a.publicStaffList(d));
  const before=encode(a.state),logic=[];let checks=0;
  for(const s of a.state.staff)for(const id of a.courseStore.keys())logic.push(a.staffMismatch(s,id));
  const baseAvailability=[];
  for(const date of dates)for(const course of a.courseStore.keys())for(const people of ['1','3']) {
    const q=new URLSearchParams({date,course,people,staff:'none'});baseAvailability.push([q,encode(a.getAvailability(q))]);
  }
  const initialized=encode(a.state);process.env.DEMO_PRESENTATION='1';
  assert(p.enabled());const c=p.context();
  assert.equal(new Set([...c.staff.values()].map(s=>s.name)).size,a.state.staff.length);
  assert.equal(new Set([...c.course.values()].map(s=>s.names.ja)).size,c.course.size);
  for(const s of a.state.staff){
    const result=p.project(s),entry=c.staff.get(s.id),profile=JSON.parse(result.profile);
    assert.equal(result.name,entry.name);assert.equal(profile.nickname,entry.name);
    assert(!profile.furigana.includes(JSON.parse(s.profile).familyKana)||!JSON.parse(s.profile).familyKana);
    const body={id:s.id,name:result.name,profile,gender:s.gender};
    const restored=p.restoreStaff(body);assert.equal(restored.name,s.name);assert.deepEqual(restored.profile,JSON.parse(s.profile));checks++;
  }
  schedules.forEach((sc,i)=>{
    const projected=p.project(sc);for(const st of [...projected.staff,...projected.allStaff]){
      assert.equal(st.name,c.staff.get(st.id).name);assert.equal(st.booking_status.display_name,st.name);checks++;
    }
    assert.deepEqual(projected.shifts,sc.shifts);assert.deepEqual(projected.assignments,sc.assignments);
    assert.deepEqual(projected.editTokens,sc.editTokens);assert.equal(projected.syncVersion,sc.syncVersion);
    for(const st of p.project(publics[i])){assert.equal(st.name,c.staff.get(st.id).name);assert.equal(st.nameLatin,c.staff.get(st.id).nameLatin);
      assert.equal(st.photo,p.photoHidden(st.id)?'':publics[i].find(x=>x.id===st.id).photo);checks++;}
  });
  for(const course of a.courseStore.values()){
    const shown=p.project(course);assert.equal(shown.name,c.course.get(course.id).names.ja);
    assert.deepEqual(p.restoreCourse(shown),course);assert.equal(shown.price,course.price);assert.equal(shown.minutes,course.minutes);
    assert.equal(shown.name.includes('女性'),course.name.includes('女性'));assert.equal(shown.name.includes('男性'),course.name.includes('男性'));checks++;
  }
  let j=0;for(const s of a.state.staff)for(const id of a.courseStore.keys()){assert.equal(a.staffMismatch(s,id),logic[j++]);checks++;}
  for(const [q,data]of baseAvailability){assert.equal(encode(a.getAvailability(q)),data);checks++;}
  assert.equal(encode(a.state),initialized,'表示切替で本番データが変化');
  // 同姓のお客様も書き換えない。
  const real=a.state.staff[0];assert.equal(p.project({id:'customer-1',name:real.name,email:'test@example.test'}).name,real.name);
  const compound=[...a.courseStore.values()].slice(0,2).map(x=>x.name).join(' / ');
  assert.equal(p.project({course_name:compound}).course_name,[...a.courseStore.values()].slice(0,2).map(x=>c.course.get(x.id).names.ja).join(' / '));
  // 実際のAPI応答にも適用され、管理者以外には管理情報を出さない。
  a.adminSessions.set('aaaabbbb',{user:'test-admin',created:Date.now()});
  function request(url,cookie){const req=new EventEmitter(),res=new EventEmitter(),headers={};
    Object.assign(req,{method:'GET',url,headers:{cookie:cookie||'',host:'localhost'},socket:{remoteAddress:'127.0.0.1'},clientIp:'127.0.0.1'});
    res.writeHead=(status,h)=>{res.statusCode=status;Object.assign(headers,h);return res;};res.getHeader=k=>headers[k];res.end=data=>{res.data=data?JSON.parse(String(data)):null;return res;};
    mod.exports.handleDemoApi(req,res,new URL(url,'http://localhost'));return res;
  }
  const api=request('/api/staff/list?date='+dates[0]);assert.equal(api.statusCode,200);assert.deepEqual(api.data.staff,p.project(publics[0]));
  for(const prefix of ['/api/staff/photo','/api/demo/staff-photo'])assert.equal(request(prefix+'?id='+process.env.DEMO_PRESENTATION_HIDE_PHOTOS).statusCode,404);
  const admin=request('/api/demo/schedule?date='+dates[0],'pm_session=aaaabbbb');assert.equal(admin.statusCode,200);assert(admin.data.staff.every(s=>s.name.startsWith('デモスタッフ')));
  const log=structuredClone(a.state.authLog);
  assert.equal(request('/api/demo/schedule?date='+dates[0]).statusCode,401);
  a.state.authLog=log;
  // 保存HTMLとReact側のメニューデータを同じ名前にする（8言語）。
  const content=fs.readFileSync(path.join(root,'public/_next/static/chunks/content-pfBsd_aY.js'),'utf8');
  const converted=p.asset(content);const categories=vm.runInNewContext(converted.replace(/export\{[^}]+\};?\s*$/,';n'),{},{timeout:1000});
  for(const group of categories)for(const menu of group.items)for(const [lang,name]of Object.entries(menu.name)){
    assert.equal(name,c.course.get(menu.id).names[lang]);checks++;
  }
  for(const input of ['<b>'+real.name+'</b>','no menu here'])assert.equal(p.asset(input),input);
  assert.equal(p.asset('a &amp; b'),'a &amp; b');
  process.env.DEMO_PRESENTATION='0';assert.equal(p.project(schedules[0]),schedules[0]);assert.equal(p.asset(content),content);assert.equal(p.version(),'normal');
  assert.equal(a.state.mails.length,0);assert.equal(encode(a.state),initialized);
  // スタッフ編集の実処理でも表示名や隠した写真が元データへ書き込まれない。
  process.env.DEMO_PRESENTATION='1';
  const target=a.state.staff.find(s=>s.id===process.env.DEMO_PRESENTATION_HIDE_PHOTOS),shown=p.project(target),oldProfile=JSON.parse(target.profile);
  const catalog=a.state.staffSkillCatalog;
  const mapped=catalog.groups.flatMap(g=>g.items).filter(i=>i.courseId&&oldProfile.sourceSkillChecks.includes(i.sourceId)).map(i=>i.courseId);
  const result=a.postSchedule({action:'staff',date:dates[0],id:target.id,name:shown.name,gender:target.gender,
    active:target.active===1,sort_order:target.sort_order,courses:mapped,allCourses:false,profile:JSON.parse(shown.profile),
    staffRevision:target.profile_revision,staffSkillCatalogVersion:catalog.version,sourceSkillChecks:oldProfile.sourceSkillChecks,
    requestKey:'test-demo-roundtrip'},{user:'test-admin',role:'admin'});
  assert(result.ok);const saved=a.state.staff.find(s=>s.id===target.id);assert.equal(saved.name,target.name);
  for(const key of ['nickname','familyName','givenName','furigana','familyKana','givenKana','message','imageKey'])assert.equal(JSON.parse(saved.profile)[key],oldProfile[key]);
  assert.equal(a.state.mails.length,0);
  console.log(JSON.stringify({ok:true,checks,staff:a.state.staff.length,menus:a.courseStore.size,availabilityCases:baseAvailability.length,originalDataUnchanged:true,externalNetwork:false}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
