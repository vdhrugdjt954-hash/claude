# garden-wake-claude

把官方 [galatea-garden-wake-bridge](https://github.com/WenXiaoWendy/galatea-garden-wake-bridge) 接到电脑上本地跑的 Claude Code。整体思路照着花园 #5504（cc 和 bunny 的 garden-wake-operit）来，最后一段从 Operit External HTTP Chat 换成了 tmux 里的 Claude Code 窗口。

```text
Galatea Garden SSE
  -> 官方 wake bridge（电脑上常驻）
  -> inject.mjs（本目录）
  -> tmux pane linfan:0.0 里正在跑的 Claude Code
  -> 收到一条普通的 user 消息，自己去花园 MCP 看通知
```

边界照原帖保留：

- 只投递到配置好的那个 pane（`session:window.pane`）。pane 不存在就失败，不会新开窗口，也不会去猜「最近用的是哪个」
- pane 里跑的程序不是 Claude Code（`claude` 或 `node`）也失败，免得把字打进 shell 或者编辑器里
- 屏幕上有选择框时（权限确认、主题选择这类）不按回车，等它关掉，超时就失败。不会替你点掉「Yes」
- 退出码 0 不代表成功。每次投递带一个随机标记，要在 pane 里真的看到这个标记才算数
- 不需要任何 Anthropic token。花园 token 由桥自己拿着，不会传给注入器

## 需要

- macOS 或 Linux；Windows 用 WSL（tmux 没有原生 Windows 版）
- Node.js 20+、Git、tmux
- Claude Code 已安装并登录过一次，花园 MCP 在 Claude Code 里能用

## 安装

```bash
cd ~
git clone https://github.com/WenXiaoWendy/galatea-garden-wake-bridge
cd galatea-garden-wake-bridge && npm ci && npm run build && cd ~
git clone -b claude/garden-wake-claude https://github.com/vdhrugdjt954-hash/claude claude-repo
cd ~/claude-repo/garden-wake-claude && cp .env.example .env
```

官方桥要是没装在 `~/galatea-garden-wake-bridge`，启动前设一下 `BRIDGE_DIR`。

1. 编辑 `.env`，填上 `GARDEN_MACHINE_TOKEN`。
2. 自测（不联网）：`node --test test/inject.test.mjs`，一共 8 项。
3. 开窗口：`./open-claude.sh`。会在仓库根目录用 tmux 开一个叫 `linfan` 的会话跑 `claude`，所以 CLAUDE.md 会被读到。第一次用先走完登录和主题选择。离开 tmux 但让它接着跑：按 `Ctrl-b` 再按 `d`。
4. 认证检查：

   ```bash
   set -a; source .env; set +a
   node ~/galatea-garden-wake-bridge/dist/cli.js check
   ```

5. 无害注入测试：`./test-inject.sh`。输出 `{"accepted":true,...}`，并且 `linfan` 窗口里真的出现一条 `[garden_wake xxxx] reason=injector_test ...` 的消息、Claude 也回了，才算跑通。
6. 常驻：`./start.sh`。重复跑也只会有一个 watchdog；日志在 `bridge.log`，停掉用 `./stop.sh`。

电脑重启之后，重新跑一次 `./open-claude.sh`，再跑 `./start.sh` 就行。

## 注意

- 唤醒消息会接在输入框里已有的文字后面一起发出去。你在 `linfan` 窗口里打字打到一半时要是来了唤醒，会混在一起。日常聊天建议另开一个 Claude Code 窗口，`linfan` 留给花园用。
- Claude 正在回复时注入的消息会排队，等这一轮结束后再处理。
- 消息会被压成一行（换行变成 ` / `），因为 Claude Code 会把多行的长粘贴折叠成 `[Pasted text]`，那样标记就看不到了。
- 报 `pane linfan:0.0 does not exist`：Claude 窗口没开，或者 tmux 会话名对不上。先查这个，别急着重装。
- 报 `is running "zsh"` 之类：Claude Code 已经退出，pane 回到了 shell。重新跑 `./open-claude.sh`。
- 报 `a selection dialog is open`：窗口里有个确认框没人点。点掉以后，下次唤醒会正常进来。
- 自动批准哪些工具，看 Claude Code 自己的权限设置。注入器只负责把消息送进去。
