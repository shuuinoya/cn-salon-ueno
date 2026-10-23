/* 勤務日の選択。日付の確定だけ既存の change に渡し、シフト・予約の判定は変更しない。 */
(function () {
  'use strict';
  const day = value => new Date(value + 'T12:00:00Z');
  const iso = date => date.toISOString().slice(0, 10);
  const add = (value, n) => { const d = day(value); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const month = (value, n) => { const d = day(value.slice(0, 7) + '-01'); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };
  function mount(input) {
    const i18n = window.CNI18N, t = key => i18n?.t(key) || key;
    const locale = () => i18n?.LOCALE[i18n.lang()] || 'ja-JP';
    const format = (value, opts) => new Intl.DateTimeFormat(locale(), { ...opts, timeZone: 'UTC', calendar: 'gregory' }).format(day(value));
    const clamp = v => v < input.min ? input.min : v > input.max ? input.max : v;
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'st-calendar-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'st-calendar');
    input.insertAdjacentElement('afterend', trigger);
    input.hidden = true;
    const dialog = document.createElement('dialog');
    dialog.id = 'st-calendar'; dialog.setAttribute('aria-labelledby', 'st-calendar-title');
    dialog.innerHTML = '<div class="st-calendar-head"><span id="st-calendar-title"></span><button type="button" data-action="close">×</button></div><div class="st-calendar-month"><button type="button" data-action="prev">‹</button><strong id="st-calendar-month" aria-live="polite"></strong><button type="button" data-action="next">›</button></div><table aria-labelledby="st-calendar-month"><thead></thead><tbody></tbody></table><div class="st-calendar-foot"><button type="button" data-action="today"></button></div>';
    document.body.appendChild(dialog);
    let shown = input.value.slice(0,7) + '-01', focused = input.value, signature = '';
    const action = name => dialog.querySelector('[data-action="' + name + '"]');
    function place() {
      const r = trigger.getBoundingClientRect(), w = dialog.offsetWidth, h = dialog.offsetHeight, width = document.documentElement.clientWidth;
      dialog.style.left = (width <= 600 ? Math.max(12, (width-w)/2) : Math.max(12, Math.min(r.left, width-w-12))) + 'px';
      dialog.style.top = Math.max(12, Math.min(r.bottom+8, innerHeight-h-12)) + 'px';
    }
    function draw(focus) {
      focused = clamp(focused); shown = clamp(shown).slice(0,7) + '-01';
      dialog.querySelector('#st-calendar-title').textContent = t('勤務日を選択');
      dialog.querySelector('#st-calendar-month').textContent = format(shown, {year:'numeric', month:'long'});
      action('prev').setAttribute('aria-label', t('前の月')); action('next').setAttribute('aria-label', t('次の月'));
      action('close').setAttribute('aria-label', t('閉じる')); action('today').textContent = t('今日');
      action('prev').disabled = month(shown, -1).slice(0,7) < input.min.slice(0,7);
      action('next').disabled = month(shown, 1).slice(0,7) > input.max.slice(0,7);
      const head = document.createElement('tr');
      for(let n=0;n<7;n++){ const th=document.createElement('th'); th.scope='col'; th.textContent=format(add('2026-10-18',n),{weekday:'short'});head.appendChild(th); }
      dialog.querySelector('thead').replaceChildren(head);
      const body = dialog.querySelector('tbody'); body.replaceChildren();
      const start=add(shown,-day(shown).getUTCDay()), end=month(shown,1); let row;
      for(let n=0;n<42;n++){
        const value=add(start,n); if(n%7===0){if(n>27&&value>=end)break;row=document.createElement('tr');body.appendChild(row);}
        const td=document.createElement('td'); row.appendChild(td);
        if(value.slice(0,7)!==shown.slice(0,7)) continue;
        const b=document.createElement('button'); b.type='button'; b.dataset.date=value; b.textContent=String(day(value).getUTCDate());
        b.disabled=value<input.min||value>input.max; b.tabIndex=value===focused?0:-1;
        b.setAttribute('aria-label',format(value,{year:'numeric',month:'long',day:'numeric',weekday:'long'}));
        b.setAttribute('aria-pressed',String(value===input.value)); if(value===input.min)b.setAttribute('aria-current','date');
        td.appendChild(b);
      }
      if(dialog.open){place();if(focus)dialog.querySelector('[data-date="'+focused+'"]')?.focus();}
    }
    function refresh() {
      trigger.textContent = format(input.value,{year:'numeric',month:'2-digit',day:'2-digit'}) + '  ▾';
      trigger.setAttribute('aria-label', t('勤務日を選択') + ': ' + format(input.value,{year:'numeric',month:'long',day:'numeric'}));
      const next=[input.value,input.min,input.max,locale()].join('|');
      if(next!==signature){signature=next; if(dialog.open)draw(document.activeElement?.hasAttribute('data-date'));}
    }
    function choose(value) {
      if(value<input.min||value>input.max)return;
      input.value=value; input.dispatchEvent(new Event('change',{bubbles:true})); refresh();dialog.close();
    }
    trigger.addEventListener('click',()=>{focused=clamp(input.value);shown=focused.slice(0,7)+'-01';draw(false);dialog.showModal();trigger.setAttribute('aria-expanded','true');draw(true);});
    dialog.addEventListener('close',()=>{trigger.setAttribute('aria-expanded','false');trigger.focus();});
    dialog.addEventListener('click',event=>{
      const b=event.target.closest('button');
      if(b?.dataset.date){choose(b.dataset.date);return;}
      const a=b?.dataset.action;
      if(a==='close')dialog.close();
      if(a==='today')choose(input.min);
      if(a==='prev'||a==='next'){shown=month(shown,a==='prev'?-1:1);focused=clamp(shown);draw(false);}
      if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}
    });
    dialog.addEventListener('keydown',event=>{
      if(!event.target.dataset.date)return;
      focused=event.target.dataset.date;
      const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}; let value;
      if(event.key in delta)value=add(focused,delta[event.key]);
      else if(event.key==='Home')value=add(focused,-day(focused).getUTCDay());
      else if(event.key==='End')value=add(focused,6-day(focused).getUTCDay());
      else if(event.key==='PageUp'||event.key==='PageDown'){const m=month(focused,event.key==='PageUp'?-1:1);value=add(m,Math.min(day(focused).getUTCDate(),day(add(month(m,1),-1)).getUTCDate())-1);}
      else return;
      event.preventDefault();focused=clamp(value);shown=focused.slice(0,7)+'-01';draw(true);
    });
    window.addEventListener('resize',()=>{if(dialog.open)place();});
    window.addEventListener('popstate',()=>{if(dialog.open)dialog.close();});
    refresh(); return { refresh };
  }
  window.CNStaffCalendar = { mount };
})();
