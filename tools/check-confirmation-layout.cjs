'use strict';
// 送信・保存を一切使わず、料金表示の足し合わせと境界条件を確認する。
const assert = require('node:assert/strict');
const {priceRows, render} = require('../booking-confirmation-mail');
let checks = 0;
const baseBooking = { name:'【デモテスト】予約者', service_date:'2026-11-03', start_at:1793674800000, end_at:1793678400000, course_name:'全身整体 60分', nominated_staff_id:'test-A' };
const h = parts => ({parts, lead:'ご予約ありがとうございます。', dateTime:'2026年11月3日（火）12:00～', bookingId:'予約ID：TEST-1', nomination:'指名：テスト青山さん', ending:'ご来店を心よりお待ちしております。'});
for (const people of [1,2,3,4,6]) for (const unit of [0,100,6600,10001]) for (const percent of [0,10,15.5,100]) for (const bulk of [0,1,100]) for (const fee of [0,500,2500]) for (const night of [0,2000]) {
  const after = Math.floor(unit * (100-percent)/100), sum = after * people;
  if(bulk>sum) continue;
  const base=sum-bulk, late=night*people;
  const b={...baseBooking,people,total:base+fee+late,nomination_fee:fee,services:[{name:'【デモテスト】コース',price:unit,minutesBody:60,discountType:'percent',discount:percent}],bulk_discount_type:'amount',bulk_discount:bulk};
  const before=JSON.stringify(b), parts={people,base,fee,late}, rows=priceRows(b,parts);
  assert.equal(rows.reduce((n,x)=>n+x.subtotal,0),b.total);
  for(const row of rows) if(row.unit !== undefined) assert.equal(row.unit*row.count,row.subtotal);
  assert.equal(rows.filter(x=>x.kind==='nomination').length,fee>0?1:0);
  assert.equal(rows.filter(x=>x.kind==='adjustment').length,0);
  const body=render(b,h(parts));assert(body.includes(`合計金額：${b.total.toLocaleString('ja-JP')}円`));
  assert.equal(JSON.stringify(b),before); checks++;
}
// 複数の対象・異なる指名単価の記録。合計料から人数分を再加算しない。
for(const count of [1,2,3]) {
  const items=[{unit_price:2500,people:1,applies_to:'ご本人'},{unit_price:500,people:count,applies_to:`同行者${count}名`}];
  const fee=2500+500*count, b={...baseBooking,people:count+1,base_price:6600,total:6600*(count+1)+fee,nomination_fee:fee,nomination_fee_items:items};
  const parts={people:b.people,base:6600*b.people,fee,late:0},rows=priceRows(b,parts),body=render(b,h(parts));
  assert.equal(rows.reduce((n,x)=>n+x.subtotal,0),b.total);
  assert(body.includes(`500円 × ${count}名 ＝ ${(500*count).toLocaleString('ja-JP')}円（対象：同行者${count}名）`));
  assert(body.includes('2,500円 × 1名 ＝ 2,500円（対象：ご本人）')); checks++;
}
{
  const parts={people:3,base:19800,fee:2500,late:0},b={...baseBooking,people:3,base_price:6600,total:22300,nomination_fee:2500};
  const body=render(b,h(parts));
  assert(body.includes('人数：3名（ご本人＋同行者2名）'));assert(!body.includes('\n同行者1'));
  assert(body.includes('施術料金：6,600円 × 3名 ＝ 19,800円'));
  assert(body.endsWith('ご来店を心よりお待ちしております。'));
  assert(!body.includes('施術時間：60分'),'メニュー名の60分を重複表示しない');
  for(const lang of ['ja','en','zh','ko','fr','es','it','de']) {
    const text=render({...b,comment:'テスト要望 <>&',preferences:'テスト希望'},h(parts),lang);
    assert(text.includes('6,600円 × 3'));assert(text.includes(' ＝ 19,800円'));assert(text.includes('テスト要望 <>&'));assert(!text.includes('undefined'));checks++;
  }
  for(const items of [[{unit_price:500,people:2,applies_to:'同行者'}],[{unit_price:2500,people:0,applies_to:'ご本人'}],[]]) {
    const rows=priceRows({...b,nomination_fee_items:items},parts);
    assert.equal(rows.find(x=>x.kind==='nomination').subtotal,2500);assert.equal(rows.find(x=>x.kind==='nomination').count,undefined);checks++;
  }
  const old=priceRows({...b,total:23000}, {...parts,late:-1});
  assert.equal(old.find(x=>x.kind==='adjustment').subtotal,700);assert(!old.some(x=>x.kind==='night'));
  const missing=priceRows({...b,base_price:undefined}, {...parts,base:NaN,late:-1});
  assert.equal(missing.find(x=>x.kind==='unregistered').subtotal,19800);assert.equal(missing.reduce((n,x)=>n+x.subtotal,0),22300);checks+=2;
}
{
  const b={...baseBooking,people:2,total:24440,nomination_fee:0,services:[
    {name:'全身整体',price:6600,minutesBody:60,minutesBefore:10,minutesAfter:5,discountType:'percent',discount:10},
    {name:'足裏',price:5500,minutesBody:30,minutesBefore:0,minutesAfter:5,discountType:'amount',discount:1000}],bulk_discount_type:'amount',bulk_discount:440};
  b.total=(5940+4500)*2-440+4000;
  const parts={people:2,base:20440,fee:0,late:4000};
  const rows=priceRows(b,parts),body=render(b,h(parts));
  assert.equal(rows.reduce((n,x)=>n+x.subtotal,0),b.total);assert(body.includes('コース 1：全身整体'));assert(body.includes('コース 2：足裏'));
  assert(body.includes('施術時間：90分'));assert(!body.includes('指名料'));
  assert(body.includes('全体割引：-440円'));assert(body.includes('深夜料金：2,000円 × 2名 ＝ 4,000円'));
  const ticket={...b,people:1,ticket_id:'test-ticket',total:2500,nomination_fee:500};
  const ticketRows=priceRows(ticket,{people:1,base:0,fee:500,late:2000});
  assert.equal(ticketRows.reduce((n,x)=>n+x.subtotal,0),2500);assert.equal(ticketRows[0].kind,'ticket');checks+=2;
}
console.log(JSON.stringify({passed:checks,externalMail:false,persistentWrites:false}));
