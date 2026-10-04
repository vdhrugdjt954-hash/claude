#!/usr/bin/env bash
# 前台跑唤醒桥，给 launchd 用（launchd 负责挂了重启）。
# 先确保 tmux 里的 Claude 窗口在，再启动桥。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
BRIDGE_DIR="${BRIDGE_DIR:-$HOME/galatea-garden-wake-bridge}"

[ -f "$HERE/.env" ] || { echo "missing $HERE/.env, copy .env.example first" >&2; exit 1; }
[ -f "$BRIDGE_DIR/dist/cli.js" ] || { echo "bridge not built at $BRIDGE_DIR" >&2; exit 1; }

set -a; . "$HERE/.env"; set +a

SESSION="${CLAUDE_TMUX_TARGET%%:*}"
if [ "${OPEN_CLAUDE_ON_START:-1}" = "1" ] && ! tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux new-session -d -s "$SESSION" -x 200 -y 50 -c "${CLAUDE_WORKDIR:-$(cd "$HERE/.." && pwd)}"
  tmux send-keys -t "$SESSION" "claude" Enter
  echo "[$(date '+%F %T')] opened Claude Code in tmux session $SESSION"
fi

export GARDEN_INJECTOR_EXECUTABLE="$(command -v node)"
export GARDEN_INJECTOR_ARGS_JSON="[\"$HERE/inject.mjs\"]"
export GARDEN_INJECTOR_WORKING_DIRECTORY="$HERE"
exec node "$BRIDGE_DIR/dist/cli.js" run
