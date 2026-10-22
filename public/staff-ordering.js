// 公開掲載順位は既存スタッフ ID に結び付けて保存する。スタッフマスタの表示順序とは独立。
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const errors = { staffOrderingInvalid: "No.は 1〜999999 の整数で入力してください。スタッフが増減した場合は読み直してください。", staffOrderingDuplicate: "同じ No. が重複しています。別の番号を入力してください。", staffOrderingConflict: "ほかの画面でスタッフ情報または掲載順位が変更されました。入力内容を控えてから最新の情報を読み直してください。", forbidden: '掲載順位の保存には管理者のログインが必要です。', staffOrderChanged: 'ほかの画面でスタッフ情報または掲載順位が変更されました。最新の情報を読み直してから設定してください。', staffOrderingChanged: 'ほかの画面でスタッフ情報または掲載順位が変更されました。最新の情報を読み直してから設定してください。', invalidOrder: 'No.は 1〜999999 の重複しない整数で入力してください。', invalid: '入力した No. とスタッフ情報を確認してください。', requestChanged: '先に送った内容と異なります。最新の情報を読み直してください。' };
  let current = null;
  function orders(app) {
    const inputs = [...app.host.querySelectorAll('[data-order-id]')];
    if (inputs.length !== app.data.staff.length) throw Error('一覧を取得し直してください。');
    const used = new Set();
    return inputs.map(input => {
      const raw = input.value.trim(), listingOrder = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(listingOrder) || listingOrder < 1 || listingOrder > 999999) throw Error('No.は 1〜999999 の整数で入力してください。');
      if (used.has(listingOrder)) throw Error('同じ No. が重複しています。別の番号を入力してください。');
      used.add(listingOrder);
      return { id: input.dataset.orderId, listingOrder };
    });
  }
  function setMessage(app, message, error) {
    const node = app.host.querySelector('.so-message');
    node.textContent = message; node.className = 'so-message' + (error ? ' so-error' : '');
    node.setAttribute('role', error ? 'alert' : 'status');
  }
  function controls(app) {
    app.host.querySelectorAll('input,button').forEach(el => {
      el.disabled = app.busy || (el.matches('[data-order-id]') && (!app.data?.canManage || app.unknown)) || (el.matches('[data-so=save]') && (!app.data?.canManage || !app.dirty));
    });
    app.host.setAttribute('aria-busy', String(app.busy));
    const save = app.host.querySelector('[data-so=save]');
    if (save) save.textContent = app.unknown ? '同じ内容で保存結果を確認' : '掲載順位を保存';
  }
  function render(app) {
    const data = app.data;
    app.host.innerHTML = '<p class="so-help">勤務シフトがあるスタッフを優先し、その中で No. の小さい順に表示します。シフトのないスタッフは後ろに表示し、その日の指名は受け付けません。スタッフマスタの表示順序と確定済みの予約は変わりません。</p>' +
      '<p class="so-message" role="status"></p>' +
      '<div class="so-actions"><button type="button" data-so="save" class="staff-primary">掲載順位を保存</button><button type="button" data-so="reload">最新の情報を読み直す</button><span>掲載中 ' + data.staff.filter(s => s.listed).length + '人 ／ 登録 ' + data.staff.length + '人</span></div>' +
      '<div class="so-scroll"><table class="so-table"><thead><tr><th>No.</th><th>写真</th><th>スタッフ名</th><th>プロフィール</th><th>公開状態</th><th>編集</th></tr></thead><tbody>' + data.staff.map(s => '<tr data-staff-id="' + esc(s.id) + '"><td><input type="number" min="1" max="999999" step="1" inputmode="numeric" required aria-label="' + esc(s.name) + 'の掲載順位 No." data-order-id="' + esc(s.id) + '" value="' + esc(s.listingOrder) + '"></td><td>' + (s.photo ? '<img src="' + esc(s.photo) + '" alt="" width="48" height="64" loading="lazy">' : '<span class="so-muted">写真なし</span>') + '</td><td><b>' + esc(s.name) + '</b>' + (s.registeredName !== s.name ? '<small>' + esc(s.registeredName) + '</small>' : '') + '<small>ID: ' + esc(s.id.slice(0, 8)) + '</small></td><td><p class="so-profile">' + esc(s.message || '紹介文なし') + '</p></td><td><b>' + (s.listed ? '掲載中' : '非掲載') + '</b><small>' + esc(s.listed ? '' : (s.reasons || []).join(' / ')) + '</small></td><td><button type="button" data-so="edit" data-id="' + esc(s.id) + '" aria-label="' + esc(s.name) + 'の詳細編集">詳細編集</button></td></tr>').join('') + '</tbody></table></div>' +
      '<div class="so-discard" hidden><p>入力中の順位を破棄して、最新の情報を読み直します。保存結果が分からない場合も、保存済みの順位をここで確認できます。</p><button type="button" data-so="discard">読み直す</button><button type="button" data-so="keep">入力に戻る</button></div>';
    if (!data.canManage) setMessage(app, '掲載順位は閲覧のみです。保存は管理者が行えます。', false);
    controls(app);
  }
  async function load(app) {
    if (app.busy || !app.host.isConnected) return;
    app.busy = true; controls(app);
    if (!app.data) app.host.innerHTML = '<p class="so-message" role="status">読み込み中…</p>';
    const sequence = ++app.sequence;
    try {
      const response = await fetch('/api/demo/staff-ordering', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.staff) || !data.version) throw Error(errors[data.error] || '掲載順位を読み込めませんでした。');
      if (!app.host.isConnected || sequence !== app.sequence) return;
      app.data = data; app.dirty = false; app.unknown = false; app.pending = null; render(app);
      return true;
    } catch (error) {
      if (!app.data) app.host.innerHTML = '<p class="so-message" role="alert"></p><button type="button" data-so="reload">再読み込み</button>';
      setMessage(app, error.message || '通信に失敗しました。再度読み込んでください。', true);
    } finally { app.busy = false; controls(app); }
  }
  async function save(app) {
    if (app.busy || !app.data?.canManage || !app.dirty) return;
    let payload;
    try {
      const values = orders(app);
      payload = app.unknown && app.pending ? app.pending : { version: app.data.version, orders: values, requestKey: crypto.randomUUID() };
    } catch (error) { setMessage(app, error.message, true); return; }
    app.busy = true; app.pending = payload; controls(app); setMessage(app, '保存しています…', false);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    let success = false, savedVersion = '';
    try {
      const response = await fetch('/api/demo/staff-ordering', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      if (response.status >= 500 || response.status === 408) throw Error('unknown');
      const data = await response.json();
      if (!response.ok || !data.ok) { app.unknown = false; app.pending = null; setMessage(app, errors[data.error] || '保存できませんでした。最新の情報と入力した No. を確認してください。', true); return; }
      app.data.version = data.version ?? app.data.version;
      savedVersion = app.data.version;
      for (const row of app.data.staff) row.listingOrder = payload.orders.find(o => o.id === row.id).listingOrder;
      app.dirty = false; app.unknown = false; app.pending = null; success = true;
      setMessage(app, '掲載順位を保存しました。予約サイトに反映されます。', false);
      window.dispatchEvent(new CustomEvent('cn:staff-ordering-saved'));
    } catch {
      app.unknown = true;
      setMessage(app, '保存結果を確認できません。同じ内容で保存結果を確認するか、最新の情報を読み直してください。', true);
    } finally { clearTimeout(timer); app.busy = false; controls(app); }
    if (success) {
      const refreshed = await load(app);
      setMessage(app, refreshed
        ? app.data.version === savedVersion ? '掲載順位を保存しました。予約サイトに反映されます。' : '掲載順位の保存後に別の変更がありました。最新の保存済み順位を表示しています。'
        : '掲載順位は保存されましたが、最新の表示を取得できませんでした。「最新の情報を読み直す」で確認してください。', !refreshed);
      window.__pmKickSync?.();
    }
  }
  function mount() {
    const host = document.getElementById('staff-public-ordering');
    if (!host || host === current?.host) return;
    const app = current = { host, data: null, busy: false, dirty: false, unknown: false, sequence: 0 };
    host.innerHTML = '<p class="so-message" role="status">掲載順位を確認できます。</p><button type="button" data-so="reload">掲載順位を読み込む</button>';
    host.addEventListener('input', event => {
      if (!event.target.matches('[data-order-id]') || app.busy || app.unknown) return;
      app.dirty = true; controls(app); setMessage(app, '変更はまだ保存されていません。', false);
    });
    host.addEventListener('click', event => {
      const target = event.target.closest('[data-so]');
      if (!target || app.busy) return;
      const action = target.dataset.so;
      if (action === 'save') save(app);
      if (action === 'reload') {
        if (app.dirty || app.unknown) host.querySelector('.so-discard').hidden = false;
        else load(app);
      }
      if (action === 'discard') load(app);
      if (action === 'keep') host.querySelector('.so-discard').hidden = true;
      if (action === 'edit') {
        if (app.dirty || app.unknown) { setMessage(app, '順位を保存するか、最新の情報を読み直してから詳細を編集してください。', true); return; }
        window.__pmEditStaff?.(target.dataset.id);
      }
    });
    const details = host.closest('details');
    details?.addEventListener('toggle', () => { if (details.open && !app.data) load(app); });
    if (details?.open) load(app);
  }
  window.__pmMountStaffOrdering = mount;
  window.addEventListener('beforeunload', event => { if (current?.host.isConnected && (current.dirty || current.busy || current.unknown)) { event.preventDefault(); event.returnValue = ''; } });
  function refreshSaved() {
    if (document.hidden) return;
    if (current?.host.isConnected && current.data && current.host.closest('details')?.open && !current.dirty && !current.busy && !current.unknown) load(current);
  }
  window.addEventListener('focus', refreshSaved);
  document.addEventListener('visibilitychange', refreshSaved);
  setInterval(refreshSaved, 60000);
  document.addEventListener('click', event => {
    const app = current;
    if (!app?.host.isConnected || !(app.dirty || app.busy || app.unknown) || app.host.contains(event.target)) return;
    if (!event.target.closest('.ledger-nav button, .ledger-shopmenu button, .ledger-rail button, .staff-master-toolbar button, .staff-directory button, a[href]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const details = app.host.closest('details'); if (details) details.open = true;
    setMessage(app, app.busy ? '保存しています。完了してから別の画面を開いてください。' : '掲載順位の入力が残っています。保存するか、最新の情報を読み直してから別の画面を開いてください。', true);
    app.host.querySelector('.so-message')?.scrollIntoView({ block: 'center' });
  }, true);
  window.addEventListener('cn:seq', () => {
    if (current?.host.isConnected && current.data && current.host.closest('details')?.open) {
      if (current.dirty || current.busy || current.unknown) setMessage(current, 'スタッフ情報が更新されています。入力中の順位は保持しています。保存時に最新の情報と照合します。', false);
      else load(current);
    }
  });
})();
