#!/usr/bin/env node
// 一次性值守：拿锁 -> 消费积压 -> 交给 claude -p -> 放锁 -> 复查积压 -> 没有就退出。
// 不连花园、不自愈、不常驻。
import { mkdirSync, writeFileSync, rmSync, statSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { paths, log } from "./common.mjs";
import { consume } from "./consume.mjs";

const MAX_ROUNDS = 3;
const command = process.env.GARDEN_ONESHOT_COMMAND_JSON
  ? JSON.parse(process.env.GARDEN_ONESHOT_COMMAND_JSON)
  : ["claude", "-p"];

function pending() {
  let offset = 0;
  try {
    offset = Number(readFileSync(paths.offset, "utf8").trim()) || 0;
  } catch {}
  try {
    return statSync(paths.signals).size > offset;
  } catch {
    return false;
  }
}

function acquire() {
  try {
    mkdirSync(paths.oneshotLock);
    writeFileSync(`${paths.oneshotLock}/pid`, String(process.pid));
    return true;
  } catch {
    return false;
  }
}

for (let round = 0; round < MAX_ROUNDS; round++) {
  if (!acquire()) break;
  try {
    const signals = await consume();
    if (signals.length === 0) continue;
    const prompt = [
      "Galatea Garden 来了唤醒信号，逐条处理，处理完就结束：",
      ...signals.map((s) => `- [${s.reason}] ${s.message}`),
    ].join("\n");
    const [bin, ...args] = command;
    const result = spawnSync(bin, [...args, prompt], {
      encoding: "utf8",
      timeout: 10 * 60_000,
      cwd: process.env.GARDEN_ONESHOT_CWD || process.cwd(),
    });
    log(
      `oneshot ${process.pid} handled ${signals.map((s) => s.id).join(",")} exit=${result.status}` +
        (result.error ? ` error=${result.error.message}` : "") +
        ` out=${JSON.stringify((result.stdout || result.stderr || "").trim().slice(0, 200))}`,
    );
  } finally {
    rmSync(paths.oneshotLock, { recursive: true, force: true });
  }
  if (!pending()) break;
}
