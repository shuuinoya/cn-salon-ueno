'use strict';
const path = require('node:path');
function config(env = process.env) {
  const origin = new URL(env.SERVICE_ORIGIN || 'http://localhost:5610');
  const local = origin.hostname === 'localhost';
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || (!local && origin.protocol !== 'https:')) throw Error('SERVICE_ORIGIN は HTTPS の住所だけを設定してください');
  const tenantDomain = env.TENANT_DOMAIN || (local ? 'localhost' : '');
  if (!/^[a-z0-9.-]+$/.test(tenantDomain) || (!local && (!tenantDomain || tenantDomain === 'localhost'))) throw Error('店舗用ドメインを指定してください');
  if (/cn-salon\.taila11357\.ts\.net|onrender\.com/.test(origin.host + tenantDomain)) throw Error('既存店舗の公開先は使えません');
  const c = { origin: origin.origin, hostname: origin.host, tenantDomain, local, port: Number(env.SERVICE_PORT || origin.port || 5610),
    bind: env.SERVICE_BIND || '127.0.0.1', data: path.resolve(env.SERVICE_DATA || path.join(__dirname, '../data')),
    title: env.SERVICE_NAME || '店舗向け予約サービス', price: 14800, trialDays: 14,
    signupCode: env.SIGNUP_CODE || '', signupOpen: local || env.SIGNUP_OPEN === '1',
    stripeKey: env.STRIPE_RESTRICTED_KEY || '', priceId: env.STRIPE_PRICE_ID || '', webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    billingLive: env.BILLING_LIVE === '1', seller: { name: env.SELLER_NAME || '', address: env.SELLER_ADDRESS || '', phone: env.SELLER_PHONE || '', email: env.SELLER_EMAIL || '' },
    legalApproved: env.LEGAL_APPROVED === '1', maxWorkers: Number(env.MAX_ACTIVE_STORES || 16), mailEnabled: env.TENANT_MAIL_ENABLED === '1',
    trustedProxy: env.TRUST_LOCAL_PROXY === '1' };
  c.billingReady = !!(c.stripeKey && c.priceId && c.webhookSecret && (!c.billingLive || (!local && c.legalApproved && Object.values(c.seller).every(Boolean))));
  c.shopOrigin = slug => `${origin.protocol}//${slug}.${tenantDomain}${origin.port ? ':' + origin.port : ''}`;
  if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535 || !Number.isInteger(c.maxWorkers) || c.maxWorkers < 1 || c.maxWorkers > 256) throw Error('起動設定が不正です');
  return c;
}
module.exports = { config };
