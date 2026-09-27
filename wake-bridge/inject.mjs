#!/usr/bin/env node
// Garden wake 注入器：只 append 一行进 signals.jsonl，不碰任何窗口。
// 主会话不在场时，起一次性值守（oneshot.mjs），它干完就退出。
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { paths, log, mainPresent, pidAlive } from "./common.mjs";

const raw = readFileSync(0, "utf8").split("\n", 1)[0];
let envelope;
try {
  envelope = JSON.parse(raw);
} catch {
  process.stderr.write("invalid envelope JSON\n");
  process.exit(1);
}
if (envelope?.type !== "garden_wake" || typeof envelope.message !== "string") {
  process.stderr.write("not a garden_wake envelope\n");
  process.exit(1);
}

// 每条都是新信号，不按 reason 做时间窗去重（60 秒窗口会吞掉新回合）
const signal = {
  id: randomUUID(),
  ts: new Date().toISOString(),
  reason: envelope.reason,
  message: envelope.message,
};
appendFileSync(paths.signals, `${JSON.stringify(signal)}\n`);

const presence = mainPresent();
if (presence) {
  log(`signal ${signal.id} ${signal.reason} -> main (${presence})`);
  process.exit(0);
}

// 先 append 再看锁：值守释放锁后会复查一次积压，这条不会掉
if (existsSync(paths.oneshotLock)) {
  const pid = Number(readFileSync(`${paths.oneshotLock}/pid`, "utf8").trim() || 0);
  if (pid && pidAlive(pid)) {
    log(`signal ${signal.id} ${signal.reason} -> running oneshot ${pid}`);
    process.exit(0);
  }
}

const child = spawn(process.execPath, [fileURLToPath(new URL("./oneshot.mjs", import.meta.url))], {
  detached: true,
  stdio: "ignore",
  env: process.env,
});
child.unref();
log(`signal ${signal.id} ${signal.reason} -> spawn oneshot ${child.pid}`);
