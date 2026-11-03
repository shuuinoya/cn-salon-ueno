'use strict';
// 管理画面・予約サイト共通の購入を、送信も保存も無効にした本番コピーで検証。
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const root=fs.realpathSync(process.argv[2]); assert(root.startsWith('/private/tmp/')); assert(!fs.existsSync(path.join(root,'mail-config.json')));
for(const k of Object.keys(process.env))if(/^(MAIL_|GH_|ADMIN_PASS)/.test(k))delete process.env[k];
Object.assign(process.env,{DEMO_EPHEMERAL:'1',HP_MAIL:'0',CLOUD:'0'});global.fetch=async()=>{throw Error('外部通信は禁止');};
const decode=(_,v)=>v?.__pm_map__?new Map(v.__pm_map__):v?.__pm_set__?new Set(v.__pm_set__):v;
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'safe-state.json')),decode);assert(!snapshot.state.mailRelay?.url && !snapshot.state.mails.length);
const persist=require(path.join(root,'persist'));persist.loadSnapshotWithRemote=async()=>({enabled:false,data:snapshot});persist.startSaver=()=>{};persist.requestSave=()=>{};
const file=path.join(root,'demo-api.js'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.test={state,adminSessions};',file);
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
(async()=>{
 await mod.exports.ready;const {state:s,adminSessions}=mod.exports.test;
 s.mailRelay={};s.mails=[];s.tickets=new Map();s.ticketPurchaseKeys=new Map();s.members=new Map();s.memberSessions=new Map();
 for(const [email,phone]of [['a@example.test','00011112222'],['b@example.test','00033334444']])s.members.set(email,{email,name:'テスト 同姓同名',phone,bookings:[],tickets:[]});
 for(const role of ['admin','manager','staff']){s.accounts.set('test-'+role,{user:'test-'+role,active:true,role});adminSessions.set({admin:'aa',manager:'bb',staff:'cc'}[role],{user:'test-'+role,created:Date.now()});}
 s.memberSessions.set('abcd',{email:'a@example.test',created:Date.now()});
 s.memberSessions.set('bcde',{email:'b@example.test',created:Date.now()});
 const api=(url,body,cookie='pm_session=bb')=>new Promise(resolve=>{
  const req=new EventEmitter();Object.assign(req,{method:body?'POST':'GET',headers:{cookie},socket:{remoteAddress:'127.0.0.1'}});
  const res=new EventEmitter();let status;Object.assign(res,{writeHead(n){status=n;this.statusCode=n;},end(bytes){this.emit('finish');resolve({status,data:bytes?JSON.parse(bytes):null});}});
  assert(mod.exports.handleDemoApi(req,res,new URL(url,'http://localhost')));if(body){req.emit('data',JSON.stringify(body));req.emit('end');}
 });
 const url='/api/demo/ticket-purchase';
 eq((await api(url,null,'')).status,401);eq((await api(url,null,'pm_session=cc')).status,403);
 eq((await api(url)).data.customers.length,0);
 const found=(await api(url+'?q='+encodeURIComponent('同姓同名'))).data;
 eq(found.customers.length,2);assert.notEqual(found.customers[0].id,found.customers[1].id);checks++;
 eq((await api(url+'?q=000-1111-2222')).data.customers[0].email,'a@example.test');
 eq((await api(url+'?q=A%40EXAMPLE.TEST')).data.customers[0].email,'a@example.test');
 for(const row of found.customers)eq(Object.keys(row).sort(),['email','id','name','phone','source','version'].sort());
 const buyer=found.customers.find(x=>x.email==='a@example.test'),plan=found.plans[0],body={customerId:buyer.id,expectedCustomer:buyer.version,planId:plan.id,expectedPlan:plan.purchase_version,requestKey:'test-admin-first'};
 const first=await api(url,body);eq(first.status,200);eq(first.data.ticket.token,undefined);
 const id=first.data.ticket.id,t=s.tickets.get(id);eq(t.buyer_email,buyer.email);eq(t.price,plan.price);eq(t.uses_left,plan.uses);eq(t.valid_months,12);eq(t.history[0].by,'test-manager');eq(t.member_email,buyer.email);
 eq(s.members.get('b@example.test').tickets.length,0);eq(s.members.get('a@example.test').tickets,[id]);
 const mailCount=s.mails.length;eq(mailCount,1);
 for(let i=0;i<100;i++){const r=await api(url,body);eq(r.status,200);eq(r.data.ticket.id,id);eq(s.tickets.size,1);eq(s.mails.length,mailCount);}
 const me=await api('/api/member/me',null,'cn_member=abcd');eq(me.data.tickets[0].id,id);eq(me.data.tickets[0].plan_name,t.plan_name);eq(me.data.tickets[0].expires_at,t.expires_at);
 for(const patch of [{customerId:found.customers[1].id,expectedCustomer:found.customers[1].version},{planId:found.plans[1].id},{expectedPlan:'changed'}])eq((await api(url,{...body,...patch})).status,409);
 const stable=[s.tickets.size,s.mails.length,JSON.stringify([...s.members])];
 for(const patch of [{requestKey:''},{requestKey:'x'.repeat(101)},{expectedPlan:''},{expectedCustomer:''},{customerId:'booking:unknown'}])assert((await api(url,{...body,...patch})).status>=400);
 checks+=5;eq([s.tickets.size,s.mails.length,JSON.stringify([...s.members])],stable);
 for(const field of ['price','uses','name','valid_months','menu_scope','revive','active']){
  const p=s.ticketPlans.get(plan.id),old=structuredClone(p);
  Object.assign(p,{[field]:({price:p.price+100,uses:p.uses+1,name:p.name+'変更',valid_months:6,menu_scope:['364323-4822701'],revive:false,active:0})[field]});
  const r=await api(url,{...body,requestKey:'test-changed-'+field});eq(r.status,409);eq([s.tickets.size,s.mails.length],stable.slice(0,2));
  eq((await api(url,body)).data.ticket.id,id,'購入後に販売条件が変わっても再送は元の券を返す');Object.assign(p,old);
 }
 s.members.get(buyer.email).name+='更新';eq((await api(url,{...body,requestKey:'test-customer-change'})).status,409);eq((await api(url,body)).data.ticket.id,id);s.members.get(buyer.email).name=buyer.name;
 // 公開側にも同じ価格・条件の確認を適用。
 const unchanged=()=>JSON.stringify({tickets:[...s.tickets],keys:[...s.ticketPurchaseKeys],members:[...s.members],mails:s.mails});
 const snapshotBeforeSwitch=unchanged();
 const switched={planId:plan.id,name:buyer.name,expectedPlan:plan.purchase_version,expectedMember:buyer.email,requestKey:'test-public-switch'};
 eq((await api('/api/tickets/purchase',switched,'cn_member=bcde')).data.error,'memberChanged');
 eq((await api('/api/tickets/purchase',switched,'')).data.error,'memberChanged');
 eq(unchanged(),snapshotBeforeSwitch,'確認後にログイン会員が変わった場合は誰の券も発行しない');
 eq((await api(url,{...body,requestKey:'test-admin-switch',expectedActor:'test-admin'})).data.error,'actorChanged');
 eq(unchanged(),snapshotBeforeSwitch,'管理者の切替後は購入を登録しない');
 const pub={planId:plan.id,name:buyer.name,expectedPlan:plan.purchase_version,expectedMember:buyer.email,expectedCustomer:buyer.version,requestKey:'test-public-first'};
 s.members.get(buyer.email).phone+='9';
 eq((await api('/api/tickets/purchase',pub,'cn_member=abcd')).data.error,'customerChanged');
 s.members.get(buyer.email).phone=buyer.phone;
 const p=s.ticketPlans.get(plan.id);p.price+=100;eq((await api('/api/tickets/purchase',pub,'cn_member=abcd')).status,409);p.price-=100;
 const publicResult=await api('/api/tickets/purchase',pub,'cn_member=abcd');eq(publicResult.status,200);assert(publicResult.data.ticket.token);checks++;
 eq((await api('/api/tickets/purchase',pub,'cn_member=abcd')).data.ticket.id,publicResult.data.ticket.id);
 s.members.get(buyer.email).name+='更新';
 eq((await api('/api/tickets/purchase',pub,'cn_member=abcd')).data.ticket.id,publicResult.data.ticket.id,'購入後の会員情報変更は元の購入確認を妨げない');
 s.members.get(buyer.email).name=buyer.name;
 // 保存・再起動で戻した購入キーでも結果は一意。
 s.ticketPurchaseKeys=new Map(JSON.parse(JSON.stringify([...s.ticketPurchaseKeys])));eq((await api(url,body)).data.ticket.id,id);
 eq((await api(url,body,'pm_session=cc')).status,403);
 // 検索用の全角・半角変換を、購入者の識別には使わない。
 const wideEmail='ａ@example.test';s.members.set(wideEmail,{email:wideEmail,name:'テスト 全角会員',phone:'00099990000',bookings:[],tickets:[]});
 const wideSearch=(await api(url+'?q='+encodeURIComponent(wideEmail))).data;
 const wideBuyer=wideSearch.customers.find(x=>x.id==='member:'+wideEmail);
 eq(wideBuyer.email,wideEmail,'全角を含む別会員のメールを半角会員へ変換しない');
 const asciiBefore=JSON.stringify(s.members.get('a@example.test').tickets);
 const widePurchase=await api(url,{...body,requestKey:'test-wide-member',customerId:wideBuyer.id,expectedCustomer:wideBuyer.version});
 eq(widePurchase.status,200);eq(s.tickets.get(widePurchase.data.ticket.id).member_email,wideEmail);
 eq(JSON.stringify(s.members.get('a@example.test').tickets),asciiBefore);eq(s.members.get(wideEmail).tickets,[widePurchase.data.ticket.id]);
 console.log('PASS '+checks+' ticket purchase checks: ownership, same-name customers, staff permissions, plan/customer changes, 100 retries, one mail, public reflection, restart keys');
})().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
