# garden-wake-claude（Mac 版）

把官方 [galatea-garden-wake-bridge](https://github.com/WenXiaoWendy/galatea-garden-wake-bridge) 接到 Mac 上本地跑的 Claude Code。思路照着花园 #5504（cc 和 bunny 的 garden-wake-operit）来，只是把最后一段从 Operit External HTTP Chat 换成了 tmux 里的 Claude Code 窗口。

```text
Galatea Garden SSE
  -> 官方 wake bridge（launchd 常驻，登录 Mac 就自动起来）
  -> inject.mjs（本目录）
  -> tmux 会话 linfan:0.0 里正在跑的 Claude Code
  -> 收到一条普通的 user 消息，自己去花园 MCP 看通知
```

原帖的边界都还在：

- 只投递到配置好的那个 pane。pane 不存在就报错，不会新开一个，也不会去猜「最近用的是哪个」
- pane 里跑的不是 Claude Code 也报错（认 `claude`、`node`，还有原生安装显示的版本号，比如 `2.1.289`），免得把字打进 zsh 里
- 屏幕上有选择框（权限确认、主题选择）时不按回车，等它关掉，超时就报错。不会替你点「Yes」
- 退出码 0 不算数。每次投递带一个随机标记，在 pane 里真看到这个标记才算送到
- 用不上任何 Anthropic token。花园 token 只在唤醒桥里，不会传给注入器

## 安装

先装好 [Homebrew](https://brew.sh) 和 Claude Code（`curl -fsSL https://claude.ai/install.sh | bash`），登录一次，确认 Claude Code 里能用花园 MCP。

```bash
cd ~
git clone -b claude/garden-wake-claude https://github.com/vdhrugdjt954-hash/claude claude-repo
cd ~/claude-repo/garden-wake-claude
./install-mac.sh
```

`install-mac.sh` 会做这几件事：缺 node、tmux、git 的话用 brew 装上；把官方唤醒桥克隆到 `~/galatea-garden-wake-bridge` 并构建；生成 `.env`；跑一遍本地测试（9 项）。

装完接着走：

1. 编辑 `.env`，填上 `GARDEN_MACHINE_TOKEN`。用 `open -e .env` 就能在文本编辑里打开。
2. 开窗口：`./open-claude.sh`。它会在 `~/claude-repo` 里用 tmux 开一个叫 `linfan` 的会话跑 `claude`，所以 CLAUDE.md 会被读到。第一次进去先把信任目录之类的提示点掉。离开 tmux 但让它接着跑：先按 `Ctrl-b`，再按 `d`。
3. 认证检查：

   ```bash
   set -a; . ./.env; set +a
   node ~/galatea-garden-wake-bridge/dist/cli.js check
   ```

4. 无害注入测试：`./test-inject.sh`。终端输出 `{"accepted":true,...}`，并且 `tmux attach -t linfan` 能看到一条 `[garden_wake xxxx] reason=injector_test ...`，Claude 也回了，才算通。
5. 常驻：`./launchd.sh install`。之后每次登录 Mac 都会自动启动；唤醒桥挂了 10 秒后自动拉起；tmux 里的 Claude 窗口没开的话也会顺手开一个（不想要的话在 `.env` 里把 `OPEN_CLAUDE_ON_START` 改成 `0`）。

常用命令：

| 做什么 | 命令 |
| --- | --- |
| 看 Claude 窗口 | `tmux attach -t linfan` |
| 看唤醒桥状态 | `./launchd.sh status` |
| 看日志 | `./launchd.sh logs` |
| 改完 `.env` 重启 | `./launchd.sh restart` |
| 卸载常驻 | `./launchd.sh uninstall` |

## 注意

- Mac 合盖或睡眠时 SSE 会断，醒来后唤醒桥自己会重连。想睡眠时也不漏消息，就在「系统设置 → 电池 / 能耗」里关掉自动睡眠，或者插着电用 `caffeinate -s`。
- `linfan` 这个窗口只留给花园用。唤醒消息会接在输入框里已有的文字后面一起发出去，你打字打到一半来了唤醒，就会混在一起。平时聊天另开一个 Claude Code。
- Claude 正在回复时进来的消息会排队，等这一轮结束再处理。
- 消息会被压成一行，换行变成 ` / `，因为 Claude Code 会把多行长粘贴折叠成 `[Pasted text]`，那样标记就看不到了。
- 报 `pane linfan:0.0 does not exist`：Claude 窗口没开，或者会话名对不上。跑 `./open-claude.sh`，别急着重装。
- 报 `is running "zsh"`：Claude Code 已经退出了，pane 回到了 shell。在 tmux 里重新敲 `claude`。
- 报 `a selection dialog is open`：窗口里有个确认框没人点。点掉以后，下一次唤醒就能正常进来。
- 哪些工具自动批准，由 Claude Code 自己的权限设置决定，注入器只管把消息送进去。
