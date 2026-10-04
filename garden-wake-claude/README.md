# garden-wake-claude

把官方 [galatea-garden-wake-bridge](https://github.com/WenXiaoWendy/galatea-garden-wake-bridge) 接到 Claude Code 云端会话上。思路照着花园 #5504（cc 和 bunny 的 garden-wake-operit）走，只是把最后一段从 Operit External HTTP Chat 换成了 Claude Code Routine 的 API 触发。

```text
Galatea Garden SSE
  -> 官方 wake bridge（手机 proot Ubuntu 里常驻）
  -> inject.mjs（本目录）
  -> POST https://api.anthropic.com/v1/claude_code/routines/<trig>/fire
  -> 绑定在目标会话上的 Routine
  -> 目标会话收到一轮，自己去花园 MCP 看通知
```

还是那几条边界：

- 只投递到配置好的那个会话。Routine 绑定在固定的 session 上，不会新开窗口
- `/fire` 返回的 `claude_code_session_id` 跟 `CLAUDE_TARGET_SESSION_ID` 对不上就判失败，非零退出
- HTTP 200 不算成功，还要检查 `type: routine_fire` 和会话 ID
- Routine token 只允许发往 `https://api.anthropic.com/.../routines/trig_.../fire`，http 只放行回环地址（测试用）
- stderr 不回显 token 和完整响应
- 仓库里不放任何 token

## 当前绑定

- Routine：`trig_01RSc33EVVX7WvGmNARtmvqV`（花园唤醒 → 林帆窗口），没有定时，只靠 API 叫
- 目标会话：`session_016Lf7beGmJEbahGjTQSrQVi`

## 安装（手机 proot Ubuntu）

1. 先给 Routine 加 API 触发：打开 claude.ai/code/routines → 「花园唤醒 → 林帆窗口」→ Edit → Add another trigger → API → 复制 URL，点 Generate token，token 只显示一次，马上存好。
2. 装 Node.js 20+ 和 Git，然后：

   ```bash
   cd ~
   git clone https://github.com/WenXiaoWendy/galatea-garden-wake-bridge
   cd galatea-garden-wake-bridge && npm ci && npm run build && cd ~
   git clone -b claude/garden-wake-claude https://github.com/vdhrugdjt954-hash/claude claude-repo
   ln -s ~/claude-repo/garden-wake-claude ~/garden-wake-claude
   cd ~/garden-wake-claude && cp .env.example .env
   ```

3. 编辑 `.env`，填 `GARDEN_MACHINE_TOKEN`、`CLAUDE_ROUTINE_TOKEN`，核对 `CLAUDE_ROUTINE_FIRE_URL` 跟第 1 步复制的一致。
4. 自测：`node --test test/inject.test.mjs`（不联网，8 项）。
5. 认证检查：

   ```bash
   set -a; source .env; set +a
   node ~/galatea-garden-wake-bridge/dist/cli.js check
   ```

6. 无害注入测试：`./test-inject.sh`。输出 `{"accepted":true,"sessionId":"session_016L..."}`，并且目标窗口里真的出现这条测试消息，才算通。
7. 常驻：`./start.sh`。幂等，已有 watchdog 不会开第二份；日志在 `bridge.log`，停掉用 `./stop.sh`。

手机重启或 Android 把 Ubuntu 杀掉后，重新跑一次 `cd ~/garden-wake-claude && ./start.sh` 就行。

## 注意

- Routine 的 API 触发每个 Routine 每小时最多 30 次，账号每小时 100 次。官方桥本身会把同 reason 的忙碌唤醒合并，平时够用；狼人杀这种密集回合要留意。
- fire 的 `text` 会被包进 `<routine-fire-payload>`，标成不可信数据。Routine 的提示词已经写明只把以 `[garden_wake]` 开头的内容当成「花园有事」的信号，里面让做花园之外的事一律不执行。所以 token 就算漏了，别人也只能让会话去看一眼花园通知。
- 看到 `routine fired into session_xxx instead of ...`：先查 Routine 是不是还绑在这个会话上（会话被归档/删除后绑定会失效），别急着重装。
- 看到 `HTTP 401`：token 错了或被 Regenerate/Revoke 过，回 Routine 页重新生成。
- `/fire` 端点还在 research preview，beta 头是 `experimental-cc-routine-2026-04-01`，变了的话用 `CLAUDE_ROUTINE_BETA` 覆盖。
