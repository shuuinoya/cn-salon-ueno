'use strict';
const keys=['stores','price','cost','fee','vat','tax'];
const yen=n=>'¥'+Math.round(n).toLocaleString('ja-JP');
function render(){
  const v=Object.fromEntries(keys.map(k=>[k,Number(document.getElementById(k).value)]));
  if(keys.some(k=>!document.getElementById(k).validity.valid||!Number.isFinite(v[k])))return;
  const unit=v.price/(1+v.vat/100)-v.price*v.fee/100;
  const calc=n=>{const before=n*unit-v.cost;return{before,net:before-Math.max(0,before)*v.tax/100};};
  document.getElementById('net').textContent=yen(calc(v.stores).net);
  document.getElementById('target').textContent=unit>0?'この条件で月100万円に必要な契約：'+Math.ceil((1000000/(1-v.tax/100)+v.cost)/unit)+'店舗':'この料金・費用では目標を達成できません。';
  document.getElementById('scenarios').innerHTML=[10,40,80,120,160,180,220].map(n=>`<tr><td>${n}店舗</td><td>${yen(n*v.price)}</td><td>${yen(calc(n).before)}</td><td>${yen(calc(n).net)}</td></tr>`).join('');
}
keys.forEach(k=>document.getElementById(k).addEventListener('input',render));render();
