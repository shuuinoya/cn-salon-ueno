'use strict';
// 実画面の追加処理へ遅延・連打・通信失敗を渡して検査する。本番通信なし。
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/pm-layout.js'),'utf8');
const start=source.indexOf('  async function openShiftAdd()'),end=source.indexOf('\n  // タップした空き枠',start);assert(start>=0&&end>start);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{resolve,reject,promise}};
const results=[];
async function check(name,fn){try{await fn();results.push({name,ok:true})}catch(e){results.push({name,ok:false,error:e.message})}}
function setup(){
 const nodes=new Map(),calls=[],get=deferred(),post=deferred();let current=null,date='2026-10-25',syncs=0;
 const node=k=>{if(!nodes.has(k))nodes.set(k,{value:k.endsWith('m')?'0':'',textContent:'',hidden:true,children:[],focus(){},appendChild(x){this.children.push(x)}});return nodes.get(k)};
 const wrap={isConnected:true,handlers:{},setAttribute(){},querySelector:node,querySelectorAll:()=>['staff','sh','sm','eh','em'].map(k=>node('#pm-sa-'+k)),addEventListener(k,f){this.handlers[k]=f},remove(){this.isConnected=false;current=null;}};
 const document={getElementById:()=>current,querySelector:()=>({getAttribute:()=>date}),createElement:t=>t==='div'?wrap:{},body:{appendChild:w=>current=w}};
 const context=vm.createContext({document,AbortSignal,Date,window:{__pmKickSync:()=>syncs++},refreshSched:async()=>{},decorateEvents(){},
 fetch:(url,init)=>{calls.push({url,init});return init?.method?post.promise:get.promise}});
 vm.runInContext(source.slice(start,end)+';this.open=openShiftAdd;',context);
 const data={staff:[{id:'A',name:'テスト表示A',info_missing:['photo','message']},{id:'B',name:'テストB'}],shifts:[{date,staff_id:'B'}],days:[{date,version:4}],editTokens:{shift:{A:'original-token'}}};
 const click=key=>wrap.handlers.click({target:{closest:s=>s===`[data-sa="${key}"]`?{}:null}});
 return{calls,get,post,data,node,wrap,click,open:context.open,setDate:v=>date=v,syncs:()=>syncs,
 async load(){const p=context.open();get.resolve({ok:true,json:async()=>data});await p;},
 choose(){node('#pm-sa-staff').value='A';},posts:()=>calls.filter(c=>c.init.method)};
}
(async()=>{
 await check('写真紹介未入力の登録スタッフを選べ、登録済みの人は重ねて追加できない',async()=>{const x=setup();await x.load();const opts=x.node('#pm-sa-staff').children;assert.equal(opts.length,2);assert(!opts[0].disabled);assert(opts[1].disabled);assert(opts[1].textContent.includes('登録済み'));});
 await check('読み込み中に登録も二重に開くこともしない',async()=>{const x=setup();const p=x.open();await x.open();await x.click('ok');assert.equal(x.calls.length,1);assert(x.node('[data-sa="ok"]').disabled);x.get.resolve({ok:true,json:async()=>x.data});await p;});
 await check('開いた日を固定し、別日の台帳の版を混ぜて登録しない',async()=>{const x=setup();const p=x.open();x.setDate('2026-10-26');x.get.resolve({ok:true,json:async()=>x.data});await p;x.choose();const saving=x.click('ok');const body=JSON.parse(x.posts()[0].init.body);assert.equal(body.date,'2026-10-25');assert.equal(body.revision,4);assert.equal(body.editToken,'original-token');assert.equal(body.addOnly,true);x.post.resolve({ok:true,json:async()=>({ok:true})});await saving;});
 await check('スタッフと時間を確認し、不正な入力は送信しない',async()=>{const x=setup();await x.load();await x.click('ok');assert.equal(x.posts().length,0);x.choose();x.node('#pm-sa-em').value='5';await x.click('ok');assert.equal(x.posts().length,0);assert(x.node('[data-sa="status"]').textContent.includes('翌3:00'));});
 await check('変更途中の閉じる操作で入力を保持し、破棄を選んだ時だけ閉じる',async()=>{const x=setup();await x.load();x.choose();await x.click('close');assert(x.wrap.isConnected);assert.equal(x.node('[data-sa="discard"]').hidden,false);await x.click('keep');assert(x.wrap.isConnected);assert.equal(x.node('#pm-sa-staff').value,'A');await x.click('close');await x.click('discard-close');assert(!x.wrap.isConnected);});
 await check('未編集なら余計な確認を出さずに閉じる',async()=>{const x=setup();await x.load();await x.click('close');assert(!x.wrap.isConnected);});
 await check('連打しても1回、保存中は閉じず、成功後は台帳を更新',async()=>{const x=setup();await x.load();x.choose();const p=x.click('ok');await x.click('ok');await x.click('close');await x.click('discard-close');assert.equal(x.posts().length,1);assert(x.posts()[0].init.signal);assert(x.wrap.isConnected);x.post.resolve({ok:true,json:async()=>({ok:true})});await p;assert(!x.wrap.isConnected);assert.equal(x.syncs(),1);});
 await check('通信切断で自動再送せず入力を残し、ボタンが固まらない',async()=>{const x=setup();await x.load();x.choose();const p=x.click('ok');x.post.reject(Error('offline'));await p;assert.equal(x.posts().length,1);assert(x.wrap.isConnected);assert.equal(x.node('#pm-sa-staff').value,'A');assert(!x.node('[data-sa="ok"]').disabled);assert(x.node('[data-sa="status"]').textContent.includes('登録の有無'));});
 for(const error of ['scheduleItemChanged','shiftAlreadyExists'])await check(error+'でも入力を残し再操作を案内',async()=>{const x=setup();await x.load();x.choose();const p=x.click('ok');x.post.resolve({ok:false,json:async()=>({error})});await p;assert(x.wrap.isConnected);assert.equal(x.node('#pm-sa-staff').value,'A');assert(!x.node('[data-sa="ok"]').disabled);assert(x.node('[data-sa="status"]').textContent.includes('台帳'));});
 await check('古い日付や失敗応答からシフトを作らない',async()=>{for(const bad of ['date','offline']){const x=setup();const p=x.open();if(bad==='date'){x.data.days=[{date:'2026-10-24',version:0}];x.get.resolve({ok:true,json:async()=>x.data})}else x.get.reject(Error('offline'));await p;x.choose();await x.click('ok');assert.equal(x.posts().length,0);assert(x.node('[data-sa="ok"]').disabled);}});
 console.log(JSON.stringify({checks:results.length,passed:results.filter(x=>x.ok).length,failures:results.filter(x=>!x.ok)}));if(results.some(x=>!x.ok))process.exitCode=1;
})();
