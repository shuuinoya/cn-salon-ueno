"use strict";
// 予約から開く顧客記録。氏名だけでは顧客を結合しない。予約・会員・回数券の本体は変更しない。
const crypto = require("node:crypto");
const FIELDS = { member:80,name:120,kana:120,tel:40,tel2:40,tel3:40,tel4:40,email:254,email2:254,gender:8,birthday:10,zip:20,prefecture:30,address:300,address2:300,job:100,tags:500,rank:5,comment:5000,note1:5000,note2:5000 };
const digest = x => crypto.createHash("sha256").update(x).digest("hex");
const normalize = x => String(x || "").normalize("NFKC").trim();
const nameKey = x => normalize(x).replace(/\s/g, "");
const emailKey = x => normalize(x).toLowerCase();
const phoneKey = x => normalize(x).replace(/[^\d+]/g, "");
const customerGender = value => ({male:"m",female:"f",m:"m",f:"f",other:"other"}[value] || "");
function requireActor(actor,c) { if (!actor || !["admin","manager","staff"].includes(actor.role)) throw c.err(403,"forbidden"); }
function resolve(state, query, c) {
  let found = query.bookingId && c.findBooking(String(query.bookingId));
  if (!found && query.reference) {
    const matches=[]; for(const [date,ev] of state.events) for(const bk of ev.bookings || []) if(String(bk.reference)===String(query.reference)) matches.push({date,bk});
    if(matches.length===1) found=matches[0];
  }
  if (!found?.bk) throw c.err(404,"notFound");
  const member = found.bk.member_email && state.members.get(found.bk.member_email);
  return { ...found, member, key: member ? "member:"+digest(String(member.email)) : "booking:"+found.bk.id };
}
function get(state,query,actor,c) {
  requireActor(actor,c); const r=resolve(state,query,c), stored=state.customerRecords?.get(r.key);
  const base={member:r.member?.id || "",name:r.bk.name || "",tel:r.bk.phone || "",email:r.bk.email || "",gender:["web","hotpepper"].includes(r.bk.source)?"":customerGender(r.bk.customer_gender),comment:r.bk.comment || ""};
  const history=[],candidates=[];
  for(const [date,ev] of state.events) for(const b of ev.bookings || []) {
    const same = b.id===r.bk.id || (r.member && b.member_email===r.member.email);
    const possible = !same && nameKey(b.name)===nameKey(r.bk.name) && emailKey(r.bk.email) && emailKey(b.email)===emailKey(r.bk.email) && phoneKey(r.bk.phone) && phoneKey(b.phone)===phoneKey(r.bk.phone);
    if(!same && !possible) continue;
    const row={id:b.id,reference:b.reference,date,start:b.start_at,end:b.end_at,status:b.status,menu:b.course_name || c.courseNameOf(b.course),total:b.total || 0,paidAmount:b.paid_amount || 0,paid:!!b.paid_at || b.paid_amount>0,comment:b.comment || "",
      staff:(ev.assignments || []).filter(x=>x.booking_id===b.id).map(x=>(state.staff.find(s=>s.id===x.staff_id) ? c.staffDisplayName(state.staff.find(s=>s.id===x.staff_id)) : "登録なし")).join("、")};
    (same?history:candidates).push(row);
  }
  const sort=(a,b)=>b.start-a.start;
  return {bookingId:r.bk.id,reference:r.bk.reference,revision:stored?.revision || 0,fields:{...base,...stored?.fields},history:history.sort(sort),candidates:candidates.sort(sort),identityBasis:r.member?"member":"booking",updatedAt:stored?.updatedAt || null};
}
function post(state,body,actor,c) {
  requireActor(actor,c); const r=resolve(state,body,c), old=state.customerRecords?.get(r.key);
  const key=String(body.requestKey || ""); if(!/^[\w-]{10,150}$/.test(key)) throw c.err(400,"invalid");
  const fingerprint=digest(JSON.stringify({bookingId:r.bk.id,fields:body.fields,actor:actor.user}));
  if(old?.requests?.some(x=>x.key===key)) { const saved=old.requests.find(x=>x.key===key); if(saved.fingerprint!==fingerprint) throw c.err(409,"requestChanged"); return {...saved.result}; }
  if(body.revision!==(old?.revision || 0)) throw c.err(409,"recordChanged");
  if(!body.fields || typeof body.fields!=="object" || Array.isArray(body.fields)) throw c.err(400,"invalid");
  const fields={}; for(const [k,max] of Object.entries(FIELDS)) {
    if(typeof body.fields[k]!=="string" && body.fields[k]!=null) throw c.err(400,"invalid");
    const raw=body.fields[k]??"", multiline=["comment","note1","note2"].includes(k);
    if((multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(raw)) throw c.err(400,"invalid");
    const v=raw.trim(); if(v.length>max) throw c.err(400,"invalid"); fields[k]=v;
  }
  if(!fields.name || !["","m","f","other"].includes(fields.gender) || !["","1","2","3","4","5"].includes(fields.rank)) throw c.err(400,"invalid");
  for(const k of ["email","email2"]) if(fields[k]&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields[k])) throw c.err(400,"invalid");
  if(fields.birthday) {
    const birthdayTime=Date.parse(fields.birthday+"T00:00:00Z");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fields.birthday) || !Number.isFinite(birthdayTime) || new Date(birthdayTime).toISOString().slice(0,10)!==fields.birthday || fields.birthday>new Date().toISOString().slice(0,10)) throw c.err(400,"invalid");
  }
  const revision=(old?.revision || 0)+1, result={ok:true,revision};
  const record={revision,fields,updatedAt:Date.now(),updatedBy:String(actor.user),requests:[...(old?.requests || []),{key,fingerprint,result}].slice(-100),history:[...(old?.history || []),{revision,at:Date.now(),by:String(actor.user),fields:old?.fields || null}]};
  if(!(state.customerRecords instanceof Map)) state.customerRecords=new Map(); state.customerRecords.set(r.key,record);
  return result;
}
function handle(req,res,url,state,actor,c) {
  if(url.pathname!=="/api/demo/customer-records") return false;
  const send=(status,body)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(req.method==="HEAD"?undefined:JSON.stringify(body));};
  const fail=e=>send(e.status || e.statusCode || 400,{error:["forbidden","notFound","recordChanged","requestChanged"].includes(e.message)?e.message:"invalid"});
  if(req.method==="GET" || req.method==="HEAD") {try{send(200,get(state,Object.fromEntries(url.searchParams),actor,c));}catch(e){fail(e);}return true;}
  if(req.method!=="POST"){send(405,{error:"method"});return true;}
  let raw="";req.on("data",chunk=>{raw+=chunk;if(raw.length>100000)req.destroy();});
  req.on("end",()=>{try{send(200,post(state,JSON.parse(raw || "{}"),actor,c));}catch(e){fail(e);}});return true;
}
module.exports={get,post,handle};
