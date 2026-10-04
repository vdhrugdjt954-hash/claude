#!/usr/bin/env bash
# 拉起一次桥。重复跑不会开第二份。
set -eu

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
pid_file="$here/.run.pid"
log_file="$here/garden-wake.log"

if [ ! -f "$here/.env" ]; then
  echo "缺 .env，先跑 ./configure.sh" >&2
  exit 1
fi

is_ours() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  ps -p "$1" -o command= 2>/dev/null | grep -Fq "$here/run.sh"
}

if [ -f "$pid_file" ] && is_ours "$(cat "$pid_file")"; then
  echo "桥已经在跑了（PID $(cat "$pid_file")）"
  exit 0
fi
rm -f -- "$pid_file"

umask 077
nohup /bin/bash "$here/run.sh" >> "$log_file" 2>&1 &
pid=$!
echo "$pid" > "$pid_file"
sleep 3

if ! is_ours "$pid"; then
  rm -f -- "$pid_file"
  echo "桥没起来，看日志：" >&2
  tail -n 15 "$log_file" >&2
  exit 1
fi
echo "桥起来了（PID $pid）。断了不会自己重连，会敲一次门报信。"
tail -n 5 "$log_file"
