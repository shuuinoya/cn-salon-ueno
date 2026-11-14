'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const { error } = require('./security.cjs');
class Workers {
  constructor(config) {
    this.config = config; this.items = new Map(); this.closing = false; this.queue = Promise.resolve();
    this.sockets = fs.mkdtempSync(path.join(os.tmpdir(),'reservation-')); fs.chmodSync(this.sockets,0o700);
  }
  async acquire(store, hold = true) {
    // 起動と入替だけを直列化する。同じ店舗の同時リクエストで二重起動しない。
    const previous = this.queue; let unlock;
    this.queue = new Promise(resolve => { unlock = resolve; });
    await previous;
    let item;
    try {
      if (this.closing) throw error(503,'ただいま停止処理中です');
      item = this.items.get(store.id);
      if (!item) {
        if (this.items.size >= this.config.maxWorkers) {
          const idle = [...this.items.values()].filter(i => i.busy === 0).sort((a,b) => a.last - b.last)[0];
          if (!idle) throw error(503,'ただいま混み合っています。少し待ってからお試しください');
          await this.stop(idle);
        }
        item = this.start(store);
      }
      if (hold) item.busy++;
      item.last = Date.now();
    } finally { unlock(); }
    let released = false;
    const release = () => { if (released) return; released = true; if (hold) item.busy--; item.last = Date.now(); };
    try { return { socket: await item.ready, release }; } catch (e) { release(); throw e; }
  }
  start(store) {
    const dir = path.join(this.config.data,'stores',store.id);
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const socket = path.join(this.sockets,store.id+'.sock');
    // 終了済みの子が残したソケットだけを除く（起動・終了は acquire 内で直列化）。
    fs.rmSync(socket,{force:true});
    // allowlist: 本番の鍵・バックアップ先・送信先は親から一切継承しない。
    const env = { PATH:process.env.PATH, LANG:'ja_JP.UTF-8', TZ:'Asia/Tokyo', CLOUD:'1', BIND:'127.0.0.1',
      PORT:'5611', PUBLIC_HOST:new URL(this.config.shopOrigin(store.slug)).hostname, PUBLIC_ORIGIN:this.config.shopOrigin(store.slug),
      IMAGE_CDN:'', DEMO_PERSIST:'1', DEMO_DATA:path.join(dir,'state.json'), HP_MAIL:'0', KEEP_AWAKE:'0',
      TENANT_MODE:'1', TENANT_SOCKET:socket, TENANT_NAME:store.name, TENANT_MAIL_ENABLED:this.config.mailEnabled?'1':'0',
      ADMIN_LOGIN_ID:store.admin_user, ADMIN_LOGIN_PREVIOUS_ID:'', ADMIN_PASS_HASH:store.admin_hash,
      ...(this.config.local ? { ALLOW_TEST_DATA:'1' } : {}) };
    const child = fork(path.join(__dirname,'../worker.cjs'),[],{env,stdio:['ignore','ignore','ignore','ipc']});
    const item = { child, socket, ready:null, busy:0, last:Date.now() };
    item.ready = new Promise((resolve,reject) => {
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(error(503,'店舗の準備に時間がかかっています')); },15000);
      child.once('message',m => { if (m.ready) { clearTimeout(timer); resolve(socket); } });
      child.once('error',() => { clearTimeout(timer); reject(error(503,'店舗を起動できませんでした')); });
      child.once('exit',() => { clearTimeout(timer); if (this.items.get(store.id) === item) this.items.delete(store.id); reject(error(503,'店舗を起動できませんでした')); });
    });
    this.items.set(store.id,item); return item;
  }
  stop({child}) {
    return new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => child.kill('SIGKILL'),8000);
      child.once('exit',() => {clearTimeout(timer);resolve();}); child.kill('SIGTERM');
    });
  }
  async close() {
    this.closing = true;
    await this.queue;
    await Promise.all([...this.items.values()].map(item => this.stop(item)));
    fs.rmSync(this.sockets,{recursive:true,force:true});
  }
}
module.exports = { Workers };
