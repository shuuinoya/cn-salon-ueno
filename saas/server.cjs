'use strict';
process.umask(0o077);
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {config}=require('./lib/config.cjs');
const {openDatabase,transaction,allowed}=require('./lib/database.cjs');
const sec=require('./lib/security.cjs');
const {Workers}=require('./lib/workers.cjs');
const {Billing}=require('./lib/billing.cjs');
function createService(c=config(),client) {
  const db=openDatabase(c.data),workers=new Workers(c),billing=new Billing(c,db,client);
  const publicStore=s=>({id:s.id,name:s.name,slug:s.slug,adminUser:s.admin_user,status:s.status,trialEnd:s.trial_end,paidUntil:s.paid_until,cancelAtEnd:!!s.cancel_at_end,bookingAllowed:allowed(s),bookingUrl:c.shopOrigin(s.slug),adminUrl:c.shopOrigin(s.slug)+'/cnsalon-board'});
  const ownerOf=req=>{const user=sec.session(db,req);if(!user)throw sec.error(401,'ログインしてください');return user;};
  const storeOf=(owner,id)=>{const store=db.prepare('SELECT * FROM stores WHERE id=? AND owner=?').get(id,owner.id);if(!store)throw sec.error(404,'店舗が見つかりません');return store;};
  async function handler(req,res) {
    sec.headers(res);
    try{
      if(!req.url.startsWith('/')||req.url.startsWith('//'))throw sec.error(400,'住所が正しくありません');
      const host=String(req.headers.host||'').toLowerCase();
      const url=new URL(req.url,c.origin);
      const suffix='.'+c.tenantDomain+(new URL(c.origin).port?':'+new URL(c.origin).port:'');
      let shop=null;
      if(host!==c.hostname){
        if(!host.endsWith(suffix))throw sec.error(404,'店舗が見つかりません');
        const slug=host.slice(0,-suffix.length);
        if(!/^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$/.test(slug))throw sec.error(404,'店舗が見つかりません');
        shop=db.prepare('SELECT * FROM stores WHERE slug=?').get(slug);
        if(!shop)throw sec.error(404,'店舗が見つかりません');
      }
      const ra=req.socket.remoteAddress||'';
      const trusted=c.trustedProxy && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ra);
      const ip=trusted?String(req.headers['x-forwarded-for']||ra).split(',').at(-1).trim():ra;
      const isWrite=!['GET','HEAD'].includes(req.method);
      if(isWrite && !(host===c.hostname && url.pathname==='/api/billing/webhook')){
        const expected=shop?c.shopOrigin(shop.slug):c.origin;
        if(req.headers.origin!==expected)throw sec.error(403,'この画面から操作し直してください');
      }
      if(shop){
        sec.rate(db,'shop:'+ip,4000,60000);
        if(url.pathname==='/api/service-status')return sec.json(res,200,{bookingAllowed:allowed(shop)});
        if(url.pathname==='/https-setup'||url.pathname==='/ca.crt'||url.pathname.startsWith('/api/partner/'))throw sec.error(404,'ページが見つかりません');
        if(isWrite && !allowed(shop) && !['/api/demo/login','/api/demo/logout','/api/member/login','/api/member/logout','/api/bookings/cancel'].includes(url.pathname))throw sec.error(402,'契約期間が終了したため新しい受付を停止しています');
        const stream=['/api/live','/api/demo/events'].includes(url.pathname);
        const lease=await workers.acquire(shop,!stream),socketPath=lease.socket;
        if(res.destroyed){lease.release();return;}
        res.once('close',lease.release);
        const headers={...req.headers,host,'x-forwarded-for':ip,'x-forwarded-proto':c.local?'http':'https'};
        for(const key of Object.keys(headers))if(/^(cf-|tailscale-|x-forwarded-host|forwarded$|connection$)/i.test(key))delete headers[key];
        // 公開先のCSPは既存アプリのものを使う。圧縮も元のアプリで行う。
        const upstream=http.request({socketPath,path:req.url,method:req.method,headers},incoming=>{
          for(const [k,v]of Object.entries(incoming.headers))if(v!==undefined)res.setHeader(k,v);
          res.writeHead(incoming.statusCode); incoming.pipe(res);
        });
        upstream.setTimeout(stream?0:30000,()=>upstream.destroy());
        upstream.on('error',()=>{if(!res.headersSent)sec.json(res,503,{error:'接続できません。少し待って再度お試しください'});else res.destroy();});
        req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);return;
      }
      if(url.pathname==='/api/billing/webhook'&&req.method==='POST'){
        const bytes=await sec.body(req,1048576,true);await billing.webhook(bytes,req.headers['stripe-signature']);return sec.json(res,200,{received:true});
      }
      sec.rate(db,'portal:'+ip,300,60000);
      if(url.pathname==='/api/config'&&req.method==='GET')return sec.json(res,200,{name:c.title,price:c.price,trialDays:c.trialDays,billingReady:c.billingReady,live:c.billingLive,signupOpen:c.signupOpen,seller:c.seller,legalApproved:c.legalApproved,local:c.local});
      if(url.pathname==='/health'&&req.method==='GET')return sec.json(res,200,{ok:true});
      if(url.pathname==='/api/register'&&req.method==='POST'){
        sec.rate(db,'register:'+ip,5,3600000);
        if(!c.signupOpen)throw sec.error(503,'店舗の受付は準備中です');
        const b=await sec.body(req);
        if(!c.local && (!c.signupCode || b.inviteCode!==c.signupCode))throw sec.error(403,'開設案内に記載の招待番号を入力してください');
        const email=String(b.email||'').trim().toLowerCase(), password=String(b.password||''),name=String(b.storeName||'').trim(),slug=String(b.slug||'').trim().toLowerCase();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||password.length<12||password.length>128||!name||name.length>80||!(/^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$/.test(slug))||['www','admin','mail','support','api','app','billing','dashboard'].includes(slug)||b.acceptTerms!==true)throw sec.error(400,'店舗名・メール・12文字以上のパスワード・4〜32文字の店舗アドレス・利用条件への同意を確認してください');
        const hash=await sec.passwordHash(password),owner=crypto.randomUUID(),id=crypto.randomBytes(12).toString('hex'),now=Date.now();
        try{transaction(db,()=>{
          db.prepare('INSERT INTO owners VALUES(?,?,?,?)').run(owner,email,hash,now);
          db.prepare('INSERT INTO stores(id,owner,slug,name,admin_user,admin_hash,created,trial_end) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,slug,name,'owner',sec.digest(password),now,now+c.trialDays*86400000);
        });}catch(e){if(e.code?.includes('SQLITE_CONSTRAINT')||/UNIQUE constraint failed/.test(e.message))throw sec.error(409,'このメールまたは店舗アドレスは登録済みです');throw e;}
        sec.setSession(db,res,owner,!c.local);return sec.json(res,201,{ok:true});
      }
      if(url.pathname==='/api/login'&&req.method==='POST'){
        sec.rate(db,'login:'+ip,20,900000);const b=await sec.body(req);
        const email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
        if(password.length>128)throw sec.error(400,'入力内容を確認してください');
        const owner=db.prepare('SELECT * FROM owners WHERE email=?').get(email);
        if(!await sec.checkPassword(password,owner?.password))throw sec.error(401,'メールまたはパスワードが違います');
        sec.setSession(db,res,owner.id,!c.local);return sec.json(res,200,{ok:true});
      }
      if(url.pathname==='/api/logout'&&req.method==='POST'){
        const token=/(?:^|;\s*)service_session=([a-f0-9]{64})/.exec(req.headers.cookie||'')?.[1];
        if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(sec.digest(token));
        res.setHeader('Set-Cookie','service_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return sec.json(res,200,{ok:true});
      }
      if(url.pathname==='/api/me'&&req.method==='GET'){
        const owner=ownerOf(req);return sec.json(res,200,{email:owner.email,stores:db.prepare('SELECT * FROM stores WHERE owner=? ORDER BY created').all(owner.id).map(publicStore)});
      }
      const match=/^\/api\/stores\/([a-f0-9]{24})\/(checkout|portal|refresh)$/.exec(url.pathname);
      if(match&&req.method==='POST'){
        const owner=ownerOf(req),store=storeOf(owner,match[1]);sec.rate(db,'billing:'+owner.id,30,60000);
        if(match[2]==='checkout')return sec.json(res,200,await billing.checkout(store,owner));
        if(match[2]==='portal')return sec.json(res,200,await billing.portal(store));
        billing.ready();await billing.locked(store.id,()=>billing.refresh(store));return sec.json(res,200,{ok:true});
      }
      if(req.method==='GET'||req.method==='HEAD'){
        const file={'/':'index.html','/register':'index.html','/login':'index.html','/dashboard':'index.html','/terms':'index.html','/privacy':'index.html','/legal':'index.html','/app.js':'app.js','/style.css':'style.css','/profit':'profit.html','/profit.js':'profit.js'}[url.pathname];
        if(file){res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.writeHead(200);return res.end(req.method==='HEAD'?undefined:fs.readFileSync(path.join(__dirname,'public',file)));}
      }
      throw sec.error(404,'ページが見つかりません');
    }catch(e){if(!res.headersSent)sec.json(res,e.status||500,{error:e.status?e.message:'処理できませんでした。時間をおいてお試しください'});else res.destroy();}
  }
  const server=http.createServer(handler);server.requestTimeout=45000;server.headersTimeout=15000;
  return {server,db,workers,billing,async close(){server.close();server.closeAllConnections();await workers.close();db.close();}};
}
if(require.main===module){
  const c=config(); if(!fs.existsSync(path.join(__dirname,'runtime/build.json')))throw Error('先に npm run build を実行してください');
  fs.mkdirSync(c.data,{recursive:true,mode:0o700});
  const lock=path.join(c.data,'service.lock');
  try{fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});}catch{throw Error('同じ保存先のサービスが起動中か、前回の起動記録が残っています。二重起動はできません');}
  const service=createService(c);let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await service.close();fs.unlinkSync(lock);process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  service.server.on('error',async()=>{await service.close();fs.unlinkSync(lock);process.exit(1);});
  service.server.listen(c.port,c.bind,()=>console.log('店舗向けサービス: '+c.origin+' （本番のCNsalonとは別の保存先です）'));
}
module.exports={createService};
