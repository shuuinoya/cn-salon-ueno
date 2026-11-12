'use strict';
// 予約者の連絡先は変更せず、実際の配信先だけを一か所へ限定する。
module.exports = function bookingMailTarget(mail, env = process.env) {
  const target = String(env.BOOKING_MAIL_TO || '').trim().toLowerCase();
  if (!target || !(mail.bookingId || mail.tpl?.name === 'booking')) return mail.to;
  // 複数宛先や壊れた設定のとき、元の宛先へ戻して送らない。
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(target) ? target : null;
};
