'use strict';
// 送信無効の照合済みコピーをメモリだけで検査する。サーバー・通信・実データ保存は使わない。
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
assert(process.argv[2]&&process.argv[3],'検証用コードフォルダと送信無効の照合済みコピーを指定してください');
const root=path.resolve(process.argv[2]),file=path.resolve(process.argv[3]);
assert(!fs.existsSync(path.join(root,'mail-config.json')));
process.env.DEMO_EPHEMERAL='1';process.env.HP_MAIL='0';process.env.CLOUD='0';
for(const key of Object.keys(process.env))if(/^(MAIL_|GH_|ADMIN_PASS)/.test(key))delete process.env[key];
global.fetch=async()=>{throw Error('external network disabled');};
const revive=(_,v)=>v?.__pm_map__?new Map(v.__pm_map__):v?.__pm_set__?new Set(v.__pm_set__):v;
const encode=v=>JSON.stringify(v,(_,x)=>x instanceof Map?{__pm_map__:[...x]}:x instanceof Set?{__pm_set__:[...x]}:x);
const clone=v=>JSON.parse(encode(v),revive),bytes=fs.readFileSync(file),snapshot=JSON.parse(bytes,revive);
assert(snapshot.state.mails.length===0&&!snapshot.state.mailRelay?.url&&!snapshot.state.mailRelay?.secret);
const persist=require(path.join(root,'persist.js'));persist.loadSnapshotWithRemote=async()=>({enabled:false,data:snapshot});persist.startSaver=()=>{};persist.requestSave=()=>{};
const src=path.join(root,'demo-api.js'),m=new Module(src);m.filename=src;m.paths=Module._nodeModulePaths(root);
m._compile(fs.readFileSync(src,'utf8')+'\nmodule.exports.audit={state,courseStore,postSchedule,getSchedule,publicStaffList,adminSessions,todayJst,addDays,minToMs};',src);
const skills=require(path.join(root,'staff-skills.js')),err=(status,code)=>Object.assign(Error(code),{status});
(async()=>{
 await m.exports.ready;
 const a=m.exports.audit,state=a.state,courses=[...a.courseStore.values()],date=a.addDays(a.todayJst(),1);
 const manager={user:'test-manager',role:'manager',active:true},worker={user:'test-worker',role:'staff',active:true};
 const results=[],sourceCatalog=clone(state.staffSkillCatalog);assert(sourceCatalog);
 const sourceIds=skills.itemsOf(sourceCatalog);assert.equal(sourceIds.length,79);assert.equal(sourceIds.filter(x=>x.courseId).length,courses.length);
 const run=(name,fn)=>{try{fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.message.split('\n').slice(0,2).join(' ')});}};
 const protectedState=()=>encode({shifts:state.shifts,events:state.events,tickets:state.tickets,members:state.members,photos:state.photos,courses:state.courses,booths:state.booths,mails:state.mails});
 run('本番コピー全員の79チェック・販売25対応・男女制限・原本値保持を再検算',()=>{
  assert.equal(skills.normalizeCatalog(sourceCatalog,courses,err).version,sourceCatalog.version);
  for(const s of state.staff){const p=JSON.parse(s.profile||'{}');if(!p.peakManagerId)continue;
   assert(skills.sameSet(skills.validateChecks(sourceCatalog,p.sourceSkillChecks,s.gender,err),JSON.parse(s.courses)));
   skills.validateSourceIds(sourceCatalog,p.sourceSkillOriginalChecks,err);
  }
  const before=protectedState(),s=state.staff.find(s=>JSON.parse(s.profile||'{}').peakManagerId),p=JSON.parse(s.profile);
  const body={action:'staff',date,id:s.id,create:false,name:s.name,gender:s.gender,active:s.active,sortOrder:s.sort_order,staffRevision:s.profile_revision,
   staffSkillCatalogVersion:sourceCatalog.version,sourceSkillChecks:p.sourceSkillChecks,courses:JSON.parse(s.courses),allCourses:false,profile:p,requestKey:'test-copy-save'};
  assert(a.postSchedule(body,manager).ok);assert.equal(protectedState(),before);
  assert.deepEqual(JSON.parse(state.staff.find(x=>x.id===s.id).profile).sourceSkillOriginalChecks,p.sourceSkillOriginalChecks);
 });
 const course=courses.find(c=>!/男性|女性/.test(c.name)),cid=course.id,sid=cid.split('-').at(-1);
 const catalogInput={groups:[{id:'test-sale',name:'テスト販売メニュー',items:courses.map(c=>({sourceId:c.id.split('-').at(-1),courseId:c.id,name:c.name,gender:/女性/.test(c.name)?'female':/男性/.test(c.name)?'male':'none'}))},
  {id:'test-reference',name:'テスト参考メニュー',items:Array.from({length:54},(_,i)=>({sourceId:String(90000000+i),courseId:null,name:i===0?'【女性スタッフ】テスト参考':i===1?'【男性スタッフ】テスト参考':'テスト参考'+i,gender:i===0?'female':i===1?'male':'none'}))}]};
 const catalog=skills.normalizeCatalog(catalogInput,courses,err),baseChecks=[sid,'90000002'];
 function reset(){
  state.staff=[{id:'test-A',name:'テスト担当',gender:'male',active:1,listing_order:3,sort_order:2,courses:JSON.stringify([cid]),profile_revision:7,
   profile:JSON.stringify({peakManagerId:'12345',message:'テスト紹介',phone:'0000000000',personalNomination:true,sourceSkillChecks:baseChecks,sourceSkillOriginalChecks:[sid,'90000000']})}];
  state.photos=new Map([['test-A','data:image/jpeg;base64,/9j/']]);state.staffSkillCatalog=clone(catalog);state.staffSkillKeys=new Map();state.staffIdHigh=10000000;
  state.days=new Map([[date,{version:0,enabled:true}]]);state.events=new Map([[date,{bookings:[],blocks:[],assignments:[]}]]);state.shifts=new Map([[date,[]]]);state.mails=[];
  state.accounts.set(manager.user,manager);state.accounts.set(worker.user,worker);a.adminSessions.clear();a.adminSessions.set('aaaa',{user:manager.user,created:Date.now()});a.adminSessions.set('bbbb',{user:worker.user,created:Date.now()});
 }
 const st=()=>state.staff[0],profile=()=>JSON.parse(st().profile),body=(extra={})=>({action:'staff',date,id:st().id,create:false,name:st().name,gender:st().gender,active:true,sortOrder:st().sort_order,
  staffRevision:st().profile_revision,staffSkillCatalogVersion:state.staffSkillCatalog?.version,sourceSkillChecks:baseChecks,courses:[cid],allCourses:false,profile:{nickname:'テスト表示'},requestKey:crypto.randomUUID(),...extra});
 const save=b=>a.postSchedule(b||body(),manager);
 const reject=(b,code)=>{const before=encode(state);assert.throws(()=>save(b),e=>e.message===code);assert.equal(encode(state),before);};
 const test=(name,fn)=>{reset();run(name,fn);};
 const api=(method,route,payload,role='manager')=>{
  const req=new EventEmitter();Object.assign(req,{method,headers:{cookie:role==='manager'?'pm_session=aaaa':role==='staff'?'pm_session=bbbb':''},socket:{remoteAddress:'127.0.0.1'},destroy(){}});
  let status,data;const res=new EventEmitter();Object.assign(res,{setHeader(){},writeHead(s){status=s;},end(raw){data=raw?JSON.parse(raw):null;this.emit('finish');}});
  assert(m.exports.handleDemoApi(req,res,new URL(route,'http://localhost')));if(method==='POST'){req.emit('data',JSON.stringify(payload));req.emit('end');}return{status,data};
 };
 test('階層79項目と販売25のID対応を固定・写真や個人情報をカタログへ出さない',()=>{
  assert.equal(skills.itemsOf(catalog).length,79);assert.equal(skills.itemsOf(catalog).filter(x=>x.courseId).length,25);
  const extra=clone(catalogInput);extra.groups[0].items[0].photo='secret';extra.groups[0].items[0].price=999;
  assert.deepEqual(skills.normalizeCatalog(extra,courses,err),catalog);
 });
 test('重複ID・欠落対応・存在しない販売ID・別IDへの誤対応は拒否',()=>{
  for(const change of [c=>c.groups[0].items.push({...c.groups[0].items[0]}),c=>c.groups[0].items.pop(),c=>c.groups[0].items[0].courseId='missing',c=>c.groups[0].items[0].sourceId='999']){
   const c=clone(catalogInput);change(c);assert.throws(()=>skills.normalizeCatalog(c,courses,err),e=>e.message==='staffSkillInvalid');
  }
 });
 test('参考メニューを含むチェック保存・予約販売メニューは25件のまま',()=>{
  const before=courses.map(c=>[c.id,c.price]);assert(save().ok);assert.deepEqual(profile().sourceSkillChecks,baseChecks);assert.deepEqual(JSON.parse(st().courses),[cid]);
  assert.deepEqual([...a.courseStore.values()].map(c=>[c.id,c.price]),before);assert.equal(st().listing_order,3);
 });
 test('部分プロフィール編集で紹介文・連絡先・原本ID・元チェックを失わない',()=>{
  const old=profile();save(body({profile:{nickname:'テスト変更',peakManagerId:'wrong',sourceSkillOriginalChecks:[]}}));
  for(const k of ['message','phone','peakManagerId','sourceSkillOriginalChecks'])assert.deepEqual(profile()[k],old[k]);
  assert.equal(profile().nickname,'テスト変更');assert.equal(st().profile_revision,8);
 });
 test('男性へ女性参考メニュー・女性へ男性参考メニューをチェック不可',()=>{
  reject(body({sourceSkillChecks:[sid,'90000000'],photo:'data:image/png;base64,dGVzdA=='}),'staffCourseGender');
  reject(body({gender:'female',sourceSkillChecks:[sid,'90000001']}),'staffCourseGender');
  reject(body({gender:'none',sourceSkillChecks:[sid,'90000001']}),'staffCourseGender');
 });
 test('販売メニューの性別違いも全件無変更',()=>{
  const female=skills.itemsOf(catalog).find(c=>c.courseId&&c.gender==='female');
  reject(body({sourceSkillChecks:[female.sourceId],courses:[female.courseId]}),'staffCourseGender');
 });
 test('未知・重複チェック／販売コースとの不一致／全対応フラグを拒否',()=>{
  for(const extra of [{sourceSkillChecks:[sid,'missing']},{sourceSkillChecks:[sid,sid]},{courses:[]},{allCourses:true},{sourceSkillChecks:'all'}])reject(body(extra),'staffSkillInvalid');
 });
 test('販売メニュー0件を全対応に変換せず保存拒否',()=>{
  reject(body({sourceSkillChecks:['90000002'],courses:[]}),'noCourses');reject(body({sourceSkillChecks:[],courses:[]}),'noCourses');
 });
 test('カタログ変更とスタッフ変更を別々に競合検出・一部保存しない',()=>{
  reject(body({staffSkillCatalogVersion:'old'}),'staffSkillCatalogChanged');reject(body({staffRevision:6}),'staffChanged');
  reject(body({staffRevision:undefined}),'staffChanged');reject(body({requestKey:undefined}),'invalid');
 });
 test('同内容再送は日付・台帳版だけ変わっても1回分・内容変更は拒否',()=>{
  const b=body(),first=save(b),after=encode(state);assert.deepEqual(save({...b,date:a.addDays(date,1),revision:99}),first);
  // 別営業日の読み込み初期化以外にスタッフや再送記録を増やさない。
  state.days.delete(a.addDays(date,1));assert.equal(encode(state),after);reject({...b,name:'テスト変更'},'requestChanged');
 });
 test('保存後カタログが変わっても同一送信の結果は再取得できる',()=>{
  const b=body(),r=save(b);state.staffSkillCatalog.groups[0].name='テスト分類変更';const after=encode(state);assert.deepEqual(save(b),r);assert.equal(encode(state),after);
 });
 test('成功済み編集の再送後にスタッフが削除されても復活しない',()=>{
  const b=body(),r=save(b);state.staff=[];assert.deepEqual(save(b),r);assert.equal(state.staff.length,0);
 });
 test('未保存の削除済スタッフ編集は新規採番せず拒否',()=>{
  const b=body();state.staff=[];reject(b,'staffChanged');
 });
 test('新規mode限定作成・二重送信でも1名だけ・既存No維持',()=>{
  const b=body({id:'test-new',create:true,staffRevision:0}),r=save(b);assert.equal(state.staff.length,2);assert.equal(state.staff[1].listing_order,4);
  const after=encode(state);assert.deepEqual(save(b),r);assert.equal(encode(state),after);reject(body({create:true}),'staffChanged');
 });
 test('カタログ未設定でも古い版や消失IDの編集を拒否',()=>{
  state.staffSkillCatalog=null;reject(body({staffRevision:6}),'staffChanged');const b=body();state.staff=[];reject(b,'staffChanged');
 });
 test('不正写真・不正profileを保存前に拒否し公開表示が壊れない',()=>{
  for(const photo of [{bad:'image'},true,123,'https://example.test/image','data:image/svg+xml;base64,dGVzdA=='])reject(body({photo}),'invalid');
  for(const p of ['bad',[],42])reject(body({profile:p}),'invalid');assert(a.publicStaffList(date).length===1);
 });
 test('正しい写真変更・明示削除が可能で省略時は維持',()=>{
  save(body({photo:'data:image/png;base64,dGVzdA=='}));assert.equal(state.photos.get(st().id),'data:image/png;base64,dGVzdA==');
  save();assert(state.photos.has(st().id));save(body({photo:null}));assert(!state.photos.has(st().id));assert.equal(a.publicStaffList(date).length,0);
 });
 test('管理用カタログは認証必須・一般スタッフは変更不可',()=>{
  assert.equal(api('GET','/api/demo/schedule?date='+date,null,'none').status,401);
  assert.equal(api('POST','/api/demo/schedule',body(),'staff').status,403);
  const r=api('GET','/api/demo/schedule?date='+date);assert.equal(r.status,200);assert.equal(skills.itemsOf(r.data.staffSkillCatalog).length,79);
  const pub=api('GET','/api/staff/list?date='+date,null,'none');assert.equal(pub.status,200);const txt=JSON.stringify(pub.data);
  for(const key of ['sourceSkillChecks','sourceSkillOriginalChecks','staffSkillCatalog','peakManagerId','phone'])assert(!txt.includes('"'+key+'"'));
 });
 test('管理保存APIの連打・通信再送を同一結果で処理',()=>{
  const b=body(),first=api('POST','/api/demo/schedule',b);assert.equal(first.status,200);const revision=st().profile_revision;
  const retry=api('POST','/api/demo/schedule',{...b,revision:123});assert.equal(retry.status,200);assert.deepEqual(retry.data,first.data);assert.equal(st().profile_revision,revision);
 });
 assert.deepEqual(fs.readFileSync(file),bytes);assert(state.mails.every(x=>!x.real));
 console.log(JSON.stringify({passed:results.filter(x=>x.ok).length,total:results.length,results},null,2));
 process.exit(results.every(x=>x.ok)?0:1);
})().catch(e=>{console.error(e.message);process.exit(1);});
