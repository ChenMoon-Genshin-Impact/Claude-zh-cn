#!/usr/bin/env bash
# common.sh - 共享函数库
# 被 install.sh 和 hooks/session-start 共同引用
# 前置条件：调用方需设置 $PLUGIN_ROOT 指向 plugin/ 目录

native_binary_version() {
    local binary_path="$1"
    local version output temp_home

    version="$(node "$PLUGIN_ROOT/bun-binary-io.js" version "$binary_path" 2>/dev/null || true)"
    if [ -n "${version:-}" ]; then
        printf '%s' "$version"
        return
    fi

    temp_home="$(mktemp -d "${TMPDIR:-/tmp}/cczh-version-home.XXXXXX" 2>/dev/null || true)"
    if [ -n "${temp_home:-}" ]; then
        output="$(HOME="$temp_home" XDG_CONFIG_HOME="$temp_home/.config" XDG_CACHE_HOME="$temp_home/.cache" XDG_DATA_HOME="$temp_home/.local/share" "$binary_path" --version 2>/dev/null || true)"
        rm -rf "$temp_home" 2>/dev/null || true
    else
        output="$("$binary_path" --version 2>/dev/null || true)"
    fi

    printf '%s' "$output" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true
}

is_supported_native_version() {
    local version="$1"
    local support_file="$PLUGIN_ROOT/support-window.json"

    if [ ! -f "$support_file" ]; then
        # 无配置文件时直接返回不支持
        return 1
    fi

    local os_kind
    case "$(uname -s 2>/dev/null || echo unknown)" in
        Darwin) os_kind="darwin" ;;
        Linux) os_kind="linux" ;;
        MINGW*|MSYS*|CYGWIN*|Windows_NT) os_kind="win32" ;;
        *) os_kind="unknown" ;;
    esac

    node - "$support_file" "$version" "$os_kind" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const version = process.argv[3];
const osKind = process.argv[4];
const data = JSON.parse(fs.readFileSync(file, "utf8"));

function parse(v) {
  if (!v || typeof v !== "string") return null;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

const groups = {
  darwin: [data.macosNativeOfficialInstallerExperimental, data.macosNativeExperimental],
  linux: [data.linuxNativeExperimental],
  win32: [],
};

const entries = (groups[osKind] || [
  data.macosNativeOfficialInstallerExperimental,
  data.macosNativeExperimental,
  data.linuxNativeExperimental,
]).filter(Boolean);

const cur = parse(version);
if (!cur) process.exit(1);

for (const entry of entries) {
  const floor = parse(entry.floor);
  if (!floor) continue;
  if (cmp(cur, floor) < 0) continue;
  // floor-only 模式：>= floor 即视为支持，无需在 versions 列表里
  // 兼容老逻辑：excluded 列表里的版本仍然跳过
  if (Array.isArray(entry.excluded) && entry.excluded.includes(version)) continue;
  // ceiling 不再硬截断（保留字段仅供参考）
  process.exit(0);
}
process.exit(1);
NODE
}

native_binary_hash() {
    local binary_path="$1"
    node "$PLUGIN_ROOT/bun-binary-io.js" hash "$binary_path" 2>/dev/null || printf "unknown"
}

find_real_claude_binary() {
    if [ -n "${ZH_CN_REAL_CLAUDE:-}" ] && [ -x "${ZH_CN_REAL_CLAUDE:-}" ]; then
        printf "%s" "$ZH_CN_REAL_CLAUDE"
        return
    fi

    local filtered_path=""
    local path_entry
    local old_ifs="$IFS"
    IFS=':'
    for path_entry in ${PATH:-}; do
        if [ "${path_entry:-}" = "$LAUNCHER_BIN_DIR" ]; then
            continue
        fi
        if [ -z "$filtered_path" ]; then
            filtered_path="$path_entry"
        else
            filtered_path="${filtered_path}:$path_entry"
        fi
    done
    IFS="$old_ifs"

    PATH="$filtered_path" command -v claude 2>/dev/null || true
}
