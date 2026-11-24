'use strict';
// メール・外部保存を止めたコピーで、端末認証だけの管理アクセスを検査する。
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const root=path.resolve(process.argv[2]||'');assert(process.argv[2]&&fs.existsSync(path.join(root,'safe-state.json'))&&!fs.existsSync(path.join(root,'mail-config.json')));
for(const k of Object.keys(process.env))if(/^(MAIL_|GH_|ADMIN_|BOOKING_MAIL)/.test(k))delete process.env[k];
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
Object.assign(process.env,{DEMO_EPHEMERAL:'1',CLOUD:'0',HP_MAIL:'0',TRUST_PROXY:'tailscale',ADMIN_LOGIN_ID:'test-owner',ADMIN_PASS_HASH:hash('test-password'),ADMIN_OWNER_USER:'test-owner',ADMIN_OWNER_MODE:'device-only',ADMIN_OWNER_TAILSCALE_LOGIN:'owner@example.test',ADMIN_OWNER_DEVICE_IPS:'100.64.1.2,100.64.1.3,fd7a:115c:a1e0::1234'});
const noNetwork=()=>{throw Error('External network blocked');};global.fetch=noNetwork;
for(const n of ['node:net','node:tls'])require(n).connect=noNetwork;
for(const n of ['node:http','node:https']){require(n).request=noNetwork;require(n).get=noNetwork;}
const revive=(_,v)=>v?.__pm_map__?new Map(v.__pm_map__):v?.__pm_set__?new Set(v.__pm_set__):v;
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'safe-state.json'),'utf8'),revive);
assert(!snapshot.state.mailRelay?.url&&!snapshot.state.mailRelay?.secret&&!snapshot.state.mails.length);
snapshot.state.accounts=new Map([['test-owner',{user:'test-owner',name:'テスト管理者',role:'admin',active:true,pass:hash('test-password')}]]);snapshot.sessions=[];
const persist=require(path.join(root,'persist'));persist.loadSnapshotWithRemote=async()=>({enabled:false,data:snapshot});persist.startSaver=()=>{};persist.requestSave=()=>{};
const file=path.join(root,'demo-api.js'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(root);mod._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.audit={state,sessionAccount,adminSessions};',file);
const req=(ip='100.64.1.2')=>({headers:{host:'localhost','x-forwarded-for':ip,'tailscale-user-login':'owner@example.test'},socket:{remoteAddress:'127.0.0.1'},clientIp:ip});
function api(method,route,change){const r=Object.assign(new EventEmitter(),req(),{method});change?.(r);const res=new EventEmitter();let status,data;res.setHeader=()=>{};res.writeHead=s=>status=s;res.end=b=>{data=b?JSON.parse(b):null;res.emit('finish');};assert(mod.exports.handleDemoApi(r,res,new URL(route,'http://localhost')));r.emit('end');return {status,data};}
let checks=0;const check=fn=>{fn();checks++;};
(async()=>{
 await mod.exports.ready;const a=mod.exports.audit,auth=require(path.join(root,'admin-owner-auth')),owner=a.state.accounts.get('test-owner');
 const unchanged=()=>JSON.stringify({events:a.state.events,shifts:a.state.shifts,staff:a.state.staff,tickets:a.state.tickets,mails:a.state.mails},(_,v)=>v instanceof Map?[...v]:v instanceof Set?[...v]:v),before=unchanged();
 for(const ip of ['100.64.1.2','100.64.1.3','fd7a:115c:a1e0::1234'])check(()=>assert.equal(a.sessionAccount(req(ip)),owner));
 check(()=>assert(mod.exports.isAdminSession(req())));
 check(()=>assert.equal(api('GET','/api/demo/whoami').data.user,'test-owner'));
 check(()=>assert.equal(api('GET','/api/demo/accounts').status,200));
 check(()=>assert.equal(api('GET','/api/demo/build').status,200));
 check(()=>assert.equal(a.adminSessions.size,0,'共有セッションやパスワードを発行しない'));
 for(const change of [r=>r.headers['x-forwarded-for']='100.64.1.4',r=>r.headers['x-forwarded-for']='100.64.1.2,100.64.1.4',r=>r.headers['tailscale-user-login']='other@example.test',r=>r.headers['tailscale-funnel-request']='1',r=>r.headers['tailscale-funnel-request']='',r=>delete r.headers['x-forwarded-for'],r=>delete r.headers['tailscale-user-login'],r=>r.socket.remoteAddress='192.168.1.2']){
  check(()=>{const r=req();change(r);assert.equal(a.sessionAccount(r),null)});
  check(()=>assert.equal(api('GET','/api/demo/accounts',change).status,403));
 }
 for(const diff of [{ADMIN_OWNER_DEVICE_IPS:''},{ADMIN_OWNER_DEVICE_IPS:'100.64.1.2,invalid'},{ADMIN_OWNER_TAILSCALE_LOGIN:''},{ADMIN_OWNER_USER:''},{ADMIN_OWNER_START_AT:'invalid'},{TRUST_PROXY:''},{ADMIN_OWNER_MODE:'unknown'}])check(()=>assert.equal(auth.deviceAccount(req(),owner,{...process.env,...diff}),null));
 for(const account of [null,{...owner,active:false},{...owner,role:'staff'},{...owner,role:'manager'},{...owner,user:'other'}])check(()=>assert.equal(auth.deviceAccount(req(),account),null));
 const active=owner.active;owner.active=false;check(()=>assert.equal(a.sessionAccount(req()),null));owner.active=active;
 a.state.accounts.delete('test-owner');check(()=>assert.equal(a.sessionAccount(req()),null));a.state.accounts.set('test-owner',owner);
 process.env.ADMIN_OWNER_MODE='device-password';check(()=>assert.equal(a.sessionAccount(req()),null));
 const cookie='a'.repeat(48);a.adminSessions.set(cookie,{user:owner.user,created:Date.now(),...auth.passwordSession(req(),owner)});const r=req();r.headers.cookie='pm_session='+cookie;check(()=>assert.equal(a.sessionAccount(r),owner));
 process.env.ADMIN_OWNER_MODE='device-only';check(()=>assert.equal(a.sessionAccount(req()),owner));
 check(()=>assert.equal(a.sessionAccount({...r,headers:{...r.headers,'x-forwarded-for':'100.64.1.4'}}),null));
 check(()=>assert.equal(unchanged(),before,'予約・勤務・回数券・メールを変更しない'));
 check(()=>assert.equal(a.state.mails.length,0));
 console.log(JSON.stringify({ok:true,checks,externalNetwork:false}));
})().then(()=>process.exit(0),e=>{console.error(e.stack);process.exit(1)});
