'use strict';
// 実際の鍵ボタンの処理を架空のスタッフと通信で検査。本番へ接続しない。
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/pm-layout.js'),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert(start>=0&&end>start);return source.slice(start,end);};
const classes=()=>({values:new Set(),toggle(k,v){if(v)this.values.add(k);else this.values.delete(k);},contains(k){return this.values.has(k);}});
const tests=[];let passed=0;
async function test(name,fn){try{await fn();passed++;}catch(e){tests.push({name,error:e.message});}}
function setup({id='staff-a',name='ニックネーム',locked=false}={}){
 const row={dataset:{staffId:id},classList:classes()},buttons=[];
 const cell={querySelector:()=>buttons[0]||null,appendChild:b=>buttons.push(b)};
 const posts=[],alerts=[];let revision=7,fail=false;
 const ctx=vm.createContext({window:{__pmLocks:{[id]:{id,name:'登録名',locked,gender:'male'}},alert:x=>alerts.push(x)},row,cell,name,d:{},ledgerDate:()=> '2026-10-22',
 document:{createElement:()=>({dataset:{},attrs:{},handlers:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.handlers[k]=fn;},click(){return this.handlers.click({preventDefault(){},stopPropagation(){}});}})},
 fetch:async(_url,init)=>{if(!init?.method)return{ok:true,json:async()=>({days:[{date:'2026-10-22',version:revision}],staff:[{id,locked}]})};posts.push(JSON.parse(init.body));return{ok:!fail};},refreshLocks:async()=>{}});
 const render=()=>vm.runInContext('{'+section('      const staffId = row.dataset.staffId;','    });\n\n',)+'}',ctx);
 render();return{ctx,row,cell,buttons,posts,alerts,render,setFail:()=>fail=true,setRevision:v=>revision=v};
}
(async()=>{
 await test('登録名とニックネームが違っても同じIDの鍵を出す',()=>{const x=setup();assert.equal(x.buttons.length,1);assert.equal(x.buttons[0].attrs['aria-label'],'ニックネームの予約をこの日だけブロック');});
 await test('繰り返し描画しても鍵を二重に作らない',()=>{const x=setup();x.render();x.render();assert.equal(x.buttons.length,1);});
 await test('鍵の設定は表示名ではなく登録IDと当日・最新版を送る',async()=>{const x=setup();await x.buttons[0].click();assert.deepEqual(x.posts,[{action:'lockStaff',date:'2026-10-22',revision:7,staffId:'staff-a',locked:1}]);assert(x.row.classList.contains('pm-locked'));x.render();assert.equal(x.buttons[0].attrs['aria-pressed'],'true');});
 await test('鍵の解除は同じスタッフだけを変更',async()=>{const x=setup({locked:true});await x.buttons[0].click();assert.equal(x.posts[0].locked,0);assert.equal(x.row.classList.contains('pm-locked'),false);});
 await test('保存中に連打しても二重送信しない',async()=>{const x=setup();const first=x.buttons[0].click();await x.buttons[0].click();await first;assert.equal(x.posts.length,1);});
 await test('保存失敗時は元に戻して最新状態を確認する案内',async()=>{const x=setup();x.setFail();await x.buttons[0].click();assert.equal(x.row.classList.contains('pm-locked'),false);assert.equal(x.alerts.length,1);assert.equal(x.buttons[0].dataset.busy,undefined);});
 await test('最新版が不明なら保存しない',async()=>{const x=setup();x.setRevision(undefined);await x.buttons[0].click();assert.equal(x.posts.length,0);assert.equal(x.alerts.length,1);});
 for(const key of ['Enter',' '])await test(key+'で親のシフト編集を起動せず鍵だけを操作',()=>{const x=setup();let click=0,prevent=0,stop=0;x.buttons[0].click=()=>click++;x.buttons[0].handlers.keydown({key,preventDefault(){prevent++;},stopPropagation(){stop++;}});assert.equal(click,1);assert.equal(prevent,1);assert.equal(stop,1);});
 await test('同姓同名でも異なるIDの鍵の状態を保持',async()=>{const ctx=vm.createContext({window:{},Date,ledgerDate:()=> '2026-10-22',fetch:async()=>({json:async()=>({locks:[{id:'a',name:'同名',locked:1},{id:'b',name:'同名',locked:0}]})})});vm.runInContext(section('  async function refreshLocks(force)', '  // 下部の集計バー')+'this.load=refreshLocks;',ctx);await ctx.load(true);assert.equal(ctx.window.__pmLocks.a.locked,1);assert.equal(ctx.window.__pmLocks.b.locked,0);assert.equal(Object.keys(ctx.window.__pmLocks).length,2);});
 console.log(JSON.stringify({passed,failures:tests},null,2));if(tests.length)process.exitCode=1;
})();
