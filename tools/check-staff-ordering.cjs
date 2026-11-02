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
const exportsForAudit = '\nmodule.exports.audit={state,courseStore,postSchedule,getSchedule,getStaffOrdering,publicStaffList,nominationOf,nominatableStaff,staffPickerDirectory,freeStaffIds,getAvailability,createPublicBooking,cancelBooking,findBooking,hpNotify,adminSessions,todayJst,addDays,minToMs};';
function load() { const mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(root); mod._compile(code + exportsForAudit, file); return mod; }
const mod = load(), order = require(path.join(root, 'staff-ordering.js'));
(async () => {
  await mod.exports.ready;
  const a = mod.exports.audit, state = a.state, date = a.addDays(a.todayJst(), 1), next = a.addDays(date, 1), course = '364323-4822701';
  const manager = { user: 'test-manager', role: 'manager', active: true }, worker = { user: 'test-worker', role: 'staff', active: true };
  const results = [], err = (status, code) => Object.assign(new Error(code), { status });
  function reset() {
    state.staff = ['A', 'B', 'C', 'D', 'E'].map((id, i) => ({ id, name: 'テスト担当' + id, active: 1, gender: 'male', courses: '[]',
      sort_order: i + 1, listing_order: i + 1, profile_revision: 0,
      profile: JSON.stringify({ nickname: 'テスト表示' + id, message: 'テスト紹介', personalNomination: true, nominationFee: 500 }) }));
    state.photos = new Map(state.staff.map(s => [s.id, 'data:image/jpeg;base64,/9j/']));
    state.staffReconciliation = { version: 1 }; state.staffOrderingKeys = new Map(); state.staffListingDays = new Map(); state.staffListingDailyVersion = 1; state.staffSkillCatalog = null; state.staffSkillKeys = new Map();
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
  const protectedData = () => encode({ ...state, staffOrderingKeys: undefined, staffListingDays: undefined });
  const body = (orders = state.staff.map(s => ({ id:s.id, listingOrder:6-s.listing_order }))) => ({ date, version:order.version(state,date), orders, requestKey:crypto.randomUUID() });
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
      const row=listed[i],stored=registered.get(row.id);assert(stored&&stored.listed&&stored.working);assert(working.has(row.id));
      assert.equal(row.listingOrder,stored.listingOrder);assert.equal(row.name,stored.name);assert.equal(row.working,working.has(row.id));
      if(i){const prev=listed[i-1];assert(Number(prev.working)>=Number(row.working));if(prev.working===row.working)assert(prev.listingOrder<row.listingOrder);}
    }
    assert.equal(state.mails.length,0);results.push({name:'本番コピー全スタッフのID別No保存と勤務者だけの掲載を照合・予約等保持',ok:true});
  }catch(e){results.push({name:'本番コピー全スタッフ照合',ok:false,error:e.message.split('\n').slice(0,2).join(' ')});}

  await check('初回Noは既存管理順を保ち、二度目の初期化と名前変更で不変', () => {
    for(const [i,s] of state.staff.entries()){delete s.listing_order;s.sort_order=50-i;}
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
    save();const before=state.staff.map(s=>[s.id,s.listing_order,s.sort_order]), daily=encode(state.staffListingDays);
    const restored=JSON.parse(encode({state}),revive);persist.loadSnapshotWithRemote=async()=>({enabled:false,data:restored});
    const reload=load();await reload.exports.ready;assert.deepEqual(reload.exports.audit.state.staff.map(s=>[s.id,s.listing_order,s.sort_order]),before);assert.equal(encode(reload.exports.audit.state.staffListingDays),daily);assert.deepEqual(ids(reload.exports.audit.getStaffOrdering(date,manager).staff),['E','D','C','B','A']);
  });
  await check('当日だけ並べ替え、翌日はその日の勤務者をシフト順に戻す', () => {
    const ledger=ids(a.getSchedule(date).staff), shifts=encode(state.shifts), staffBefore=encode(state.staff);
    save();assert.deepEqual(ids(a.publicStaffList(date)),['E','C','B']);
    assert.deepEqual(ids(a.publicStaffList(next)),['A','D']);
    assert.deepEqual(ids(a.getSchedule(date).staff),ledger);assert.equal(encode(state.shifts),shifts);assert.equal(encode(state.staff),staffBefore);
    assert.equal(a.getStaffOrdering(date,manager).custom,true);assert.equal(a.getStaffOrdering(next,manager).custom,false);
  });
  await check('別の日を並べ替えても当日の設定と取得版は変わらない', () => {
    const b=body(), v=order.version(state,date), tomorrow={...body(),date:next,version:order.version(state,next)};
    save(tomorrow);assert.equal(order.version(state,date),v);save(b);
    assert.deepEqual(ids(a.publicStaffList(next)),['D','A']);assert.deepEqual(ids(a.publicStaffList(date)),['E','C','B']);
  });
  await check('前日から開いた未保存の入力は翌日へ適用せず拒否', () => {
    const before=encode(state),b=body();
    assert.throws(()=>order.save(state,b,manager,err,next),e=>e.message==='staffOrderingDayChanged');assert.equal(encode(state),before);
  });
  await check('前日に保存済みの再送結果だけ確認し翌日は変えない', () => {
    const b=body(),r=save(b),before=encode(state);
    assert.deepEqual(order.save(state,b,manager,err,next),r);assert.equal(encode(state),before);
    reject({...b,date:next},'requestChanged');assert.equal(state.staffListingDays.has(next),false);
  });
  await check('日付なしの旧画面や実在しない日付を拒否する', () => {
    for(const date of [undefined,'2026-02-30','2026-13-01','2026-10-23T00:00:00Z'])reject({...body(),date},'staffOrderingDateRequired');
  });
  await check('シフト順・勤務時間が読込後に変わった場合は保存を拒否', () => {
    let b=body();staff('B').sort_order=99;reject(b,'staffOrderingConflict');
    b=body();state.shifts.get(date)[0].end_at-=60000;reject(b,'staffOrderingConflict');
  });
  await check('元のシフト順が同順位でも登録配列順をそのまま表示', () => {
    state.staff.reverse();state.staff.forEach(s=>s.sort_order=0);
    assert.deepEqual(ids(a.getStaffOrdering(date,manager).staff),['E','D','C','B','A']);
    assert.deepEqual(ids(a.getSchedule(date).staff),['E','C','B','D','A']);
  });
  await check('豊・大水はIDで先頭固定、月内出勤日数順・無勤務は後方、重複勤務は1日', () => {
    const top = ['10000001-0000-4000-8000-000000000001', '10000018-0000-4000-8000-000010000018'];
    state.staff.push(...top.map((id, i) => ({ ...staff('A'), id, name: 'テスト改名済み' + i, sort_order: 100 + i })));
    state.staff.push({ ...staff('A'), id: 'M', name: 'テスト松野', sort_order: 0 });
    state.shifts.get(date).push({ ...state.shifts.get(date)[0] });
    a.getSchedule(date);
    const before = encode(state), view = a.getSchedule(date);
    assert.deepEqual(ids(view.allStaff), [...top, 'B', 'C', 'E', 'A', 'D', 'M']);
    assert(view.allStaff.find(s => s.id === 'B').month_work_days > view.allStaff.find(s => s.id === 'A').month_work_days);
    assert.equal(order.adminView(state, date).counts.get('B'), 9);
    assert.equal(view.allStaff.at(-1).month_work_days, 0);
    assert.equal(encode(state), before);
    const other = '2027-08-01';
    state.shifts.set(other, [{ staff_id: 'M', date: other, start_at: a.minToMs(other, 600), end_at: a.minToMs(other, 1200) }]);
    assert.deepEqual(ids(order.adminView(state, other).staff), [...top, 'M', 'A', 'B', 'C', 'D', 'E']);
    assert.deepEqual(ids(a.publicStaffList(date)), ['B', 'C', 'E']);
  });
  await check('スタッフ編集で全体版を更新し、表示名・写真・スキル・指名料を全画面へ反映', () => {
    const before = a.getSchedule(date), shifts = encode(state.shifts), s = staff('B');
    const originalPhoto = a.publicStaffList(date).find(s => s.id === 'B').photo;
    const edit = { action:'staff',date,id:s.id,name:'テスト登録改名',gender:'male',active:true,allCourses:false,courses:[course],
      profile:{nickname:'テスト表示改名',personalNomination:true,nominationFee:1200},sortOrder:s.sort_order,staffRevision:0,photo:'data:image/jpeg;base64,dGVzdA==' };
    a.postSchedule(edit, manager);
    const after = a.getSchedule(date), pub = a.publicStaffList(date).find(s => s.id === 'B');
    assert.notEqual(after.syncVersion, before.syncVersion);
    assert.equal(after.days.find(d=>d.date===date).version, before.days.find(d=>d.date===date).version);
    assert.equal(after.staff.find(s=>s.id==='B').name,'テスト表示改名');
    assert.equal(after.allStaff.find(s=>s.id==='B').name,'テスト登録改名');
    assert.equal(pub.name,'テスト表示改名'); assert.equal(pub.nominationFee,1200); assert.notEqual(pub.photo,originalPhoto);
    assert.equal(a.nominationOf('B').name,'テスト表示改名');
    const av = a.getAvailability(new URLSearchParams({date,course,people:'1',staff:'none',staffId:'B'}));
    assert.equal(av.nomination.nominationFee,1200);assert(av.days[0].slots.some(s=>s.minute===720&&s.available));
    const otherCourse = [...a.courseStore.values()].find(c=>c.id!==course && !/女性|男性/.test(c.name));
    assert(!a.freeStaffIds(date,720,780,otherCourse.id,'none').includes('B'));
    assert.equal(encode(state.shifts),shifts);
    assert.throws(()=>a.postSchedule(edit,manager), e=>e.message==='staffChanged');
  });
  await check('旧全日共通の手動順は移行当日だけ保護し翌日へ持ち越さない', () => {
    state.staffListingDailyVersion=0;state.staff.forEach((s,i)=>s.listing_order=5-i);
    const before=encode(state.staff);order.migrate(state,date);
    assert.equal(encode(state.staff),before);assert.deepEqual(ids(a.publicStaffList(date)),['E','C','B']);
    assert.deepEqual(ids(a.publicStaffList(next)),['A','D']);const saved=encode(state.staffListingDays);
    order.migrate(state,next);assert.equal(encode(state.staffListingDays),saved);assert.equal(state.staffListingDays.has(next),false);
  });
  await check('当日並べ替え後の追加登録は末尾、翌日は登録されたシフト順', () => {
    save();state.staff.push({...staff('A'),id:'F',sort_order:0,listing_order:6});
    assert.equal(a.getStaffOrdering(date,manager).staff.at(-1).id,'F');
    assert.equal(a.getStaffOrdering(next,manager).staff[0].id,'F');
    state.staff=state.staff.filter(s=>s.id!=='C');assert(!a.getStaffOrdering(date,manager).staff.some(s=>s.id==='C'));
  });
  await check('勤務ありB/C/Eだけを掲載No順に公開し、非勤務A/Dは載せない', () => {
    for(const list of [a.publicStaffList(date),a.nominatableStaff(course,'none',date),a.staffPickerDirectory(course,'none',date)]){
      assert.deepEqual(ids(list),['B','C','E']);assert.deepEqual(list.map(s=>s.working),[true,true,true]);
    }
  });
  await check('翌日の勤務A/Dへ切替、Noの値自体は不変', () => {
    assert.deepEqual(ids(a.publicStaffList(next)),['A','D']);assert.deepEqual(state.staff.map(s=>s.listing_order),[1,2,3,4,5]);
    const q=new URLSearchParams({date:next,course,people:'1',staff:'none'});assert.deepEqual(ids(a.getAvailability(q).staffDirectory),['A','D']);
  });
  await check('シフトの追加削除が次の取得へ即反映、GETで記録は不変', () => {
    state.shifts.get(date).push({...state.shifts.get(date)[0],staff_id:'A'});assert.equal(a.publicStaffList(date)[0].id,'A');
    state.shifts.set(date,state.shifts.get(date).filter(s=>s.staff_id!=='B'));const before=encode(state);
    assert.deepEqual(ids(a.publicStaffList(date)),['A','C','E']);assert.equal(encode(state),before);
  });
  await check('勤務なしも管理画面で情報と順位を編集でき、シフト登録後だけ掲載', () => {
    assert.deepEqual(ids(a.getStaffOrdering(date,manager).staff),['A','B','C','D','E']);
    assert.deepEqual(new Set(ids(a.getSchedule(date).allStaff)),new Set(['A','B','C','D','E']));
    const s=staff('A');a.postSchedule({action:'staff',date,id:s.id,name:'テスト休み編集',gender:s.gender,active:true,allCourses:true,profile:JSON.parse(s.profile),sortOrder:1,staffRevision:0},manager);
    save();assert(!a.publicStaffList(date).some(s=>s.id==='A'));assert.equal(staff('A').name,'テスト休み編集');
    a.postSchedule({action:'shift',date,revision:state.days.get(date).version,staffId:'A',start:600,end:1320},manager);
    assert.deepEqual(ids(a.publicStaffList(date)),['E','C','B','A']);
    assert.equal(a.getStaffOrdering(date,manager).staff.length,5);
  });
  await check('全員休み・不正な勤務時間・未登録のシフトで架空の掲載を作らない', () => {
    state.shifts.set(date,[]);assert.equal(a.publicStaffList(date).length,0);assert.equal(a.staffPickerDirectory(course,'none',date).length,0);
    state.shifts.set(date,[{staff_id:'A',date,start_at:100,end_at:100},{staff_id:'B',date,start_at:200,end_at:100},{staff_id:'C',date,start_at:NaN,end_at:300},{staff_id:'missing',date,start_at:100,end_at:200}]);
    assert.equal(a.publicStaffList(date).length,0);assert.equal(a.getStaffOrdering(date,manager).staff.length,5);
  });
  await check('重複シフトでも同じスタッフのカードは1枚、順位保存は勤務者内へ反映', () => {
    state.shifts.get(date).push({...state.shifts.get(date)[0]});save();
    for(const list of [a.publicStaffList(date),a.nominatableStaff(course,'none',date),a.staffPickerDirectory(course,'none',date)])assert.deepEqual(ids(list),['E','C','B']);
  });
  await check('今日が休みでも別日の指名を受け付け、週先頭の休みで翌日の枠を消さない', () => {
    state.shifts.set(a.todayJst(),[]);
    const week=a.getAvailability(new URLSearchParams({date,course,people:'1',staff:'none',staffId:'A'}));
    assert.equal(week.nomination.id,'A');assert(!week.staff.some(s=>s.id==='A'));assert(!week.staffDirectory.some(s=>s.id==='A'));
    assert(!week.days[0].slots.some(s=>s.available));assert(week.days[1].slots.some(s=>s.available));
    const p=pub({date:next,start:a.minToMs(next,720),staffId:'A',expectedNominationFee:500});
    assert.deepEqual(ev(next).assignments.filter(x=>x.booking_id===p.id).map(x=>x.staff_id),['A']);
    staff('A').active=0;const stopped=a.getAvailability(new URLSearchParams({date,course,people:'1',staff:'none',staffId:'A'}));
    assert.equal(stopped.nomination,null);assert(!stopped.days.some(d=>d.slots.some(s=>s.available)));
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
      const r=api('GET',route,null,'none');assert.equal(r.status,200);assert.equal(r.data.date,date);assert.equal(r.headers['Cache-Control'],'no-store');assert.deepEqual(ids(r.data.staff),['B','C','E']);
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
    const second=pub({people:2,companionNames:['テスト同行者']});assert.deepEqual(assigned(second.id),['C','E']);
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
    const before=encode(ev());assert.throws(()=>pub({staffId:'A',expectedNominationFee:500}),e=>e.message==='staffUnavailable');assert.equal(encode(ev()),before);
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
  await check('受付停止・写真不足・指名オフも当日の勤務者として掲載し、指名受付とは分ける', () => {
    staff('B').active=0;state.photos.delete('C');staff('E').profile=JSON.stringify({personalNomination:false,message:'テスト'});
    for(const rows of [a.publicStaffList(date),a.staffPickerDirectory(course,'none',date)]){
      assert.deepEqual(ids(rows),['B','C','E']);assert.equal(rows.find(s=>s.id==='C').nominatable,true);assert(rows.filter(s=>s.id!=='C').every(s=>s.nominatable===false));
    }
    assert.deepEqual(ids(a.nominatableStaff(course,'none',date)),['C']);
    for(const id of ['B','E'])assert.equal(a.nominationOf(id,date),null);
    assert.equal(a.nominationOf('C',date).id,'C');
    for(const id of ['B','E']){
      const before=encode(ev());assert.throws(()=>pub({staffId:id,expectedNominationFee:500}));assert.equal(encode(ev()),before);
    }
    assert.equal(a.getStaffOrdering(date,manager).staff.length,5);
  });
  await check('写真と紹介文が未入力でも対応メニューを指名予約でき、日時変更後も二重予約を拒否', () => {
    state.photos.delete('B');staff('B').profile=JSON.stringify({personalNomination:true,nominationFee:500,message:''});
    assert(a.publicStaffList(date).find(s=>s.id==='B').nominatable);
    const available=a.getAvailability(new URLSearchParams({date,course,people:'1',staff:'none',staffId:'B'}));
    assert.equal(available.nomination.id,'B');assert(available.days[0].slots.some(s=>s.minute===720&&s.available));
    const p=pub({staffId:'B',expectedNominationFee:500});assert.deepEqual(assigned(p.id),['B']);
    a.postSchedule({action:'moveBooking',date,revision:state.days.get(date).version,id:p.id,staffId:'B',start:900,end:960,confirmNominationMove:true,expect:{staffId:'B',start:720}},manager);
    const before=encode(ev());assert.throws(()=>pub({staffId:'B',expectedNominationFee:500,start:a.minToMs(date,900)}));assert.equal(encode(ev()),before);
    staff('B').courses='invalid';assert.equal(a.publicStaffList(date).find(s=>s.id==='B').nominatable,false);
  });
  await check('勤務前後・終日の業務と休憩・ブロックでも紹介に残し、勤務外や重複予約は拒否', () => {
    for(const kind of ['work','break','block']){
      reset();ev().blocks.push({id:'test-full-block',staff_id:'B',kind,start_at:a.minToMs(date,600),end_at:a.minToMs(date,1620)});
      assert.deepEqual(ids(a.publicStaffList(date)),['B','C','E']);
      assert(a.staffPickerDirectory(course,'none',date).some(s=>s.id==='B'));
      assert(!a.freeStaffIds(date,720,780,course,'none').includes('B'));
      const before=encode(ev());assert.throws(()=>pub({staffId:'B',expectedNominationFee:500}));assert.equal(encode(ev()),before);
    }
    reset();for(const start of [540,1620]){const before=encode(ev());assert.throws(()=>pub({staffId:'B',start:a.minToMs(date,start),expectedNominationFee:500}));assert.equal(encode(ev()),before);}
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
    const p=pub({people:2,companionNames:['テスト同行者']}),bk=a.findBooking(p.id).bk,price=a.courseStore.get(course).price;
    bk.services=[course,other.id].map(courseId=>({courseId,price:price/2,minutesBefore:0,minutesBody:30,minutesAfter:0,discountType:'none',discount:0}));
    bk.bulk_discount_type='none';bk.bulk_discount=0;staff('C').courses=JSON.stringify([course]);
    a.postSchedule({action:'moveBooking',date,revision:state.days.get(date).version,id:p.id,staffId:'B',start:900,end:960,confirmNominationMove:true,expect:{staffId:'B',start:720}},manager);
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
