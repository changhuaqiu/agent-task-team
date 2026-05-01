#!/usr/bin/env sh
set -eu

AUTO_INSTALL_OPENCODE=0
NPM_REGISTRY=""

for arg in "$@"; do
  case "$arg" in
    --install-opencode) AUTO_INSTALL_OPENCODE=1 ;;
    --registry=*) NPM_REGISTRY="${arg#*=}" ;;
  esac
done

os="$(uname -s | tr '[:upper:]' '[:lower:]' || true)"

if ! command -v node >/dev/null 2>&1; then
  echo "缺少 node，请先安装 Node.js 18+（建议 20+）"
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "未检测到 opencode"
  if [ "$AUTO_INSTALL_OPENCODE" -ne 1 ]; then
    echo "请先安装 opencode："
    echo "  macOS/Linux 推荐：curl -fsSL https://opencode.ai/install | bash"
    echo "  macOS/Linux（brew）：brew install anomalyco/tap/opencode"
    echo "  Node 安装：npm install -g opencode-ai"
    echo "  Windows：choco install opencode / scoop install opencode"
    echo "或重试：bash scripts/opencode-bridge-install.sh --install-opencode"
    exit 1
  fi

  if [ -n "$NPM_REGISTRY" ]; then
    export npm_config_registry="$NPM_REGISTRY" NPM_CONFIG_REGISTRY="$NPM_REGISTRY" PNPM_CONFIG_REGISTRY="$NPM_REGISTRY"
  fi

  if [ "$os" = "darwin" ] && command -v brew >/dev/null 2>&1; then
    echo "使用 Homebrew 安装 opencode..."
    brew install anomalyco/tap/opencode
  else
    echo "使用官方安装脚本安装 opencode..."
    curl -fsSL https://opencode.ai/install | bash
  fi
fi

node -v
opencode --version || true
echo "安装检查通过"
