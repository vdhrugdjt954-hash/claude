#!/usr/bin/env node

// Claude Code 注入器：只写文件，不敲窗口。
//
// 1. 收到 wake 信封，append 一行进 signals.jsonl。
// 2. 主会话绑死（.bind-main）或在场（.main-alive 在 TTL 内）→ 完事，谁醒由主会话自己的哨兵决定。
// 3. 没人在场 → 起一次性 duty.mjs（内部跑 claude -p），干完就死，不碰任何已开窗口。
//
// 信号一旦落盘就返回 0：起值守失败只记日志，不让桥重试，免得同一回合被写两遍。

import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SignalsError,
  appendSignal,
  isPidLockHeld,
  mainPresence,
  parseEnvelope,
  parseMainAliveTtl,
  readStdin,
  resolvePaths,
} from "./signals.mjs";

const dutyScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "duty.mjs");

function startDuty(paths, env) {
  const log = openSync(paths.dutyLog, "a", 0o600);
  try {
    const child = spawn(process.execPath, [dutyScript], {
      detached: true,
      env,
      shell: false,
      stdio: ["ignore", log, log],
    });
    child.unref();
  } finally {
    closeSync(log);
  }
}

export async function inject({ body, env = process.env, now = Date.now() }) {
  const paths = resolvePaths(env);
  const ttlMs = parseMainAliveTtl(env.GARDEN_MAIN_ALIVE_TTL_MS);
  const wake = parseEnvelope(body);

  await appendSignal(paths, wake, new Date(now));

  const presence = await mainPresence(paths, ttlMs, now);
  if (presence !== "absent") return { presence, duty: "skipped" };
  if (await isPidLockHeld(paths.dutyPid)) return { presence, duty: "running" };

  try {
    startDuty(paths, env);
    return { presence, duty: "started" };
  } catch (error) {
    process.stderr.write(`duty start failed: ${error?.message ?? error}\n`);
    return { presence, duty: "failed" };
  }
}

async function main() {
  try {
    const result = await inject({ body: await readStdin() });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof SignalsError ? error.message : String(error?.message ?? error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
