'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 店舗全体のオンライン受付だけを停止する。予約・勤務・料金の保存データは触らない。
// 設定を毎回読むため、受付中の画面や日付の切り替わりでも停止が有効になる。
const settingsFile = path.join(__dirname, 'data', 'booking-reception.json');
function isPaused() {
  try {
    const setting = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return setting.paused !== false;
  } catch (error) {
    // 未設定の既存店は従来どおり。設定が読めない／壊れた場合は勝手に受付を再開しない。
    return error.code !== 'ENOENT';
  }
}
function isBookingPage(pathname) {
  try { pathname = decodeURIComponent(pathname).replace(/\/+$/, ''); } catch { return false; }
  return ['/book', '/book/select-datetime', '/book/confirm'].includes(pathname);
}
module.exports = { isPaused, isBookingPage };
