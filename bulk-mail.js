"use strict";
// 店舗のお知らせ。予約メールとは別の、確認してから送る変更不能の配信記録。
const crypto = require('node:crypto');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const email = x => String(x || '').trim().toLowerCase();
const valid = x => x.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(x);
const reserved = /@(?:[^@\s]+\.)?(?:example\.(?:com|net|org|jp)|invalid|test|localhost|local)$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });
function authorized(actor) { if (!actor || !['admin', 'manager'].includes(actor.role) || actor.active === false) throw fail(403, 'forbidden'); }
function records(state) { return state.mailCampaigns || (state.mailCampaigns = []); }
function recipients(state) {
  const found = new Map(), invalid = new Set();
  const add = (raw, name, source) => {
    const e = email(raw); if (!e) return;
    if (!valid(e) || reserved.test(e)) { invalid.add(e); return; }
    if (!found.has(e)) found.set(e, { id: hash(e), email: e, name: String(name || '').trim() || 'お名前未登録', source });
  };
  // 現在の顧客記録を優先し、過去の予約で訂正済みの宛先へ送らない。
  const overrides = state.customerRecords instanceof Map ? state.customerRecords : new Map();
  for (const m of state.members.values()) {
    const r = overrides.get('member:' + hash(String(m.email)));
    add(r ? r.fields.email : m.email, r?.fields.name || m.name, 'マイページ登録');
  }
  const bookings = [...state.events.values()].flatMap(ev => ev.bookings || []).sort((a,b) => (b.created_at || b.start_at || 0) - (a.created_at || a.start_at || 0));
  for (const b of bookings) {
    if (b.member_email && state.members.has(b.member_email)) continue;
    const r = overrides.get('booking:' + b.id);
    add(r ? r.fields.email : b.email, r?.fields.name || b.name, '予約時のメール登録');
  }
  for (const r of overrides.values()) add(r.fields?.email, r.fields?.name, '顧客情報');
  for (const t of state.tickets.values()) {
    // 会員は最新の会員・顧客情報を使い、購入時の古いアドレスを追加しない。
    if (t.member_email && state.members.has(t.member_email)) continue;
    add(t.buyer_email, t.buyer_name, '回数券購入');
  }
  return { recipients: [...found.values()].sort((a,b) => a.name.localeCompare(b.name, 'ja') || a.email.localeCompare(b.email)), invalid: invalid.size };
}
const signature = rows => hash(JSON.stringify(rows.map(r => [r.id, r.email, r.name]).sort((a,b) => a[0].localeCompare(b[0]))));
function summary(state, campaign) {
  const mails = state.mails.filter(m => m.campaignId === campaign.id), counts = { pending:0, sending:0, sent:0, failed:0, skipped:0, simulated:0 };
  for (const m of mails) counts[m.simulated ? 'simulated' : m.status]++;
  return { id:campaign.id, subject:campaign.subject, createdAt:campaign.createdAt, sentAt:campaign.sentAt, status:campaign.status, count:campaign.recipients.length, counts, author:campaign.author,
    problems:mails.filter(m => ['failed','skipped'].includes(m.status)).map(m => ({email:m.to,reason:m.error || m.skipReason})) };
}
function bodyFor(campaign, context) {
  return campaign.body + '\n\n' + context.store + '\n' + context.address + '\nTEL：' + context.tel + '\nお問い合わせ：' + context.contact + '\n' + context.origin;
}
function preview(state, input, actor, context) {
  authorized(actor);
  if (typeof input.subject !== 'string' || typeof input.body !== 'string' || !['all','selected'].includes(input.mode)) throw fail(400,'invalid');
  const subject = input.subject.trim(), body = input.body.replace(/\r\n/g,'\n').trim();
  if (!subject || subject.length > 120 || /[\u0000-\u001f\u007f]/.test(subject) || !body || body.length > 10000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body)) throw fail(400,'invalid');
  const list = recipients(state).recipients;
  if (input.mode === 'selected' && (!Array.isArray(input.ids) || input.ids.some(x => typeof x !== 'string'))) throw fail(400,'invalid');
  const ids = new Set(input.ids || []), selected = input.mode === 'all' ? list : list.filter(r => ids.has(r.id));
  if (input.mode === 'selected' && selected.length !== ids.size) throw fail(409,'recipientsChanged');
  if (!selected.length) throw fail(400,'noRecipients');
  if (selected.length > 10000) throw fail(400,'tooManyRecipients');
  const fingerprint = hash(JSON.stringify([subject,body,selected.map(r => r.email).sort()]));
  const same = records(state).filter(c => c.fingerprint === fingerprint);
  if (same.some(c => c.status !== 'draft' && c.sentAt > context.now - 86400000)) throw fail(409,'alreadySent');
  const previous = same.find(c => c.status === 'draft' && c.createdAt > context.now - 30*60000 && c.author === actor.user && c.mode === input.mode && c.signature === signature(selected));
  const c = previous || {
    id:crypto.randomUUID(), fingerprint, subject, body, mode:input.mode, recipients:selected, signature:signature(selected), author:actor.user, createdAt:context.now, status:'draft'
  };
  if (c !== previous) records(state).push(c);
  // 未送信の古い確認だけ整理。送信済みの重複防止・履歴は保持する。
  state.mailCampaigns = records(state).filter(x => x.status !== 'draft' || x.createdAt > context.now - 7*86400000);
  return { id:c.id, subject:c.subject, body:bodyFor(c,context), recipients:c.recipients, count:c.recipients.length };
}
function send(state, input, actor, context) {
  authorized(actor);
  const c = records(state).find(x => x.id === input.id);
  if (!c || c.author !== actor.user) throw fail(404,'notFound');
  if (c.status !== 'draft') return { ok:true, campaign:summary(state,c) };
  if (input.confirm !== true) throw fail(400,'confirmationRequired');
  if (c.createdAt < context.now - 30*60000) throw fail(409,'previewExpired');
  const current = recipients(state).recipients;
  const selected = c.mode === 'all' ? current : current.filter(x => c.recipients.some(r => r.id === x.id));
  if (signature(selected) !== c.signature) throw fail(409,'recipientsChanged');
  if (records(state).some(x => x.id !== c.id && x.status !== 'draft' && x.fingerprint === c.fingerprint && x.sentAt > context.now-86400000)) throw fail(409,'alreadySent');
  if (!context.configured) throw fail(409,'notConfigured');
  if (c.recipients.some(r => !context.allowed(r.email))) throw fail(409,'recipientNotAllowed');
  const oldLength = state.mails.length;
  try {
    for (const r of c.recipients) {
      const m = context.queue(r.email, c.subject, bodyFor(c,context), context.now);
      m.campaignId = c.id;
    }
    c.status = 'queued'; c.sentAt = context.now;
    if (!context.flush()) throw fail(503,'saveFailed');
  } catch (e) { state.mails.splice(oldLength); c.status='draft'; delete c.sentAt; throw e; }
  return { ok:true, campaign:summary(state,c) };
}
function cancel(state, input, actor, context) {
  authorized(actor); const c=records(state).find(x=>x.id===input.id);
  if (!c || c.status==='draft') throw fail(404,'notFound');
  const pending=state.mails.filter(m=>m.campaignId===c.id && m.status==='pending'), old=c.status;
  for (const m of pending) {m.status='skipped';m.skipReason='店舗で未送信分を停止しました';}
  c.status='stopped';
  if (!context.flush()) { c.status=old; for(const m of pending){m.status='pending';delete m.skipReason;} throw fail(503,'saveFailed'); }
  return {ok:true,campaign:summary(state,c)};
}
// 通常の予約通知を妨げないよう、一斉メールは同時に2通・1分に10通まで。
function canDeliver(state, mail, now) {
  if (mail.type!=='bulk') return true;
  const campaign=records(state).find(c=>c.id===mail.campaignId);
  if (!campaign || campaign.status!=='queued') { mail.status='skipped';mail.skipReason='配信が停止されています';return false; }
  const bulk=state.mails.filter(m=>m.type==='bulk');
  return bulk.filter(m=>m.status==='sending').length<2 && bulk.filter(m=>m.deliveryStartedAt>now-60000).length<10;
}
module.exports={recipients,preview,send,cancel,summary,canDeliver};
