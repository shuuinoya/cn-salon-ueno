// 公開掲載順位は既存スタッフ ID に結び付けて保存する。スタッフマスタの表示順序とは独立。
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const errors = { staffOrderingDateRequired: '掲載日の情報が古くなっています。画面を再読み込みしてください。', staffOrderingDayChanged: '営業日が変わりました。最新の情報を読み直して、今日の掲載順を設定してください。', staffOrderingInvalid: "No.は 1〜999999 の整数で入力してください。スタッフが増減した場合は読み直してください。", staffOrderingDuplicate: "同じ No. が重複しています。別の番号を入力してください。", staffOrderingConflict: "ほかの画面でスタッフ情報または掲載順位が変更されました。入力内容を控えてから最新の情報を読み直してください。", forbidden: '掲載順位の保存には管理者のログインが必要です。', staffOrderChanged: 'ほかの画面でスタッフ情報または掲載順位が変更されました。最新の情報を読み直してから設定してください。', staffOrderingChanged: 'ほかの画面でスタッフ情報または掲載順位が変更されました。最新の情報を読み直してから設定してください。', invalidOrder: 'No.は 1〜999999 の重複しない整数で入力してください。', invalid: '入力した No. とスタッフ情報を確認してください。', requestChanged: '先に送った内容と異なります。最新の情報を読み直してください。' };
  let current = null;
  // 閉じる・詳細へ進む・別画面へ移る操作を同じ確認にそろえる。
  function confirmLeave(app) {
    if (app.busy) { setMessage(app, '保存・読み込み中です。完了後に戻れます。', false); return Promise.resolve(false); }
    if (!app.dirty && !app.unknown) return Promise.resolve(true);
    if (app.leavePrompt) return app.leavePrompt;
    app.leavePrompt = new Promise(resolve => {
      const focus = document.activeElement, prompt = document.createElement('dialog');
      prompt.className = 'so-leave-dialog'; prompt.setAttribute('aria-labelledby', 'so-leave-title');
      prompt.innerHTML = '<h2 id="so-leave-title">変更を破棄しますか？</h2><p>' + (app.unknown
        ? '保存結果を確認できていません。この画面の入力を破棄して戻ります。すでに保存された内容は取り消されません。'
        : '保存していない掲載順の変更があります。') + '</p><div><button type="button" data-leave="keep" autofocus>編集を続ける</button><button type="button" data-leave="discard">変更を破棄して戻る</button></div>';
      let done = false;
      const finish = discard => {
        if (done) return; done = true; prompt.close(); prompt.remove(); app.leavePrompt = null;
        if (!discard && focus?.isConnected) focus.focus(); resolve(discard);
      };
      prompt.addEventListener('click', e => { const action=e.target.closest('[data-leave]')?.dataset.leave; if(action)finish(action==='discard'); });
      prompt.addEventListener('cancel', e => { e.preventDefault(); finish(false); });
      document.body.appendChild(prompt); prompt.showModal(); prompt.querySelector('[data-leave="keep"]').focus();
    });
    return app.leavePrompt;
  }
  async function leave(app, action) {
    if (app.leaving) return;
    app.leaving = true;
    try { if (await confirmLeave(app)) await action(); }
    finally { app.leaving = false; }
  }
  function discardLocal(app) {
    app.dirty=false; app.unknown=false; app.pending=null;
    if (app.data && app.host.isConnected) render(app);
  }
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
      el.disabled = app.busy || !!app.dragging || (el.matches('[data-so=up],[data-so=down]') && (!app.data?.canManage || app.unknown)) || (el.matches('[data-order-id]') && (!app.data?.canManage || app.unknown)) || (el.matches('[data-so=save]') && (!app.data?.canManage || !app.dirty));
    });
    app.host.setAttribute('aria-busy', String(app.busy));
    const save = app.host.querySelector('[data-so=save]');
    if (save) save.textContent = app.busy && app.pending ? '保存中…' : app.unknown ? '同じ内容で保存結果を確認' : 'この順番で保存';
  }
  function render(app) {
    const data = app.data;
    app.host.innerHTML = '<p class="so-help">予約サイトには選んだ日の勤務者を掲載します。並べ替えはその日だけ適用し、翌営業日はシフト順に戻ります。台帳や月間シフトの順番は変わりません。</p>' +
      '<div class="so-toolbar"><p class="so-message" role="status"></p>' +
      '<div class="so-actions"><button type="button" data-so="save" class="staff-primary">この順番で保存</button><button type="button" data-so="reload">最新の情報を読み直す</button><span>' + esc(data.date) + ' のみ ／ 掲載 ' + data.staff.filter(s => s.listed && s.working).length + '人 ／ 登録 ' + data.staff.length + '人</span></div></div>' +
      '<div class="so-scroll"><table class="so-table"><thead><tr><th>No.</th><th>写真</th><th>スタッフ名</th><th>プロフィール</th><th>公開状態</th><th>編集</th></tr></thead><tbody>' + data.staff.map(s => '<tr data-staff-id="' + esc(s.id) + '"><td><input type="number" min="1" max="999999" step="1" inputmode="numeric" required aria-label="' + esc(s.name) + 'の掲載順位 No." data-order-id="' + esc(s.id) + '" value="' + esc(s.listingOrder) + '"></td><td>' + (s.photo ? '<img src="' + esc(s.photo) + '" alt="" width="48" height="64" loading="lazy">' : '<span class="so-muted">写真なし</span>') + '</td><td><b>' + esc(s.name) + '</b>' + (s.registeredName !== s.name ? '<small>' + esc(s.registeredName) + '</small>' : '') + '<small>ID: ' + esc(s.id.slice(0, 8)) + '</small></td><td><p class="so-profile">' + esc(s.message || '紹介文なし') + '</p></td><td><b>' + (s.listed ? s.working ? '掲載中' : '勤務なし' : '非掲載') + '</b><small>' + esc(s.listed ? '' : (s.reasons || []).join(' / ')) + '</small></td><td><button type="button" data-so="edit" data-id="' + esc(s.id) + '" aria-label="' + esc(s.name) + 'の詳細編集">詳細編集</button></td></tr>').join('') + '</tbody></table></div>' +
      '<div class="so-discard" hidden><p>入力中の順位を破棄して、最新の情報を読み直します。保存結果が分からない場合も、保存済みの順位をここで確認できます。</p><button type="button" data-so="discard">読み直す</button><button type="button" data-so="keep">入力に戻る</button></div>';
    if (app.cards) renderCards(app);
    if (!data.canManage) setMessage(app, '掲載順位は閲覧のみです。保存は管理者が行えます。', false);
    controls(app);
  }
  async function load(app) {
    if (app.dragging) { app.refreshPending = true; return; }
    if (app.busy || !app.host.isConnected) return;
    app.busy = true; controls(app);
    if (!app.data) app.host.innerHTML = '<p class="so-message" role="status">読み込み中…</p>';
    const sequence = ++app.sequence;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/demo/staff-ordering', { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.staff) || !data.version || !/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) throw Error(errors[data.error] || '掲載順位を読み込めませんでした。');
      if (!app.host.isConnected || sequence !== app.sequence) return;
      app.data = data; app.dirty = false; app.unknown = false; app.pending = null; render(app);
      return true;
    } catch (error) {
      if (!app.data) app.host.innerHTML = '<p class="so-message" role="alert"></p><button type="button" data-so="reload">再読み込み</button>';
      setMessage(app, controller.signal.aborted ? '読み込みに時間がかかっています。通信を確認して、もう一度読み込んでください。' : error.message || '通信に失敗しました。再度読み込んでください。', true);
    } finally { clearTimeout(timer); app.busy = false; controls(app); }
  }
  async function save(app) {
    if (app.busy || app.dragging || !app.data?.canManage || !app.dirty) return;
    let payload;
    try {
      const values = orders(app);
      payload = app.unknown && app.pending ? app.pending : { date: app.data.date, version: app.data.version, orders: values, requestKey: crypto.randomUUID() };
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
        ? app.data.date !== payload.date ? payload.date + 'の掲載順位を保存しました。現在の営業日の掲載順を表示しています。'
        : app.data.version === savedVersion ? '掲載順位を保存しました。この日だけ予約サイトに反映されます。' : '掲載順位の保存後に別の変更がありました。最新の保存済み順位を表示しています。'
        : '掲載順位は保存されましたが、最新の表示を取得できませんでした。「最新の情報を読み直す」で確認してください。', !refreshed);
      window.__pmKickSync?.();
    }
  }
  function mount() {
    const host = document.getElementById('staff-listing-ordering') || document.getElementById('staff-public-ordering');
    if (!host || host === current?.host) return;
    const app = current = { host, cards: host.id === 'staff-listing-ordering', data: null, busy: false, dirty: false, unknown: false, sequence: 0 };
    host.innerHTML = '<p class="so-message" role="status">掲載順位を確認できます。</p><button type="button" data-so="reload">掲載順位を読み込む</button>';
    host.addEventListener('input', event => {
      if (!event.target.matches('[data-order-id]') || app.busy || app.unknown) return;
      app.dirty = true; controls(app); setMessage(app, '変更はまだ保存されていません。', false);
    });
    host.addEventListener('click', async event => {
      const target = event.target.closest('[data-so]');
      if (!target || app.busy || app.dragging) return;
      const action = target.dataset.so;
      if (action === 'save') save(app);
      if (action === 'reload') {
        await leave(app, () => load(app));
      }
      if (action === 'discard') load(app);
      if (action === 'keep') host.querySelector('.so-discard').hidden = true;
      if (action === 'up' || action === 'down') {
        if (!app.data?.canManage || app.unknown) return;
        const card = target.closest('.so-card'), other = action === 'up' ? card.previousElementSibling : card.nextElementSibling;
        if (other) { moveCards(card.parentNode, () => card.parentNode.insertBefore(card, action === 'up' ? other : other.nextSibling)); renumber(app); target.focus(); }
      }
      if (action === 'edit') {
        await leave(app, () => {
          discardLocal(app);
          const edit = () => (window.__pmEditStaff || window.__pmOpenStaffInfo)?.(target.dataset.id);
          if (app.cards) app.dismiss?.(edit); else edit();
        });
      }
    });
    const details = host.closest('details');
    details?.addEventListener('toggle', () => { if (details.open && !app.data) load(app); });
    if (details?.open || app.cards) load(app);
    if (app.cards) bindCards(app);
  }
  function renderCards(app) {
    const table = app.host.querySelector('.so-scroll');
    table.outerHTML = '<div class="so-cards" aria-label="スタッフの掲載順">' + app.data.staff.map(s =>
      '<article class="so-card" data-staff-id="' + esc(s.id) + '"><div class="so-card-grip" title="つかんで上下に移動"><span class="so-grip-mark" aria-hidden="true">⠿</span><span class="so-rank">' + esc(s.listingOrder) + '</span>' +
      (s.photo ? '<img src="' + esc(s.photo) + '" alt="" draggable="false" width="48" height="64">' : '<span class="so-photo-empty">写真なし</span>') +
      '<div><b title="' + esc(s.name) + '">' + esc(s.name) + '</b><small title="' + esc((s.reasons || []).join(' / ')) + '">' + (s.listed ? s.working ? '掲載中' : '勤務なし' : '非掲載') + '</small></div></div>' +
      '<input type="hidden" data-order-id="' + esc(s.id) + '" value="' + esc(s.listingOrder) + '"><p class="so-profile">' + esc(s.message || '紹介文なし') + '</p><div class="so-card-actions"><button data-so="up" aria-label="' + esc(s.name) + 'を上へ">↑</button><button data-so="down" aria-label="' + esc(s.name) + 'を下へ">↓</button><button data-so="edit" data-id="' + esc(s.id) + '">詳細</button></div></article>').join('') + '</div>';
    app.host.querySelector('.so-help').hidden = true;
    setMessage(app, '並べ替えはこの日だけ。翌営業日はシフト順に戻ります。', false);
  }
  function renumber(app) {
    [...app.host.querySelectorAll('.so-card')].forEach((card, i) => { card.querySelector('[data-order-id]').value = i + 1; card.querySelector('.so-rank').textContent = i + 1; });
    app.dirty = true; controls(app); setMessage(app, '未保存の変更があります。「この順番で保存」で予約サイトに反映します。', false);
  }
  const cardAnimations = new WeakMap();
  const quietMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cardMotion = { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
  // 入れ替え前の見た目から新しい位置へ移す。前の動きが途中でも飛ばさない。
  function moveCards(list, change, skip) {
    const cards = [...list.children].filter(card => card !== skip);
    const before = new Map(cards.map(card => [card, card.getBoundingClientRect().top]));
    cards.forEach(card => { cardAnimations.get(card)?.cancel(); card.style.willChange = ''; });
    change();
    if (quietMotion()) return;
    for (const card of cards) {
      const dy = before.get(card) - card.getBoundingClientRect().top;
      if (Math.abs(dy) < 0.5 || !card.animate) continue;
      card.style.willChange = 'transform';
      const animation = card.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], cardMotion);
      cardAnimations.set(card, animation);
      animation.finished.then(() => {
        if (cardAnimations.get(card) === animation) { card.style.willChange = ''; cardAnimations.delete(card); }
      }, () => {});
    }
  }
  function bindCards(app) {
    let drag = null, suppressClick = false;
    const host = app.host, dialog = host.closest('dialog'), lifetime = new AbortController();
    const cleanup = (d, cancel) => {
      if (drag !== d) return;
      drag = null; cancelAnimationFrame(d.frame); d.settle?.cancel();
      d.preview?.remove(); d.card.classList.remove('so-drag-placeholder');
      host.classList.remove('so-sorting');
      if (cancel) {
        moveCards(d.list, () => d.original.forEach(card => d.list.appendChild(card)));
        host.scrollTop = d.scrollTop;
      }
      app.dragging = false;
      if (host.hasPointerCapture?.(d.id)) host.releasePointerCapture(d.id);
      if (!cancel && d.moved && d.original.some((card, i) => d.list.children[i] !== card)) renumber(app);
      controls(app);
      if (d.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
      if (app.refreshPending) {
        app.refreshPending = false;
        if (!app.dirty && !app.unknown && host.isConnected) load(app);
      }
    };
    const finish = cancel => {
      const d = drag;
      if (!d) return;
      cancelAnimationFrame(d.frame);
      if (cancel || !d.moved || quietMotion() || !d.preview.animate) { cleanup(d, cancel); return; }
      if (d.settling) return;
      d.settling = true;
      const target = d.card.getBoundingClientRect();
      d.settle = d.preview.animate([
        { transform: d.preview.style.transform },
        { transform: `translate3d(${target.left}px,${target.top}px,0)` }
      ], { ...cardMotion, duration: 140, fill: 'forwards' });
      d.settle.finished.then(() => cleanup(d, false), () => {});
    };
    app.cancelDrag = () => finish(true);
    host.addEventListener('click', e => {
      if (suppressClick || app.dragging) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    host.addEventListener('dragstart', e => { if (e.target.closest('.so-card')) e.preventDefault(); });
    host.addEventListener('pointerdown', e => {
      const card = e.target.closest('.so-cards > .so-card');
      if (drag || !card || e.button !== 0 || e.isPrimary === false || !app.data?.canManage || app.busy || app.unknown || e.target.closest('button,input,a') || (e.pointerType === 'touch' && !e.target.closest('.so-card-grip'))) return;
      const rect = card.getBoundingClientRect(), list = card.parentNode;
      cardAnimations.get(card)?.cancel(); cardAnimations.delete(card); card.style.willChange = '';
      drag = { card, list, id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY,
        grabX: e.clientX - rect.left, grabY: e.clientY - rect.top, width: rect.width, height: rect.height,
        original: [...list.children], scrollTop: host.scrollTop, moved: false, frame: 0, lastTime: 0 };
      app.dragging = true;
      host.setPointerCapture(e.pointerId);
    });
    const draw = (time, scroll = true) => {
      const d = drag;
      if (!d?.moved || d.settling) return;
      if (!host.isConnected) { finish(true); return; }
      const box = host.getBoundingClientRect(), elapsed = d.lastTime ? Math.min(32, time - d.lastTime) : 0;
      d.lastTime = time;
      if (scroll) {
        const edge = Math.min(56, box.height / 4);
        const speed = d.lastY < box.top + edge ? -Math.min(1, (box.top + edge - d.lastY) / edge)
          : d.lastY > box.bottom - edge ? Math.min(1, (d.lastY - box.bottom + edge) / edge) : 0;
        host.scrollTop += speed * elapsed * 0.55;
      }
      // 判定にはアニメーション中の見かけの座標を使わず、配置先の座標を使う。
      const center = d.lastY - d.grabY + d.height / 2, top = d.list.getBoundingClientRect().top;
      const before = [...d.list.children].find(card => card !== d.card && center <= top + card.offsetTop + card.offsetHeight / 2) || null;
      if (d.card.nextElementSibling !== before) moveCards(d.list, () => d.list.insertBefore(d.card, before), d.card);
      const x = Math.max(box.left + 2, Math.min(box.right - d.width - 2, d.lastX - d.grabX));
      const y = Math.max(box.top + 2, Math.min(box.bottom - d.height - 2, d.lastY - d.grabY));
      d.preview.style.transform = `translate3d(${x}px,${y}px,0)`;
    };
    const tick = time => { draw(time); if (drag?.moved && !drag.settling) drag.frame = requestAnimationFrame(tick); };
    host.addEventListener('pointermove', e => {
      const d = drag;
      if (!d || d.settling || e.pointerId !== d.id) return;
      d.lastX = e.clientX; d.lastY = e.clientY;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
        d.moved = true;
        d.preview = d.card.cloneNode(true); d.preview.classList.add('so-drag-preview');
        d.preview.setAttribute('aria-hidden', 'true'); d.preview.inert = true;
        d.preview.querySelectorAll('input').forEach(input => input.remove());
        Object.assign(d.preview.style, { width: d.width + 'px', height: d.height + 'px' });
        host.appendChild(d.preview); d.card.classList.add('so-drag-placeholder'); host.classList.add('so-sorting');
        controls(app); draw(performance.now(), false); d.frame = requestAnimationFrame(tick);
      }
      if (d.moved) e.preventDefault();
    });
    host.addEventListener('pointerup', e => {
      if (drag?.id !== e.pointerId || drag.settling) return;
      drag.lastX = e.clientX; drag.lastY = e.clientY; draw(performance.now(), false);
      const box = host.getBoundingClientRect();
      finish(e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom);
    });
    host.addEventListener('pointercancel', e => { if (drag?.id === e.pointerId) finish(true); });
    host.addEventListener('lostpointercapture', e => { if (drag?.id === e.pointerId && !drag.settling) finish(true); });
    (dialog || host).addEventListener('keydown', e => {
      if (e.key === 'Escape' && drag) { e.preventDefault(); e.stopPropagation(); finish(true); }
    }, true);
    const cancel = () => finish(true);
    window.addEventListener('blur', cancel, { signal: lifetime.signal });
    window.addEventListener('resize', cancel, { signal: lifetime.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, { signal: lifetime.signal });
    dialog?.addEventListener('close', () => { cancel(); lifetime.abort(); }, { once: true });
  }
  // ページ全体の幅やブラウザー既定の余白に依存せず、見えている領域の中央へ置く。
  function positionListing(dialog) {
    const view = window.visualViewport;
    const width = Math.min(600, Math.max(1, (view?.width || window.innerWidth) - 32));
    const height = Math.min(500, Math.max(1, (view?.height || window.innerHeight) - 48));
    const left = (view?.offsetLeft || 0) + ((view?.width || window.innerWidth) - width) / 2;
    const top = (view?.offsetTop || 0) + ((view?.height || window.innerHeight) - height) / 2;
    for (const [key,value] of Object.entries({width,height,left,top})) dialog.style.setProperty(key,value+'px');
  }
  window.__pmOpenStaffListing = () => {
    if (document.getElementById('staff-listing-dialog')) return;
    if (current?.host.isConnected && (current.dirty || current.busy || current.unknown)) return;
    const opener = document.activeElement, dialog = document.createElement('dialog');
    dialog.id='staff-listing-dialog'; dialog.className='so-dialog'; dialog.setAttribute('aria-labelledby','staff-listing-title');
    dialog.innerHTML='<header><h2 id="staff-listing-title">スタッフ掲載情報一覧</h2><button type="button" data-listing-close>閉じる</button></header><div id="staff-listing-ordering"></div>';
    document.body.appendChild(dialog);
    const appForDialog = () => current?.host.closest('dialog') === dialog ? current : null;
    const historyKey = crypto.randomUUID(); let dismissed = false;
    const finish = after => {
      if (dismissed) return; dismissed = true;
      window.removeEventListener('popstate', onBack, true);
      dialog.close(); dialog.remove(); current=null; opener?.focus();
      if (history.state?.cnStaffListing === historyKey) {
        if (after) window.addEventListener('popstate', after, { once:true });
        history.back();
      } else after?.();
    };
    const close = async () => {
      const app=appForDialog(); app?.cancelDrag?.();
      if (!app) { finish(); return; }
      await leave(app, () => { discardLocal(app); finish(); });
    };
    const onBack = event => {
      if (history.state?.cnStaffListing === historyKey || dismissed) return;
      event.stopImmediatePropagation();
      history.pushState({ ...history.state, cnStaffListing:historyKey }, '', location.href);
      close();
    };
    history.pushState({ ...history.state, cnStaffListing:historyKey }, '', location.href);
    window.addEventListener('popstate', onBack, true);
    dialog.querySelector('[data-listing-close]').addEventListener('click',close);
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    const position = () => { if(dialog.open) { current?.cancelDrag?.(); positionListing(dialog); } };
    dialog.addEventListener('close', () => { window.removeEventListener('resize',position); window.visualViewport?.removeEventListener('resize',position); window.visualViewport?.removeEventListener('scroll',position); });
    dialog.showModal(); position();
    window.addEventListener('resize',position); window.visualViewport?.addEventListener('resize',position); window.visualViewport?.addEventListener('scroll',position); mount();
    if(appForDialog()) current.dismiss=finish;
  };
  window.__pmMountStaffOrdering = mount;
  window.addEventListener('beforeunload', event => { if (current?.host.isConnected && (current.dirty || current.busy || current.unknown)) { event.preventDefault(); event.returnValue = ''; } });
  function refreshSaved() {
    if (document.hidden) return;
    if (current?.host.isConnected && current.data && (current.cards || current.host.closest('details')?.open) && !current.dirty && !current.busy && !current.unknown) load(current);
  }
  window.addEventListener('focus', refreshSaved);
  document.addEventListener('visibilitychange', refreshSaved);
  setInterval(refreshSaved, 60000);
  document.addEventListener('click', async event => {
    const app = current;
    if (!app?.host.isConnected || !(app.dirty || app.busy || app.unknown) || app.host.contains(event.target)) return;
    if (!event.target.closest('.ledger-nav button, .ledger-shopmenu button, .ledger-rail button, .staff-master-toolbar button, .staff-directory button, a[href]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const target=event.target.closest('.ledger-nav button, .ledger-shopmenu button, .ledger-rail button, .staff-master-toolbar button, .staff-directory button, a[href]');
    await leave(app, () => {
      discardLocal(app);
      const proceed=()=>{ if(target?.isConnected)target.click(); };
      if(app.cards)app.dismiss?.(proceed);else proceed();
    });
  }, true);
  window.addEventListener('cn:seq', () => {
    if (current?.host.isConnected && current.data && (current.cards || current.host.closest('details')?.open)) {
      if (current.dirty || current.busy || current.unknown) setMessage(current, 'スタッフ情報が更新されています。入力中の順位は保持しています。保存時に最新の情報と照合します。', false);
      else load(current);
    }
  });
})();
