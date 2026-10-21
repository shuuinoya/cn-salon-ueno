/* 顧客記録・予約履歴。対象は自社予約だけ。 */
(function () {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const yen=v=>Number(v || 0).toLocaleString('ja-JP')+'円';
  const stamp=v=>Number.isFinite(v)?new Date(v+9*3600e3).toISOString().slice(0,16).replace('T',' '):'—';
  let current;
  async function open(options={}) {
    if(current) current.remove();
    const root=document.createElement('div'); root.id='pm-customer-records';
    root.innerHTML='<section role="dialog" aria-modal="true" aria-label="予約履歴"><header><h2>予約履歴</h2><button type="button" data-close>閉じる</button></header><main><p role="status">読み込み中…</p></main></section>';
    const previous=document.activeElement; document.body.appendChild(root); current=root; document.body.classList.add('cr-open');
    const close=()=>{root.remove();if(current===root)current=null;document.body.classList.remove('cr-open');if(previous?.isConnected)previous.focus();};
    root.querySelector('[data-close]').onclick=close;
    root.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const els=[...root.querySelectorAll('button,a[href],input,textarea')].filter(x=>!x.disabled),a=els[0],b=els[els.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();b.focus();}else if(!e.shiftKey&&document.activeElement===b){e.preventDefault();a.focus();}}});
    root.querySelector('button').focus();
    try {
      const query=new URLSearchParams(options.bookingId?{bookingId:options.bookingId}:{reference:options.reference || ''});
      const response=await fetch('/api/demo/customer-records?'+query,{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();if(current!==root)return;
      const f=data.fields,table=(rows)=>'<div class="cr-table"><table><thead><tr><th>予約日時</th><th>メニュー</th><th>担当</th><th>予約金額</th><th>状態</th><th>操作</th></tr></thead><tbody>'+rows.map(b=>'<tr><td>'+esc(stamp(b.start))+'</td><td>'+esc(b.menu)+'</td><td>'+esc(b.staff)+'</td><td>'+yen(b.total)+'</td><td>'+esc(b.status==='confirmed'?'予約':b.status==='no_show'?'無断キャンセル':'取消')+(b.paid?'・精算済み':'')+'</td><td><button type="button" data-id="'+esc(b.id)+'" data-date="'+esc(b.date)+'">この日の台帳</button></td></tr>').join('')+'</tbody></table></div>';
      root.querySelector('main').innerHTML='<h3>'+esc(f.name)+' 様</h3><p class="cr-note">'+(data.identityBasis==='member'?'この会員に登録された予約履歴です。':'会員との紐付けがないため、この予約の記録を表示しています。')+'</p><h3>予約履歴</h3>'+table(data.history)+(data.candidates.length?'<h3>連絡先と氏名が一致する予約</h3><p class="cr-note">同一のお客様か確認してください。顧客情報は自動で結合していません。</p>'+table(data.candidates):'');
      root.addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(!b)return;close();window.__pmGoToLedgerDate?.(b.dataset.date);});
    } catch {if(current===root)root.querySelector('main').innerHTML='<p role="alert">顧客記録を読み込めませんでした。ログイン状態と接続を確認してください。</p>';}
  }
  window.__pmOpenCustomerHistory=options=>open(options);
})();
