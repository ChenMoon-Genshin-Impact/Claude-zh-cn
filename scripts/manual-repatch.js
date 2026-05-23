#!/usr/bin/env node
// manual-repatch.js — Claude Code 升版后人工救火一键脚本
//
// 功能：自动定位 LIVE / HARDLINK / BACKUP，extract→patch→repack→替换→刷 marker。
// 跨 shell：bash / PowerShell / cmd 都能直接跑，无 shell 变量、无占位符。
//
// 用法：
//   node scripts/manual-repatch.js              # 默认自动探测，全套跑完
//   node scripts/manual-repatch.js --dry-run    # 只摸排状态、不改文件
//   node scripts/manual-repatch.js --skip-replace  # 只 patch 不替换 LIVE
//
// 退出码：
//   0 = 成功 / 无需 patch
//   1 = patch 失败或前置检查失败
//   2 = 用户输入有误（参数、路径不存在等）

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const SKIP_REPLACE = argv.includes("--skip-replace");

const REPO_ROOT = path.resolve(__dirname, "..");
const PLUGIN_SRC = path.join(REPO_ROOT, "plugin");
const LIVE_PLUGIN = path.join(os.homedir(), ".claude", "plugins", "claude-code-zh-cn");

function info(msg) { console.log("[INFO] " + msg); }
function warn(msg) { console.log("[WARN] " + msg); }
function fail(msg, code = 1) { console.error("[FAIL] " + msg); process.exit(code); }
function step(name) { console.log("\n=== " + name + " ==="); }

function which(cmd) {
  // node 内置无 which，借 PATH 自己解析（跨平台）
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch {}
    }
  }
  return null;
}

function hashFile(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function detectLive(pluginDir) {
  const claudeBin = which("claude");
  if (!claudeBin) fail("找不到 claude 命令（PATH 里没有），先确认 Claude Code 安装正常", 2);
  const helper = path.join(pluginDir, "bun-binary-io.js");
  if (!fs.existsSync(helper)) fail("插件 helper 不存在: " + helper, 2);
  const out = spawnSync("node", [helper, "detect", claudeBin], { encoding: "utf8" });
  if (out.status !== 0 || !out.stdout) fail("bun-binary-io detect 失败: " + (out.stderr || ""), 1);
  const line = out.stdout.trim();
  // 形如 "native-bun:D:\\...\\claude.exe" 或 "npm:..."
  const idx = line.indexOf(":");
  const kind = line.slice(0, idx);
  const target = line.slice(idx + 1);
  return { kind, target, claudeBin };
}

function deriveHardlink(livePath) {
  // npm Windows 下 LIVE = .../claude-code/bin/claude.exe
  // HARDLINK = .../claude-code/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe
  const m = livePath.match(/^(.*[\\/]@anthropic-ai[\\/]claude-code)[\\/]bin[\\/]claude\.exe$/i);
  if (!m) return null;
  return path.join(m[1], "node_modules", "@anthropic-ai", "claude-code-win32-x64", "claude.exe");
}

function getVersion(pluginDir, binary) {
  const out = spawnSync("node", [path.join(pluginDir, "bun-binary-io.js"), "version", binary], { encoding: "utf8" });
  const v = (out.stdout || "").trim();
  if (v) return v;
  // fallback：跑 binary --version
  const out2 = spawnSync(binary, ["--version"], { encoding: "utf8" });
  const m = (out2.stdout || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m[0] : "";
}

function isSupported(pluginDir, version) {
  const supportFile = path.join(pluginDir, "support-window.json");
  if (!fs.existsSync(supportFile)) return false;
  const data = JSON.parse(fs.readFileSync(supportFile, "utf8"));
  const groups = {
    win32: [data.windowsNativeExperimental],
    darwin: [data.macosNativeOfficialInstallerExperimental, data.macosNativeExperimental],
    linux: [data.linuxNativeExperimental],
  }[process.platform] || [];
  const parse = v => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v || ""); return m ? [+m[1], +m[2], +m[3]] : null; };
  const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  const cur = parse(version);
  if (!cur) return false;
  for (const e of groups.filter(Boolean)) {
    const f = parse(e.floor);
    if (f && cmp(cur, f) >= 0 && !(Array.isArray(e.excluded) && e.excluded.includes(version))) return true;
  }
  return false;
}

function computePatchRevision(pluginDir) {
  const files = [
    "manifest.json", "patch-cli.sh", "patch-cli.js", "cli-translations.json",
    "bun-binary-io.js", "compute-patch-revision.sh",
    "hooks/session-start", "hooks/notification", "hooks/auto-repatch.sh",
    "hooks/auto-update.sh", "lib/common.sh",
  ];
  const h = crypto.createHash("sha256");
  for (const f of files) {
    const t = path.join(pluginDir, f);
    if (!fs.existsSync(t)) continue;
    h.update(f); h.update("\0"); h.update(fs.readFileSync(t)); h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

// ─── main ────────────────────────────────────────────────────────────
step("一、状态摸排");
const { kind, target: LIVE, claudeBin } = detectLive(LIVE_PLUGIN);
info(`安装类型: ${kind}`);
info(`LIVE: ${LIVE}`);
if (kind !== "native-bun") fail("当前不是 native-bun 安装，本脚本仅处理 Bun 打包的 native binary。npm 安装请用 hook 自动 patch。", 2);

const HARDLINK = deriveHardlink(LIVE);
const BACKUP = LIVE + ".zh-cn-backup";
info(`HARDLINK: ${HARDLINK || "（无，可能不是 Windows npm 安装）"}`);
info(`BACKUP:   ${fs.existsSync(BACKUP) ? BACKUP : "(missing)"}`);

const version = getVersion(LIVE_PLUGIN, LIVE);
info(`当前版本: ${version}`);
if (!isSupported(LIVE_PLUGIN, version)) {
  fail(`版本 ${version} 不在 floor-only 支持范围内（< floor 或在 excluded）。先更新 plugin/support-window.json 的 floor。`, 1);
}
info("floor-only 支持检查: OK");

const liveHash = hashFile(LIVE);
info(`LIVE hash: ${liveHash}`);

const markerFile = path.join(LIVE_PLUGIN, ".patched-version");
const oldMarker = fs.existsSync(markerFile) ? fs.readFileSync(markerFile, "utf8").trim() : "";
info(`marker: ${oldMarker || "(empty)"}`);

const liveRev = computePatchRevision(LIVE_PLUGIN);
const expectedMarker = `native|${version}|${liveHash}|${liveRev}`;
if (oldMarker === expectedMarker) {
  info("marker 与 LIVE 完全一致，hook 下次会跳过 repatch。");
  // 进一步确认 LIVE 含中文串
  const sample = fs.readFileSync(LIVE).toString("utf8");
  const cnHits = (sample.match(/编辑文件/g) || []).length;
  if (cnHits > 0) {
    info(`LIVE 中文串存在（编辑文件 ×${cnHits}）。无需 patch。`);
    process.exit(0);
  } else {
    warn("marker 一致但 LIVE 没有中文串，强制重 patch。");
  }
}

if (DRY) {
  info("--dry-run: 只摸排不动手，到此为止。");
  process.exit(0);
}

// ─── 二、Extract → Patch → Repack ────────────────────────────────────
step("二、Extract → Patch → Repack");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cczh-repatch-"));
const WORK = path.join(tmpDir, "claude-work.exe");
const TMP_JS = path.join(tmpDir, "claude-work.js");
fs.copyFileSync(LIVE, WORK);
info(`WORK: ${WORK}`);

const helper = path.join(PLUGIN_SRC, "bun-binary-io.js");
const patchSh = path.join(PLUGIN_SRC, "patch-cli.sh");
const patchJs = path.join(PLUGIN_SRC, "patch-cli.js");
const dict = path.join(PLUGIN_SRC, "cli-translations.json");

let r;
r = spawnSync("node", [helper, "extract", WORK, TMP_JS], { encoding: "utf8" });
if (r.status !== 0) fail("extract 失败: " + (r.stderr || r.stdout), 1);
info(`extract OK, JS size = ${fs.statSync(TMP_JS).size} bytes`);

// patch-cli.sh 是 bash 脚本，跨 shell 不友好。直接调底层的 patch-cli.js
r = spawnSync("node", [patchJs, TMP_JS, dict], { encoding: "utf8" });
if (r.status !== 0) fail("patch-cli.js 失败: " + (r.stderr || r.stdout), 1);
const patchCount = parseInt((r.stdout || "0").trim(), 10) || 0;
info(`patch-cli 完成，命中 ${patchCount} 处`);
if (patchCount === 0) fail("patch 数量为 0，cli-translations.json 可能与新版本完全错位，需要人工补条目。", 1);

r = spawnSync("node", [helper, "repack", WORK, TMP_JS], { encoding: "utf8" });
if (r.status !== 0) fail("repack 失败: " + (r.stderr || r.stdout), 1);
const workBuf = fs.readFileSync(WORK);
const cnInWork = (workBuf.toString("utf8").match(/编辑文件/g) || []).length;
info(`repack OK, WORK 中"编辑文件"×${cnInWork}`);
if (cnInWork === 0) fail("repack 后中文串没进 binary，patch 失败。", 1);

if (SKIP_REPLACE) {
  info(`--skip-replace: 已 patch 到 ${WORK}，未替换 LIVE。`);
  process.exit(0);
}

// ─── 三、Rename Trick 替换 LIVE 和 HARDLINK ─────────────────────────
step("三、替换运行中的 binary（rename trick）");
function replaceRunning(target) {
  if (!fs.existsSync(target)) { warn(`不存在，跳过: ${target}`); return; }
  const stash = target + ".in-use-" + Date.now();
  fs.renameSync(target, stash);
  fs.copyFileSync(WORK, target);
  try { fs.unlinkSync(stash); info(`replaced + cleaned: ${target}`); }
  catch { info(`replaced (stash kept): ${target}`); }
}
replaceRunning(LIVE);
if (HARDLINK) replaceRunning(HARDLINK);

// ─── 四、刷 BACKUP 和 marker ─────────────────────────────────────────
step("四、刷 BACKUP 和 marker");
fs.copyFileSync(WORK, BACKUP);
info(`BACKUP 同步为中文版: ${BACKUP}`);

const newHash = hashFile(LIVE);
const newMarker = `native|${version}|${newHash}|${liveRev}`;
fs.writeFileSync(markerFile, newMarker);
info(`marker: ${newMarker}`);

// ─── 五、端到端验证 ────────────────────────────────────────────────
step("五、端到端验证");
const liveBuf = fs.readFileSync(LIVE);
const backupBuf = fs.readFileSync(BACKUP);
const liveHits = (liveBuf.toString("utf8").match(/编辑文件/g) || []).length;
const backupHits = (backupBuf.toString("utf8").match(/编辑文件/g) || []).length;
info(`LIVE   "编辑文件" ×${liveHits}`);
info(`BACKUP "编辑文件" ×${backupHits}`);
info(`hash 一致: ${hashFile(LIVE) === hashFile(BACKUP)}`);

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

if (liveHits === 0 || backupHits === 0) fail("校验失败，LIVE 或 BACKUP 中文串为 0", 1);
console.log("\n[OK] 救火完成。退出当前 Claude Code 会话，重启后界面应为中文。");
