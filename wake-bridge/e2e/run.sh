#!/usr/bin/env bash
# 端到端：假花园 -> 真 bridge(dist/cli.js) -> inject.mjs -> 主会话 / 一次性值守
set -u
here=$(cd "$(dirname "$0")/.." && pwd); bridge=${BRIDGE_DIR:?set BRIDGE_DIR to the cloned galatea-garden-wake-bridge}
export GARDEN_WAKE_DIR=$(mktemp -d); w=$GARDEN_WAKE_DIR; fifo=$w/fake.in; mkfifo "$fifo"
export GARDEN_ONESHOT_COMMAND_JSON="[\"bash\",\"-c\",\"echo \\\"\$0\\\" >> $w/oneshot-prompts.txt; sleep 1\"]"
fail=0; ok(){ echo "PASS $1"; }; bad(){ echo "FAIL $1"; fail=1; }
node "$here/e2e/fake-garden.mjs" < "$fifo" > "$w/fake.log" 2>&1 & fake=$!; exec 3>"$fifo"
sleep 0.5
GARDEN_BASE_URL=http://127.0.0.1:18777 GARDEN_MACHINE_TOKEN=test-token \
GARDEN_INJECTOR_EXECUTABLE="$(command -v node)" GARDEN_INJECTOR_ARGS_JSON="[\"$here/inject.mjs\"]" \
  node "$bridge/dist/cli.js" run > "$w/bridge.log" 2>&1 & br=$!
sleep 1; lines(){ wc -l < "$w/signals.jsonl" 2>/dev/null || echo 0; }

echo "== 1. 主会话在场（哨兵在跑）：只写文件、不起值守、哨兵退出叫醒"
"$here/sentinel.sh" > "$w/sentinel.out" & sn=$!; sleep 3
echo "game_turn_required 轮到你了" >&3; sleep 2
[ "$(lines)" = 1 ] && ok "signal appended" || bad "signal appended"
kill -0 $sn 2>/dev/null && bad "sentinel exited" || ok "sentinel exited"
[ ! -e "$w/oneshot-prompts.txt" ] && ok "no oneshot while main present" || bad "no oneshot while main present"
grep -q '"轮到你了"\|轮到你了' <(node "$here/consume.mjs") && ok "main consumed" || bad "main consumed"
[ -z "$(node "$here/consume.mjs")" ] && ok "offset advanced, second consume empty" || bad "offset advanced"

echo "== 2. 连续两条同 reason（不能被时间窗吞）"
echo "chat_notification_available 第一条" >&3; sleep 0.3; echo "chat_notification_available 第二条" >&3; sleep 2
[ "$(node "$here/consume.mjs" | wc -l)" = 2 ] && ok "both kept" || bad "both kept"

echo "== 3. .bind-main：打卡过期也只递主会话"
touch -d '1 hour ago' "$w/.main-alive"; touch "$w/.bind-main"
echo "forum_notification_available 帖子回复" >&3; sleep 2
[ ! -e "$w/oneshot-prompts.txt" ] && ok "bound to main" || bad "bound to main"
node "$here/consume.mjs" >/dev/null; rm "$w/.bind-main"

echo "== 4. 没人在场：起一次性值守，干完就死，不重复起"
echo "game_turn_required 回合A" >&3; sleep 0.3; echo "chat_notification_available 私信B" >&3; sleep 4
[ -s "$w/oneshot-prompts.txt" ] && ok "oneshot ran" || bad "oneshot ran"
grep -q 回合A "$w/oneshot-prompts.txt" && grep -q 私信B "$w/oneshot-prompts.txt" && ok "oneshot got both" || bad "oneshot got both"
[ ! -e "$w/.oneshot.lock" ] && ok "oneshot exited, lock released" || bad "oneshot exited"
[ -z "$(node "$here/consume.mjs")" ] && ok "nothing stranded" || bad "nothing stranded"

echo "== 5. fail-closed：花园断开，bridge 退出码 2，不重连"
kill $fake; wait $br; code=$?
[ "$code" = 2 ] && ok "bridge exit 2" || bad "bridge exit $code"
echo "--- wake.log"; cat "$w/wake.log"; echo "--- oneshot prompts"; cat "$w/oneshot-prompts.txt"
rm -rf "$w"; exit $fail
