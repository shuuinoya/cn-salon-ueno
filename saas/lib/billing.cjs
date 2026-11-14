'use strict';
const Stripe = require('stripe');
const { random, error } = require('./security.cjs');
const { transaction } = require('./database.cjs');
class Billing {
  constructor(config, db, client) {
    this.config=config; this.db=db; this.locks=new Map();
    this.client=client || (config.stripeKey ? new Stripe(config.stripeKey,{maxNetworkRetries:2,timeout:20000}) : null);
  }
  async locked(id, fn) {
    const previous=this.locks.get(id)||Promise.resolve();
    const result=previous.catch(()=>{}).then(fn); this.locks.set(id,result);
    try {return await result;} finally {if(this.locks.get(id)===result)this.locks.delete(id);}
  }
  ready() { if(!this.config.billingReady || !this.client) throw error(503,'お支払いの受付は準備中です。現在は課金されません'); }
  async price() {
    const p=await this.client.prices.retrieve(this.config.priceId);
    if(!p.active || p.livemode!==this.config.billingLive || p.currency!=='jpy' || p.unit_amount!==this.config.price || p.recurring?.interval!=='month' || p.recurring?.interval_count!==1 || p.tax_behavior!=='inclusive') throw error(503,'料金の設定確認が必要です。現在は課金されません');
  }
  async checkout(store, owner) {
    this.ready();
    return this.locked(store.id,async()=>{
      store=this.db.prepare('SELECT * FROM stores WHERE id=?').get(store.id);
      await this.price();
      if(store.customer) await this.refresh(store);
      store=this.db.prepare('SELECT * FROM stores WHERE id=?').get(store.id);
      if(store.subscription && ['active','trialing','past_due','unpaid','paused','incomplete'].includes(store.status)) throw error(409,'既存の契約があります。「請求・解約の管理」から確認してください');
      if(!store.customer){
        const customer=await this.client.customers.create({email:owner.email,name:store.name},{idempotencyKey:'store-customer-'+store.id});
        this.db.prepare('UPDATE stores SET customer=? WHERE id=?').run(customer.id,store.id); store.customer=customer.id;
      }
      if(store.checkout && store.checkout_expires>Date.now()){
        const old=await this.client.checkout.sessions.retrieve(store.checkout);
        if(old.status==='open')return {url:old.url};
        if(old.status==='complete')throw error(409,'お支払い結果を確認しています。少し待ってください');
      }
      // 失敗時にも同一キーで再試行する。キーを先に保存し、通信切断で二重請求させない。
      let operation=store.checkout;
      if(!operation || !operation.startsWith('pending:')){
        operation='pending:'+random();
        this.db.prepare('UPDATE stores SET checkout=?,checkout_url=NULL,checkout_expires=0 WHERE id=?').run(operation,store.id);
      }
      const subscriptionData={};
      if(store.trial_end>Date.now()+2*86400000)subscriptionData.trial_end=Math.floor(store.trial_end/1000);
      const result=await this.client.checkout.sessions.create({mode:'subscription',customer:store.customer,
        line_items:[{price:this.config.priceId,quantity:1}],subscription_data:subscriptionData,
        success_url:this.config.origin+'/dashboard?billing=processing',cancel_url:this.config.origin+'/dashboard',
        integration_identifier:'reservation_service_rsvspace',locale:'ja',
        custom_text:{submit:{message:'1店舗あたり月額14,800円（税込）。毎月自動更新。解約は請求・解約の管理から次回更新前までにお手続きください。'}}
      },{idempotencyKey:operation.slice(8)});
      this.db.prepare('UPDATE stores SET checkout=?,checkout_url=?,checkout_expires=? WHERE id=?').run(result.id,result.url,result.expires_at*1000,store.id);
      return {url:result.url};
    });
  }
  async portal(store) {
    this.ready(); if(!store.customer)throw error(409,'有料契約はまだありません');
    const s=await this.client.billingPortal.sessions.create({customer:store.customer,return_url:this.config.origin+'/dashboard'});
    return {url:s.url};
  }
  async refresh(store) {
    if(!store.customer)return;
    // 配送順に依存せず、Stripeの現在の契約を取得する。metadataで所有店舗を決めない。
    const list=await this.client.subscriptions.list({customer:store.customer,status:'all',limit:100,expand:['data.latest_invoice']});
    if(list.has_more)throw error(503,'契約の確認が必要です');
    const subs=list.data.filter(s=>s.livemode===this.config.billingLive && s.items.data.length===1 && s.items.data[0].price.id===this.config.priceId && s.items.data[0].quantity===1);
    const current=subs.filter(s=>!['canceled','incomplete_expired'].includes(s.status));
    if(current.length>1)throw error(503,'重複した契約の確認が必要です');
    const s=current[0]||subs.sort((a,b)=>b.created-a.created)[0];
    if(!s){
      if(store.subscription)this.db.prepare('UPDATE stores SET status=?,paid_until=0 WHERE id=?').run('requires_review',store.id);
      return;
    }
    const invoice=s.latest_invoice;
    const paid=s.status==='active' && invoice && typeof invoice==='object' && invoice.status==='paid';
    const until=s.status==='trialing' ? Math.min((s.trial_end||0)*1000,store.trial_end) : paid ? (s.items.data[0].current_period_end||0)*1000 : 0;
    this.db.prepare('UPDATE stores SET subscription=?,status=?,paid_until=?,cancel_at_end=? WHERE id=?').run(s.id,s.status,until,s.cancel_at_period_end?1:0,store.id);
  }
  async webhook(bytes,signature) {
    this.ready(); let event;
    try {event=this.client.webhooks.constructEvent(bytes,signature,this.config.webhookSecret);}catch{throw error(400,'署名を確認できません');}
    if(event.livemode!==this.config.billingLive)throw error(400,'決済環境が一致しません');
    if(this.db.prepare('SELECT id FROM stripe_events WHERE id=?').get(event.id))return;
    const accepted=['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed','invoice.payment_action_required','customer.subscription.trial_will_end'];
    if(!accepted.includes(event.type))return;
    const customer=typeof event.data.object.customer==='string'?event.data.object.customer:event.data.object.customer?.id;
    const store=this.db.prepare('SELECT * FROM stores WHERE customer=?').get(customer||'');
    if(!store) return;
    await this.locked(store.id,()=>this.refresh(store));
    transaction(this.db,()=>{
      this.db.prepare('INSERT OR IGNORE INTO stripe_events VALUES(?,?)').run(event.id,Date.now());
      this.db.prepare('INSERT INTO audit(kind,store_id,created) VALUES(?,?,?)').run(event.type,store.id,Date.now());
    });
  }
}
module.exports={Billing};
