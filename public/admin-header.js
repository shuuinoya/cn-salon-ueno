/* 独立した管理ページの共通メニュー。台帳本体の操作は既存の処理を使用する。 */
(() => {
  'use strict';
  const header = document.querySelector('[data-static-admin-header]');
  if (!header) return;
  const brand = header.querySelector('.ledger-brand');
  let userMenu = null;
  function closeMenus(except) {
    header.querySelectorAll('details[open]').forEach(el => { if (el !== except) el.open = false; });
    if (userMenu && except !== userMenu) { userMenu.remove(); userMenu = null; brand.setAttribute('aria-expanded', 'false'); }
  }
  header.addEventListener('toggle', e => {
    if (e.target.tagName !== 'DETAILS' || !e.target.open) return;
    closeMenus(e.target);
    const menu = e.target.querySelector(':scope > div');
    menu.style.left = ''; menu.style.right = '';
    const r = menu.getBoundingClientRect(), w = document.documentElement.clientWidth;
    if (r.right > w - 8) { menu.style.left = (parseFloat(getComputedStyle(menu).left) || 0) - (r.right - w + 8) + 'px'; menu.style.right = 'auto'; }
    const left = menu.getBoundingClientRect().left;
    if (left < 8) { menu.style.left = (parseFloat(getComputedStyle(menu).left) || 0) + 8 - left + 'px'; menu.style.right = 'auto'; }
  }, true);
  brand.addEventListener('click', () => {
    if (userMenu) { closeMenus(); return; }
    closeMenus();
    userMenu = document.createElement('div'); userMenu.className = 'pm-static-user-menu';
    const logout = document.createElement('button'); logout.type = 'button'; logout.textContent = 'ログアウト';
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      try {
        const res = await fetch('/api/demo/logout', { method: 'POST', signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error();
        location.href = '/admin/login?out=1';
      } catch { logout.disabled = false; logout.textContent = '再度ログアウト'; }
    });
    userMenu.append(logout); document.body.append(userMenu);
    const r = brand.getBoundingClientRect();
    userMenu.style.top = r.bottom + 6 + 'px'; userMenu.style.right = Math.max(8, innerWidth - r.right) + 'px';
    brand.setAttribute('aria-expanded', 'true'); logout.focus({ preventScroll: true });
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-static-admin-header] .ledger-nav-menu, [data-static-admin-header] .ledger-brand, .pm-static-user-menu')) closeMenus();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
  window.addEventListener('resize', () => closeMenus());
})();
