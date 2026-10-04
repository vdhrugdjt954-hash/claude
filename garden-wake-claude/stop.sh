#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$HERE/.watchdog.pid"
[[ -f "$PIDFILE" ]] || { echo "not running"; exit 0; }
PID="$(cat "$PIDFILE")"
pkill -P "$PID" 2>/dev/null || true
kill "$PID" 2>/dev/null || true
rm -f "$PIDFILE"
echo "stopped"
