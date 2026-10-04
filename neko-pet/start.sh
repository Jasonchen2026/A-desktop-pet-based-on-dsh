#!/usr/bin/env bash
# 小白的 Linux 启动脚本，等价于 Windows 的 start.vbs
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

if ! command -v node >/dev/null 2>&1; then
  echo "没找到 node，请先安装 Node.js LTS" >&2
  exit 1
fi

ELECTRON_BIN="node_modules/electron/dist/electron"
if [ ! -x "$ELECTRON_BIN" ]; then
  echo "第一次运行，先装依赖（npm install）…"
  npm install
fi

exec "$ELECTRON_BIN" .
