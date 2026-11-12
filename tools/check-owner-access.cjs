'use strict';
// 認証・配信の変更を送信無効の本番コピー上で検査する。外部通信は禁止。
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), crypto = require('node:crypto'), { EventEmitter } = require('node:events');
const root = path.resolve(process.argv[2] || '');
assert(process.argv[2] && fs.existsSync(path.join(root, 'safe-state.json')));
assert(!fs.existsSync(path.join(root, 'mail-config.json')));
process.env.DEMO_EPHEMERAL = '1'; process.env.CLOUD = '0'; process.env.HP_MAIL = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_|BOOKING_MAIL_TO)/.test(k)) delete process.env[k];
Object.assign(process.env, { ADMIN_OWNER_USER: 'test-owner', ADMIN_OWNER_EMAIL: 'owner@delivery.fixture',
  ADMIN_OWNER_TAILSCALE_LOGIN: 'test-owner@github', TRUST_PROXY: 'tailscale' });
const noNetwork = () => { throw Error('検証中の外部通信は禁止'); };
global.fetch = noNetwork;
for (const name of ['node:net', 'node:tls']) require(name).connect = noNetwork;
for (const name of ['node:http', 'node:https']) { require(name).request = noNetwork; require(name).get = noNetwork; }
const revive = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json')), revive);
assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && !snapshot.state.mails.length);
const persist = require(path.join(root, 'persist.js'));
persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot }); persist.startSaver = () => {}; persist.requestSave = () => {};
const file = path.join(root, 'demo-api.js'), mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file, 'utf8') + `
const testOutbox=[];let testMailFailure=false;
loadMailConfig=()=>({enabled:true,allowAll:true,allowTo:[],host:'smtp.fixture',user:'test-owner'});
smtpSend=(cfg,m,done)=>{testOutbox.push({...m});done(testMailFailure?new Error('テスト送信失敗'):null);};
module.exports.audit={state,adminSessions,ownerChallenges,queueMail,deliverDueMails,resendFailedMail,testOutbox,
 setMailFailure:v=>{testMailFailure=v;}};`, file);
const auth = require(path.join(root, 'admin-owner-auth.js')), target = require(path.join(root, 'booking-mail-routing.js'));
let checks = 0;
function check(name, fn) { return Promise.resolve().then(fn).then(()=>{checks++;process.stdout.write('OK '+name+'\n');}); }
const request = cookie => ({headers:{cookie:cookie||'',host:'localhost','x-forwarded-for':'100.64.1.2','tailscale-user-login':'test-owner@github'},socket:{remoteAddress:'127.0.0.1'},clientIp:'100.64.1.2'});
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
async function main() {
  await mod.exports.ready;
  const a=mod.exports.audit;
  const account={user:'test-owner',active:true,role:'admin',name:'テスト所有者',pass:hash('test-owner-pass')};
  a.state.accounts=new Map([[account.user,account],['test-other',{...account,user:'test-other'}]]);
  a.state.mails=[]; a.state.events=new Map(); a.state.tickets=new Map(); a.state.authLog=[];
  const api=(method,route,body,cookie='',change=()=>{})=>new Promise((resolve,reject)=>{
    const req=Object.assign(new EventEmitter(),request(cookie),{method,destroy(){reject(Error('destroyed'));}});change(req);
    const res=new EventEmitter();let status=200,headers={};res.setHeader=(k,v)=>headers[k]=v;
    res.writeHead=(s,h)=>{status=s;Object.assign(headers,h||{});};res.end=data=>{let json;try{json=JSON.parse(data);}catch{json=data;}res.emit('finish');resolve({status,headers,json});};
    assert(mod.exports.handleDemoApi(req,res,new URL(route,'http://localhost')));
    if(body)req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');
  });
  const cookieOf=(r,name)=>[].concat(r.headers['Set-Cookie']||[]).find(x=>x.startsWith(name+'='))?.split(';')[0]||'';
  let challenge,session,code;
  await check('正しい端末と身元だけ許可',()=>{
    assert(auth.networkAllowed(request()));
    for(const mutate of [r=>r.socket.remoteAddress='192.168.1.2',r=>r.headers['tailscale-funnel-request']='1',r=>r.headers['tailscale-funnel-request']='',r=>delete r.headers['tailscale-user-login'],r=>r.headers['tailscale-user-login']='other@github',r=>delete r.headers['x-forwarded-for'],r=>r.headers['tailscale-user-login']=['test-owner@github','other']]){let r=request();mutate(r);assert(!auth.networkAllowed(r));}
    assert(!auth.networkAllowed(request(),{...process.env,ADMIN_OWNER_EMAIL:'bad'}));
  });
  await check('管理用の別入口・符号化URL・APIを保護し予約サイトは公開',()=>{
    for(const p of ['/admin','/admin/mails','/admin/login','/admin-original','/demo/admin','/cnsalon-board','/CNSALON-BOARD','/%63nsalon-board','/api/demo/login','/api/demo/owner-verify','/api/demo/schedule','/api/partner/hotpepper'])assert(auth.protectedPath(p,'GET','localhost'),p);
    assert(auth.protectedPath('/','GET','cnsalon-board.local'));
    for(const p of ['/','/staff','/book','/api/availability','/api/demo/settings','/api/demo/staff-photo','/api/demo/course-photo'])assert(!auth.protectedPath(p,'GET','localhost'),p);
    assert(auth.protectedPath('/api/demo/settings','POST','localhost'));
  });
  await check('以前のログインと別アカウントは無効',async()=>{
    a.adminSessions.set('aaaa',{user:account.user,created:Date.now()});
    assert.equal((await api('GET','/api/demo/schedule',null,'pm_session=aaaa')).status,401);
    assert.equal((await api('POST','/api/demo/login',{user:'test-other',pass:'test-owner-pass'})).status,401);
    assert.equal((await api('POST','/api/demo/login',{user:account.user,pass:'wrong'})).status,401);
    assert.equal(a.testOutbox.length,0);
  });
  await check('パスワードだけでは管理画面へ入れず、番号は指定メールだけへ',async()=>{
    const r=await api('POST','/api/demo/login',{user:account.user,pass:'test-owner-pass'});
    assert.equal(r.status,200);assert(r.json.needsOwnerCode);assert(!cookieOf(r,'pm_session'));
    challenge=cookieOf(r,'pm_owner_challenge');assert(challenge);
    assert.equal(a.testOutbox.length,1);assert.equal(a.testOutbox[0].to,process.env.ADMIN_OWNER_EMAIL);
    code=a.testOutbox[0].body.match(/確認番号：(\d{6})/)[1];
    assert(!JSON.stringify(r).includes(code));assert.equal(a.state.mails.length,0);
    assert(!JSON.stringify([...a.ownerChallenges.pending.values()]).includes('"'+code+'"'));
    assert.equal((await api('GET','/api/demo/accounts',null,challenge)).status,401);
  });
  await check('連打では確認番号を重複送信しない',async()=>{
    const r=await api('POST','/api/demo/login',{user:account.user,pass:'test-owner-pass'},challenge);
    assert.equal(r.status,429);assert.equal(a.testOutbox.length,1);
  });
  await check('誤った番号を拒否、正しい番号後にだけログインを発行',async()=>{
    const wrong=code==='000000'?'111111':'000000';
    assert.equal((await api('POST','/api/demo/owner-verify',{code:wrong},challenge)).status,401);
    const r=await api('POST','/api/demo/owner-verify',{code},challenge);assert.equal(r.status,200);
    session=cookieOf(r,'pm_session');assert(session);
    assert.equal((await api('GET','/api/demo/accounts',null,session)).status,200);
    assert.equal((await api('POST','/api/demo/owner-verify',{code},challenge)).status,401);
  });
  await check('ログイン済みでも別の端末・外部回線には開放しない',async()=>{
    assert.equal((await api('GET','/api/demo/accounts',null,session,r=>r.headers['tailscale-funnel-request']='1')).status,403);
    assert.equal((await api('GET','/api/demo/accounts',null,session,r=>r.headers['tailscale-user-login']='other')).status,403);
  });
  await check('期限切れ・5回間違い・他の端末・送信失敗・パスワード変更',async()=>{
    let now=Date.now();const ch=new auth.OwnerChallenges({now:()=>now});let sent;
    const issue=async()=>{now+=61000;return ch.issue(request(),account,async(to,value)=>{sent=value;});};
    let p=await issue();now+=600001;assert.throws(()=>ch.verify(request('pm_owner_challenge='+p.id),sent,a.state.accounts),/ownerCodeExpired/);
    p=await issue();for(let i=0;i<5;i++)assert.throws(()=>ch.verify(request('pm_owner_challenge='+p.id),'bad',a.state.accounts));assert.throws(()=>ch.verify(request('pm_owner_challenge='+p.id),sent,a.state.accounts));
    p=await issue();let other=request('pm_owner_challenge='+p.id);other.clientIp='100.64.1.3';assert.throws(()=>ch.verify(other,sent,a.state.accounts));
    now+=61000;await assert.rejects(ch.issue(request(),account,async()=>{throw Error('send failed');}),/ownerCodeUnavailable/);
    p=await issue();account.pass=hash('changed-test-pass');assert.throws(()=>ch.verify(request('pm_owner_challenge='+p.id),sent,a.state.accounts));
    assert.equal((await api('GET','/api/demo/accounts',null,session)).status,401);account.pass=hash('test-owner-pass');
  });
  await check('予約確認・店舗通知・取消の配信先だけ変更、元の連絡先は保持',()=>{
    process.env.BOOKING_MAIL_TO='owner@delivery.fixture';a.testOutbox.length=0;
    for(const kind of ['customer','store'])for(const type of ['confirm','notify','cancel']){
      const m=a.queueMail(kind,type,'customer@delivery.fixture','テスト予約','テスト内容',Date.now(),'test-booking');
      a.deliverDueMails();assert.equal(m.to,'customer@delivery.fixture');assert.equal(m.deliveryTo,'owner@delivery.fixture');assert(m.real);
    }
    assert.equal(a.testOutbox.length,6);assert(a.testOutbox.every(m=>m.to==='owner@delivery.fixture'));
    a.deliverDueMails();assert.equal(a.testOutbox.length,6);
  });
  await check('古い送信待ち・失敗後の再送にも現在の限定先を使用',()=>{
    delete process.env.BOOKING_MAIL_TO;
    const m=a.queueMail('store','notify','old@delivery.fixture','テスト予約','テスト',Date.now(),'test-old');
    process.env.BOOKING_MAIL_TO='owner@delivery.fixture';a.setMailFailure(true);a.deliverDueMails();assert.equal(m.status,'failed');
    a.setMailFailure(false);
    // 実予約を持つ再送は既存の本文検証を通す。ここでは配信直前に宛先を再確認する部分を検査。
    m.status='pending';a.deliverDueMails();assert.equal(m.status,'sent');assert.equal(a.testOutbox.at(-1).to,'owner@delivery.fixture');
  });
  await check('不正な限定先なら元のお客様へ送らず停止',()=>{
    process.env.BOOKING_MAIL_TO='owner@delivery.fixture,other@delivery.fixture';
    const before=a.testOutbox.length,m=a.queueMail('store','notify','old@delivery.fixture','テスト','テスト',Date.now(),'test-invalid');
    a.deliverDueMails();assert.equal(m.status,'failed');assert.equal(a.testOutbox.length,before);
  });
  await check('登録・パスワード再設定・一斉メールの宛先は転送しない',()=>{
    process.env.BOOKING_MAIL_TO='owner@delivery.fixture';
    for(const type of ['member','bulk','ticket'])assert.equal(target({type,to:'customer@delivery.fixture'}),'customer@delivery.fixture');
    delete process.env.BOOKING_MAIL_TO;assert.equal(target({bookingId:'test',to:'customer@delivery.fixture'}),'customer@delivery.fixture');
  });
  console.log(JSON.stringify({passed:checks,realExternalSends:0}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
