/* 小窓の共通ルール：中央・画面内・背景固定・外側からは既存のキャンセル処理へ。 */
(function () {
  'use strict';
  if (window.CNPopup) return;
  const overlays = [
    ['#pm-ticket-modal', '#pm-tk-close-top'], ['.bd-overlay', '[data-bd="close"]'], ['#pm-ledger-operations', '[data-lo="close"]'],
    ['#pm-customer-records', '[data-close]'], ['#cn-login-ov', '.cn-cancel'],
    ['#fm-doc-modal', '.fm-doc-close'], ['#pm-shiftadd', '[data-sa="close"]'],
    ['.ledger-modal-backdrop', null]
  ];
  const selector = ['dialog[open]', ...overlays.map(([s]) => s)].join(',');
  const root = document.documentElement;
  let active = [], saved = null, down = null;
  function viewport() {
    const v = window.visualViewport, width = v?.width || innerWidth, height = v?.height || innerHeight;
    for (const [key, value] of Object.entries({ x:(v?.offsetLeft || 0)+width/2, y:(v?.offsetTop || 0)+height/2, width, height })) {
      root.style.setProperty('--cn-popup-' + key, value + 'px');
    }
  }
  function sync() {
    const next = [...document.querySelectorAll(selector)].filter(el => !el.hidden && el.getClientRects().length);
    // 開いた順を保持。親の上に出す「変更を破棄しますか？」を最優先にする。
    active = active.filter(el => next.includes(el));
    for (const el of next) if (!active.includes(el)) {
      active.push(el); el.setAttribute('data-cn-popup', el.tagName === 'DIALOG' ? 'dialog' : 'overlay');
    }
    if (active.length && !saved) {
      saved = { x:scrollX, y:scrollY };
      root.style.setProperty('--cn-popup-scroll-x', -saved.x + 'px');
      root.style.setProperty('--cn-popup-scroll-y', -saved.y + 'px');
      root.style.setProperty('--cn-popup-gutter', Math.max(0, innerWidth-root.clientWidth) + 'px');
      root.classList.add('cn-popup-open'); viewport();
    } else if (!active.length && saved) {
      const position = saved; saved = null; down = null;
      root.classList.remove('cn-popup-open');
      // CSS の smooth があっても、元の位置へ瞬時に戻す。
      const old = root.style.scrollBehavior; root.style.scrollBehavior = 'auto';
      window.scrollTo(position.x, position.y); root.style.scrollBehavior = old;
    }
  }
  const top = () => active.filter(el => el.isConnected && (el.tagName !== 'DIALOG' || el.open)).at(-1);
  function outside(el, event) {
    if (el.tagName !== 'DIALOG') return event.target === el;
    if (event.target !== el) return false;
    const r = el.getBoundingClientRect();
    return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
  }
  function cancel(el) {
    if (el.tagName === 'DIALOG') {
      // dirty / busy の既存 cancel ハンドラーを必ず通す。直接閉じて入力を捨てない。
      if (typeof el.requestClose === 'function') el.requestClose();
      else if (el.dispatchEvent(new Event('cancel', { cancelable:true }))) el.close();
    } else {
      const match = overlays.find(([s]) => el.matches(s));
      const button = match?.[1] ? el.querySelector(match[1]) : [...el.querySelectorAll('button')].find(b => /^(閉じる|キャンセル)$/.test(b.textContent.trim()));
      if (button && !button.disabled) button.click();
    }
  }
  document.addEventListener('pointerdown', event => {
    const el = top(); down = el && event.isPrimary !== false && event.button === 0 && outside(el,event)
      ? { el, x:event.clientX, y:event.clientY } : null;
  }, true);
  document.addEventListener('pointercancel', () => { down = null; }, true);
  document.addEventListener('click', event => {
    const el = top(); if (!el || !outside(el,event)) { down = null; return; }
    // 枠の中から外へドラッグした操作は、外側のタップとして扱わない。
    event.preventDefault(); event.stopImmediatePropagation();
    const start = down; down = null;
    if (start?.el === el && Math.hypot(event.clientX-start.x,event.clientY-start.y) < 8) cancel(el);
  }, true);
  function stopBackground(event) {
    const el = top(); if (el && (event.target === el || !el.contains(event.target))) event.preventDefault();
  }
  document.addEventListener('wheel', stopBackground, { capture:true, passive:false });
  document.addEventListener('touchmove', stopBackground, { capture:true, passive:false });
  // 画面ごとの描き直し・閉じる・削除にも対応。style/class 自体は監視せず循環を避ける。
  new MutationObserver(sync).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['open','hidden'] });
  window.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('scroll', viewport);
  viewport(); sync(); window.CNPopup = { sync };
})();
