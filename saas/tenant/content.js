// 元の予約画面の部品が読むカタログ。店舗以外の見本は入れない。
const languages = ['ja','en','zh','ko','fr','es','it','de'];
const data = window.__TENANT__ || { courses: [] };
const descriptions = Object.fromEntries(languages.map(l => [l, []]));
const groups = data.courses.length ? [{ titleKey: 'menu', items: data.courses.map(c => ({ ...c, name: Object.fromEntries(languages.map(l => [l, c.name])), image: c.image })) }] : [];
const price = (v, l) => new Intl.NumberFormat(l === 'ja' ? 'ja-JP' : l, { style:'currency', currency:'JPY', maximumFractionDigits:0 }).format(v);
export { descriptions as n, groups as r, price as t };
