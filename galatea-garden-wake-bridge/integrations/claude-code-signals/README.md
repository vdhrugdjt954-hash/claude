# Claude Code 唤醒桥分流层

桥只管把 Garden 的 wake 交给 injector；这一层决定 Claude Code 这边谁接。核心三句话：

1. **「绑定 session」不绑 session id，touch 一个文件就是绑定。** 主会话干活时顺手 `touch .main-alive`（考勤卡，mtime 10 分钟内算在场）；再配一个 `.bind-main` 绑死开关，存在就永远只递主会话。全是文件约定，不需要任何 Claude 内部 API。
2. **注入器只写文件，不敲窗口。** 收到 wake 就 append 一行进 `signals.jsonl`，完事。注入器里没有「拉起窗口」这个动作，「全被拉起」物理上不会发生。谁被叫醒是主会话自己盯文件的事：CLI 挂个后台哨兵，文件一长 harness 自动叫醒。
3. **没人在场才起一次性 `claude -p` 值守**，干完就死，不碰任何已开的窗口。用 Desktop（挂不了后台哨兵）就让这条当主力，Desktop 窗口只当面板看。

## 文件

默认都在 `~/.garden-wake/`，可用 `GARDEN_SIGNALS_DIR`（绝对路径）改。

| 文件 | 谁写 | 作用 |
| --- | --- | --- |
| `signals.jsonl` | 注入器 | 一次 wake 一行：`{"id","at","reason","message"}` |
| `signals.offset` | 唯一收件人 | 消费进度；看（`tail` / `peek`）不动它 |
| `.main-alive` | 主会话 | 考勤卡，mtime 在 `GARDEN_MAIN_ALIVE_TTL_MS`（默认 600000）内算在场 |
| `.bind-main` | 你 | 存在就只递主会话，永不起值守 |
| `.consume.lock` | 收件人 | 同一时刻只有一个收件人推进进度 |
| `.duty.pid` / `duty.log` | 值守 | 值守进程锁和日志 |

## 分流规则

```text
wake → inject.mjs → append signals.jsonl
                  → .bind-main 存在        → 结束（主会话自己的哨兵会醒）
                  → .main-alive 10 分钟内  → 结束（同上）
                  → 值守已在跑             → 结束（值守放锁后会再看一眼）
                  → 否则                   → 后台起 duty.mjs → claude -p（全新会话）
                                              → 成功才推进 offset，干完退出
```

## 接到桥上

```bash
export GARDEN_INJECTOR_EXECUTABLE=node
export GARDEN_INJECTOR_ARGS_JSON='["/绝对路径/galatea-garden-wake-bridge/integrations/claude-code-signals/inject.mjs"]'
# 可选
export GARDEN_SIGNALS_DIR=/root/.garden-wake
export CLAUDE_BIN=claude
export CLAUDE_DUTY_CWD=/root/你的工作目录
export CLAUDE_DUTY_ARGS_JSON='["-p"]'
export CLAUDE_DUTY_TIMEOUT_MS=900000
```

值守从 stdin 收到提示词（积压信号按顺序列出，每条的 `message` 原样放进去），不走命令行参数。需要 Garden MCP 权限时，在 `CLAUDE_DUTY_ARGS_JSON` 里加上你自己的 `--allowedTools` 或 `--permission-mode`。

注入器只要信号落了盘就返回 `0`，起值守失败只写 `duty.log`，不让桥重试，避免同一回合写两遍。

## 主会话（CLI）

1. 干活时打卡：`node main-session.mjs alive`，或直接 `touch ~/.garden-wake/.main-alive`。也可以在 `.claude/settings.json` 里挂 hook 让它自动打：

   ```json
   {
     "hooks": {
       "UserPromptSubmit": [
         { "hooks": [{ "type": "command", "command": "touch \"$HOME/.garden-wake/.main-alive\"" }] }
       ]
     }
   }
   ```

2. 用后台 Bash 挂哨兵 `sh sentinel.sh`。它只看不消费：`signals.jsonl` 一长就把新行打印出来并退出，harness 随即叫醒主会话。
3. 被叫醒后 `node main-session.mjs take` 取走积压信号并推进进度，处理完再把哨兵挂回去。只想看一眼用 `peek`。
4. 想让值守永远别插手：`touch ~/.garden-wake/.bind-main`；删掉它就恢复自动分流。

## Desktop

Desktop 挂不了后台哨兵，就别打卡、别建 `.bind-main`，让 `claude -p` 值守当主力；Desktop 窗口只当面板看。

## 踩过的坑

- **`signals.offset` 被抢**：共享进度的病。看归看（`tail`、`sentinel.sh`、`peek` 都不动进度），消费归消费（只有拿到 `.consume.lock` 的唯一收件人推进 offset）。
- **去重窗口吞新回合**：别做「60 秒内同 reason 去重」，同一 reason 连着来就是两个回合。注入器一行都不合并。
- **桥自愈打挂花园**：别给桥加 watchdog、重连或自动拉起。桥本身 fail-closed，断了就停，人工排查后再 `check` / `run`。本分流层也不重启桥。
