'use strict';
// 送信設定を除いた本番コピーで検査。サーバー・外部通信は起動しない。
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), crypto = require('node:crypto'), { EventEmitter } = require('node:events');
assert(process.argv[2], '送信無効の検証用コピーを指定してください');
const root = path.resolve(process.argv[2]), snapshotFile = path.join(root, 'safe-state.json');
assert(!fs.existsSync(path.join(root, 'mail-config.json')));
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(k)) delete process.env[k];
global.fetch = async () => { throw new Error('external network disabled'); };
const revive = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
const encode = v => JSON.stringify(v, (_, x) => x instanceof Map ? { __pm_map__: [...x] } : x instanceof Set ? { __pm_set__: [...x] } : x);
const sourceBytes = fs.readFileSync(snapshotFile), snapshot = JSON.parse(sourceBytes, revive);
assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && snapshot.state.mails.length === 0);
const persist = require(path.join(root, 'persist.js'));
persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot }); persist.startSaver = () => {}; persist.requestSave = () => {};
const file = path.join(root, 'demo-api.js'), code = fs.readFileSync(file, 'utf8');
const exportsForAudit = '\nmodule.exports.audit={state,courseStore,postSchedule,getStaffOrdering,publicStaffList,nominatableStaff,staffPickerDirectory,freeStaffIds,getAvailability,createPublicBooking,cancelBooking,findBooking,hpNotify,adminSessions,todayJst,addDays,minToMs};';
function load() { const mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(root); mod._compile(code + exportsForAudit, file); return mod; }
const mod = load(), order = require(path.join(root, 'staff-ordering.js'));
(async () => {
  await mod.exports.ready;
  const a = mod.exports.audit, state = a.state, date = a.addDays(a.todayJst(), 1), next = a.addDays(date, 1), course = '364323-4822701';
  const manager = { user: 'test-manager', role: 'manager', active: true }, worker = { user: 'test-worker', role: 'staff', active: true };
  const results = [], err = (status, code) => Object.assign(new Error(code), { status });
  function reset() {
    state.staff = ['A', 'B', 'C', 'D', 'E'].map((id, i) => ({ id, name: 'テスト担当' + id, active: 1, gender: 'male', courses: '[]',
      sort_order: 50 - i, listing_order: i + 1, profile_revision: 0,
      profile: JSON.stringify({ nickname: 'テスト表示' + id, message: 'テスト紹介', personalNomination: true, nominationFee: 500 }) }));
    state.photos = new Map(state.staff.map(s => [s.id, 'data:image/jpeg;base64,/9j/']));
    state.staffReconciliation = { version: 1 }; state.staffOrderingKeys = new Map();
    state.events = new Map(); state.days = new Map(); state.shifts = new Map(); state.bookingIndex = new Map(); state.requestKeys = new Map();
    state.hpKeys = new Map(); state.hpLog = []; state.tickets = new Map(); state.ticketUseByBooking = new Map(); state.members = new Map();
    state.mailRelay = { url: '', secret: '' }; state.mails = [];
    state.settings.freeMessage = { visible: true, required: false, maxLength: 2000 };
    state.settings.shopMaster.resStart = 600; state.settings.shopMaster.resEnd = 1560;
    for (let i = -1; i <= 8; i++) {
      const d = a.addDays(date, i); state.days.set(d, { version: 0, enabled: true }); state.events.set(d, { bookings: [], blocks: [], assignments: [] });
      state.shifts.set(d, state.staff.filter(s => (d === next ? ['A','D'] : ['B','C','E']).includes(s.id)).map(s => ({ staff_id: s.id, date: d,
        start_at: a.minToMs(d, 600), end_at: a.minToMs(d, 1620), note: '' })));
    }
    state.accounts.set(manager.user, manager); state.accounts.set(worker.user, worker);
    a.adminSessions.clear(); a.adminSessions.set('aaaa', { user: manager.user, created: Date.now() }); a.adminSessions.set('bbbb', { user: worker.user, created: Date.now() });
  }
  const staff = id => state.staff.find(s => s.id === id), ev = (d = date) => state.events.get(d);
  const protectedData = () => encode({ ...state, staffOrderingKeys: undefined,
    staff: state.staff.map(({ listing_order, ...s }) => s) });
  const body = (orders = state.staff.map(s => ({ id:s.id, listingOrder:6-s.listing_order }))) => ({ version:order.version(state), orders, requestKey:crypto.randomUUID() });
  const save = b => order.save(state, b || body(), manager, err);
  const reject = (b, expected) => { const before = encode(state); assert.throws(() => save(b), e => e.message === expected); assert.equal(encode(state),before); };
  const pubBody = (extra = {}) => ({ requestKey:crypto.randomUUID(), date, start:a.minToMs(date,720), course, people:1, staff:'none',
    name:'テスト掲載順予約', email:'ordering-test@example.test', phone:'0000000000', consent:true, ...extra });
  const pub = extra => a.createPublicBooking(pubBody(extra));
  const assigned = id => ev().assignments.filter(x => x.booking_id === id).map(x => x.staff_id);
  const ids = rows => rows.map(x => x.id);
  const api = (method, route, payload, role = 'manager') => {
    const req = new EventEmitter(); Object.assign(req, { method, headers:{cookie:role==='manager'?'pm_session=aaaa':role==='staff'?'pm_session=bbbb':''},
      socket:{remoteAddress:'127.0.0.1'}, destroy(){} });
    let status, data, headers; const res = new EventEmitter(); Object.assign(res, {setHeader(){}, writeHead(s,h){status=s;headers=h;}, end(raw){data=raw?JSON.parse(raw):null;this.emit('finish');}});
    assert(mod.exports.handleDemoApi(req,res,new URL(route,'http://localhost')));
    if(method==='POST'){req.emit('data',JSON.stringify(payload));req.emit('end');} return {status,data,headers};
  };
  async function check(name, run) { reset(); try { await run(); assert(state.mails.every(m=>!m.real)); results.push({name,ok:true}); }
    catch(e){results.push({name,ok:false,error:e.message.split('\n').slice(0,2).join(' ')});} }

  // 合成例だけでなく、コピーにある全登録ID・実際の勤務予定でも保存と表示の一致を検査する。
  try {
    const before=crypto.createHash('sha256').update(protectedData()).digest('hex');
    const rows=a.getStaffOrdering(date,manager).staff, orders=rows.map((s,i)=>({id:s.id,listingOrder:rows.length-i}));
    assert.equal(new Set(rows.map(s=>s.listingOrder)).size,rows.length);
    save(body(orders));
    assert.equal(crypto.createHash('sha256').update(protectedData()).digest('hex'),before);
    const registered=new Map(a.getStaffOrdering(date,manager).staff.map(s=>[s.id,s]));
    const listed=a.publicStaffList(date), working=order.workingIds(state.shifts,date);
    for(let i=0;i<listed.length;i++){
      const row=listed[i],stored=registered.get(row.id);assert(stored&&stored.listed);
      assert.equal(row.listingOrder,stored.listingOrder);assert.equal(row.name,stored.name);assert.equal(row.working,working.has(row.id));
      if(i){const prev=listed[i-1];assert(Number(prev.working)>=Number(row.working));if(prev.working===row.working)assert(prev.listingOrder<row.listingOrder);}
    }
    assert.equal(state.mails.length,0);results.push({name:'本番コピー全スタッフのID別No保存と実勤務優先表示を照合・予約等保持',ok:true});
  }catch(e){results.push({name:'本番コピー全スタッフ照合',ok:false,error:e.message.split('\n').slice(0,2).join(' ')});}

  await check('初回Noは既存管理順を保ち、二度目の初期化と名前変更で不変', () => {
    for(const s of state.staff)delete s.listing_order;
    const before=state.staff.map(s=>({...s}));order.initialize(state.staff);
    assert.deepEqual([...state.staff].sort(order.compare).map(s=>s.id),['E','D','C','B','A']);
    assert.deepEqual(state.staff.map(({listing_order,...s})=>s),before);
    const numbers=state.staff.map(s=>s.listing_order);staff('B').name='テスト改名';order.initialize(state.staff);
    assert.deepEqual(state.staff.map(s=>s.listing_order),numbers);
  });
  await check('旧番号の同値は保存済み配列順を保ち、追加スタッフだけ末尾に初期化', () => {
    state.staff.reverse();state.staff.forEach(s=>{delete s.listing_order;s.sort_order=0;});order.initialize(state.staff);
    assert.deepEqual(state.staff.map(s=>s.listing_order),[1,2,3,4,5]);
    assert.deepEqual([...state.staff].sort(order.compare).map(s=>s.id),['E','D','C','B','A']);
    state.staff.push({id:'F',name:'テスト追加',sort_order:0});order.initialize(state.staff);assert.equal(staff('F').listing_order,6);
  });
  await check('管理APIでNo一括保存し別の取得にも反映、他の記録は不変', () => {
    const before=protectedData(),get=api('GET','/api/demo/staff-ordering?date='+date);
    assert.equal(get.status,200);assert(get.data.canManage);assert.equal(get.headers['Cache-Control'],'no-store');
    const saved=api('POST','/api/demo/staff-ordering',body());assert.equal(saved.status,200);
    assert.equal(protectedData(),before);assert.deepEqual(ids(api('GET','/api/demo/staff-ordering?date='+date).data.staff),['E','D','C','B','A']);
  });
  await check('未ログイン・スタッフ権限の保存拒否、閲覧のみは可能', () => {
    const initial=state.staff.map(s=>s.listing_order);
    assert.equal(api('POST','/api/demo/staff-ordering',body(),'none').status,401);
    assert.equal(api('POST','/api/demo/staff-ordering',body(),'staff').status,403);
    assert.equal(api('GET','/api/demo/staff-ordering?date='+date,null,'staff').data.canManage,false);
    assert.deepEqual(state.staff.map(s=>s.listing_order),initial);
  });
  await check('No重複、非整数、0、負数、文字列、範囲外は全件無変更', () => {
    for(const n of [0,-1,1.5,'2',null,1000000]){const b=body();b.orders[0].listingOrder=n;reject(b,'staffOrderingInvalid');}
    const b=body();b.orders[0].listingOrder=b.orders[1].listingOrder;reject(b,'staffOrderingDuplicate');
  });
  await check('ID欠落・重複・未登録の保存では一部だけ更新しない', () => {
    let b=body();b.orders.pop();reject(b,'staffOrderingInvalid');
    b=body();b.orders[0].id='missing';reject(b,'staffOrderingInvalid');
    b=body();b.orders[0].id=b.orders[1].id;reject(b,'staffOrderingInvalid');
  });
  await check('読込後のNo変更・スタッフ追加・プロフィール変更を競合検出', () => {
    let b=body();save(body());reject(b,'staffOrderingConflict');
    b=body();state.staff.push({...staff('A'),id:'F',listing_order:6});reject(b,'staffOrderingConflict');
    b=body();staff('A').profile_revision++;reject(b,'staffOrderingConflict');
  });
  await check('通信再送は同一結果、同じキーの異なる内容は拒否', () => {
    const b=body(),r=save(b),after=encode(state);assert.deepEqual(save(b),r);assert.equal(encode(state),after);
    reject({...b,orders:[...b.orders].reverse()},'requestChanged');
  });
  await check('保存と再起動の往復でID別No・元管理順を保持', async () => {
    save();const before=state.staff.map(s=>[s.id,s.listing_order,s.sort_order]);
    const restored=JSON.parse(encode({state}),revive);persist.loadSnapshotWithRemote=async()=>({enabled:false,data:restored});
    const reload=load();await reload.exports.ready;assert.deepEqual(reload.exports.audit.state.staff.map(s=>[s.id,s.listing_order,s.sort_order]),before);
  });
  await check('勤務ありB/C/Eを先頭にし、非勤務A/Dは後、各群はNo順', () => {
    for(const list of [a.publicStaffList(date),a.nominatableStaff(course,'none',date),a.staffPickerDirectory(course,'none',date)]){
      assert.deepEqual(ids(list),['B','C','E','A','D']);assert.deepEqual(list.map(s=>s.working),[true,true,true,false,false]);
    }
  });
  await check('翌日の勤務A/Dへ切替、Noの値自体は不変', () => {
    assert.deepEqual(ids(a.publicStaffList(next)),['A','D','B','C','E']);assert.deepEqual(state.staff.map(s=>s.listing_order),[1,2,3,4,5]);
    const q=new URLSearchParams({date:next,course,people:'1',staff:'none'});assert.deepEqual(ids(a.getAvailability(q).staffDirectory),['A','D','B','C','E']);
  });
  await check('シフトの追加削除が次の取得へ即反映、GETで記録は不変', () => {
    state.shifts.get(date).push({...state.shifts.get(date)[0],staff_id:'A'});assert.equal(a.publicStaffList(date)[0].id,'A');
    state.shifts.set(date,state.shifts.get(date).filter(s=>s.staff_id!=='B'));const before=encode(state);
    assert.deepEqual(ids(a.publicStaffList(date)),['A','C','E','B','D']);assert.equal(encode(state),before);
  });
  await check('勤務ありでも日単位の鍵と店全体の停止はaccepting=falseで返す', () => {
    state.days.get(date).locked=['B'];
    for(const list of [a.publicStaffList(date),a.nominatableStaff(course,'none',date),a.staffPickerDirectory(course,'none',date)]){
      assert.equal(list.find(s=>s.id==='B').working,true);assert.equal(list.find(s=>s.id==='B').accepting,false);assert.equal(list.find(s=>s.id==='C').accepting,true);
    }
    state.days.get(date).enabled=false;assert(a.publicStaffList(date).every(s=>s.accepting===false));
    assert(a.publicStaffList(next).every(s=>s.accepting===true));
  });
  await check('公開APIは日付とNo・勤務状態を返し古いキャッシュを使わない', () => {
    for(const route of ['/api/staff/list?date='+date,'/api/staff?course='+course+'&date='+date]){
      const r=api('GET',route,null,'none');assert.equal(r.status,200);assert.equal(r.data.date,date);assert.equal(r.headers['Cache-Control'],'no-store');assert.deepEqual(ids(r.data.staff),['B','C','E','A','D']);
    }
    assert.equal(api('GET','/api/staff/list?date=2026-11-31',null,'none').status,400);
  });
  await check('管理一覧は未ログインへ公開せず、公開一覧へ内部情報を出さない', () => {
    const denied=api('GET','/api/demo/staff-ordering?date='+date,null,'none');assert.equal(denied.status,401);assert(!denied.data.staff);
    staff('B').profile=JSON.stringify({...JSON.parse(staff('B').profile),internalNote:'TEST-PRIVATE-NOTE',phone:'TEST-PRIVATE-PHONE'});
    const list=api('GET','/api/staff/list?date='+date,null,'none').data;
    assert(!JSON.stringify(list).includes('TEST-PRIVATE'));assert(!Object.hasOwn(list.staff[0],'registeredName'));assert(!Object.hasOwn(list,'version'));
  });
  await check('日本営業日の午前3時切替を用いUTC日付のずれを作らない', () => {
    assert.equal(a.todayJst(Date.parse('2026-10-23T02:59:00+09:00')),'2026-10-22');
    assert.equal(a.todayJst(Date.parse('2026-10-23T03:00:00+09:00')),'2026-10-23');
  });
  await check('指名なしは配列順や管理順に依存せず最上位の勤務担当へ', () => {
    state.staff.reverse();assert.deepEqual(a.freeStaffIds(date,720,780,course,'none'),['B','C','E']);
    const p=pub();assert.deepEqual(assigned(p.id),['B']);
  });
  await check('上位が予約済みなら次のNoへ、複数名も異なる担当を確保', () => {
    const first=pub();assert.deepEqual(assigned(first.id),['B']);
    const second=pub({people:2});assert.deepEqual(assigned(second.id),['C','E']);
    const before=encode(ev());assert.throws(()=>pub(),e=>e.message==='soldOut');assert.equal(encode(ev()),before);
  });
  await check('上位の休憩・業務・鍵・技能不一致・勤務不足を飛ばす', () => {
    for(const mode of ['break','work','locked','skill','short']){
      reset();if(mode==='break'||mode==='work')ev().blocks.push({id:'test-block',staff_id:'B',kind:mode,start_at:a.minToMs(date,700),end_at:a.minToMs(date,900)});
      if(mode==='locked')state.days.get(date).locked=['B'];
      if(mode==='skill')staff('B').courses='["unrelated"]';
      if(mode==='short')state.shifts.get(date).find(s=>s.staff_id==='B').end_at=a.minToMs(date,730);
      assert.deepEqual(assigned(pub().id),['C']);
    }
  });
  await check('順位が高くてもシフトなしの指名予約は成立させない', () => {
    const before=encode(ev());assert.throws(()=>pub({staffId:'A',expectedNominationFee:500}),e=>e.message==='soldOut');assert.equal(encode(ev()),before);
  });
  await check('指名は順位より指定本人を優先し指名料を保持', () => {
    const p=pub({staffId:'E',expectedNominationFee:500}),b=a.findBooking(p.id).bk;assert.deepEqual(assigned(p.id),['E']);assert.equal(b.nomination_fee,500);
  });
  await check('掲載No変更で確定済予約・シフト・金額・回数券・メールを変更しない', () => {
    pub({staffId:'E',expectedNominationFee:500});const before=protectedData();save();assert.equal(protectedData(),before);
  });
  await check('スタッフの通常編集と新規登録で設定済Noを保持', () => {
    const s=staff('B');a.postSchedule({action:'staff',date,id:s.id,name:'テスト改名',gender:s.gender,active:true,allCourses:true,profile:JSON.parse(s.profile),sortOrder:1,staffRevision:0},manager);
    assert.equal(staff('B').listing_order,2);const before=state.staff.map(s=>[s.id,s.listing_order]);
    a.postSchedule({action:'staff',date,id:'test-new',create:true,name:'テスト新規',gender:'male',active:false,allCourses:true,profile:{message:'テスト'},sortOrder:1},manager);
    assert.deepEqual(state.staff.slice(0,5).map(s=>[s.id,s.listing_order]),before);assert.equal(state.staff[5].listing_order,6);
  });
  await check('非公開や写真不足は順位にかかわらず公開しない', () => {
    staff('B').active=0;state.photos.delete('C');staff('E').profile=JSON.stringify({personalNomination:false,message:'テスト'});
    assert.deepEqual(ids(a.publicStaffList(date)),['A','D']);assert.equal(a.getStaffOrdering(date,manager).staff.length,5);
  });
  await check('複数勤務区間は実在する一つの区間内だけ受付、隙間をつなげない', () => {
    const sh=state.shifts.get(date).find(s=>s.staff_id==='B');sh.end_at=a.minToMs(date,660);
    state.shifts.get(date).push({...sh,start_at:a.minToMs(date,720),end_at:a.minToMs(date,900)});
    assert(a.freeStaffIds(date,720,780,course,'none').includes('B'));assert(!a.freeStaffIds(date,650,730,course,'none').includes('B'));
  });
  await check('深夜の前営業日予約と翌日勤務の実時刻重複をNoで突破しない', () => {
    const b=pub({start:a.minToMs(date,1440)});assert.deepEqual(assigned(b.id),['B']);
    state.shifts.get(next).push({staff_id:'B',date:next,start_at:a.minToMs(next,0),end_at:a.minToMs(next,180)});
    assert(a.publicStaffList(next).find(s=>s.id==='B').working);assert(!a.freeStaffIds(next,0,60,course,'none').includes('B'));
    assert(a.freeStaffIds(next,60,120,course,'none').includes('B'));
  });
  await check('連続コース予約の移動は上位でも2件目に未対応の担当を除外', () => {
    const other=[...a.courseStore.values()].find(c=>c.id!==course&&!/男性|女性/.test(c.name));assert(other);
    const p=pub({people:2}),bk=a.findBooking(p.id).bk,price=a.courseStore.get(course).price;
    bk.services=[course,other.id].map(courseId=>({courseId,price:price/2,minutesBefore:0,minutesBody:30,minutesAfter:0,discountType:'none',discount:0}));
    bk.bulk_discount_type='none';bk.bulk_discount=0;staff('C').courses=JSON.stringify([course]);
    a.postSchedule({action:'moveBooking',date,revision:state.days.get(date).version,id:p.id,staffId:'B',start:900,end:960,expect:{staffId:'B',start:720}},manager);
    assert.deepEqual(assigned(p.id),['B','E']);assert.equal(bk.total,price*2);
  });
  await check('HPの指名なし新規も掲載No優先、明示の指定本人は維持', () => {
    save();const menu=a.courseStore.get(course).name;
    const r=a.hpNotify({reservationId:'test-hp-order',date,start:720,minutes:60,price:1000,name:'テストHP',menu},'test');assert.equal(r.status,200);assert.deepEqual(assigned(r.json.id),['E']);
    const named=a.hpNotify({reservationId:'test-hp-named',date,start:900,minutes:60,price:1000,name:'テストHP指名',menu,staffName:'テスト表示B'},'test');assert.equal(named.status,200);assert.deepEqual(assigned(named.json.id),['B']);
  });
  await check('予約変更と取消は従来どおり、新Noで元担当を自動変更しない', () => {
    const member={email:'ordering-test@example.test',name:'テスト会員',bookings:[],tickets:[]},r=a.createPublicBooking(pubBody(),member);
    save();assert.deepEqual(assigned(r.id),['B']);
    const moved=a.createPublicBooking(pubBody({rescheduleId:r.id,start:a.minToMs(date,900)}),member);
    assert.equal(a.findBooking(r.id).bk.status,'cancelled');assert.deepEqual(assigned(moved.id),['E']);
    a.cancelBooking(a.findBooking(moved.id).bk,date);assert.equal(a.findBooking(moved.id).bk.status,'cancelled');assert.equal(ev().assignments.length,0);
  });
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(snapshotFile)).digest('hex'),crypto.createHash('sha256').update(sourceBytes).digest('hex'));
  const failed=results.filter(r=>!r.ok);console.log(JSON.stringify({checks:results.length,passed:results.length-failed.length,failed,network:false,realMail:false,sourceUnchanged:true},null,2));
  process.exit(failed.length?1:0);
})().catch(()=>{console.error('検査の準備に失敗しました（元データ・外部通信は変更していません）');process.exit(1);});
