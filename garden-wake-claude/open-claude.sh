#!/usr/bin/env bash
# 打开（没有就先建）tmux 里给花园用的 Claude Code 窗口。
# 用法：./open-claude.sh [工作目录]，默认是这个仓库根目录（CLAUDE.md 在那里）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
WORKDIR="${1:-$(cd "$HERE/.." && pwd)}"
SESSION="${CLAUDE_TMUX_SESSION:-linfan}"
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  # 先开一个普通 shell 再敲 claude：claude 启动失败时报错留在屏幕上，窗口也不会直接消失。
  tmux new-session -d -s "$SESSION" -x 200 -y 50 -c "$WORKDIR"
  tmux send-keys -t "$SESSION" "claude" Enter
  echo "started Claude Code in tmux session $SESSION ($WORKDIR)"
fi
if [ -n "${TMUX:-}" ]; then tmux switch-client -t "$SESSION"; else tmux attach -t "$SESSION"; fi
