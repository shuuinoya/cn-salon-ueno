"use strict";

// 登録された読みだけを使う。漢字から読みを推測したり、登録内容を書き換えたりしない。
const basic = {};
for (const [kana, latin] of [
  ['あいうえお', 'a i u e o'], ['かきくけこ', 'ka ki ku ke ko'], ['がぎぐげご', 'ga gi gu ge go'],
  ['さしすせそ', 'sa shi su se so'], ['ざじずぜぞ', 'za ji zu ze zo'], ['たちつてと', 'ta chi tsu te to'],
  ['だぢづでど', 'da ji zu de do'], ['なにぬねの', 'na ni nu ne no'], ['はひふへほ', 'ha hi fu he ho'],
  ['ばびぶべぼ', 'ba bi bu be bo'], ['ぱぴぷぺぽ', 'pa pi pu pe po'], ['まみむめも', 'ma mi mu me mo'],
  ['やゆよ', 'ya yu yo'], ['らりるれろ', 'ra ri ru re ro'], ['わゐゑを', 'wa i e o'], ['ゔ', 'vu'],
  ['ぁぃぅぇぉゃゅょゎ', 'a i u e o ya yu yo wa'],
]) Array.from(kana).forEach((k, i) => { basic[k] = latin.split(' ')[i]; });
const pairs = {};
for (const [k, r] of Object.entries({き:'ky',ぎ:'gy',し:'sh',じ:'j',ち:'ch',ぢ:'j',に:'ny',ひ:'hy',び:'by',ぴ:'py',み:'my',り:'ry'}))
  ['ゃ','ゅ','ょ'].forEach((s,i) => { pairs[k+s] = r + ['a','u','o'][i]; });
Object.assign(pairs, {しぇ:'she',じぇ:'je',ちぇ:'che',てぃ:'ti',でぃ:'di',とぅ:'tu',どぅ:'du',てゅ:'tyu',でゅ:'dyu',ふぁ:'fa',ふぃ:'fi',ふぇ:'fe',ふぉ:'fo',ふゅ:'fyu',ゔぁ:'va',ゔぃ:'vi',ゔぇ:'ve',ゔぉ:'vo',うぃ:'wi',うぇ:'we',うぉ:'wo',つぁ:'tsa',つぃ:'tsi',つぇ:'tse',つぉ:'tso'});
const clean = s => String(s || '').normalize('NFKC').trim();
function romanizeKana(value) {
  const kana = clean(value).replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  let out = '';
  for (let i = 0; i < kana.length; i++) {
    const c = kana[i], next = pairs[kana.slice(i+1,i+3)] || basic[kana[i+1]] || '';
    if (c === 'っ') { if (!/^[bcdfghjklmnpqrstvwxyz]/.test(next)) return ''; out += next.startsWith('ch') ? 't' : next[0]; }
    else if (c === 'ん') out += /^[aeiouy]/.test(next) ? "n'" : 'n';
    else if (c === 'ー') { const vowel = out.match(/[aeiou]$/); if (!vowel) return ''; out += vowel[0]; }
    else if (pairs[kana.slice(i,i+2)]) { out += pairs[kana.slice(i,i+2)]; i++; }
    else if (basic[c]) out += basic[c];
    else if (/[\s・･]/.test(c)) out += ' ';
    else if (/[a-zA-Z'’-]/.test(c)) out += c.toLowerCase();
    else return '';
  }
  return out.replace(/\s+/g, ' ').trim().replace(/(^|[ -])[a-z]/g, s => s.toUpperCase());
}
function staffLatinName(staff, profile) {
  const p = profile || {}, name = clean(p.nickname || staff.name), compact = s => clean(s).replace(/\s/g, '');
  if (/^[A-Za-z][A-Za-z .’'\-]*$/.test(name)) return name;
  if (compact(name) === compact(p.familyName) && p.familyKana) return romanizeKana(p.familyKana);
  if (compact(name) === compact(p.givenName) && p.givenKana) return romanizeKana(p.givenKana);
  const family = romanizeKana(p.familyKana), given = romanizeKana(p.givenKana);
  if (family && given) return family + ' ' + given;
  return romanizeKana(p.furigana) || romanizeKana(name);
}
module.exports = { romanizeKana, staffLatinName };
