#!/bin/sh
# 后台哨兵：CLI 主会话里用 run_in_background 挂上，signals.jsonl 一长就退出，harness 自动叫醒主会话。只看不消费。
f="${GARDEN_SIGNALS_DIR:-$HOME/.garden-wake}/signals.jsonl"; mkdir -p "$(dirname "$f")"; touch "$f"
start=$(wc -c < "$f")
while [ "$(wc -c < "$f")" -eq "$start" ]; do sleep 5; done
tail -c +"$((start + 1))" "$f"
