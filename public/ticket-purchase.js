/* 購入確認・送信中の保護・通信失敗時の同じ購入の再確認を、お客様と管理画面で共通にする。 */
(function () {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const storageKey = 'cn-ticket-pending-purchases';
  const pending = {
    read(owner) { return JSON.parse(sessionStorage.getItem(storageKey) || '{}')[owner] || null; },
    write(owner, value) {
      const all = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
      if (value) all[owner] = value; else delete all[owner];
      sessionStorage.setItem(storageKey, JSON.stringify(all));
    },
  };
  async function json(url, options = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options, signal:controller.signal });
      const value = await response.json();
      if (!response.ok) throw Object.assign(new Error(value.error || 'unavailable'), { status:response.status });
      return value;
    } finally { clearTimeout(timer); }
  }
  async function open(options = {}) {
    if (document.getElementById('cn-ticket-purchase')) return;
    const admin = !!options.admin;
    const tr = (s, values) => !admin && window.CNI18N ? window.CNI18N.t(s, values) : s.replace(/\{(\w+)\}/g, (_, k) => values?.[k] ?? '');
    const price = n => !admin && window.CNI18N ? window.CNI18N.price(n) : Number(n).toLocaleString('ja-JP') + '円';
    const planName = name => !admin && window.CNI18N ? window.CNI18N.plan(name) : name;
    const date = value => {
      const day = new Date(value).toLocaleDateString('sv-SE', { timeZone:'Asia/Tokyo' });
      return !admin && window.CNI18N ? window.CNI18N.date(day) : day;
    };
    const dialog = document.createElement('dialog'); dialog.id = 'cn-ticket-purchase'; dialog.className = 'cn-tp';
    dialog.setAttribute('aria-labelledby', 'cn-tp-title');
    dialog.innerHTML = '<header><h2 id="cn-tp-title">' + esc(admin ? '回数券の購入登録' : tr('購入内容の確認')) + '</h2><button type="button" data-close aria-label="' + esc(tr('閉じる')) + '">×</button></header>' +
      '<div class="cn-tp-body"><div data-controls>' + (admin ? '<form data-search><label>お客様を検索<input type="search" name="query" placeholder="お名前・メール・電話（2文字以上）" autocomplete="off"></label><button>検索</button></form><label>お客様<select data-customer><option value="">検索してお客様を選択</option></select></label><p class="cn-tp-note">会員登録済みのお客様を選ぶと、予約サイトにも反映されます。</p><label>回数券<select data-plan></select></label>' : '') + '</div>' +
      '<div data-summary></div><p class="cn-tp-status" role="status" data-status>' + esc(tr('読み込んでいます…')) + '</p></div><footer><button type="button" data-close>' + esc(tr('戻る')) + '</button><button type="button" class="cn-tp-primary" data-submit disabled>' + esc(admin ? '購入を登録する' : tr('購入する')) + '</button></footer>';
    document.body.appendChild(dialog); dialog.showModal(); window.CNPopup?.sync();
    let plans = [], customers = [], buyer = null, selected = null, owner = '', retry = null, busy = false, done = false;
    const status = dialog.querySelector('[data-status]'), submit = dialog.querySelector('[data-submit]');
    function setBusy(value) {
      busy = value; dialog.setAttribute('aria-busy', String(value));
      dialog.querySelectorAll('button,input,select').forEach(el => { el.disabled = value; });
      dialog.querySelectorAll('[data-controls] input,[data-controls] select,[data-controls] button').forEach(el => { el.disabled = value || !!retry || done; });
      submit.disabled = value || done || !selected || !buyer;
    }
    const close = () => { if (!busy) { dialog.close(); dialog.remove(); } };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
    function summary() {
      const fields = [];
      if (buyer) fields.push(admin ? ['連絡先', buyer.email + (buyer.phone ? '\n' + buyer.phone : '')] : [tr('お名前'), buyer.name]);
      if (selected) {
        const menus = selected.menu_scope === 'all' ? tr('すべてのメニュー') : (selected.menu_names || []).map(n => !admin && window.CNI18N ? window.CNI18N.menu(n) : n).join(' / ');
        fields.push([tr('回数券'), planName(selected.name)], [tr('利用可能回数'), tr('{n}回', {n:selected.uses})], [tr('対象メニュー'), menus], [tr('合計金額'), price(selected.price)]);
      }
      dialog.querySelector('[data-summary]').innerHTML = '<dl>' + fields.map(([k,v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>' +
        (selected ? '<p class="cn-tp-note">' + esc(tr('有効期限は購入日から{valid}です。', {valid:!admin && window.CNI18N ? window.CNI18N.validFor(selected.valid_label) : selected.valid_label})) + '<br>' + esc(tr('お支払いは店頭にて承ります。')) + '</p>' : '');
      submit.disabled = busy || !buyer || !selected;
    }
    function restorePending() {
      retry = pending.read(owner);
      if (retry) {
        buyer = retry.buyer; selected = retry.plan;
        if (admin) {
          dialog.querySelector('[data-customer]').innerHTML = '<option>' + esc(buyer.name) + '</option>';
          dialog.querySelector('[data-plan]').innerHTML = '<option>' + esc(selected.name + ' ／ ' + price(selected.price)) + '</option>';
        }
        summary(); setBusy(false);
        status.textContent = tr('前回の購入結果を確認します。新しい購入は追加しません。');
        submit.textContent = tr('購入結果を確認');
      }
    }
    async function load() {
      setBusy(true);
      try {
        if (admin) {
          const j = await json('/api/demo/ticket-purchase'); plans = j.plans; owner = 'admin:' + j.actor;
          dialog.querySelector('[data-plan]').innerHTML = '<option value="">回数券を選択</option>' + plans.map(p => '<option value="' + esc(p.id) + '">' + esc(p.name + ' ／ ' + price(p.price)) + '</option>').join('');
          selected = plans.find(p => p.id === options.planId) || null;
          dialog.querySelector('[data-plan]').value = selected?.id || '';
        } else {
          const j = await json('/api/member/me');
          if (!j.member) throw new Error('memberOnly');
          buyer = { name:j.member.name, email:j.member.email }; owner = 'member:' + buyer.email;
          plans = j.plans || (await json('/api/tickets/plans')).plans;
          selected = plans.find(p => p.id === options.planId);
          if (!selected) throw new Error('planChanged');
        }
        summary(); status.textContent = ''; setBusy(false); restorePending();
      } catch (error) {
        setBusy(false); submit.disabled = true;
        status.textContent = tr(error.message === 'memberOnly' ? '回数券のご購入にはログインが必要です。' : '読み込めませんでした。時間をおいてお試しください。');
      }
    }
    if (admin) {
      dialog.querySelector('[data-search]').addEventListener('submit', async e => {
        e.preventDefault(); if (busy || retry) return;
        const query = e.target.elements.query.value.trim(); if (query.length < 2) { status.textContent = '2文字以上で検索してください。'; return; }
        buyer = null; summary(); setBusy(true);
        try {
          const j = await json('/api/demo/ticket-purchase?q=' + encodeURIComponent(query)); customers = j.customers;
          dialog.querySelector('[data-customer]').innerHTML = '<option value="">お客様を選択</option>' + customers.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name + ' ／ ' + c.email + ' ／ ' + (c.phone || '電話なし') + '（' + c.source + '）') + '</option>').join('');
          status.textContent = customers.length ? 'お客様と回数券を選択してください。' : '該当するお客様がいません。別のお名前・メール・電話で検索してください。';
        } catch { customers = []; status.textContent = '検索できませんでした。もう一度お試しください。'; }
        finally { setBusy(false); }
      });
      dialog.querySelector('[data-customer]').addEventListener('change', e => { buyer = customers.find(c => c.id === e.target.value) || null; status.textContent = ''; summary(); });
      dialog.querySelector('[data-plan]').addEventListener('change', e => { selected = plans.find(p => p.id === e.target.value) || null; status.textContent = ''; summary(); });
    }
    submit.addEventListener('click', async () => {
      if (busy || done || !selected || !buyer) return;
      if (!buyer.name?.trim()) { status.textContent = tr('会員情報にお名前を登録してから購入してください。'); return; }
      if (!retry) {
        // 送信前に保存。応答不明・再読込でも同じキーと内容で確認し、二重購入を防ぐ。
        retry = { plan:selected, buyer, body:{ planId:selected.id, expectedPlan:selected.purchase_version,
          requestKey:'tp-' + crypto.randomUUID(), ...(admin ? {customerId:buyer.id,expectedCustomer:buyer.version} : {name:buyer.name,language:window.CNI18N?.lang() || 'ja'}) } };
        try { pending.write(owner, retry); } catch { retry = null; status.textContent = tr('購入の確認情報を保存できません。ブラウザの保存設定をご確認ください。'); return; }
      }
      setBusy(true); status.textContent = tr('購入を確認しています…');
      let result;
      try {
        result = await json(admin ? '/api/demo/ticket-purchase' : '/api/tickets/purchase', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(retry.body) });
        if (!result.ok || !result.ticket?.id) throw new Error('unavailable');
      } catch (error) {
        if (error.message === 'requestKeyUsed') {
          setBusy(false); submit.disabled = true;
          status.textContent = tr('購入履歴を確認してください。内容が一致しないため、再購入は行っていません。');
        } else if ([400,409,422].includes(error.status)) {
          try { pending.write(owner, null); } catch {}
          retry = null; buyer = null; selected = null; setBusy(false); submit.disabled = true;
          status.textContent = tr('購入内容が変更されています。閉じて選び直してください。');
        } else {
          setBusy(false); submit.textContent = tr('購入結果を確認');
          status.textContent = tr('購入結果を確認できませんでした。「購入結果を確認」で同じ購入を確認できます。');
        }
        return;
      }
      // 購入成功後の画面更新失敗を「購入失敗」にしない。
      done = true; try { pending.write(owner, null); } catch {}
      setBusy(false); submit.hidden = true; dialog.querySelector('[data-controls]').hidden = true;
      dialog.querySelector('footer [data-close]').textContent = tr('閉じる');
      const t = result.ticket;
      dialog.querySelector('[data-summary]').innerHTML = '<h3>' + esc(planName(t.plan_name)) + '</h3><dl>' +
        [[tr('お名前'),buyer.name],[tr('購入日'),date(t.purchased_at)],[tr('有効期限'),date(t.expires_at)],[tr('残り回数'),tr('{n}回',{n:t.uses_left})]].map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('') + '</dl>';
      status.textContent = admin ? '購入を登録しました。' : tr('購入しました。お支払いは店頭にて承ります。');
      try { await options.onSaved?.(result); } catch { /* 購入は成功済み。再度の購入処理は行わない。 */ }
    });
    await load();
  }
  window.CNTicketPurchase = { open };
})();
