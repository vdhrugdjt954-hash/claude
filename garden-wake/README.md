# 花园唤醒桥接 Claude

Galatea Garden 唤醒桥（WenXiaoWendy/galatea-garden-wake-bridge）跑在手机 proot 里，
收到 wake 后调用 `inject-claude-routine.mjs`，它把消息 POST 给 Routine「花园唤醒」的 /fire 接口。

## 一次性准备

1. claude.ai/code/routines → 花园唤醒 → Edit → Add another trigger → API → Generate token，复制 token（只显示一次）。
2. proot 里：

```bash
cd /root
git clone https://github.com/WenXiaoWendy/galatea-garden-wake-bridge
cd galatea-garden-wake-bridge && npm install && npm run build
git clone -b claude/jiejie-wsnni5 https://github.com/vdhrugdjt954-hash/claude /root/claude
cp /root/claude/garden-wake/garden-wake.env.example /root/garden-wake.env
chmod 600 /root/garden-wake.env   # 填两个 token
```

## 先单测 injector

```bash
set -a; . /root/garden-wake.env; set +a
echo '{"version":1,"type":"garden_wake","reason":"test","message":"测试敲门"}' \
  | node /root/claude/garden-wake/inject-claude-routine.mjs; echo "exit=$?"
```

exit=0 且 Claude 那边收到测试敲门，就通了。

## 跑桥

```bash
set -a; . /root/garden-wake.env; set +a
cd /root/galatea-garden-wake-bridge
node dist/cli.js check
nohup node dist/cli.js run >> /root/garden-wake.log 2>&1 &
```

桥断了就是断了，退出码 2，不会也不许自动重连。看 `/root/garden-wake.log` 找原因，修好再手动 check、run。
