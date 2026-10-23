import { r as runtime } from './rolldown-runtime-hePW80VL.js';
import { i as reactModule, r as jsxModule } from './framework-DTZGTDtF.js';
import '/cn-i18n.js';
import '/staff-calendar.js';

const React = runtime(reactModule(), 1), jsx = jsxModule().jsx;

// Reactが管理する日付と、スタッフ紹介と共通の小窓を結び付ける。
// changeイベントの疑似送信に頼らず、最新の選択処理へ日付だけを渡す。
export function BookingDatePicker(props) {
  const host = React.useRef(null), control = React.useRef(null), latest = React.useRef(props);
  latest.current = props;
  React.useLayoutEffect(() => {
    const input = document.createElement('input');
    input.type = 'date'; input.value = latest.current.value; input.min = latest.current.min; input.max = latest.current.max;
    host.current.appendChild(input);
    const calendar = window.CNStaffCalendar.mount(input, {
      titleKey: '予約日を選択', language: () => latest.current.language,
      onChange: value => latest.current.onChange(value)
    });
    control.current = { input, calendar };
    return () => { calendar.destroy(); input.remove(); control.current = null; };
  }, []);
  React.useLayoutEffect(() => {
    if (!control.current) return;
    const { input, calendar } = control.current;
    input.value = props.value; input.min = props.min; input.max = props.max; calendar.refresh();
  }, [props.value, props.min, props.max, props.language]);
  return jsx('div', { className:'select-label', children:[
    jsx('span', { children:window.CNI18N.t('予約日', undefined, props.language) }, 'label'),
    jsx('div', { className:'booking-date-field', ref:host }, 'date')
  ] });
}
