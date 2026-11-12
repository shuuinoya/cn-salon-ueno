'use strict';
const crypto = require('node:crypto');
const net = require('node:net');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const emailValid = value => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
const failure = (message, status = 401, retry) => Object.assign(new Error(message), { status, retry });

function config(env = process.env) {
  const user = String(env.ADMIN_OWNER_USER || '').trim();
  const email = String(env.ADMIN_OWNER_EMAIL || '').trim().toLowerCase();
  const identity = String(env.ADMIN_OWNER_TAILSCALE_LOGIN || '').trim();
  const enabled = !!(user || email || identity);
  return { user, email, identity, enabled, valid: !!(user && emailValid(email) && identity) };
}
function networkAllowed(req, env = process.env) {
  const c = config(env);
  if (!c.enabled) return true;
  if (!c.valid || env.TRUST_PROXY !== 'tailscale') return false;
  const ip = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const h = req.headers || {};
  const forwarded = typeof h['x-forwarded-for'] === 'string' ? h['x-forwarded-for'].split(',').pop().trim() : '';
  // 身元を保証するのはローカルのTailscaleだけ。外部・直接接続の自己申告は信用しない。
  return (ip === '127.0.0.1' || ip === '::1') && !!net.isIP(forwarded) &&
    !Object.hasOwn(h, 'tailscale-funnel-request') && h['tailscale-user-login'] === c.identity;
}
function protectedPath(pathname, method, host) {
  let p;
  try { p = decodeURIComponent(pathname).toLowerCase(); } catch { return true; }
  if (p === '/' && /^cnsalon-board(?:\.localhost|\.local)?(?::\d+)?$/i.test(host || '')) return true;
  const publicGet = ['GET', 'HEAD'].includes(method) &&
    ['/api/demo/settings', '/api/demo/course-photo', '/api/demo/staff-photo'].includes(p);
  return p === '/cnsalon-board' || p.startsWith('/cnsalon-board/') || p === '/admin' || p.startsWith('/admin/') ||
    p === '/admin-original' || p === '/demo/admin' || p.startsWith('/api/partner/') ||
    (p.startsWith('/api/demo/') && !publicGet);
}
function policyFor(account, env = process.env) {
  const c = config(env);
  return digest(JSON.stringify([c.user, c.email, c.identity, account.pass]));
}
function sessionAllowed(req, session, account, env = process.env) {
  const c = config(env);
  return !c.enabled || (c.valid && account.user === c.user && networkAllowed(req, env) &&
    !!session.ownerVerifiedAt && session.ownerPolicy === policyFor(account, env));
}
function challengeCookie(req) {
  return /(?:^|;\s*)pm_owner_challenge=([a-f0-9]{48})(?:;|$)/.exec(req.headers?.cookie || '')?.[1] || '';
}
function clientKey(req) {
  return digest(JSON.stringify([req.headers?.['tailscale-user-login'] || '',
    req.clientIp || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '']));
}

// 確認番号はメモリ上のハッシュだけ。保存データ・メール一覧・応答へ出さない。
class OwnerChallenges {
  constructor({ now = Date.now, env = process.env } = {}) {
    this.now = now; this.env = env; this.pending = new Map(); this.rates = new Map();
  }
  async issue(req, account, send) {
    const c = config(this.env), now = this.now();
    if (!c.valid || !account.active || account.user !== c.user || !networkAllowed(req, this.env)) throw failure('invalidLogin');
    for (const [id, p] of this.pending) if (p.expires <= now) this.pending.delete(id);
    for (const [key, times] of this.rates) {
      const keep = times.filter(t => t > now - 3600000);
      if (keep.length) this.rates.set(key, keep); else this.rates.delete(key);
    }
    const key = clientKey(req), times = this.rates.get(key) || [];
    const wait = times.length >= 10 ? Math.ceil((times[0] + 3600000 - now) / 1000)
      : times.length && now - times.at(-1) < 60000 ? Math.ceil((times.at(-1) + 60000 - now) / 1000) : 0;
    if (wait) throw failure('tooManyAttempts', 429, wait);
    if (this.pending.size >= 1000) throw failure('ownerCodeUnavailable', 503);
    this.rates.set(key, [...times, now]);
    this.pending.delete(challengeCookie(req));
    const id = crypto.randomBytes(24).toString('hex'), code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const pending = { user: account.user, policy: policyFor(account, this.env), client: key,
      hash: digest(id + code), expires: now + 600000, attempts: 0, ready: false };
    this.pending.set(id, pending);
    try { await send(c.email, code); } catch {
      this.pending.delete(id); throw failure('ownerCodeUnavailable', 503);
    }
    pending.ready = true;
    return { id, expiresIn: 600 };
  }
  verify(req, code, accounts) {
    const id = challengeCookie(req), p = this.pending.get(id), now = this.now();
    const account = p && accounts.get(p.user), c = config(this.env);
    if (!p || !p.ready || p.expires <= now || !c.valid || !account?.active || account.user !== c.user ||
      p.policy !== policyFor(account, this.env) || !networkAllowed(req, this.env) || p.client !== clientKey(req)) {
      if (p) this.pending.delete(id);
      throw failure('ownerCodeExpired');
    }
    p.attempts++;
    const ok = typeof code === 'string' && /^\d{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(p.hash, 'hex'), Buffer.from(digest(id + code), 'hex'));
    if (!ok) {
      if (p.attempts >= 5) { this.pending.delete(id); throw failure('ownerCodeExpired'); }
      throw failure('invalidOwnerCode');
    }
    this.pending.delete(id); // 番号の再利用・同時送信での再ログインを拒否
    return { account, ownerVerifiedAt: now, ownerPolicy: p.policy };
  }
}
module.exports = { config, networkAllowed, protectedPath, sessionAllowed, OwnerChallenges };
