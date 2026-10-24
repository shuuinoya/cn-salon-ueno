// 管理受付・予約編集。元の予約と同じ版を確認してから保存する。
(function () {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const yen = value => Number(value || 0).toLocaleString('ja-JP') + ' 円';
  const hm = value => String(Math.floor(Number(value) / 60)).padStart(2, '0') + ':' + String(Number(value) % 60).padStart(2, '0');
  const key = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  const field = (label, name, value = '', type = 'text', attrs = '') => '<label>' + esc(label) + '<input type="' + type + '" name="' + name + '" value="' + esc(value) + '" ' + attrs + '></label>';
  const select = (label, name, options, value = '', attrs = '') => '<label>' + esc(label) + '<select aria-label="' + esc(label) + '" name="' + name + '" ' + attrs + '>' + options.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + (o[2] ? ' disabled' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label>';
  const area = (label, name, value = '') => '<label>' + esc(label) + '<textarea aria-label="' + esc(label) + '" name="' + name + '" maxlength="1000">' + esc(value) + '</textarea></label>';
  const button = (label, action, attrs = '') => '<button type="button" data-bd="' + action + '" ' + attrs + '>' + esc(label) + '</button>';
  const errors = { ticketInvalid: 'この回数券は使用できません。残り回数・有効期限を確認してください。', ticketOwner: '回数券の所有者とメールアドレスが一致しません。', ticketExpired: 'この回数券は期限切れです。', ticketEmpty: '回数券の残り回数がありません。', ticketMenu: 'このメニューは回数券の対象外です。', ticketBookingConditions: '回数券は1名・1メニューの通常時間で使用できます。割引は併用できません。', loginRequired: 'ログインし直してください。', forbidden: '操作の権限がありません。', invalid: '入力内容・人数・時刻・割引を確認してください。', notFound: '予約が見つかりません。元日の台帳で確認してください。', bookingChanged: '予約が別の画面で更新されました。再読込して内容を確認してください。', scheduleConflict: '予約・シフトが更新されたか、予定が重なっています。再読込して確認してください。', staffInfoMissing: '担当スタッフの写真・紹介文などの登録が不足しています。', staffCourseMismatch: '選んだ担当には、すべてのコースへの対応チェックが必要です。', staffCannotDoCourse: '選んだ担当には、すべてのコースへの対応チェックが必要です。', staffGenderOnly: 'コースで指定された担当スタッフの性別と一致していません。', staffUnavailable: '選んだスタッフは現在受付できません。', testDataNotAllowed: '本番では確認用の予約を登録できません。', courseMismatch: '選んだ担当はこのコースに対応していません。', outsideShift: '担当の勤務時間外です。', soldOut: '選んだ時間・スタッフ・ブースに空きがありません。', locked: '受付停止中です。', staffLocked: '担当スタッフが受付停止中です。', priceChanged: '料金が更新されました。再読込して料金を確認してください。', requestChanged: '同じ送信番号で内容が変わっています。台帳で保存状況を確認してください。', hasTicket: '回数券を使った予約のコース・施術時間・人数・割引は変更できません。', alreadyPaid: '会計済みの予約金額は変更できません。会計の記録を確認してください。', nominatedConfirmationRequired: '指名予約の変更内容を確認してください。', invalidBooth: 'このコース・人数では利用できないブースです。', boothSoldOut: '人数分の利用可能なブースが空いていません。', boothPolicyMissing: 'コースの利用ブース設定が不足しています。', unknownOccupancy: '同じ時間にブースの記録がない予約があります。先に部屋の記録を確認してください。' };
  let current = null;
  function integer(value, label, min, max) { if (String(value).trim() === '' || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(label + 'は ' + min + '〜' + max + ' の整数で入力してください。'); return Number(value); }
  function minute(value) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(value)); if (!m || +m[2] > 59) throw new Error('開始時刻は 10:00、翌 1 時は 25:00 のように入力してください。'); const result = +m[1] * 60 + +m[2]; if (result < 600 || result >= 1620 || result % 5) throw new Error('開始時刻は 10:00〜26:55 の 5 分刻みで入力してください。'); return result; }
  function discount(price, type, value) { if (!['none', 'amount', 'percent'].includes(type)) throw new Error('割引の種類を確認してください。'); const n = integer(value, '割引', 0, type === 'percent' ? 100 : price); if (type === 'none' && n !== 0) throw new Error('割引なしの場合、割引の値は 0 にしてください。'); return type === 'none' ? price : type === 'amount' ? price - n : Math.floor(price * (100 - n) / 100); }
  function serviceDefaults(c) { return { courseId: c.id, expectedPrice: c.price, minutesBefore: c.minutesBefore || 0, minutesBody: c.minutesBody ?? c.minutes, minutesAfter: c.minutesAfter || 0, discountType: 'none', discount: 0 }; }
  function totals(data, body) {
    let duration = 0, base = 0;
    for (const s of body.services) { const sum = s.minutesBefore + s.minutesBody + s.minutesAfter; if (sum < 5) throw new Error('各コースの合計時間は 5 分以上にしてください。'); duration += sum; base += discount(s.expectedPrice, s.discountType, s.discount) * body.people; }
    if (duration > 600) throw new Error('連続コース全体の時間は 600 分以内にしてください。');
    if (body.start + duration > 1620) throw new Error('終了時刻が 27:00 を超えています。');
    const services = (data.booking?.ticket_id || body.ticketId) ? 0 : discount(base, body.bulkDiscountType, body.bulkDiscount);
    const original = data.booking, nominated = (data.staff || []).find(s => s.id === body.nominatedStaffId);
    const nomination = body.nominatedStaffId ? original?.nominatedStaffId ? Number(original.nominationFee || 0) : Number(nominated?.nominationFee || 0) : 0;
    const night = original?.nightFeeExempt ? 0 : body.start >= (data.feeNightStart ?? 1320) ? (data.feeNightPerPerson ?? 2000) * body.people : 0;
    return { duration, end: body.start + duration, base, services, nomination, night, total: services + nomination + night };
  }
  function eligible(data, staff, services, start, duration) {
    if (staff.active !== 1) return '停止中';
    const currentStaff = (data.booking?.staffIds || []).includes(staff.id);
    if (!currentStaff && (staff.info_missing || []).length) return '情報入力待ち';
    if (!currentStaff && staff.locked) return '受付停止';
    if (!Array.isArray(staff.courses)) return '対応チェックを確認できません';
    if (staff.start == null || start < staff.start || start + duration > staff.end) return '勤務時間外';
    for (const service of services) {
      const c = data.courses.find(c => c.id === service.courseId);
      if (!c) return 'コース未登録';
      if (c.gender && c.gender !== 'none' && c.gender !== 'any' && c.gender !== 'all' && c.gender !== staff.gender) return '担当性別が異なる';
      if ((staff.courses || []).length && !staff.courses.includes(service.courseId)) return '対応チェックなし';
    }
    return '';
  }
  function report(app, text, bad = false) { const el = app.root.querySelector('.bd-message'); el.textContent = text; el.hidden = !text; el.classList.toggle('bd-error', bad); el.setAttribute('role', bad ? 'alert' : 'status'); }
  function invalidate(app) { app.dirty = true; app.prepared = null; const confirmation = app.root.querySelector('.bd-confirmation'); confirmation.replaceChildren(); confirmation.hidden = true; }
  function busy(app, value) { app.busy = value; app.root.setAttribute('aria-busy', String(value)); app.root.querySelectorAll('button,input,select,textarea').forEach(el => { if (value) { el.dataset.bdDisabled = el.disabled ? '1' : '0'; el.disabled = true; } else if (el.dataset.bdDisabled != null) { el.disabled = el.dataset.bdDisabled === '1'; delete el.dataset.bdDisabled; } }); if (value) app.root.focus?.({ preventScroll: true }); }
  function close(app, force = false) { if (app.busy) return; if (!force && (app.dirty || app.unknown)) { const box = app.root.querySelector('.bd-close-confirm'); box.hidden = false; box.innerHTML = '<p>' + (app.unknown ? '保存結果が不明です。同じ内容を再送すると重複を防いで結果を確認できます。閉じた場合は、台帳を確認してから新規登録してください。' : '保存していない入力を閉じますか？') + '</p>' + button('入力に戻る', 'close-back') + button('閉じる', 'close-confirm'); return; } app.seq++; app.controller?.abort(); app.root.remove(); document.body.classList.remove('bd-open'); if (current === app) current = null; app.previousFocus?.focus?.(); }
  async function get(app) { const q = new URLSearchParams({ date: app.date }); if (app.id) q.set('id', app.id); else { const form = app.root.querySelector('.bd-form'); if (form) q.set('ticketEmail', form.elements.email?.value.trim() || ''); else if (app.options.ticketId) q.set('ticketId', app.options.ticketId); } const controller = new AbortController(); app.controller = controller; const timer = setTimeout(() => controller.abort(), 15000); try { const r = await fetch('/api/demo/booking-details?' + q, { cache: 'no-store', signal: controller.signal }); const data = await r.json(); if (!r.ok) throw new Error(errors[data.error] || '予約情報を読み込めませんでした。'); if (!Number.isInteger(data.revision) || !Array.isArray(data.courses) || !Array.isArray(data.staff) || (app.id && (!data.booking || !data.bookingFingerprint))) throw new Error('予約情報の一部を確認できません。再読込してください。'); return data; } finally { clearTimeout(timer); } }
  async function load(app) { const seq = ++app.seq; app.controller?.abort(); app.data = null; app.prepared = null; app.pending = null; app.unknown = false; app.root.querySelector('.bd-content').innerHTML = '<p>予約情報を読み込んでいます…</p>'; busy(app, true); try { const data = await get(app); if (current !== app || seq !== app.seq) return; app.data = data; app.dirty = false; render(app); report(app, ''); } catch (e) { if (current !== app || seq !== app.seq) return; app.root.querySelector('.bd-content').innerHTML = '<p>読み込めませんでした。再読込してください。</p>'; report(app, e.name === 'AbortError' ? '読み込みが時間内に完了しませんでした。' : e.message, true); } finally { if (current === app && seq === app.seq) busy(app, false); } }

  function ticketSelect(app, selected) {
    const tickets = app.data.customerTickets || [];
    const options = [['', '使用しない'], ...tickets.map(t => [t.id, t.plan_name + ' ／ 残り' + t.uses_left + '回 ／ 購入 ' + (Number.isFinite(Date.parse(t.purchased_at)) ? new Date(Date.parse(t.purchased_at) + 9 * 3600000).toISOString().slice(0, 10) : '未登録') + (t.status !== '有効' ? '（' + t.status + '）' : ''), t.status !== '有効'])];
    if (selected && !tickets.some(t => t.id === selected)) options.push([selected, '選択した回数券を確認できません', true]);
    return select('使用する回数券', 'ticketId', options, selected);
  }
  function ticketIssue(app, body) {
    const old = app.data.booking;
    if (old?.ticket_id) {
      if ((body.email || '').trim().toLowerCase() !== (old.email || '').trim().toLowerCase()) return errors.ticketOwner;
      if (body.people !== old.people || body.services.length !== old.services.length ||
          body.services.some((s, i) => s.courseId !== old.services[i].courseId ||
            s.minutesBefore + s.minutesBody + s.minutesAfter !== old.services[i].minutesBefore + old.services[i].minutesBody + old.services[i].minutesAfter ||
            s.discountType !== old.services[i].discountType || s.discount !== old.services[i].discount) ||
          body.bulkDiscountType !== old.bulkDiscountType || body.bulkDiscount !== old.bulkDiscount) return errors.hasTicket;
      return '';
    }
    if (!body.ticketId || app.id) return '';
    const t = (app.data.customerTickets || []).find(t => t.id === body.ticketId);
    if (!t) return errors.ticketInvalid;
    if (!body.email || t.owner_email !== body.email.toLowerCase()) return errors.ticketOwner;
    if (Date.now() > t.expires_at) return errors.ticketExpired;
    if (t.uses_left <= 0) return errors.ticketEmpty;
    if (t.status !== '有効') return errors.ticketInvalid;
    if (body.people !== 1 || body.services.length !== 1 || body.bulkDiscountType !== 'none' || body.services.some(s => s.discountType !== 'none' || s.minutesBefore + s.minutesBody + s.minutesAfter !== app.data.courses.find(c => c.id === s.courseId)?.minutes)) return errors.ticketBookingConditions;
    if (t.menu_scope !== 'all' && (!Array.isArray(t.menu_scope) || !t.menu_scope.includes(body.services[0].courseId))) return errors.ticketMenu;
    return '';
  }
  function serviceRow(app, value) {
    const fixed = !!app.data.booking?.ticket_id;
    const options = app.data.courses.map(c => [c.id, c.name + ' ／ ' + yen(c.price)]);
    if (!options.some(o => o[0] === value.courseId)) options.unshift([value.courseId, value.courseId ? '登録時のコース（現在の設定なし）' : 'コースを選択してください']);
    return '<fieldset class="bd-service" data-service-id="' + esc(value.serviceId || '') + '" data-price="' + esc(value.expectedPrice ?? value.price) + '"><legend>コース</legend><div class="bd-service-top">' + select('コース', 'courseId', options, value.courseId, fixed ? 'disabled' : 'required') + (fixed ? '' : button('このコースを外す', 'service-remove')) + '</div><div class="bd-grid bd-timing">' + field('前準備（分）', 'minutesBefore', value.minutesBefore || 0, 'number', 'min="0" max="600" step="5" required' + (fixed ? ' readonly' : '')) + field('施術（分）', 'minutesBody', value.minutesBody ?? 0, 'number', 'min="0" max="600" step="5" required' + (fixed ? ' readonly' : '')) + field('片付け（分）', 'minutesAfter', value.minutesAfter || 0, 'number', 'min="0" max="600" step="5" required' + (fixed ? ' readonly' : '')) + '</div><div class="bd-grid">' + select('個別割引', 'discountType', [['none', 'なし'], ['amount', '金額（円）'], ['percent', '割合（％）']], value.discountType || 'none', fixed ? 'disabled' : '') + field('個別割引の値', 'discount', value.discount || 0, 'number', 'min="0" step="1" required' + (fixed ? ' disabled' : '')) + '</div><p class="bd-row-total"></p></fieldset>';
  }
  function render(app) {
    const b = app.data.booking, selected = (app.data.customerTickets || []).find(t => t.id === app.options.ticketId), customer = app.data.ticketCustomer;
    const c = app.data.courses.find(c => selected && (selected.menu_scope === 'all' || selected.menu_scope.includes(c.id))) || app.data.courses[0];
    if (b?.status && b.status !== 'confirmed') { app.root.querySelector('.bd-content').innerHTML = '<p class="bd-warning">取り消された予約は編集できません。台帳で現在の予約をご確認ください。</p>'; return; }
    if (!c && !b?.services?.length) { app.root.querySelector('.bd-content').innerHTML = '<p>予約できるコースが登録されていません。</p>'; return; }
    const rows = b?.services?.length ? b.services : b ? [{ courseId: '', expectedPrice: 0, minutesBefore: 0, minutesBody: 0, minutesAfter: 0, discountType: 'none', discount: 0 }] : [serviceDefaults(c)];
    app.root.querySelector('.bd-content').innerHTML = '<form class="bd-form"><p class="bd-note">' + esc(app.date) + ' の' + (b ? '予約を編集します。予約番号：' + esc(b.reference || b.id) : '新規予約です。') + '</p>' + (b && !b.services?.length ? '<p class="bd-warning">元のコース「' + esc(b.unknownMenu || '不明') + '」は現在のメニュー設定と一致していません。内容を確認し、コース・時間を明示して選択してください。</p>' : '') + (b?.ticket_id ? '<p class="bd-warning">回数券利用中：コース・施術時間・人数・割引・所有者を保持します。開始時刻・担当・コメントは変更できます。</p>' : '') + (b?.paid_at || b?.paid_amount > 0 ? '<p class="bd-warning">会計済みです。会計金額が変わる変更は保存できません。</p>' : '') + '<div class="bd-grid">' + field('お客様名', 'name', b?.name || customer?.name || '', 'text', 'required maxlength="120" autocomplete="name"') + field('開始時刻', 'start', hm(b?.start ?? app.options.start ?? 600), 'text', 'required inputmode="numeric" pattern="[0-2]?[0-9]:[0-5][0-9]"') + field('メールアドレス（任意）', 'email', b?.email || customer?.email || '', 'email', 'maxlength="254" autocomplete="email"' + (b?.ticket_id ? ' readonly' : '')) + field('電話番号（任意）', 'phone', b?.phone || customer?.phone || '', 'tel', 'maxlength="40" autocomplete="tel"') + select('人数', 'people', [1, 2, 3, 4, 5].map(n => [n, n + ' 名']), b?.people || 1, b?.ticket_id ? 'disabled' : '') + '</div>' + (!b ? '<div class="bd-ticket-tools">' + button('お客様の回数券を確認', 'tickets-load') + '<span>メールアドレスで保有券を確認</span></div><div class="bd-tickets">' + ticketSelect(app, app.options.ticketId || '') + '</div><p class="bd-ticket-note bd-note"></p>' : '') + '<h3>コース・時間・割引</h3><p class="bd-note">上から順に、全員が同じコースを連続して受けます。準備・施術・片付けの合計が予約時間です。個別割引は 1 名分に適用してから人数倍し、一括割引を適用します。深夜料金・指名料は割引に含みません。</p><div class="bd-services">' + rows.map(s => serviceRow(app, s)).join('') + '</div>' + (b?.ticket_id ? '' : '<div class="bd-actions">' + button('連続するコースを追加', 'service-add') + '</div>') + '<div class="bd-grid">' + select('一括割引', 'bulkDiscountType', [['none', 'なし'], ['amount', '金額（円）'], ['percent', '割合（％）']], b?.bulkDiscountType || 'none', b?.ticket_id ? 'disabled' : '') + field('一括割引の値', 'bulkDiscount', b?.bulkDiscount || 0, 'number', 'min="0" step="1" required' + (b?.ticket_id ? ' disabled' : '')) + '</div><h3>担当スタッフ</h3><p class="bd-note">人数分の異なるスタッフを選択してください。対応チェック・勤務・受付停止を確認します。予約の重複やブースの空きは保存時にも確認します。</p><div class="bd-staff bd-grid"></div><div class="bd-nomination"></div><div class="bd-grid">' + area('こだわり', 'preferences', b?.preferences) + area('予約タグ', 'tags', b?.tags) + area('施術コメント', 'comment', b?.comment) + '</div>' + (!b ? '<label class="bd-check"><input type="checkbox" name="consent" required>お客様の予約内容と連絡先の登録について了承を確認しました</label>' : '') + '<div class="bd-summary" aria-live="polite"></div><div class="bd-actions"><button type="submit" class="bd-primary">内容を確認</button></div></form><section class="bd-confirmation" hidden></section>';
    app.initialStaff = b?.staffIds || [app.options.staffId || ''];
    update(app, true);
  }
  function values(app, validate = true) {
    const f = app.root.querySelector('.bd-form'), value = name => f.elements[name]?.value?.trim() || '';
    const people = integer(value('people'), '人数', 1, 5), start = minute(value('start'));
    const services = [...f.querySelectorAll('.bd-service')].map(row => {
      const v = name => row.querySelector('[name="' + name + '"]').value;
      const result = { ...(row.dataset.serviceId ? { serviceId: row.dataset.serviceId } : {}), courseId: v('courseId'), expectedPrice: integer(row.dataset.price, 'コース料金', 0, 100000000), discountType: v('discountType'), discount: integer(v('discount'), '個別割引', 0, 100000000) };
      for (const name of ['minutesBefore', 'minutesBody', 'minutesAfter']) { result[name] = integer(v(name), 'コース時間', 0, 600); if (result[name] % 5) throw new Error('各コースの時間は 5 分刻みで入力してください。'); }
      return result;
    });
    if (!services.length) throw new Error('コースを 1 つ以上選択してください。');
    const staffIds = [...f.querySelectorAll('[name=staffId]')].map(el => el.value), nominatedStaffId = value('nominatedStaffId');
    const body = { ...(!app.id ? { ticketId: value('ticketId') } : {}), action: app.id ? 'update' : 'create', date: app.date, revision: app.data.revision, ...(app.id ? { id: app.id, bookingFingerprint: app.data.bookingFingerprint } : {}), start, people, staffIds, services, bulkDiscountType: value('bulkDiscountType'), bulkDiscount: integer(value('bulkDiscount'), '一括割引', 0, 100000000), nominatedStaffId, name: value('name'), email: value('email'), phone: value('phone'), preferences: value('preferences'), tags: value('tags'), comment: value('comment'), consent: app.id ? true : !!f.elements.consent?.checked };
    const result = totals(app.data, body);
    if (nominatedStaffId) body.expectedNominationFee = result.nomination;
    if (validate) {
      const issue = ticketIssue(app, body); if (issue) throw new Error(issue);
      if (!body.name) throw new Error('お客様名を入力してください。');
      if (!body.consent) throw new Error('お客様の了承を確認してください。');
      if (staffIds.length !== people || staffIds.some(id => !id) || new Set(staffIds).size !== staffIds.length) throw new Error('人数分の異なる担当スタッフを選んでください。');
      for (const id of staffIds) { const s = app.data.staff.find(s => s.id === id), reason = s ? eligible(app.data, s, services, start, result.duration) : 'スタッフ未登録'; if (reason) throw new Error((s?.name || id) + '：' + reason + 'のため担当できません。'); }
      if (nominatedStaffId && !staffIds.includes(nominatedStaffId)) throw new Error('指名スタッフを担当に含めてください。');
    }
    return { body, result };
  }
  function update(app, initial = false) {
    if (!app.data) return;
    try {
      const f = app.root.querySelector('.bd-form'); if (!f) return;
      const { body, result } = values(app, false);
      const ticketNote = f.querySelector('.bd-ticket-note'); if (ticketNote) { ticketNote.textContent = ticketIssue(app, body) || (body.ticketId ? '1回分を使用。指名料・深夜料金は別途です。' : ''); }
      const previous = initial ? app.initialStaff : [...f.querySelectorAll('[name=staffId]')].map(el => el.value);
      const beforeNomination = initial ? app.data.booking?.nominatedStaffId || '' : f.elements.nominatedStaffId?.value || '';
      const options = [['', '選択してください'], ...app.data.staff.map(s => { const reason = eligible(app.data, s, body.services, body.start, result.duration); return [s.id, s.name + (reason ? '（' + reason + '）' : ' ' + hm(s.start) + '〜' + hm(s.end)), !!reason]; })];
      f.querySelector('.bd-staff').innerHTML = Array.from({ length: body.people }, (_, i) => select('担当スタッフ ' + (i + 1), 'staffId', options, previous[i] || '', 'required')).join('');
      const choices = [['', '指名なし'], ...previous.slice(0, body.people).filter(id => id && previous.indexOf(id) === previous.lastIndexOf(id)).map(id => app.data.staff.find(s => s.id === id)).filter(Boolean).map(s => [s.id, s.name + '（' + yen(app.data.booking?.nominatedStaffId ? app.data.booking.nominationFee : s.nominationFee) + '）', s.personalNomination === false && s.id !== app.data.booking?.nominatedStaffId])];
      if (beforeNomination && !choices.some(choice => choice[0] === beforeNomination)) choices.push([beforeNomination, (app.data.staff.find(s => s.id === beforeNomination)?.name || beforeNomination) + '（担当に含まれていません）', true]);
      f.querySelector('.bd-nomination').innerHTML = select('スタッフ指名', 'nominatedStaffId', choices, beforeNomination);
      const final = totals(app.data, { ...body, nominatedStaffId: f.elements.nominatedStaffId.value });
      f.querySelector('.bd-summary').innerHTML = '<b>終了予定 ' + hm(final.end) + '（合計 ' + final.duration + ' 分）</b><span>施術 ' + yen(final.services) + ' ＋ 深夜 ' + yen(final.night) + ' ＋ 指名 ' + yen(final.nomination) + '</span><strong>合計 ' + yen(final.total) + '</strong>';
      [...f.querySelectorAll('.bd-service')].forEach((row, i) => { const s = body.services[i]; row.querySelector('.bd-row-total').textContent = '登録単価 ' + yen(s.expectedPrice) + ' ／ 割引後 1 名 ' + yen(discount(s.expectedPrice, s.discountType, s.discount)); });
    } catch (e) { const summary = app.root.querySelector('.bd-summary'); if (summary) summary.textContent = e.message; }
  }
  async function review(app) {
    if (app.busy || !app.data || app.unknown) return;
    const f = app.root.querySelector('.bd-form'); if (!f.reportValidity()) return;
    const value = values(app);
    app.prepared = null; app.root.querySelector('.bd-confirmation').replaceChildren(); app.root.querySelector('.bd-confirmation').hidden = true;
    busy(app, true); report(app, '現在の予約・シフトを確認しています…');
    try {
      const fresh = await get(app);
      if (current !== app) return;
      if (fresh.revision !== app.data.revision || fresh.bookingFingerprint !== app.data.bookingFingerprint || JSON.stringify(fresh.staff) !== JSON.stringify(app.data.staff) || JSON.stringify(fresh.courses) !== JSON.stringify(app.data.courses)) throw new Error('予約またはシフトが更新されています。再読込して、現在の内容から編集し直してください。');
      const ticketError = ticketIssue({ ...app, data: fresh }, value.body); if (ticketError) throw new Error(ticketError);
      app.data.customerTickets = fresh.customerTickets;
      app.prepared = value; app.pending = null;
      const b = app.data.booking, names = ids => ids.map(id => app.data.staff.find(s => s.id === id)?.name || id).join('、');
      const required = !!b?.nominatedStaffId || !!value.body.nominatedStaffId;
      app.root.querySelector('.bd-confirmation').innerHTML = '<h3>予約内容の確認</h3><p><b>' + esc(value.body.name) + '</b> 様 ／ ' + value.body.people + ' 名</p>' + (b ? '<p>変更前：' + hm(b.start) + ' ／ ' + esc(names(b.staffIds)) + ' ／ ' + yen(b.total) + '</p>' : '') + '<p>' + (b ? '変更後' : '予約日時') + '：' + esc(app.date) + ' ' + hm(value.body.start) + '〜' + hm(value.result.end) + '</p><p>担当：' + esc(names(value.body.staffIds)) + '</p><ol>' + value.body.services.map(s => '<li>' + esc(app.data.courses.find(c => c.id === s.courseId)?.name || '登録時のコース') + '（準備 ' + s.minutesBefore + ' 分・施術 ' + s.minutesBody + ' 分・片付け ' + s.minutesAfter + ' 分）</li>').join('') + '</ol>' + (value.body.ticketId ? '<p>回数券：' + esc(app.data.customerTickets.find(t => t.id === value.body.ticketId)?.plan_name) + ' ／ 1回使用（予約後 残り' + (app.data.customerTickets.find(t => t.id === value.body.ticketId).uses_left - 1) + '回）</p>' : '') + '<p><strong>合計 ' + yen(value.result.total) + '</strong></p>' + (required ? '<p class="bd-warning">指名予約です。日時・担当・コースの変更を必ず確認してください。</p><label class="bd-check"><input type="checkbox" name="nominationConfirmed">指名の変更前後と、お客様へのご案内を確認しました</label>' : '') + '<div class="bd-actions">' + button(b ? '変更を保存' : '予約を確定', 'save', 'class="bd-primary"') + button('入力に戻る', 'review-back') + '</div>';
      app.root.querySelector('.bd-confirmation').hidden = false; app.root.querySelector('.bd-confirmation').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); report(app, '内容を確認してから確定してください。');
    } catch (e) { report(app, e.message, true); } finally { if (current === app) busy(app, false); }
  }
  function unknownControls(app, value) {
    app.root.querySelectorAll('.bd-form input,.bd-form select,.bd-form textarea,.bd-form button,[data-bd=review-back],[data-bd=reload]').forEach(el => {
      if (value) { if (el.dataset.bdUnknownDisabled == null) el.dataset.bdUnknownDisabled = el.disabled ? '1' : '0'; el.disabled = true; }
      else if (el.dataset.bdUnknownDisabled != null) { el.disabled = el.dataset.bdUnknownDisabled === '1'; delete el.dataset.bdUnknownDisabled; }
    });
  }
  async function save(app) {
    if (app.busy || !app.prepared || !app.data) return;
    const nominated = !!app.data.booking?.nominatedStaffId || !!app.prepared.body.nominatedStaffId;
    if (nominated && !app.root.querySelector('[name=nominationConfirmed]')?.checked) { report(app, '指名予約の変更内容を確認し、確認欄にチェックを入れてください。', true); return; }
    const body = { ...app.prepared.body, confirmNominationMove: nominated };
    const signature = JSON.stringify(body);
    if (app.pending?.signature !== signature) app.pending = { signature, requestKey: key() };
    body.requestKey = app.pending.requestKey;
    app.dirty = true; busy(app, true); report(app, '保存しています…');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/demo/booking-details', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) { const e = new Error(errors[data.error] || '保存できませんでした（' + (data.error || response.status) + '）。'); e.rejected = response.status >= 400 && response.status < 500 && response.status !== 408; throw e; }
      if (!data.ok) throw new Error('保存結果を確認できませんでした。');
      app.dirty = false; app.unknown = false; app.pending = null; app.prepared = null;
      app.root.querySelector('.bd-content').innerHTML = '<section class="bd-success"><h3>予約を保存しました</h3><p>予約番号：' + esc(data.reference || data.id || '') + '</p>' + button('台帳へ戻る', 'done', 'class="bd-primary"') + '</section>';
      window.__pmSchedAt = 0; window.__pmKickSync?.(); try { app.options.onSaved?.(); } catch (_) {} report(app, '');
    } catch (e) {
      app.unknown = !e.rejected;
      report(app, e.rejected ? e.message : '通信が途切れ、保存結果が不明です。入力は変更せず「同じ内容を再送」を押してください。同じ送信番号で二重登録を防ぎます。', true);
      if (app.unknown) { const el = app.root.querySelector('[data-bd=save]'); if (el) el.textContent = '同じ内容を再送'; }
    } finally { clearTimeout(timer); busy(app, false); unknownControls(app, !!app.unknown); }
  }
  async function action(app, name, target) {
    if (name === 'close' || name === 'done') { close(app); return; }
    if (app.busy) return;
    if (name === 'close-back') { app.root.querySelector('.bd-close-confirm').hidden = true; return; }
    if (name === 'close-confirm') { close(app, true); return; }
    if (name === 'reload') { if (app.dirty) { const box = app.root.querySelector('.bd-close-confirm'); box.hidden = false; box.innerHTML = '<p>入力を取り消し、最新の予約情報を読み込みますか？</p>' + button('入力に戻る', 'close-back') + button('再読込する', 'reload-confirm'); } else await load(app); return; }
    if (name === 'reload-confirm') { app.root.querySelector('.bd-close-confirm').hidden = true; await load(app); return; }
    if (!app.data || app.unknown && name !== 'save') return;
    if (name === 'tickets-load' && !app.id) {
      const form = app.root.querySelector('.bd-form'), email = form.elements.email;
      if (!email.value.trim() || !email.reportValidity()) { report(app, 'お客様のメールアドレスを入力してください。', true); return; }
      const selected = form.elements.ticketId?.value || ''; busy(app, true);
      try { const data = await get(app); if (current !== app) return; app.data.customerTickets = data.customerTickets; form.querySelector('.bd-tickets').innerHTML = ticketSelect(app, selected); invalidate(app); update(app); report(app, data.customerTickets.length ? '回数券を選択してください。' : 'このメールアドレスの回数券はありません。'); }
      catch (e) { report(app, e.message, true); } finally { if (current === app) busy(app, false); } return;
    }
    if (name === 'review-back') { invalidate(app); app.root.querySelector('.bd-form').scrollIntoView({ block: 'start' }); return; }
    if (name === 'save') { await save(app); return; }
    if (name === 'service-add' && !app.data.booking?.ticket_id) { if (app.root.querySelectorAll('.bd-service').length >= 10) { report(app, '連続コースは 10 件までです。', true); return; } const rows = app.root.querySelector('.bd-services'); rows.insertAdjacentHTML('beforeend', serviceRow(app, serviceDefaults(app.data.courses[0]))); }
    if (name === 'service-remove' && !app.data.booking?.ticket_id) { if (app.root.querySelectorAll('.bd-service').length <= 1) { report(app, 'コースは 1 つ以上必要です。', true); return; } target.closest('.bd-service')?.remove(); }
    invalidate(app); update(app);
  }
  window.__pmOpenBookingEditor = function (options = {}) {
    if (current) { current.root.focus(); report(current, '開いている予約の編集を完了するか閉じてください。'); return; }
    const date = options.date || document.querySelector('.ledger-date-trigger time')?.getAttribute('datetime');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
    const root = document.createElement('div'); root.className = 'bd-overlay'; root.tabIndex = -1;
    root.innerHTML = '<section class="bd-dialog" role="dialog" aria-modal="true" aria-labelledby="bd-title"><header><h2 id="bd-title">' + (options.bookingId ? '予約内容の編集' : '新規予約の受付') + '</h2>' + button('閉じる ×', 'close', 'aria-label="予約編集を閉じる"') + '</header><div class="bd-toolbar">' + button('再読込', 'reload') + '<span>入力中の内容は自動保存されません</span></div><div class="bd-message" hidden></div><div class="bd-close-confirm" hidden></div><div class="bd-content"></div></section>';
    const app = { root, options, date, id: options.bookingId || '', data: null, seq: 0, busy: false, dirty: false, previousFocus: document.activeElement }; current = app;
    root.addEventListener('click', event => { const target = event.target.closest('[data-bd]'); if (target) { event.preventDefault(); action(app, target.dataset.bd, target).catch(e => report(app, e.message, true)); } });
    root.addEventListener('submit', event => { event.preventDefault(); review(app).catch(e => report(app, e.message, true)); });
    root.addEventListener('input', event => { if (app.busy || app.unknown || event.target.name === 'nominationConfirmed') return; invalidate(app); if (!['SELECT', 'TEXTAREA'].includes(event.target.tagName) && !['name', 'email', 'phone', 'consent'].includes(event.target.name)) update(app); });
    root.addEventListener('change', event => { if (app.busy || app.unknown || event.target.name === 'nominationConfirmed') return; if (event.target.name === 'courseId') { const c = app.data.courses.find(c => c.id === event.target.value); if (c) { const row = event.target.closest('.bd-service'), value = serviceDefaults(c); const original = app.data.booking?.services?.find(s => s.serviceId && s.serviceId === row.dataset.serviceId); row.dataset.price = original?.courseId === c.id ? original.expectedPrice : value.expectedPrice; for (const n of ['minutesBefore', 'minutesBody', 'minutesAfter', 'discount', 'discountType']) row.querySelector('[name=' + n + ']').value = value[n]; } } invalidate(app); update(app); });
    root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(app); } if (event.key === 'Tab') { const els = [...root.querySelectorAll('button,input,select,textarea,[tabindex]')].filter(el => !el.disabled && el.offsetParent !== null); const first = els[0], last = els[els.length - 1]; if (!els.length) { event.preventDefault(); root.focus(); return; } if (document.activeElement === root) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return; } if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } });
    document.body.appendChild(root); document.body.classList.add('bd-open'); root.focus(); load(app);
  };
})();
