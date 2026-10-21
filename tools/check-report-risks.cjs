#!/usr/bin/env node
'use strict';
// 送信を止めたコピーを読み、日報処理だけをメモリ内で検査する。本番やHTTPへ接続しない。
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const copy=path.resolve(process.argv[2]||''), root=path.resolve(__dirname,'..');
assert(copy.startsWith('/private/tmp/'));
assert(!fs.existsSync(path.join(copy,'mail-config.json')));
process.env.DEMO_EPHEMERAL='1';process.env.HP_MAIL='0';process.env.CLOUD='0';
for(const key of Object.keys(process.env))if(/^(MAIL_|GH_|ADMIN_PASS)/.test(key))delete process.env[key];
const revive=(_,v)=>v?.__pm_map__?new Map(v.__pm_map__):v?.__pm_set__?new Set(v.__pm_set__):v;
const snapshot=JSON.parse(fs.readFileSync(path.join(copy,'safe-state.json'),'utf8'),revive);
assert(!snapshot.state.mailRelay?.url&&!snapshot.state.mailRelay?.secret&&!snapshot.state.mails.length);
const persist=require('../persist');persist.loadSnapshotWithRemote=async()=>({enabled:false,data:snapshot});persist.startSaver=()=>{};
const file=path.join(root,'demo-api.js'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.reportAudit={state,adminSessions};',file);
(async()=>{
  await mod.exports.ready;
  const {state,adminSessions}=mod.exports.reportAudit,date='2026-10-24',results=[];
  const actors={a:{user:'test-report-a',role:'manager',active:true},b:{user:'test-report-b',role:'manager',active:true},s:{user:'test-report-staff',role:'staff',active:true}};
  state.events=new Map();state.days=new Map([[date,{version:0,enabled:true}]]);state.shifts=new Map();state.reports=new Map();state.ledger=require('../ledger-operations').createState();
  const tokens={a:'aaaabb',b:'bbbbcc',s:'ccccdd'};
  for(const [key,a]of Object.entries(actors)){state.accounts.set(a.user,a);adminSessions.set(tokens[key],{user:a.user,created:Date.now()});}
  function api(method,body,actor='a'){
    const req=new EventEmitter();Object.assign(req,{method,headers:{cookie:actor?'pm_session='+tokens[actor]:''},socket:{remoteAddress:'127.0.0.1'},destroy(){}});
    let status,data,headers;const res=new EventEmitter();Object.assign(res,{setHeader(){},writeHead(code,h){status=code;headers=h;},end(raw){data=raw?JSON.parse(raw):null;this.emit('finish');}});
    assert(mod.exports.handleDemoApi(req,res,new URL('/api/demo/report?date='+date,'http://localhost')));
    if(method==='POST'){req.emit('data',JSON.stringify(body));req.emit('end');}
    return {status,data,headers};
  }
  const input={date,revision:0,requestKey:'test-report-save-0001',weather:'',todayPlan:'テスト 日報',manager:'テスト担当',send:true};
  const check=(name,fn)=>{try{fn();results.push({name,ok:true});}catch{results.push({name,ok:false});}};
  const snap=()=>JSON.stringify({reports:[...state.reports],days:[...state.days]});
  let first;
  check('未ログインとスタッフ権限の日報保存を拒否',()=>{assert.equal(api('POST',input,'').status,401);assert.equal(api('POST',input,'s').status,403);assert.equal(state.reports.size,0);});
  check('キーがない保存を拒否',()=>{assert.equal(api('POST',{...input,requestKey:undefined}).status,400);assert.equal(state.reports.size,0);});
  check('初回保存だけ版を進め、内部履歴を返さない',()=>{first=api('POST',input);assert.equal(first.status,200);assert.equal(first.data.revision,1);assert.equal(first.data.saved.todayPlan,input.todayPlan);assert(!('lastrequests'in first.data.saved));assert.equal(first.headers['Cache-Control'],'no-store');});
  check('20回の同じ再送は初回成功を返し二重確定しない',()=>{const before=snap();for(let n=0;n<20;n++)assert.deepEqual(api('POST',input).data,first.data);assert.equal(snap(),before);});
  check('版の更新後も同じ操作の再送は元の成功を返す',()=>{state.days.get(date).version=7;assert.deepEqual(api('POST',{...input,revision:7}).data,first.data);assert.equal(state.days.get(date).version,7);});
  check('同じキーの内容変更と別担当での再利用を拒否',()=>{const before=snap();for(const r of [api('POST',{...input,todayPlan:'テスト変更'}),api('POST',input,'b')]){assert.equal(r.status,409);assert.equal(r.data.error,'requestChanged');}assert.equal(snap(),before);});
  check('新しいキーでの古い版上書きは拒否',()=>{const before=snap(),r=api('POST',{...input,requestKey:'test-report-stale-0001'});assert.equal(r.status,409);assert.equal(r.data.error,'scheduleConflict');assert.equal(snap(),before);});
  check('不正な天気・担当・object・制御文字を保存しない',()=>{const before=snap();for(const extra of [{weather:'不明な値'},{manager:''},{todayPlan:{x:1}},{todayPlan:'テスト\u0000'},{todayPlan:'あ'.repeat(2001)},{send:1}])assert.equal(api('POST',{...input,revision:7,requestKey:'test-report-invalid',...extra}).status,400);assert.equal(snap(),before);});
  check('後続保存後に古い再送が届いても現在の記録を戻さない',()=>{const r=api('POST',{...input,revision:7,requestKey:'test-report-save-0002',todayPlan:'テスト 次の保存'});assert.equal(r.status,200);assert.equal(r.data.revision,8);assert.deepEqual(api('POST',input).data,first.data);assert.equal(state.reports.get(date).todayPlan,'テスト 次の保存');});
  check('閲覧にキー履歴を含めず、未設定の値を作らない',()=>{const r=api('GET');assert.equal(r.status,200);assert(!('lastrequests'in r.data.saved));assert.equal(r.data.today.goal,null);assert.equal(r.data.today.salesNet,null);assert.equal(r.data.saved.weather,'');});
  check('履歴を100件以内に保ち保存データを際限なく増やさない',()=>{for(let n=0;n<105;n++)assert.equal(api('POST',{date,revision:state.days.get(date).version,requestKey:'test-report-limit-'+n,todayPlan:'テスト '+n}).status,200);assert.equal(state.reports.get(date).lastrequests.length,100);assert(!JSON.stringify(state.reports.get(date).lastrequests).includes('lastrequests'));});
  check('日報でメールを作成しない',()=>assert.equal(state.mails.length,0));
  const result={passed:results.every(x=>x.ok),checks:results.length,failed:results.filter(x=>!x.ok).map(x=>x.name),externalMail:false,persistentWrites:false};console.log(JSON.stringify(result));process.exit(result.passed?0:1);
})().catch(()=>{console.error(JSON.stringify({passed:false,error:'日報検証の準備または実行に失敗しました'}));process.exit(1);});
