'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Stripe=require('stripe');
const {Billing}=require('../lib/billing.cjs');
const {openDatabase,allowed}=require('../lib/database.cjs');
const {config}=require('../lib/config.cjs');
function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'billing-test-')),db=openDatabase(dir),now=Date.now();
  db.prepare('INSERT INTO owners VALUES(?,?,?,?)').run('owner','test@example.test','unused',now);
  db.prepare('INSERT INTO stores(id,owner,slug,name,admin_user,admin_hash,created,trial_end,customer) VALUES(?,?,?,?,?,?,?,?,?)').run('store','owner','test','テスト店舗','owner','unused',now,now+14*86400000,'cus_test');
  const c={billingReady:true,billingLive:false,price:14800,priceId:'price_test',webhookSecret:'whsec_unit_test_only',origin:'http://localhost:5619'};
  const sdk=new Stripe('sk_test_placeholder_for_offline_test');let calls=0,subs=[];
  const client={prices:{retrieve:async()=>({active:true,livemode:false,currency:'jpy',unit_amount:14800,recurring:{interval:'month',interval_count:1},tax_behavior:'inclusive'})},
    subscriptions:{list:async()=>({data:subs,has_more:false})},
    checkout:{sessions:{create:async(args)=>{calls++;assert.equal(args.payment_method_types,undefined);assert.deepEqual(args.automatic_tax,{enabled:true});assert.equal(args.billing_address_collection,'required');assert.deepEqual(args.customer_update,{address:'auto'});return {id:'cs_test',url:'https://checkout.stripe.com/test',expires_at:Math.floor(Date.now()/1000)+1800};},retrieve:async()=>({status:'open',url:'https://checkout.stripe.com/test'})}},webhooks:sdk.webhooks};
  const billing=new Billing(c,db,client),store=()=>db.prepare('SELECT * FROM stores WHERE id=?').get('store');
  return{db,c,client,billing,store,calls:()=>calls,setSubs:v=>subs=v,close:()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('同時申込みで支払いページが二重作成されない',async()=>{const t=setup();try{await Promise.all(Array.from({length:12},()=>t.billing.checkout(t.store(),{email:'test@example.test'})));assert.equal(t.calls(),1);}finally{t.close();}});
test('無料期間の残りが48時間未満でも前倒しで課金しない',async()=>{
 const t=setup();try{t.db.prepare('UPDATE stores SET trial_end=? WHERE id=?').run(Date.now()+86400000,'store');await assert.rejects(()=>t.billing.checkout(t.store(),{email:'test@example.test'}),/無料期間が終了してから/);assert.equal(t.calls(),0);t.db.prepare('UPDATE stores SET trial_end=? WHERE id=?').run(Date.now()-1000,'store');await t.billing.checkout(t.store(),{email:'test@example.test'});assert.equal(t.calls(),1);}finally{t.close();}
});
test('税設定が未確認の間は本番請求を開始できない',()=>{
  const env={SERVICE_ORIGIN:'https://service.example.test',TENANT_DOMAIN:'stores.example.test',BILLING_LIVE:'1',LEGAL_APPROVED:'1',SELLER_NAME:'テスト事業者',SELLER_ADDRESS:'テスト住所',SELLER_PHONE:'000',SELLER_EMAIL:'test@example.test',STRIPE_RESTRICTED_KEY:'placeholder',STRIPE_PRICE_ID:'price_test',STRIPE_WEBHOOK_SECRET:'placeholder'};
  assert.equal(config(env).billingReady,false);
  assert.equal(config({...env,STRIPE_TAX_VERIFIED:'1'}).billingReady,true);
  assert.equal(config({...env,STRIPE_TAX_VERIFIED:'1',LEGAL_APPROVED:'0'}).billingReady,false);
});
test('価格違い、署名不正、未払いを拒否し、最新状態で再送を処理する',async()=>{
  const t=setup();try{
    const original=t.client.prices.retrieve;t.client.prices.retrieve=async()=>({...await original(),unit_amount:100});
    await assert.rejects(()=>t.billing.checkout(t.store(),{email:'test@example.test'}),/料金の設定確認/);assert.equal(t.calls(),0);t.client.prices.retrieve=original;
    await assert.rejects(()=>t.billing.webhook(Buffer.from('{}'),'bad'),/署名/);
    const sub={id:'sub_test',livemode:false,created:100,status:'active',cancel_at_period_end:false,items:{data:[{price:{id:'price_test'},quantity:1,current_period_end:Math.floor(Date.now()/1000)+86400}]},latest_invoice:{status:'open'}};
    t.setSubs([sub]);await t.billing.refresh(t.store());assert.equal(allowed(t.store()),false,'完了画面だけでは利用権を付けない');
    sub.latest_invoice.status='paid';
    const event={id:'evt_test',livemode:false,type:'invoice.paid',data:{object:{customer:'cus_test'}},created:1};
    const raw=JSON.stringify(event);const signature=t.client.webhooks.generateTestHeaderString({payload:raw,secret:t.c.webhookSecret});
    await t.billing.webhook(Buffer.from(raw),signature);assert.equal(allowed(t.store()),true);
    await t.billing.webhook(Buffer.from(raw),signature);assert.equal(t.db.prepare('SELECT count(*) n FROM stripe_events').get().n,1);
    sub.status='past_due';await t.billing.refresh(t.store());assert.equal(allowed(t.store()),false);
    sub.status='active';sub.cancel_at_period_end=true;await t.billing.refresh(t.store());assert.equal(allowed(t.store()),true,'期間末の解約予定は期限まで利用可能');
    sub.items.data[0].quantity=2;await t.billing.refresh(t.store());assert.equal(allowed(t.store()),false,'有効な契約でも数量の変更を検出して停止');
    sub.items.data[0].quantity=1;await t.billing.refresh(t.store());assert.equal(allowed(t.store()),true);
    sub.status='canceled';await t.billing.refresh(t.store());assert.equal(allowed(t.store()),false,'解約済みは利用停止');
    sub.status='active';sub.items.data[0].quantity=2;await t.billing.refresh(t.store());assert.equal(allowed(t.store()),false,'不正な数量で利用権を復活しない');
  }finally{t.close();}
});
