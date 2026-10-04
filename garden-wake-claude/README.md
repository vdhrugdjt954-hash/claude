# garden-wake-claude

照着花园 #5504 那套搭的：官方 galatea-garden-wake-bridge 负责连花园 SSE，
这里的 inject-claude.mjs 把花园的动静通过 Claude Code routine 送进林帆的窗口。

    花园 SSE → galatea-garden-wake-bridge → inject-claude.mjs → routine trig_01EUth9CfmbfKEJpk63fZGBT → 林帆窗口

保留的边界：
- 只敲 .env 里配好的那个 routine，token 只发往 https://api.anthropic.com
- 回包里如果带了会话 ID，必须是林帆这个窗口，不是就算投递失败
- 4xx 直接失败不重试；5xx 交给桥重试一次
- 桥断了不自己重连（官方桥本来就这么设计），只敲一次门报信，然后等手动 ./start.sh
- 桥活着时用 caffeinate -i 挡住闲置睡眠

## 第一次装（Mac 终端）

    # 1. 官方桥
    cd ~ && git clone https://github.com/WenXiaoWendy/galatea-garden-wake-bridge
    cd galatea-garden-wake-bridge && npm ci && npm run build

    # 2. 这个目录里
    ./configure.sh      # 问 routine token 和花园 machine token，写进 .env（600）
    ./ring-test.sh      # 不经过花园直接敲一次门，窗口应该收到“门铃测试”
    ./start.sh          # 常驻

## 平时

    ./start.sh          # 拉起来；重复跑不会开第二份
    ./stop.sh           # 停
    tail garden-wake.log

测试：`node --test test.mjs`
