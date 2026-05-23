# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# claude-code-zh-cn

Claude Code CLI 界面汉化插件。通过四层机制实现完整的中文化。

 claude --dangerously-skip-permissions

## 核心架构

本插件通过**四层机制**实现中文化，各层独立工作，互不干扰：

1. **设置注入** (`settings-overlay.json`) — 修改 `~/.claude/settings.json`，设置语言、spinner 动词和提示
2. **Hook 系统** (`plugin/hooks.json`) — 会话启动时注入中文上下文，通知时翻译消息
3. **插件系统** (`plugin/manifest.json`) — 提供中文输出风格
4. **CLI Patch** (`patch-cli.sh`, `cli-translations.json`) — 直接替换 cli.js 中 1653 处硬编码英文字符串

Layer 1-3 不受 Claude Code 更新影响，Layer 4 通过自动检测机制在版本变更后重新 patch。

## 关键命令

```bash
# 安装插件
./install.sh

# 卸载插件（精准移除，保留其他配置）
./uninstall.sh

# 测试 CLI patch（不修改文件，仅输出 patch 数量）
./patch-cli.sh /path/to/cli.js

# 计算 patch 规则指纹（用于检测是否需要重新 patch）
./compute-patch-revision.sh plugin/

# 跑完整测试套件
node --test tests/*.test.js

# 跑单个测试
node --test tests/patch-cli.test.js

# 提交 PR 前的本地全量校验（CI 同款）
bash scripts/preflight.sh

# 本地临时验证、无 PR diff 时跳过 payload guard
bash scripts/preflight.sh --skip-payload-source

# 同步 plugin/ 下的 payload 镜像（修改根目录源文件后必跑）
bash scripts/sync-payload.sh

# Claude Code 升版后人工救火（hook 失效时用，跨 shell 一键，详见「升版后手动救火 SOP」）
node scripts/manual-repatch.js
node scripts/manual-repatch.js --dry-run
```

## 项目结构

### 核心文件
- `patch-cli.sh` — CLI patch 入口脚本（被 install.sh 和 session-start hook 调用）
- `patch-cli.js` — 实际执行字符串替换的 Node.js 脚本
- `cli-translations.json` — 1653 条 UI 翻译对照表（英文→中文）
- `compute-patch-revision.sh` — 计算 patch 规则指纹（SHA256 前 16 位）
- `install.sh` / `uninstall.sh` — 安装/卸载脚本

### 配置和数据
- `settings-overlay.json` — 合并到 settings.json 的中文设置（**不含** verbs 和 tips 数据）
- `verbs/zh-CN.json` — 187 个 spinner 动词翻译（**唯一数据源**）
- `tips/zh-CN.json` — 41 条 spinner 提示翻译（**唯一数据源**）

### 插件系统
- `plugin/manifest.json` — 插件元数据（版本号在此文件）
- `plugin/hooks.json` — Hook 配置（SessionStart、Notification）
- `plugin/hooks/session-start` — 会话启动时注入中文上下文
- `plugin/hooks/notification` — 通知消息翻译
- `plugin/hooks/auto-repatch.sh` — 自动检测 cli.js 版本变更并重新 patch
- `plugin/hooks/auto-update.sh` — 自动检测插件新版本并更新
- `plugin/output-styles/chinese.json` — 中文输出风格
- `plugin/bun-binary-io.js` — native binary 的提取/重打包工具（支持官方安装器）
- `plugin/lib/common.sh` — 共享工具函数

## 数据流原则

翻译数据**单一来源**，严禁重复维护：

- `verbs/zh-CN.json` 是动词的**唯一数据源**
- `tips/zh-CN.json` 是提示的**唯一数据源**
- `settings-overlay.json` **不重复存放** verbs 和 tips 数据
- `install.sh` 安装时从上述两个 JSON 文件动态读取，现场组装合并到 `~/.claude/settings.json`

**关键规则**：
- 修改翻译时，只改 `verbs/zh-CN.json` 或 `tips/zh-CN.json`
- 禁止把 verbs 或 tips 的内容复制到 `settings-overlay.json`
- `cli-translations.json` 独立维护，不与 verbs/tips 重复

## Payload 镜像规则

下列文件在**根目录**和 **`plugin/` 下**各存一份，发布时必须严格一致：

- `patch-cli.sh` / `patch-cli.js`
- `cli-translations.json`
- `bun-binary-io.js`
- `compute-patch-revision.sh`

**铁律**：
- **根目录是编辑源头**，`plugin/` 下的同名文件只是安装包 payload 镜像
- 不要单独手改 `plugin/cli-translations.json` / `plugin/patch-cli.js` 等镜像
- 改完根目录源文件后，必须运行 `bash scripts/sync-payload.sh` 同步镜像
- CI 有两道闸：`scripts/check-payload-sources.js` 拦截只改镜像不改源、`tests/plugin-payload.test.js` 拦截内容不一致

## 支持窗口与上游版本

`plugin/support-window.json` 是 native binary patch 的**版本白名单**——only 列在 `versions` 里的版本会被 `auto-repatch.sh` 处理。

**Claude Code 升级到新版本时（npm 自动更新）**：
1. 旧版本不在 white list → `is_supported_native_version` 返回 false → hook 静默跳过 patch
2. 用户界面回到英文，看似"汉化失效"，其实是 support-window 没跟上

**应对**：每次 Claude Code 发布新版本，需手动追加版本号到对应平台的 `versions` 数组并升 `ceiling`（windowsNativeExperimental / macosNativeExperimental / linuxNativeExperimental）。修改后跑 `node scripts/check-support-boundary.js` 验证。

## 技术实现细节

### CLI Patch 机制
- **内容匹配**：匹配英文原文，不依赖变量名，跨版本稳定
- **替换顺序**：按字符串长度**降序**替换（长字符串优先，避免子串冲突）
- **字符处理**：cli.js 里的省略号是真实 U+2026 字符，不是转义序列
- **中文编码**：node -e 在 bash 单引号里，用 Unicode 转义写中文，避免引号嵌套

### 自动 Patch 检测
- **指纹计算**：对关键文件（manifest.json、patch-cli.sh、cli-translations.json 等）计算 SHA256，取前 16 位
- **版本标记**：npm 安装记录 `version|patch_revision`，native 安装记录 `native|version|binary_hash|patch_revision`
- **触发时机**：
  - SessionStart hook 检测 cli.js 版本变更
  - 检测到英文残留（probe strings）时强制重新 patch
  - npm 更新后首次启动自动修复

### Native Binary 支持
- **提取**：使用 `node-lief` 从 Bun 打包的二进制中提取 JavaScript
- **重打包**：patch 后重新打包回二进制
- **备份机制**：同版本时恢复 backup 保证干净基底，版本变化时刷新 backup
- **支持范围**：
  - Windows PE 二进制（v2.1.131+，已验证）
  - macOS Mach-O 二进制（experimental，旧版本）
  - Linux ELF 二进制（experimental）

### Windows 替换运行中 .exe 的陷阱
Windows 不允许 `unlink` 或 `copyFileSync` 覆盖正在运行的 `claude.exe`（EBUSY/EPERM），但允许 `rename`。所以 hook 内 `auto-repatch.sh` 的写法是先 rename 旧文件、再写新内容、最后释放旧 inode。

如果手动修复 binary 时遇到 EBUSY：
```js
// rename trick：先把运行中的 binary 挪到 .in-use-<ts>，再写新文件
fs.renameSync(LIVE, LIVE + '.in-use-' + Date.now());
fs.copyFileSync(PATCHED, LIVE);
```

**陷阱**：`auto-repatch.sh` 在 marker 不匹配时会先 `mv backup → live` 做"干净基底"。如果 backup 内容是英文版（首次安装时拷贝的），这步会把已 patch 的中文版回滚成英文。所以 backup 应该和 live 保持一致状态。

### npm 安装下的多副本同步
npm 安装的 Windows binary 实际有 4 处副本/链接，patch 时需要全部覆盖：
1. `<nvm>/node_modules/@anthropic-ai/claude-code/bin/claude.exe` — `claude.ps1` 直接调用
2. `<nvm>/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe` — 与 #1 hard link
3. `<nvm>/node_modules/@anthropic-ai/.claude-code-<hash>/...` — npm staging 副本（不是 hard link）
4. `<live>.zh-cn-backup` — auto-repatch 的"干净基底"

### 自动更新机制
- **检查频率**：每 6 小时检查一次 GitHub Release
- **更新流程**：检测到新版本后自动 `git pull` 并重新运行 `install.sh --update-only`
- **禁用方式**：设置环境变量 `ZH_CN_DISABLE_AUTO_UPDATE=1`

### Hook 系统
- **SessionStart**：匹配 `startup|resume|clear|compact` 事件，注入中文上下文，执行自动 patch 检测
- **Notification**：拦截所有通知消息，翻译后输出（10 秒超时）

## 术语约定

保留英文的技术术语（不翻译）：
- Hook（不是"钩子"）
- API、PR、MCP、CLI
- spinner、patch、plugin

## 平台兼容性

### Windows
- 原生 Windows 支持（PowerShell / Git Bash / cmd 均可），不强依赖 WSL
- NTFS 锁定运行中的 .exe — patch 用 `fs.renameSync` 挪走旧文件再写新内容
- 提供 `install.ps1` PowerShell 安装脚本

### macOS
- 支持 npm 安装（2.1.112）
- 支持官方安装器（2.1.110-2.1.126，需要 `node-lief`）
- Native binary patch 属于 experimental

### Linux
- 支持 npm 安装
- 支持官方安装脚本（需要 `node-lief`）
- Native binary patch 属于 experimental（2.1.126）

## 版本发布流程

每完成一批有意义的改动后，按以下步骤发布新版本：

1. **升版本号** — 修改 `plugin/manifest.json` 里的 `version`（语义化版本）
2. **更新 CHANGELOG** — 在 `CHANGELOG.md` 顶部新增版本段落，分"新增/改进/修复"
3. **提交** — `git commit -m "chore: release vX.Y.Z"`
4. **打 tag** — `git tag vX.Y.Z`
5. **推送** — `git push origin main --tags`
6. **发 Release** — `gh release create vX.Y.Z --title "vX.Y.Z" --notes "$(从 CHANGELOG.md 提取变更摘要)"`

## 常见开发任务

### 添加新的 UI 翻译
1. 在 `cli-translations.json` 中添加 `{"en": "原文", "zh": "译文"}` 条目
2. 运行 `./patch-cli.sh <cli.js路径>` 测试
3. 如果修改了 patch 逻辑，更新 `compute-patch-revision.sh` 中的文件列表

### 修改 spinner 动词或提示
1. 编辑 `verbs/zh-CN.json` 或 `tips/zh-CN.json`
2. 运行 `./install.sh` 重新安装
3. 重启 Claude Code 验证

### 调试 Hook
1. Hook 输出会显示在 Claude Code 会话中
2. 检查 `~/.claude/plugins/claude-code-zh-cn/.patched-version` 查看当前 patch 状态
3. 手动触发 repatch：删除 `.patched-version` 文件后重启会话

### 测试不同安装方式
```bash
# npm 安装测试
npm install -g @anthropic-ai/claude-code@2.1.112
./install.sh

# 检测安装类型
node plugin/bun-binary-io.js detect "$(which claude)"

# 查看 patch 状态
cat ~/.claude/plugins/claude-code-zh-cn/.patched-version
```

## 故障排查

### CLI Patch 未生效
1. 检查 `.patched-version` 文件是否存在
2. 手动运行 `./patch-cli.sh $(which claude)/../lib/node_modules/@anthropic-ai/claude-code/cli.js`
3. 查看是否有英文残留：`grep "Quick safety check" <cli.js路径>`

### 自动更新失败
1. 检查 `.last-update-check` 文件时间戳
2. 手动运行 `git pull` 测试网络连接
3. 设置 `ZH_CN_DISABLE_AUTO_UPDATE=1` 禁用自动更新

### Native Binary Patch 失败
1. 确认已安装 `node-lief`：`npm list -g node-lief`
2. 看 binary 版本：`node plugin/bun-binary-io.js version $(which claude)`，确认 >= `support-window.json` 里对应平台的 `floor`（floor-only 模式下高于 floor 都视为支持）
3. 查看备份文件：`ls -la $(which claude).zh-cn-backup`
4. 如果 binary 大小或 hash 突变 → 多半是 Claude Code 自动更新到新版本。先看 hook 是否已经自动重 patch（`cat ~/.claude/plugins/claude-code-zh-cn/.patched-version`）；如果 hook 没跟上，按下文「Claude Code 升版后手动救火 SOP」走
5. 看 marker：`cat ~/.claude/plugins/claude-code-zh-cn/.patched-version` —— 格式 `native|<version>|<full_sha256>|<patch_revision>`，与 hook 实时计算结果完全一致才会跳过 repatch

## Claude Code 升版后手动救火 SOP

**适用场景**：Claude Code 经 npm 自动更新跳到新版本，hook 没自动 repatch（marker 版本号停在旧值，界面回到英文）。floor-only 模式下大多数升级 hook 应自行处理，本节只在 hook 失效时使用。

### 零、一键脚本（首选，bash / PowerShell / cmd 都能跑）

```bash
# 项目根目录下，PowerShell / Git Bash / cmd 都直接调用，参数自动探测
node scripts/manual-repatch.js              # 跑完整流程
node scripts/manual-repatch.js --dry-run    # 只摸排状态、不改文件
node scripts/manual-repatch.js --skip-replace  # patch 但不替换 LIVE（调试用）
```

脚本内部完成的事和下文「一～六」六步等价，且：
- 自动从 `claude` 命令解析出 LIVE 路径
- 自动派生 HARDLINK / BACKUP 路径
- 自动 floor-only 支持判断、版本探测
- 内部走 `extract → patch → repack → rename trick → 刷 BACKUP → 写 marker`
- marker 已和 LIVE 一致时早退、不做无用功
- 失败有明确退出码（0=成功/无需 patch、1=patch 失败、2=输入错）

**仅当脚本报错或环境特殊（非 native-bun 安装、自定义路径）时**，才落到下面手动六步。

### 一、状态摸排（先看清楚再动手）

```bash
# 1. 当前 binary 版本
claude --version

# 2. 安装类型 + LIVE 路径
node ~/.claude/plugins/claude-code-zh-cn/bun-binary-io.js detect "$(which claude)"
# 输出形如 native-bun:<LIVE 路径>，记下 $LIVE

# 3. 几处副本状态（Windows npm 安装 4 处都要确认）
LIVE='<上一步 LIVE 路径>'
HARDLINK='<同 npm node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe>'
ls -la "$LIVE" "$HARDLINK" "${LIVE}.zh-cn-backup" 2>&1

# 4. marker 当前值
cat ~/.claude/plugins/claude-code-zh-cn/.patched-version

# 5. floor-only 是否认这个版本
PLUGIN_ROOT=~/.claude/plugins/claude-code-zh-cn source $PLUGIN_ROOT/lib/common.sh
is_supported_native_version "$(claude --version | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+')" && echo OK || echo BLOCKED
```

如果 step 5 输出 BLOCKED → 升级到了一个低于 floor 的版本（不太可能），需要更新 `support-window.json` 的 floor。

### 二、Extract → Patch → Repack（救火主流程）

你现在不用再手动跑任何东西——退出当前 PowerShell 里的 Claude Code 会话，重新启动一次，界面就是中文。下次再升版 hook
  ▎ 没跟上，一行 node scripts/manual-repatch.js 就完事了，不用再翻文档对照命令。

```bash
cd D:/Third_Party_Servers/02_Daily_APPs/04_Tools/claude-code-zh-cn

# Windows mingw 下 /tmp 实际指向 %LOCALAPPDATA%\Temp，node 不能识别 mingw 路径
# 给 node 喂 Windows 风格路径
WORK='C:/Users/27783/AppData/Local/Temp/claude-work.exe'
TMP_JS='C:/Users/27783/AppData/Local/Temp/claude-work.js'

# 1. 拷一份 LIVE 到工作区（绝不要直接改 LIVE）
cp "$LIVE" "$WORK"

# 2. 抽出内嵌 JS
node plugin/bun-binary-io.js extract "$WORK" "$TMP_JS"
# 期望输出 ok，TMP_JS 大小 ~15MB

# 3. 跑翻译表 patch（成功则打印 patch 数量，应该 >0）
./patch-cli.sh "$TMP_JS"

# 4. 重打包回 binary
node plugin/bun-binary-io.js repack "$WORK" "$TMP_JS"

# 5. 抽查 WORK 含中文串
node -e '
  const buf = require("fs").readFileSync(process.argv[1]);
  const s = buf.toString("utf8");
  for (const p of ["编辑文件", "此命令需要批准"]) {
    console.log(p, "->", (s.match(new RegExp(p, "g")) || []).length);
  }
' "$WORK"
# 任何一个 > 0 即视为 patch 成功
```

### 三、Rename Trick 替换运行中的 binary

Windows NTFS 不让 `unlink`/`copyFileSync` 覆盖运行中的 `.exe`（EBUSY），但允许 `rename`。**LIVE 和 HARDLINK 都要换，否则 PowerShell launcher 走 LIVE、其他入口走 HARDLINK 会出现一半中文一半英文。**

```bash
node -e '
  const fs = require("fs");
  const [live, hardlink, work] = process.argv.slice(1);
  function replace(target) {
    const stash = target + ".in-use-" + Date.now();
    fs.renameSync(target, stash);          // 把运行中的旧 binary 挪走
    fs.copyFileSync(work, target);         // 写新 binary
    try { fs.unlinkSync(stash); }          // 试着回收旧 inode
    catch { /* 进程还占着就先留着，下次重启自动清理 */ }
    console.log("replaced:", target);
  }
  replace(live);
  replace(hardlink);
' "$LIVE" "$HARDLINK" "$WORK"
```

### 四、刷 BACKUP 和 marker（防止 hook 反向回滚）

`auto-repatch.sh` 在 marker 不一致时会先 `mv backup → live` 做"干净基底"。如果 BACKUP 是英文版（npm 安装时存的那份），这步会把刚 patch 的中文版反向回滚。**BACKUP 必须和 LIVE 同一份中文 binary。**

```bash
# 1. BACKUP 直接拿 WORK 覆盖
cp "$WORK" "${LIVE}.zh-cn-backup"

# 2. 算新 marker（必须用 LIVE 插件目录的 patch_revision，hook 跑的就是它）
PLUGIN_ROOT=~/.claude/plugins/claude-code-zh-cn
source $PLUGIN_ROOT/compute-patch-revision.sh
REV=$(compute_patch_revision "$PLUGIN_ROOT")
HASH=$(node $PLUGIN_ROOT/bun-binary-io.js hash "$WORK")
VERSION=$(claude --version | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+')
echo "native|$VERSION|$HASH|$REV" > $PLUGIN_ROOT/.patched-version
cat $PLUGIN_ROOT/.patched-version
```

### 五、端到端验证

```bash
# 1. LIVE hash 与 marker 第三段一致 → hook 下次跳过 repatch
node ~/.claude/plugins/claude-code-zh-cn/bun-binary-io.js hash "$LIVE"
cat ~/.claude/plugins/claude-code-zh-cn/.patched-version

# 2. LIVE 和 BACKUP 都含中文串
for f in "$LIVE" "${LIVE}.zh-cn-backup"; do
  node -e '
    const buf = require("fs").readFileSync(process.argv[1]);
    console.log(process.argv[1], "编辑文件:", (buf.toString("utf8").match(/编辑文件/g) || []).length);
  ' "$f"
done

# 3. 清理工作文件
rm -f "$WORK" "$TMP_JS"
```

### 六、最后退出当前 Claude Code 会话，重新启动验证 UI

如果重启后界面还是英文，按以下顺序排查：
- LIVE hash != marker 第三段：marker 写错了，重做第四步
- LIVE 含 `编辑文件` = 0：repack 写入失败或 patch 数量为 0，回到第二步看 patch-cli 输出
- 仅部分英文残留：上游新增字符串没在 `cli-translations.json` 里，按"添加新的 UI 翻译"流程补条目（不影响整体可用性）

### 关键陷阱清单（踩过的坑都在这里）

- **mingw `/tmp` ≠ Windows `D:\tmp`**：node 走 Windows 路径 API，必须用 `C:/Users/<u>/AppData/Local/Temp/...` 这种带盘符的形式
- **HARDLINK 与 LIVE 不是同一个 inode**：Windows hard link 看着像 link，rename trick 要分别对两个路径各做一次
- **STAGING 副本不是 hard link**：`<nvm>/node_modules/@anthropic-ai/.claude-code-<hash>/` 下的副本 npm 升级时会重建，不需要手动 patch（但要意识到它存在）
- **BACKUP 是英文版 = 定时炸弹**：首次 npm 安装时 hook 把英文 binary 拷成 `.zh-cn-backup`，下一次版本变更 hook 检测到 marker 不一致就用这份英文版覆盖 LIVE，看起来"汉化失效"。BACKUP 的状态必须和 LIVE 一致
- **`compute_patch_revision` 是 function 不是脚本**：直接执行 `compute-patch-revision.sh` 没有输出，必须 `source` 后调用函数
- **marker 用错 PLUGIN_ROOT 也会反复 repatch**：source repo 的 plugin/ 和 live `~/.claude/plugins/...` 算出的 revision 不同（manifest 版本号、common.sh 内容差异都会导致 hash 不同），写 marker 必须用 hook 实际加载的那个目录
