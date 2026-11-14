'use strict';
function initialize(state, courses, photos, user, pass) {
  if (!process.env.TENANT_MODE || !process.env.DEMO_DATA || !process.env.TENANT_NAME || !user || !pass) throw Error('店舗の初期設定が不足しています');
  state.staff = []; state.ticketPlans.clear(); state.courses = []; courses.clear(); photos.clear();
  state.booths = [];
  const sm = state.settings.shopMaster;
  for (const k of Object.keys(sm)) if (typeof sm[k] === 'string') sm[k] = '';
  Object.assign(sm, { name: process.env.TENANT_NAME, shortName: process.env.TENANT_NAME, bizStart: 600, bizEnd: 1080, openStart: 600, openEnd: 1080, resStart: 600, resEnd: 1080, bgColor: 'brown', timeUnit: 'all', memberAuto: '無効', memberDigits: '3', memberNext: '1' });
  state.accounts = new Map([[user, { user, name: '管理者', role: 'admin', active: true, pass, createdAt: Date.now() }]]);
  state.mailRelay = { url: '', secret: '' }; state.mails = []; state.settings.mailI18n.enabled = false;
}
function publicData(state, courses) {
  const s = state.settings.shopMaster;
  return { name: s.name, phone: s.tel, address: [s.pref, s.address, s.address2].filter(Boolean).join(' '),
    openStart: s.openStart, openEnd: s.openEnd,
    courses: [...courses.values()].filter(c => c.active !== 0 && c.active !== false).map(c => ({ id: c.id, name: c.name, price: c.price, minutes: c.minutes, image: state.coursePhotoEdits?.get(c.id) ? '/api/demo/course-photo?id=' + encodeURIComponent(c.id) : '/tenant-placeholder.svg' })) };
}
function html(text, isHtml, data) {
  if (!isHtml) return text;
  const json = JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return text.replace('<head>', '<head><script>window.__TENANT__=' + json + '</script><script src="/tenant-ui.js" defer></script>');
}
module.exports = { initialize, publicData, html };
