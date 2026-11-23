'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.argv[2]||'');assert(process.argv[2]&&fs.existsSync(path.join(root,'safe-state.json')));
const gate=require(path.join(root,'booking-reception.js')),config=path.join(root,'data','booking-reception.json');
assert(!fs.existsSync(config),'検証用コピーだけで実行し、既存設定を上書きしない');
fs.mkdirSync(path.dirname(config),{recursive:true});let checks=0;const check=fn=>{fn();checks++;};
try{
 check(()=>assert(!gate.isSiteHidden()));
 fs.writeFileSync(config,JSON.stringify({paused:false,siteHidden:true}));
 check(()=>assert(gate.isSiteHidden()&&gate.isPaused(),'非公開中は設定にかかわらず新規予約も停止'));
 const routes=Object.keys(require(path.join(root,'routes.json'))).filter(p=>p.startsWith('/')&&!/^\/(admin|demo\/admin)/.test(p));
 for(const route of new Set([...routes.map(p=>p.split('?')[0]),'/cn-ueno-health-and-beauty','/%73taff','/staff/','/unknown','/_next/static/chunks/page.js','/_next/data/page.json','/api/bookings','/api/bookings/cancel','/api/member/me','/api/member/login','/api/tickets/plans','/api/tickets/purchase','/api/staff/list','/api/staff/photo','/api/availability','/api/demo/settings','/api/demo/staff-photo','/api/demo/course-photo','/api/live']))check(()=>assert(gate.hideRequest(route,false),route));
 for(const route of ['/admin','/admin/login','/admin/mails','/admin/customer','/demo/admin','/admin-original','/cnsalon-board','/%63nsalon-board','/api/demo/login','/api/demo/owner-verify','/api/demo/whoami','/api/demo/schedule','/api/booking-reception','/cn-i18n.js','/admin-header.css','/popup-behavior.css','/pm-clover.svg'])check(()=>assert(!gate.hideRequest(route,false),route));
 for(const route of ['/api/demo/settings','/api/demo/staff-photo','/api/tickets/plans','/api/staff/photo','/api/live','/_next/static/chunks/page.js','/images/staff.jpg'])check(()=>assert(!gate.hideRequest(route,true),route));
 for(const route of ['/','/staff','/book','/mypage','/menus'])check(()=>assert(gate.hideRequest(route,true),'ログイン中も予約サイトは非公開: '+route));
 fs.writeFileSync(config,JSON.stringify({paused:true,siteHidden:false}));check(()=>assert(!gate.isSiteHidden()&&gate.isPaused(),'公開再開と予約受付再開を分離'));
 fs.writeFileSync(config,'{bad');check(()=>assert(gate.isSiteHidden()&&gate.isPaused(),'設定不正で公開しない'));
 console.log(JSON.stringify({ok:true,checks}));
}finally{fs.rmSync(config,{force:true});}
