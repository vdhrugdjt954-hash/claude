#!/usr/bin/env bash
# 不经过花园，直接敲一次门，看窗口能不能收到。
set -eu
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
set -a
# shellcheck disable=SC1091
source "$here/.env"
set +a
node "$here/inject-claude.mjs" --test
