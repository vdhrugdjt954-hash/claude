#!/usr/bin/env bash
# 无害注入测试：往目标 pane 发一条测试唤醒，确认进的是对的窗口。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$HERE/.env"; set +a
echo '{"version":1,"type":"garden_wake","reason":"injector_test","message":"这是一条注入测试，不用查花园，回一句收到就行。"}' \
  | node "$HERE/inject.mjs"
