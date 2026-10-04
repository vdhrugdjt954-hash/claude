#!/usr/bin/env bash
# 用 macOS launchd 常驻唤醒桥：登录后自动启动，挂了自动拉起。
# 用法：./launchd.sh install | uninstall | restart | status | logs
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.linfan.garden-wake"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HERE/bridge.log"
DOMAIN="gui/$(id -u)"

write_plist() {
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$HERE/run-bridge.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
}

case "${1:-}" in
  install)
    [ -f "$HERE/.env" ] || { echo "missing $HERE/.env, copy .env.example first" >&2; exit 1; }
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    write_plist
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "installed $LABEL, log: $LOG"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "uninstalled $LABEL"
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "restarted $LABEL"
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E "state =|pid =|last exit code" || echo "not loaded"
    ;;
  logs)
    tail -n 50 -f "$LOG"
    ;;
  *)
    echo "usage: $0 install|uninstall|restart|status|logs" >&2
    exit 2
    ;;
esac
