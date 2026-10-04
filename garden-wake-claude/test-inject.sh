#!/usr/bin/env bash
# 无害注入测试：往目标窗口发一条测试唤醒，确认进的是对的会话。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
set -a; source "$HERE/.env"; set +a
echo '{"version":1,"type":"garden_wake","reason":"injector_test","message":"这是一条注入测试，不用查花园，回一句收到就行。"}' \
  | node "$HERE/inject.mjs"
