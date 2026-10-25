'use strict';
// 実際の画面処理へ切断・遅延・競合の応答を与える。外部通信も本番書込もしない。
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'), read=p=>fs.readFileSync(path.join(root,p),'utf8');
const slice=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert(i>=0&&j>i,a);return s.slice(i,j);};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));const results=[];
async function check(name,fn){try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.message});}}
function cache(){const calls=[],timers=new Map();let n=0;class ES{addEventListener(k,f){this[k]=f}}
 const win={fetch:(url,init)=>{const d=deferred();calls.push({...d,url,init});return d.promise},EventSource:ES,dispatchEvent(){},addEventListener(){}};
 vm.runInNewContext(read('public/cn-fast.js'),{window:win,document:{readyState:'loading'},location:{href:'https://test.invalid/admin',origin:'https://test.invalid'},URL,Request,Response,DOMException,AbortController,Date,CustomEvent:class{},setTimeout:f=>{timers.set(++n,f);return n},clearTimeout:id=>timers.delete(id)});
 new win.EventSource('/api/demo/events').message({data:'1'});
 return{win,calls,timers,url:'/api/demo/schedule?date=2026-10-25',reply:(i,v)=>calls[i].resolve(new Response(JSON.stringify({version:v}))),timeout:()=>[...timers.values()].forEach(f=>f())};
}
(async()=>{
 await check('切断中の共用取得を10秒で解除し、次の操作は新しく取得',async()=>{const x=cache();const p=x.win.fetch(x.url);const fail=assert.rejects(p,{name:'TimeoutError'});x.timeout();await fail;const retry=x.win.fetch(x.url);assert.equal(x.calls.length,2);x.reply(1,2);assert.equal((await(await retry).json()).version,2);x.reply(0,1);await tick();assert.equal((await(await x.win.fetch(x.url)).json()).version,2);});
 await check('応答本文の読取失敗でも取得中フラグを残さない',async()=>{const x=cache();const p=x.win.fetch(x.url);x.calls[0].resolve({text:()=>Promise.reject(Error('body failed'))});await assert.rejects(p,/body failed/);const retry=x.win.fetch(x.url);assert.equal(x.calls.length,2);x.reply(1,3);await retry;assert.equal(x.timers.size,0);});
 await check('一つの画面の中断が他の画面の共用取得を取り消さない',async()=>{const x=cache(),a=new AbortController();const first=x.win.fetch(x.url,{signal:a.signal}),second=x.win.fetch(x.url);a.abort();await assert.rejects(first,{name:'AbortError'});assert.equal(x.calls.length,1);assert(!x.calls[0].init.signal.aborted);x.reply(0,4);await second;});
 await check('取得済みでも中断済みの要求に古い値を返さない',async()=>{const x=cache();const p=x.win.fetch(x.url);x.reply(0,4);await p;const c=new AbortController();c.abort();await assert.rejects(x.win.fetch(x.url,{signal:c.signal}),{name:'AbortError'});});
 for(const file of ['AdminSchedule-pm2.js','AdminSchedule-7iLokhEf.js']){
  function form(){const x={closed:0,busy:false,posts:[],messages:[],refreshes:0,pending:deferred()};const c=vm.createContext({j:false,saveGate:{current:false},m:'2026-10-25',p:'/api/demo/schedule',g:{},e:true,Oe:()=>4,AbortSignal,ae:{},window:{},c(){},M:v=>{x.busy=v},O:v=>x.messages.push(v),A(){},D:()=>x.closed++,z(){},L(){},q:async()=>{x.refreshes++},fetch:(_u,init)=>{x.posts.push(JSON.parse(init.body));return x.pending.promise}});vm.runInContext(slice(read('public/_next/static/chunks/'+file),'async function J(','let Y=')+';this.save=J;',c);x.save=b=>c.save({action:'block',staffId:'test',start:720,end:780,kind:'break',...b});return x}
  await check(file+' 連打は1回だけ保存',async()=>{const x=form();const a=x.save(),b=x.save();assert.equal(x.posts.length,1);x.pending.resolve({ok:true,json:async()=>({ok:true})});await a;await b;assert(!x.busy);assert.equal(x.closed,1);});
  await check(file+' 競合時は入力を保持し、最新取得後に操作可能',async()=>{const x=form();const p=x.save();x.pending.resolve({ok:false,json:async()=>({error:'scheduleConflict'})});assert.equal(await p,false);assert.equal(x.closed,0);assert.equal(x.refreshes,1);assert(!x.busy);assert(x.messages.some(s=>s.includes('入力は残しています')));});
  await check(file+' 通信結果不明は自動再送しない、入力と操作を戻す',async()=>{const x=form();const p=x.save();x.pending.reject(Error('network'));await p;assert.equal(x.posts.length,1);assert.equal(x.closed,0);assert(!x.busy);assert.equal(x.refreshes,1);});
 }
 const layout=read('public/pm-layout.js');
 function shift(){const x={posts:[],reply:{ok:true,json:async()=>({ok:true})}};const context=vm.createContext({sched:{days:[{date:'2026-10-25',version:7}]},date:'2026-10-25',AbortSignal,fetch:async(_u,init)=>{x.posts.push(init);if(x.error)throw x.error;return x.reply}});vm.runInContext(slice(layout,'    let revision = (sched.days','    const busy =')+';this.post=post;',context);x.post=context.post;return x}
 await check('シフト保存は編集開始時の版を送り、勝手に最新に置き換えない',async()=>{const x=shift();await x.post({action:'shift'});assert.equal(x.posts.length,1);assert.equal(JSON.parse(x.posts[0].body).revision,7);assert(x.posts[0].signal);await x.post({action:'attendance'});assert.equal(JSON.parse(x.posts[1].body).revision,8)});
 await check('拒否されたシフト保存は版を進めない',async()=>{const x=shift();x.reply={ok:false,json:async()=>({error:'scheduleConflict'})};await x.post({action:'shift'});await x.post({action:'shift'});assert.deepEqual(x.posts.map(i=>JSON.parse(i.body).revision),[7,7]);});
 await check('シフト削除の通信失敗を自動再送しない',async()=>{const x=shift();x.error=Error('timeout');await assert.rejects(x.post({action:'shift',remove:true}));assert.equal(x.posts.length,1)});
 console.log(JSON.stringify({checks:results.length,passed:results.filter(x=>x.ok).length,failures:results.filter(x=>!x.ok)},null,2));if(results.some(x=>!x.ok))process.exitCode=1;
})();
