'use strict';
// 入れ子・外側タップ・破棄確認・背景復帰を、保存APIなしで検査する。
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
let count=0;const eq=(a,b)=>{assert.deepEqual(a,b);count++;};
const style=()=>({setProperty(k,v){this[k]=v;}}),events={};
const root={style:style(),clientWidth:1000,classList:{values:new Set(),add(v){this.values.add(v)},remove(v){this.values.delete(v)},contains(v){return this.values.has(v)}}};
let nodes=[],observer;const window={addEventListener(k,f){events['window:'+k]=f},scrollTo(x,y){context.scrollX=x;context.scrollY=y},visualViewport:{width:1000,height:700,offsetLeft:0,offsetTop:0,addEventListener(k,f){events['view:'+k]=f}}};
const document={documentElement:root,body:{},querySelectorAll(){return nodes},addEventListener(k,f){events[k]=f}};
const context={window,document,innerWidth:1015,innerHeight:700,scrollX:0,scrollY:520,Event,MutationObserver:class{constructor(cb){observer=cb}observe(){}}};
vm.runInNewContext(fs.readFileSync(require.resolve('../public/popup-behavior.js'),'utf8'),context);
function dialog(guard=false){return {tagName:'DIALOG',open:true,isConnected:true,hidden:false,attrs:{},calls:0,getClientRects(){return this.open?[1]:[]},getBoundingClientRect(){return {left:300,right:700,top:150,bottom:550}},setAttribute(k,v){this.attrs[k]=v},contains(target){return target===this.child},dispatchEvent(event){eq(event.type,'cancel');this.calls++;return !guard},close(){this.open=false;observer()}};}
function pointer(el,x,y,target=el,type='pointerdown'){const e={target,clientX:x,clientY:y,button:0,isPrimary:true,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};events[type](e);return e;}
const click=(el,x,y)=>pointer(el,x,y,el,'click');
const a=dialog();nodes=[a];observer();eq(root.classList.contains('cn-popup-open'),true);eq(root.style['--cn-popup-scroll-y'],'-520px');eq(root.style['--cn-popup-gutter'],'15px');eq(root.style['--cn-popup-x'],'500px');eq(root.style['--cn-popup-y'],'350px');
pointer(a,400,300);click(a,100,100);eq(a.open,true);eq(a.calls,0); // 中から外へドラッグ
pointer(a,100,100);click(a,140,100);eq(a.open,true);eq(a.calls,0); // 外側でスクロールに近い移動
pointer(a,400,300);click(a,400,300);eq(a.open,true); // 余白を含め小窓内は閉じない
const b=dialog(true);nodes.push(b);observer();pointer(b,100,100);click(b,100,100);eq(b.open,true);eq(b.calls,1);eq(root.classList.contains('cn-popup-open'),true); // 未保存・保存中をキャンセル側が保護
b.open=false;observer();eq(root.classList.contains('cn-popup-open'),true); // 子だけ閉じても背景を解除しない
let prevented=false;events.wheel({target:{},preventDefault(){prevented=true}});eq(prevented,true);
a.child={};prevented=false;events.wheel({target:a.child,preventDefault(){prevented=true}});eq(prevented,false);
window.visualViewport.width=320;window.visualViewport.height=280;window.visualViewport.offsetTop=40;events['view:resize']();eq(root.style['--cn-popup-x'],'160px');eq(root.style['--cn-popup-y'],'180px');eq(root.style['--cn-popup-height'],'280px');
context.scrollY=0;pointer(a,100,100);click(a,100,100);eq(a.open,false);eq(root.classList.contains('cn-popup-open'),false);eq(context.scrollY,520);
const c=dialog();nodes=[c];observer();c.isConnected=false;nodes=[];context.scrollY=0;observer();eq(root.classList.contains('cn-popup-open'),false);eq(context.scrollY,520); // ページ遷移で削除
let closeClicks=0;const button={disabled:false,click(){closeClicks++}};
const overlay={...dialog(),tagName:'DIV',matches(s){return s==='.bd-overlay'},querySelector(){return button}};
nodes=[overlay];observer();pointer(overlay,100,100);click(overlay,100,100);eq(closeClicks,1);button.disabled=true;pointer(overlay,100,100);click(overlay,100,100);eq(closeClicks,1);eq(root.classList.contains('cn-popup-open'),true);
nodes=[];observer();eq(root.classList.contains('cn-popup-open'),false);
console.log(JSON.stringify({passed:count,externalRequests:0}));
