'use strict';
// 送信・保存を無効にした本番コピーでのみ実行する。実店舗への予約リクエストは送らない。
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
assert(process.argv[2]);const root=path.resolve(process.argv[2]);
assert(fs.existsSync(path.join(root,'safe-state.json'))&&!fs.existsSync(path.join(root,'mail-config.json')));
for(const k of Object.keys(process.env))if(/^(MAIL_|GH_|ADMIN_|BOOKING_MAIL|STORE_MAIL)/.test(k))delete process.env[k];
Object.assign(process.env,{DEMO_EPHEMERAL:'1',CLOUD:'0',HP_MAIL:'0'});
const noNetwork=()=>{throw Error('検証中の外部通信は禁止');};global.fetch=noNetwork;
for(const name of ['node:net','node:tls'])require(name).connect=noNetwork;
for(const name of ['node:http','node:https']){require(name).request=noNetwork;require(name).get=noNetwork;}
const revive=(_,v)=>v?.__pm_map__?new Map(v.__pm_map__):v?.__pm_set__?new Set(v.__pm_set__):v;
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'safe-state.json'),'utf8'),revive);
assert(!snapshot.state.mailRelay?.url&&!snapshot.state.mailRelay?.secret&&!snapshot.state.mails.length);
const persist=require(path.join(root,'persist.js'));persist.loadSnapshotWithRemote=async()=>({enabled:false,data:snapshot});persist.startSaver=()=>{};persist.requestSave=()=>{};
const file=path.join(root,'demo-api.js'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.audit={state,courseStore,createPublicBooking,getAvailability,bookingRequestFingerprint,getPublicBooking,ledgerContext};',file);
const control=require(path.join(root,'booking-reception.js')),config=path.join(root,'data','booking-reception.json');
fs.mkdirSync(path.dirname(config),{recursive:true});assert(!fs.existsSync(config),'検証用設定を上書きしない');
const set=v=>fs.writeFileSync(config,JSON.stringify(v));let checks=0;
const ok=(fn)=>{fn();checks++;};
const encode=v=>JSON.stringify(v,(_,x)=>x instanceof Map?[...x]:x instanceof Set?[...x]:x);
(async()=>{
 await mod.exports.ready;const a=mod.exports.audit,s=a.state,c=a.ledgerContext(),date=c.addDays(c.todayJst(),1);
 ok(()=>assert.equal(control.isPaused(),false));set({paused:true});ok(()=>assert(control.isPaused()));
 const protectedState=()=>encode({events:s.events,shifts:s.shifts,tickets:s.tickets,mails:s.mails,bookingIndex:s.bookingIndex,bookingSerial:s.bookingSerial,members:s.members});
 const before=protectedState();
 for(const course of a.courseStore.keys())for(const people of [1,2,3])for(const ticketId of ['', 'test-ticket'])for(const rescheduleId of ['', 'test-existing']){
  const body={course,date,start:c.minToMs(date,720),people,staff:'none',name:'テスト受付停止',email:'pause@example.test',phone:'0000000000',consent:true,ticketId,rescheduleId};
  ok(()=>assert.throws(()=>a.createPublicBooking(body,null),e=>e.message==='bookingPaused'&&e.status===409));
 }
 ok(()=>assert.equal(protectedState(),before,'停止中は予約・残数・送信待ちを一切変更しない'));
 const requestBody={requestKey:'test-retry',name:'テスト再送'},originalResult={id:'test-already-booked',token:'test-token'};
 s.requestKeys.set(requestBody.requestKey,{fingerprint:a.bookingRequestFingerprint(requestBody,null),result:originalResult});
 ok(()=>assert.deepEqual(a.createPublicBooking(requestBody,null),originalResult));
 ok(()=>assert.throws(()=>a.createPublicBooking({...requestBody,name:'テスト別内容'},null),e=>e.message==='requestChanged'));
 const course=[...a.courseStore.keys()][0];
 for(let i=0;i<=84;i+=7){const d=c.addDays(c.todayJst(),i),r=a.getAvailability(new URLSearchParams({course,date:d,people:'1',staff:'none'}),null);ok(()=>assert(r.bookingPaused&&r.days.length===7&&r.days.every(x=>!x.enabled&&x.slots.length===0)));}
 const api=(method,route,body)=>{const req=Object.assign(new EventEmitter(),{method,headers:{},socket:{remoteAddress:'127.0.0.1'},destroy(){throw Error('destroyed');}});let status,data;const res=Object.assign(new EventEmitter(),{setHeader(){},writeHead(n){status=n;},end(v){data=v?JSON.parse(v):null;this.emit('finish');}});assert(mod.exports.handleDemoApi(req,res,new URL(route,'http://localhost')));if(body)req.emit('data',JSON.stringify(body));req.emit('end');return {status,data};};
 ok(()=>assert.deepEqual(api('GET','/api/booking-reception'),{status:200,data:{paused:true}}));
 ok(()=>assert.equal(api('POST','/api/bookings',{name:'テスト直接送信'}).data.error,'bookingPaused'));
 const existing=[...s.events.values()].flatMap(e=>e.bookings).find(b=>b.customer_token);
 if(existing)ok(()=>assert.equal(a.getPublicBooking(existing.id,existing.customer_token,null).booking.id,existing.id));
 for(const p of ['/book','/book/','/%62ook','/book/select-datetime','/book/confirm'])ok(()=>assert(control.isBookingPage(p)));
 for(const p of ['/book/complete','/mypage','/api/bookings/cancel','/admin','/staff'])ok(()=>assert(!control.isBookingPage(p)));
 fs.writeFileSync(config,'{broken');ok(()=>assert(control.isPaused()));
 set({});ok(()=>assert(control.isPaused()));
 set({paused:false});ok(()=>assert.equal(control.isPaused(),false));
 ok(()=>assert.equal(api('GET','/api/booking-reception').data.paused,false));
 ok(()=>assert.equal(a.getAvailability(new URLSearchParams({course,date,people:'1',staff:'none'}),null).bookingPaused,false));
 console.log(JSON.stringify({ok:true,checks,existingBookingsPreserved:true,externalNetwork:false}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{fs.rmSync(config,{force:true});});
