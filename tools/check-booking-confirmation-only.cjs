'use strict';
// 送信無効の本番コピーで実際の予約/API処理をメモリ内検査。HTTPサーバーや外部決済は起動しない。
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
assert(process.argv[2]); const root = path.resolve(process.argv[2]); assert(!fs.existsSync(path.join(root, 'mail-config.json')));
process.env.DEMO_EPHEMERAL = '1'; process.env.HP_MAIL = '0'; process.env.CLOUD = '0';
for (const k of Object.keys(process.env)) if (/^(MAIL_|GH_|ADMIN_PASS)/.test(k)) delete process.env[k];
// 文面の検査から送信処理へ進んでしまった場合も、外部通信を止める。
const noNetwork = () => { throw new Error('検証中の外部通信は禁止'); };
global.fetch = noNetwork;
for (const name of ['node:net', 'node:tls']) require(name).connect = noNetwork;
for (const name of ['node:http', 'node:https']) { require(name).request = noNetwork; require(name).get = noNetwork; }
const revive = (_, v) => v?.__pm_map__ ? new Map(v.__pm_map__) : v?.__pm_set__ ? new Set(v.__pm_set__) : v;
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'safe-state.json'), 'utf8'), revive);
assert(!snapshot.state.mailRelay?.url && !snapshot.state.mailRelay?.secret && !snapshot.state.mails.length);
const persist = require(path.join(root, 'persist.js')); persist.loadSnapshotWithRemote = async () => ({ enabled: false, data: snapshot }); persist.startSaver = () => {};
const file = path.join(root, 'demo-api.js'), mod = new Module(file); mod.filename = file; mod.paths = Module._nodeModulePaths(root);
mod._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.audit={state,courseStore,postSchedule,getSchedule,ledgerContext,createPublicBooking,getAvailability,hpNotify,adminSessions,bookingDetailsContext,bookingMismatch,bookingPriceLines,bookingRemindBody,bookingCustomerBody,resendFailedMail,applyMailTemplate,deliverDueMails,isBookingReminder,queueBookingMail,bookingUseNoticeIncludedInConfirmation,consumeTicket,mailI18n,mailHtml,BOOKING_MAIL};', file);
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
    state.settings.mailI18n = { enabled: false };
    a.courseStore.clear(); for (const x of courses) a.courseStore.set(x.id, { ...x }); state.courses = null;
    for (const d of [date, next]) {
      state.days.set(d, { version: 0, enabled: true }); state.events.set(d, { bookings: [], blocks: [], assignments: [] });
      state.shifts.set(d, state.staff.map(s => ({ staff_id: s.id, date: d, start_at: c.minToMs(d, d === next ? 0 : 600), end_at: c.minToMs(d, 1620), note: '' })));
    }
    state.accounts.set(manager.user, manager); state.accounts.set(staff.user, staff);
    a.adminSessions.clear(); a.adminSessions.set('aaaa', { user: manager.user, created: Date.now() }); a.adminSessions.set('bbbb', { user: staff.user, created: Date.now() });
  }
  const ev = (d = date) => state.events.get(d), booking = (id, d = date) => ev(d).bookings.find(x => x.id === id);
  const pub = (extra = {}) => a.createPublicBooking({ companionNames: Array.from({length: Math.max(0, (extra.people || 1) - 1)}, (_, i) => "【デモテスト】同行者" + (i + 1)), requestKey: require('node:crypto').randomUUID(), date, start: c.minToMs(date, 720), course, people: 1, staff: 'none', staffId: 'A', expectedNominationFee: 500, name: 'テスト予約', email: 'booth-test@example.test', phone: '0000000000', consent: true, ...extra });
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
  const mailRows=id=>state.mails.filter(m=>m.bookingId===id), noReminders=()=>assert(!state.mails.some(a.isBookingReminder));
  const ticket=()=>{const t={id:'test-ticket',token:'test-ticket-token',plan_id:'tp-5',plan_name:'テスト回数券',buyer_name:'テスト会員',buyer_email:'booth-test@example.test',member_email:'booth-test@example.test',uses_total:5,uses_left:5,menu_scope:'all',valid_months:12,history:[],purchased_at:new Date().toISOString(),expires_at:Date.now()+365*864e5};state.tickets.set(t.id,t);return t;};
  const oldUse=(t,b,extra={})=>({id:'TEST-OLD-USE',kind:'customer',type:'ticket',to:t.buyer_email,status:'pending',scheduledAt:Date.now()+864e5,body:'テスト残数通知',tpl:{name:'ticketLeft',ticketId:t.id,kind:'use',ref:b.reference},...extra});
  const checkDetails = (m, people, nominated) => {
    const lines = m.body.split('\n');
    assert.equal(lines.filter(x => x === `人数 ${people}名`).length, 1, '人数は予約どおり1か所に記載');
    const label = nominated ? '予約者ご本人：' : '指名：';
    const nominationLine = lines.find(x => x.startsWith(label));
    assert.equal(nominationLine, nominated ? `予約者ご本人：テスト担当${nominated}さん指名` : '指名：なし', '正しい指名者だけを明記');
    assert.equal(lines.filter(x => x.startsWith(label)).length, 1, '指名を重複表示しない');
    if (!nominated) assert(lines.some(x => x.startsWith('担当スタッフ')), '指名なしでは自動割当の担当者を記載');
    if (m.html) { assert(m.html.includes(`人数 ${people}名`)); assert(m.html.includes(nominationLine)); }
  };
  for (const source of ['公開予約', '管理画面']) for (const people of [1, 2, 3]) for (const nominated of ['', 'A']) {
    await check(`${source} ${people}名・指名${nominated ? 'あり' : 'なし'}の人数/担当を顧客と店舗へ記載`, () => {
      const p = source === '公開予約' ? pub({ people, staffId: nominated })
        : post({ people, staffIds: ['A', 'B', 'C'].slice(0, people), nominatedStaffId: nominated, expectedNominationFee: 500, email: 'details-test@example.test' });
      const rows = mailRows(p.id); assert.equal(rows.length, 2);
      for (const m of rows) checkDetails(m, people, nominated);
      assert.equal(state.settings.mailI18n.enabled, false); noReminders();
    });
  }
  await check('人数と指名の変更では通知せず、取消には最新内容を表示し確認済み履歴は保持', () => {
    const p = post({ people: 2, staffIds: ['A', 'B'], nominatedStaffId: 'A', expectedNominationFee: 500, email: 'details-test@example.test' });
    const original = mailRows(p.id).map(m => ({ ...m }));
    update(p.id, { people: 3, staffIds: ['B', 'C', 'D'], nominatedStaffId: 'B', expectedNominationFee: 500, confirmNominationMove: true });
    assert.equal(mailRows(p.id).filter(m => m.type === 'change').length, 0);
    assert.deepEqual(mailRows(p.id).slice(0, 2), original);
    schedule({ action: 'cancel', id: p.id });
    const cancelled = mailRows(p.id).filter(m => m.type === 'cancel'); assert.equal(cancelled.length, 2);
    for (const m of cancelled) checkDetails(m, 3, 'B');
    noReminders();
  });
  await check('指名料0円でも指名されたスタッフを表示する', () => {
    state.staff[0].profile = JSON.stringify({ message: 'テスト紹介', personalNomination: true, nominationFee: 0 });
    const p = pub({ people: 2, expectedNominationFee: 0 });
    for (const m of mailRows(p.id)) checkDetails(m, 2, 'A');
  });
  await check('保存された指名名を使い、削除済みスタッフでも指名が消えない', () => {
    const p = pub({ people: 2 }), b = booking(p.id); state.staff = state.staff.filter(x => x.id !== 'A');
    for (const variant of ['customerConfirm', 'storeNotify', 'customerChange', 'storeChange', 'customerCancel', 'storeCancel']) checkDetails(a.BOOKING_MAIL[variant](b), 2, 'A');
  });
  await check('掲載名と記号を含む名前が本文/HTMLへ正しく反映される', () => {
    state.staff[0].profile = JSON.stringify({ message: 'テスト紹介', nickname: 'テスト <A&B>', personalNomination: true, nominationFee: 500 });
    const p = pub();
    for (const m of mailRows(p.id)) { assert(m.body.includes('予約者ご本人：テスト <A&B>さん指名')); assert(m.html.includes('予約者ご本人：テスト &lt;A&amp;B&gt;さん指名')); assert(!m.html.includes('<A&B>')); }
  });
  await check('人数未記録の旧予約は1名、担当未割当なら架空の名前を作らない', () => {
    const p = pub({ staffId: '' }), b = booking(p.id); delete b.people; ev().assignments = [];
    const m = a.BOOKING_MAIL.customerConfirm(b); assert(m.body.includes('人数 1名')); assert(!m.body.includes('担当スタッフ')); assert(!m.body.includes('undefined'));
  });
  await check('回数券の送信直前の再生成にも人数/指名を記載する', () => {
    const t = ticket(), p = pub({ ticketId: t.id, ticketToken: t.token });
    for (const m of mailRows(p.id)) { checkDetails(m, 1, 'A'); checkDetails(a.applyMailTemplate(m, true), 1, 'A'); }
    noReminders();
  });
  const translatedGuests = { en: 'Guests 3', zh: '人数 3位', ko: '인원 3명', fr: 'Personnes 3', es: 'Personas 3', it: 'Persone 3', de: 'Personen 3' };
  for (const [lang, guests] of Object.entries(translatedGuests)) await check(`${lang}の文面見本でも人数/指名を保持し多言語送信は有効にしない`, () => {
    const p = pub({ people: 3, language: lang });
    for (const type of ['confirm', 'change', 'cancel']) {
      const m = a.mailI18n().localize({ kind: 'customer', type, bookingId: p.id }, lang);
      assert.equal(m.body.split('\n').filter(x => x === guests).length, 1); assert(m.body.includes('テスト担当A')); assert(m.body.includes('テスト担当B'));
      assert.equal(a.mailI18n().localize({ kind: 'store', type, bookingId: p.id }, lang), null);
    }
    for (const m of mailRows(p.id)) checkDetails(m, 3, 'A');
    assert.equal(state.settings.mailI18n.enabled, false); noReminders();
  });
  await check('公開予約は確認1通＋店舗通知1通で自動リマインドなし',()=>{
    const p=pub();assert.deepEqual(mailRows(p.id).map(m=>[m.kind,m.type]),[['customer','confirm'],['store','notify']]);noReminders();
    const before=encode(state.mails);a.deliverDueMails('timer');a.deliverDueMails('cron');assert.equal(encode(state.mails),before);
  });
  await check('同じ予約確定の再送で確認メールを二重生成しない',()=>{
    const p=pub({requestKey:'test-confirm-once'}),before=encode(state.mails);assert.deepEqual(pub({requestKey:'test-confirm-once'}),p);assert.equal(encode(state.mails),before);noReminders();
  });
  await check('管理の詳細受付も確認1通、二重送信は同じ結果だけ返す',()=>{
    const body=payload({email:'details-test@example.test'}),p=details.post(state,body,manager,dc),before=encode(state.mails);
    assert.equal(mailRows(p.id).filter(m=>m.kind==='customer'&&m.type==='confirm').length,1);assert.equal(mailRows(p.id).length,2);noReminders();
    assert.deepEqual(details.post(state,body,manager,dc),p);assert.equal(encode(state.mails),before);
  });
  await check('従来の店頭受付でも自動リマインドを作らない',()=>{
    schedule({action:'createBooking',staffId:'A',start:720,course,people:1,consent:true,name:'テスト従来受付',email:'legacy-test@example.test'});
    assert.equal(state.mails.length,2);assert.equal(state.mails.filter(m=>m.kind==='customer'&&m.type==='confirm').length,1);noReminders();
  });
  await check('変更通知は作らず取消通知を維持する',()=>{
    const p=post({email:'details-test@example.test'});update(p.id,{start:900});schedule({action:'cancel',id:p.id});
    assert.deepEqual(mailRows(p.id).filter(m=>m.kind==='customer').map(m=>m.type),['confirm','cancel']);noReminders();
  });
  await check('保存済みの期限到来/未来リマインドは顧客も店舗も中止履歴になる',()=>{
    const rows=['customer','store'].flatMap(kind=>[-86400000,86400000].map((offset,i)=>({id:'TEST-OLD-'+kind+i,bookingId:'TEST-OLD',kind,type:'remind',to:'old-test@example.test',status:'pending',scheduledAt:Date.now()+offset,body:'テスト予約リマインド',subject:'テスト'})));
    state.mails.push(...rows);a.deliverDueMails('cron');assert.equal(state.mails.length,4);for(const r of rows){assert.equal(r.status,'skipped');assert(r.skipReason.includes('停止'));assert(!r.sentAt&&!r.real&&!r.simulated);}
    a.deliverDueMails('timer');assert.equal(state.mails.length,4);
  });
  await check('旧テンプレートを直接使っても配信直前で必ず中止',()=>{
    const p=post(),b=booking(p.id);
    for(const variant of ['customerRemind','storeRemind','customerChangeRemind','storeChangeRemind']){
      const m={kind:'customer',type:'other',bookingId:p.id,to:'old-test@example.test',status:'pending',tpl:{name:'booking',variant,bookingId:p.id}};
      assert(a.applyMailTemplate(m,true).skip.includes('停止'));assert.equal(a.queueBookingMail('customer','remind','old-test@example.test',variant,b,Date.now()),null);
    }
    noReminders();
  });
  await check('過去に失敗した予約リマインドの手動再送も禁止',()=>{
    const p=post(),m={id:'TEST-FAIL',type:'remind',kind:'customer',status:'failed',bookingId:p.id,to:'old-test@example.test'};state.mails.push(m);
    unchanged(()=>a.resendFailedMail(m),'cannotResend');assert.equal(m.status,'failed');
  });
  await check('送信済み/処理中の記録を消さず待機中だけ停止',()=>{
    const sending={id:'TEST-SENDING',type:'remind',kind:'customer',status:'sending'},sent={id:'TEST-SENT',type:'remind',kind:'customer',status:'sent',sentAt:123};state.mails.push(sending,sent);
    a.deliverDueMails('timer');assert.equal(state.mails.length,2);assert.equal(sending.status,'sending');assert.equal(sent.status,'sent');assert.equal(sent.sentAt,123);
  });
  await check('再起動で旧送信待ちを中止し送信済み履歴を保持',async()=>{
    const old=JSON.parse(encode(state),revive);old.mails=[{id:'TEST-RESTORE-PENDING',type:'remind',kind:'customer',status:'pending',scheduledAt:Date.now()+86400000,body:'テスト',subject:'テスト'},{id:'TEST-RESTORE-SENT',type:'remind',kind:'store',status:'sent',sentAt:123,body:'テスト',subject:'テスト'}];
    persist.loadSnapshotWithRemote=async()=>({enabled:false,data:{state:old}});const reload=new Module(file);reload.filename=file;reload.paths=Module._nodeModulePaths(root);reload._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.auditState=state;',file);await reload.exports.ready;
    assert.equal(reload.exports.auditState.mails.find(m=>m.id==='TEST-RESTORE-PENDING').status,'skipped');assert.equal(reload.exports.auditState.mails.find(m=>m.id==='TEST-RESTORE-SENT').sentAt,123);
  });
  await check('回数券期限通知や変更取消を予約リマインドと混同しない',()=>{
    for(const type of ['confirm','change','cancel','notify','ticket','ticketRemind','member']) assert.equal(a.isBookingReminder({type}),false);
  });
  await check('回数券利用は確認1通へ集約し残数を正確に記載',()=>{
    const t=ticket(),p=pub({ticketId:t.id,ticketToken:t.token}),m=mailRows(p.id).find(m=>m.kind==='customer'&&m.type==='confirm');
    assert.equal(t.uses_left,4);assert.equal(t.history.length,1);assert.equal(state.mails.filter(m=>m.kind==='customer').length,1);assert(m.body.includes('テスト回数券'));assert(m.body.includes('残り回数 あと4回'));assert(m.ticketIds.includes(t.id));noReminders();
  });
  await check('回数券付き確定の通信再送でも残数と確認は1回だけ',()=>{
    const t=ticket(),body={requestKey:'test-ticket-once',ticketId:t.id,ticketToken:t.token},p=pub(body),before=encode({t,mails:state.mails});
    assert.deepEqual(pub(body),p);assert.equal(encode({t,mails:state.mails}),before);
  });
  await check('旧送信待ち利用通知は同一予約の確認に残数が載るときだけ中止',()=>{
    const t=ticket(),p=pub({ticketId:t.id,ticketToken:t.token}),m=oldUse(t,booking(p.id));state.mails.push(m);
    assert(a.bookingUseNoticeIncludedInConfirmation(m));assert(a.applyMailTemplate(m,true).skip.includes('予約確認'));a.deliverDueMails('cron');assert.equal(m.status,'skipped');assert(m.skipReason.includes('予約確認'));assert(!m.real&&!m.sentAt);
  });
  await check('関連不明/別宛先/確認失敗/残数記載なしの旧通知は止めない',()=>{
    const t=ticket(),p=pub({ticketId:t.id,ticketToken:t.token}),b=booking(p.id),confirmation=mailRows(p.id).find(m=>m.kind==='customer');
    for(const alter of [m=>m.tpl.ref='unrelated',m=>m.to='different-test@example.test',m=>m.tpl.kind='refund',m=>m.tpl.kind='revive',m=>m.tpl.ref=null]){const m=oldUse(t,b);alter(m);assert.equal(a.bookingUseNoticeIncludedInConfirmation(m),false);state.mails.push(m);a.deliverDueMails('cron');assert.equal(m.status,'pending');state.mails.pop();}
    const m=oldUse(t,b),status=confirmation.status;confirmation.status='failed';assert.equal(a.bookingUseNoticeIncludedInConfirmation(m),false);confirmation.status=status;
    const body=confirmation.body;confirmation.body='テスト確認（残数の根拠なし）';assert.equal(a.bookingUseNoticeIncludedInConfirmation(m),false);confirmation.body=body;
    confirmation.ticketIds={};assert.equal(a.bookingUseNoticeIncludedInConfirmation(m),false);
  });
  await check('回数券予約の取消は返却通知を維持し二重返却しない',()=>{
    const t=ticket(),p=pub({ticketId:t.id,ticketToken:t.token});schedule({action:'cancel',id:p.id});assert.equal(t.uses_left,5);
    const refund=state.mails.find(m=>m.tpl?.name==='ticketLeft'&&m.tpl.kind==='refund');assert(refund);assert.equal(a.bookingUseNoticeIncludedInConfirmation(refund),false);
    assert.equal(t.history.filter(h=>h.type==='refund').length,1);assert(mailRows(p.id).some(m=>m.type==='cancel'));noReminders();
  });
  await check('予約確認に集約しない独立した残数操作の通知は維持',()=>{
    const t=ticket();a.consumeTicket(t,'TEST-MANUAL','TEST-MANUAL-REF');assert.equal(t.uses_left,4);assert(state.mails.some(m=>m.tpl?.name==='ticketLeft'&&m.tpl.kind==='use'));assert.equal(state.mails.filter(m=>m.status==='skipped').length,0);
  });
  await check('既に確認に記載した利用通知の手動再送を止める',()=>{
    const t=ticket(),p=pub({ticketId:t.id,ticketToken:t.token}),m=oldUse(t,booking(p.id),{status:'failed'});state.mails.push(m);unchanged(()=>a.resendFailedMail(m),'cannotResend');
  });
  await check('再起動時も同じ予約確認で残数を通知済みの旧利用通知を中止',async()=>{
    const t=ticket(),p=pub({ticketId:t.id,ticketToken:t.token}),m=oldUse(t,booking(p.id));state.mails.push(m);const old=JSON.parse(encode(state),revive);
    persist.loadSnapshotWithRemote=async()=>({enabled:false,data:{state:old}});const reload=new Module(file);reload.filename=file;reload.paths=Module._nodeModulePaths(root);reload._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.auditState=state;',file);await reload.exports.ready;
    assert.equal(reload.exports.auditState.mails.find(m=>m.id==='TEST-OLD-USE').status,'skipped');assert.equal(reload.exports.auditState.tickets.get(t.id).uses_left,4);
  });
  const report={ok:results.every(x=>x.ok),checks:results.length,passed:results.filter(x=>x.ok).length,failures:results.filter(x=>!x.ok),results,externalMail:false,persistentWrites:false};
  if(process.argv[3]) fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({...report,results:undefined}));process.exit(report.ok?0:1);
})().catch(e=>{console.error(e.message);process.exit(1);});
