'use strict';
// 実際の購入画面スクリプトを、外部通信なしで実行する。応答順序・連打・再読込を検査。
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const source=fs.readFileSync(require.resolve('../public/ticket-purchase.js'),'utf8');
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const plan={id:'p1',name:'テスト整体5回券',uses:5,price:30000,menu_scope:'all',valid_label:'1年間',purchase_version:'p-version'};
const member={email:'test-a@example.test',name:'テスト購入者',phone:'0000000000',purchase_version:'m-version'};
const receipt={ok:true,ticket:{id:'t1',plan_name:plan.name,purchased_at:'2026-11-03T00:00:00Z',expires_at:Date.parse('2027-11-03T14:59:59Z'),uses_left:5}};
function harness(options={}){
 const store=options.store||new Map(),posted=[];
 const state={member:{...member},plans:[{...plan}],actor:'test-manager',customers:[],...options.state};
 let current=null;
 class Element{
  constructor(){this.listeners={};this.disabled=false;this.hidden=false;this.value='';this.textContent='';this.innerHTML='';this.attrs={};}
  addEventListener(event,fn){(this.listeners[event]||=[]).push(fn);}
  setAttribute(k,v){this.attrs[k]=v;}
  async emit(event,e={}){if(event==='click'&&this.disabled)return;return Promise.all((this.listeners[event]||[]).map(fn=>fn({target:this,preventDefault(){},...e})));}
 }
 class Dialog extends Element{
  constructor(){super();this.open=false;this.nodes=Object.fromEntries(['status','submit','summary','controls','plan','customer','search','input','searchButton','topClose','bottomClose'].map(k=>[k,new Element()]));this.nodes.search.elements={query:this.nodes.input};}
  querySelector(selector){const key=selector==='footer [data-close]'?'bottomClose':selector.match(/^\[data-(.+)\]$/)?.[1];assert(this.nodes[key],selector);return this.nodes[key];}
  querySelectorAll(selector){if(selector==='[data-close]')return [this.nodes.topClose,this.nodes.bottomClose];if(selector.startsWith('[data-controls]'))return [this.nodes.plan,this.nodes.customer,this.nodes.input,this.nodes.searchButton];return [this.nodes.submit,this.nodes.topClose,this.nodes.bottomClose,this.nodes.plan,this.nodes.customer,this.nodes.input,this.nodes.searchButton];}
  showModal(){this.open=true;}
  close(){this.open=false;}
  remove(){current=null;}
 }
 const document={getElementById(){return current;},createElement(){return new Dialog();},body:{appendChild(d){current=d;}}};
 const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
 const window={CNPopup:{sync(){}}};
 const context=vm.createContext({window,document,sessionStorage:{getItem(k){return store.get(k)||null;},setItem(k,v){if(options.failStorage)throw Error('storage denied');store.set(k,v);}},crypto:options.crypto||crypto.webcrypto,Uint8Array,AbortController,setTimeout,clearTimeout,
  fetch:async(url,req={})=>{
   if(req.method==='POST'){const body=JSON.parse(req.body);posted.push(body);return options.post?options.post(body,response):response(receipt);}
   if(url==='/api/member/me')return response({member:state.member,plans:state.plans});
   if(url.startsWith('/api/demo/ticket-purchase'))return response(state);
   throw Error('Unexpected request: '+url);
  }});
 vm.runInContext(source,context);
 return {store,state,posted,get dialog(){return current;},hasPending:email=>window.CNTicketPurchase.hasPending(email),open:args=>window.CNTicketPurchase.open({planId:'p1',...args})};
}
(async()=>{
 // 応答待ちの連打・閉じる・成功後の再押下。画面更新失敗も再購入しない。
 let release;const a=harness({post:(body,response)=>new Promise(r=>{release=()=>r(response(receipt));})});
 await a.open({onSaved:async()=>{throw Error('list refresh failed');}});const d=a.dialog;
 const first=d.nodes.submit.emit('click');await tick();
 for(let i=0;i<20;i++)await d.nodes.submit.emit('click');eq(a.posted.length,1);
 await d.emit('cancel');eq(d.open,true,'送信中は外側タップ・Escで閉じない');
 release();await first;eq(d.nodes.submit.hidden,true);eq(d.nodes.submit.disabled,true);assert(d.nodes.status.textContent.includes('購入しました'));checks++;
 await d.nodes.submit.emit('click');eq(a.posted.length,1);eq(JSON.parse([...a.store.values()][0]),{});
 // 再読込後に販売停止でも、以前の購入キー・本人・券で結果を確認。
 const retryStore=new Map();const b=harness({store:retryStore,post:async()=>{throw Error('response lost');}});
 await b.open();await b.dialog.nodes.submit.emit('click');const original=b.posted[0];
 eq(original.expectedMember,member.email);eq(original.expectedCustomer,member.purchase_version);
 eq(b.dialog.nodes.submit.disabled,false);await b.dialog.nodes.bottomClose.emit('click');eq(b.dialog,null);
 const c=harness({store:retryStore,state:{plans:[]}});await c.open();
 eq(c.hasPending(member.email),true,'販売中の券がなくても再確認の入口を表示する');eq(c.hasPending('test-b@example.test'),false);
 eq(c.dialog.nodes.submit.disabled,false,'販売終了後も未確認の購入結果を確認できる');eq(c.dialog.nodes.submit.textContent,'購入結果を確認');
 await c.dialog.nodes.submit.emit('click');eq(c.posted[0],original);eq(c.dialog.nodes.submit.hidden,true);eq(c.hasPending(member.email),false);
 // 価格変更は購入せず選び直し。ログイン変更は再送情報を破棄しない。
 const changed=harness({post:async(_,response)=>response({error:'planChanged'},409)});await changed.open();await changed.dialog.nodes.submit.emit('click');
 eq(changed.dialog.nodes.submit.disabled,true);eq(JSON.parse([...changed.store.values()][0]),{});
 const switched=harness({post:async(_,response)=>response({error:'memberChanged'},409)});await switched.open();await switched.dialog.nodes.submit.emit('click');
 eq(switched.dialog.nodes.submit.disabled,true);eq(Object.keys(JSON.parse([...switched.store.values()][0])),['member:'+member.email]);assert(switched.dialog.nodes.status.textContent.includes('ログイン'));checks++;
 const other=harness({store:switched.store,state:{member:{...member,email:'test-b@example.test'}}});await other.open();eq(other.hasPending('test-b@example.test'),false);
 eq(other.dialog.nodes.status.textContent,'');eq(other.posted.length,0);
 // ブラウザの保存不可・破損では、再試行キーなしで送信しない。
 const denied=harness({failStorage:true});await denied.open();await denied.dialog.nodes.submit.emit('click');eq(denied.posted.length,0);assert(denied.dialog.nodes.status.textContent.includes('保存できません'));checks++;
 const broken=harness({store:new Map([['cn-ticket-pending-purchases','{broken']])});await broken.open();eq(broken.dialog.nodes.submit.disabled,true);eq(broken.posted.length,0);
 // HTTPの店内接続ではrandomUUIDがなくても、安全な乱数で購入番号を作る。
 const lan=harness({crypto:{getRandomValues:crypto.webcrypto.getRandomValues.bind(crypto.webcrypto)}});await lan.open();await lan.dialog.nodes.submit.emit('click');eq(lan.posted.length,1);assert(/^tp-[a-f0-9-]{32,36}$/.test(lan.posted[0].requestKey));checks++;
 console.log('PASS '+checks+' purchase UI checks: double click, closing while busy, lost response, retired plan, identity change, storage failure, LAN browser, refresh failure');
})().catch(error=>{console.error(error);process.exitCode=1;});
