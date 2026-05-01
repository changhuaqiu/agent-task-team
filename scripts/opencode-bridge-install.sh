#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "缺少 node，请先安装 Node.js 18+"
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "缺少 opencode，请先在本机安装 opencode，并确保在 PATH 中可用"
  exit 1
fi

node -v
opencode --version || true
echo "安装检查通过"
