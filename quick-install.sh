#!/usr/bin/env bash
# quick-install.sh - 一键安装 Claude Code 界面汉化插件
# 用法: curl -fsSL https://raw.githubusercontent.com/KongBai1145/claude-code-zh-cn/main/quick-install.sh | bash

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO_URL="https://github.com/KongBai1145/claude-code-zh-cn.git"
INSTALL_DIR="${ZH_CN_INSTALL_DIR:-$HOME/.claude/claude-code-zh-cn}"
TEMP_DIR=""

# 清理函数
cleanup() {
    if [ -n "${TEMP_DIR:-}" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
}
trap cleanup EXIT

# 打印带颜色的消息
info() { echo -e "${BLUE}$*${NC}"; }
success() { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }
error() { echo -e "${RED}$*${NC}" >&2; }

# 检查命令是否存在
command_exists() {
    command -v "$1" &>/dev/null
}

# 检查并安装依赖
check_and_install_deps() {
    local missing_deps=()

    # 检查 git
    if ! command_exists git; then
        missing_deps+=("git")
    fi

    # 检查 node
    if ! command_exists node; then
        missing_deps+=("node")
    fi

    # 检查 npm
    if ! command_exists npm; then
        missing_deps+=("npm")
    fi

    if [ ${#missing_deps[@]} -gt 0 ]; then
        error "错误：缺少以下依赖："
        for dep in "${missing_deps[@]}"; do
            echo "  - $dep"
        done
        echo ""
        echo "请先安装这些依赖后再运行此脚本。"
        echo ""
        echo "安装建议："
        echo "  macOS:   brew install git node"
        echo "  Ubuntu:  sudo apt install git nodejs npm"
        echo "  Windows: 请在 WSL 中运行此脚本"
        exit 1
    fi
}

# 检查 Claude Code 是否已安装
check_claude_installed() {
    if ! command_exists claude; then
        warn "提示：未检测到 Claude Code CLI"
        echo "  请先安装 Claude Code："
        echo "  npm install -g @anthropic-ai/claude-code@2.1.112"
        echo ""
        # 非 TTY 环境直接继续（curl | bash 场景）
        if [ -t 0 ]; then
            read -p "是否继续安装界面汉化插件？(y/N) " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 0
            fi
        fi
    fi
}

# 主安装流程
main() {
    echo ""
    info "=== Claude Code 界面汉化插件 一键安装 ==="
    echo ""

    # 检查依赖
    info "检查系统依赖..."
    check_and_install_deps
    success "依赖检查通过"
    echo ""

    # 检查 Claude Code
    check_claude_installed

    # 创建临时目录
    TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cczh-install.XXXXXX")"
    info "正在下载插件..."

    # 克隆仓库
    if ! git clone --depth 1 "$REPO_URL" "$TEMP_DIR/claude-code-zh-cn" 2>/dev/null; then
        error "错误：下载失败，请检查网络连接"
        echo "  也可以手动克隆："
        echo "  git clone $REPO_URL"
        exit 1
    fi
    success "下载完成"
    echo ""

    # 运行安装脚本
    info "开始安装..."
    echo ""
    cd "$TEMP_DIR/claude-code-zh-cn"
    bash install.sh

    # 复制到安装目录（可选，用于后续更新）
    if [ "${ZH_CN_KEEP_INSTALL_DIR:-0}" = "1" ]; then
        mkdir -p "$(dirname "$INSTALL_DIR")"
        cp -r "$TEMP_DIR/claude-code-zh-cn" "$INSTALL_DIR"
        echo ""
        info "插件已保存到: $INSTALL_DIR"
        echo "  后续更新可运行：cd $INSTALL_DIR && git pull && ./install.sh"
    fi
}

main "$@"
