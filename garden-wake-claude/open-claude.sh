#!/usr/bin/env bash
# 在 tmux 里开一个跑 Claude Code 的窗口给唤醒桥用；已经有了就直接接上去。
# 用法：./open-claude.sh [工作目录]，默认是这个仓库根目录（CLAUDE.md 在那里）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORKDIR="${1:-$(cd "$HERE/.." && pwd)}"
SESSION="${CLAUDE_TMUX_SESSION:-linfan}"
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux new-session -d -s "$SESSION" -c "$WORKDIR" claude
  echo "started Claude Code in tmux session $SESSION ($WORKDIR)"
fi
[[ -n "${TMUX:-}" ]] && tmux switch-client -t "$SESSION" || tmux attach -t "$SESSION"
