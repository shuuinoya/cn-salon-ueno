'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {config}=require('../lib/config.cjs');
const {createService}=require('../server.cjs');
const {allowed}=require('../lib/database.cjs');
const {build}=require('../build-runtime.cjs');
const {passwordHash,checkPassword}=require('../lib/security.cjs');
function request(port,host,route,method='GET',data,cookie='',origin){return new Promise((resolve,reject)=>{
  const body=data===undefined?null:JSON.stringify(data),req=http.request({host:'127.0.0.1',port,path:route,method,headers:{Host:host,...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{}),...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{Origin:origin||'http://'+host})}},res=>{let raw='';res.setEncoding('utf8');res.on('data',c=>raw+=c);res.on('end',()=>{let json;try{json=JSON.parse(raw);}catch{}resolve({status:res.statusCode,json,raw,cookie:res.headers['set-cookie']?.[0].split(';')[0]});});});req.on('error',reject);req.end(body);});}
test('店舗の開設、空データ、認証と保存先の分離、再起動、受付停止',async()=>{
  build(); const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reservation-test-'));
  const c=config({SERVICE_ORIGIN:'http://localhost:5619',SERVICE_DATA:dir});
  let svc=createService(c),port;
  const start=async()=>{await new Promise(resolve=>svc.server.listen(0,'127.0.0.1',resolve));port=svc.server.address().port;};
  await start();
  try{
    const reg=slug=>request(port,c.hostname,'/api/register','POST',{email:slug+'@example.test',password:'a-test-password-123',storeName:'テスト店舗 '+slug,slug,acceptTerms:true});
    const a=await reg('alpha'),b=await reg('bravo');assert.equal(a.status,201,a.raw);assert.equal(b.status,201,b.raw);
    const ma=await request(port,c.hostname,'/api/me','GET',undefined,a.cookie),mb=await request(port,c.hostname,'/api/me','GET',undefined,b.cookie);
    assert.equal(ma.json.stores.length,1);assert.notEqual(ma.json.stores[0].id,mb.json.stores[0].id);
    assert.equal((await request(port,c.hostname,'/api/stores/'+mb.json.stores[0].id+'/checkout','POST',{},a.cookie)).status,404);
    assert.equal((await request(port,'missing.localhost:5619','/')).status,404);
    assert.equal((await request(port,c.hostname,'/api/register','POST',{},'', 'https://evil.test')).status,403);
    const ah='alpha.localhost:5619',bh='bravo.localhost:5619';
    assert.equal((await request(port,ah,'/api/demo/schedule')).status,401);
    const al=await request(port,ah,'/api/demo/login','POST',{user:'owner',pass:'a-test-password-123'});
    assert.equal(al.status,200,al.raw);assert.ok(al.cookie);
    const bl=await request(port,bh,'/api/demo/login','POST',{user:'owner',pass:'a-test-password-123'});
    assert.equal(bl.status,200,bl.raw);
    assert.equal((await request(port,bh,'/api/demo/courses','GET',undefined,al.cookie)).status,401,'他店のログインを拒否');
    for(const [host,cookie]of [[ah,al.cookie],[bh,bl.cookie]]){
      const courses=await request(port,host,'/api/demo/courses','GET',undefined,cookie);assert.equal(courses.status,200,courses.raw);assert.deepEqual(courses.json.courses,[]);
      const schedule=await request(port,host,'/api/demo/schedule?date=2026-11-14','GET',undefined,cookie);assert.equal(schedule.status,200,schedule.raw);assert.deepEqual(schedule.json.staff,[]);assert.deepEqual(schedule.json.bookings,[]);
      const tickets=await request(port,host,'/api/tickets/plans');assert.equal(tickets.status,200);assert.ok(!tickets.raw.includes('tp-5'));
      const html=await request(port,host,'/book');assert.equal(html.status,200);assert.ok(html.raw.includes('window.__TENANT__'));assert.ok(!html.raw.includes('03-6806-0324'));assert.ok(!html.raw.includes('上野駅徒歩1分'));
    }
    const created=await request(port,ah,'/api/demo/courses','POST',{action:'create',name:'テスト専用メニュー',price:5500,minutes:60},al.cookie);assert.equal(created.status,200,created.raw);
    const cid=created.json.courses[0].id,day=new Date(Date.now()+7*86400000).toISOString().slice(0,10),sid='10000001-0000-4000-8000-000000000001';
    const staff=await request(port,ah,'/api/demo/schedule','POST',{action:'staff',date:day,id:sid,create:true,name:'テスト担当者',gender:'male',active:1,courses:[cid],profile:{personalNomination:true,nominationFee:0,message:'テスト専用の紹介'},photo:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='},al.cookie);assert.equal(staff.status,200,staff.raw);
    const booth=await request(port,ah,'/api/demo/booths','POST',{action:'saveBooth',expectedVersion:0,requestKey:'test-booth',booth:{name:'テスト室',shortName:'テスト室',capacity:1,active:true,online:true,male:true,female:true,color:'Green',sort:1}},al.cookie);assert.equal(booth.status,200,booth.raw);
    const assignment=await request(port,ah,'/api/demo/booths','POST',{action:'saveCourseBooths',expectedVersion:booth.json.version,requestKey:'test-booth-course',courseId:cid,boothIds:[booth.json.id]},al.cookie);assert.equal(assignment.status,200,assignment.raw);
    const before=await request(port,ah,'/api/demo/schedule?date='+day,'GET',undefined,al.cookie);
    const shift=await request(port,ah,'/api/demo/schedule','POST',{action:'shift',date:day,revision:before.json.days.find(d=>d.date===day).version,staffId:before.json.allStaff[0].id,start:600,end:1080},al.cookie);assert.equal(shift.status,200,shift.raw);
    const availability=await request(port,ah,'/api/availability?'+new URLSearchParams({course:cid,date:day,people:'1',staff:'none'}));assert.equal(availability.status,200,availability.raw);
    const slot=availability.json.days.find(d=>d.date===day)?.slots.find(s=>s.available);assert.ok(slot,'新しいメニュー・担当・ブースで予約枠を提供');
    const booking={requestKey:'test-reservation',course:cid,date:day,start:slot.start,people:1,staff:'none',name:'テスト予約者',email:'booking@example.test',phone:'00000000000',comment:'テスト検証',consent:true,language:'ja'};
    const booked=await request(port,ah,'/api/bookings','POST',booking);assert.equal(booked.status,200,booked.raw);assert.ok(booked.json.id);assert.ok(booked.json.token);
    const repeat=await request(port,ah,'/api/bookings','POST',booking);assert.equal(repeat.json.id,booked.json.id);
    const otherStore=await request(port,bh,'/api/bookings?id='+encodeURIComponent(booked.json.id)+'&token='+encodeURIComponent(booked.json.token));assert.equal(otherStore.status,404,'他店から予約を参照できない');
    assert.equal((await request(port,bh,'/api/demo/courses','GET',undefined,bl.cookie)).json.courses.length,0);
    assert.equal((await request(port,ah,'/api/demo/courses','POST',{action:'create',name:'テスト',price:100,minutes:60},al.cookie,'http://bravo.localhost:5619')).status,403);
    assert.equal((await request(port,c.hostname,'/api/stores/'+ma.json.stores[0].id+'/checkout','POST',{},a.cookie)).status,503,'決済未設定は課金しない');
    dbUpdate();
    function dbUpdate(){svc.db.prepare('UPDATE stores SET trial_end=? WHERE id=?').run(Date.now()-1000,ma.json.stores[0].id);}
    assert.equal((await request(port,ah,'/api/demo/courses','POST',{action:'create',name:'テスト停止',price:100,minutes:60},al.cookie)).status,402);
    assert.equal((await request(port,ah,'/api/demo/courses','GET',undefined,al.cookie)).status,200,'契約終了後も記録を読める');
    await svc.close();svc=createService(c);await start();
    const login=await request(port,ah,'/api/demo/login','POST',{user:'owner',pass:'a-test-password-123'});assert.equal(login.status,200,login.raw);
    const again=await request(port,ah,'/api/demo/courses','GET',undefined,login.cookie);assert.equal(again.json.courses[0].name,'テスト専用メニュー');
    c.maxWorkers=1;
    assert.equal((await request(port,bh,'/book')).status,200,'利用中でない店舗を保存して入れ替える');
    const resumed=await request(port,ah,'/api/demo/login','POST',{user:'owner',pass:'a-test-password-123'});assert.equal(resumed.status,200);
    const retained=await request(port,ah,'/api/demo/schedule?date='+day,'GET',undefined,resumed.cookie);assert.equal(retained.json.bookings[0].id,booked.json.id,'入れ替え後も予約を保持');
    assert.equal(svc.workers.items.size,1);
    for(const store of svc.db.prepare('SELECT id FROM stores').all()){
      const file=path.join(dir,'stores',store.id,'state.json');if(!fs.existsSync(file))continue;
      const raw=fs.readFileSync(file,'utf8');assert.ok(!raw.includes('cnsalon2021@gmail.com'));assert.ok(!raw.includes('GH_TOKEN'));assert.ok(!raw.includes('操作確認 テスト'));
      assert.equal(fs.statSync(file).mode & 0o777,0o600);
    }
  }finally{await svc.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('パスワードと期限の判定',async()=>{
  const a=await passwordHash('strong test password'),b=await passwordHash('strong test password');assert.notEqual(a,b);assert.ok(await checkPassword('strong test password',a));assert.equal(await checkPassword('wrong',a),false);
  assert.equal(allowed({status:'trial',trial_end:101},100),true);assert.equal(allowed({status:'trial',trial_end:100},100),false);
  assert.equal(allowed({status:'active',paid_until:101},100),true);assert.equal(allowed({status:'past_due',paid_until:101},100),false);
});
