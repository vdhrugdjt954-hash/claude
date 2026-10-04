#!/usr/bin/env bash
# 前台跑一条 Garden SSE。断了不重连，只敲一次门报信（"断了才响"）。
set -eu

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
set -a
# shellcheck disable=SC1091
source "$here/.env"
set +a

bridge_entry="${GARDEN_BRIDGE_DIR}/dist/cli.js"
stopping=0
child=""

on_term() {
  stopping=1
  [ -n "$child" ] && kill "$child" 2>/dev/null || true
}
trap on_term TERM INT

# caffeinate -i：桥活着的时候 Mac 不进闲置睡眠，桥一退就跟着松手。
caffeinate -i node "$bridge_entry" run &
child=$!
code=0
wait "$child" || code=$?
# 被信号打断时 wait 会提前返回，再等一次真正的退出。
wait "$child" 2>/dev/null || true

if [ "$stopping" = 1 ]; then
  echo "$(date -u +%FT%TZ) bridge stopped by stop.sh"
  exit 0
fi

echo "$(date -u +%FT%TZ) bridge exited with code $code; ringing once"
node "$here/inject-claude.mjs" --bridge-down "$code" || echo "bridge-down ring failed"
exit "$code"
