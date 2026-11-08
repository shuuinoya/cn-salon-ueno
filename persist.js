// 永続化層（このシステムの「データベース」）。
// demo-api.js のメモリ上の状態（予約・顧客・シフト・回数券・設定・アカウント等）を
// ディスクへ安全に保存し、起動時に復元する。業務ロジックには一切関知しない。
//
// 設計方針：
// ・書き込みは「一時ファイルへ全書き→fsyncなしrename」の原子的置換（途中で電源が落ちても
//   直前の完全なファイルが必ず残る）。置換前の版は .bak として1世代保持（誤操作からの復旧用）
// ・読み込みで壊れたファイルを検出したら、.broken-<日時> に退避して初期データで起動
//   （システム全体を停止させない）。.bak が読めればそちらを使う
// ・保存は変更の操作の直後（60msまとめて）＋1秒ごとの見回りで、内容が変わったときだけ（差分なしならディスクに触れない）
// ・一時ファイルはディスクへ書き終わる（fsync）のを待ってから差し替える（パソコンを閉じる・電源断でも消えない）
// ・Map / Set はタグ付きJSONで可逆に保存する
// ・ファイルは所有者のみ読み書き可（0600。顧客情報を含むため）
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const os = require("os");
const childProcess = require("child_process");

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
// クラウドホスティング上での実行か（Render / Fly.io / Railway、または CLOUD=1）
function isCloud() {
  return process.env.CLOUD === "1" || !!process.env.RENDER ||
    !!process.env.FLY_APP_NAME || !!process.env.RAILWAY_ENVIRONMENT;
}

function persistenceEnabled() {
  if (process.env.DEMO_EPHEMERAL === "1") return false;
  if (process.env.DEMO_PERSIST === "1") return true;
  if (isCloud()) return true; // 本番ホスティングでは常に保存（保存先はDEMO_DATAでボリュームへ）
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

// ---- GitHubリモート保存（完全無料の永続化） ---------------------------------
// 無料ホスティング（Render無料枠など）はディスクが再起動で消えるため、
// GH_TOKEN と GH_REPO（例 "owner/repo"）を設定すると、保存データを
// GitHubの非公開リポジトリへも自動同期する。起動時はローカルとGitHubの
// 新しい方（savedAt比較）を採用する。トークンはログに出さない。
const GH = {
  api: () => process.env.GH_API || "https://api.github.com",
  repo: () => process.env.GH_REPO || "",
  path: () => process.env.GH_PATH || "salon-data/state.json",
  branch: () => process.env.GH_BRANCH || "main",
  token: () => process.env.GH_TOKEN || "",
  enabled: () => !!(process.env.GH_TOKEN && process.env.GH_REPO),
};
const ghHeaders = () => ({
  "Authorization": "Bearer " + GH.token(),
  "User-Agent": "cn-salon-persist",
  "X-GitHub-Api-Version": "2022-11-28",
});
// 保存先：圧縮版（state.json.gz）。通信量を約1/10にする（無料ホスティングの通信量の上限対策）。
// 以前の版の非圧縮ファイル（state.json）も起動時に読み、新しい方を使う
const ghUrl = (p = GH.path() + ".gz") => `${GH.api()}/repos/${GH.repo()}/contents/${p}`;

// GitHub上の現在のsha（ファイル未作成ならnull）
async function ghSha() {
  const r = await fetch(`${ghUrl()}?ref=${GH.branch()}`, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github.object+json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("GitHub参照に失敗: HTTP " + r.status);
  return (await r.json()).sha || null;
}
// GitHub上の保存データ本文（未作成ならnull）。gz=true は圧縮版を展開して返す
async function ghFetch(gz) {
  const r = await fetch(`${ghUrl(gz ? undefined : GH.path())}?ref=${GH.branch()}`, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github.raw" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("GitHub取得に失敗: HTTP " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  return gz ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}
// 外部応答をログへ直書きしない。原因は固定分類、詳しい応答は機密を除いたローカル診断だけに残す。
const GH_ERROR_FIELDS = new Set(["sha", "branch", "path", "content", "message", "name", "email", "author", "committer", "ref"]);
const GH_ERROR_CODES = new Set(["missing", "missing_field", "invalid", "already_exists", "unprocessable", "custom", "too_large", "not_found"]);
async function ghErrorBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); return { message: "[response too large]" }; }
      chunks.push(Buffer.from(value));
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function ghErrorCategory(status, data) {
  const errors = Array.isArray(data.errors) ? data.errors : [];
  const text = [data.message, ...errors.map(e => typeof e === "string" ? e : e?.message)].filter(x => typeof x === "string").join(" ").toLowerCase();
  if (errors.some(e => e?.field === "sha" && ["missing", "missing_field"].includes(e.code)) || /sha.{0,60}(missing|required|not supplied|wasn't supplied|not provided)/.test(text)) return "missing_sha";
  if (/sha.{0,80}(does not match|didn't match|mismatch|expected)|mismatch.{0,30}sha/.test(text)) return "sha_mismatch";
  if (status === 429 || /rate limit|secondary rate|abuse|spamm/.test(text)) return "rate_limit";
  if (/too (large|big)|larger than|exceed.{0,60}(size|bytes|mb|limit)|maximum.{0,30}(size|bytes)|size.{0,60}(limit|exceed)/.test(text) || errors.some(e => e?.code === "too_large")) return "size_limit";
  if (/repository rule|rule violation|protected branch|branch protection|push protection|gh013|gh006/.test(text)) return "repository_rule";
  if (/\b(committer|author|identity)\b/.test(text) || errors.some(e => ["name", "email", "author", "committer"].includes(e?.field))) return "identity";
  if (/base64|content.{0,30}(invalid|valid|required)|invalid.{0,30}content/.test(text) || errors.some(e => e?.field === "content")) return "content_validation";
  return "unknown";
}
function ghDiagnosticText(value, secrets, max) {
  if (typeof value !== "string") return "";
  let out = value;
  for (const secret of secrets) if (typeof secret === "string" && secret.length >= 4) out = out.split(secret).join("[REDACTED]");
  return out.replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, "[CREDENTIAL]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, "[CREDENTIAL]")
    .replace(/\b(?:token|password|secret|authorization|content)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[REDACTED]")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[URL]")
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/\{[^}]*\}/g, "[DATA]")
    .replace(/[A-Za-z0-9+/_=-]{80,}/g, "[LONG_VALUE]")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, max);
}
async function ghSaveError(response, requestJson, requestContent) {
  const data = await ghErrorBody(response), category = ghErrorCategory(response.status, data);
  const secrets = [requestJson, requestContent, ...Object.entries(process.env).filter(([k]) => /TOKEN|PASSWORD|PASS|SECRET|KEY|AUTH/.test(k)).map(([,v]) => v)];
  const errors = (Array.isArray(data.errors) ? data.errors : []).slice(0, 8).map(e => ({
    ...(GH_ERROR_FIELDS.has(e?.field) ? { field: e.field } : {}),
    ...(GH_ERROR_CODES.has(e?.code) ? { code: e.code } : {}),
    message: ghDiagnosticText(typeof e === "string" ? e : e?.message, secrets, 500),
  }));
  let saved = false;
  try {
    const file = dataFile() + ".github-error.json";
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600);
    try {
      fs.fchmodSync(fd, 0o600);
      fs.writeFileSync(fd, JSON.stringify({ status: response.status, message: ghDiagnosticText(data.message, secrets, 1000), errors }));
      saved = true;
    } finally { fs.closeSync(fd); }
  } catch {} // 診断の保存失敗で通常の保存やエラー報告を妨げない
  const fields = [...new Set(errors.flatMap(e => e.field ? [e.field] : []))].join(",");
  const codes = [...new Set(errors.flatMap(e => e.code ? [e.code] : []))].join(",");
  return new Error("GitHub保存に失敗: HTTP " + response.status + " category=" + category +
    (fields ? " fields=" + fields : "") + (codes ? " codes=" + codes : "") + " diagnostic=" + (saved ? "saved" : "unavailable"));
}
const GH_CONTENTS_LIMIT = 20 * 1024 * 1024;
const gitSha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
let ghGitRefBlocked = false, ghGitRetryHead = null;
const gitChildren = new Set(), gitTempDirs = new Set();
function stopGitChildren() {
  for (const child of gitChildren) try { process.kill(-child.pid, "SIGKILL"); } catch {}
}
process.on("exit", () => {
  stopGitChildren();
  for (const dir of gitTempDirs) try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});
async function ghJson(route, method = "GET", body, json = "", content = "", stage = "repository") {
  if (method !== "GET" && savesAborted) throw new Error("GitHub保存を中止: category=save_aborted");
  const r = await fetch(`${GH.api()}/repos/${GH.repo()}${route}`, {
    method, headers: { ...ghHeaders(), Accept: "application/vnd.github+json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) { const e = await ghSaveError(r, json, content); e.message += " stage=" + stage; throw e; }
  try { return await r.json(); } catch { throw new Error("GitHub保存に失敗: category=invalid_response stage=" + stage); }
}
function ghCheck(condition, stage) {
  if (!condition) throw new Error("GitHub保存に失敗: category=invalid_response stage=" + stage);
}
async function ghPrivate() {
  const repo = await ghJson("");
  if (repo.private !== true) throw new Error("GitHub保存に失敗: category=repository_not_private");
}
// Gitの出力には認証情報や保存内容が混じり得るため、生の出力を例外・ログへ渡さない。
function gitFailure(stderr, stage) {
  const kind = /non-fast-forward|fetch first|\[rejected\]/i.test(stderr) ? "ref_conflict"
    : /protected branch|repository rule|GH013|GH006/i.test(stderr) ? "repository_rule"
    : /too large|exceeds.{0,50}(limit|size)|larger than/i.test(stderr) ? "size_limit"
    : /authentication failed|could not read Username|access denied|permission denied/i.test(stderr) ? "authentication"
    : /unable to access|could not resolve|connection|timed out|RPC failed|remote end hung up/i.test(stderr) ? "git_transport" : "git_command";
  return new Error("GitHub保存に失敗: category=" + kind + " stage=" + stage);
}
function gitRun(dir, args, env, input, stage) {
  return new Promise((resolve, reject) => {
    let child;
    // 一時的に制限を強めて子へ引き継ぎ、同期的に戻す。シェルや利用者のGit設定を実行しない。
    const previous = process.umask(0o077);
    try { child = childProcess.spawn("/usr/bin/git", args, { cwd: dir, env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch { reject(gitFailure("", stage)); return; }
    finally { process.umask(previous); }
    gitChildren.add(child);
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 180000);
    timer.unref?.();
    const done = () => { clearTimeout(timer); gitChildren.delete(child); };
    let stdout = "", stderr = "", overflow = false;
    child.stdout.on("data", data => { if (stdout.length + data.length > 65536) { overflow = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} } else stdout += data.toString(); });
    child.stderr.on("data", data => { if (stderr.length < 65536) stderr += data.toString().slice(0, 65536 - stderr.length); });
    child.on("error", () => { done(); reject(gitFailure("", stage)); });
    child.on("close", code => { done(); code === 0 && !overflow ? resolve(stdout.trim()) : reject(gitFailure(stderr, stage)); });
    child.stdin.on("error", () => {}); // 子の早期終了時のEPIPEはcloseの終了コードで処理する
    child.stdin.end(input || undefined);
  });
}
function gitEnvironment(dir) {
  const env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false", SSH_ASKPASS: "/usr/bin/false", GCM_INTERACTIVE: "Never",
    GIT_DIR: dir, GIT_INDEX_FILE: path.join(dir, "backup-index") });
  const config = [["credential.helper", ""], ["core.hooksPath", "/dev/null"], ["commit.gpgSign", "false"],
    ["user.name", "CNsalon backup"], ["user.email", "backup@invalid.local"], ["http.followRedirects", "false"],
    ["gc.auto", "0"], ["maintenance.auto", "false"],
    ["http.https://github.com/" + GH.repo() + ".git.extraheader", "Authorization: Basic " + Buffer.from("x-access-token:" + GH.token()).toString("base64")]];
  env.GIT_CONFIG_COUNT = String(config.length);
  config.forEach(([key, value], i) => { env["GIT_CONFIG_KEY_" + i] = key; env["GIT_CONFIG_VALUE_" + i] = value; });
  return env;
}
async function restrictGitFiles(dir) {
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { await fs.promises.chmod(file, 0o700); await restrictGitFiles(file); }
    else if (entry.isFile()) await fs.promises.chmod(file, 0o600);
  }
}
// 大容量はContents/Git blob APIの入力制限を避け、同じgzipを通常のGit pushで保存する。
// checkoutをせず既存treeの1ファイルだけを変更。認証は子の環境だけに渡し、一時作業場は必ず破棄。
async function ghPutGit(json, compressed) {
  if (ghGitRefBlocked) throw new Error("GitHub保存に失敗: category=ref_update_unconfirmed stage=git_push");
  if (compressed.length > 100 * 1024 * 1024) throw new Error("GitHub保存に失敗: category=size_limit stage=git_blob");
  const branch = GH.branch(), file = GH.path() + ".gz";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(GH.repo()) || GH.api() !== "https://api.github.com") throw new Error("GitHub保存に失敗: category=invalid_repository");
  if (!file || file.startsWith("/") || file.split("/").some(p => !p || p === "." || p === "..") || /[\u0000-\u001f\u007f]/.test(file)) throw new Error("GitHub保存に失敗: category=invalid_path");
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cnsalon-gh-backup-"));
  gitTempDirs.add(dir);
  const env = gitEnvironment(dir), remote = "https://github.com/" + GH.repo() + ".git", ref = "refs/heads/" + branch;
  const run = (args, stage, input) => gitRun(dir, args, env, input, stage);
  try {
    await fs.promises.chmod(dir, 0o700);
    await run(["check-ref-format", ref], "git_branch");
    await run(["init", "--bare", "--template=", dir], "git_init");
    await run(["fetch", "--depth=1", "--no-tags", "--no-recurse-submodules", remote, ref], "git_fetch");
    const head = await run(["rev-parse", "--verify", "FETCH_HEAD^{commit}"], "git_head"); ghCheck(gitSha(head), "git_head");
    if (ghGitRetryHead && ghGitRetryHead !== head) { ghGitRefBlocked = true; throw new Error("GitHub保存に失敗: category=ref_conflict stage=git_fetch"); }
    ghGitRetryHead = head; // 失敗後の次周期も、別の更新を新しい親として勝手に取り込まない。
    await run(["read-tree", head + "^{tree}"], "git_tree");
    const expectedBlob = crypto.createHash("sha1").update("blob " + compressed.length + "\0").update(compressed).digest("hex");
    const blob = await run(["hash-object", "-w", "--stdin"], "git_blob", compressed); ghCheck(blob === expectedBlob, "git_blob");
    await run(["update-index", "--add", "--cacheinfo", "100644", blob, file], "git_index");
    const tree = await run(["write-tree"], "git_tree"); ghCheck(gitSha(tree), "git_tree");
    const commit = await run(["commit-tree", tree, "-p", head], "git_commit", "予約データ自動保存 " + new Date().toISOString() + "\n"); ghCheck(gitSha(commit), "git_commit");
    await restrictGitFiles(dir);
    if (savesAborted) throw new Error("GitHub保存を中止: category=save_aborted");
    ghGitRefBlocked = true;
    let pushError;
    try { await run(["push", "--porcelain", remote, commit + ":" + ref], "git_push"); } catch (e) { pushError = e; }
    let current;
    try {
      const lines = await run(["ls-remote", "--refs", remote, ref], "git_verify");
      const rows = lines.split("\n").map(line => line.split(/\s+/)).filter(row => row[1] === ref);
      ghCheck(rows.length === 1 && gitSha(rows[0][0]), "git_verify"); current = rows[0][0];
    } catch { throw new Error("GitHub保存に失敗: category=ref_update_unconfirmed stage=git_push"); }
    if (current === commit) { ghGitRefBlocked = false; ghGitRetryHead = null; return blob; }
    if (current !== head) throw new Error("GitHub保存に失敗: category=ref_conflict stage=git_push");
    ghGitRefBlocked = false; // 旧headのまま＝未更新を確認済み。次の定期処理は許可する。
    throw pushError || new Error("GitHub保存に失敗: category=git_push_unconfirmed stage=git_push");
  } finally { await fs.promises.rm(dir, { recursive: true, force: true }); gitTempDirs.delete(dir); }
}
// 小さいファイルは従来のContents API（SHA競合を一度だけ再確認）。圧縮は予約受付を塞がない。
async function ghPut(json, sha, retry = true) {
  if (ghGitRefBlocked) throw new Error("GitHub保存に失敗: category=ref_update_unconfirmed stage=git_ref");
  await ghPrivate();
  const compressed = await new Promise((resolve, reject) => zlib.gzip(Buffer.from(json), { level: 9 }, (error, data) => error ? reject(error) : resolve(data)));
  if (compressed.length > GH_CONTENTS_LIMIT) return ghPutGit(json, compressed);
  if (savesAborted) throw new Error("GitHub保存を中止: category=save_aborted");
  const content = compressed.toString("base64");
  const r = await fetch(ghUrl(), {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "予約データ自動保存 " + new Date().toISOString(),
      content,
      branch: GH.branch(),
      ...(sha ? { sha } : {}),
    }),
  });
  if ((r.status === 409 || r.status === 422) && retry) {
    return ghPut(json, await ghSha(), false);
  }
  if (!r.ok) throw await ghSaveError(r, json, content);
  return (await r.json()).content?.sha || null;
}

// 起動時：GitHub側とローカルの新しい方を返す（リモート無効ならローカルのみ）
async function loadSnapshotWithRemote() {
  const local = loadSnapshot();
  if (!local.enabled || !GH.enabled()) return local;
  try {
    // 圧縮版と以前の非圧縮版の両方を読み、新しい方を使う（片方が無い・壊れていても止めない）
    let remote = null;
    for (const gz of [true, false]) {
      try {
        const text = await ghFetch(gz);
        if (!text) continue;
        const d = JSON.parse(text, reviver);
        if (d && d.state && (!remote || (d.savedAt || 0) > (remote.savedAt || 0))) remote = d;
      } catch (e) {
        console.log("（警告）GitHubの保存データ（" + (gz ? "圧縮版" : "非圧縮版") + "）を読めませんでした: " + e.message);
      }
    }
    if (remote && (!local.data || (remote.savedAt || 0) >= (local.data.savedAt || 0))) {
      console.log("GitHubから保存データを復元しました（" + GH.repo() + "）");
      return { ...local, data: remote };
    }
    if (!remote) console.log("GitHub保存は有効です（初回保存でファイルが作られます）: " + GH.repo());
  } catch (e) {
    console.log("（警告）GitHubからの復元に失敗（ローカルの保存データで起動します）: " + e.message);
  }
  return local;
}

// 二重起動を検知して終了する場合など、「このプロセスは所有者ではない」と
// 分かったときに呼ぶ。以後この プロセスからは一切保存しない
// （終了時フックが古いスナップショットで本物のデータを上書きするのを防ぐ）
let savesAborted = false;
function abortSaves() { savesAborted = true; stopGitChildren(); }

// 変更の直後に保存する（startSaver が始まるまでは何もしない）
let saveSoon = () => {};
function requestSave() { saveSoon(); }
let saveImmediately = () => !persistenceEnabled();
// 外部へ送る直前に、送信中の記録を確定する。一斉メールの二重送信防止用。
function flushNow() { return !savesAborted && saveImmediately() === true; }

// 定期保存を開始する。getSnapshot() が返すオブジェクトを丸ごと保存する。
function startSaver(getSnapshot) {
  if (!persistenceEnabled()) return () => {};
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let lastWritten = "";
  let lastBody = null; // 保存時刻（savedAt）を除いた中身。中身が変わったときだけ書く
  try { lastWritten = fs.readFileSync(file, "utf8"); } catch {}

  const saveNow = () => {
    if (savesAborted) return false;
    let json, body;
    try {
      const { savedAt, ...rest } = getSnapshot();
      body = JSON.stringify(rest, replacer);
      // 変化なし＝ディスクに触れない（保存時刻だけが違う場合も書かない。GitHubへの同期も起きない）
      if (body === lastBody) return true;
      json = body === "{}" ? JSON.stringify({ savedAt }) : '{"savedAt":' + JSON.stringify(savedAt) + "," + body.slice(1);
    } catch (e) {
      console.log("（警告）保存データの作成に失敗: " + e.message);
      return false;
    }
    if (json === lastWritten) { lastBody = body; return true; }
    try {
      const tmp = file + ".tmp";
      // 一時ファイルに書いたら、ディスクへ書き終わるのを待ってから（fsync）差し替える。
      // 書き込みの途中でパソコンを閉じる・電源が落ちる・強制終了しても、直前の完全なファイルが必ず残る
      const fd = fs.openSync(tmp, "w", 0o600);
      try { fs.writeSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      try { if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak"); } catch {}
      fs.renameSync(tmp, file); // 原子的置換
      try { fs.chmodSync(file, 0o600); } catch {}
      // 差し替え（ファイル名の付け替え）自体もディスクに確定させる
      try { const dfd = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch {}
      lastWritten = json;
      lastBody = body;
      return true;
    } catch (e) {
      console.log("（警告）データ保存に失敗（次回の保存で再試行します）: " + e.message);
      return false;
    }
  };
  saveImmediately = saveNow;

  // GitHubへの同期（有効時のみ）。30秒間隔で変化があれば送る。多重送信は防ぐ
  let ghLastPushed = "";
  let ghKnownSha; // undefined=未取得, null=リモート未作成
  let ghBusy = false;
  const ghPush = async () => {
    if (!GH.enabled() || savesAborted || ghBusy) return;
    const json = lastWritten;
    if (!json || json === ghLastPushed) return;
    ghBusy = true;
    try {
      if (ghKnownSha === undefined) ghKnownSha = await ghSha();
      ghKnownSha = await ghPut(json, ghKnownSha);
      ghLastPushed = json;
    } catch (e) {
      console.log("（警告）GitHubへの保存に失敗（次回再試行します）: " + e.message);
      ghKnownSha = undefined; // 次回shaを取り直す
    } finally {
      ghBusy = false;
    }
  };
  if (GH.enabled()) {
    const ghTimer = setInterval(ghPush, 30000);
    ghTimer.unref?.();
  }

  // 変更の直後に呼ばれる即時保存（demo-api.js が、予約・スタッフ情報・設定などを変える操作のたびに呼ぶ）。
  // 続けて何度も変えたときは 60ms まとめてから1回だけ書く
  let soonTimer = null;
  saveSoon = () => {
    if (soonTimer) return;
    soonTimer = setTimeout(() => { soonTimer = null; saveNow(); }, 60);
  };
  // 念のための見回り（メール送信の記録など、操作以外で変わった分も1秒以内に保存する。変化がなければディスクに触れない）
  const timer = setInterval(saveNow, 1000);
  timer.unref?.(); // 保存タイマーだけでプロセスを生かし続けない
  // 正常終了・停止シグナル時は即時保存してから終わる
  process.on("exit", saveNow);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      saveNow();
      if (GH.enabled() && lastWritten !== ghLastPushed) {
        // 停止前にGitHubへ送りきる（無料ホスティングのスリープ・再デプロイ対策。
        // 猶予内に終わるよう最大4秒だけ待つ）
        let done = false;
        ghPush().then(() => { done = true; process.exit(0); });
        setTimeout(() => { if (!done) process.exit(0); }, 4000);
      } else {
        process.exit(0);
      }
    });
  }
  return saveNow;
}

module.exports = {
  persistenceEnabled, loadSnapshot, loadSnapshotWithRemote, startSaver, requestSave, flushNow,
  dataFile, abortSaves, isCloud, remoteEnabled: GH.enabled,
};
