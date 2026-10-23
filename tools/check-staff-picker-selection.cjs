'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
let passed=0;for(const file of ['NativeCalendar-pm2.js','NativeCalendar-Dk__jLyl.js']){
 const src=fs.readFileSync(path.join(__dirname,'../public/_next/static/chunks',file),'utf8');
 const match=src.match(/onSelect:e=>\{(.*?)\},onPreference:/);assert(match);const log=[];
 const ctx={U:x=>log.push(['select',x.staffId]),B:x=>log.push(['retain',x.name]),R:x=>log.push(['open',x]),window:{location:{assign(){throw Error('メニュー選択へ戻ってはいけません')}}}};
 vm.runInNewContext('this.select=e=>{'+match[1]+'}',ctx);
 for(const eligible of [true,false]){log.length=0;ctx.select({id:'test-staff',name:'テストスタッフ',working:true,accepting:true,nominatable:true,eligible});assert.deepEqual(log,[['select','test-staff'],['retain','テストスタッフ'],['open',false]]);passed++;}
 for(const flag of ['working','accepting','nominatable']){log.length=0;ctx.select({id:'test-staff',working:true,accepting:true,nominatable:true,[flag]:false});assert.equal(log.length,0);passed++;}
 assert(src.includes('X=Y??G?.staffDirectory?.find(e=>e.id===I)'));passed++;
 const notice=src.match(/children:\[(X\?\.eligible===!1.*?):n\.staffUnavailable,/);assert(notice);
 for(const translated of [false,true]){const message=vm.runInNewContext(notice[1]+':n.staffUnavailable',{X:{eligible:false},window:{CNI18N:translated?{t:x=>x}:undefined},n:{staffUnavailable:'旧案内'}});assert.equal(message,'このメニューは対応していません。予約枠は×になります。');passed++;}
 const expressions=src.match(/children:q\?`…`:n\?`×`:`－`/);assert(expressions,'空きなしは×のまま描画');passed++;
}
const ctx={window:{addEventListener(){},dispatchEvent(){}},document:{documentElement:{}},localStorage:{getItem(){return null}},setInterval(){}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/cn-i18n.js'),'utf8'),ctx);
const key='このメニューは対応していません。予約枠は×になります。';for(const lang of ctx.window.CNI18N.LANGS){ctx.window.CNI18N.use(lang);assert(ctx.window.CNI18N.has(key));assert(ctx.window.CNI18N.t(key).includes('×'));passed++;}
console.log(JSON.stringify({passed}));
