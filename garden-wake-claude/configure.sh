#!/usr/bin/env bash
# 一问一答写 .env。钥匙只进这台 Mac 的 .env（权限 600），别贴到别处。
set -eu

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
default_url="https://api.anthropic.com/v1/claude_code/routines/trig_01EUth9CfmbfKEJpk63fZGBT/fire"
default_session="session_01XQ71gQ7oY3uQkpdqQp8qhP"

read -r -p "官方桥目录 [$HOME/galatea-garden-wake-bridge]: " bridge_dir
bridge_dir="${bridge_dir:-$HOME/galatea-garden-wake-bridge}"
if [ ! -f "$bridge_dir/dist/cli.js" ]; then
  echo "找不到 $bridge_dir/dist/cli.js，先在那个目录 npm ci && npm run build" >&2
  exit 1
fi

read -r -p "Routine fire URL [回车用默认]: " fire_url
fire_url="${fire_url:-$default_url}"

read -r -s -p "Routine token（输入不显示）: " routine_token
echo
[ -n "$routine_token" ] || { echo "Routine token 必填" >&2; exit 1; }

read -r -s -p "花园 machine token（输入不显示）: " garden_token
echo
[ -n "$garden_token" ] || { echo "花园 token 必填" >&2; exit 1; }

umask 077
tmp="$(mktemp "$here/.env.tmp.XXXXXX")"
trap 'rm -f -- "$tmp"' EXIT
{
  printf 'GARDEN_BASE_URL=%q\n' "https://wake-v1.abysslumina.com"
  printf 'GARDEN_MACHINE_TOKEN=%q\n' "$garden_token"
  printf 'GARDEN_INJECTOR_EXECUTABLE=%q\n' "node"
  printf 'GARDEN_INJECTOR_ARGS_JSON=%q\n' "[\"$here/inject-claude.mjs\"]"
  printf 'GARDEN_INJECTOR_WORKING_DIRECTORY=%q\n' "$here"
  printf 'GARDEN_LOG_LEVEL=%q\n' "info"
  printf 'GARDEN_BRIDGE_DIR=%q\n' "$bridge_dir"
  printf 'CLAUDE_ROUTINE_FIRE_URL=%q\n' "$fire_url"
  printf 'CLAUDE_ROUTINE_TOKEN=%q\n' "$routine_token"
  printf 'CLAUDE_SESSION_ID=%q\n' "$default_session"
} > "$tmp"
mv -f -- "$tmp" "$here/.env"
trap - EXIT
chmod 600 "$here/.env"
echo "写好了：$here/.env"
