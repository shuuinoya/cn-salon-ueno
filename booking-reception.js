'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 店舗全体のオンライン受付だけを停止する。予約・勤務・料金の保存データは触らない。
// 設定を毎回読むため、受付中の画面や日付の切り替わりでも停止が有効になる。
const settingsFile = path.join(__dirname, 'data', 'booking-reception.json');
function isSiteHidden() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')).siteHidden === true; }
  catch (error) { return error.code !== 'ENOENT'; }
}
function isPaused() {
  try {
    const setting = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return setting.siteHidden === true || setting.paused !== false;
  } catch (error) {
    // 未設定の既存店は従来どおり。設定が読めない／壊れた場合は勝手に受付を再開しない。
    return error.code !== 'ENOENT';
  }
}
function isBookingPage(pathname) {
  try { pathname = decodeURIComponent(pathname).replace(/\/+$/, ''); } catch { return false; }
  return ['/book', '/book/select-datetime', '/book/confirm'].includes(pathname);
}
// 非公開中も管理画面のログインと既存の認証・権限検査を維持する。
function hideRequest(pathname, adminSession) {
  let p;
  try { p = path.posix.normalize(decodeURIComponent(pathname)).replace(/\/+$/, '') || '/'; }
  catch { return true; }
  const lower = p.toLowerCase();
  if (lower === '/api/booking-reception') return false;
  if (lower === '/admin' || lower.startsWith('/admin/') || lower === '/admin-original' ||
      lower === '/demo/admin' || lower === '/cnsalon-board') return false;
  if (lower.startsWith('/api/demo/') || lower.startsWith('/api/partner/') || lower.startsWith('/api/cron/')) {
    return ['/api/demo/settings','/api/demo/staff-photo','/api/demo/course-photo'].includes(lower) && !adminSession;
  }
  if (lower.startsWith('/api/')) return !adminSession;
  // ログインに必要な共通の書式・文字・アイコンのみ公開のまま。予約用の保存済み画面部品は閉じる。
  if (!lower.startsWith('/_next/') && /\.(?:js|css|woff2?|ttf|ico|svg)$/.test(lower)) return false;
  if (adminSession && /\.(?:js|css|woff2?|ttf|png|jpe?g|webp|gif|ico|svg)$/.test(lower)) return false;
  return true;
}
module.exports = { isPaused, isSiteHidden, isBookingPage, hideRequest };
