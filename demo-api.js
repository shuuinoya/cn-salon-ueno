// 管理画面（操作デモ）用のモックAPIです。
// 元サイトの /api/demo/schedule 相当を、保存版のためにメモリ上の架空データで再現します。
// サーバーを再起動するとデータは初期状態に戻ります。
"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const tls = require("tls");

// ---- 実送信の設定（任意） -------------------------------------------------
// プロジェクト直下に mail-config.json（mail-config.example.json 参照）を置くと、
// allowTo に書いた宛先にだけ、SMTP（例：Gmailのアプリパスワード）で実際に送信する。
// それ以外の宛先は従来どおりデモ内シミュレーションのみ（外部に出ない）。
function loadMailConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, "mail-config.json"), "utf8"));
    if (c && c.enabled && c.host && c.user && Array.isArray(c.allowTo)) return c;
  } catch {}
  return null;
}
const realSendAllowed = (to) => {
  const c = loadMailConfig();
  return c && c.allowTo.includes(to) ? c : null;
};

// 最小限のSMTPクライアント（依存パッケージなし）。
// port 465=SSL／587=STARTTLS／secure:"none"はローカル検証用の平文。
function smtpSend(cfg, mail, done) {
  const CRLF = "\r\n";
  const b64 = (t) => Buffer.from(t, "utf8").toString("base64");
  const enc = (t) => "=?UTF-8?B?" + b64(t) + "?=";
  const wrap = (t) => t.replace(/(.{76})/g, "$1" + CRLF);
  const from = cfg.from || cfg.user;
  const boundary = "cnb-" + Math.random().toString(16).slice(2);
  const data = [
    `From: ${enc("Ueno spa&massage CN Health & Beauty SALON")} <${from}>`,
    `To: <${mail.to}>`,
    `Subject: ${enc(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(16).slice(2)}@cn-salon-demo>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(mail.body)),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(mail.html || mail.body)),
    `--${boundary}--`,
    "",
  ].join(CRLF).replace(/\n\./g, "\n..");

  let finished = false;
  const finish = (err) => { if (!finished) { finished = true; try { sock.destroy(); } catch {} done(err || null); } };
  const timer = setTimeout(() => finish(new Error("送信がタイムアウトしました")), 20000);

  let sock;
  let buf = "";
  let steps;
  const send = (line) => sock.write(line + CRLF);
  const onReply = (code, text) => {
    const step = steps.shift();
    if (!step) return;
    if (!step.ok.includes(code)) { clearTimeout(timer); return finish(new Error(`SMTP ${code} ${text.trim().slice(0, 120)}`)); }
    if (step.run) step.run();
    if (!steps.length) { clearTimeout(timer); finish(null); }
  };
  const feed = (chunk) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i + 1);
      buf = buf.slice(i + 1);
      // 250-xxx のような継続行は読み飛ばし、最終行（250 xxx）で応答とみなす
      if (/^\d{3}-/.test(line)) continue;
      const code = Number(line.slice(0, 3));
      if (code) onReply(code, line.slice(3));
    }
  };
  const baseSteps = () => [
    { ok: [250], run: () => send("AUTH LOGIN") },
    { ok: [334], run: () => send(b64(cfg.user)) },
    { ok: [334], run: () => send(b64(cfg.pass || "")) },
    { ok: [235], run: () => send(`MAIL FROM:<${from}>`) },
    { ok: [250], run: () => send(`RCPT TO:<${mail.to}>`) },
    { ok: [250, 251], run: () => send("DATA") },
    { ok: [354], run: () => sock.write(data + "." + CRLF) },
    { ok: [250], run: () => send("QUIT") },
    { ok: [221] },
  ];
  try {
    if (Number(cfg.port) === 587) {
      // STARTTLS：平文で接続してからTLSへ切り替える
      sock = net.connect(587, cfg.host);
      steps = [
        { ok: [220], run: () => send("EHLO cn-salon-demo") },
        { ok: [250], run: () => send("STARTTLS") },
        { ok: [220], run: () => {
          sock.removeAllListeners("data");
          sock = tls.connect({ socket: sock, servername: cfg.host }, () => send("EHLO cn-salon-demo"));
          sock.on("data", feed);
          sock.on("error", (e) => finish(e));
          steps = baseSteps();
        } },
      ];
    } else if (cfg.secure === "none") {
      sock = net.connect(Number(cfg.port) || 25, cfg.host);
      steps = [{ ok: [220], run: () => send("EHLO cn-salon-demo") }, ...baseSteps()];
    } else {
      sock = tls.connect({ host: cfg.host, port: Number(cfg.port) || 465, servername: cfg.host });
      steps = [{ ok: [220], run: () => send("EHLO cn-salon-demo") }, ...baseSteps()];
    }
    sock.on("data", feed);
    sock.on("error", (e) => { clearTimeout(timer); finish(e); });
  } catch (e) {
    clearTimeout(timer);
    finish(e);
  }
}

// ---- 架空データの素材 -------------------------------------------------

const COURSE_SEED = {
  "364321-4822671": { name: "【本日限定】全身整体60分＋足裏マッサージ 60分 通常料金13200円→12000円", price: 12000, minutes: 120 },
  "364321-4822710": { name: "今月限定キャンペーン：男性スタッフオイルマッサージ 120分20500円→18500円", price: 18500, minutes: 120 },
  "364321-4822711": { name: "今月限定キャンペーン：女性スタッフオイルマッサージ 120分20500円→18500円", price: 18500, minutes: 120 },
  "364326-4893798": { name: "【★女性スタッフ】足裏マッサージ30分＋オイルマッサージ90分　120分", price: 20500, minutes: 120 },
  "364326-4893799": { name: "【★男性スタッフ】足裏マッサージ30分＋オイルマッサージ90分　120分", price: 20500, minutes: 120 },
  "364326-4822708": { name: "【男性スタッフ】オイルリンパマッサージ 60分", price: 11500, minutes: 60 },
  "364326-4823112": { name: "【女性スタッフ】オイルリンパマッサージ 60分", price: 11500, minutes: 60 },
  "364326-4822709": { name: "【男性スタッフ】オイルリンパマッサージ 90分", price: 16500, minutes: 90 },
  "364326-4823113": { name: "【女性スタッフ】オイルリンパマッサージ 90分", price: 16500, minutes: 90 },
  "364326-4823102": { name: "【人気No.1★男性スタッフ】極上の癒し☆オイルリンパマッサージ120分", price: 20500, minutes: 120 },
  "364326-4823114": { name: "【人気No.1★女性スタッフ】極上の癒し☆オイルリンパマッサージ120分", price: 20500, minutes: 120 },
  "364326-4827938": { name: "オススメ【男性スタッフ】腸もみオイルリンパマッサージ 120分", price: 23500, minutes: 120 },
  "364326-4827940": { name: "オススメ【女性スタッフ】腸もみオイルリンパマッサージ 120分", price: 23500, minutes: 120 },
  "364326-4822715": { name: "ハイパーナイフ6【ボディ＆フェイス】オイルマッサージと組み合わせが最適", price: 4000, minutes: 20 },
  "364326-4921051": { name: "出張マッサージ（120分）25,500円 施術内容はご要望に応じて自由にカスタマイズできます。", price: 25500, minutes: 120 },
  "364328-4822716": { name: "フェイシャル 60分 自然で明るい“本来の笑顔”を引き出し", price: 9900, minutes: 60 },
  "364323-4822706": { name: "タイ古式マッサージ", price: 8800, minutes: 60 },
  "364323-4822664": { name: "【当店人気メニュー】首肩コリ、頭痛な方にオススメ ヘッドスパ 60分", price: 7700, minutes: 60 },
  "364323-4822701": { name: "全身整体 60分", price: 6600, minutes: 60 },
  "364325-4822707": { name: "矯正整体(骨盤、姿勢、O脚) 60分", price: 7700, minutes: 60 },
  "364324-4822705": { name: "小顔矯正 60分", price: 9900, minutes: 60 },
  "364327-4822712": { name: "フットマッサージ(足湯＋足裏～ふくらぎ) 60分", price: 6600, minutes: 60 },
  "364329-4822717": { name: "ハイパーナイフ6【ボディ】腹、背、腕、脚など 選べる1部位10分＋マッサージ10分", price: 4000, minutes: 20 },
  "364331-4822719": { name: "シャワールーム 30分", price: 1000, minutes: 30 },
  "364331-4822720": { name: "レンタルルーム 60分　2500円", price: 2500, minutes: 60 },
};
// メニューは管理画面（メニュー一覧）から追加・変更・削除できる可変データにする
const courseStore = new Map(Object.entries(COURSE_SEED).map(([id, c]) => [id, { id, ...c }]));
let courseSerial = 0;
const getCourse = (id) => courseStore.get(id);
// メニューごとの写真（courseId -> dataURL）。一覧のJSONを重くしないため本体とは別持ち
const coursePhotos = new Map();
// 予約サイトのメニュー紹介ページで使われている写真を、最初から各メニューに登録しておく
// （管理画面のメニュー一覧で差し替え・削除も可能。再起動でこの初期状態に戻る）
const COURSE_PHOTO_SEED = {
  "364321-4822671": "co_06e67b46d3ce954a4d8dc36207c61a7d1a1fb35d.JPG.webp",
  "364321-4822710": "co_a74d2bc36297e5cb9eb15180da28345378207251.JPG.webp",
  "364321-4822711": "co_06217b76974b6bdded5a8fe44b63f8c3ab646c96.jpg.webp",
  "364323-4822664": "co_3a14adae2ff37f6ab6a14bfddc89c9311ee6e605.JPG.webp",
  "364323-4822701": "co_51cc59c3c915986a78795844621d746e1f329666.jpg.webp",
  "364323-4822706": "co_ceebf960b190ec533515cec27fd2f7a8247f4b37.JPG.webp",
  "364324-4822705": "co_cf9cd7918cd6fb4ee30dc91e08013e9821d006d5.jpg.webp",
  "364325-4822707": "co_d6ab84884dadb8f162a6b5f572f1c17b796e0eef.jpg.webp",
  "364326-4822708": "co_e642a1c14377c793df787ea8830b68c4214d4531.jpeg.webp",
  "364326-4822709": "co_bbc653114e6da85d2313e833f3a7830202e77538.jpeg.webp",
  "364326-4822715": "co_eba185c1a22b41c51c9d21c9c223da5b20a095cf.jpg.webp",
  "364326-4823102": "co_0ffde62977e033fd0f9feebd8f30a37d443b2c51.jpeg.webp",
  "364326-4823112": "co_8206f0066a0a719e77fc63ae0d23e907e5b9c104.jpg.webp",
  "364326-4823113": "co_0c89587fa824181955a2da25f17050624e275129.jpg.webp",
  "364326-4823114": "co_e08179d3135ec19c1f080bb293595f4dbffdb6fe.jpg.webp",
  "364326-4827938": "co_9e2d7b09e6aa77b221c33003599660814646022c.jpg.webp",
  "364326-4827940": "co_0fa9b6dff6bf3535eb38fbde0d64474b0748dcaf.jpg.webp",
  "364326-4893798": "co_d42336c850d6fd24fe2813c85d2b7177e7a29dbf.jpg.webp",
  "364326-4893799": "co_7b32647f0e1e58b16538443f2d793f33cf9165be.jpeg.webp",
  "364326-4921051": "co_8291d710e6f05d625221368ca3bacceb40c82347.jpeg.webp",
  "364327-4822712": "co_0e3942217b433036def69b4f61decec77f6176e1.jpg.webp",
  "364328-4822716": "co_c1f2a8962aec3e0d579594af06c63c4c4d5042d1.jpg.webp",
  "364329-4822717": "co_1a373c99b2752a99c6a55d8f822aea23bc7656f1.jpg.webp",
  "364331-4822719": "co_02e92026b759f1d520ce2fc6470bc62d167594e0.JPG.webp",
  "364331-4822720": "co_590b185f4e5dae65c06a8e30841f58072f96fb5b.jpg.webp",
};
try {
  for (const [cid, name] of Object.entries(COURSE_PHOTO_SEED)) {
    const file = path.join(__dirname, "public", "images", name);
    if (fs.existsSync(file)) {
      coursePhotos.set(cid, "data:image/webp;base64," + fs.readFileSync(file).toString("base64"));
    }
  }
} catch { /* 写真が読めなくてもメニュー自体の動作には影響させない */ }
const courseListJson = () =>
  [...courseStore.values()].map((c) => ({ ...c, hasPhoto: coursePhotos.has(c.id) }));

const STAFF_SEED = [
  { id: "aaaaaa12-0000-4000-8000-000000000012", name: "杉田 祐哉", gender: "male", message: "" },
  { id: "aaaaaa01-0000-4000-8000-000000000001", name: "豊", gender: "male", message: "はじめまして。\n小顔矯正とオイルマッサージを得意としており、講師レベルの技術とお客様から評価をいただくこともあります。\n\n小顔矯正では、お顔のバランスや筋肉の状態を見ながら丁寧に調整し、施術前後の変化をすぐに実感していただける即効性を大切にしています。フェイスラインの引き締まりや左右バランスの改善を感じていただくお客様が多いです。\n\nオイルマッサージでは、筋肉の深い部分までしっかりアプローチしながら、リラックスと疲労回復の両方を感じていただける施術を心がけています。\n\n技術・接客ともに常に高いレベルを目指し、どのお客様にもご満足いただける施術を大切にしています。\nお身体やお顔のお悩みは、ぜひ安心してお任せください。心を込めて施術いたします。" },
  { id: "aaaaaa02-0000-4000-8000-000000000002", name: "中山 優吾", gender: "male", message: "はじめまして。\n体格を活かしたパワーのある施術と、足裏マッサージ・オイルマッサージが得意です。\n\n足裏には全身につながる反射区があり、丁寧に刺激していくことで、脚の疲れやむくみ、全身のだるさをスッキリさせていきます。長時間歩いた後や立ち仕事の方にもとてもおすすめです。\n\nまた、オイルマッサージでは深いコリまでしっかりアプローチしながら、筋肉をゆっくりほぐしていく施術を心がけています。しっかり効かせる施術からリラックス重視まで、お客様のお好みに合わせて細かく調整いたします。\n\n「体が軽くなった」「足がすごく楽になった」と感じていただけるよう、毎回心を込めて施術します。\nお疲れの際は、ぜひお気軽にお任せください。" },
  { id: "aaaaaa04-0000-4000-8000-000000000004", name: "平良 陽太", gender: "male", message: "※注意　指名料500円→2500円\nはじめまして。\nオイルマッサージを得意としており、「驚くほど上手い」とお客様からお声をいただくことも多いです。\n\n筋肉質な体格を活かし、しっかりとした圧で深いコリまで丁寧にほぐしていきます。力強さの中にもリズムと心地よさを大切にした施術で、全身が軽くなるような感覚を目指しています。\n\nまた、英語での対応も可能ですので、海外からのお客様にも安心してご利用いただいています。\nお客様一人ひとりに合わせた丁寧な接客と、気持ちの良いサービスを心がけています。\n\n「またお願いしたい」と思っていただけるよう、心を込めて施術いたします。\nオイルマッサージがお好きな方は、ぜひ一度お任せください。" },
  { id: "aaaaaa05-0000-4000-8000-000000000005", name: "山田 恵", gender: "female", message: "私は、お客様がふっと肩の力を抜いて、心からリラックスできる「穏やかで優しい時間」を提供することを大切にしています。お体のお悩みはもちろん、その日の気分や細かなご要望にも丁寧に耳を傾け、手のひらから伝わる温もりで、日々の疲れを一つひとつ丁寧に解きほぐしていきます。\n\nまた、海外からお越しのお客様にも安心してお過ごしいただけるよう、英語でのカウンセリングやコミュニケーションにも対応しております。「言葉の壁」を感じることなく、最高のリラクゼーションを体感していただけるよう努めています。\n\n◆ 得意な施術\n\n足裏マッサージ： 「第二の心臓」と呼ばれる足裏を丁寧に刺激し、全身の血行を促進します。長旅や立ち仕事でパンパンに張ってしまった脚も、驚くほど軽やかに整えます。\n\nタイ古式マッサージ： 優しいリズムのストレッチで、普段使わない筋肉をゆっくりと伸ばします。無理な負荷をかけず、呼吸に合わせた丁寧なアプローチで、体本来の柔軟性を取り戻します。\n\n◆ お客様へ（Message to Our Guests）\n忙しい日常の中で、自分のための時間を作ることはとても大切です。\n「痛いのは苦手だけど、しっかり解されたい」「リラックスしてぐっすり眠りたい」といったご希望も、遠慮なくお聞かせください。" },
  { id: "aaaaaa14-0000-4000-8000-000000000014", name: "小倉 有美子", gender: "female", message: "はじめまして。丁寧なカウンセリングとオイルリンパマッサージが得意です。お身体の状態に合わせて、リラックスしていただける施術を心がけています。" },
  { id: "aaaaaa15-0000-4000-8000-000000000015", name: "武良 翔平", gender: "male", message: "力強い指圧と全身整体が得意です。スポーツ経験を活かし、深いコリにもしっかりアプローチします。" },
  { id: "aaaaaa16-0000-4000-8000-000000000016", name: "未定", gender: "female", message: "" },
];

// ---- 時刻ユーティリティ（日本時間・分単位） ---------------------------

const dayStartMs = (date) => Date.parse(date + "T00:00:00+09:00");
const minToMs = (date, min) => dayStartMs(date) + min * 60000;
const msToMin = (date, ms) => Math.round((ms - dayStartMs(date)) / 60000);
const todayJst = () => new Date(Date.now() + 32400000 - 10800000).toISOString().slice(0, 10); // 3時切替
const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// 日付文字列から決まる簡易乱数（毎回同じ架空データを生成するため）
function seededRand(seedStr) {
  let h = 2166136261;
  for (const c of seedStr) h = (h ^ c.charCodeAt(0)) * 16777619 >>> 0;
  return () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
}

// ---- メモリ上の状態 ----------------------------------------------------

const state = {
  staff: STAFF_SEED.map((s, i) => ({
    id: s.id,
    name: s.name,
    gender: s.gender,
    active: 1,
    courses: "[]", // 空=全メニュー対応
    locked: ["豊", "中山 優吾", "平良 陽太", "山田 恵", "小倉 有美子", "未定"].includes(s.name) ? 1 : 0, // 鍵（予約受付停止）
    profile: JSON.stringify({
      nickname: "",
      personalNomination: s.name !== "未定", // 「未定」は指名不可の割当用スタッフ
      genderNomination: false,
      nominationFee: { "杉田 祐哉": 500, "中山 優吾": 2700, "小倉 有美子": 1100, "未定": 1100, "武良 翔平": 500 }[s.name] || 0,
      message: s.message || "",
      imageKey: "",
    }),
    sort_order: i + 1,
    profile_revision: 0,
  })),
  photos: new Map(),   // staffId -> dataURL
  days: new Map(),     // date -> {version, enabled}
  shifts: new Map(),   // date -> [{staff_id, date, start_at, end_at, note}]
  events: new Map(),   // date -> {bookings: [], blocks: [], assignments: []}
  notifications: [{ status: "pending", count: 0 }, { status: "cancelled", count: 0 }],
  mails: [],       // 生成したメール（デモ。実際には送信しない）
  mailSerial: 0,
  // 予約フォームのフリーメッセージ欄の設定（管理画面から変更できる）
  settings: {
    freeMessage: {
      visible: true,      // 欄を表示するか
      required: false,    // 入力必須にするか
      label: "",          // 欄の見出し（空なら元のまま）
      placeholder: "",    // 入力欄のヒント文
      description: "",    // 欄の下に出す説明文
      maxLength: 2000,    // 入力文字数の上限
    },
  },
  bookingSerial: 100,
  bookingIndex: new Map(), // 予約ID -> 日付
  requestKeys: new Map(),  // 予約サイトの多重送信防止キー -> 結果
  reports: new Map(),      // 営業実績（日報）の入力内容 date -> {weather, ...}
};

function ensureDay(date) {
  // version は 0 始まりにする。管理画面は未取得の日付の revision を 0 とみなして
  // 送ってくるため、1 始まりだと遠い将来の日付の一括シフト登録が必ず競合になってしまう。
  if (!state.days.has(date)) state.days.set(date, { version: 0, enabled: true });
  return state.days.get(date);
}

// 本物の予約台帳の画像と同じ固定シフト（毎日同じパターン。月間シフト入力で上書き可能）
const FIXED_SHIFTS = {
  "aaaaaa12-0000-4000-8000-000000000012": [1020, 1410], // 杉田 祐哉 17:00〜23:30
  "aaaaaa01-0000-4000-8000-000000000001": [600, 1320],  // 豊       10:00〜22:00
  "aaaaaa02-0000-4000-8000-000000000002": [600, 1230],  // 中山 優吾 10:00〜20:30
  "aaaaaa04-0000-4000-8000-000000000004": [600, 1080],  // 平良 陽太 10:00〜18:00
  "aaaaaa05-0000-4000-8000-000000000005": [1110, 1290], // 山田 恵   18:30〜21:30
  "aaaaaa14-0000-4000-8000-000000000014": [840, 1290],  // 小倉 有美子 14:00〜21:30
  "aaaaaa15-0000-4000-8000-000000000015": [900, 1290],  // 武良 翔平 15:00〜21:30
  "aaaaaa16-0000-4000-8000-000000000016": [720, 990],   // 未定     12:00〜16:30
};
function ensureShifts(date) {
  if (state.shifts.has(date)) return state.shifts.get(date);
  const list = [];
  state.staff.forEach((s) => {
    const t = FIXED_SHIFTS[s.id];
    if (!t) return;
    list.push({ staff_id: s.id, date, start_at: minToMs(date, t[0]), end_at: minToMs(date, t[1]), note: "" });
  });
  state.shifts.set(date, list);
  return list;
}

function ensureEvents(date) {
  if (state.events.has(date)) return state.events.get(date);
  const ev = { bookings: [], blocks: [], assignments: [] };
  state.events.set(date, ev);
  // 当日だけ、本物の予約台帳の画像と同じ予定を最初から載せておく
  // （それ以外の日は、予約サイトからの予約と管理画面での手入力のみ）
  if (date === todayJst()) seedTodayEvents(date, ev);
  return ev;
}

// 画像と同じ当日の業務・予約一式（集計値も画像と一致するよう金額まで揃えている）
function seedTodayEvents(date, ev) {
  const S = {
    sugita: "aaaaaa12-0000-4000-8000-000000000012",
    yutaka: "aaaaaa01-0000-4000-8000-000000000001",
    nakayama: "aaaaaa02-0000-4000-8000-000000000002",
    taira: "aaaaaa04-0000-4000-8000-000000000004",
    yamada: "aaaaaa05-0000-4000-8000-000000000005",
    ogura: "aaaaaa14-0000-4000-8000-000000000014",
    takera: "aaaaaa15-0000-4000-8000-000000000015",
    mitei: "aaaaaa16-0000-4000-8000-000000000016",
  };
  let n = 0;
  const block = (sid, start, end) => {
    n++;
    ev.blocks.push({ id: "blk-seed-" + n, staff_id: sid, date, start_at: minToMs(date, start), end_at: minToMs(date, end), kind: "work", note: "" });
  };
  const book = (sid, start, end, courseId, extra) => {
    n++;
    const c = getCourse(courseId);
    const id = "bk-seed-" + n;
    const bk = {
      id, reference: "SD" + String(n).padStart(6, "0"), service_date: date,
      status: "confirmed", start_at: minToMs(date, start), end_at: minToMs(date, end),
      people: 1, course: courseId, course_name: c.name,
      name: "", email: "", phone: "", comment: "",
      total: c.price, base_price: c.price,
      nomination_fee: 0, nominated_staff_id: null, nominated_staff_name: null,
      staff: "none", customer_token: null,
      booth: "新規1(1)", course_label: c.name, is_new: 1, multi: 0, hide_name: 0,
      customer_gender: "", created_label: date + " 09:00 WEB", display_id: 247378000 + n,
      ...extra,
    };
    bk.reference = String(bk.display_id); // 予約ID（画像と同じ9桁数値）
    ev.bookings.push(bk);
    state.bookingIndex.set(id, date);
    if (sid) ev.assignments.push({ booking_id: id, staff_id: sid });
    return bk;
  };
  // 業務ブロック
  block(S.sugita, 1050, 1110);   // 17:30〜18:30
  block(S.yutaka, 750, 810);     // 12:30〜13:30
  block(S.nakayama, 600, 690);   // 10:00〜11:30
  block(S.nakayama, 690, 750);   // 11:30〜12:30
  block(S.taira, 600, 660);      // 10:00〜11:00
  block(S.taira, 690, 810);      // 11:30〜13:30
  block(S.taira, 810, 930);      // 13:30〜15:30
  block(S.taira, 1020, 1080);    // 17:00〜18:00
  block(S.yamada, 1140, 1200);   // 19:00〜20:00
  block(S.ogura, 1140, 1200);    // 19:00〜20:00
  block(S.takera, 990, 1110);    // 16:30〜18:30
  block(S.takera, 1110, 1230);   // 18:30〜20:30
  block(S.takera, 1230, 1290);   // 20:30〜21:30
  block(S.mitei, 930, 990);      // 15:30〜16:30
  // 予約（合計 98,100円・新規5名・リピート2名・計7件）
  book(S.nakayama, 750, 870, "364321-4822671", {
    name: "ゲスト", staff: "male", booth: "新規1(2)", multi: 1,
    course_label: "本日限定】全身整体60分＋足裏60分", created_label: date + " 08:12 WEB", customer_gender: "m",
  });
  book(S.mitei, 750, 870, "364321-4822671", {
    name: "nadinehoduc", staff: "female", booth: "新規1(3)", multi: 1,
    course_label: "本日限定】全身整体60分＋足裏60分", created_label: date + " 07:58 WEB", customer_gender: "f",
  });
  book(S.ogura, 900, 1020, "364321-4822711", {
    name: "Katelyn Cartwright", staff: "female", booth: "新規1(1)",
    course_label: "今月キャンペーン：女性オイル120", created_label: date + " 10:41 WEB", customer_gender: "f",
  });
  book(S.nakayama, 930, 990, "364326-4822708", {
    name: "伊東敦", staff: "male", booth: "新規1(1)",
    course_label: "【男】オイルリンパ60", created_label: date + " 11:05 WEB", customer_gender: "m",
  });
  book(S.nakayama, 1110, 1230, "364326-4823102", {
    name: "Irwin", staff: "male", booth: "新規1(1)", is_new: 0,
    course_label: "【男】オイルリンパ120", created_label: date + " 12:20 WEB", customer_gender: "m",
  });
  book(S.sugita, 1230, 1290, "364327-4822712", {
    name: "タカタミカ", staff: "none", booth: "新規1(1)",
    email: "mika_takata@hotmail.com", phone: "16467345696",
    course_label: "フット(足湯＋足裏〜ふくらぎ)60", created_label: date + " 18:33 PC",
    customer_gender: "f", display_id: 247378863,
  });
  book(S.sugita, 1290, 1380, "364326-4822709", {
    name: "", hide_name: 1, is_new: 0, staff: "male",
    nomination_fee: 500, nominated_staff_id: S.sugita, nominated_staff_name: "杉田 祐哉",
    total: 17000, booth: "新規1(1)",
    course_label: "【男】オイルリンパ90", created_label: date + " 13:44 PC", customer_gender: "m",
  });
  // 画面に出ない取消1件・無断キャンセル2件（下部集計用。cancelled以外だと
  // 復元版のReactが「未定」行を合成してしまうため、無断はフラグで区別する）
  book(null, 600, 660, "364323-4822701", { name: "取消済み", status: "cancelled" });
  book(null, 660, 720, "364323-4822701", { name: "無断1", status: "cancelled", no_show: 1 });
  book(null, 720, 780, "364323-4822701", { name: "無断2", status: "cancelled", no_show: 1 });
}

// スタッフの1日分の予定（予約・休憩・業務）が重ならないかを確認
function overlaps(date, staffId, start, end, ignoreId) {
  const ev = ensureEvents(date);
  const items = [
    ...ev.bookings.filter((b) => b.status === "confirmed" && ev.assignments.some((a) => a.booking_id === b.id && a.staff_id === staffId)),
    ...ev.blocks.filter((b) => b.staff_id === staffId),
  ];
  return items.some((it) => it.id !== ignoreId && msToMin(date, it.start_at) < end && msToMin(date, it.end_at) > start);
}

function shiftOf(date, staffId) {
  return ensureShifts(date).find((s) => s.staff_id === staffId);
}

function withinShift(date, staffId, start, end) {
  const sh = shiftOf(date, staffId);
  return !!sh && msToMin(date, sh.start_at) <= start && end <= msToMin(date, sh.end_at);
}

// ---- リクエスト処理 ----------------------------------------------------

function getSchedule(date) {
  const today = todayJst();
  const days = [], shifts = [];
  for (let i = -1; i <= 62; i++) {
    const d = addDays(date, i);
    const day = ensureDay(d);
    days.push({ date: d, version: day.version, enabled: day.enabled });
    if (d >= today) shifts.push(...ensureShifts(d));
  }
  const ev = ensureEvents(date);
  return {
    staff: [...state.staff].sort((a, b) => a.sort_order - b.sort_order),
    shifts,
    bookings: ev.bookings,
    blocks: ev.blocks,
    assignments: ev.assignments,
    days,
    mailReady: true, // デモ：メールは生成のみ（/admin/mails で内容を確認できる）
    notifications: mailSummary(),
  };
}

function err(code, message) {
  const e = new Error(message);
  e.status = code;
  return e;
}

function postSchedule(body) {
  const { action, date } = body;
  if (!action || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw err(400, "invalid");
  const day = ensureDay(date);
  const checkRevision = () => { if (body.revision !== day.version) throw err(409, "scheduleConflict"); };
  const bump = (d = date) => { ensureDay(d).version++; };

  switch (action) {
    case "shift": {
      checkRevision();
      const { staffId, start, end, remove } = body;
      if (!state.staff.some((s) => s.id === staffId)) throw err(400, "invalid");
      const list = ensureShifts(date);
      const idx = list.findIndex((s) => s.staff_id === staffId);
      if (remove) {
        if (overlaps(date, staffId, 0, 100000)) throw err(409, "scheduleConflict");
        if (idx >= 0) list.splice(idx, 1);
        bump();
        return { ok: true };
      }
      if (!(Number.isFinite(start) && Number.isFinite(end) && start < end)) throw err(400, "invalid");
      // 予約・休憩・業務が新しいシフトの外に残る短縮は保存しない
      const ev = ensureEvents(date);
      const mine = [
        ...ev.bookings.filter((b) => b.status === "confirmed" && ev.assignments.some((a) => a.booking_id === b.id && a.staff_id === staffId)),
        ...ev.blocks.filter((b) => b.staff_id === staffId),
      ];
      if (mine.some((it) => msToMin(date, it.start_at) < start || msToMin(date, it.end_at) > end)) throw err(409, "scheduleConflict");
      const rec = { staff_id: staffId, date, start_at: minToMs(date, start), end_at: minToMs(date, end), note: String(body.note ?? "") };
      if (idx >= 0) list[idx] = rec; else list.push(rec);
      bump();
      return { ok: true };
    }
    case "bulkShift": {
      const { start, end, cells, remove } = body;
      if (!Array.isArray(cells) || !cells.length) throw err(400, "invalid");
      if (!remove && !(Number.isFinite(start) && Number.isFinite(end) && start < end)) throw err(400, "invalid");
      for (const c of cells) {
        if (c.revision !== ensureDay(c.date).version) throw err(409, "scheduleConflict");
      }
      for (const c of cells) {
        const list = ensureShifts(c.date);
        const idx = list.findIndex((s) => s.staff_id === c.staffId);
        const ev = ensureEvents(c.date);
        const mine = [
          ...ev.bookings.filter((b) => b.status === "confirmed" && ev.assignments.some((a) => a.booking_id === b.id && a.staff_id === c.staffId)),
          ...ev.blocks.filter((b) => b.staff_id === c.staffId),
        ];
        if (remove) {
          // お客様の予約が残っている日は削除しない。休憩・業務はシフトと一緒に削除する
          const myBookings = ev.bookings.filter((b) => b.status === "confirmed" && ev.assignments.some((a) => a.booking_id === b.id && a.staff_id === c.staffId));
          if (myBookings.length) throw err(409, "scheduleConflict");
          ev.blocks = ev.blocks.filter((b) => b.staff_id !== c.staffId);
          if (idx >= 0) list.splice(idx, 1);
          bump(c.date);
          continue;
        }
        if (mine.some((it) => msToMin(c.date, it.start_at) < start || msToMin(c.date, it.end_at) > end)) throw err(409, "scheduleConflict");
        const rec = { staff_id: c.staffId, date: c.date, start_at: minToMs(c.date, start), end_at: minToMs(c.date, end), note: "" };
        if (idx >= 0) list[idx] = rec; else list.push(rec);
        bump(c.date);
      }
      return { ok: true };
    }
    case "block": {
      checkRevision();
      const { staffId, start, end, kind, remove, id } = body;
      const ev = ensureEvents(date);
      if (remove) {
        const idx = ev.blocks.findIndex((b) => b.id === id);
        if (idx < 0) throw err(404, "notFound");
        ev.blocks.splice(idx, 1);
        bump();
        return { ok: true };
      }
      if (!state.staff.some((s) => s.id === staffId) || !(start < end) || ![`break`, `work`].includes(kind)) throw err(400, "invalid");
      if (!withinShift(date, staffId, start, end)) throw err(409, "outsideShift");
      if (overlaps(date, staffId, start, end, id)) throw err(409, "scheduleConflict");
      const rec = { id: id || "blk-" + Date.now(), staff_id: staffId, date, start_at: minToMs(date, start), end_at: minToMs(date, end), kind, note: String(body.note ?? "") };
      const idx = ev.blocks.findIndex((b) => b.id === rec.id);
      if (idx >= 0) ev.blocks[idx] = rec; else ev.blocks.push(rec);
      bump();
      return { ok: true };
    }
    case "moveBooking": {
      checkRevision();
      const { id, staffId, start, end } = body;
      const ev = ensureEvents(date);
      const bk = ev.bookings.find((b) => b.id === id && b.status === "confirmed");
      if (!bk) throw err(404, "notFound");
      const mvTarget = state.staff.find((s) => s.id === staffId);
      if (!mvTarget) throw err(400, "invalid");
      if (mvTarget.locked) throw err(409, "soldOut");            // 鍵中のスタッフには入れられない
      if (!staffCanDo(mvTarget, bk.course)) throw err(409, "soldOut"); // 対応可能メニュー外は不可
      const mvGender = courseGender(bk.course);
      if (mvGender !== "none" && mvTarget.gender !== mvGender) throw err(409, "soldOut");
      if (!withinShift(date, staffId, start, end)) throw err(409, "outsideShift");
      if (overlaps(date, staffId, start, end, id)) throw err(409, "soldOut");
      // 複数名の予約は残りの担当も、新しい時間帯に対応可能なスタッフから割り当て直す
      const others = bk.people > 1
        ? freeStaffIds(date, start, end, bk.course, mvGender, id).filter((sid) => sid !== staffId).slice(0, bk.people - 1)
        : [];
      if (others.length < bk.people - 1) throw err(409, "soldOut");
      // 指名予約の担当変更は、変更先の指名料で再計算する（指名を受けない相手には移せない）
      if (bk.nominated_staff_id && bk.nominated_staff_id !== staffId) {
        const pr = profileOf(mvTarget);
        if (!pr.personalNomination) throw err(409, "staffUnavailable");
        bk.nominated_staff_id = mvTarget.id;
        bk.nominated_staff_name = pr.nickname || mvTarget.name;
        bk.nomination_fee = Number(pr.nominationFee) || 0;
      }
      bk.start_at = minToMs(date, start);
      bk.end_at = minToMs(date, end);
      const late = start >= 1320 ? 2000 * bk.people : 0;
      bk.total = bk.base_price * bk.people + late + (bk.nomination_fee || 0);
      ev.assignments = ev.assignments.filter((a) => a.booking_id !== id);
      for (const sid of [staffId, ...others]) ev.assignments.push({ booking_id: id, staff_id: sid });
      queueChangeMails(bk); // 変更通知＋リマインド再登録（双方）
      bump();
      return { ok: true };
    }
    case "createBooking": {
      checkRevision();
      const { staffId, start, course, people, consent } = body;
      const c = getCourse(course);
      const cbTarget = state.staff.find((s) => s.id === staffId);
      if (!consent || !c || !cbTarget) throw err(400, "invalid");
      if (cbTarget.locked) throw err(409, "soldOut");            // 鍵中のスタッフには入れられない
      if (!staffCanDo(cbTarget, course)) throw err(409, "soldOut"); // 対応可能メニュー外は不可
      const cbGender = courseGender(course);
      if (cbGender !== "none" && cbTarget.gender !== cbGender) throw err(409, "soldOut");
      const end = start + c.minutes;
      if (!withinShift(date, staffId, start, end)) throw err(409, "outsideShift");
      if (overlaps(date, staffId, start, end)) throw err(409, "soldOut");
      const ev = ensureEvents(date);
      state.bookingSerial++;
      const id = "bk-new-" + state.bookingSerial;
      const n = Number(people) || 1;
      // 複数名の予約は、対応可能で空いているスタッフを人数分確保する
      const cbOthers = n > 1
        ? freeStaffIds(date, start, end, course, cbGender).filter((sid) => sid !== staffId).slice(0, n - 1)
        : [];
      if (cbOthers.length < n - 1) throw err(409, "soldOut");
      ev.bookings.push({
        id, reference: "DM" + String(state.bookingSerial).padStart(6, "0"),
        service_date: date, status: "confirmed",
        start_at: minToMs(date, start), end_at: minToMs(date, end),
        people: n, course, course_name: c.name,
        name: String(body.name || "（店頭受付）"), email: String(body.email || ""), phone: String(body.phone || ""),
        comment: String(body.comment || ""),
        total: c.price * n + (start >= 1320 ? 2000 * n : 0), base_price: c.price,
        nomination_fee: 0, nominated_staff_id: null, nominated_staff_name: null,
        staff: "none", customer_token: null,
      });
      state.bookingIndex.set(id, date);
      for (const sid of [staffId, ...cbOthers]) ev.assignments.push({ booking_id: id, staff_id: sid });
      queueBookingMails(ev.bookings.find((b) => b.id === id));
      bump();
      return { ok: true };
    }
    case "cancel": {
      checkRevision();
      const ev = ensureEvents(date);
      const bk = ev.bookings.find((b) => b.id === body.id && b.status === "confirmed");
      if (!bk) throw err(404, "notFound");
      bk.status = "cancelled";
      // 担当割当をすべて外して枠を空ける（複数名予約は全担当分）
      ev.assignments = ev.assignments.filter((a) => a.booking_id !== bk.id);
      queueCancelMails(bk); // 取消通知（双方）＋未送信リマインドの破棄
      bump();
      return { ok: true };
    }
    case "toggle": {
      checkRevision();
      day.enabled = !!body.enabled;
      bump();
      return { ok: true };
    }
    case "staff": {
      const p = body;
      if (!p.id || !p.name || ![`male`, `female`].includes(p.gender)) throw err(400, "invalid");
      const profile = { ...(p.profile || {}) };
      delete profile.nominationFeePending;
      if (p.photo) {
        state.photos.set(p.id, p.photo);
        profile.imageKey = "uploaded";
      } else if (p.photo === null) {
        state.photos.delete(p.id);
        profile.imageKey = "";
      }
      const prevStaff = state.staff.find((x) => x.id === p.id);
      const rec = {
        id: p.id,
        name: String(p.name),
        gender: p.gender,
        active: p.active ? 1 : 0,
        locked: prevStaff?.locked ?? 0,
        courses: JSON.stringify(p.allCourses ? [] : p.courses || []),
        profile: JSON.stringify(profile),
        sort_order: Number(p.sortOrder) || 0,
        profile_revision: (Number(p.staffRevision) || 0) + 1,
      };
      const idx = state.staff.findIndex((s) => s.id === p.id);
      if (idx >= 0) state.staff[idx] = rec; else state.staff.push(rec);
      // 対応可能メニューから外れたメニューの予約が今後入っている場合は、
      // 予約はそのまま維持しつつ管理画面に警告を返す（勝手に削除・変更しない）
      const newCourses = JSON.parse(rec.courses);
      const affected = [];
      if (newCourses.length) {
        const today = todayJst();
        for (const [d, ev2] of state.events) {
          if (d < today) continue;
          for (const b of ev2.bookings) {
            if (b.status !== "confirmed") continue;
            if (!ev2.assignments.some((a) => a.booking_id === b.id && a.staff_id === rec.id)) continue;
            if (!newCourses.includes(b.course)) affected.push(`${fmtDateJa(d)} ${fmtTime(d, b.start_at)} ${b.reference}`);
          }
        }
      }
      if (affected.length) {
        return {
          ok: true,
          warning: `保存しました。ただし、対応可能メニューから外したメニューの予約が ${affected.length}件 入っています。\n` +
            affected.slice(0, 5).join("\n") + (affected.length > 5 ? "\nほか" : "") +
            "\n既存の予約はそのまま維持されます。必要に応じて担当変更または取消をしてください。",
        };
      }
      return { ok: true };
    }
    case "checkout": {
      // お会計（精算）の登録。金額は値引後の額を予約に記録する
      const ev = ensureEvents(date);
      const bk = ev.bookings.find((b) => b.reference === String(body.reference) && b.status === "confirmed");
      if (!bk) throw err(404, "notFound");
      const amount = Math.floor(Number(body.amount));
      if (!(Number.isFinite(amount) && amount >= 0)) throw err(400, "invalid");
      bk.paid_amount = amount;
      bk.paid_at = Date.now();
      bump();
      return { ok: true };
    }
    case "staffDelete": {
      // スタッフの削除。予約（昨日以降の確定分）が残っている場合は削除しない。
      // シフト・休憩・業務・写真・受付停止設定はスタッフと一緒に削除する。
      const st = state.staff.find((x) => x.id === body.staffId);
      if (!st) throw err(404, "notFound");
      const today = todayJst();
      for (const [d, ev2] of state.events) {
        if (d < addDays(today, -1)) continue;
        const has = ev2.bookings.some((b) => b.status === "confirmed" &&
          ev2.assignments.some((a) => a.booking_id === b.id && a.staff_id === st.id));
        if (has) throw err(409, "hasBookings");
      }
      state.staff = state.staff.filter((x) => x.id !== st.id);
      for (const [d, list] of state.shifts) state.shifts.set(d, list.filter((x) => x.staff_id !== st.id));
      for (const ev2 of state.events.values()) {
        ev2.blocks = ev2.blocks.filter((b) => b.staff_id !== st.id);
        ev2.assignments = ev2.assignments.filter((a) => a.staff_id !== st.id);
      }
      state.photos.delete(st.id);
      bump();
      return { ok: true };
    }
    case "lockStaff": {
      const st = state.staff.find((x) => x.id === body.staffId);
      if (!st) throw err(400, "invalid");
      st.locked = body.locked ? 1 : 0;
      bump();
      return { ok: true, locked: st.locked };
    }
    case "retryMail": {
      // 送信失敗したメールを再送信キューへ戻す
      for (const m of state.mails) {
        if (m.status === "failed") { m.status = "pending"; m.error = null; m.scheduledAt = Date.now(); }
      }
      deliverDueMails();
      return { ok: true };
    }
    default:
      throw err(400, "invalid");
  }
}


// ---- リマインド・通知メール（デモ：実送信はせず、内容を生成して保存する） ----

const STORE_NAME = "CN Ueno health & beauty";
const STORE_MAIL = "info@cn-salon-ueno.example.jp";

function fmtDateJa(date) {
  const w = ["日", "月", "火", "水", "木", "金", "土"][new Date(date + "T00:00:00Z").getUTCDay()];
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日（${w}）`;
}
function fmtTime(date, ms) {
  const min = msToMin(date, ms);
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// 参考画像と同じ見た目のHTMLメールを本文テキストから組み立てる。
// Gmail・iPhone・Android等で崩れないよう、テーブル＋インラインCSSのみで構成し、
// 画像に無い要素は足さない（本文・順序・改行はテキスト版と完全に同一）。
function mailHtml(body) {
  const escH = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const A = 'style="color:#1a73e8;text-decoration:underline;word-break:break-all;"';
  const lines = String(body).split("\n").map((line) => {
    if (line === MAIL_ADDR) {
      // 店舗住所は参考画像と同じく地図リンク（青文字）にする
      return '<a href="https://maps.google.com/?q=' + encodeURIComponent(MAIL_ADDR) + '" ' + A + ">" + escH(MAIL_ADDR) + "</a>";
    }
    let h = escH(line);
    h = h.replace(/(https?:\/\/[^\s,]+)/g, (u) => '<a href="' + u + '" ' + A + ">" + u + "</a>");
    h = h.replace(/([\w.+-]+@[\w-]+\.[\w.]+)/g, (m) => '<a href="mailto:' + m + '" ' + A + ">" + m + "</a>");
    return h;
  });
  return '<!DOCTYPE html><html><head><meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"/></head>' +
    '<body style="margin:0;padding:0;background:#ffffff;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="left">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">' +
    '<tr><td style="padding:18px 16px;' +
    "font-family:'Hiragino Kaku Gothic ProN','Hiragino Sans',Meiryo,-apple-system,Roboto,Arial,sans-serif;" +
    'font-size:16px;line-height:1.75;color:#202124;text-align:left;word-break:break-word;">' +
    lines.join("<br/>") +
    "</td></tr></table></td></tr></table></body></html>";
}

function queueMail(kind, type, to, subject, body, scheduledAt, bookingId) {
  state.mailSerial++;
  state.mails.push({
    id: "mail-" + state.mailSerial,
    kind,                 // "customer" | "store"
    type,                 // "confirm" | "notify" | "remind" | "change" | "cancel"
    to, subject, body,
    html: mailHtml(body), // 実際に届くHTMLメール（参考画像と同一の見た目）
    scheduledAt,          // この時刻になったら送信処理を行う
    createdAt: Date.now(),
    bookingId: bookingId || null,
    status: "pending",    // pending（送信予定）→ sending（処理中）→ sent／failed
    sentAt: null,
    error: null,
  });
}

// 送信時刻を過ぎたメールを送信処理する（デモの配信サービスは即時に応答する）。
// 「送信済み」への遷移は配信サービスの成功応答を確認してから行い、
// 一度 sent／failed になったメールは二度と再送しない（二重送信防止）。
function deliverDueMails() {
  const now = Date.now();
  for (const m of state.mails) {
    if (m.status !== "pending" || m.scheduledAt > now) continue;
    m.status = "sending";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to)) {
      m.status = "failed";
      m.error = "宛先メールアドレスの形式が不正のため、配信サービスに拒否されました";
      continue;
    }
    const cfg = realSendAllowed(m.to);
    if (cfg) {
      // 実送信（mail-config.jsonのallowToに載っている宛先だけ）。
      // 結果が返るまで「送信処理中」。成功応答を確認してから「送信済み」にする
      smtpSend(cfg, m, (err) => {
        if (m.status !== "sending") return; // 二重送信防止
        if (err) {
          m.status = "failed";
          m.error = "実送信エラー: " + err.message;
        } else {
          m.status = "sent";
          m.sentAt = Date.now();
          m.real = true; // 実際に配信された印
        }
      });
      continue;
    }
    m.status = "sent";
    m.sentAt = now;
  }
}

const MAIL_STORE = "Ueno spa&massage CN Health & Beauty SALON";
const MAIL_ADDR = "東京都台東区上野４丁目８－６プラザＵビル　3階";
const MAIL_TEL = "03-6806-0324";
const SEP = "------------------------------";
const origin = () => process.env.DEMO_ORIGIN || "http://127.0.0.1:5520";

// コースのカテゴリ表示（メールの「　整体 全身整体 60分」の先頭部分）
function courseCategory(courseId) {
  const p = String(courseId).slice(0, 6);
  return {
    "364321": "キャンペーン", "364323": "整体", "364324": "小顔矯正", "364325": "矯正整体",
    "364326": "オイル", "364327": "フット", "364328": "フェイシャル",
    "364329": "ハイパーナイフ", "364331": "ルーム",
  }[p] || "メニュー";
}
function displayId(bk) {
  return bk.display_id || bk.reference;
}
// 予約内容ブロック（-----で挟む部分。改行も画像どおり）
function mailBlock(bk) {
  const d = bk.service_date;
  return [
    SEP,
    `${d}（${["日","月","火","水","木","金","土"][new Date(d + "T00:00:00Z").getUTCDay()]}）　${fmtTime(d, bk.start_at)}〜`,
    `予約ID ${displayId(bk)}`,
    `　${courseCategory(bk.course)} ${bk.course_name}`,
    "",
    `合計 ${bk.total.toLocaleString("ja-JP")} 円`,
    SEP,
  ].join("\n");
}
// 店舗向けはお客様情報付きのブロック
function mailBlockStore(bk) {
  const d = bk.service_date;
  return [
    SEP,
    `${d}（${["日","月","火","水","木","金","土"][new Date(d + "T00:00:00Z").getUTCDay()]}）　${fmtTime(d, bk.start_at)}〜`,
    `予約ID ${displayId(bk)}`,
    `　${courseCategory(bk.course)} ${bk.course_name}`,
    "",
    `お名前 ${bk.name || "（未入力）"}`,
    `TEL ${bk.phone || "（未入力）"}`,
    `メール ${bk.email || "（未入力）"}`,
    `ご要望 ${bk.comment || "なし"}`,
    "",
    `合計 ${bk.total.toLocaleString("ja-JP")} 円`,
    SEP,
  ].join("\n");
}
const MAIL_COMMON = [
  "",
  "",
  "■ご予約内容に関するご質問やご不明な点がございましたら、ご利用の店舗までお問い合わせください。",
  "",
  "■このサービスは株式会社EPARKが運営・提供しております。",
  "EPARKはサービスのみを提供するものであり、店舗運営者との間のトラブル・紛争については一切責任を負いかねます。",
  "",
  "■このメールは送信専用のメールアドレスから配信されています。",
  "ご返信いただいても返信内容の確認およびご返答ができませんのでご了承ください。",
  "",
  "■このメールにお心当たりがない場合には、お手数ですが、システムサポートまでお知らせください。",
  "システムサポート：pm-support@epark-r.jp",
  SEP,
  MAIL_STORE,
  MAIL_ADDR,
  MAIL_TEL,
].join("\n");

// 予約確定時：完了メール（お客様）＋新規予約通知（店舗）＋双方のリマインドを予約する
function queueBookingMails(bk) {
  const now = Date.now();
  const cancelUrl = bk.customer_token
    ? `${origin()}/mypage?id=${bk.id}&token=${bk.customer_token}`
    : `${origin()}/mypage`;
  const customerBody = (lead) => [
    lead,
    "今回のご予約内容は以下のとおりです。",
    "",
    mailBlock(bk),
    "ご来店を心よりお待ちしております。",
    "",
    "■開始時間に遅れる場合は、お電話にてご連絡ください。",
    MAIL_TEL,
    "",
    "■ご予約内容の変更は、一度予約のキャンセルを行っていただき、再度予約を取り直してください。",
    "※混雑状況によっては、再予約ができないことがございます。あらかじめご了承ください。",
    "予約のキャンセルはこちら ⇒",
    `${cancelUrl},,`,
  ].join("\n") + MAIL_COMMON;
  if (bk.email) {
    queueMail("customer", "confirm", bk.email,
      `${MAIL_STORE} ご予約内容確認`,
      customerBody(`この度は「${MAIL_STORE}」にご予約いただきありがとうございます。`),
      now, bk.id);
    queueMail("customer", "remind", bk.email,
      `${MAIL_STORE} ご予約リマインド`,
      customerBody(`ご予約日が近づいてまいりましたのでご案内いたします。`),
      Math.max(now, bk.start_at - 24 * 3600e3), bk.id);
  }
  const storeBody = (lead) => [
    lead,
    "ご予約内容は以下のとおりです。",
    "",
    mailBlockStore(bk),
  ].join("\n") + MAIL_COMMON;
  queueMail("store", "notify", STORE_MAIL,
    `${MAIL_STORE} 新規予約のお知らせ（予約ID ${displayId(bk)}）`,
    storeBody(`「${MAIL_STORE}」に新しいご予約が入りました。`),
    now, bk.id);
  queueMail("store", "remind", STORE_MAIL,
    `${MAIL_STORE} 本日のご予約リマインド（予約ID ${displayId(bk)}）`,
    storeBody(`本日のご予約のリマインドです。`),
    Math.max(now, dayStartMs(bk.service_date) + 9 * 3600e3), bk.id);
  deliverDueMails();
}

// 変更・取消時：まだ送信していないリマインドを破棄する（送信済みのものは記録として残す）
function dropPendingReminders(bookingId) {
  deliverDueMails();
  state.mails = state.mails.filter((m) =>
    !(m.bookingId === bookingId && m.type === "remind" && (m.status === "pending" || m.status === "sending")));
}

function queueChangeMails(bk) {
  dropPendingReminders(bk.id);
  const now = Date.now();
  if (bk.email) {
    queueMail("customer", "change", bk.email,
      `${MAIL_STORE} ご予約内容変更のお知らせ`,
      [
        `いつも「${MAIL_STORE}」をご利用いただきありがとうございます。`,
        "この度、以下の内容にご予約を変更いたしましたのでご案内いたします。",
        "",
        mailBlock(bk),
        "ご来店を心よりお待ちしております。",
      ].join("\n") + MAIL_COMMON,
      now, bk.id);
    queueMail("customer", "remind", bk.email,
      `${MAIL_STORE} ご予約リマインド`,
      [
        `ご予約日が近づいてまいりましたのでご案内いたします。`,
        "今回のご予約内容は以下のとおりです。",
        "",
        mailBlock(bk),
        "ご来店を心よりお待ちしております。",
      ].join("\n") + MAIL_COMMON,
      Math.max(now, bk.start_at - 24 * 3600e3), bk.id);
  }
  queueMail("store", "change", STORE_MAIL,
    `${MAIL_STORE} ご予約変更のお知らせ（予約ID ${displayId(bk)}）`,
    [`「${MAIL_STORE}」のご予約が変更されました。`, "変更後のご予約内容は以下のとおりです。", "", mailBlockStore(bk)].join("\n") + MAIL_COMMON,
    now, bk.id);
  queueMail("store", "remind", STORE_MAIL,
    `${MAIL_STORE} 本日のご予約リマインド（予約ID ${displayId(bk)}）`,
    [`本日のご予約のリマインドです。`, "ご予約内容は以下のとおりです。", "", mailBlockStore(bk)].join("\n") + MAIL_COMMON,
    Math.max(now, dayStartMs(bk.service_date) + 9 * 3600e3), bk.id);
  deliverDueMails();
}

function queueCancelMails(bk) {
  dropPendingReminders(bk.id);
  const now = Date.now();
  if (bk.email) {
    queueMail("customer", "cancel", bk.email,
      `${MAIL_STORE} ご予約キャンセルのご案内`,
      [
        `いつも「${MAIL_STORE}」をご利用いただきありがとうございます。`,
        "この度、以下のご予約を取り消しましたのでご案内いたします。",
        "",
        mailBlock(bk),
        "またのご利用を心よりお待ちしております。",
        `${origin()}/cn-ueno-health-and-beauty`,
      ].join("\n") + MAIL_COMMON,
      now, bk.id);
  }
  queueMail("store", "cancel", STORE_MAIL,
    `${MAIL_STORE} ご予約キャンセルのお知らせ（予約ID ${displayId(bk)}）`,
    [`「${MAIL_STORE}」のご予約がキャンセルされました。`, "取り消したご予約内容は以下のとおりです。", "", mailBlockStore(bk)].join("\n") + MAIL_COMMON,
    now, bk.id);
  deliverDueMails();
}

function mailSummary() {
  deliverDueMails();
  const counts = { pending: 0, sending: 0, accepted: 0, failed: 0 };
  for (const m of state.mails) {
    if (m.status === "sent") counts.accepted++;
    else counts[m.status] = (counts[m.status] || 0) + 1;
  }
  return Object.entries(counts).map(([status, count]) => ({ status, count }));
}

// ---- 予約サイト用の公開API（管理画面と同じデータを参照） -----------------

// コース名からの性別指定（予約サイト側と同じ判定）
function courseGender(courseId) {
  const name = getCourse(courseId)?.name || "";
  return name.includes("女性") ? "female" : name.includes("男性") ? "male" : "none";
}

function staffCanDo(st, courseId) {
  const list = JSON.parse(st.courses || "[]");
  return list.length === 0 || list.includes(courseId);
}

// コース名に性別指定がある場合は、リクエストの希望より優先する
// （画面を経由しないPOSTでも、女性コースが男性スタッフに割り当たらないようにする）
function effectivePref(courseId, pref) {
  const g = courseGender(courseId);
  return g !== "none" ? g : pref;
}

function profileOf(st) {
  try { return JSON.parse(st.profile || "{}"); } catch { return {}; }
}

// 指名候補スタッフ一覧（受付中・個人指名あり・コース対応・性別条件）
function nominatableStaff(courseId, genderPref) {
  return state.staff
    .filter((st) => st.active === 1 && !st.locked && staffCanDo(st, courseId))
    .filter((st) => genderPref === "none" || st.gender === genderPref)
    .filter((st) => profileOf(st).personalNomination)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((st) => {
      const pr = profileOf(st);
      return {
        id: st.id,
        name: pr.nickname || st.name,
        nominationFee: Number(pr.nominationFee) || 0,
        revision: st.profile_revision || 0,
        hasPhoto: state.photos.has(st.id),
        message: pr.message || "",
      };
    });
}

// 指定時間帯に施術できるスタッフID一覧
// 対応メニュー→シフト内→休憩・業務→既存予約→受付停止（鍵）をすべて満たす人だけを返す
function freeStaffIds(date, startMin, endMin, courseId, genderPref, ignoreBookingId) {
  const shifts = ensureShifts(date);
  const ev = ensureEvents(date);
  const busy = (staffId) => {
    const items = [
      ...ev.bookings.filter((b) => b.status === "confirmed" && b.id !== ignoreBookingId && ev.assignments.some((a) => a.booking_id === b.id && a.staff_id === staffId)),
      ...ev.blocks.filter((b) => b.staff_id === staffId),
    ];
    return items.some((it) => msToMin(date, it.start_at) < endMin && msToMin(date, it.end_at) > startMin);
  };
  return state.staff
    .filter((st) => st.active === 1 && !st.locked && staffCanDo(st, courseId))
    .filter((st) => genderPref === "none" || st.gender === genderPref)
    .filter((st) => {
      const sh = shifts.find((x) => x.staff_id === st.id);
      return sh && msToMin(date, sh.start_at) <= startMin && endMin <= msToMin(date, sh.end_at);
    })
    .filter((st) => !busy(st.id))
    .map((st) => st.id);
}

function nowMinJst() {
  const t = todayJst();
  return Math.round((Date.now() - dayStartMs(t)) / 60000);
}

function getAvailability(q) {
  const courseId = q.get("course");
  const date = q.get("date");
  const people = Number(q.get("people"));
  const pref = q.get("staff") || "none";
  const staffId = q.get("staffId") || "";
  const course = getCourse(courseId);
  const today = todayJst();
  if (!course || !/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !(people >= 1 && people <= 3) ||
      !["none", "male", "female"].includes(pref)) throw err(400, "invalid");
  const dur = course.minutes;
  const gpref = effectivePref(courseId, pref); // コース名の性別指定を優先
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(date, i);
    const day = ensureDay(d);
    const open = day.enabled && d >= today && d <= addDays(today, 84);
    const slots = [];
    for (let m = 600; m <= 1500; m += 10) {
      // 受付対象外（受付停止日・過ぎた時間）は枠自体を返さず、画面では「－」表示にする
      if (!open) continue;
      if (d === today && m <= nowMinJst()) continue;
      const free = freeStaffIds(d, m, m + dur, courseId, gpref);
      const ok = free.length >= people && (!staffId || free.includes(staffId));
      slots.push({ minute: m, available: ok, start: minToMs(d, m) });
    }
    days.push({ date: d, enabled: day.enabled, slots });
  }
  return { staff: nominatableStaff(courseId, gpref), days };
}

function createPublicBooking(body) {
  const course = getCourse(body.course);
  const date = body.date;
  const people = Number(body.people);
  const pref = ["none", "male", "female"].includes(body.staff) ? body.staff : "none";
  const staffId = String(body.staffId || "");
  if (String(body.website || "")) throw err(400, "invalid"); // ボット対策の隠し欄
  if (!course || !/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !(people >= 1 && people <= 3) ||
      body.consent !== true || !String(body.name || "").trim() || !String(body.email || "").trim() ||
      !String(body.phone || "").trim()) throw err(400, "invalid");
  // フリーメッセージ欄の設定（表示・必須・文字数）はサーバー側でも強制する
  const fm = state.settings.freeMessage;
  let comment = fm.visible ? String(body.comment || "").slice(0, fm.maxLength || 2000) : "";
  if (fm.visible && fm.required && !comment.trim()) throw err(400, "invalid");
  const today = todayJst();
  if (date < today || date > addDays(today, 84)) throw err(400, "invalid");
  if (!ensureDay(date).enabled) throw err(409, "soldOut");
  const m = Math.round((Number(body.start) - dayStartMs(date)) / 60000);
  if (!(Number.isInteger(m) && m >= 600 && m <= 1500 && m % 5 === 0)) throw err(400, "invalid");
  if (date === today && m <= nowMinJst()) throw err(409, "soldOut");

  // 多重送信は同じ結果を返す
  const rk = String(body.requestKey || "");
  if (rk && state.requestKeys.has(rk)) return state.requestKeys.get(rk);

  const gpref = effectivePref(body.course, pref); // コース名の性別指定を優先
  let nominated = null;
  if (staffId) {
    nominated = nominatableStaff(body.course, gpref).find((st) => st.id === staffId);
    if (!nominated) throw err(409, "staffUnavailable");
    if (Number(body.expectedNominationFee) !== nominated.nominationFee) throw err(409, "priceChanged");
  }
  const dur = course.minutes;
  const free = freeStaffIds(date, m, m + dur, body.course, gpref);
  if (free.length < people || (staffId && !free.includes(staffId))) throw err(409, "soldOut");

  const assignee = staffId || free[0];
  state.bookingSerial++;
  const id = "web-" + state.bookingSerial + "-" + Math.random().toString(16).slice(2, 8);
  const token = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  const late = m >= 1320 ? 2000 * people : 0;
  const fee = nominated ? nominated.nominationFee : 0;
  const ev = ensureEvents(date);
  ev.bookings.push({
    id, reference: "2472" + String(state.bookingSerial).padStart(5, "0"),
    service_date: date, status: "confirmed",
    start_at: minToMs(date, m), end_at: minToMs(date, m + dur),
    people, course: body.course, course_name: course.name,
    name: String(body.name).slice(0, 120), email: String(body.email).slice(0, 254),
    phone: String(body.phone).slice(0, 40), comment,
    total: course.price * people + late + fee, base_price: course.price,
    nomination_fee: fee, nominated_staff_id: nominated ? nominated.id : null,
    nominated_staff_name: nominated ? nominated.name : null,
    staff: pref, customer_token: token, language: String(body.language || "ja"),
  });
  // 複数名の予約は、対応可能で空いているスタッフを人数分確保する（空き判定と同じ条件）
  const coAssignees = free.filter((sid) => sid !== assignee).slice(0, people - 1);
  for (const sid of [assignee, ...coAssignees]) ev.assignments.push({ booking_id: id, staff_id: sid });
  state.bookingIndex.set(id, date);
  queueBookingMails(ev.bookings.find((b) => b.id === id)); // 完了メール＋通知＋双方のリマインド
  ensureDay(date).version++;
  const result = { id, token };
  if (rk) state.requestKeys.set(rk, result);
  return result;
}

function getPublicBooking(id, token) {
  const date = state.bookingIndex.get(id || "");
  if (!date) throw err(404, "notFound");
  const bk = ensureEvents(date).bookings.find((b) => b.id === id);
  if (!bk || !bk.customer_token || bk.customer_token !== token) throw err(404, "notFound");
  return {
    booking: {
      id: bk.id, reference: bk.reference, displayId: String(displayId(bk)), status: bk.status,
      language: bk.language || "ja", serviceDate: bk.service_date,
      start: bk.start_at, courseId: bk.course, courseName: bk.course_name,
      name: bk.name, people: bk.people, staff: bk.staff || "none",
      nominatedStaffName: bk.nominated_staff_name, nominationFee: bk.nomination_fee,
      total: bk.total,
    },
    notifications: (deliverDueMails(), state.mails)
      .filter((m) => m.bookingId === bk.id && (m.type === "confirm" || m.type === "notify"))
      .map((m) => ({ kind: m.kind, status: m.status === "sent" ? "accepted" : m.status === "failed" ? "failed" : "pending" })),
  };
}

// ---- 営業実績（日次管理）：予約・シフトの実データから集計する ----------

function confirmedBookings(date) {
  return ensureEvents(date).bookings.filter((b) => b.status === "confirmed");
}

// それ以前の日付に同じメールアドレスの予約があれば「リピータ」とみなす
function isRepeat(date, email) {
  if (!email) return false;
  for (const [d, ev] of state.events) {
    if (d >= date) continue;
    if (ev.bookings.some((b) => b.email === email)) return true;
  }
  return false;
}

function dayCounts(date) {
  const list = confirmedBookings(date);
  let visitors = 0, newCount = 0, repeatCount = 0, nominated = 0, online = 0;
  for (const b of list) {
    visitors += b.people;
    if (isRepeat(date, b.email)) repeatCount += b.people; else newCount += b.people;
    if (b.nominated_staff_id) nominated += b.people;
    if (String(b.id).startsWith("web-")) online++;
  }
  return { visitors, newCount, repeatCount, nominated, online, bookings: list.length };
}

function reportStats(date) {
  const list = confirmedBookings(date);
  const gross = list.reduce((s, b) => s + b.total, 0);
  const net = Math.round(gross / 1.1);
  const counts = dayCounts(date);
  // 当月累計（データがある日だけ集計。架空データは生成しない）
  const monthStart = date.slice(0, 8) + "01";
  let cumGross = 0, cumNet = 0;
  for (const [d, ev] of state.events) {
    if (d >= monthStart && d <= date) {
      const g = ev.bookings.filter((b) => b.status === "confirmed").reduce((s, b) => s + b.total, 0);
      cumGross += g;
    }
  }
  cumNet = Math.round(cumGross / 1.1);
  const dayN = Number(date.slice(8));
  const daysInMonth = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
  const forecast = dayN ? Math.round(cumNet / dayN * daysInMonth) : 0;
  // シフト状況
  const shifts = ensureShifts(date);
  const shiftMin = shifts.reduce((s, x) => s + (x.end_at - x.start_at) / 60000, 0);
  const ev = ensureEvents(date);
  let treatMin = 0;
  for (const b of list) {
    const n = ev.assignments.filter((a) => a.booking_id === b.id).length || 1;
    treatMin += (b.end_at - b.start_at) / 60000 * n;
  }
  const tomorrow = addDays(date, 1);
  const names = {};
  for (const st of state.staff) names[st.id] = st.name;
  const tomorrowShifts = ensureShifts(tomorrow)
    .map((x) => ({
      name: names[x.staff_id] || "",
      label: `${Number(tomorrow.slice(8))}日${fmtTime(tomorrow, x.start_at)}〜` +
        (msToMin(tomorrow, x.end_at) >= 1440
          ? `${Number(addDays(tomorrow, 1).slice(8))}日${fmtTime(addDays(tomorrow, 1), x.end_at)}`
          : `${Number(tomorrow.slice(8))}日${fmtTime(tomorrow, x.end_at)}`),
    }))
    .filter((x) => x.name);
  return {
    date,
    today: {
      salesNet: net, salesGross: gross, profit: net,
      ...counts,
      avgSpend: counts.visitors ? Math.round(gross / counts.visitors) : 0,
      cumNet, cumGross, forecast,
      shiftStaff: shifts.length, shiftMin, treatMin,
      utilization: shiftMin ? Math.round(treatMin / shiftMin * 1000) / 10 : 0,
    },
    tomorrow: { ...dayCounts(tomorrow), shifts: tomorrowShifts },
    staffNames: state.staff.map((s) => s.name),
    saved: state.reports.get(date) || null,
  };
}

// server.js から呼ばれる入口。処理した場合は true を返す。
function handleDemoApi(req, res, url) {
  if (url.pathname === "/api/demo/staff-photo") {
    const dataUrl = state.photos.get(url.searchParams.get("id") || "");
    if (!dataUrl) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "notFound" }));
      return true;
    }
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(dataUrl);
    if (!m) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalidImage" }));
      return true;
    }
    res.writeHead(200, { "Content-Type": m[1], "Cache-Control": "no-store" });
    res.end(Buffer.from(m[2], "base64"));
    return true;
  }

  // ---- 予約サイト用の公開エンドポイント ----
  if (url.pathname === "/api/availability" && (req.method === "GET" || req.method === "HEAD")) {
    try {
      const data = getAvailability(url.searchParams);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(data));
    } catch (e) {
      res.writeHead(e.status || 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.status ? e.message : "unavailable" }));
    }
    return true;
  }
  if (url.pathname === "/api/staff" && (req.method === "GET" || req.method === "HEAD")) {
    const courseId = url.searchParams.get("course");
    const pref = url.searchParams.get("staff") || "none";
    if (!getCourse(courseId) || !["none", "male", "female"].includes(pref)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid" }));
      return true;
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({ staff: nominatableStaff(courseId, effectivePref(courseId, pref)) }));
    return true;
  }
  if (url.pathname === "/api/staff/photo") {
    const dataUrl = state.photos.get(url.searchParams.get("id") || "");
    const m2 = dataUrl && /^data:(image\/[a-z+]+);base64,(.*)$/.exec(dataUrl);
    if (!m2) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "notFound" }));
      return true;
    }
    res.writeHead(200, { "Content-Type": m2[1], "Cache-Control": "no-store" });
    res.end(Buffer.from(m2[2], "base64"));
    return true;
  }
  if (url.pathname === "/api/bookings/cancel" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on("end", () => {
      try {
        const b = JSON.parse(raw || "{}");
        const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        const date = state.bookingIndex.get(String(b.id || ""));
        if (!date) throw err(404, "notFound");
        const ev2 = ensureEvents(date);
        const bk = ev2.bookings.find((x) => x.id === b.id);
        if (!bk || !bk.customer_token || bk.customer_token !== token) throw err(404, "notFound");
        if (bk.status !== "confirmed") throw err(409, "alreadyCancelled");
        bk.status = "cancelled";
        ev2.assignments = ev2.assignments.filter((a) => a.booking_id !== bk.id);
        queueCancelMails(bk);
        ensureDay(date).version++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, status: "cancelled" }));
      } catch (e) {
        res.writeHead(e.status || 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.status ? e.message : "unavailable" }));
      }
    });
    return true;
  }
  if (url.pathname === "/api/bookings") {
    if (req.method === "GET" || req.method === "HEAD") {
      try {
        const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        const data = getPublicBooking(url.searchParams.get("id"), token);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(req.method === "HEAD" ? undefined : JSON.stringify(data));
      } catch (e) {
        res.writeHead(e.status || 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.status ? e.message : "unavailable" }));
      }
      return true;
    }
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on("end", () => {
        try {
          const result = createPublicBooking(JSON.parse(raw || "{}"));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(e.status || 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.status ? e.message : "unavailable" }));
        }
      });
      return true;
    }
    res.writeHead(405);
    res.end();
    return true;
  }

  // メニューの写真（メニュー一覧で登録した画像を配信する）
  if (url.pathname === "/api/demo/course-photo") {
    const dataUrl = coursePhotos.get(url.searchParams.get("id") || "");
    const mc = dataUrl && /^data:(image\/[a-z+]+);base64,(.*)$/.exec(dataUrl);
    if (!mc) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "notFound" }));
      return true;
    }
    res.writeHead(200, { "Content-Type": mc[1], "Cache-Control": "no-store" });
    res.end(Buffer.from(mc[2], "base64"));
    return true;
  }

  // メニュー一覧（管理画面から追加・変更・削除・写真登録ができる）
  if (url.pathname === "/api/demo/courses") {
    if (req.method === "GET" || req.method === "HEAD") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ courses: courseListJson() }));
      return true;
    }
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 4e6) req.destroy(); });
      req.on("end", () => {
        try {
          const b = JSON.parse(raw || "{}");
          const name = String(b.name || "").trim().slice(0, 120);
          const price = Math.floor(Number(b.price));
          const minutes = Math.floor(Number(b.minutes));
          const validVals = () => {
            if (!name) throw err(400, "invalid");
            if (!(Number.isFinite(price) && price >= 0 && price <= 1000000)) throw err(400, "invalid");
            if (!(Number.isFinite(minutes) && minutes >= 10 && minutes <= 600)) throw err(400, "invalid");
          };
          // photo: dataURL文字列=登録／空文字=削除／未指定=変更なし
          const applyPhoto = (cid) => {
            if (typeof b.photo !== "string") return;
            if (b.photo === "") { coursePhotos.delete(cid); return; }
            if (!/^data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+$/.test(b.photo) || b.photo.length > 3e6) {
              throw err(400, "invalidPhoto");
            }
            coursePhotos.set(cid, b.photo);
          };
          if (b.action === "create") {
            validVals();
            const id = "900000-" + String(++courseSerial).padStart(7, "0");
            courseStore.set(id, { id, name, price, minutes });
            applyPhoto(id);
          } else if (b.action === "update") {
            const c = courseStore.get(String(b.id || ""));
            if (!c) throw err(404, "notFound");
            validVals();
            applyPhoto(c.id);
            c.name = name; c.price = price; c.minutes = minutes;
          } else if (b.action === "delete") {
            const cid = String(b.id || "");
            if (!courseStore.has(cid)) throw err(404, "notFound");
            // 昨日以降の確定予約が残っているメニューは削除できない
            const today = todayJst();
            for (const [d, ev2] of state.events) {
              if (d < addDays(today, -1)) continue;
              if (ev2.bookings.some((x) => x.status === "confirmed" && x.course === cid)) throw err(409, "hasBookings");
            }
            courseStore.delete(cid);
            coursePhotos.delete(cid);
          } else {
            throw err(400, "invalid");
          }
          ensureDay(todayJst()).version++;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, courses: courseListJson() }));
        } catch (e) {
          res.writeHead(e.status || 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.status ? e.message : "invalid" }));
        }
      });
      return true;
    }
    res.writeHead(405);
    res.end();
    return true;
  }

  // 日付ピッカーのカレンダー用：日ごとのシフト・予約状況
  if (url.pathname === "/api/demo/calendar" && (req.method === "GET" || req.method === "HEAD")) {
    const from = url.searchParams.get("from") || todayJst();
    const n = Math.min(62, Math.max(1, Number(url.searchParams.get("days")) || 42));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid" }));
      return true;
    }
    const days = [];
    for (let i = 0; i < n; i++) {
      const d = addDays(from, i);
      days.push({
        date: d,
        shifts: ensureShifts(d).length,
        bookings: ensureEvents(d).bookings.filter((b) => b.status === "confirmed").length,
        enabled: ensureDay(d).enabled,
      });
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({ days }));
    return true;
  }

  // 営業実績（日次管理）の集計と日報の保存
  if (url.pathname === "/api/demo/report") {
    if (req.method === "GET" || req.method === "HEAD") {
      const date = url.searchParams.get("date") || todayJst();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid" }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(reportStats(date)));
      return true;
    }
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
      req.on("end", () => {
        try {
          const b = JSON.parse(raw || "{}");
          const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : todayJst();
          const rec = state.reports.get(date) || {};
          for (const k of ["weather", "todayPlan", "review", "tomorrowPlan", "manager"]) {
            if (k in b) rec[k] = String(b[k] || "").slice(0, 2000);
          }
          if (b.send) rec.sentAt = Date.now();
          state.reports.set(date, rec);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, saved: rec }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid" }));
        }
      });
      return true;
    }
    res.writeHead(405);
    res.end();
    return true;
  }

  // フリーメッセージ欄などの設定（管理画面から変更し、予約サイトに即時反映）
  if (url.pathname === "/api/demo/settings") {
    if (req.method === "GET" || req.method === "HEAD") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(state.settings));
      return true;
    }
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
      req.on("end", () => {
        try {
          const b = JSON.parse(raw || "{}").freeMessage || {};
          const fm = state.settings.freeMessage;
          fm.visible = b.visible !== false;
          fm.required = b.required === true;
          fm.label = String(b.label || "").slice(0, 60);
          fm.placeholder = String(b.placeholder || "").slice(0, 200);
          fm.description = String(b.description || "").slice(0, 300);
          const len = Number(b.maxLength);
          fm.maxLength = Number.isFinite(len) && len >= 1 && len <= 2000 ? Math.floor(len) : 2000;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(state.settings));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid" }));
        }
      });
      return true;
    }
    res.writeHead(405);
    res.end();
    return true;
  }

  if (url.pathname === "/api/demo/locks" && (req.method === "GET" || req.method === "HEAD")) {
    const locks = state.staff.map((st) => ({ id: st.id, name: st.name, locked: st.locked ? 1 : 0 }));
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({ locks }));
    return true;
  }
  if (url.pathname === "/api/demo/mails" && (req.method === "GET" || req.method === "HEAD")) {
    deliverDueMails();
    const mails = [...state.mails].sort((a, b) => b.createdAt - a.createdAt);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({ mails }));
    return true;
  }

  if (url.pathname !== "/api/demo/schedule") return false;

  if (req.method === "GET" || req.method === "HEAD") {
    const date = url.searchParams.get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid" }));
      return true;
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify(getSchedule(date)));
    return true;
  }

  if (req.method === "POST") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try {
        const result = postSchedule(JSON.parse(raw || "{}"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(e.status || 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.status ? e.message : "unavailable" }));
      }
    });
    return true;
  }

  res.writeHead(405);
  res.end();
  return true;
}

module.exports = { handleDemoApi };
