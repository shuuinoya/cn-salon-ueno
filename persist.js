// 永続化層（このシステムの「データベース」）。
// demo-api.js のメモリ上の状態（予約・顧客・シフト・回数券・設定・アカウント等）を
// ディスクへ安全に保存し、起動時に復元する。業務ロジックには一切関知しない。
//
// 設計方針：
// ・書き込みは「一時ファイルへ全書き→fsyncなしrename」の原子的置換（途中で電源が落ちても
//   直前の完全なファイルが必ず残る）。置換前の版は .bak として1世代保持（誤操作からの復旧用）
// ・読み込みで壊れたファイルを検出したら、.broken-<日時> に退避して初期データで起動
//   （システム全体を停止させない）。.bak が読めればそちらを使う
// ・保存は3秒ごとに内容が変わったときだけ（差分なしならディスクに触れない）
// ・Map / Set はタグ付きJSONで可逆に保存する
// ・ファイルは所有者のみ読み書き可（0600。顧客情報を含むため）
"use strict";

const fs = require("fs");
const path = require("path");

const TAG_MAP = "__pm_map__";
const TAG_SET = "__pm_set__";

function replacer(key, value) {
  if (value instanceof Map) return { [TAG_MAP]: [...value.entries()] };
  if (value instanceof Set) return { [TAG_SET]: [...value.values()] };
  return value;
}
function reviver(key, value) {
  if (value && typeof value === "object") {
    if (Array.isArray(value[TAG_MAP])) return new Map(value[TAG_MAP]);
    if (Array.isArray(value[TAG_SET])) return new Set(value[TAG_SET]);
  }
  return value;
}

// 保存の有効判定：
// ・本番（PORT未指定＝5520で起動）は常に保存する
// ・テスト・開発用に PORT を明示した起動は初期データで動く（本番データと混ざらない）
// ・DEMO_PERSIST=1 で強制ON、DEMO_EPHEMERAL=1 で強制OFF（環境の明示的な切り替え）
function persistenceEnabled() {
  if (process.env.DEMO_EPHEMERAL === "1") return false;
  if (process.env.DEMO_PERSIST === "1") return true;
  return !process.env.PORT || process.env.PORT === "5520";
}

function dataFile() {
  return process.env.DEMO_DATA || path.join(__dirname, "data", "state.json");
}

// 起動時の復元。成功時は {data, file}、保存無効・ファイルなしは {data: null}
function loadSnapshot() {
  if (!persistenceEnabled()) return { enabled: false, data: null };
  const file = dataFile();
  for (const candidate of [file, file + ".bak"]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const data = JSON.parse(fs.readFileSync(candidate, "utf8"), reviver);
      if (!data || typeof data !== "object" || !data.state) throw new Error("形式が不正");
      if (candidate !== file) console.log("（データ復旧）バックアップ " + path.basename(candidate) + " から復元しました");
      return { enabled: true, data, file };
    } catch (e) {
      // 壊れたファイルは退避してシステムは止めない（あとで中身を調査できる）
      try {
        const broken = candidate + ".broken-" + new Date().toISOString().replace(/[:.]/g, "-");
        fs.renameSync(candidate, broken);
        console.log("（警告）保存データを読めませんでした。" + path.basename(broken) + " に退避し、次の候補で起動します: " + e.message);
      } catch {}
    }
  }
  return { enabled: true, data: null, file };
}

// 二重起動を検知して終了する場合など、「このプロセスは所有者ではない」と
// 分かったときに呼ぶ。以後この プロセスからは一切保存しない
// （終了時フックが古いスナップショットで本物のデータを上書きするのを防ぐ）
let savesAborted = false;
function abortSaves() { savesAborted = true; }

// 定期保存を開始する。getSnapshot() が返すオブジェクトを丸ごと保存する。
function startSaver(getSnapshot) {
  if (!persistenceEnabled()) return () => {};
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let lastWritten = "";
  try { lastWritten = fs.readFileSync(file, "utf8"); } catch {}

  const saveNow = () => {
    if (savesAborted) return;
    let json;
    try {
      json = JSON.stringify(getSnapshot(), replacer);
    } catch (e) {
      console.log("（警告）保存データの作成に失敗: " + e.message);
      return;
    }
    if (json === lastWritten) return; // 変化なし＝ディスクに触れない
    try {
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, json, { mode: 0o600 });
      try { if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak"); } catch {}
      fs.renameSync(tmp, file); // 原子的置換
      try { fs.chmodSync(file, 0o600); } catch {}
      lastWritten = json;
    } catch (e) {
      console.log("（警告）データ保存に失敗（次回の保存で再試行します）: " + e.message);
    }
  };

  const timer = setInterval(saveNow, 3000);
  timer.unref?.(); // 保存タイマーだけでプロセスを生かし続けない
  // 正常終了・停止シグナル時は即時保存してから終わる
  process.on("exit", saveNow);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => { saveNow(); process.exit(0); });
  }
  return saveNow;
}

module.exports = { persistenceEnabled, loadSnapshot, startSaver, dataFile, abortSaves };
