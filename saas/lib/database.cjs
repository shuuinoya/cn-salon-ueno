'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
function openDatabase(dir) {
  fs.mkdirSync(dir, { recursive:true, mode:0o700 }); fs.chmodSync(dir, 0o700);
  const file = path.join(dir, 'service.sqlite');
  const db = new DatabaseSync(file);
  fs.chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS owners(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES owners(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES owners(id),slug TEXT UNIQUE NOT NULL,name TEXT NOT NULL,
      admin_user TEXT NOT NULL,admin_hash TEXT NOT NULL,created INTEGER NOT NULL,trial_end INTEGER NOT NULL,
      customer TEXT UNIQUE,subscription TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'trial',paid_until INTEGER NOT NULL DEFAULT 0,
      cancel_at_end INTEGER NOT NULL DEFAULT 0,checkout TEXT,checkout_url TEXT,checkout_expires INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS stripe_events(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,store_id TEXT,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
  return db;
}
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const v = fn(); db.exec('COMMIT'); return v; } catch(e) { db.exec('ROLLBACK'); throw e; }
}
function allowed(store, now = Date.now()) {
  return store && ((store.status === 'trial' && store.trial_end > now) || (['active','trialing'].includes(store.status) && store.paid_until > now));
}
module.exports = { openDatabase, transaction, allowed };
