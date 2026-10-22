'use strict';
// 送信無効の本番コピーで実際の予約/API処理をメモリ内検査。HTTPサーバーや外部決済は起動しない。
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
assert(process.argv[2]); const root = path.resolve(process.argv[2]); assert(!fs.existsSync(path.join(root, 'mail-config.json')));
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(k)) delete process.env[k];
const revive = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json'), 'utf8'), revive);
assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && !snapshot.state.mails.length);
const persist = require(path.join(root, 'persist.js')); persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot }); persist.startSaver = () => {};
const file = path.join(root, 'demo-api.js'), mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,courseStore,postSchedule,getSchedule,ledgerContext,createPublicBooking,getAvailability,hpNotify,adminSessions,bookingDetailsContext,bookingMismatch,bookingPriceLines,bookingRemindBody,bookingCustomerBody,resendFailedMail,applyMailTemplate};', file);
const ops = require(path.join(root, 'ledger-operations.js')), policy = require(path.join(root, 'booth-policy.js'));
const encode = v => JSON.stringify(v, (_, x) => x instanceof Map ? { __pm_map__: [...x] } : x instanceof Set ? { __pm_set__: [...x] } : x);
(async () => {
  await mod.exports.ready;
  const a = mod.exports.audit, { state } = a, c = a.ledgerContext(), date = c.addDays(c.todayJst(), 1), next = c.addDays(date, 1), course = '364323-4822701';
  const courses = [...a.courseStore.values()].map(x => ({ ...x })), manager = { user: 'test-manager', role: 'manager', active: true }, staff = { user: 'test-staff', role: 'staff', active: true };
  const results = [], first = '109902', second = '109903';
  function reset() {
    state.events = new Map(); state.days = new Map(); state.shifts = new Map(); state.bookingIndex = new Map(); state.requestKeys = new Map(); state.hpKeys = new Map(); state.hpLog = [];
    state.bookingDetailsKeys = new Map(); state.tickets = new Map(); state.ticketUseByBooking = new Map(); state.mails = []; state.mailRelay = { url: '', secret: '' }; state.ledger = ops.createState(); state.reports = new Map();
    state.booths = policy.sourceDefaults().booths.map(b => ({ ...b, active: true })); state.boothRevision = 0; state.boothRequestKeys = new Map();
    state.staffReconciliation = { version: 1 }; state.staff = ['A', 'B', 'C', 'D', 'E'].map(id => ({ id, name: 'テスト担当' + id, active: 1, gender: 'male', courses: '[]', sort_order: id.charCodeAt(0), profile: JSON.stringify({ message: 'テスト紹介', personalNomination: true, nominationFee: 500 }) }));
    state.photos = new Map(state.staff.map(s => [s.id, 'data:image/jpeg;base64,/9j/']));
    state.settings.freeMessage = { visible: true, required: false, maxLength: 2000 }; state.settings.shopMaster.resStart = 600; state.settings.shopMaster.resEnd = 1560;
    a.courseStore.clear(); for (const x of courses) a.courseStore.set(x.id, { ...x }); state.courses = null;
    for (const d of [date, next]) {
      state.days.set(d, { version: 0, enabled: true }); state.events.set(d, { bookings: [], blocks: [], assignments: [] });
      state.shifts.set(d, state.staff.map(s => ({ staff_id: s.id, date: d, start_at: c.minToMs(d, d === next ? 0 : 600), end_at: c.minToMs(d, 1620), note: '' })));
    }
    state.accounts.set(manager.user, manager); state.accounts.set(staff.user, staff);
    a.adminSessions.clear(); a.adminSessions.set('aaaa', { user: manager.user, created: Date.now() }); a.adminSessions.set('bbbb', { user: staff.user, created: Date.now() });
  }
  const ev = (d = date) => state.events.get(d), booking = (id, d = date) => ev(d).bookings.find(x => x.id === id);
  const pub = (extra = {}) => a.createPublicBooking({ requestKey: require('node:crypto').randomUUID(), date, start: c.minToMs(date, 720), course, people: 1, staff: 'none', staffId: 'A', expectedNominationFee: 500, name: 'テスト予約', email: 'booth-test@example.test', phone: '0000000000', consent: true, ...extra });
  const schedule = extra => a.postSchedule({ date, revision: state.days.get(extra.date || date)?.version || 0, ...extra }, manager);
  const unchanged = (fn, code) => { const before = encode({ state, courses: [...a.courseStore] }); assert.throws(fn, e => e.message === code); assert(encode({ state, courses: [...a.courseStore] }) === before, '拒否時に元記録が変化'); };
  const api = (method, route, body, role = 'manager') => {
    const req = new EventEmitter(); Object.assign(req, { method, headers: { cookie: role === 'manager' ? 'pm_session=aaaa' : role === 'staff' ? 'pm_session=bbbb' : '' }, socket: { remoteAddress: '127.0.0.1' }, destroy() {} });
    let status, data; const res = new EventEmitter(); Object.assign(res, { setHeader() {}, writeHead(code) { status = code; }, end(raw) { data = raw ? JSON.parse(raw) : null; this.emit('finish'); } });
    assert(mod.exports.handleDemoApi(req, res, new URL(route, 'http://localhost'))); if (method === 'POST') { req.emit('data', JSON.stringify(body)); req.emit('end'); }
    return { status, data };
  };
  const boothPost = (body, role = 'manager') => api('POST', '/api/demo/booths', { expectedVersion: state.boothRevision, requestKey: require('node:crypto').randomUUID(), ...body }, role);
  const details = require(path.join(root, 'booking-details.js')), dc = a.bookingDetailsContext();
  const service = (id = course, extra = {}) => { const x = a.courseStore.get(id); return { courseId: id, expectedPrice: x.price, minutesBefore: 0, minutesBody: x.minutes, minutesAfter: 0, discountType: 'none', discount: 0, ...extra }; };
  const get = id => details.get(state, { date, ...(id ? {id} : {}) }, manager, dc);
  const payload = extra => ({ action: 'create', date, revision: state.days.get(date).version, requestKey: require('node:crypto').randomUUID(), start: 720, people: 1, staffIds: ['A'], services: [service()], name: 'テスト詳細予約', email: '', phone: '', consent: true, bulkDiscountType: 'none', bulkDiscount: 0, ...extra });
  const post = extra => details.post(state, payload(extra), manager, dc);
  const updateBody = (id, extra = {}) => { const d = get(id), b = d.booking; return payload({ ...b, action: 'update', id, bookingFingerprint: d.bookingFingerprint, nominatedStaffId: b.nominatedStaffId, ...extra }); };
  const update = (id, extra = {}) => details.post(state, updateBody(id, extra), manager, dc);
  const check = async (name, fn) => { reset(); try { await fn(); assert(state.mails.every(m => !m.real)); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: e.message.split('\n').slice(0, 3).join(' ') }); } };

  await check('詳細APIは未ログイン拒否・スタッフ権限の受付を許可', () => {
    assert.equal(api('GET', '/api/demo/booking-details?date=' + date, null, 'none').status, 401);
    const d = api('GET', '/api/demo/booking-details?date=' + date, null, 'staff'); assert.equal(d.status, 200); assert.equal(d.data.staff.length, 5);
    const p = api('POST', '/api/demo/booking-details', payload(), 'staff'); assert.equal(p.status, 200); assert.equal(booking(p.data.id).name, 'テスト詳細予約');
  });
  await check('管理受付5名は5担当・5室を一度に確保し公開上限3を維持', () => {
    const p = post({ people: 5, staffIds: ['A','B','C','D','E'] }); const b = booking(p.id);
    assert.equal(b.people, 5); assert.equal(b.booth_ids.length, 5); assert.equal(ev().assignments.length, 5); assert(b.details_customized);
    unchanged(() => pub({ people: 5, start: c.minToMs(date, 1000), staffId: '' }), 'invalid');
  });
  await check('人数不足・担当重複・小数人数・過大人数は原状保持', () => {
    for (const v of [{people:2}, {people:2,staffIds:['A','A']}, {people:1.5}, {people:6,staffIds:['A','B','C','D','E','F']}]) unchanged(() => post(v), 'invalid');
  });
  await check('前後時間を内包し個別割引→人数→一括割引を円切捨て', () => {
    const x = a.courseStore.get(course); x.price = 1001;
    const p = post({people:2,staffIds:['A','B'],services:[service(course,{minutesBefore:5,minutesBody:50,minutesAfter:5,discountType:'percent',discount:10})],bulkDiscountType:'percent',bulkDiscount:10});
    const b = booking(p.id); assert.equal(b.total, 1620); assert.equal((b.end_at-b.start_at)/60000,60); assert.equal(b.base_price,810);
    schedule({action:'moveBooking',id:p.id,staffId:'A',start:900,end:960}); assert.equal(b.total,1620);
  });
  await check('連続コースの準備/片付け位置を各サービスの実際の順番で返す', () => {
    const p=post({services:[service(course,{minutesBefore:5,minutesBody:50,minutesAfter:5}),service(course,{minutesBefore:10,minutesBody:40,minutesAfter:10})]});
    const b=a.getSchedule(date).bookings.find(x=>x.id===p.id);assert.deepEqual(b.serviceTimings.map(s=>[s.start,s.end,s.minutesBefore,s.minutesAfter]),[[720,780,5,5],[780,840,10,10]]);
    assert.equal(b.minutesBefore,5);assert.equal(b.minutesAfter,10);assert.equal(b.minutesBody,105);
  });
  await check('一括円引きで人数割が端数でも移動で合計を変えない', () => {
    const p=post({people:3,staffIds:['A','B','C'],bulkDiscountType:'amount',bulkDiscount:1}); const b=booking(p.id), total=b.total;
    schedule({action:'moveBooking',id:p.id,staffId:'A',start:900,end:960}); assert.equal(b.total,total);
    const lines=a.bookingPriceLines(b);assert(lines.some(line=>line.includes(total.toLocaleString('ja-JP'))));assert(!lines.some(line=>/\d\.\d/.test(line)));
  });
  await check('連続2コースは2つ目のスキル未チェックも拒否', () => {
    const secondCourse='364323-4822664'; state.staff[0].courses=JSON.stringify([course]);
    unchanged(() => post({services:[service(),service(secondCourse)]}), 'staffCannotDoCourse');
    state.staff[0].courses='[]'; const p=post({services:[service(),service(secondCourse)]}); assert.equal(booking(p.id).services.length,2);
    state.staff[1].courses=JSON.stringify([course]); unchanged(() => schedule({action:'moveBooking',id:p.id,staffId:'B',start:900,end:1020}), 'staffCannotDoCourse');
  });
  await check('全コースの性別条件も交差して検査する', () => {
    const female=[...a.courseStore.values()].find(x=>dc.courseGender(x.id)==='female'); assert(female);
    unchanged(() => post({services:[service(),service(female.id)]}), 'staffGenderOnly');
  });
  await check('2コースの部屋は共通室だけを使い移動・室変更も守る', () => {
    const secondCourse='364323-4822664'; a.courseStore.get(course).boothIds=[first,second]; a.courseStore.get(secondCourse).boothIds=[second];
    const p=post({services:[service(),service(secondCourse)]}); const b=booking(p.id); assert.deepEqual(b.booth_ids,[second]);
    assert.deepEqual(a.getSchedule(date).bookings.find(x=>x.id===p.id).booth_allowed_ids,[second]);
    unchanged(()=>schedule({action:'moveBooth',id:p.id,boothIds:[first],expectBoothIds:[second]}),'invalidBooth');
    a.courseStore.get(secondCourse).boothIds=[first]; schedule({action:'moveBooking',id:p.id,staffId:'B',start:900,end:1020}); assert.deepEqual(b.booth_ids,[first]);
  });
  await check('共通室がなければ予約・番号・メールを増やさない', () => {
    const secondCourse='364323-4822664'; a.courseStore.get(course).boothIds=[first]; a.courseStore.get(secondCourse).boothIds=[second];
    unchanged(()=>post({services:[service(),service(secondCourse)]}),'boothSoldOut');
  });
  await check('指名予約変更は変更前後の確認が必須で料金を保持', () => {
    const p=post({nominatedStaffId:'A',expectedNominationFee:500}); assert.equal(booking(p.id).nomination_fee,500);
    unchanged(()=>update(p.id,{start:900}),'nominatedConfirmationRequired');
    update(p.id,{start:900,staffIds:['B'],nominatedStaffId:'B',confirmNominationMove:true}); const b=booking(p.id); assert.equal(b.nominated_staff_id,'B'); assert.equal(b.nomination_fee,500); assert(b.details_history[0].nomination_confirmed);
  });
  await check('会計済みはコメント更新可・金額変更拒否・深夜ドラッグ拒否', () => {
    const p=post(); let b=booking(p.id); b.paid_at=Date.now(); b.paid_amount=b.total;
    update(p.id,{comment:'テスト会計後コメント'}); b=booking(p.id); assert.equal(b.comment,'テスト会計後コメント');
    unchanged(()=>update(p.id,{bulkDiscountType:'amount',bulkDiscount:100}),'alreadyPaid');
    unchanged(()=>schedule({action:'moveBooking',id:p.id,staffId:'A',start:1320,end:1380}),'alreadyPaid');
  });
  await check('0円精算済みも勝手に追加料金を作らない', () => {
    const p=post({bulkDiscountType:'percent',bulkDiscount:100}); const b=booking(p.id); b.paid_at=Date.now();b.paid_amount=0;
    unchanged(()=>update(p.id,{start:1320}),'alreadyPaid');
  });
  await check('回数券の日時担当コメント変更で残数・利用対応を変えない', () => {
    const p=post();const b=booking(p.id);b.ticket_id='TEST-TICKET';b.base_price=0;b.total=0;state.tickets.set('TEST-TICKET',{remaining:4});state.ticketUseByBooking.set(p.id,'TEST-TICKET');const before=encode({tickets:state.tickets,uses:state.ticketUseByBooking});
    update(p.id,{start:900,staffIds:['B'],comment:'テスト回数券移動'});assert.equal(booking(p.id).total,0);assert.equal(encode({tickets:state.tickets,uses:state.ticketUseByBooking}),before);
    unchanged(()=>update(p.id,{people:2,staffIds:['A','B']}),'hasTicket');
    unchanged(()=>update(p.id,{services:[service('364323-4822664')]}),'hasTicket');
    unchanged(()=>update(p.id,{bulkDiscountType:'amount',bulkDiscount:1}),'hasTicket');
  });
  await check('保存前にスキルを外すと再判定し予約を変更しない', () => {
    const p=post(), body=updateBody(p.id,{start:900});state.staff[0].courses=JSON.stringify(['364323-4822664']);
    unchanged(()=>details.post(state,body,manager,dc),'staffCannotDoCourse');
  });
  await check('古い日次版・予約情報・価格確認は上書きを拒否', () => {
    const p=post(), body=updateBody(p.id,{start:900});state.days.get(date).version++;unchanged(()=>details.post(state,body,manager,dc),'scheduleConflict');
    body.revision++;booking(p.id).comment='他画面';unchanged(()=>details.post(state,body,manager,dc),'bookingChanged');
    unchanged(()=>post({services:[service(course,{expectedPrice:1})],start:1000,staffIds:['B']}),'priceChanged');
  });
  await check('同一保存の再送だけ成功・内容変更/別操作者のキー流用を拒否', () => {
    const body=payload(),p=details.post(state,body,manager,dc),before=encode(state);assert.deepEqual(details.post(state,body,manager,dc),p);assert.equal(encode(state),before);
    unchanged(()=>details.post(state,{...body,start:900},manager,dc),'requestChanged');
    unchanged(()=>details.post(state,body,staff,dc),'requestChanged');assert.equal(ev().bookings.length,1);
  });
  await check('休憩との重なり・勤務外・無効時刻は原状保持', () => {
    ev().blocks.push({id:'TEST-BREAK',staff_id:'A',start_at:c.minToMs(date,720),end_at:c.minToMs(date,750)});
    unchanged(()=>post(),'soldOut');unchanged(()=>post({start:570}),'outsideShift');unchanged(()=>post({start:1620}),'invalid');unchanged(()=>post({services:[service(course,{minutesBefore:1})]}),'invalid');
  });
  await check('翌日0時と前日24時以降の担当重複を拒否', () => {
    const p=post({start:1410,services:[service(course,{minutesBody:120})]});
    unchanged(()=>post({date:next,start:0,revision:0}),'soldOut');assert.equal(ev().bookings.length,1);
  });
  await check('詳細の時間長はドラッグで切り捨てず編集画面で変更する', () => {
    const p=post();unchanged(()=>schedule({action:'moveBooking',id:p.id,staffId:'A',start:900,end:930}),'bookingChanged');
    update(p.id,{services:[service(course,{minutesBody:90})]});assert.equal((booking(p.id).end_at-booking(p.id).start_at)/60000,90);
  });
  await check('既存未知メニューと取消済みは勝手に別内容へ保存しない', () => {
    const p=post();booking(p.id).status='cancelled';unchanged(()=>update(p.id,{comment:'テスト変更'}),'bookingChanged');
    assert.equal(get(p.id).booking.status,'cancelled');unchanged(()=>post({services:[service(course,{courseId:'UNKNOWN'})],start:900}),'invalid');
  });
  await check('詳細予約の公開日時変更は拒否して原予約と券を保持', () => {
    const p=post({services:[service(course,{minutesBody:90})]}),b=booking(p.id);b.member_email='detail-test@example.test';const member={email:b.member_email,bookings:[],tickets:[]};
    unchanged(()=>a.createPublicBooking({date,start:c.minToMs(date,900),course,people:1,staff:'none',name:'テスト詳細',email:member.email,phone:'000',consent:true,rescheduleId:p.id},member),'adminChangeRequired');
  });
  await check('通常単一予約の公開日時変更は維持し会計済みだけ制止', () => {
    const p=post(),b=booking(p.id);b.member_email='detail-test@example.test';b.paid_at=Date.now();const member={email:b.member_email,bookings:[],tickets:[]};
    unchanged(()=>a.createPublicBooking({date,start:c.minToMs(date,900),course,people:1,staff:'none',name:'テスト詳細',email:member.email,phone:'000',consent:true,rescheduleId:p.id},member),'adminChangeRequired');
  });
  await check('HP既存価格と深夜料金免除を保持し履歴・会員紐付けを消さない', () => {
    const p=post(),b=booking(p.id);delete b.services;b.source='hotpepper';b.base_price=4321;b.total=4321;b.customer_token='TEST-TOKEN';b.member_id='TEST-MEMBER';
    update(p.id,{start:1320});const out=booking(p.id);assert.equal(out.total,4321);assert.equal(out.customer_token,'TEST-TOKEN');assert.equal(out.member_id,'TEST-MEMBER');
  });
  await check('連続コース削除/並替え後も改定前の各単価を識別子で保持', () => {
    const secondCourse='364323-4822664',p=post({services:[service(),service(secondCourse)]}),d=get(p.id),original=d.booking.services[1].price;
    a.courseStore.get(secondCourse).price=original+1000;
    update(p.id,{services:[d.booking.services[1]]});assert.equal(booking(p.id).services[0].price,original);assert.equal(booking(p.id).total,original);
    unchanged(()=>update(p.id,{services:[...get(p.id).booking.services,...get(p.id).booking.services]}),'invalid');
  });
  await check('識別子なしの新しいコースは現行料金で保存', () => {
    const p=post(),old=booking(p.id).total;a.courseStore.get(course).price=old+100;
    update(p.id,{services:[service()]});assert.equal(booking(p.id).total,old+100);
  });
  await check('メール構文・改行・型・長さを予約やメール作成前に検査', () => {
    for(const extra of [{email:'bad'}, {email:'test@example.test\nBcc: x@example.test'}, {email:{}},{phone:{}},{phone:'000\r\n'}, {name:{}},{name:'   '},{name:'テスト\n別行'},{name:'あ'.repeat(121)}]) unchanged(()=>post(extra),'invalid');
  });
  await check('写真不足は予約を妨げず、コース情報不正/鍵/停止は拒否', () => {
    const p=post();state.photos.delete('A');update(p.id,{comment:'テスト既存担当維持'});
    state.photos.delete('B');update(p.id,{staffIds:['B']});
    state.staff.find(x=>x.id==='C').courses='invalid';unchanged(()=>update(p.id,{staffIds:['C']}),'staffInfoMissing');state.staff.find(x=>x.id==='C').courses='[]';
    state.days.get(date).locked=['C'];unchanged(()=>update(p.id,{staffIds:['C']}),'staffLocked');
    state.staff.find(x=>x.id==='D').active=0;unchanged(()=>update(p.id,{staffIds:['D']}),'staffUnavailable');
  });
  await check('通常単一予約は公開日時変更が成立する', () => {
    const p=post(),b=booking(p.id);b.member_email='detail-test@example.test';const member={email:b.member_email,bookings:[],tickets:[]};
    const changed=a.createPublicBooking({date,start:c.minToMs(date,900),course,people:1,staff:'none',name:'テスト詳細',email:member.email,phone:'000',consent:true,rescheduleId:p.id},member);
    assert.equal(b.status,'cancelled');assert.equal(booking(changed.id).status,'confirmed');
  });
  await check('割引不正値・明細全長超過・深夜境界を検査', () => {
    unchanged(()=>post({services:[service(course,{discountType:'amount',discount:99999999})]}),'invalid');
    unchanged(()=>post({services:[service(course,{discountType:'percent',discount:101})]}),'invalid');
    unchanged(()=>post({services:[service(course,{minutesBody:600}),service(course,{minutesBody:5})]}),'invalid');
    const p=post({start:1315}),b=booking(p.id),base=b.total;update(p.id,{start:1320});assert.equal(booking(p.id).total,base+2000);
  });
  await check('予約編集の新コース名・施術コメント・割引変更履歴が一致', () => {
    const p=post(),b=booking(p.id);b.course_label='旧テストコース';b.comment='テスト旧コメント';
    update(p.id,{comment:'テスト新コメント',preferences:'テスト希望',tags:'テストタグ',bulkDiscountType:'amount',bulkDiscount:100});
    const out=booking(p.id),history=out.details_history.at(-1);assert.equal(out.course_label,out.course_name);
    assert.equal(history.before.comment,'テスト旧コメント');assert.equal(history.after.comment,'テスト新コメント');assert.equal(history.before.bulkDiscount,0);assert.equal(history.after.bulkDiscount,100);
    assert.equal(ops.get(state,{view:'bookings',date},manager,c).bookings[0].note,'テスト新コメント');
  });
  await check('連続コースの変更メールは全メニューと割引後の確定合計を記載', () => {
    const p=post({email:'details-test@example.test'}),secondCourse='364323-4822664';
    update(p.id,{services:[...get(p.id).booking.services,service(secondCourse)],bulkDiscountType:'amount',bulkDiscount:101});const b=booking(p.id);
    const mail=state.mails.filter(x=>x.bookingId===p.id&&x.kind==='customer'&&x.type==='change').at(-1);assert(mail);
    for(const s of b.services) assert(mail.body.includes(s.name));assert(mail.body.includes('合計 '+b.total.toLocaleString('ja-JP')+' 円'));
    assert(!state.mails.some(m=>m.real));
  });
  await check('会計済みリマインドは二重の支払を求めず0円でも会計完了表示', () => {
    const p=post(),b=booking(p.id);b.paid_at=Date.now();b.paid_amount=b.total;
    let body=a.bookingRemindBody(b);assert(body.includes('会計済み'));assert(!body.includes('合計金額は、ご来店時に店頭にてお支払いください'));
    b.paid_amount=0;body=a.bookingRemindBody(b);assert(body.includes('受領記録 0 円'));assert(!body.includes('回数券でのお支払い'));
  });
  await check('詳細予約と会計済みのメールは店舗変更へ案内し取消再予約へ誘導しない', () => {
    const p=post({services:[service(course,{minutesBody:90})]}),b=booking(p.id);
    for(const body of [a.bookingRemindBody(b),a.bookingCustomerBody(b,'テスト案内')]) {assert(body.includes('店舗までご連絡'));assert(!body.includes('再度予約を取り直してください'));}
  });
  await check('予約変更で送信処理中メールの履歴を消さず旧予定を中止として残す', () => {
    const p=post(),b=booking(p.id);const old=[{id:'TEST-SENDING',status:'sending'},{id:'TEST-PENDING',status:'pending'}].map(x=>({...x,bookingId:p.id,type:'remind',kind:'customer',remindFor:b.start_at,to:'details-test@example.test',scheduledAt:Date.now()+86400000}));state.mails.push(...old);
    update(p.id,{comment:'テスト変更'});assert(state.mails.includes(old[0]));assert.equal(old[0].status,'sending');assert(state.mails.includes(old[1]));assert.equal(old[1].status,'skipped');assert(old[1].skipReason);
  });
  await check('会計の確定内訳は予約編集後も保存時の明細を保持する', () => {
    const p=post({services:[service(),service('364323-4822664')],bulkDiscountType:'amount',bulkDiscount:100}),b=booking(p.id),d=ops.get(state,{view:'checkout',date},manager,c);
    ops.post(state,{action:'checkout',date,bookingId:p.id,amount:b.total,payments:[{method:'cash',amount:b.total}],revision:d.revision,dayRevision:d.dayRevision,bookingFingerprint:d.bookings[0].bookingFingerprint,requestKey:'test-detail-pay'},manager,c);
    const snapshot=encode(state.ledger.checkouts[0].snapshot);assert.equal(state.ledger.checkouts[0].snapshot.services.length,2);assert.equal(state.ledger.checkouts[0].snapshot.bulkDiscount,100);
    update(p.id,{comment:'テスト精算後メモ'});assert.equal(encode(state.ledger.checkouts[0].snapshot),snapshot);
    assert.equal(ops.summary(state,date).servicePaid,b.total);
  });
  await check('メールアドレス訂正後は古い宛先へ最新予約を再送しない', () => {
    const p=post({email:'old-test@example.test'});const original=state.mails.find(m=>m.bookingId===p.id&&m.kind==='customer'&&m.type==='confirm');original.status='failed';
    update(p.id,{email:'new-test@example.test'});unchanged(()=>a.resendFailedMail(original),'bookingChanged');
    const pending={...original,tpl:{name:'booking',variant:'customerConfirm',bookingId:p.id}};assert(a.applyMailTemplate(pending,true).skip.includes('メールアドレス'));
    const changed=state.mails.filter(m=>m.bookingId===p.id&&m.kind==='customer'&&m.type==='change').at(-1);assert.equal(changed.to,'new-test@example.test');
  });
  await check('連続コースの2件目も予約がある間はメニュー削除不可', () => {
    const secondCourse='364323-4822664';post({services:[service(),service(secondCourse)]});const before=encode({courses:[...a.courseStore],events:state.events});
    const deleted=api('POST','/api/demo/courses',{action:'delete',id:secondCourse});assert.equal(deleted.status,409);assert.equal(deleted.data.error,'hasBookings');assert.equal(encode({courses:[...a.courseStore],events:state.events}),before);
  });
  await check('公開変更の空き照会でも本人の詳細/会計済み予約を早期案内', () => {
    const p=post({services:[service(course,{minutesBody:90})]}),b=booking(p.id);b.member_email='detail-test@example.test';
    const q=new URLSearchParams({date,course,people:'1',staff:'none',reschedule:p.id}),member={email:b.member_email};
    unchanged(()=>a.getAvailability(q,member),'adminChangeRequired');b.details_customized=false;b.paid_at=Date.now();unchanged(()=>a.getAvailability(q,member),'adminChangeRequired');
    assert(Array.isArray(a.getAvailability(q,{email:'other-test@example.test'}).days));assert(Array.isArray(a.getAvailability(q).days));
    delete b.paid_at;assert(Array.isArray(a.getAvailability(q,member).days));
  });
  await check('メニュー名や総時間を変更しても対応ブースと時間内訳を維持', () => {
    const selected=[...a.courseStore.values()].find(x=>policy.sourceCourseTiming(x)?.minutesBefore>0),ids=policy.resolveCourseBoothIds(selected),timing=policy.sourceCourseTiming(selected);
    const renamed=api('POST','/api/demo/courses',{action:'update',id:selected.id,name:'テスト名称変更',price:selected.price,minutes:selected.minutes});assert.equal(renamed.status,200);
    assert.deepEqual(policy.resolveCourseBoothIds(selected),ids);assert.deepEqual(policy.sourceCourseTiming(selected),timing);
    const extended=api('POST','/api/demo/courses',{action:'update',id:selected.id,name:selected.name,price:selected.price,minutes:selected.minutes+5});assert.equal(extended.status,200);
    assert.deepEqual(policy.sourceCourseTiming(selected),{...timing,minutesBody:timing.minutesBody+5});assert.deepEqual(policy.resolveCourseBoothIds(selected),ids);
    assert.equal(policy.sourceCourseTiming({...selected,minutesBody:0}),null);
  });
  const report = { ok: results.every(x => x.ok), checks: results.length, passed: results.filter(x => x.ok).length, failures: results.filter(x => !x.ok), results, externalMail: false, persistentWrites: false };
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, results: undefined })); process.exit(report.ok ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
