import { r } from './framework-DTZGTDtF.js';
import { useI18n } from './I18n-8lang-v1.js';
const jsx = r();
function StoreInfo() {
  const { t } = useI18n(), s = window.__TENANT__ || {};
  const time = n => Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
  const fields = [['storeName',s.name],['phone',s.phone],['address',s.address],['hours',time(s.openStart || 0)+'–'+time(s.openEnd || 0)],['website',location.origin]];
  return jsx.jsxs('section', { className:'info-card', children:[jsx.jsx('h2',{children:t('storeInfo')}), jsx.jsx('dl',{children:fields.flatMap(([k,v]) => [jsx.jsx('dt',{children:t(k)},k+'-label'),jsx.jsx('dd',{children:v||'—'},k)])})] });
}
export { StoreInfo };
