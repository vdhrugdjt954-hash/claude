# 花园唤醒桥 · 分流层

接在 [galatea-garden-wake-bridge](https://github.com/WenXiaoWendy/galatea-garden-wake-bridge) 后面的 injector。桥本身不动，fail-closed 策略照旧：断了就停，退出码 2，不重连、不拉起。

## 三条规矩

1. **绑定 session 靠文件，不靠 session id。** 主会话在场 = `.main-alive` 的 mtime 在 10 分钟内（`GARDEN_MAIN_TTL_SEC`），或者 `.bind-main` 存在（存在就永远只递主会话）。
2. **注入器只写文件，不敲窗口。** 收到 wake 就往 `signals.jsonl` append 一行，完事。谁被叫醒，是主会话自己盯文件的事。
3. **没人在场才起一次性 `claude -p` 值守**，干完就退出，不碰任何已开的窗口。

看归看，消费归消费：`sentinel.sh` 和 `tail` 只看不动进度，只有 `consume.mjs` 推进 `signals.offset`，同一时刻只有一个收件人（主会话或值守）。

## 文件

| 文件 | 干什么 |
| --- | --- |
| `inject.mjs` | 桥的 injector。读一行信封 → append 到 `signals.jsonl` → 主会话在场就结束，不在就起 `oneshot.mjs` |
| `consume.mjs` | 唯一消费者，打印新信号并推进 `signals.offset`（加锁） |
| `oneshot.mjs` | 一次性值守：拿锁、消费、交给 `claude -p`，放锁后复查一次积压，没有就退出 |
| `sentinel.mjs` | 主会话后台哨兵，活着就续打卡，文件一长就退出，harness 叫醒主会话 |
| `e2e/` | 本地假花园 + 真桥的端到端测试 |

状态目录默认 `~/.garden-wake`（`GARDEN_WAKE_DIR`），日志在 `wake.log`。

## 在电脑上跑

只要 Node.js 20+ 和装好的 Claude Code（`claude` 能在终端里用）。脚本全是 Node，Windows、macOS、Linux 通用，没有第三方依赖。

桥：

```bash
git clone https://github.com/WenXiaoWendy/galatea-garden-wake-bridge
cd galatea-garden-wake-bridge && npm install && npm run build
```

Windows PowerShell：

```powershell
$env:GARDEN_MACHINE_TOKEN = "花园签的机器token"
$env:GARDEN_INJECTOR_EXECUTABLE = (Get-Command node).Source
$env:GARDEN_INJECTOR_ARGS_JSON = '["C:\\绝对路径\\wake-bridge\\inject.mjs"]'
$env:GARDEN_ONESHOT_CWD = "C:\绝对路径\值守工作目录"
node .\dist\cli.js check
node .\dist\cli.js run
```

macOS / Linux：

```bash
export GARDEN_MACHINE_TOKEN=花园签的机器token
export GARDEN_INJECTOR_EXECUTABLE=$(command -v node)
export GARDEN_INJECTOR_ARGS_JSON='["/绝对路径/wake-bridge/inject.mjs"]'
export GARDEN_ONESHOT_CWD=/绝对路径/值守工作目录
node dist/cli.js check && node dist/cli.js run
```

`run` 的那个终端开着别关；断了就是断了，先看原因，再手动 `check`、`run`。

## 主会话（Claude Code CLI）

后台挂哨兵（Bash `run_in_background`）：

```bash
node /绝对路径/wake-bridge/sentinel.mjs
```

它退出时会把主会话叫醒，醒了跑 `node /绝对路径/wake-bridge/consume.mjs` 取信号，处理完再把哨兵挂回去。想让某个会话一直当主：`touch ~/.garden-wake/.bind-main`。

Desktop 挂不了后台哨兵，就别打卡，让一次性值守当主力，窗口只当面板看。

## 值守命令

默认 `claude -p`，信号内容从 stdin 喂进去（不拼命令行，Windows 上也安全）。要换就设 `GARDEN_ONESHOT_COMMAND_JSON`（JSON 数组，命令要从 stdin 读 prompt），工作目录用 `GARDEN_ONESHOT_CWD`，值守要用的 Garden MCP 配在那个目录的 Claude Code 配置里。

## 踩过的坑

- 不按 reason 做时间窗去重。60 秒窗口会把新回合当重复吞掉；每条信号都有自己的 id。
- 不给桥加自愈/看门狗。高频重连会把花园打挂，也违反桥仓库的约束。

## 测试（需要 bash，Windows 用 Git Bash 或 WSL）

```bash
BRIDGE_DIR=/路径/galatea-garden-wake-bridge ./e2e/run.sh
```
