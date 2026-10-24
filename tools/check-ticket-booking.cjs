'use strict';
// 実際に配信する選択処理と送信処理を実行。外部通信や予約作成はしない。
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..');
const saved=new Map(), calls=[], alerts=[];
const storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
const context=vm.createContext({window:{addEventListener(){},dispatchEvent(){},alert:m=>alerts.push(m)},sessionStorage:storage,localStorage:storage,
 document:{documentElement:{lang:'ja'},addEventListener(){},getElementById(){return null;}},setInterval(){},Event:class{},URL,Headers,Response,
 location:{origin:'http://localhost'},rescheduleId:()=>'',clearReschedule(){},store:()=>[],saveStore(){},tkItems:()=>[],
 origFetch:async(input,init)=>{calls.push({input,body:JSON.parse(init?.body||'{}')});return new Response(JSON.stringify({id:'test-booking',token:'test',ticketLeft:2}),{status:200});}});
for(const file of ['cn-i18n.js','ticket-display.js'])vm.runInContext(fs.readFileSync(root+'/public/'+file,'utf8'),context);
const t=context.window.CNTickets,i=context.window.CNI18N;
const ticket={id:'test-owned',token:'test-secret',plan_name:'回数券 5回券',status:'有効',menu_scope:['course-a'],uses_left:3,expires_at:Date.now()+864e5};
let count=0;
function check(fn){fn();count++;}
check(()=>assert.equal(t.bookingHref(ticket),'/book?ticket=test-owned'));
check(()=>assert.ok(!t.useLink(ticket).includes(ticket.token)));
for(const invalid of [{...ticket,uses_left:0},{...ticket,expires_at:1},{...ticket,status:'期限切れ'}])check(()=>assert.equal(t.useLink(invalid),''));
check(()=>assert.equal(t.bookingIssue(ticket,'course-a',1),''));
for(const [tk,course,n] of [[null,'course-a',1],[ticket,'course-b',1],[ticket,'course-a',2],[ticket,'course-a,course-b',1],[{...ticket,menu_scope:[]},'course-a',1]])check(()=>assert.ok(t.bookingIssue(tk,course,n)));
check(()=>{t.choose(ticket.id);assert.equal(t.choice(),ticket.id);assert.ok(!saved.get('cn-booking-ticket').includes('secret'));});
check(()=>{const reloaded=vm.createContext({...context,window:{}});vm.runInContext(fs.readFileSync(root+'/public/ticket-display.js','utf8'),reloaded);assert.equal(reloaded.window.CNTickets.choice(),ticket.id);});
for(const lang of ['ja','en','zh','ko','fr','es','it','de'])check(()=>{i.use(lang);i.missing.clear();const keys=['使用する',t.bookingIssue(null,'course-a',1),t.bookingIssue(ticket,'course-a',2)];keys.forEach(k=>i.t(k));assert.equal(i.missing.size,0);});
context.T=s=>s;context.myTickets=[ticket];context.loadMyTickets=async()=>context.myTickets;
const source=fs.readFileSync(root+'/public/booking-tweaks.js','utf8');
vm.runInContext(source.slice(source.indexOf('  window.fetch = async'),source.indexOf('  // ---- 回数券（会員向け）')),context);
(async()=>{
 const send=(body={course:'course-a',people:1},url='/api/bookings')=>context.window.fetch(url,{method:'POST',body:JSON.stringify(body)});
 t.choose(ticket.id);let response=await send();check(()=>{assert.equal(response.status,200);assert.equal(calls.at(-1).body.ticketId,ticket.id);assert.equal(t.choice(),'');});
 for(const [id,body] of [['missing',{course:'course-a'}],[ticket.id,{course:'course-b'}],[ticket.id,{course:'course-a',people:2}]]){
  t.choose(id);let before=calls.length;response=await send(body);check(()=>{assert.equal(response.status,409);assert.equal(calls.length,before);});
 }
 t.choose(ticket.id);response=await send({course:'course-a'},'https://example.invalid/api/bookings');check(()=>assert.equal(calls.at(-1).body.ticketId,undefined));
 context.loadMyTickets=async()=>{throw new Error('offline');};t.choose(ticket.id);let before=calls.length;response=await send();check(()=>{assert.equal(response.status,409);assert.equal(calls.length,before);});
 context.loadMyTickets=async()=>context.myTickets;
 context.window.__fmTicketSel=null;t.choose('');await send();check(()=>assert.equal(calls.at(-1).body.ticketId,undefined));
 console.log('PASS '+count+' ticket navigation, selection, scope, expiry, people, translations, request and no-token-in-URL checks');
})().catch(e=>{console.error(e);process.exitCode=1;});
