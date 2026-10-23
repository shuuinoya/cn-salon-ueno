'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {romanizeKana,staffLatinName}=require('../staff-names');
let checks=0;const eq=(a,b)=>{assert.equal(a,b);checks++;};
for(const [kana,latin]of Object.entries({'オオミズ':'Oomizu','ｺﾊﾞﾔｼ ﾌｳﾔ':'Kobayashi Fuuya','スギた ユウヤ':'Sugita Yuuya','ショウジ':'Shouji','ジュンイチ':"Jun'ichi",'ハットリ':'Hattori','マッチ':'Matchi','ジョージ':'Jooji','ティム':'Timu','シェリー':'Sherii','名前':'','': ''}))eq(romanizeKana(kana),latin);
eq(staffLatinName({name:'大水寛'},{nickname:'大水',familyName:'大水',familyKana:'オオミズ',givenKana:'ヒロシ'}),'Oomizu');
eq(staffLatinName({name:'テスト花子'},{familyKana:'テスト',givenKana:'ハナコ'}),'Tesuto Hanako');
eq(staffLatinName({name:'表示名'},{familyKana:'トウロク',givenKana:'ヨミ'}),'Touroku Yomi');
eq(staffLatinName({name:'未登録'},{}),'');
eq(staffLatinName({name:'Marie'},{}),'Marie');
const ctx={window:{addEventListener(){},dispatchEvent(){}},localStorage:{getItem(){return null}},document:{documentElement:{}},setInterval(){}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/cn-i18n.js'),'utf8'),ctx);
for(const lang of ctx.window.CNI18N.LANGS){ctx.window.CNI18N.use(lang);eq(ctx.window.CNI18N.staffName({name:'大水',nameLatin:'Oomizu'}),lang==='ja'?'大水':'Oomizu');for(const key of ['勤務日を選択','予約日','予約日を選択','前の月','次の月','今日','閉じる']){assert(ctx.window.CNI18N.has(key));checks++;}}
ctx.window.CNI18N.use('ja');
for(const [language,label]of Object.entries({ja:'予約日',en:'Appointment date',zh:'预约日期',ko:'예약일',fr:'Date du rendez-vous',es:'Fecha de la cita',it:'Data dell’appuntamento',de:'Termindatum'}))eq(ctx.window.CNI18N.t('予約日',undefined,language),label);
eq(ctx.window.CNI18N.lang(),'ja'); // 部品の表示言語の指定で、ほかの画面の言語を変えない。
const cal={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/staff-calendar.js'),'utf8').replace('window.CNStaffCalendar = { mount }','window.CNStaffCalendar = { mount, add, month }'),cal);
eq(cal.window.CNStaffCalendar.add('2028-02-28',1),'2028-02-29');eq(cal.window.CNStaffCalendar.add('2027-02-28',1),'2027-03-01');eq(cal.window.CNStaffCalendar.add('2026-10-23',84),'2027-01-15');eq(cal.window.CNStaffCalendar.month('2026-12-31',1),'2027-01-01');
if(process.argv[2]){
 const raw=fs.readFileSync(process.argv[2]),snapshot=JSON.parse(raw);assert.deepEqual(snapshot.state.mailRelay,{});eq(snapshot.state.mails.length,0);
 const active=snapshot.state.staff.filter(s=>s.active===1);
 for(const staff of active){const pr=JSON.parse(staff.profile||'{}'),name=staffLatinName(staff,pr);assert(/^[A-Za-z][A-Za-z '\-]*$/.test(name),'読みを確認: '+staff.id);checks++;}
 console.log(JSON.stringify({registeredStaff:active.length,latinNames:active.length}));
}
console.log(JSON.stringify({passed:checks}));
