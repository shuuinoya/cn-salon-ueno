'use strict';
// 元サイトは編集しない。追跡済みのプログラムだけから、空の店舗用コピーを生成する。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'runtime');
const translations = require('./tenant/translations.cjs');
function once(s, from, to) {
  if (s.split(from).length !== 2) throw Error('元プログラムの構成が変わりました: ' + from.slice(0, 70));
  return s.replace(from, () => to);
}
function replaceLiteral(s, name, value) {
  const start = s.indexOf('const ' + name + ' = ');
  if (start < 0) throw Error('定数がありません: ' + name);
  let i = start + ('const ' + name + ' = ').length, begin = i, depth = 0, quote = '', comment = '';
  for (; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (['"', "'", '`'].includes(c)) { quote = c; continue; }
    if ('{[('.includes(c)) depth++;
    if ('}])'.includes(c)) depth--;
    if (c === ';' && depth === 0) return s.slice(0, begin) + value + s.slice(i);
  }
  throw Error('定数を読み取れません: ' + name);
}
function scrub(s) {
  return s
    .replace(/Ueno spa&(?:amp;)?massage CN Health &(?:amp;)? Beauty SALON|UENO CN health＆beauty salon|CN Ueno health &(?:amp;)? beauty/g, 'TENANT_NAME')
    .replace(/CNsalon@board/g, '店舗管理')
    .replace(/CN He\.\.\./g, '店舗')
    .replace(/cnsalon2021@gmail\.com/g, '')
    .replace(/03-6806-0324|0368060324/g, '')
    .replace(/(?:東京都)?台東区上野[４4]丁目[８8][−－-][６6]プラザ[ＵU]ビル[　 ]*3階/g, '')
    .replace(/https:\/\/cn-salon[^\s"'`<>\\]*/g, '/')
    .replace(/https:\/\/online\.peakmanager\.com[^\s"'`<>\\]*/g, '/')
    .replace(/https:\/\/www\.google\.com\/maps\?[^"'<>\s]*?(?=\\"|"|')/g, 'about:blank')
    .replace(/久高（管理者）|大水[　 ]*寛/g, '管理者');
}
function build() {
  fs.mkdirSync(out, { recursive: true });
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const allowed = files.filter(f => (/^[^/]+\.js$/.test(f) || f === 'routes.json' || /^(pages|public)\//.test(f)) && !/\.(webp|jpe?g|png|gif|map)$/i.test(f));
  for (const f of allowed) {
    const src = path.join(root, f), dst = path.join(out, f);
    if (!fs.statSync(src).isFile()) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (/\.(woff2?|ttf|ico)$/.test(f)) { fs.copyFileSync(src, dst); continue; }
    let s = fs.readFileSync(src, 'utf8');
    if (f === 'demo-api.js') {
      for (const [k, v] of Object.entries({ COURSE_SEED: '{}', COURSE_PHOTO_SEED: '{}', STAFF_SEED: '[]', FIXED_SHIFTS: '{}' })) s = replaceLiteral(s, k, v);
      s = once(s, 'const persistReady = (() => {', "require('./tenant-runtime.cjs').initialize(state, courseStore, coursePhotos, ADMIN_ID, ADMIN_PASS_HASH);\nconst persistReady = (() => {");
      s = once(s, 'function loadMailConfig() {', "function loadMailConfig() {\n  if (process.env.TENANT_MAIL_ENABLED !== '1') return null;");
      s = once(s, 'if (process.env.ADMIN_PASS_HASH && state.accounts.has(ADMIN_ID)) {', 'if (!process.env.TENANT_MODE && process.env.ADMIN_PASS_HASH && state.accounts.has(ADMIN_ID)) {');
      s = replaceLiteral(s, 'STORE_NAME', 'process.env.TENANT_NAME');
      s = replaceLiteral(s, 'MAIL_STORE', 'process.env.TENANT_NAME');
      s = replaceLiteral(s, 'MAIL_ADDR', '""'); s = replaceLiteral(s, 'MAIL_TEL', '""'); s = replaceLiteral(s, 'VISIT_CONTACT_MAIL', '""');
      // 送信時の店舗情報を使う。元店の連絡先や購入案内を引き継がない。
      for (const k of ['MAIL_STORE', 'MAIL_ADDR', 'MAIL_TEL', 'VISIT_CONTACT_MAIL']) s = s.replace('const ' + k + ' =', 'let ' + k + ' =');
      s = once(s, 'function handleDemoApi(req, res, url) {', 'function handleDemoApi(req, res, url) {\n  const tenantShop = state.settings.shopMaster; MAIL_STORE = tenantShop.name; MAIL_ADDR = [tenantShop.pref, tenantShop.address, tenantShop.address2].filter(Boolean).join(" "); MAIL_TEL = tenantShop.tel; VISIT_CONTACT_MAIL = tenantShop.email;');
      s = replaceLiteral(s, 'MAIL_COMMON', '""');
      s += '\nmodule.exports.tenantPublic = () => require("./tenant-runtime.cjs").publicData(state, courseStore);\n';
    }
    if (f === 'booth-policy.js') {
      s = replaceLiteral(s, 'SOURCE_BOOTHS', '[]');
      s = replaceLiteral(s, 'SOURCE_COURSES', '[]');
    }
    if (f === 'server.js') {
      s = s.replace(/^.*if \(PUBLIC_HOSTS\[0\] && PUBLIC_HOSTS\[0\] !== "cn-salon-ueno\.onrender\.com"\).*$/m, '');
      s = once(s, 'body = Buffer.from(text);', 'text = require("./tenant-runtime.cjs").html(text, isHtml, require("./demo-api").tenantPublic());\n      body = Buffer.from(text);');
      s = once(s, 'const file = path.normalize(path.join(PUBLIC, pathname));', 'if (/^\\/(images|thumbs)\\//.test(pathname)) pathname = "/tenant-placeholder.svg";\n  const file = path.normalize(path.join(PUBLIC, pathname));');
      s = once(s, 'demoReady.then(() => server.listen(port, HOST));', 'demoReady.then(() => server.listen(process.env.TENANT_SOCKET, () => { fs.chmodSync(process.env.TENANT_SOCKET, 0o600); process.send?.({ ready: true }); }));');
      // 本サービスの入口以外からは接続できない。起動時に元の設定・データを持たせない。
      s = "if (!process.env.TENANT_SOCKET || !process.env.TENANT_MODE) throw Error('専用の起動方法を使ってください');\n" + s;
    }
    if (f === 'public/booking-tweaks.js') {
      s = replaceLiteral(s, 'TERMS_DOC', JSON.stringify([['p','利用条件は店舗へお問い合わせください。']]));
      s = replaceLiteral(s, 'PRIVACY_DOC', JSON.stringify([['p','個人情報の取り扱いは店舗へお問い合わせください。']]));
    }
    if (/^public\/legal\/[a-z]+\.json$/.test(f)) {
      const lang=path.basename(f,'.json'), i=['en','zh','ko','fr','es','it','de'].indexOf(lang);
      s=JSON.stringify({terms:[['p',translations['利用条件は店舗へお問い合わせください。'][i]]],privacy:[['p',translations['個人情報の取り扱いは店舗へお問い合わせください。'][i]]]});
    }
    if (f === 'public/cn-i18n.js') s = once(s, '  window.CNI18N = {', '  Object.assign(D, ' + JSON.stringify(translations) + ');\n  window.CNI18N = {');
    if (/chunks\/index-(pm2|pm3|B6jWVnZd)\.js$/.test(f)) {
      s = once(s, 'if(document.documentElement.id===`__next_error__`', 'if(window.__TENANT__||document.documentElement.id===`__next_error__`');
    }
    if (f.includes('content-pfBsd_aY.js')) s = fs.readFileSync(path.join(__dirname, 'tenant/content.js'), 'utf8');
    if (f.includes('StoreInfo-D7bs3gE0.js')) s = fs.readFileSync(path.join(__dirname, 'tenant/store-info.js'), 'utf8');
    if (/I18n.*\.js$/.test(f)) s = s.replace(/("?(?:addressValue|hoursValue|accessValue|shopDescription)"?):(?:`[^`]*`|"(?:\\.|[^"\\])*")/g, '$1:"—"');
    if (/MenuList-DM9zx8DR\.js$/.test(f)) s = s.replace('o=e=>`/thumbs/${e}.webp`', 'o=e=>e||`/tenant-placeholder.svg`');
    if (/page-BJ0JOGWN\.js$/.test(f)) s = s.replace('c=e=>`/images/${e}.webp`', 'c=e=>e||`/tenant-placeholder.svg`');
    if (/page-Bo4mFVZr\.js$/.test(f)) s = s.replace(/c=\[[^\]]*\],l=e=>`\/images\/\$\{e\}\.webp`/, 'c=[],l=e=>e');
    if (/Shell-DKCROjzY\.js$/.test(f)) s = s.replace('/images/logo.jpg.webp','/tenant-placeholder.svg');
    // 保存された見本の本文を送らない。画面は元の部品から空データで組み立てる。
    if (f.endsWith('.html') && s.includes('vinext.navigationRuntime')) {
      s = s.replace(/<link\b(?=[^>]*\bas="image")[^>]*>/g, '');
      s = s.replace(/(<body[^>]*>)([\s\S]*?)(<\/body>)/, (_, a, body, b) => a + (body.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || []).join('') + b);
      s = s.replace(/上野駅徒歩1分。完全個室9室、男女スタッフ在籍。整体・オイルマッサージ・足裏・ヘッドスパ・タイ古式を当日予約できます。/g, '');
    }
    s = scrub(s);
    fs.writeFileSync(dst, s);
  }
  fs.copyFileSync(path.join(__dirname, 'tenant/runtime.cjs'), path.join(out, 'tenant-runtime.cjs'));
  for (const f of ['tenant-ui.js', 'tenant-placeholder.svg']) fs.copyFileSync(path.join(__dirname, 'tenant', f), path.join(out, 'public', f));
  fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), builtAt: new Date().toISOString() }));
  console.log('空の店舗用プログラムを生成しました（本番データ・写真・秘密設定はコピーしません）。');
  return out;
}
if (require.main === module) build();
module.exports = { build, once, replaceLiteral };
