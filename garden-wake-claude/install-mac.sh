#!/usr/bin/env bash
# Mac 一键准备：装依赖、拉取并构建官方唤醒桥、生成 .env。不会自动启动常驻。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="${BRIDGE_DIR:-$HOME/galatea-garden-wake-bridge}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

command -v brew >/dev/null || { echo "need Homebrew first: https://brew.sh" >&2; exit 1; }
for pkg in node tmux git; do
  command -v "$pkg" >/dev/null || brew install "$pkg"
done
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 20 ] || { echo "Node $major is too old, need 20+ (brew upgrade node)" >&2; exit 1; }
command -v claude >/dev/null || echo "warning: claude not found; install Claude Code: curl -fsSL https://claude.ai/install.sh | bash"

if [ ! -d "$BRIDGE_DIR/.git" ]; then
  git clone https://github.com/WenXiaoWendy/galatea-garden-wake-bridge "$BRIDGE_DIR"
fi
(cd "$BRIDGE_DIR" && npm ci && npm run build)

[ -f "$HERE/.env" ] || { cp "$HERE/.env.example" "$HERE/.env"; chmod 600 "$HERE/.env"; }
node --test "$HERE/test/inject.test.mjs"
echo
echo "done. next: edit $HERE/.env and fill GARDEN_MACHINE_TOKEN"
