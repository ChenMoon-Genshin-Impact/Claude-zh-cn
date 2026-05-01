<div align="center">

# claude-code-zh-cn

**Claude Code 简体中文本地化插件**

让终端里的 AI 编程助手说中文 🇨🇳

[![GitHub](https://img.shields.io/badge/GitHub-KongBai1145%2Fclaude--code--zh--cn-blue?logo=github)](https://github.com/KongBai1145/claude-code-zh-cn)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Version](https://img.shields.io/github/v/tag/KongBai1145/claude-code-zh-cn?label=Version&color=blue)](https://github.com/KongBai1145/claude-code-zh-cn/releases)

**一键安装 · 自动更新 · 卸载不丢配置**

</div>

---

## 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/KongBai1145/claude-code-zh-cn/main/quick-install.sh | bash
```

> 安装脚本会自动检测你的系统和 Claude Code 版本，无需手动选择。

## 效果预览

| 安装前 | 安装后 |
|--------|--------|
| `⠙ Photosynthesizing...` | `⠙ 光合作用中...` |
| `⠙ Thinking...` | `⠙ 思考中...` |
| `Tip: Press Shift+Tab...` | `💡 按 Shift+Tab 切换模式` |

187 个趣味 spinner 动词，41 条中文提示，AI 默认中文回复。**装完即用。**

---

## 支持的安装方式

| 你的安装方式 | 支持情况 | 需要操作 |
|-------------|---------|---------|
| `npm install -g @anthropic-ai/claude-code@2.1.112` | ✅ 完整支持 | 一键安装即可 |
| `curl -fsSL https://claude.ai/install.sh \| bash -s 2.1.112` | ✅ 支持 | 需要 `npm install -g node-lief` |
| macOS 官方安装器 (2.1.110-2.1.112) | ✅ 支持 | 需要 `npm install -g node-lief` |
| macOS native (2.1.113-2.1.126) | ✅ 支持 | 需要 `npm install -g node-lief` |
| `curl -fsSL https://claude.ai/install.sh \| bash` (Linux) | ✅ 支持 | 需要 `npm install -g node-lief` |
| Linux native (2.1.126) | ✅ 支持 | 需要 `npm install -g node-lief` |
| Windows PowerShell | ✅ 支持 | 使用 `install.ps1` |
| 其他版本 | ⚠️ 部分支持 | 设置和 Hook 生效，UI 翻译可能不完整 |

> 💡 **不确定用哪个版本？** 运行 `npm install -g @anthropic-ai/claude-code@2.1.112` 安装最稳定的版本。
>
> 💡 **用官方安装脚本装的？** 没问题！本插件支持 `curl -fsSL https://claude.ai/install.sh | bash` 安装的 Claude Code，需要先安装 `node-lief`。

---

## 手动安装

<details>
<summary>macOS / Linux</summary>

```bash
git clone https://github.com/KongBai1145/claude-code-zh-cn.git
cd claude-code-zh-cn
./install.sh
```
</details>

<details>
<summary>Windows PowerShell</summary>

```powershell
git clone https://github.com/KongBai1145/claude-code-zh-cn.git
cd claude-code-zh-cn
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
```
</details>

---

## 更新

### 自动更新

插件每 6 小时检查一次更新，自动同步到最新版本。**无需任何配置，安装即生效。**

禁用自动更新：设置环境变量 `ZH_CN_DISABLE_AUTO_UPDATE=1`

### 手动更新

```bash
cd claude-code-zh-cn
git pull
./install.sh
```

## 卸载

```bash
cd claude-code-zh-cn
./uninstall.sh
```

精准移除插件注入的设置，保留你的其他配置不变。

---

## 特色功能

| 功能 | 说明 |
|------|------|
| 🌐 **AI 中文回复** | 默认使用简体中文回复 |
| 🎨 **187 个趣味动词** | `光合作用中`、`七荤八素中`、`蹦迪中`... |
| 💬 **41 条中文提示** | 等待提示、快捷键说明等 |
| 🔄 **自动修复** | Claude Code 更新后自动重新翻译 |
| 📦 **自动更新** | 插件发布新版本后自动同步 |
| 🛡️ **安全卸载** | 一键卸载，不破坏原有配置 |

---

## 技术原理

<details>
<summary>点击展开</summary>

本插件通过四层机制实现中文化：

1. **设置注入** - 修改 `settings.json`，设置语言和 spinner
2. **Hook 系统** - 会话启动时注入中文上下文
3. **插件系统** - 提供中文输出风格
4. **CLI Patch** - 直接翻译 UI 硬编码文字

Layer 1-3 不受 Claude Code 更新影响，Layer 4 会自动重新翻译。

</details>

---

## FAQ

<details>
<summary>Claude Code 更新后会失效吗？</summary>

不会。插件会自动检测版本变更并重新翻译。
</details>

<details>
<summary>会不会破坏原有功能？</summary>

不会。安装前会自动备份，卸载可一键恢复。
</details>

<details>
<summary>支持哪些系统？</summary>

macOS、Linux、Windows（PowerShell 或 WSL）。需要 Node.js。
</details>

---

## 贡献

欢迎 PR！

- 翻译改进 → 编辑 `tips/zh-CN.json` 或 `verbs/zh-CN.json`
- Bug 反馈 → [提交 Issue](https://github.com/KongBai1145/claude-code-zh-cn/issues)

---

## 致谢

- 原项目：[taekchef/claude-code-zh-cn](https://github.com/taekchef/claude-code-zh-cn) - 感谢原作者的辛勤工作
- UI 字符串提取自 [Claude Code](https://github.com/anthropics/claude-code)

---

## 与原项目的改进

本项目基于 [taekchef/claude-code-zh-cn](https://github.com/taekchef/claude-code-zh-cn) 进行了优化：

| 改进项 | 原项目 | 本项目 |
|--------|--------|--------|
| 安装方式 | 需要 git clone | **一键 curl 安装** |
| 依赖管理 | 手动安装 | **自动检测并提示** |
| 安装引导 | 无 | **交互式向导** |
| 版本支持 | macOS 2.1.123 | **macOS 2.1.126 + Linux** |

---

## 许可证

[MIT](./LICENSE)

*本项目不是 Anthropic 官方产品。Claude Code 是 Anthropic Inc. 的商标。*
