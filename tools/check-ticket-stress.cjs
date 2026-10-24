'use strict';
// 実運用の処理を送信無効の本番コピーで検査。架空のお客様のみ。外部通信・保存は遮断。
// node tools/check-ticket-stress.cjs <コピーのフォルダ> <結果.json> [グループ名]
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), { EventEmitter } = require('node:events'), http = require('node:http');
const root = fs.realpathSync(process.argv[2] || '.');
assert(root.startsWith('/private/tmp/'), '独立した一時コピーを指定してください');
assert(!fs.existsSync(path.join(root, 'mail-config.json')));
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(k)) delete process.env[k];
global.fetch = async () => { throw Error('外部通信は禁止'); };
const decode = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
const encode = v => JSON.stringify(v, (_, x) => x instanceof Map ? { __pm_map__: [...x] } : x instanceof Set ? { __pm_set__: [...x] } : x);
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json'), 'utf8'), decode);
assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && snapshot.state.mails.length === 0);
const persist = require(path.join(root, 'persist.js'));
persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot }); persist.startSaver = () => {};
const file = path.join(root, 'demo-api.js'), mod = new Module(file);
mod.filename = file; mod.paths = Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,courseStore,createPublicBooking,cancelBooking,postSchedule,findBooking,adminSessions,bookingDetailsContext,ticketExpiryMs,ticketPublicJson,reviveForPurchase,maybeRefundTicket,consumeTicket};', file);
const details = require(path.join(root, 'booking-details.js')), ops = require(path.join(root, 'ledger-operations.js')), policy = require(path.join(root, 'booth-policy.js'));
const realNow = Date.now, NOW = Date.parse('2026-10-24T03:00:00+09:00'), DAY = 86400000;
const report = { source: 'production copy; outgoing mail, remote storage and fetch disabled', groups: {}, failures: [], scenarios: 0, assertions: 0 };
let seq = 0;
function equal(a, b, message) { report.assertions++; assert.deepEqual(a, b, message); }
function ok(value, message) { report.assertions++; assert(value, message); }
(async () => {
  await mod.exports.ready;
  const a = mod.exports.audit, state = a.state, c = a.bookingDetailsContext();
  const date = '2026-10-25', nextDate = '2026-10-26', email = 'ticket-stress@example.test';
  const baseCourse = '364323-4822701', otherCourse = '364323-4822664';
  const originalPlans = structuredClone(state.ticketPlans), allCourses = [...a.courseStore.values()];
  const courses = allCourses.filter(x => x.minutes > 0 && x.minutes <= 180 && x.minutes % 5 === 0 && c.courseBoothIds(x)?.length).slice(0, 24);
  assert.equal(courses.length, 24, '24種の実メニューが必要');
  const actor = { user: 'test-manager', role: 'manager', active: true };
  function reset(courseId = baseCourse) {
    Date.now = () => NOW;
    for (const k of ['events','days','shifts','bookingIndex','requestKeys','bookingDetailsKeys','tickets','ticketUseByBooking','ticketPurchaseKeys','members','memberSessions','hpKeys','reports','accounts','boothRequestKeys']) state[k] = new Map();
    state.mails = []; state.mailRelay = {}; state.hpLog = []; state.ledger = ops.createState();
    state.ticketSerial = 0; state.ticketPlanSerial = 0; state.bookingSerial = 0;
    state.ticketPlans = structuredClone(originalPlans);
    state.staffReconciliation = { version: 1 };
    state.staff = ['A','B','C','D','E'].map(id => ({ id, name: 'テスト担当' + id, active: 1, sort_order: id.charCodeAt(0),
      gender: c.courseGender(courseId) || 'male', courses: JSON.stringify(allCourses.map(x => x.id)),
      profile: JSON.stringify({ message: 'テスト紹介', personalNomination: true, nominationFee: 500 }) }));
    state.photos = new Map(state.staff.map(s => [s.id, 'data:image/jpeg;base64,/9j/']));
    state.booths = policy.sourceDefaults().booths.map(b => ({ ...b, active: true })); state.boothRevision = 0;
    state.settings.freeMessage = { visible: true, required: false, maxLength: 2000 };
    state.settings.shopMaster.resStart = 600; state.settings.shopMaster.resEnd = 1560;
    for (const d of [date, nextDate]) {
      state.days.set(d, { version: 0, enabled: true }); state.events.set(d, { bookings: [], blocks: [], assignments: [] });
      state.shifts.set(d, state.staff.map(s => ({ staff_id: s.id, date: d, start_at: c.minToMs(d, 600), end_at: c.minToMs(d, 1620), note: '' })));
    }
    state.accounts.set(actor.user, actor); a.adminSessions.clear(); a.adminSessions.set('aaaa', { user: actor.user, created: NOW });
    const member = { email, name: 'テスト回数券', phone: '0000000000', bookings: [], tickets: [] };
    state.members.set(email, member); state.memberSessions.set('bbbb', { email, created: NOW });
    state.members.set('other@example.test', { ...member, email: 'other@example.test', tickets: [], bookings: [] });
    state.memberSessions.set('cccc', { email: 'other@example.test', created: NOW });
  }
  const member = () => state.members.get(email), ev = () => state.events.get(date);
  function ticket(extra = {}) {
    const t = { id: 'test-ticket', token: 'test-secret', plan_id: 'tp-5', plan_name: 'テスト整体券', buyer_name: 'テスト回数券',
      buyer_email: email, buyer_phone: '0000000000', member_email: email, uses_total: 5, uses_left: 3,
      purchased_at: new Date(NOW - DAY * 30).toISOString(), expires_at: NOW + DAY * 30, menu_scope: [baseCourse],
      revive_group: 'standard', valid_months: 12, history: [], ...extra };
    state.tickets.set(t.id, t); member().tickets.push(t.id); return t;
  }
  const records = () => encode({ tickets: state.tickets, use: state.ticketUseByBooking, events: state.events, members: state.members,
    index: state.bookingIndex, keys: state.requestKeys, detailKeys: state.bookingDetailsKeys, purchaseKeys: state.ticketPurchaseKeys,
    mails: state.mails, plans: state.ticketPlans, ticketSerial: state.ticketSerial, ticketPlanSerial: state.ticketPlanSerial, bookingSerial: state.bookingSerial });
  function api(route, body, cookie = 'pm_session=aaaa') {
    const req = new EventEmitter(), res = new EventEmitter(); let status, data;
    Object.assign(req, { method: body ? 'POST' : 'GET', headers: { cookie }, socket: { remoteAddress: '127.0.0.1' }, destroy() {} });
    Object.assign(res, { setHeader() {}, writeHead(n) { status = n; }, end(raw) { data = raw ? JSON.parse(raw) : null; this.emit('finish'); } });
    assert(mod.exports.handleDemoApi(req, res, new URL(route, 'http://localhost')));
    if (body) { req.emit('data', JSON.stringify(body)); req.emit('end'); }
    return { status, data };
  }
  function publicBody(extra = {}) { return { requestKey: 'test-' + (++seq), course: baseCourse, date, start: c.minToMs(date, 720), people: 1,
    staff: 'none', staffId: 'A', expectedNominationFee: 500, name: 'テスト回数券予約', email, phone: '0000000000', consent: true, ...extra }; }
  function adminBody(extra = {}) {
    const course = a.courseStore.get(extra.courseId || baseCourse);
    return { action: 'create', date, revision: state.days.get(date).version, requestKey: 'test-' + (++seq), start: 720, people: 1, staffIds: ['A'],
      services: [{ courseId: course.id, expectedPrice: course.price, minutesBefore: 0, minutesBody: course.minutes, minutesAfter: 0, discountType: 'none', discount: 0 }],
      name: 'テスト回数券予約', email, phone: '0000000000', consent: true, bulkDiscountType: 'none', bulkDiscount: 0, ...extra };
  }
  function create(channel, t, course, start = 720, extra = {}) {
    if (channel === 'admin') return details.post(state, adminBody({ courseId: course, ticketId: t.id, start, ...extra }), actor, c);
    return a.createPublicBooking(publicBody({ course, start: c.minToMs(date, start), ticketId: t.id, ticketToken: t.token, ...extra }), channel === 'member' ? member() : null);
  }
  function cancel(id) { return a.postSchedule({ action: 'cancel', date, id, revision: state.days.get(date).version }, actor); }
  async function test(group, name, fn, course = baseCourse) {
    if (process.argv[4] && process.argv[4] !== group) return;
    reset(course); const g = report.groups[group] ||= { scenarios: 0, passed: 0, failed: 0 }; g.scenarios++; report.scenarios++;
    try { await fn(); ok(state.mails.every(m => !m.real), '実メール送信の記録'); g.passed++; }
    catch (e) { g.failed++; if (report.failures.length < 80) report.failures.push({ group, name, error: e.message.slice(0, 450) }); }
    finally { Date.now = () => NOW; }
  }
  const announced = new Set();
  function progress(group) { if (!announced.has(group)) { announced.add(group); console.log('CHECK ' + group); } }

  // 24実メニュー × 3受付経路 × 9券条件 × 4勤務条件 × 2時間帯 = 5,184。
  progress('booking_matrix');
  for (const course of courses) for (const channel of ['guest','member','admin']) for (const status of ['valid','one','empty','expired','boundary','wrongOwner','wrongToken','scopeAll','wrongScope'])
    for (const work of ['free','unskilled','locked','occupied']) for (const start of [720,1320]) {
      await test('booking_matrix', [course.id,channel,status,work,start].join('/'), () => {
        const t = ticket({ menu_scope: status === 'scopeAll' ? 'all' : [status === 'wrongScope' ? 'no-such-menu' : course.id],
          uses_left: status === 'empty' ? 0 : status === 'one' ? 1 : 3,
          expires_at: status === 'expired' ? NOW - 1 : status === 'boundary' ? NOW : NOW + DAY });
        if (status === 'wrongOwner') { t.member_email = 'other@example.test'; t.buyer_email = 'other@example.test'; }
        if (work === 'unskilled') state.staff[0].courses = '["no-such-menu"]';
        if (work === 'locked') state.days.get(date).locked = ['A'];
        if (work === 'occupied') details.post(state, adminBody({ courseId: course.id, start }), actor, c);
        const before = records(), left = t.uses_left;
        const allowed = work === 'free' && !['empty','expired','wrongOwner','wrongScope'].includes(status) && !(status === 'wrongToken' && channel === 'guest');
        let result, error;
        try { result = create(channel, t, course.id, start, status === 'wrongToken' ? { ticketToken: 'wrong' } : {}); } catch (e) { error = e; }
        if (!allowed) { ok(error?.status >= 400 && error.status < 500, '拒否すべき条件で成立: ' + JSON.stringify(result)); equal(records(), before, '拒否したのに記録を変更'); }
        else { if (error) throw error; const bk = a.findBooking(result.id).bk;
          equal(t.uses_left, left - 1); equal(t.history.filter(x => x.type === 'use').length, 1);
          equal(bk.total, (start >= 1320 ? 2000 : 0) + (channel === 'admin' ? 0 : 500)); equal(bk.ticket_id, t.id);
          equal(ev().assignments.filter(x => x.booking_id === result.id).length, 1);
        }
      }, course.id);
    }
  // 日本時間の月末・うるう年・年越し、月数1〜60。独立計算の暦と照合。
  progress('expiry_calendar');
  for (const year of [2024,2026,2028,2099]) for (let month = 0; month < 12; month++) for (const day of [1,28,31]) {
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); if (day > last) continue;
    for (const months of [1,2,3,6,12,18,24,36,48,60]) for (const hour of [0,23]) await test('expiry_calendar', [year,month+1,day,months,hour].join('/'), () => {
      const purchase = Date.UTC(year,month,day,hour) - 9 * 3600000;
      const expected = new Date(Date.UTC(year,month + months,1));
      expected.setUTCDate(Math.min(day, new Date(Date.UTC(expected.getUTCFullYear(), expected.getUTCMonth()+1,0)).getUTCDate()));
      expected.setUTCHours(14,59,59,0);
      equal(a.ticketExpiryMs(purchase,months), expected.getTime());
    });
  }
  // 正常値・空欄・小数・負数・巨大値・文字列を組み合わせ、拒否時の部分保存を禁止。
  progress('adjustment_matrix');
  const numbers = [0,1,-1,2,-3,4,0.5,-0.5,'1','0','abc','1e309',Number.MAX_SAFE_INTEGER];
  for (const delta of numbers) for (const days of numbers) for (const note of ['テスト調整','', '   ']) await test('adjustment_matrix', JSON.stringify([delta,days,note]), () => {
    const t = ticket(), before = records(), expiry = t.expires_at;
    const int = x => (typeof x === 'number' || typeof x === 'string' && x.trim() !== '') && Number.isSafeInteger(Number(x));
    const nextExpiry = expiry + Number(days) * DAY;
    const allowed = int(delta) && int(days) && note.trim() && 3 + Number(delta) >= 0 && 3 + Number(delta) <= 5 &&
      Number.isSafeInteger(nextExpiry) && Number.isFinite(new Date(nextExpiry).getTime()) && nextExpiry >= Date.parse(t.purchased_at);
    const res = api('/api/demo/tickets', { action: 'adjust', id: t.id, usesDelta: delta, extendDays: days, note });
    if (allowed) { equal(res.status,200); equal(t.uses_left,3+Number(delta)); equal(t.expires_at,nextExpiry); }
    else { ok(res.status >= 400 && res.status < 500, '不正値を保存: ' + JSON.stringify(res)); equal(records(),before,'拒否時に回数・期限が変化'); }
  });
  progress('purchase_retry');
  for (const plan of originalPlans.values()) for (const channel of ['member','repeatGuest']) for (const variation of ['same','otherPlan','otherOwner','newName','newPhone','newLanguage','planDisabled','planDeleted','longKey']) await test('purchase_retry', [plan.id,channel,variation].join('/'), () => {
    const cookie = channel === 'member' ? 'cn_member=bbbb' : '';
    if (!cookie) a.createPublicBooking(publicBody());
    const body = { planId: plan.id, name: 'テスト購入', email, phone: '0000000000', requestKey: 'test-purchase-' + (++seq), language: 'ja' };
    if (variation === 'longKey') body.requestKey = 'x'.repeat(201);
    const before = records(), first = api('/api/tickets/purchase',body,cookie);
    if (variation === 'longKey') { equal(first.status,400); equal(records(),before); return; }
    equal(first.status,200); const id = first.data.ticket.id, t = state.tickets.get(id);
    equal(t.uses_total,plan.uses); equal(t.uses_left,plan.uses); equal(t.plan_name,plan.name); equal(t.menu_scope,plan.menu_scope);
    const again = {...body}; let secondCookie = cookie;
    if (variation === 'otherPlan') again.planId = [...originalPlans.keys()].find(x=>x!==plan.id);
    if (variation === 'otherOwner') { again.email = 'other@example.test'; secondCookie = 'cn_member=cccc'; }
    if (variation === 'newName') again.name += '変更';
    if (variation === 'newPhone') again.phone = '1111111111';
    if (variation === 'newLanguage') again.language = 'en';
    if (variation === 'planDisabled') state.ticketPlans.get(plan.id).active = 0;
    if (variation === 'planDeleted') state.ticketPlans.delete(plan.id);
    const saved = records(), second = api('/api/tickets/purchase',again,secondCookie);
    if (['same','planDisabled','planDeleted'].includes(variation)) { equal(second.status,200,'再送は確定済みの購入を返す'); equal(second.data.ticket.id,id); }
    else { equal(second.status,409,'同じキーで内容が変われば拒否'); }
    equal(records(),saved,'再送で二重購入または変更');
  });
  progress('revival_matrix');
  for (const owner of ['same','other','guest']) for (const expired of [true,false]) for (const left of [0,1,3,5]) for (const group of ['same','other']) for (const scope of ['same','other','reordered']) for (const enabled of [true,false]) await test('revival_matrix',[owner,expired,left,group,scope,enabled].join('/'), () => {
    const old = ticket({ menu_scope:[baseCourse,otherCourse], uses_left:left, expires_at: NOW + (expired?-DAY:DAY),
      member_email: owner==='same'?email:owner==='other'?'other@example.test':null, buyer_email:owner==='other'?'other@example.test':email });
    state.ticketPlans.get('tp-5').revive = enabled;
    const bought = ticket({id:'test-new',purchased_at:new Date(NOW).toISOString(),uses_left:5,
      menu_scope:scope==='other'?[otherCourse]:scope==='reordered'?[otherCourse,baseCourse]:[baseCourse,otherCourse],
      revive_group:group==='same'?'standard':'other'});
    const expected = owner==='same' && expired && group==='same' && scope!=='other' && enabled ? left : 0;
    const result = a.reviveForPurchase(bought); equal(result.total,expected); equal(bought.uses_left,5); equal(old.uses_left,expected?0:left);
    if(expected) { const r=state.tickets.get(result.ticket_id); equal(r.uses_total,expected); equal(r.expires_at,bought.expires_at); equal(r.member_email,email); }
    const saved=records(); equal(a.reviveForPurchase(bought).total,expected); equal(records(),saved,'復活を重複実行');
  });
  progress('stateful_lifecycle');
  for(let seed=1;seed<=120;seed++) await test('stateful_lifecycle','sequence-'+seed,()=>{
    const t=ticket({uses_total:1+seed%10,uses_left:1+seed%10,menu_scope:'all'}), initial=t.uses_left;
    let r=seed, current=null, used=0;
    for(let step=0;step<25;step++) {
      r=(Math.imul(r,1664525)+1013904223)>>>0;
      if(!current) { const channel=['guest','member','admin'][r%3]; current=create(channel,t,baseCourse); used++; }
      else if(r%3===0) {
        const before=records();
        assert.throws(()=>create('guest',t,baseCourse),e=>e.status===409); equal(records(),before,'重複予約で券を減算');
      } else {
        cancel(current.id); used--; const bk=a.findBooking(current.id).bk;
        const before=records(); equal(a.maybeRefundTicket(bk,NOW),false); equal(records(),before); current=null;
      }
      equal(t.uses_left,initial-used); equal(state.ticketUseByBooking.size,used);
      equal(t.history.filter(h=>h.type==='use').length-t.history.filter(h=>h.type==='refund').length,used);
      // 実際の保存形式で往復しても予約・所有者・使用履歴が維持される。
      if(step%5===4) { const wire=encode({tickets:state.tickets,ticketUseByBooking:state.ticketUseByBooking,events:state.events,members:state.members}); equal(encode(JSON.parse(wire,decode)),wire); }
    }
  });
  progress('plan_validation');
  for(const action of ['add','update']) for(const field of ['price','uses','valid_months','regular_price']) for(const value of [-1,0,1,1.5,'abc','1e309',Number.MAX_SAFE_INTEGER]) await test('plan_validation',[action,field,value].join('/'),()=>{
    const before=records(); const b={action,id:'tp-5',name:'テスト新プラン',price:30000,uses:5,valid_months:12,regular_price:0,[field]:value};
    const max={price:1e9,uses:200,valid_months:60,regular_price:1e9}[field], min=['uses','valid_months'].includes(field)?1:0;
    const allowed=Number.isSafeInteger(Number(value))&&Number(value)>=min&&Number(value)<=max;
    const res=api('/api/demo/ticket-plans',b);
    if(allowed)equal(res.status,200); else {equal(res.status,400);equal(records(),before,'無効な設定の一部が保存された');}
  });
  progress('ticket_booking_edits');
  for(const channel of ['guest','member','admin']) for(const edit of ['time','staff','duration','course','people','discount','owner','comment']) await test('ticket_booking_edits',[channel,edit].join('/'),()=>{
    const t=ticket({uses_left:1}), result=create(channel,t,baseCourse);
    const current=details.get(state,{date,id:result.id},actor,c), b=current.booking;
    const patch={...b,action:'update',date,revision:current.revision,bookingFingerprint:current.bookingFingerprint,
      requestKey:'test-edit-'+(++seq),consent:true,services:b.services.map(s=>({...s,expectedPrice:s.price})),confirmNominationMove:true};
    if(edit==='time')patch.start=900;
    if(edit==='staff'){patch.staffIds=['B'];patch.nominatedStaffId=b.nominatedStaffId?'B':'';}
    if(edit==='duration')patch.services[0].minutesBody+=60;
    if(edit==='course'){const cr=a.courseStore.get(otherCourse);patch.services[0].courseId=cr.id;patch.services[0].expectedPrice=cr.price;}
    if(edit==='people'){patch.people=2;patch.staffIds=['A','B'];}
    if(edit==='discount'){patch.services[0].discountType='amount';patch.services[0].discount=1;}
    if(edit==='owner')patch.email='other@example.test';
    if(edit==='comment')patch.comment='テスト変更';
    const before=records();let error;try{details.post(state,patch,actor,c);}catch(e){error=e;}
    if(['time','staff','comment'].includes(edit)){if(error)throw error;equal(t.uses_left,0);equal(t.history.length,1);}
    else{ok(error?.status>=400&&error.status<500,'使用済み券の予約条件が書き換わった');equal(records(),before);}
  });
  progress('restore');
  for(const channel of ['member','admin']) await test('restore',channel,async()=>{
    const t=ticket({uses_left:1}), r=create(channel,t,baseCourse), body={planId:'tp-5',requestKey:'test-before-restart',name:'テスト再起動購入',email};
    const bought=api('/api/tickets/purchase',body,'cn_member=bbbb');equal(bought.status,200);
    const saved=JSON.parse(encode({state,sessions:[...a.adminSessions]}),decode);saved.state.mails=[];saved.state.mailRelay={};
    persist.loadSnapshotWithRemote=async()=>({enabled:false,data:saved});
    const restored=new Module(file);restored.filename=file;restored.paths=Module._nodeModulePaths(root);
    restored._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.audit={state,postSchedule,adminSessions};',file);await restored.exports.ready;
    const z=restored.exports.audit;equal(z.state.tickets.get(t.id).uses_left,0);equal(z.state.ticketUseByBooking.get(r.id),t.id);
    equal(z.state.ticketPurchaseKeys.get(body.requestKey).ticketId,bought.data.ticket.id);
    ok(z.state.ticketPurchaseKeys.get(body.requestKey).fingerprint);
    z.postSchedule({action:'cancel',date,id:r.id,revision:z.state.days.get(date).version},actor);
    equal(z.state.tickets.get(t.id).uses_left,1);equal(z.state.ticketUseByBooking.has(r.id),false);
  });
  // 本物のHTTP受付を同時に叩く。ホストはこのプロセスの127.0.0.1に限定。
  progress('concurrent_http');
  if(!process.argv[4]||process.argv[4]==='concurrent_http') {
    const server=http.createServer((req,res)=>{if(!mod.exports.handleDemoApi(req,res,new URL(req.url,'http://localhost'))) {res.writeHead(404);res.end('{}');}});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const port=server.address().port;
    const request=(route,b,cookie='cn_member=bbbb')=>new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port,path:route,method:'POST',headers:{'Content-Type':'application/json',cookie}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(raw)}));});req.on('error',reject);req.end(JSON.stringify(b));
    });
    try {
      for(const count of [2,5,10,25,50]) for(const kind of ['purchaseRetry','bookingRetry','lastUse','mixedChannels']) await test('concurrent_http',[kind,count].join('/'),async()=>{
        const t=ticket({uses_total:1,uses_left:1}), b=publicBody({ticketId:t.id,ticketToken:t.token});
        const purchase={planId:'tp-5',requestKey:'test-burst',name:'テスト同時購入',email};
        const outputs=await Promise.all(Array.from({length:count},(_,i)=>kind==='purchaseRetry'?request('/api/tickets/purchase',purchase):kind==='mixedChannels'&&i%2===1?
          request('/api/demo/booking-details',adminBody({ticketId:t.id,start:720+(i%8)*60}),'pm_session=aaaa'):
          request('/api/bookings',{...b,...(kind==='bookingRetry'?{}:{requestKey:'test-concurrent-'+i,start:c.minToMs(date,720+(i%8)*60)})})));
        const success=outputs.filter(x=>x.status===200);
        equal(success.length,['purchaseRetry','bookingRetry'].includes(kind)?count:1);
        if(kind==='purchaseRetry'){equal(state.tickets.size,2);equal(new Set(success.map(x=>x.data.ticket.id)).size,1);}
        else {equal(ev().bookings.length,1);equal(t.uses_left,0);equal(t.history.filter(x=>x.type==='use').length,1);}
        ok(outputs.every(x=>[200,409].includes(x.status)),'同時操作でサーバー障害');
      });
    } finally {await new Promise(resolve=>server.close(resolve));}
  }
  report.failed=Object.values(report.groups).reduce((n,g)=>n+g.failed,0);report.passed=report.scenarios-report.failed;
  report.courseCount=courses.length;report.completedAt=new Date(realNow()).toISOString();
  if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({scenarios:report.scenarios,passed:report.passed,failed:report.failed,assertions:report.assertions,groups:report.groups,failures:report.failures.slice(0,5)},null,2));
  process.exitCode=report.failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Date.now=realNow;setImmediate(()=>process.exit(process.exitCode||0));});
