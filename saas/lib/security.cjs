'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const digest = s => crypto.createHash('sha256').update(s).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
async function passwordHash(password) {
  const salt = random(), result = await scrypt(password, salt, 64);
  return salt + ':' + result.toString('hex');
}
async function checkPassword(password, encoded) {
  const [salt, hash] = String(encoded || '').split(':');
  const result = await scrypt(password, salt || 'missing-account', 64);
  return !!hash && hash.length === 128 && crypto.timingSafeEqual(result, Buffer.from(hash,'hex'));
}
function error(status, message) { return Object.assign(new Error(message), { status }); }
function json(res, status, value) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(value)); }
async function body(req, max = 32768, raw = false) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) throw error(413,'送信内容が大きすぎます'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  if (raw) return bytes;
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw error(415,'JSON形式で送信してください');
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw error(400,'入力内容を確認してください'); }
}
function rate(db, key, max, duration) {
  const now = Date.now();
  db.prepare('DELETE FROM limits WHERE expires < ?').run(now);
  db.prepare('INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now+duration);
  if (db.prepare('SELECT count FROM limits WHERE key=?').get(key).count > max) throw error(429,'操作が続いています。時間をおいてお試しください');
}
function session(db, req) {
  const token = /(?:^|;\s*)service_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  return db.prepare('SELECT owners.* FROM owners JOIN sessions ON sessions.owner=owners.id WHERE sessions.token=? AND sessions.expires>?').get(digest(token), Date.now());
}
function setSession(db, res, owner, secure) {
  const token = random();
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),owner,Date.now()+7*86400000);
  res.setHeader('Set-Cookie', `service_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure?'; Secure':''}`);
}
function headers(res) {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}
module.exports = { digest, random, passwordHash, checkPassword, error, json, body, rate, session, setSession, headers };
