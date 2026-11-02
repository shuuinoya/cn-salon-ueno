'use strict';
// 送信無効の本番コピーで実際の予約/API処理をメモリ内検査。HTTPサーバーや外部決済は起動しない。
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
assert(process.argv[2]); const root = path.resolve(process.argv[2]); assert(!fs.existsSync(path.join(root, 'mail-config.json')));
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(k)) delete process.env[k];
let externalCalls = 0; const denyNetwork = () => { externalCalls++; throw new Error('外部通信禁止'); };
global.fetch = denyNetwork; require('node:net').connect = denyNetwork; require('node:tls').connect = denyNetwork;
const revive = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json'), 'utf8'), revive);
assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && !snapshot.state.mails.length);
const persist = require(path.join(root, 'persist.js')); persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot }); persist.startSaver = () => {};
const file = path.join(root, 'demo-api.js'), mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,courseStore,postSchedule,getSchedule,ledgerContext,createPublicBooking,getAvailability,hpNotify,adminSessions,bookingDetailsContext,bookingMismatch,bookingPriceLines,bookingRemindBody,bookingCustomerBody,resendFailedMail,applyMailTemplate,deliverDueMails,queueChangeMails,BOOKING_MAIL,bookingPriceParts,bookingStaffLine,mailI18n,getPublicBooking};', file);
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
    state.staffReconciliation = { version: 1 }; state.staff = ['A', 'B', 'C', 'D', 'E'].map(id => ({ id, name: '【デモテスト】担当' + id, active: 1, gender: 'male', courses: '[]', sort_order: id.charCodeAt(0), profile: JSON.stringify({ message: 'テスト紹介', personalNomination: true, nominationFee: 500 }) }));
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
  const pub = (extra = {}) => a.createPublicBooking({ requestKey: require('node:crypto').randomUUID(), date, start: c.minToMs(date, 720), course, people: 1, staff: 'none', staffId: 'A', expectedNominationFee: 500, name: '【デモテスト】予約者', email: 'booth-test@example.test', phone: '0000000000', consent: true, ...extra });
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
  const payload = extra => ({ action: 'create', date, revision: state.days.get(date).version, requestKey: require('node:crypto').randomUUID(), start: 720, people: 1, staffIds: ['A'], services: [service()], name: '【デモテスト】受付', email: '', phone: '', consent: true, bulkDiscountType: 'none', bulkDiscount: 0, ...extra });
  const post = extra => details.post(state, payload(extra), manager, dc);
  const updateBody = (id, extra = {}) => { const d = get(id), b = d.booking; return payload({ ...b, action: 'update', id, bookingFingerprint: d.bookingFingerprint, nominatedStaffId: b.nominatedStaffId, ...extra }); };
  const update = (id, extra = {}) => details.post(state, updateBody(id, extra), manager, dc);
  const check = async (name, fn) => { reset(); try { await fn(); assert(state.mails.every(m => !m.real)); assert.equal(externalCalls, 0); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: e.message.split('\n').slice(0, 3).join(' ') }); } };

  const companionNames = ['【デモテスト】同行一', '【デモテスト】同行二'];
  const variants = ['customerConfirm','storeNotify','customerChange','storeChange','customerCancel','storeCancel'];
  for (const people of [1, 2, 3]) for (const nominated of [false, true]) {
    await check(`${people}名・指名${nominated ? 'あり' : 'なし'}：代表だけ指名、確認各1通、変更で追加送信なし`, () => {
      const p = pub({ people, companionNames: companionNames.slice(0, people - 1), staffId: nominated ? 'A' : '', expectedNominationFee: nominated ? 500 : 0 });
      const b = booking(p.id), assignments = ev().assignments.filter(x => x.booking_id === b.id);
      assert.equal(assignments.length, people); assert.equal(new Set(assignments.map(x => x.staff_id)).size, people);
      assert.equal(b.nominated_staff_id, nominated ? 'A' : null); assert.equal(b.nomination_fee, nominated ? 500 : 0);
      assert.equal(state.mails.length, 2); assert.deepEqual(state.mails.map(m => m.kind).sort(), ['customer', 'store']);
      for (const m of state.mails) {
        assert(m.subject.startsWith('【オンライン新規予約】')); assert.equal(m.body.split('\n')[0], '【オンライン新規予約】');
        assert(m.body.includes(`人数 ${people}名`));
        if (nominated) { assert(m.body.includes('予約者ご本人：【デモテスト】担当Aさん指名')); if (people > 1) assert(m.body.includes('同行者：指名なし')); }
      }
      const mailsBefore = encode(state.mails);
      schedule({ action: 'moveBooking', id: b.id, staffId: 'E', start: 900, end: 960, expect: { staffId: assignments[0].staff_id, start: 720 }, confirmNominationMove: true });
      assert.equal(encode(state.mails), mailsBefore);
      schedule({ action: 'moveBooking', id: b.id, staffId: 'E', start: 960, end: 1020, toDate: next, toRevision: state.days.get(next).version, expect: { staffId: 'E', start: 900 }, confirmNominationMove: true });
      assert.equal(encode(state.mails), mailsBefore);
      assert.equal(booking(b.id, next).people, people);
      assert.equal(booking(b.id, next).nomination_fee, nominated ? 500 : 0);
    });
  }
  await check('旧プログラムの変更・リマインド待ちを停止し再送も拒否、送信済み履歴は保持', () => {
    const b = booking(pub().id), sent = encode(state.mails);
    for (const type of ['change', 'remind']) for (const kind of ['customer', 'store']) {
      state.mails.push({ id: 'テスト-' + type + kind, bookingId: b.id, kind, type, status: 'pending', scheduledAt: Date.now() + 86400000 });
      assert.throws(() => a.resendFailedMail({ type, status: 'failed' }), e => e.message === 'cannotResend');
    }
    state.mails.push({ id: 'テスト-legacy-template', bookingId: b.id, type: 'notify', status: 'pending', tpl: { name: 'booking', variant: 'storeChange' } });
    a.deliverDueMails();
    assert.equal(encode(state.mails.slice(0, 2)), sent); assert(state.mails.slice(2).every(m => m.status === 'skipped'));
  });
  await check('確認・変更・取消メール全6種に正しい指名と内訳（500円）', () => {
    const p=pub(), b=booking(p.id);
    for (const variant of variants) {
      const {body}=a.BOOKING_MAIL[variant](b);
      assert(body.includes('予約者ご本人：【デモテスト】担当Aさん指名'),variant);
      assert(body.includes('指名料 500 円'),variant);
      assert(body.includes('コース料金'),variant);
      assert(body.includes(`合計 ${b.total.toLocaleString('ja-JP')} 円`),variant);
    }
    assert.equal(state.mails.length,2); assert(!state.mails.some(m=>m.type==='remind'));
  });
  await check('2500円の保存済み指名料は後から料金マスタが変わっても保持', () => {
    state.staff[0].profile=JSON.stringify({personalNomination:true,nominationFee:2500});
    const p=pub({expectedNominationFee:2500}),b=booking(p.id);
    state.staff[0].profile=JSON.stringify({personalNomination:true,nominationFee:500});
    assert(a.BOOKING_MAIL.customerConfirm(b).body.includes('指名料 2,500 円'));
  });
  await check('複数人・割当順が変わっても指名者を誤認しない', () => {
    const p=pub({people:3,companionNames}),b=booking(p.id);ev().assignments.reverse();
    for(const variant of variants) {
      const body=a.BOOKING_MAIL[variant](b).body;
      assert(body.includes('予約者ご本人：【デモテスト】担当Aさん指名'));
      assert(!body.includes('予約者ご本人：【デモテスト】担当Cさん指名'));
      assert(body.includes('同行者：指名なし') && body.includes('同行者の担当スタッフ'));
      assert(body.includes('同行者1 【デモテスト】同行一 様'));
      assert(body.includes('同行者2 【デモテスト】同行二 様'));
    }
    assert.deepEqual(a.getPublicBooking(p.id,p.token).booking.companionNames,companionNames);
    assert.throws(()=>a.getPublicBooking(p.id,'wrong'),e=>e.message==='notFound');
  });
  await check('指名なしの自動担当は指名として表示しない', () => {
    const b=booking(pub({staffId:'',expectedNominationFee:0}).id),body=a.BOOKING_MAIL.customerConfirm(b).body;
    assert(body.includes('指名：なし'));assert(body.includes('担当スタッフ'));assert(!body.includes('指名料'));
  });
  await check('無料指名とスタッフ削除後の保存名にも対応', () => {
    state.staff[0].profile=JSON.stringify({personalNomination:true,nominationFee:0});
    const b=booking(pub({expectedNominationFee:0}).id);state.staff=[];
    const body=a.BOOKING_MAIL.customerConfirm(b).body;
    assert(body.includes('予約者ご本人：【デモテスト】担当Aさん指名'));assert(body.includes('指名料 0 円'));
  });
  await check('古い不一致の内訳でも指名料と確定合計を表示', () => {
    const b=booking(pub().id);b.total-=1000;
    const body=a.BOOKING_MAIL.customerConfirm(b).body;
    assert(body.includes('指名料 500 円'));assert(!body.includes('深夜料金'));assert(!body.includes('コース料金'));
    assert(body.includes(`合計 ${b.total.toLocaleString('ja-JP')} 円`));
  });
  await check('旧記録の不明な追加料金・欠けた単価を深夜料金と誤記しない', () => {
    const b=booking(pub().id);b.total+=1000;
    assert(!a.BOOKING_MAIL.customerConfirm(b).body.includes('深夜料金'));
    delete b.base_price;
    assert(!a.BOOKING_MAIL.customerConfirm(b).body.includes('コース料金 0'));
    b.services=[{price:6000,discountType:'broken',discount:0}];
    assert(a.BOOKING_MAIL.customerCancel(b).body.includes('指名料 500 円'));
  });
  await check('同行者名は予約者を含めず人数分−1、空欄や制御文字を拒否', () => {
    for(const names of [undefined,[],[''],['  '],['a','b'],[null],[1],['a\nb'],['a'.repeat(121)]]) {
      unchanged(()=>pub({people:2,companionNames:names}),'invalid');
    }
    unchanged(()=>pub({people:1,companionNames:['extra']}),'invalid');
    const b=booking(pub({people:2,companionNames:['  【デモテスト】同行者  ']}).id);
    assert.deepEqual(b.companion_names,['【デモテスト】同行者']);
  });
  await check('同行者を変えた再送を重複予約にせず拒否、同じ再送は1件', () => {
    const input={people:2,companionNames:[companionNames[0]],requestKey:'【デモテスト】retry'};
    const one=pub(input);assert.deepEqual(pub(input),one);assert.equal(ev().bookings.length,1);
    unchanged(()=>pub({...input,companionNames:[companionNames[1]]}),'requestChanged');
  });
  await check('管理画面の再読込・更新・履歴に同行者名が残る', () => {
    const id=pub({people:2,companionNames:[companionNames[0]]}).id;
    assert.deepEqual(get(id).booking.companionNames,[companionNames[0]]);
    update(id,{comment:'【デモテスト】変更'});
    assert.deepEqual(booking(id).companion_names,[companionNames[0]]);
    const oldClient=updateBody(id,{comment:'【デモテスト】旧画面更新'});delete oldClient.companionNames;
    details.post(state,oldClient,manager,dc);
    assert.deepEqual(booking(id).companion_names,[companionNames[0]]);
    update(id,{companionNames:[companionNames[1]]});
    assert.deepEqual(get(id).booking.companionNames,[companionNames[1]]);
    assert.deepEqual(booking(id).details_history.at(-1).after.companionNames,[companionNames[1]]);
    assert.equal(state.mails.length, 2, '管理画面の変更では追加メールなし');
    assert(a.BOOKING_MAIL.customerConfirm(booking(id)).body.includes(companionNames[1]));
    const restored=JSON.parse(encode(state),revive);assert.deepEqual(restored.events.get(date).bookings[0].companion_names,[companionNames[1]]);
  });
  await check('割引付き複数コースの内訳を全言語で同じ計算にする', () => {
    const id=post({services:[service(course,{discountType:'percent',discount:10})],staffIds:['A'],nominatedStaffId:'A',expectedNominationFee:500,email:'test@example.test'}).id;
    const b=booking(id),parts=a.bookingPriceParts(b);assert.equal(parts.late,0);assert.equal(parts.base,b.total-500);
    for (const lang of ['en','zh','ko','fr','es','it','de']) {
      for (const type of ['confirm','change','cancel']) {
        const m=a.mailI18n().localize({kind:'customer',type,bookingId:id},lang);
        assert(m&&m.body.includes('【デモテスト】担当A'),lang+' '+type);
        assert(m.body.includes('500'),lang+' fee');
      }
    }
  });
  await check('深夜料金・回数券の内訳と指名料を分離', () => {
    const b=booking(pub({start:c.minToMs(date,1320)}).id);
    assert(a.BOOKING_MAIL.customerConfirm(b).body.includes('深夜料金 2,000 円'));
    b.ticket_id='【デモテスト】券';b.base_price=0;b.total=2500;
    const body=a.BOOKING_MAIL.customerConfirm(b).body;
    assert(body.includes('回数券でお支払い'));assert(body.includes('指名料 500 円'));assert(body.includes('深夜料金 2,000 円'));
  });
  await check('全言語で同行者名が確認・変更・取消メールに入る', () => {
    const id=pub({people:2,companionNames:[companionNames[0]]}).id;
    for(const lang of ['en','zh','ko','fr','es','it','de']) for(const type of ['confirm','change','cancel']) {
      const m=a.mailI18n().localize({kind:'customer',type,bookingId:id},lang);
      assert(m.body.includes(companionNames[0]));assert(m.body.includes('【デモテスト】担当A'));assert(m.body.includes('500'));
    }
  });
  reset();
  const sample=booking(pub({people:2,companionNames:[companionNames[0]]}).id);
  if(process.env.CN_AUDIT_OUTPUT) {
    fs.mkdirSync(process.env.CN_AUDIT_OUTPUT,{recursive:true});
    const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const mail=a.BOOKING_MAIL.customerConfirm(sample);
    fs.writeFileSync(path.join(process.env.CN_AUDIT_OUTPUT,'mail-preview.html'),'<!doctype html><meta charset="utf-8"><title>【デモテスト】メール確認</title><style>body{font:16px/1.7 system-ui;max-width:760px;margin:24px auto;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>【デモテスト】送信なしの確認</h1><pre>'+escape(mail.body.replace(/https?:\/\/\S+/g,'（確認用URL省略）'))+'</pre>');
  }
  console.log(JSON.stringify({tests:results,passed:results.filter(x=>x.ok).length,total:results.length},null,2));
  process.exit(results.every(x=>x.ok)?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
