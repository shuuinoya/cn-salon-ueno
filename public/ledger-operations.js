// 予約台帳の実務画面。表示と保存は同じ管理 API を参照する。
(function () {
  'use strict';
  const titles = { dashboard: 'トップ', bookings: '予約一覧', boothMove: 'ブースの確認・変更', goals: '日次予算・目標設定', checkout: '支払・レジ', retail: '物販販売', returns: '返客情報', online: '本日のオンライン設定状況', templates: 'シフトひな型設定', patterns: 'シフトパターン設定', integrity: 'データ不備のお知らせ' };
  const methods = { cash: '現金', card: 'クレジットカード', qr: 'QR 決済', eMoney: '電子マネー', ticket: '回数券利用', voucher: '商品券利用', prepaid: 'プリペイド利用', point: 'ポイント', epark: 'EPARK サービス', other: 'その他' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = n => Number(n || 0).toLocaleString('ja-JP') + ' 円';
  const hm = n => Number.isFinite(Number(n)) ? String(Math.floor(Number(n) / 60)).padStart(2, '0') + ':' + String(Number(n) % 60).padStart(2, '0') : '—';
  const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const ledgerDate = () => document.querySelector('.ledger-date-trigger time')?.getAttribute('datetime') || today();
  const requestKey = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  const button = (label, action, id = '', cls = '') => '<button type="button" class="' + cls + '" data-lo="' + action + '" data-id="' + esc(id) + '">' + esc(label) + '</button>';
  const empty = label => '<p class="lo-empty">' + esc(label || '該当する記録はありません。') + '</p>';
  function table(headers, rows) {
    return rows.length ? '<div class="lo-table-wrap" tabindex="0" aria-label="一覧（横にスクロールできます）"><table><thead><tr>' + headers.map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : empty();
  }
  const field = (label, name, value = '', type = 'text', attrs = '') => '<label>' + esc(label) + '<input name="' + name + '" type="' + type + '" value="' + esc(value) + '" ' + attrs + '></label>';
  const select = (label, name, options, value = '', attrs = '') => '<label>' + esc(label) + '<select aria-label="' + esc(label) + '" name="' + name + '" ' + attrs + '>' + options.map(([k, v]) => '<option value="' + esc(k) + '"' + (String(k) === String(value) ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select></label>';
  const textarea = (label, name, value = '') => '<label class="lo-wide">' + esc(label) + '<textarea aria-label="' + esc(label) + '" name="' + name + '" maxlength="1000">' + esc(value) + '</textarea></label>';
  const errors = {
    loginRequired: 'ログインの有効期限が切れました。ログインし直してください。', forbidden: 'この操作を行う権限がありません。',
    invalid: '入力内容を確認してください。金額・数量・時間は指定の範囲で入力してください。', notFound: 'この記録は見つかりません。一覧を再読込してください。',
    scheduleConflict: '予約・シフトが更新されたか、予定が重なっています。再読込して現在の内容を確認してください。',
    ledgerChanged: '別の画面で記録が更新されました。入力内容を控えてから再読込してください。', ledgerConflict: '別の画面で記録が更新されました。再読込して現在の内容を確認してください。', conflict: '記録が更新されています。再読込して確認してください。',
    staffInfoMissing: '新しいシフトを登録するには、対象スタッフの写真・紹介文・対応メニューを登録してください。',
    requestChanged: '送信内容が変わっています。一覧で保存状況を確認してから操作し直してください。',
    invalidBooth: '選んだブースはこのコース・人数では使用できません。', boothSoldOut: '選んだブースは使用中です。別のブースを選んでください。', boothPolicyMissing: 'このコースの利用ブース設定を確認してください。', unknownOccupancy: 'ブースの記録がない予約があります。既存の予約の部屋を確認してから変更してください。', nominatedConfirmationRequired: '指名予約の変更内容を確認し、確認欄にチェックを入れてください。',
    paymentExceedsTotal: '会計金額が予約金額を超えています。予約内容を確認してください。', recordChanged: '記録が更新されています。再読込してください。', bookingChanged: '予約の日時・料金・担当等が変わりました。再読込してください。', notPaid: '会計がまだ登録されていません。', alreadyVoided: 'すでに取り消されています。再読込してください。', outsideShift: '予約・休憩・業務がシフト時間外に残るため保存できません。', alreadyPaid: 'すでに会計済みです。一覧を再読込してください。', paymentMismatch: '支払内訳の合計を会計金額と一致させてください。',
    duplicate: 'すでに登録されています。一覧を再読込してください。', inUse: '使用中のため削除できません。', unavailable: '処理結果を確認できませんでした。一覧を再読込して保存状況を確認してください。'
  };
  let current = null;
  function report(app, message, bad = false) {
    const el = app.root.querySelector('.lo-message');
    el.textContent = message; el.classList.toggle('lo-error', bad); el.hidden = !message;
    el.setAttribute('role', bad ? 'alert' : 'status');
  }
  function parseTime(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
    if (!m || +m[2] > 59) throw new Error('時刻は 10:00、翌 1 時は 25:00 のように入力してください。');
    const n = +m[1] * 60 + +m[2];
    if (n < 600 || n > 1620) throw new Error('時刻は 10:00〜27:00 の範囲で入力してください。');
    return n;
  }
  function integer(v, label, min = 0, max = 100000000) {
    if (String(v).trim() === '' || !Number.isSafeInteger(Number(v)) || Number(v) < min || Number(v) > max) throw new Error(label + 'は ' + min + '〜' + max + ' の整数で入力してください。');
    return Number(v);
  }
  const staffOptions = app => [['', '指定なし'], ...(app.data.staff || []).map(s => [s.id, s.name])];
  function paymentFields(amount) {
    return '<fieldset class="lo-pay"><legend>支払内訳</legend><p class="lo-note">店頭で受け取った金額を記録します。決済や回数券・ポイント等の残高変更は行いません。</p><div class="lo-grid">' + Object.entries(methods).map(([key, label]) => '<label>' + label + '<input type="number" name="pay_' + key + '" min="0" max="100000000" step="1" value="' + (key === 'cash' ? Number(amount || 0) : 0) + '"></label>').join('') + '</div><div class="lo-grid">' + field('カード・電子マネー等の種類（任意）', 'paymentDetail', '', 'text', 'maxlength="80"') + '<div class="lo-payment-total" aria-live="polite"></div></div></fieldset>';
  }
  function readPayments(form, amount) {
    const detail = form.elements.paymentDetail?.value.trim() || '';
    const payments = Object.keys(methods).map(method => ({ method, amount: integer(form.elements['pay_' + method]?.value || 0, methods[method]), ...(method !== 'cash' && detail ? { detail } : {}) })).filter(p => p.amount > 0);
    if (payments.reduce((n, p) => n + p.amount, 0) !== amount) throw new Error('支払内訳の合計を ' + yen(amount) + ' に合わせてください。');
    return payments;
  }
  const payLabel = p => (p || []).filter(x => x.amount).map(x => esc(methods[x.method] || x.method) + (x.detail ? '（' + esc(x.detail) + '）' : '') + ' ' + yen(x.amount)).join('<br>') || '—';
  function form(app, title, body, submitLabel = '保存') {
    app.root.querySelector('.lo-editor').innerHTML = '<section class="lo-form-card"><h3>' + esc(title) + '</h3><form class="lo-form"><div class="lo-grid">' + body + '</div><div class="lo-actions"><button type="submit" class="lo-primary">' + esc(submitLabel) + '</button>' + button('閉じる', 'editor-close') + '</div></form></section>';
    app.root.querySelector('.lo-editor').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    app.dirty = false;
  }
  function discard(app) { return !app.dirty || window.confirm('入力中の内容を閉じますか？ 保存は行われません。'); }
  function close(app) {
    if (app.busy || !discard(app)) return;
    app.seq++; app.controller?.abort(); app.root.remove(); current = null;
    document.body.classList.remove('lo-open'); app.previousFocus?.focus?.();
  }
  async function read(app, successMessage = '') {
    const seq = ++app.seq;
    app.controller?.abort(); const controller = new AbortController(); app.controller = controller;
    app.loading = true; app.data = null;
    app.root.querySelector('.lo-content').innerHTML = '<p class="lo-empty" role="status">読み込んでいます…</p>';
    app.root.querySelector('.lo-editor').replaceChildren(); app.dirty = false;
    const params = new URLSearchParams({ view: app.view, date: app.date });
    if (app.view === 'returns' || app.view === 'bookings') { params.set('from', app.from || app.date); params.set('to', app.to || app.date); }
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(app.view === 'boothMove' ? '/api/demo/schedule?date=' + app.date : '/api/demo/ledger?' + params, { cache: 'no-store', signal: controller.signal });
      let data = await response.json();
      if (seq !== app.seq || current !== app) return;
      if (!response.ok) throw new Error(errors[data.error] || '一覧を取得できませんでした。');
      if (app.view === 'boothMove') { const revision = data.days?.find(d => d.date === app.date)?.version; data = { ...data, revision, dayRevision: revision }; }
      if (!Number.isInteger(data.revision)) throw new Error('一覧の状態を確認できません。再読込してください。');
      app.data = data; app.loading = false; app.unknown = false; render(app); report(app, successMessage);
      if (app.view === 'boothMove') {
        const options = app.options; app.options = {};
        const bookingId = options.bookingId || app.boothBookingId;
        app.boothBookingId = bookingId;
        boothEditor(app, bookingId, options.boothId, options.replaceBoothId);
      } else if (app.options.bookingId || app.options.reference) {
        const b = (data.bookings || []).find(b => b.bookingId === app.options.bookingId || b.reference === app.options.reference);
        app.options = {}; if (b) checkoutEditor(app, b.bookingId);
      } else if (app.options.create) { app.options = {}; editor(app, 'new'); }
    } catch (e) {
      if (seq !== app.seq || current !== app) return;
      app.loading = false;
      app.root.querySelector('.lo-content').innerHTML = empty('データを読み込めませんでした。再読込を押してください。');
      report(app, e.name === 'AbortError' ? '読み込みが時間内に完了しませんでした。再読込してください。' : e.message, true);
    } finally { clearTimeout(timer); }
  }
  function setBusy(app, value) {
    app.busy = value; app.root.setAttribute('aria-busy', String(value));
    app.root.querySelectorAll('button,input,select,textarea').forEach(el => {
      if (value) { el.dataset.loWasDisabled = el.disabled ? '1' : '0'; el.disabled = true; }
      else if (el.dataset.loWasDisabled != null) { el.disabled = el.dataset.loWasDisabled === '1'; delete el.dataset.loWasDisabled; }
    });
    if (value) app.root.focus?.({ preventScroll: true });
  }
  async function save(app, payload, message, schedule = false) {
    if (app.busy || !app.data) return;
    const full = { ...payload, date: payload.date || app.date, revision: schedule ? app.data.dayRevision : app.data.revision };
    const signature = JSON.stringify(full);
    if (app.unknown && app.pending?.signature !== signature) { report(app, '直前の保存結果が不明です。内容を元に戻して同じ内容を再送するか、再読込して保存状況を確認してください。', true); return; }
    if (app.pending?.signature !== signature) app.pending = { signature, key: requestKey() };
    if (!schedule) full.requestKey = app.pending.key;
    app.dirty = true; setBusy(app, true); report(app, '保存しています…');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(schedule ? '/api/demo/schedule' : '/api/demo/ledger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(full), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) { const e = new Error(errors[result.error] || ('保存できませんでした（' + (result.error || response.status) + '）。入力内容を確認してください。')); e.rejected = response.status >= 400 && response.status < 500 && response.status !== 408; throw e; }
      if (!result.ok) throw new Error('保存結果を確認できませんでした。一覧を再読込してください。');
      app.pending = null; app.dirty = false; app.unknown = false; setBusy(app, false);
      window.__pmSchedAt = 0; window.__pmKickSync?.();
      await read(app, message || '保存しました。');
    } catch (e) {
      app.unknown = !e.rejected; setBusy(app, false);
      report(app, e.rejected ? e.message : '通信が途切れ、保存結果を確認できません。同じ内容を再送するか、再読込して保存状況を確認してください。', true);
    } finally { clearTimeout(timer); }
  }
  function filtered(app, rows, nameKey = 'name') {
    const q = (app.search || '').trim().toLowerCase();
    return rows.filter(row => (!q || String(row[nameKey] || '').toLowerCase().includes(q)) && (!app.status || app.status === 'all' || (app.status === 'valid' ? row.status !== 'void' && row.status !== 'deleted' : row.status === 'void' || row.status === 'deleted')));
  }
  function toolbar(app, create = '') {
    return '<div class="lo-list-tools">' + field('名前検索', 'search', app.search || '', 'search', 'data-filter="search"') + (['checkout', 'retail', 'returns'].includes(app.view) ? select('有効', 'status', [['all', 'すべて'], ['valid', '有効'], ['invalid', '無効']], app.status || 'all', 'data-filter="status"') : '') + (create ? button(create, 'new', '', 'lo-primary') : '') + '</div>';
  }
  function render(app) {
    const d = app.data;
    let html = '';
    if (app.view === 'boothMove') {
      html = '';
    } else if (app.view === 'dashboard') {
      const card = (label, data) => '<section class="lo-form-card"><h3>' + esc(label) + '</h3><p>会計済額 <b>' + yen(data?.sales) + '</b></p><p>予約人数（開始済み） <b>' + esc(data?.visitors || 0) + ' 名</b></p></section>';
      html = '<p class="lo-note">自店で記録した会計済額を集計します。人数は開始時刻を過ぎた確定予約の人数です。実際の来店確認は含みません。</p><div class="lo-grid">' + card('前日 ' + (d.previousDay?.date || ''), d.previousDay) + card('当月 ' + (d.currentMonth?.month || ''), d.currentMonth) + '</div><h3>直近 6 か月の売上・予約状況</h3>' + table(['月', '会計済額', '予約人数（開始済み）'], (d.months || []).map(m => [esc(m.month), yen(m.sales), esc(m.visitors) + ' 名'])) + '<h3>スタッフ別の施術会計額</h3><p class="lo-note">当月の開始済み予約に記録された施術会計額です。複数担当の予約は各担当へ均等に分けています。</p>' + table(['順位', 'スタッフ', '担当件数', '施術会計額'], (d.ranking || []).map((r, i) => [esc(i + 1), esc(r.name), esc(r.visitors), yen(r.sales)])) + '<section class="lo-form-card"><h3>予約 URL</h3><a target="_blank" rel="noopener" href="' + esc(location.origin + '/') + '">' + esc(location.origin + '/') + '</a></section>';
    } else if (app.view === 'bookings') {
      const q = String(app.search || '').trim().toLowerCase();
      const rows = (d.bookings || []).filter(b => (!q || [b.name, b.reference, b.bookingId].some(x => String(x || '').toLowerCase().includes(q))) && (!app.bookingStatus || app.bookingStatus === 'all' || b.status === app.bookingStatus));
      html = '<div class="lo-list-tools">' + field('顧客名・予約 ID 検索', 'search', app.search || '', 'search', 'data-filter="search"') + select('予約状況', 'bookingStatus', [['all', 'すべて'], ['confirmed', '確定'], ['cancelled', '取消済み']], app.bookingStatus || 'all', 'data-filter="bookingStatus"') + '</div>' + table(['ID', '予約日', '予約開始時間', '顧客', '顧客性別', 'リピート', 'スタッフ', 'コース名', '売上価格', '会計状況', '施術コメント', '予約経路', 'キャンセル日時', '操作'], rows.map(b => [esc(b.reference || b.bookingId), esc(b.date), hm(b.start), esc(b.name), esc(({ male: '男性', female: '女性', m: '男性', f: '女性' })[b.gender] || '—'), b.is_new == null ? '—' : b.is_new === 0 ? 'リピート' : '新規', esc(b.staffName || '—'), esc(b.menu), yen(b.total), b.paid_at || b.paid_amount > 0 ? '会計済み ' + yen(b.paid_amount) : '未会計', esc(b.note), esc(b.source || '—'), b.cancelled_at ? esc(new Date(b.cancelled_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })) : b.status === 'cancelled' ? '取消済み' : '—', button('詳細', 'booking-detail', b.bookingId)]));
    } else if (app.view === 'checkout') {
      html = '<p class="lo-note">会計済みの金額と支払内訳を一覧に表示します。金額を訂正するときは、理由を記録して会計を取り消してから登録し直します。</p>' + toolbar(app);
      const bookings = d.bookings || [], receipts = d.checkouts || [];
      const rows = bookings.map(b => ({ ...b, receipt: receipts.find(r => r.id === b.checkoutId && r.status !== 'void') }));
      for (const r of receipts.filter(r => r.status === 'void' || !bookings.some(b => b.checkoutId === r.id))) rows.push({ ...r, status: r.status, receipt: r, historyOnly: !bookings.some(b => b.bookingId === r.bookingId), paid_amount: r.amount, paid_at: r.createdAt, payments: r.payments });
      html += table(['ID', '予約日', '開始時間', '顧客名', '性別', '総販売額', '支払内訳', '会計状況', '操作'], filtered(app, rows).map(b => {
        const paid = b.status === 'void' || !!b.paid_at || !!b.checkoutId || b.paid_amount > 0;
        return [esc(b.receipt?.id || b.reference), esc(b.date || app.date), b.start != null ? hm(b.start) : '—', esc(b.name), esc(({ male: '男性', female: '女性', m: '男性', f: '女性' })[b.gender] || '—'), yen(paid ? b.paid_amount : b.total), payLabel(b.payments), b.status === 'void' ? '<span class="lo-muted">無効</span>' : paid ? '<span class="lo-good">会計済み</span>' : b.status === 'cancelled' ? '予約取消済み' : '未会計', b.status === 'void' ? esc(b.receipt?.voidReason) : b.historyOnly ? (b.currentDate ? button('移動先の予約を確認', 'receipt-day', b.currentDate) : '履歴') : b.status === 'cancelled' && !paid ? '—' : button(paid ? '会計内容' : '会計する', 'checkout', b.bookingId)];
      }));
    } else if (app.view === 'retail') {
      html = toolbar(app, '物販を販売') + (d.canManage ? '<div class="lo-actions">' + button('商品を登録', 'product-new') + button('商品一覧', 'products') + '</div>' : '');
      html += table(['ID', '日付', '顧客名', '物販 ID', '物販種別', '物販名', '単価', '数量', '売上金額小計', '支払内訳', '状態', '操作'], filtered(app, d.sales || []).flatMap(s => (s.items || []).map((item, i) => [esc(s.id), esc(s.date), esc(s.name || '—'), esc(item.productId), esc(item.category || '—'), esc(item.name), yen(item.unitPrice), esc(item.quantity), yen(item.total), i ? '' : payLabel(s.payments), s.status === 'void' ? '無効' : '有効', i || s.status === 'void' ? esc(i ? '' : s.voidReason) : button('取消', 'retail-void', s.id)])));
    } else if (app.view === 'returns') {
      html = toolbar(app, '返客を登録') + table(['ID', '日付', '開始時間', '顧客名', '種別', '返客理由・キャンセル待ち', 'コメント', '予約タグ', '操作'], filtered(app, d.returns || []).map(r => [esc(r.id), esc(r.date), esc(r.time != null ? typeof r.time === 'number' ? hm(r.time) : r.time : '—'), esc(r.name || '—'), esc(r.kind), esc(r.reason) + (r.waitStatus ? '<br>' + esc(r.waitStatus) : ''), esc(r.note), esc(Array.isArray(r.tags) ? r.tags.join('、') : r.tags), r.status === 'void' ? '無効' : button('編集', 'return-edit', r.id) + button('削除', 'return-delete', r.id)]));
    } else if (app.view === 'patterns') {
      html = toolbar(app, d.canManage ? '新規作成' : '') + table(['ID', '名前', '開始時間', '終了時間', '表示順序', '休憩・業務', '操作'], filtered(app, d.patterns || []).map(p => [esc(p.id), esc(p.name), hm(p.start), hm(p.end), esc(p.sort_order), (p.blocks || []).map(b => esc(b.kind === 'break' ? '休憩' : '業務') + ' ' + hm(b.start) + '〜' + hm(b.end)).join('<br>') || '—', button('適用', 'pattern-apply', p.id) + (d.canManage ? button('編集', 'pattern-edit', p.id) + button('削除', 'pattern-delete', p.id) : '')]));
    } else if (app.view === 'templates') {
      const staffName = id => (d.staff || []).find(s => s.id === id)?.name || id;
      html = toolbar(app, d.canManage ? '表示日のシフトをひな型登録' : '') + '<p class="lo-note">ひな型には登録済みのシフト・休憩・業務を保存します。お客様の予約は含めません。読み込み前に適用日と上書き方法を確認できます。</p>';
      html += table(['ID', 'ひな型名', '登録スタッフ名', '登録シフト', '予約端末', '表示順序', '操作'], filtered(app, d.templates || []).map(t => [esc(t.id), esc(t.name), (t.shifts || []).map(s => esc(staffName(s.staffId))).join('<br>'), (t.shifts || []).map(s => hm(s.start) + '〜' + hm(s.end)).join('<br>'), esc(t.terminal || '管理画面'), esc(t.sort_order), button('読込', 'template-apply', t.id) + (d.canManage ? button('削除', 'template-delete', t.id) : '')]));
    } else if (app.view === 'online') {
      html = '<div class="lo-status-bar"><b>オンライン予約：' + (d.enabled ? '受付中' : '受付停止') + '</b>' + button(d.enabled ? 'この日の受付を停止' : 'この日の受付を再開', 'day-toggle', d.enabled ? '0' : '1') + '</div>';
      html += '<h3>オンラインブロック一覧</h3><div class="lo-actions">' + button('新規作成', 'new', '', 'lo-primary') + '</div><p class="lo-note">指定時間のオンライン予約受付だけを停止します。管理画面からの予約やスタッフの勤務時間は変更しません。</p>' + table(['スタッフ名', 'ブロック開始時間', 'ブロック終了時間', '備考', '操作'], (d.onlineBlocks || []).map(b => [(b.staffIds || [b.staffId]).map(id => esc((d.staff || []).find(s => s.id === id)?.name || id)).join('、'), hm(b.start), hm(b.end), esc(b.note), button('編集', 'online-edit', b.id) + button('削除', 'online-delete', b.id)]));
      const staffRows = rows => table(['スタッフ', '勤務時間', 'オンライン公開', '受付状況', '操作'], rows.map(s => {
        const status = !d.enabled ? '全体受付停止' : s.active !== 1 ? '停止中' : s.start == null ? 'シフトなし' : (s.info_missing || []).length ? '情報入力待ち' : s.locked ? '受付停止' : '勤務内の空き時間に受付可';
        return [esc(s.name), s.start == null ? 'シフトなし' : hm(s.start) + '〜' + hm(s.end), s.active !== 1 ? '停止中' : (s.info_missing || []).length ? esc(s.info_missing.join('・')) + 'の入力が必要' : '掲載可能', esc(status), s.start == null ? '—' : button(s.locked ? '個別の受付停止を解除' : '個別の受付を停止', 'staff-lock', s.id)];
      }));
      const working = (d.staff || []).filter(s => s.start != null), absent = (d.staff || []).filter(s => s.start == null);
      html += '<h3>勤務中・勤務予定のスタッフ</h3><p class="lo-note">受付可の表示でも、予約済み・休憩・業務・オンラインブロックの時間帯と対応外のコースは受け付けません。</p>' + staffRows(working);
      if (absent.length) html += '<details class="lo-absent-staff"><summary>シフトのないスタッフ ' + absent.length + ' 名</summary>' + staffRows(absent) + '</details>';
      html += '<h3>休憩・業務による受付不可時間</h3>' + table(['スタッフ', '種別', '開始時間', '終了時間', '備考'], (d.blocks || []).map(b => [esc((d.staff || []).find(s => s.id === (b.staffId || b.staff_id))?.name || b.staffId || b.staff_id), b.kind === 'break' ? '休憩' : '業務', hm(b.start != null ? b.start : (b.start_at - Date.parse(app.date + 'T00:00:00+09:00')) / 60000), hm(b.end != null ? b.end : (b.end_at - Date.parse(app.date + 'T00:00:00+09:00')) / 60000), esc(b.note)]));
    } else if (app.view === 'goals') {
      const goal = d.goal || {}, rows = [...(d.goals || [])];
      if (!rows.some(g => g.date === app.date)) rows.push({ date: app.date });
      html = '<p class="lo-note">日次予算・目標コメント・実施プラン・振り返りを保存します。実施プランと振り返りは日報にも反映されます。</p>' + (d.canManage ? '<div class="lo-actions">' + button('表示日の目標を編集', 'new', '', 'lo-primary') + '</div>' : '') + table(['日付', '日次予算（目標）', '目標コメント', '本日の実施プラン', '本日の振り返り', '操作'], rows.sort((a, b) => a.date.localeCompare(b.date)).filter(g => g.date.startsWith(app.date.slice(0, 7))).map(g => [esc(g.date), g.amount == null ? '未設定' : yen(g.amount), esc(g.note || ''), esc(g.todayPlan || ''), esc(g.review || ''), d.canManage ? button('編集', 'goal-edit', g.date) : '—']));
    } else if (app.view === 'integrity') {
      html = '<p class="lo-note">登録内容を照合した結果です。予約やスタッフ情報を自動で書き換えることはありません。</p><div class="lo-status-bar">確認事項 ' + esc(d.summary?.total || 0) + ' 件</div>' + table(['重要度', '日付', 'スタッフ', '確認事項'], (d.issues || []).map(i => [i.severity === 'error' ? '<b class="lo-danger">要確認</b>' : '確認', esc(i.date || '—'), esc(i.staffName || '—'), esc(i.message)]));
      if (!(d.issues || []).length) html = '<p class="lo-good lo-empty">現在の検査対象に不整合は見つかりませんでした。</p>';
    }
    app.root.querySelector('.lo-content').innerHTML = html;
  }
  function checkoutEditor(app, id) {
    const b = (app.data.bookings || []).find(x => x.bookingId === id);
    if (!b) return;
    const paid = !!b.paid_at || !!b.checkoutId || b.paid_amount > 0;
    if (paid) {
      app.root.querySelector('.lo-editor').innerHTML = '<section class="lo-form-card"><h3>' + esc(b.name) + ' 様のお会計</h3><p>' + esc(b.menu) + '</p><p><b>' + yen(b.paid_amount) + '</b></p><p>' + payLabel(b.payments) + '</p><div class="lo-actions">' + button('理由を記録して会計を取り消す', 'checkout-void', id) + button('閉じる', 'editor-close') + '</div></section>';
      return;
    }
    app.editor = { action: 'checkout', id, total: b.total };
    form(app, b.name + ' 様のお会計', '<div class="lo-wide"><p>' + esc(b.menu) + '</p><p>予約金額 <b>' + yen(b.total) + '</b></p>' + (b.ticket ? '<p class="lo-note">この予約の回数券は予約時の利用記録を維持します。ここで再度消費しません。</p>' : '') + '</div>' + field('値引金額', 'discount', 0, 'number', 'min="0" max="' + Number(b.total || 0) + '" step="1" required') + '<div class="lo-final-total">会計金額 <b>' + yen(b.total) + '</b></div><div class="lo-wide">' + paymentFields(b.total) + '</div>' + textarea('備考', 'note'), '会計を登録');
  }
  function boothEditor(app, id, proposedBooth, replaceBoothId) {
    const b = (app.data.bookings || []).find(b => b.id === id && b.status === 'confirmed');
    if (!b) { report(app, '予約が移動または取消されています。元の台帳を確認してください。', true); return; }
    const ids = Array.isArray(b.booth_ids) && b.booth_ids.length ? b.booth_ids : b.booth_id ? [b.booth_id] : [];
    const allBooths = app.data.booths || [], allowed = Array.isArray(b.booth_allowed_ids) ? b.booth_allowed_ids : null;
    const booths = allBooths.filter(room => room.active !== false && room.active !== 0 && (!allowed || allowed.includes(room.id)));
    const selected = [...ids]; if (proposedBooth && booths.some(room => room.id === proposedBooth)) selected[Math.max(0, ids.indexOf(replaceBoothId))] = proposedBooth;
    const staff = (app.data.assignments || []).filter(a => a.booking_id === id).map(a => (app.data.staff || []).find(s => s.id === a.staff_id)?.name || '担当の記録なし').join('、');
    const start = Math.round((b.start_at - Date.parse(app.date + 'T00:00:00+09:00')) / 60000), end = Math.round((b.end_at - Date.parse(app.date + 'T00:00:00+09:00')) / 60000);
    const nominated = !!(b.nominated_staff_id || b.nomination_fee);
    app.editor = { action: 'moveBooth', id, before: ids, nominated };
    form(app, b.name + ' 様のブース', '<p class="lo-wide">' + esc(app.date) + ' ' + hm(start) + '〜' + hm(end) + '<br>' + esc(b.course_name) + '<br>担当：' + esc(staff) + '</p><p class="lo-wide">現在のブース：' + esc(ids.map(id => allBooths.find(room => room.id === id)?.name || id).join('、') || '記録なし') + '</p>' + Array.from({ length: Math.max(1, Number(b.people) || 1) }, (_, i) => select('変更先ブース ' + (i + 1), 'booth_' + i, [['', '選択してください'], ...booths.map(room => [room.id, room.name])], selected[i] || '', 'required')).join('') + '<p class="lo-wide lo-note">担当スタッフ・予約時間・メニューは変更しません。保存時に空室・人数・利用可能なコースを再確認します。</p>' + (nominated ? '<label class="lo-wide lo-confirm-check"><input type="checkbox" name="nominationConfirmed" required>指名予約のブース変更内容を確認しました</label>' : '') + '<div class="lo-wide">' + button('予約の詳細を開く', 'booth-booking-detail', id) + '</div>', 'ブース変更を確定');
  }
  function cartRow(app) {
    const products = (app.data.products || []).filter(p => p.active !== false && p.active !== 0);
    return '<div class="lo-cart-row">' + select('物販', 'productId', products.map(p => [p.id, p.name + '（' + yen(p.price) + '）'])) + field('数量', 'quantity', 1, 'number', 'min="1" max="999" step="1" required') + button('行を削除', 'cart-remove') + '</div>';
  }
  function blockRow(b = {}) {
    return '<div class="lo-pattern-block">' + select('種別', 'blockKind', [['break', '休憩'], ['work', '業務']], b.kind || 'break') + field('開始時間', 'blockStart', hm(b.start ?? 780), 'text', 'pattern="[0-9]{1,2}:[0-9]{2}" required') + field('終了時間', 'blockEnd', hm(b.end ?? 810), 'text', 'pattern="[0-9]{1,2}:[0-9]{2}" required') + field('備考', 'blockNote', b.note || '', 'text', 'maxlength="200"') + button('削除', 'pattern-block-remove') + '</div>';
  }
  function editor(app, action, id) {
    if (!app.data || app.busy || !discard(app)) return;
    app.editor = { action, id };
    if (action === 'checkout') { checkoutEditor(app, id); return; }
    if (action === 'product-new' || action === 'product-edit') {
      const p = (app.data.products || []).find(x => x.id === id) || {};
      app.editor.action = 'productSave';
      form(app, id ? '物販情報の編集' : '物販情報の新規登録', field('物販名 *', 'name', p.name || '', 'text', 'required maxlength="100"') + field('物販種別', 'category', p.category || '', 'text', 'maxlength="80"') + field('単価 *', 'price', p.price || 0, 'number', 'min="0" max="100000000" step="1" required') + field('表示順序 *', 'sort_order', p.sort_order || 0, 'number', 'min="0" max="99999" step="1" required') + select('販売状況', 'active', [['1', '販売する'], ['0', '販売を停止']], p.active === false || p.active === 0 ? '0' : '1'));
    } else if (action === 'template-apply' || action === 'pattern-apply') {
      const item = (action === 'template-apply' ? app.data.templates : app.data.patterns).find(x => x.id === id);
      if (!item) return;
      app.editor.action = action === 'template-apply' ? 'templateApply' : 'patternApply';
      const staffName = id => (app.data.staff || []).find(s => s.id === id)?.name || id;
      const preview = action === 'template-apply' ? '<div class="lo-wide"><h3>シフト情報</h3>' + table(['スタッフ名', 'シフト開始時間', 'シフト終了時間'], (item.shifts || []).map(s => [esc(staffName(s.staffId)), hm(s.start), hm(s.end)])) + '<h3>オンラインブロック情報</h3>' + table(['スタッフ名', 'ブロック開始時間', 'ブロック終了時間'], (item.onlineBlocks || []).map(b => [(b.staffIds || [b.staffId]).map(id => esc(staffName(id))).join('、'), hm(b.start), hm(b.end)])) + '</div>' : '<p class="lo-wide">シフト時間：' + hm(item.start) + '〜' + hm(item.end) + '</p>';
      form(app, item.name + 'を読み込む', preview + '<p class="lo-wide lo-note">予定の重複や予約への影響を保存前に確認します。競合する日がある場合は、どの日にも適用しません。</p>' + field('適用開始日 *', 'from', app.date, 'date', 'required') + field('適用終了日 *', 'to', app.date, 'date', 'required') + select('適用方法', 'mode', [['merge', '未登録の枠に追加'], ['replace', '対象のシフトを置き換え']]) + (action === 'pattern-apply' ? '<fieldset class="lo-wide lo-staff-pick"><legend>対象スタッフ *</legend>' + (app.data.staff || []).map(s => '<label><input type="checkbox" name="staffIds" value="' + esc(s.id) + '"' + ((s.info_missing || []).length ? ' disabled' : '') + '>' + esc(s.name) + ((s.info_missing || []).length ? '（スタッフ情報の入力が必要）' : '') + '</label>').join('') + '</fieldset>' : ''), '内容を確認して適用');
    } else if (action === 'pattern-edit' || app.view === 'patterns') {
      const p = (app.data.patterns || []).find(x => x.id === id) || {};
      app.editor.action = 'patternSave';
      form(app, id ? 'シフトパターンの編集' : 'シフトパターンの新規作成', field('名前 *', 'name', p.name || '', 'text', 'required maxlength="100"') + field('開始時間 *', 'start', hm(p.start ?? 600), 'text', 'pattern="[0-9]{1,2}:[0-9]{2}" required') + field('終了時間 *', 'end', hm(p.end ?? 1620), 'text', 'pattern="[0-9]{1,2}:[0-9]{2}" required') + field('表示順序 *', 'sort_order', p.sort_order || 0, 'number', 'min="0" max="99999" step="1" required') + '<p class="lo-wide lo-note">10:00〜27:00 で設定します。翌 1 時は 25:00 と入力してください。</p><div class="lo-wide lo-pattern-blocks">' + (p.blocks || []).map(blockRow).join('') + '</div><div class="lo-wide">' + button('休憩・業務を追加', 'pattern-block-add') + '</div>');
    } else if (app.view === 'templates') {
      app.editor.action = 'templateSave';
      form(app, app.date + ' のシフトをひな型に登録', field('ひな型名 *', 'name', '', 'text', 'required maxlength="100"') + field('表示順序 *', 'sort_order', 0, 'number', 'min="0" max="99999" step="1" required') + '<p class="lo-wide lo-note">表示日のシフト・休憩・業務だけを保存します。予約・顧客の情報は保存しません。</p>');
    } else if (app.view === 'retail') {
      if (!(app.data.products || []).some(p => p.active !== 0 && p.active !== false)) { report(app, '販売中の商品がありません。先に商品を登録してください。', true); return; }
      app.editor.action = 'retailSale';
      form(app, '物販を販売', field('顧客名（任意）', 'name', '', 'text', 'maxlength="100"') + '<div class="lo-wide lo-cart">' + cartRow(app) + '</div><div class="lo-wide lo-actions">' + button('商品を追加', 'cart-add') + '<b class="lo-cart-total"></b></div><div class="lo-wide">' + paymentFields(0) + '</div>' + textarea('備考', 'note'), '売上を登録');
      recalculate(app, true);
    } else if (app.view === 'online') {
      const b = (app.data.onlineBlocks || []).find(x => x.id === id) || {};
      const ids = b.staffIds || (b.staffId ? [b.staffId] : []);
      app.editor.action = 'onlineBlockSave';
      form(app, id ? 'オンラインブロックの編集' : 'オンラインブロック新規作成', field('日付', 'dateLabel', app.date, 'date', 'disabled') + field('ブロック開始時間 *', 'start', hm(b.start ?? 600), 'text', 'pattern="[0-9]{1,2}:[0-9]{2}" required') + field('ブロック終了時間 *', 'end', hm(b.end ?? 660), 'text', 'pattern="[0-9]{1,2}:[0-9]{2}" required') + '<div class="lo-wide lo-actions">' + button('全選択', 'staff-check-all') + button('全解除', 'staff-check-none') + '</div><fieldset class="lo-wide lo-staff-pick"><legend>ブロックスタッフ *</legend>' + (app.data.staff || []).filter(s => s.start != null || ids.includes(s.id)).map(s => '<label><input type="checkbox" name="staffIds" value="' + esc(s.id) + '"' + (ids.includes(s.id) ? ' checked' : '') + '>' + esc(s.name) + ' ' + (s.start == null ? 'シフトなし' : hm(s.start) + '〜' + hm(s.end)) + '</label>').join('') + '</fieldset>' + textarea('備考', 'note', b.note || ''), '登録');
    } else if (app.view === 'goals') {
      const g = app.data.goal || {};
      app.editor.action = 'goalSave';
      form(app, app.date + ' の目標', field('日次予算（目標）*', 'amount', g.amount ?? 0, 'number', 'min="0" max="100000000" step="1" required') + textarea('目標コメント', 'note', g.note || '') + textarea('本日の実施プラン', 'todayPlan', g.todayPlan || '') + textarea('本日の振り返り', 'review', g.review || ''));
    } else if (app.view === 'returns') {
      const r = (app.data.returns || []).find(x => x.id === id) || {};
      app.editor.action = 'returnSave'; app.editor.date = r.date || app.date;
      form(app, id ? '返客・キャンセル待ちの編集' : '返客・キャンセル待ちを登録', '<p class="lo-wide">記録日：' + esc(app.editor.date) + '</p>' + field('顧客名 *', 'name', r.name || '', 'text', 'required maxlength="100"') + field('開始時間（任意）', 'time', r.time == null ? '' : hm(r.time), 'text', 'placeholder="10:00" pattern="[0-9]{1,2}:[0-9]{2}"') + select('種別', 'kind', [['返客', '返客'], ['キャンセル待ち', 'キャンセル待ち']], r.kind || '返客') + select('担当スタッフ', 'staffId', staffOptions(app), r.staffId || '') + field('返客理由 *', 'reason', r.reason || '', 'text', 'required maxlength="200"') + select('キャンセル待ちステータス', 'waitStatus', [['', '該当なし'], ['待機中', '待機中'], ['連絡済み', '連絡済み'], ['案内済み', '案内済み'], ['終了', '終了']], r.waitStatus || '') + field('予約タグ（読点で区切る）', 'tags', r.tags || '', 'text', 'maxlength="300"') + textarea('コメント', 'note', r.note || ''));

    }
  }
  function recalculate(app, fillCash = false) {
    const f = app.root.querySelector('.lo-form');
    if (!f || !app.editor) return;
    let amount;
    if (app.editor.action === 'checkout') {
      amount = Math.max(0, Number(app.editor.total) - Number(f.elements.discount.value || 0));
      f.querySelector('.lo-final-total b').textContent = yen(amount);
    } else if (app.editor.action === 'retailSale') {
      amount = [...f.querySelectorAll('.lo-cart-row')].reduce((sum, row) => sum + Number((app.data.products || []).find(p => p.id === row.querySelector('[name=productId]').value)?.price || 0) * Number(row.querySelector('[name=quantity]').value || 0), 0);
      f.querySelector('.lo-cart-total').textContent = '合計 ' + yen(amount);
    } else return;
    const nonCash = Object.keys(methods).filter(m => m !== 'cash').reduce((sum, m) => sum + Number(f.elements['pay_' + m]?.value || 0), 0);
    if (fillCash || f.elements.pay_cash?.dataset.auto !== '0') f.elements.pay_cash.value = Math.max(0, amount - nonCash);
    const sum = nonCash + Number(f.elements.pay_cash?.value || 0), text = f.querySelector('.lo-payment-total');
    text.textContent = '内訳合計 ' + yen(sum) + (sum === amount ? '（一致）' : ' ／差額 ' + yen(amount - sum));
    text.classList.toggle('lo-danger', sum !== amount);
  }
  function dateTargets(app, from, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('適用期間を確認してください。');
    const dates = [];
    for (let ms = Date.parse(from + 'T00:00:00Z'); ms <= Date.parse(to + 'T00:00:00Z'); ms += 86400e3) {
      if (dates.length >= 62) throw new Error('一度に適用できる期間は 62 日までです。');
      const date = new Date(ms).toISOString().slice(0, 10);
      const day = (app.data.days || []).find(d => d.date === date);
      const revision = day?.revision ?? day?.version;
      if (!Number.isInteger(revision)) throw new Error('対象日の最新シフトを取得できていません。表示日を適用開始日にして、再読込してください。');
      dates.push({ date, revision });
    }
    return dates;
  }
  async function submit(app, f) {
    if (app.busy || !app.data || !app.editor || !f.reportValidity()) return;
    const v = name => f.elements[name]?.value?.trim() || '';
    const action = app.editor.action, id = app.editor.id;
    let body = { action, ...(id ? { id } : {}) };
    if (action === 'moveBooth') {
      const boothIds = [...f.querySelectorAll('select[name^=booth_]')].map(el => el.value);
      if (!boothIds.length || boothIds.some(id => !id) || new Set(boothIds).size !== boothIds.length) throw new Error('人数分の異なるブースを選択してください。');
      if (app.editor.nominated && !f.elements.nominationConfirmed?.checked) throw new Error('指名予約の変更内容を確認してください。');
      await save(app, { action, id, boothIds, expectBoothIds: app.editor.before, confirmNominationMove: app.editor.nominated && f.elements.nominationConfirmed.checked }, 'ブースを変更しました。', true); return;
    } else if (action === 'checkoutVoid' || action === 'retailVoid') {
      const reason = v('reason');
      if (!reason) throw new Error('取消理由を入力してください。');
      body = { action, ...(action === 'checkoutVoid' ? { bookingId: id, dayRevision: app.data.dayRevision, bookingFingerprint: app.data.bookings.find(b => b.bookingId === id)?.bookingFingerprint } : { id }), reason };
    } else if (action === 'dayToggle') {
      await save(app, { action: 'toggle', enabled: app.editor.enabled }, 'オンライン受付を変更しました。', true); return;
    } else if (['productDelete', 'returnDelete', 'templateDelete', 'patternDelete', 'onlineBlockDelete'].includes(action)) {
      body = { action, id, date: app.editor.date || app.date, ...(action === 'onlineBlockDelete' ? { dayRevision: app.data.dayRevision } : {}) };
    } else if (action === 'checkout') {
      const amount = Number(app.editor.total) - integer(v('discount'), '値引金額', 0, Number(app.editor.total));
      body = { action, bookingId: id, dayRevision: app.data.dayRevision, bookingFingerprint: app.data.bookings.find(b => b.bookingId === id)?.bookingFingerprint, amount, payments: readPayments(f, amount), note: v('note') };
    } else if (action === 'productSave') {
      body = { ...body, name: v('name'), category: v('category'), price: integer(v('price'), '単価'), active: v('active') === '1', sort_order: integer(v('sort_order'), '表示順序', 0, 99999) };
    } else if (action === 'retailSale') {
      const selectedItems = [...f.querySelectorAll('.lo-cart-row')].map(row => ({ productId: row.querySelector('[name=productId]').value, quantity: integer(row.querySelector('[name=quantity]').value, '数量', 1, 999) }));
      const mergedItems = new Map();
      for (const item of selectedItems) mergedItems.set(item.productId, (mergedItems.get(item.productId) || 0) + item.quantity);
      const items = [...mergedItems].map(([productId, quantity]) => ({ productId, quantity: integer(quantity, '数量', 1, 9999) }));
      if (!items.length) throw new Error('商品を追加してください。');
      const amount = items.reduce((sum, item) => {
        const product = (app.data.products || []).find(p => p.id === item.productId);
        if (!product) throw new Error('選んだ商品を確認できません。再読込してください。');
        return sum + product.price * item.quantity;
      }, 0);
      body = { action, name: v('name'), items, payments: readPayments(f, amount), note: v('note') };
    } else if (action === 'returnSave') {
      body = { ...body, date: app.editor.date || app.date, name: v('name'), time: v('time') ? parseTime(v('time')) : null, kind: v('kind'), reason: v('reason'), waitStatus: v('waitStatus'), staffId: v('staffId'), note: v('note'), tags: v('tags') };
    } else if (action === 'templateSave') {
      body = { action, name: v('name'), sourceDate: app.date, sourceRevision: app.data.dayRevision, sort_order: integer(v('sort_order'), '表示順序', 0, 99999) };
    } else if (action === 'onlineBlockSave') {
      const staffIds = [...f.querySelectorAll('[name=staffIds]:checked')].map(el => el.value), start = parseTime(v('start')), end = parseTime(v('end'));
      if (!staffIds.length) throw new Error('停止するスタッフを選択してください。');
      if (end <= start || start % 5 || end % 5) throw new Error('開始・終了時間を 5 分刻みで、終了が後になるように指定してください。');
      for (const id of staffIds) { const s = (app.data.staff || []).find(s => s.id === id); if (s?.start == null || start < s.start || end > s.end) throw new Error('選んだスタッフ全員の勤務時間内に設定してください。'); }
      body = { ...body, staffIds, start, end, note: v('note'), dayRevision: app.data.dayRevision };
    } else if (action === 'goalSave') {
      body = { action, amount: integer(v('amount'), '日次予算'), note: v('note'), todayPlan: v('todayPlan'), review: v('review'), dayRevision: app.data.dayRevision };
    } else if (action === 'patternSave') {
      const start = parseTime(v('start')), end = parseTime(v('end'));
      if (end <= start) throw new Error('終了時間は開始時間より後にしてください。');
      const blocks = [...f.querySelectorAll('.lo-pattern-block')].map(row => ({ kind: row.querySelector('[name=blockKind]').value, start: parseTime(row.querySelector('[name=blockStart]').value), end: parseTime(row.querySelector('[name=blockEnd]').value), note: row.querySelector('[name=blockNote]').value.trim() }));
      if (blocks.some(b => b.start < start || b.end > end || b.end <= b.start)) throw new Error('休憩・業務はシフトの内側に設定してください。');
      if (blocks.some((b, i) => blocks.some((c, j) => i !== j && b.start < c.end && c.start < b.end))) throw new Error('休憩・業務の時間が重なっています。');
      body = { ...body, name: v('name'), start, end, blocks, sort_order: integer(v('sort_order'), '表示順序', 0, 99999) };
    } else if (action === 'templateApply' || action === 'patternApply') {
      const targetDates = dateTargets(app, v('from'), v('to'));
      body = { ...body, mode: v('mode') };
      if (action === 'templateApply') body.targetDates = targetDates;
      else {
        const ids = [...f.querySelectorAll('[name=staffIds]:checked')].map(el => el.value);
        if (!ids.length) throw new Error('対象スタッフを選択してください。');
        body.cells = targetDates.flatMap(d => ids.map(staffId => ({ ...d, staffId })));
      }
      if (!f.elements.applyConfirmed?.checked) {
        let confirmation = f.querySelector('.lo-apply-confirm');
        if (!confirmation) { confirmation = document.createElement('div'); confirmation.className = 'lo-apply-confirm lo-wide'; f.querySelector('.lo-grid').appendChild(confirmation); }
        confirmation.innerHTML = '<p>' + esc(v('from') + '〜' + v('to') + ' の ' + (body.cells ? body.cells.length + ' 枠' : targetDates.length + ' 日')) + 'に適用します。' + (v('mode') === 'replace' ? '対象スタッフのシフトと休憩・業務を置き換えます。予約は変更しません。' : '未登録の枠へ追加します。') + '</p><label class="lo-confirm-check"><input type="checkbox" name="applyConfirmed" required>適用日・対象・変更方法を確認しました</label>';
        confirmation.scrollIntoView({ block: 'nearest' }); report(app, '適用内容を確認し、チェックを入れて適用ボタンを押してください。'); return;
      }
    } else return;
    await save(app, body, action === 'checkout' ? '会計を登録しました。' : '保存しました。');
  }
  async function action(app, name, id, target) {
    if (name === 'close') { close(app); return; }
    if (app.busy) return;
    if (name === 'reload') { if (discard(app)) await read(app); return; }
    if (!app.data) return;
    if (name === 'editor-close') { if (discard(app)) { app.root.querySelector('.lo-editor').replaceChildren(); app.editor = null; app.dirty = false; } return; }
    if (['new', 'checkout', 'return-edit', 'product-new', 'product-edit', 'pattern-edit', 'online-edit', 'template-apply', 'pattern-apply'].includes(name)) { editor(app, name, id); return; }
    if (name === 'staff-check-all' || name === 'staff-check-none') { app.root.querySelectorAll('[name=staffIds]:not(:disabled)').forEach(el => { el.checked = name === 'staff-check-all'; }); app.dirty = true; return; }
    if (name === 'goal-edit') { if (discard(app)) { app.date = id; app.options = { create: true }; const dateInput = app.root.querySelector('[data-date=date]'); if (dateInput) dateInput.value = id; await read(app); } return; }
    if (name === 'products') {
      if (!discard(app)) return;
      app.root.querySelector('.lo-editor').innerHTML = '<section class="lo-form-card"><h3>商品一覧</h3>' + table(['ID', '物販名', '種別', '単価', '販売状況', '操作'], (app.data.products || []).map(p => [esc(p.id), esc(p.name), esc(p.category), yen(p.price), p.active === 0 || p.active === false ? '停止中' : '販売中', button('編集', 'product-edit', p.id) + button('削除', 'product-delete', p.id)])) + '</section>';
      app.dirty = false; return;
    }
    if (name === 'booking-detail') {
      const b = (app.data.bookings || []).find(x => x.bookingId === id);
      if (!b) return;
      app.root.querySelector('.lo-editor').innerHTML = '<section class="lo-form-card"><h3>' + esc(b.name) + ' 様の予約</h3><p>' + esc(b.date) + ' ' + hm(b.start) + ' ／ ' + esc(b.staffName) + '</p><p>' + esc(b.menu) + '</p><p>' + yen(b.total) + ' ／ ' + (b.status === 'cancelled' ? '取消済み' : '確定') + '</p><p>' + esc(b.note) + '</p>' + button('この日の台帳を開く', 'booking-day', b.date) + button('閉じる', 'editor-close') + '</section>';
      app.root.querySelector('.lo-editor').scrollIntoView({ block: 'nearest' }); return;
    }
    if (name === 'booking-day') { close(app); if (current !== app) window.__pmGoToLedgerDate?.(id); return; }
    if (name === 'booth-booking-detail') {
      const original = [...document.querySelectorAll('.ledger-event[data-ledger-booking-id]')].find(el => el.dataset.ledgerBookingId === id);
      close(app); if (current !== app) { if (original && !original.disabled) original.click(); else window.__pmOpenLedger('bookings', { date: app.date }); } return;
    }
    if (name === 'receipt-day') { if (discard(app)) { app.date = id; const dateInput = app.root.querySelector('[data-date=date]'); if (dateInput) dateInput.value = id; await read(app); } return; }
    if (name === 'cart-add') { app.root.querySelector('.lo-cart').insertAdjacentHTML('beforeend', cartRow(app)); app.dirty = true; recalculate(app); return; }
    if (name === 'cart-remove') { target.closest('.lo-cart-row')?.remove(); app.dirty = true; recalculate(app); return; }
    if (name === 'pattern-block-add') { app.root.querySelector('.lo-pattern-blocks').insertAdjacentHTML('beforeend', blockRow()); app.dirty = true; return; }
    if (name === 'pattern-block-remove') { target.closest('.lo-pattern-block')?.remove(); app.dirty = true; return; }
    if (name.endsWith('-delete')) {
      const actions = { 'product-delete': 'productDelete', 'return-delete': 'returnDelete', 'template-delete': 'templateDelete', 'pattern-delete': 'patternDelete', 'online-delete': 'onlineBlockDelete' };
      if (actions[name]) {
        app.editor = { action: actions[name], id, date: name === 'return-delete' ? (app.data.returns || []).find(r => r.id === id)?.date : app.date };
        form(app, '削除の確認', '<p class="lo-wide">記録 ' + esc(id) + ' を' + (name === 'product-delete' ? '販売停止に' : '削除') + 'します。登録済みの予約は変更しません。</p>', name === 'product-delete' ? '販売停止を確定' : '削除を確定');
      }
      return;
    }
    if (name === 'checkout-void' || name === 'retail-void') {
      app.editor = { action: name === 'checkout-void' ? 'checkoutVoid' : 'retailVoid', id };
      const record = name === 'checkout-void' ? app.data.bookings.find(b => b.bookingId === id) : app.data.sales.find(s => s.id === id);
      form(app, '会計記録の取消', '<p class="lo-wide">' + esc(record?.name || '対象の記録') + ' ／ ' + yen(record?.paid_amount ?? record?.amount) + '</p><p class="lo-wide lo-note">記録を取り消します。現金の返金や決済会社への返金処理は、この画面では行われません。</p>' + '<label class="lo-wide">取消理由 *<textarea name="reason" required maxlength="1000"></textarea></label>', '理由を記録して取消確定'); return;
    }
    if (name === 'day-toggle') {
      app.editor = { action: 'dayToggle', enabled: id === '1' };
      form(app, 'オンライン予約受付の変更', '<p class="lo-wide">' + esc(app.date) + ' のオンライン予約受付を' + (id === '1' ? '再開' : '停止') + 'します。</p>', '変更を確定');
      return;
    }
    if (name === 'staff-lock') {
      const staff = app.data.staff.find(s => s.id === id);
      if (staff) await save(app, { action: 'lockStaff', staffId: id, locked: !staff.locked }, 'この日の受付状態を変更しました。', true);
    }
  }
  window.__pmOpenLedger = function (view, options = {}) {
    if (!titles[view]) return;
    if (current) { const before = current; close(before); if (current === before) return; }
    const root = document.createElement('div'); root.id = 'pm-ledger-operations'; root.tabIndex = -1;
    const app = { root, view, options, date: options.date || ledgerDate(), seq: 0, busy: false, data: null, dirty: false, previousFocus: document.activeElement };
    current = app;
    root.innerHTML = '<section class="lo-dialog" role="dialog" aria-modal="true" aria-labelledby="lo-title"><header><h2 id="lo-title">' + titles[view] + '</h2>' + button('閉じる', 'close') + '</header><div class="lo-datebar">' + field('表示日', 'date', app.date, 'date', 'data-date="date" required') + (['returns', 'bookings'].includes(view) ? field('検索終了日', 'to', app.date, 'date', 'data-date="to" required') : '') + button('再読込', 'reload') + '<span class="lo-changed" hidden>別の画面で変更がありました。保存前に再読込してください。</span></div><div class="lo-message" role="status" hidden></div><main><div class="lo-editor"></div><div class="lo-content"></div></main></section>';
    root.addEventListener('click', e => {
      const el = e.target.closest('[data-lo]');
      if (el) action(app, el.dataset.lo, el.dataset.id, el).catch(error => report(app, error.message, true));
    });
    root.addEventListener('submit', e => { if (e.target.matches('.lo-form')) { e.preventDefault(); submit(app, e.target).catch(error => report(app, error.message, true)); } });
    root.addEventListener('input', e => {
      if (app.busy) return;
      if (e.target.closest('.lo-form')) { app.dirty = true; if (e.target.name !== 'applyConfirmed') { const confirmed = root.querySelector('[name=applyConfirmed]'); if (confirmed) { confirmed.checked = false; root.querySelector('.lo-apply-confirm')?.remove(); } } if (e.target.name.startsWith('booth_')) { const confirmed = root.querySelector('[name=nominationConfirmed]'); if (confirmed) confirmed.checked = false; } if (e.target.name === 'pay_cash') e.target.dataset.auto = '0'; recalculate(app); }
      if (e.target.dataset.filter === 'search') { const input = e.target, position = input.selectionStart; app.search = input.value; render(app); const next = root.querySelector('[data-filter=search]'); next?.focus(); if (next && position != null) next.setSelectionRange(position, position); }
    });
    root.addEventListener('change', e => {
      if (app.busy) return;
      if (e.target.dataset.filter === 'status') { app.status = e.target.value; render(app); }
      if (e.target.dataset.filter === 'bookingStatus') { app.bookingStatus = e.target.value; render(app); }
      if (e.target.dataset.date) {
        if (!e.target.value || !discard(app)) { e.target.value = e.target.name === 'to' ? app.to || app.date : app.date; return; }
        if (e.target.name === 'to') app.to = e.target.value;
        else { app.date = e.target.value; app.from = app.date; if (!app.to || app.to < app.date) { app.to = app.date; const end = root.querySelector('[data-date=to]'); if (end) end.value = app.to; } }
        if (app.to && app.to < app.date) { report(app, '検索終了日は表示日以降にしてください。', true); return; }
        read(app);
      }
    });
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(app); }
      if (e.key === 'Tab') {
        const focusable = [...root.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
        if (!focusable.length) { e.preventDefault(); root.focus(); return; }
        if (document.activeElement === root) { e.preventDefault(); (e.shiftKey ? focusable.at(-1) : focusable[0]).focus(); return; }
        if (e.shiftKey && document.activeElement === focusable[0]) { focusable.at(-1).focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === focusable.at(-1)) { focusable[0].focus(); e.preventDefault(); }
      }
    });
    document.body.appendChild(root); document.body.classList.add('lo-open');
    root.querySelector('[data-lo=close]').focus(); read(app);
  };
  window.addEventListener('cn:seq', () => {
    if (current?.data && !current.busy) current.root.querySelector('.lo-changed').hidden = false;
  });
})();

// スタッフ台帳と同じデータ・時間軸を使うブース表示。ブース名からの推測割当はしない。
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hm = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  let mode = 'staff', density = 'all', last = '', drag = null, suppressClickUntil = 0;
  try { mode = sessionStorage.getItem('cn-ledger-view') || mode; density = sessionStorage.getItem('cn-ledger-density') || density; } catch {}
  if (!['staff', 'booths', 'both'].includes(mode)) mode = 'staff';
  if (!['basic', 'all'].includes(density)) density = 'all';
  window.__pmSetLedgerView = value => { if (!['staff', 'booths', 'both'].includes(value)) return; mode = value; try { sessionStorage.setItem('cn-ledger-view', value); } catch {} update(); };
  window.__pmSetLedgerDensity = value => { if (!['basic', 'all'].includes(value)) return; density = value; try { sessionStorage.setItem('cn-ledger-density', value); } catch {} update(); };
  function update() {
    const scroll = document.querySelector('.ledger-main .ledger-grid-scroll');
    if (!scroll) { document.getElementById('lo-booth-panel')?.remove(); return; }
    document.body.classList.toggle('lo-view-booths', mode === 'booths');
    document.body.classList.toggle('lo-density-all', density === 'all');
    document.body.classList.toggle('lo-density-basic', density === 'basic');
    for (const b of document.querySelectorAll('[data-ledger-view]')) { const selected = b.dataset.ledgerView === mode; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); }
    for (const b of document.querySelectorAll('[data-ledger-density]')) { const selected = b.dataset.ledgerDensity === density; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); }
    let panel = document.getElementById('lo-booth-panel');
    if (mode === 'staff') { if (panel) panel.hidden = true; return; }
    if (!panel) {
      panel = document.createElement('section'); panel.id = 'lo-booth-panel'; scroll.insertAdjacentElement('afterend', panel); last = '';
      panel.addEventListener('click', e => {
        if (Date.now() < suppressClickUntil) { e.preventDefault(); return; }
        const button = e.target.closest('[data-booth-booking]'); if (!button) return;
        window.__pmOpenLedger?.('boothMove', { bookingId: button.dataset.boothBooking, date: panel.dataset.date });
      });
      panel.addEventListener('pointerdown', e => {
        const button = e.target.closest('[data-booth-booking]');
        if (!button || e.button !== 0 || e.pointerType === 'touch' || document.body.classList.contains('pm-ledger-dragging')) return;
        drag = { button, id: button.dataset.boothBooking, source: button.closest('[data-booth-row]')?.dataset.boothRow, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, date: panel.dataset.date };
        button.setPointerCapture(e.pointerId);
      });
      panel.addEventListener('pointermove', e => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
        if (!drag.moved) {
          drag.moved = true; document.body.classList.add('pm-ledger-dragging');
          const rect = drag.button.getBoundingClientRect(); drag.rect = rect;
          const ghost = drag.button.cloneNode(true); ghost.removeAttribute('data-booth-booking'); ghost.className = 'lo-booth-ghost';
          Object.assign(ghost.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' }); document.body.appendChild(ghost); drag.ghost = ghost;
        }
        e.preventDefault();
        if (drag.ghost) drag.ghost.style.transform = 'translate3d(0,' + (e.clientY - drag.y) + 'px,0)';
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-booth-row]');
        panel.querySelectorAll('.lo-booth-drop').forEach(el => { if (el !== target) el.classList.remove('lo-booth-drop'); });
        target?.classList.add('lo-booth-drop'); drag.target = target?.dataset.boothRow || '';
      });
      const endDrag = e => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const previous = drag; drag = null; previous.ghost?.remove();
        panel.querySelectorAll('.lo-booth-drop').forEach(el => el.classList.remove('lo-booth-drop'));
        document.body.classList.remove('pm-ledger-dragging');
        if (previous.moved) {
          suppressClickUntil = Date.now() + 500;
          if (e.type === 'pointerup' && previous.target && previous.target !== previous.source) window.__pmOpenLedger?.('boothMove', { bookingId: previous.id, date: previous.date, boothId: previous.target, replaceBoothId: previous.source });
        }
      };
      panel.addEventListener('pointerup', endDrag); panel.addEventListener('pointercancel', endDrag); panel.addEventListener('lostpointercapture', endDrag);
    }
    panel.hidden = false;
    if (document.body.classList.contains('pm-ledger-dragging')) return;
    const d = window.__pmSchedData, date = document.querySelector('.ledger-date-trigger time')?.getAttribute('datetime');
    if (!d || d.__date !== date) { panel.innerHTML = '<p class="lo-booth-note">ブースの最新情報を読み込んでいます…</p>'; last = ''; return; }
    const booths = Array.isArray(d.booths) ? d.booths : [], bookings = (d.bookings || []).filter(b => b.status === 'confirmed');
    const signature = JSON.stringify([date, booths, bookings.map(b => [b.id, b.name, b.start_at, b.end_at, b.booth_ids, b.booth_id, b.course_name, b.paid_at, b.nomination_fee, b.serviceTimings]), d.assignments]);
    if (signature === last) return; last = signature; panel.dataset.date = date;
    const ids = b => Array.isArray(b.booth_ids) && b.booth_ids.length ? b.booth_ids : b.booth_id ? [b.booth_id] : [];
    const rows = booths.filter(b => b.active !== false && b.active !== 0 || bookings.some(x => ids(x).includes(b.id)));
    if (bookings.some(b => !ids(b).length || ids(b).some(id => !booths.some(x => x.id === id)))) rows.push({ id: '', name: 'ブースの記録なし', color: 'gray' });
    const start = Date.parse(date + 'T00:00:00+09:00'), minute = ms => Math.round((ms - start) / 60000);
    const colors = { Green: '#e7efdd', Skyblue: '#e0eff5', Yellow: '#fff5c3', Gold: '#efe2b3', Pink: '#f9e3ea', gray: '#eceae7' };
    panel.innerHTML = '<h3>ブース</h3><p class="lo-booth-note">予約を押すと担当・時間・メニューを確認できます。複数名の予約は使用する各ブースに表示します。</p><div class="lo-booth-scroll"><div class="lo-booth-grid"><div class="lo-booth-head"><b>ブース名</b><div class="lo-booth-hours">' + Array.from({ length: 17 }, (_, i) => '<span>' + (i + 10) + '</span>').join('') + '</div></div>' + rows.map(booth => {
      const items = bookings.filter(b => booth.id ? ids(b).includes(booth.id) : !ids(b).length || ids(b).some(id => !booths.some(x => x.id === id)));
      return '<div class="lo-booth-row" data-booth-row="' + esc(booth.id) + '"><div class="lo-booth-name" style="background:' + (colors[booth.color] || '#ece7df') + '"><b>' + esc(booth.name) + '</b>' + (booth.online === false || booth.online === 0 ? '<small>店内受付のみ</small>' : '') + '</div><div class="lo-booth-track">' + items.map(b => {
        const from = minute(b.start_at), to = minute(b.end_at), left = Math.max(600, from), right = Math.min(1620, to);
        if (right <= left) return '';
        const staff = (d.assignments || []).filter(a => a.booking_id === b.id).map(a => (d.staff || []).find(s => s.id === a.staff_id)?.name || '担当の記録なし').join('、');
        return '<button type="button" data-booth-booking="' + esc(b.id) + '" style="left:' + ((left - 600) / 1020 * 100) + '%;width:' + ((right - left) / 1020 * 100) + '%" title="' + esc(b.name + ' 様 ' + hm(from) + '〜' + hm(to) + ' ' + staff + ' ' + (b.course_name || '')) + '">' + (left === from && right === to ? window.__pmBookingIntervalHTML?.(b, from, to) || '' : '') + '<strong>' + esc(b.name) + '</strong><span>' + hm(from) + '〜' + hm(to) + '</span><small>' + esc(staff) + '</small></button>';
      }).join('') + '</div></div>';
    }).join('') + '</div></div>';
  }
  setInterval(update, 600);
  window.addEventListener('cn:api', () => setTimeout(update, 0));
  window.addEventListener('cn:ledger-ready', update);
})();
