(function(){
  'use strict';
  const host=document.getElementById('bulk-mail'); if(!host)return;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const errors={forbidden:'管理者・マネージャーのみ利用できます。',noRecipients:'宛先を選んでください。',invalid:'件名・本文・宛先を確認してください。',recipientsChanged:'登録情報が変わりました。宛先を読み直して確認してください。',previewExpired:'確認から30分を過ぎました。もう一度内容を確認してください。',alreadySent:'同じ内容・同じ宛先のお知らせは、24時間以内に受付済みです。送信履歴をご確認ください。',notConfigured:'メール送信設定がありません。設定後にお試しください。',recipientNotAllowed:'送信設定で許可されていない宛先があります。宛先・メール送信設定をご確認ください。',saveFailed:'保存に失敗したため、送信を開始していません。もう一度お試しください。',notFound:'確認内容が見つかりません。もう一度内容を確認してください。',tooManyRecipients:'一度の送信上限（10,000件）を超えています。宛先を分けてください。'};
  let data=null,selected=new Set(),offset=0,busy=false,dirty=false,unknown=false,preview=null;
  host.innerHTML='<h2>メール一斉送信</h2><p class="bm-muted">回数券・メニュー・料金・利用規約の改訂や、店舗のお知らせを送れます。内容を確認してから送信します。</p><p class="bm-status" role="status" id="bm-message">読み込み中…</p><form id="bm-form"><fieldset disabled style="border:0;margin:0;padding:0"><div class="bm-fields"><section><h3>1. 宛先</h3><div class="bm-options"><label><input type="radio" name="bm-mode" value="all" checked>登録済みの全員</label><label><input type="radio" name="bm-mode" value="selected">選んだ方だけ</label></div><p class="bm-muted" id="bm-count"></p><input id="bm-search" type="search" placeholder="名前・メールで検索" aria-label="宛先を検索" autocomplete="off"><div class="bm-row" style="margin-top:6px"><button type="button" id="bm-select" hidden>検索結果を選択</button><button type="button" id="bm-clear" hidden>選択を解除</button></div><div class="bm-recipients" id="bm-recipients"></div><div class="bm-row"><button type="button" id="bm-prev">前へ</button><span id="bm-page"></span><button type="button" id="bm-next">次へ</button></div></section><section><h3>2. お知らせの内容</h3><label class="bm-field">種類<select id="bm-kind"><option value="">自由入力</option><option>回数券の改訂について</option><option>メニュー・料金の改訂について</option><option>利用規約の改訂について</option><option>店舗からのお知らせ</option></select></label><label class="bm-field">件名<input id="bm-subject" maxlength="120" required autocomplete="off"></label><label class="bm-field">本文<textarea id="bm-body" maxlength="10000" required placeholder="変更内容・適用開始日などをご記入ください。"></textarea></label><p class="bm-muted">店舗名・住所・連絡先は文末に付きます。宛先ごとに個別送信します。</p><button class="bm-primary" id="bm-preview" type="submit">内容を確認</button></section></div></fieldset></form><details class="bm-history" open><summary>一斉送信の履歴</summary><div id="bm-history"></div></details>';
  const $=id=>document.getElementById(id),message=t=>{$('bm-message').textContent=t;};
  const mode=()=>host.querySelector('[name="bm-mode"]:checked').value;
  async function api(body){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    let r,j;try{r=await fetch('/api/demo/bulk-mail',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal});j=await r.json();}catch{throw Object.assign(new Error('結果を確認できません。通信状態を確認して、もう一度お試しください。'),{unknown:true});}finally{clearTimeout(timer);}
    if(!r.ok){console.warn('bulk-mail request failed',r.status,j.error);throw Object.assign(new Error(errors[j.error]||'操作できませんでした。ログイン状態をご確認ください。'),{code:j.error});}return j;
  }
  function filtered(){const q=$('bm-search').value.trim().toLowerCase();return(data?.recipients||[]).filter(x=>(x.name+' '+x.email).toLowerCase().includes(q));}
  function drawRecipients(){
    const list=filtered(),all=mode()==='all'; offset=Math.max(0,Math.min(offset,Math.max(0,Math.ceil(list.length/50)-1)*50));
    $('bm-count').textContent=`宛先 ${all?data.recipients.length:selected.size}件（同じメールは1通）`+(data.invalid?` ／ 形式不正・テスト用 ${data.invalid}件を除外`:'');
    $('bm-recipients').innerHTML=list.slice(offset,offset+50).map(r=>'<label class="bm-person"><input type="checkbox" data-recipient="'+r.id+'" '+(all||selected.has(r.id)?'checked ':'')+(all?'disabled':'')+'><span>'+esc(r.name)+'<small>'+esc(r.email)+' · '+esc(r.source)+'</small></span></label>').join('')||'<p class="bm-muted">該当する宛先はありません。</p>';
    $('bm-select').hidden=$('bm-clear').hidden=all;$('bm-prev').disabled=offset===0;$('bm-next').disabled=offset+50>=list.length;
    $('bm-page').textContent=list.length?`${offset+1}〜${Math.min(offset+50,list.length)} / ${list.length}`:'0件';
  }
  function drawHistory(){
    $('bm-history').innerHTML=(data.campaigns||[]).map(c=>{
      const n=c.counts;return '<div class="bm-history-item"><b>'+esc(c.subject)+'</b><p class="bm-muted">'+esc(new Date(c.sentAt||c.createdAt).toLocaleString('ja-JP'))+' ／ '+c.count+'件</p><p>送信済み '+n.sent+' ／ 待機 '+n.pending+' ／ 処理中 '+n.sending+' ／ 要確認 '+n.failed+' ／ 停止 '+n.skipped+(n.simulated?' ／ 記録のみ '+n.simulated:'')+'</p>'+(n.pending?'<button type="button" data-stop="'+c.id+'">未送信分を停止</button>':'')+(c.problems.length?'<details><summary>送れなかった宛先を確認</summary>'+c.problems.map(p=>'<p>'+esc(p.email)+'<br>'+esc(p.reason)+'</p>').join('')+'</details>':'')+'</div>';
    }).join('')||'<p class="bm-muted">まだ送信していません。</p>';
  }
  async function load(refreshRecipients=true){
    try{const next=await api();data=next;if(refreshRecipients){selected=new Set([...selected].filter(id=>data.recipients.some(r=>r.id===id)));drawRecipients();}drawHistory();host.querySelector('fieldset').disabled=busy; if(!data.configured)message('メール送信設定がありません。作成・確認はできますが、送信は設定後に行えます。');}
    catch(e){message(e.message);}
  }
  function lock(on){busy=on;host.querySelector('fieldset').disabled=on;}
  function dialog(title,content){const d=document.createElement('dialog');d.className='bm-dialog';d.setAttribute('aria-label',title);d.innerHTML='<h2>'+esc(title)+'</h2>'+content;document.body.appendChild(d);d.showModal();window.CNPopup?.sync();return d;}
  function showPreview(p){
    preview=p;const d=dialog('送信内容を確認','<p class="bm-subject">'+esc(p.subject)+'</p><details><summary>宛先 '+p.count+'件を確認</summary><ul>'+p.recipients.map(r=>'<li>'+esc(r.name)+'：'+esc(r.email)+'</li>').join('')+'</ul></details><pre>'+esc(p.body)+'</pre><p class="bm-status" role="alert"></p><div class="bm-row"><button type="button" data-back>戻る</button><button type="button" class="bm-primary" data-send>'+p.count+'件に一斉送信</button></div>');
    const back=d.querySelector('[data-back]'),send=d.querySelector('[data-send]'),status=d.querySelector('.bm-status');
    const close=()=>{if(busy||unknown)return;d.close();d.remove();preview=null;};
    back.onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close();});
    send.onclick=async()=>{
      if(busy)return;lock(true);send.disabled=back.disabled=true;status.textContent=unknown?'送信結果を確認中…':'送信を受け付けています…';
      try{await api({action:'send',id:p.id,confirm:true});unknown=false;dirty=false;lock(false);close();message('送信を受け付けました。順番に送信します。結果は下の履歴で確認できます。');await load();}
      catch(e){unknown=!!e.unknown;status.textContent=e.message;send.textContent=unknown?'送信結果を確認':'一斉送信';send.disabled=['previewExpired','recipientsChanged','alreadySent','notFound'].includes(e.code);back.disabled=unknown;lock(false);}
    };
  }
  $('bm-form').onsubmit=async e=>{e.preventDefault();if(busy)return;lock(true);message('確認内容を準備しています…');try{const p=await api({action:'preview',mode:mode(),ids:[...selected],subject:$('bm-subject').value,body:$('bm-body').value});message('');lock(false);showPreview(p);}catch(err){message(err.message);lock(false);}};
  $('bm-kind').onchange=()=>{if($('bm-kind').value)$('bm-subject').value=$('bm-kind').value;dirty=true;};
  host.addEventListener('input',e=>{if(['bm-search'].includes(e.target.id))return;dirty=true;});
  host.addEventListener('change',e=>{if(e.target.name==='bm-mode'){dirty=true;offset=0;drawRecipients();}const id=e.target.dataset.recipient;if(id){e.target.checked?selected.add(id):selected.delete(id);dirty=true;drawRecipients();}});
  $('bm-search').oninput=()=>{offset=0;drawRecipients();};$('bm-prev').onclick=()=>{offset-=50;drawRecipients();};$('bm-next').onclick=()=>{offset+=50;drawRecipients();};
  $('bm-select').onclick=()=>{filtered().forEach(r=>selected.add(r.id));dirty=true;drawRecipients();};$('bm-clear').onclick=()=>{selected.clear();dirty=true;drawRecipients();};
  $('bm-history').onclick=e=>{const id=e.target.dataset.stop;if(!id||busy)return;const d=dialog('未送信分を停止しますか？','<p>送信済み・処理中のメールは取り消せません。</p><p class="bm-status" role="alert"></p><div class="bm-row"><button data-back>戻る</button><button data-confirm class="bm-primary">未送信分を停止</button></div>');const close=()=>{if(!busy){d.close();d.remove();}};d.querySelector('[data-back]').onclick=close;d.addEventListener('cancel',ev=>{ev.preventDefault();close();});d.querySelector('[data-confirm]').onclick=async()=>{if(busy)return;lock(true);d.querySelectorAll('button').forEach(b=>b.disabled=true);try{await api({action:'cancel',id});lock(false);close();message('未送信分を停止しました。');await load(false);}catch(err){lock(false);d.querySelector('.bm-status').textContent=err.message;d.querySelectorAll('button').forEach(b=>b.disabled=false);}};};
  window.addEventListener('beforeunload',e=>{if(dirty||busy||unknown){e.preventDefault();e.returnValue='';}});
  load().then(()=>{if(data?.configured)message('');});setInterval(()=>{if(!document.hidden&&!busy&&!preview)load(false);},15000);
})();
