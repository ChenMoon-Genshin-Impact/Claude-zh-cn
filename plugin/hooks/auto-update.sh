#!/usr/bin/env bash
# auto-update.sh - 自动更新逻辑
# 检测插件 Release 更新并同步安装态

# 前置条件：调用方需设置以下变量
# - PLUGIN_ROOT
# - SOURCE_REPO_FILE
# - LAST_UPDATE_CHECK_FILE
# - UPDATE_CHECK_INTERVAL_SECONDS

read_source_repo() {
    if [ ! -f "$SOURCE_REPO_FILE" ]; then
        return
    fi

    tr -d '\r' < "$SOURCE_REPO_FILE"
}

touch_update_check_timestamp() {
    date +%s > "$LAST_UPDATE_CHECK_FILE" 2>/dev/null || true
}

should_check_for_update() {
    local source_repo="$1"
    local interval now last

    [ "${ZH_CN_DISABLE_AUTO_UPDATE:-0}" = "1" ] && return 1

    interval="$UPDATE_CHECK_INTERVAL_SECONDS"
    case "$interval" in
        ''|*[!0-9]*)
            interval="21600"
            ;;
    esac

    if [ "$interval" = "0" ]; then
        return 0
    fi

    now="$(date +%s 2>/dev/null || echo "0")"
    last="$(cat "$LAST_UPDATE_CHECK_FILE" 2>/dev/null || echo "0")"

    case "$now" in
        ''|*[!0-9]*) now="0" ;;
    esac
    case "$last" in
        ''|*[!0-9]*) last="0" ;;
    esac

    [ $((now - last)) -ge "$interval" ]
}

fetch_latest_release_tag() {
    local source_repo="$1"

    # 方式一：从本地仓库获取（如果存在）
    if [ -n "$source_repo" ] && [ -d "$source_repo/.git" ]; then
        if command -v timeout &>/dev/null; then
            GIT_TERMINAL_PROMPT=0 timeout 15 git -C "$source_repo" fetch --tags --quiet >/dev/null 2>&1 || true
        else
            local pid
            GIT_TERMINAL_PROMPT=0 git -C "$source_repo" fetch --tags --quiet >/dev/null 2>&1 &
            pid=$!
            local waited=0
            while [ $waited -lt 15 ]; do
                if ! kill -0 "$pid" 2>/dev/null; then
                    wait "$pid" 2>/dev/null || true
                    break
                fi
                sleep 1
                waited=$((waited + 1))
            done
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
                wait "$pid" 2>/dev/null || true
            fi
        fi
        local tag
        tag="$(git -C "$source_repo" tag -l 'v*' --sort=-version:refname | head -1)"
        [ -n "$tag" ] && echo "$tag" && return
    fi

    # 方式二：从 GitHub API 获取（无需本地仓库）
    local repo_url="https://api.github.com/repos/KongBai1145/claude-code-zh-cn/releases/latest"
    if command -v curl &>/dev/null; then
        local tag
        tag="$(curl -s "$repo_url" 2>/dev/null | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"v\?\([^"]*\)".*/v\1/' | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+$')"
        [ -n "$tag" ] && echo "$tag" && return
    elif command -v wget &>/dev/null; then
        local tag
        tag="$(wget -qO- "$repo_url" 2>/dev/null | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"v\?\([^"]*\)".*/v\1/' | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+$')"
        [ -n "$tag" ] && echo "$tag" && return
    fi
}

export_release_to_staging() {
    local source_repo="$1"
    local latest_tag="$2"
    local staging_dir="$3"

    mkdir -p "$staging_dir"

    # 方式一：从本地仓库导出（如果存在）
    if [ -n "$source_repo" ] && [ -d "$source_repo/.git" ]; then
        GIT_TERMINAL_PROMPT=0 git -C "$source_repo" archive --format=tar "$latest_tag" install.sh install.ps1 compute-patch-revision.sh settings-overlay.json verbs tips plugin 2>/dev/null \
            | tar -xf - -C "$staging_dir" 2>/dev/null && return 0
    fi

    # 方式二：从 GitHub 下载（无需本地仓库）
    local download_url="https://github.com/KongBai1145/claude-code-zh-cn/archive/refs/tags/${latest_tag}.tar.gz"
    if command -v curl &>/dev/null; then
        curl -sL "$download_url" 2>/dev/null | tar -xzf - -C "$staging_dir" --strip-components=1 2>/dev/null && return 0
    elif command -v wget &>/dev/null; then
        wget -qO- "$download_url" 2>/dev/null | tar -xzf - -C "$staging_dir" --strip-components=1 2>/dev/null && return 0
    fi

    return 1
}

validate_staging_release() {
    local staging_dir="$1"

    [ -f "$staging_dir/install.sh" ] || return 1
    [ -f "$staging_dir/settings-overlay.json" ] || return 1
    [ -f "$staging_dir/plugin/manifest.json" ] || return 1
    [ -f "$staging_dir/plugin/patch-cli.sh" ] || return 1
    [ -f "$staging_dir/plugin/patch-cli.js" ] || return 1
    [ -f "$staging_dir/plugin/cli-translations.json" ] || return 1
    [ -f "$staging_dir/plugin/bun-binary-io.js" ] || return 1
    [ -f "$staging_dir/plugin/compute-patch-revision.sh" ] || return 1
    [ -f "$staging_dir/compute-patch-revision.sh" ] || return 1
    [ -f "$staging_dir/verbs/zh-CN.json" ] || return 1
    [ -f "$staging_dir/tips/zh-CN.json" ] || return 1
}

run_update_only_install() {
    local staging_dir="$1"
    local source_repo="$2"

    CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
    ZH_CN_SOURCE_REPO="$source_repo" \
    ZH_CN_SKIP_BANNER=1 \
    bash "$staging_dir/install.sh" --update-only >/dev/null 2>&1
}

validate_semver() {
    echo "$1" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9._]+)?$'
}

write_update_status() {
    echo "$1" > "$PLUGIN_ROOT/.last-update-status"
}

read_manifest_version() {
    local target="$1"
    node - "$target" <<'NODE'
const fs = require("fs");

try {
    const file = process.argv[2];
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    process.stdout.write(String(data.version || ""));
} catch {
    process.stdout.write("");
}
NODE
}

version_is_newer() {
    local current_version="$1"
    local latest_version="$2"

    node - "$current_version" "$latest_version" <<'NODE'
function parse(version) {
    return String(version || "")
        .split(".")
        .map((part) => {
            const n = Number.parseInt(part, 10);
            return Number.isFinite(n) ? n : 0;
        });
}

function compare(a, b) {
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i += 1) {
        const left = a[i] || 0;
        const right = b[i] || 0;
        if (left > right) return 1;
        if (left < right) return -1;
    }
    return 0;
}

const current = parse(process.argv[2]);
const latest = parse(process.argv[3]);
process.exit(compare(latest, current) > 0 ? 0 : 1);
NODE
}

# 主逻辑：检查并执行自动更新
# 返回值：通过 AUTO_UPDATE_MSG 变量传递更新消息
check_and_update() {
    AUTO_UPDATE_MSG=""
    local source_repo
    source_repo="$(read_source_repo)"

    if ! should_check_for_update "$source_repo"; then
        return
    fi

    touch_update_check_timestamp

    local local_version latest_tag latest_version
    local_version="$(read_manifest_version "$PLUGIN_ROOT/manifest.json" 2>/dev/null || true)"
    latest_tag="$(fetch_latest_release_tag "$source_repo" 2>/dev/null || true)"
    latest_version="${latest_tag#v}"

    if [ -n "${latest_tag:-}" ] && [ -n "${local_version:-}" ] && [ -n "${latest_version:-}" ] \
        && validate_semver "$local_version" && validate_semver "$latest_version" \
        && version_is_newer "$local_version" "$latest_version"; then
        local staging_dir
        staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/cczh-update.XXXXXX")"

        if ! export_release_to_staging "$source_repo" "$latest_tag" "$staging_dir"; then
            write_update_status "export_failed v${latest_version} $(date +%s)"
        elif ! validate_staging_release "$staging_dir"; then
            write_update_status "staging_invalid v${latest_version} $(date +%s)"
        elif ! run_update_only_install "$staging_dir" "$source_repo"; then
            write_update_status "install_failed v${latest_version} $(date +%s)"
        else
            write_update_status "ok v${latest_version} $(date +%s)"
            AUTO_UPDATE_MSG="插件已从 v${local_version} 更新到 v${latest_version}"
        fi

        # 清理临时目录
        [ -d "${staging_dir:-}" ] && rm -rf "$staging_dir"
    else
        write_update_status "noop v${local_version:-unknown} $(date +%s)"
    fi
}
