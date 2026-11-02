"use strict";
// 確定済み予約の表示専用。予約・金額・送信設定を書き換えない。
const integer = n => Number.isSafeInteger(n) && n >= 0;
function priceRows(bk, parts) {
  const people = parts.people, fee = parts.fee, rows = [];
  let baseKnown = integer(parts.base), serviceRows = [];
  if (bk.ticket_id) serviceRows = [{ kind: "ticket", subtotal: 0 }];
  else if (Array.isArray(bk.services) && bk.services.length && baseKnown) {
    for (const s of bk.services) {
      if (!integer(s.price)) { serviceRows = []; break; }
      let unit = s.price;
      if (s.discountType === "amount" && integer(s.discount) && s.discount <= unit) unit -= s.discount;
      else if (s.discountType === "percent" && Number.isFinite(s.discount) && s.discount >= 0 && s.discount <= 100) unit = Math.floor(unit * (100 - s.discount) / 100);
      else if (s.discountType && s.discountType !== "none") { serviceRows = []; break; }
      serviceRows.push({ kind: "treatment", name: bk.services.length > 1 ? s.name : "", discounted: unit !== s.price, unit, count: people, subtotal: unit * people });
    }
    const sum = serviceRows.reduce((n, x) => n + x.subtotal, 0);
    if (sum < parts.base) serviceRows = [];
    else if (serviceRows.length && sum > parts.base) serviceRows.push({ kind: "discount", subtotal: parts.base - sum });
  } else if (baseKnown && integer(bk.base_price) && bk.base_price * people === parts.base) {
    serviceRows = [{ kind: "treatment", unit: bk.base_price, count: people, subtotal: parts.base }];
  }
  if (!serviceRows.length) {
    // 単価不明の旧記録を現在のメニュー料金で補わない。
    if (baseKnown) serviceRows.push({ kind: "treatmentSubtotal", subtotal: parts.base });
    else serviceRows.push({ kind: "unregistered", subtotal: bk.total - fee });
  }
  rows.push(...serviceRows);
  if (fee > 0) {
    // 現行の予約は本人1名の指名。複数名分の明細がある記録は、合計・人数が一致した場合だけ利用。
    const items = bk.nomination_fee_items;
    const itemized = Array.isArray(items) && items.length && items.every(x => integer(x.unit_price) && integer(x.people) && x.people > 0 && typeof x.applies_to === "string" && x.applies_to.trim())
      && items.reduce((n, x) => n + x.people, 0) <= people
      && items.reduce((n, x) => n + x.unit_price * x.people, 0) === fee;
    if (itemized) rows.push(...items.filter(x => x.unit_price > 0).map(x => ({ kind: "nomination", unit: x.unit_price, count: x.people, subtotal: x.unit_price * x.people, target: x.applies_to })));
    else if (items != null) rows.push({ kind: "nomination", subtotal: fee, target: "record" });
    else rows.push({ kind: "nomination", unit: fee, count: 1, subtotal: fee, target: bk.nominated_staff_id ? "holder" : "record" });
  }
  if (baseKnown && parts.late > 0) rows.push({ kind: "night", unit: parts.late / people, count: people, subtotal: parts.late });
  const difference = bk.total - rows.reduce((n, x) => n + x.subtotal, 0);
  if (difference) rows.push({ kind: "adjustment", subtotal: difference });
  return rows;
}

const TEXT = {
  ja: ["ご予約内容", "料金明細", "ご予約者", "日時", "コース", "施術時間", "分", "人数", "ご本人", "同行者", "名", "施術料金", "指名料", "深夜料金", "全体割引", "その他料金・調整額", "施術料金小計", "施術料金・その他（内訳未登録）", "割引後", "回数券でお支払い（1回分）", "合計金額", "ご要望", "こだわり", "対象", "予約記録", "回数券"],
  en: ["Booking details", "Price breakdown", "Reservation holder", "Date and time", "Course", "Treatment duration", "min", "Guests", "reservation holder", "companions", "guest(s)", "Treatment", "Nomination fee", "Late-night surcharge", "Overall discount", "Other charges / adjustments", "Treatment subtotal", "Treatment / other charges (breakdown unavailable)", "after discount", "Paid with a session ticket (1 session)", "Total", "Requests", "Preferences", "Applies to", "booking record", "Session ticket"],
  zh: ["预约内容", "费用明细", "预约人", "日期时间", "项目", "护理时间", "分钟", "人数", "本人", "同行者", "位", "护理费用", "指定费", "深夜附加费", "整体折扣", "其他费用／调整额", "护理费用小计", "护理及其他费用（未登记明细）", "折扣后", "使用次卡支付（1次）", "合计金额", "要求", "偏好", "适用对象", "预约记录", "次卡"],
  ko: ["예약 내용", "요금 명세", "예약자", "일시", "코스", "시술 시간", "분", "인원", "본인", "동행자", "명", "시술 요금", "지명료", "심야 할증료", "전체 할인", "기타 요금 / 조정액", "시술 요금 소계", "시술 및 기타 요금 (내역 미등록)", "할인 후", "회수권 결제 (1회)", "합계 금액", "요청 사항", "선호 사항", "적용 대상", "예약 기록", "회수권"],
  fr: ["Réservation", "Détail des tarifs", "Titulaire de la réservation", "Date et heure", "Soin", "Durée du soin", "min", "Personnes", "titulaire", "accompagnants", "personne(s)", "Soins", "Frais de désignation", "Supplément de nuit", "Réduction globale", "Autres frais / ajustements", "Sous-total des soins", "Soins et autres frais (détail non enregistré)", "après réduction", "Paiement par carnet (1 séance)", "Total", "Demandes", "Préférences", "Pour", "réservation", "Carnet de séances"],
  es: ["Reserva", "Desglose de precios", "Titular de la reserva", "Fecha y hora", "Tratamiento", "Duración", "min", "Personas", "titular", "acompañantes", "persona(s)", "Tratamiento", "Cargo por designación", "Recargo nocturno", "Descuento global", "Otros cargos / ajustes", "Subtotal del tratamiento", "Tratamiento y otros cargos (sin desglose registrado)", "tras descuento", "Pago con bono (1 sesión)", "Total", "Solicitudes", "Preferencias", "Se aplica a", "reserva", "Bono de sesiones"],
  it: ["Prenotazione", "Dettaglio dei prezzi", "Titolare della prenotazione", "Data e ora", "Trattamento", "Durata", "min", "Persone", "titolare", "accompagnatori", "persona/e", "Trattamento", "Supplemento per designazione", "Supplemento notturno", "Sconto complessivo", "Altri costi / rettifiche", "Subtotale trattamenti", "Trattamenti e altri costi (dettaglio non registrato)", "dopo lo sconto", "Pagamento con carnet (1 seduta)", "Totale", "Richieste", "Preferenze", "Applicato a", "prenotazione", "Carnet"],
  de: ["Buchungsdetails", "Preisübersicht", "Buchende Person", "Datum und Uhrzeit", "Behandlung", "Behandlungsdauer", "Min.", "Personen", "buchende Person", "Begleitpersonen", "Person(en)", "Behandlung", "Wunschtherapeuten-Gebühr", "Nachtzuschlag", "Gesamtrabatt", "Sonstige Kosten / Anpassungen", "Behandlungssumme", "Behandlung und sonstige Kosten (Aufschlüsselung nicht erfasst)", "nach Rabatt", "Mit Mehrfachkarte bezahlt (1 Behandlung)", "Gesamtbetrag", "Wünsche", "Präferenzen", "Gilt für", "Buchung", "Mehrfachkarte"],
};
function render(bk, h, lang = "ja", store = false) {
  const t = TEXT[lang] || TEXT.ja, ja = lang === "ja", colon = ja ? "：" : ": ";
  const money = h.money || (n => n.toLocaleString("ja-JP") + "円");
  const name = h.menuName || (n => n), people = h.parts.people;
  const quantity = n => ja || lang === "zh" || lang === "ko" ? n + t[10] : n + " " + t[10];
  const row = (label, value) => label + colon + value;
  const services = bk.services?.length ? bk.services : [{ name: bk.course_name, minutesBody: Math.round((bk.end_at - bk.start_at) / 60000) }];
  const duration = services.reduce((n, s) => n + (integer(s.minutesBody) ? s.minutesBody : 0), 0);
  const group = people > 1 ? (ja ? `（ご本人＋同行者${people - 1}名）` : ` (${t[8]} + ${people - 1} ${t[9]})`) : "";
  const lines = [h.lead, "", `【${t[0]}】`, row(t[3], h.dateTime),
    ...services.map((s, i) => {
      const label = name(s.name || bk.course_name || "—");
      const time = services.length > 1 && integer(s.minutesBody) && s.minutesBody > 0 && !(ja && new RegExp(`(^|[^0-9])${s.minutesBody}\\s*分`).test(label)) ? ` (${s.minutesBody}${ja ? "" : " "}${t[6]})` : "";
      return row(t[4] + (services.length > 1 ? ` ${i + 1}` : ""), label + time);
    }),
    ...(duration > 0 && !(ja && services.length === 1 && new RegExp(`(^|[^0-9])${duration}\\s*分`).test(services[0].name || "")) ? [row(t[5], duration + (ja ? "" : " ") + t[6])] : []),
    row(t[7], quantity(people) + group), ...(h.nomination ? [h.nomination] : []), h.bookingId,
    "", `【${t[1]}】`];
  const labels = { treatment: t[11], nomination: t[12], night: t[13], discount: t[14], adjustment: t[15], treatmentSubtotal: t[16], unregistered: t[17], ticket: t[11] };
  for (const p of priceRows(bk, h.parts)) {
    const label = labels[p.kind] + (p.name ? ` (${name(p.name)})` : "") + (p.discounted ? ` (${t[18]})` : "");
    const amount = p.kind === "ticket" ? `${t[19]} ＝ ${money(0)}` : p.unit !== undefined ? `${money(p.unit)} × ${quantity(p.count)} ＝ ${money(p.subtotal)}` : money(p.subtotal);
    const target = p.target === "holder" ? t[8] : p.target === "record" ? t[24] : p.target;
    lines.push(row(label, amount) + (target ? (ja ? `（対象：${target}）` : ` (${t[23]}: ${target})`) : ""));
  }
  lines.push(row(t[20], money(bk.total)), "", `【${t[2]}】`, bk.name || "—");
  if (store) lines.push(`TEL：${bk.phone || "（未入力）"}`, `メール：${bk.email || "（未入力）"}`);
  if (bk.comment) lines.push("", row(t[21], bk.comment));
  if (bk.preferences) lines.push(row(t[22], bk.preferences));
  if (h.ticketLines?.length) lines.push("", `【${t[25]}】`, ...h.ticketLines);
  if (h.footer?.length) lines.push("", ...h.footer);
  if (h.ending) lines.push("", h.ending);
  return lines.join("\n");
}
module.exports = { render, priceRows };
