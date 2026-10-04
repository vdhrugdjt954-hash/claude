#!/usr/bin/env bash
set -eu

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
pid_file="$here/.run.pid"

if [ ! -f "$pid_file" ]; then
  echo "桥没在跑"
  exit 0
fi
pid="$(cat "$pid_file")"
if ps -p "$pid" -o command= 2>/dev/null | grep -Fq "$here/run.sh"; then
  kill "$pid"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  echo "桥停了"
else
  echo "PID 文件过期了，清掉"
fi
rm -f -- "$pid_file"
