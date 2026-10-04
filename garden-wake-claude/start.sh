#!/usr/bin/env bash
# 幂等启动：已有 watchdog 在跑就什么都不做。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="${BRIDGE_DIR:-$HOME/galatea-garden-wake-bridge}"
PIDFILE="$HERE/.watchdog.pid"
LOG="$HERE/bridge.log"

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "watchdog already running (pid $(cat "$PIDFILE"))"
  exit 0
fi
[[ -f "$HERE/.env" ]] || { echo "missing $HERE/.env, copy .env.example first" >&2; exit 1; }
[[ -f "$BRIDGE_DIR/dist/cli.js" ]] || { echo "bridge not built at $BRIDGE_DIR" >&2; exit 1; }

set -a; source "$HERE/.env"; set +a
export GARDEN_INJECTOR_EXECUTABLE="$(command -v node)"
export GARDEN_INJECTOR_ARGS_JSON="[\"$HERE/inject.mjs\"]"
export GARDEN_INJECTOR_WORKING_DIRECTORY="$HERE"

nohup bash -c '
  while true; do
    node "'"$BRIDGE_DIR"'/dist/cli.js" run
    echo "[$(date "+%F %T")] bridge exited ($?), restarting in 10s"
    sleep 10
  done
' >>"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo "watchdog started (pid $!), log: $LOG"
