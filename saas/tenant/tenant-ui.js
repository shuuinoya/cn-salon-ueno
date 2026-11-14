(() => {
  const store = window.__TENANT__;
  if (!store) return;
  let bookingAllowed = true;
  if (!location.pathname.startsWith('/admin') && !location.pathname.startsWith('/cnsalon-board')) {
    fetch('/api/service-status').then(r => r.ok ? r.json() : null).then(s => { if (s) { bookingAllowed = s.bookingAllowed; update(); } }).catch(() => {});
  }
  function update() {
    if (!bookingAllowed && document.body && !document.querySelector('.tenant-paused')) {
      const p = document.createElement('p'); p.className = 'tenant-paused info-card'; p.setAttribute('role','status');
      (document.querySelector('main') || document.body).prepend(p);
    }
    const paused = document.querySelector('.tenant-paused');
    if (paused) {
      const label = window.CNI18N?.t('現在、新しい予約の受付を停止しています。') || '現在、新しい予約の受付を停止しています。';
      if (paused.textContent !== label) paused.textContent = label;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) if (!['SCRIPT','STYLE','TEXTAREA'].includes(n.parentElement?.tagName) && n.nodeValue.includes('TENANT_NAME')) n.nodeValue = n.nodeValue.split('TENANT_NAME').join(store.name);
    if (document.title.includes('TENANT_NAME')) document.title = document.title.split('TENANT_NAME').join(store.name);
    for (const el of document.querySelectorAll('[title],[alt]')) for (const key of ['title','alt']) {
      const value = el.getAttribute(key); if (value?.includes('TENANT_NAME')) el.setAttribute(key,value.split('TENANT_NAME').join(store.name));
    }
    const map = document.querySelector('.map-panel iframe');
    if (map) {
      const source = store.address ? 'https://www.google.com/maps?q=' + encodeURIComponent(store.address) + '&output=embed' : 'about:blank';
      if (map.getAttribute('src') !== source) map.setAttribute('src',source);
      map.hidden = !store.address;
      if (!store.address && !map.parentElement.querySelector('.tenant-map-empty')) {
        const p = document.createElement('p'); p.className = 'tenant-map-empty'; map.parentElement.appendChild(p);
      }
    }
    const mapEmpty = document.querySelector('.tenant-map-empty');
    if (mapEmpty) {
      const label = window.CNI18N?.t('住所を登録すると地図を表示します。') || '住所を登録すると地図を表示します。';
      if (mapEmpty.textContent !== label) mapEmpty.textContent = label;
    }
    for (const img of document.querySelectorAll('img[src^="/images/"],img[src^="/thumbs/"]')) img.src = '/tenant-placeholder.svg';
    for (const a of document.querySelectorAll('a[href="tel:"]')) { if (store.phone) a.href = 'tel:' + store.phone; if (a.textContent !== (store.phone || '—')) a.textContent = store.phone || '—'; }
    const stack = document.querySelector('.list-stack');
    if (stack && !store.courses.length && !stack.querySelector('.tenant-empty')) {
      const p = document.createElement('p'); p.className = 'tenant-empty'; p.textContent = window.CNI18N?.t('メニューはまだ登録されていません。') || 'メニューはまだ登録されていません。'; stack.appendChild(p);
    }
    const empty = document.querySelector('.tenant-empty'), label = window.CNI18N?.t('メニューはまだ登録されていません。');
    if (empty && label && empty.textContent !== label) empty.textContent = label;
  }
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; update(); }); } }).observe(document.documentElement, { childList:true, subtree:true, characterData:true });
  update();
  window.CNI18N?.onChange(() => { document.querySelector('.tenant-empty')?.remove(); update(); });
})();
