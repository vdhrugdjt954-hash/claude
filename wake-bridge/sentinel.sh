#!/usr/bin/env bash
# 主会话后台哨兵：只看不消费。哨兵活着就持续打卡；signals.jsonl 一变长就退出，harness 叫醒主会话。
d="${GARDEN_WAKE_DIR:-$HOME/.garden-wake}"; f="$d/signals.jsonl"; mkdir -p "$d"; touch "$f"
s=$(stat -c%s "$f"); while [ "$(stat -c%s "$f")" = "$s" ]; do touch "$d/.main-alive"; sleep 2; done
echo "garden wake: run node $(cd "$(dirname "$0")" && pwd)/consume.mjs"
