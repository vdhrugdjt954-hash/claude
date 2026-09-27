#!/usr/bin/env node

// 主会话用的小工具：
//   alive  打考勤卡（等同 touch .main-alive）
//   peek   只看积压信号，不动进度
//   take   作为唯一收件人取走积压信号并推进进度（顺手打卡）

import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  commitOffset,
  peekPending,
  releasePidLock,
  resolvePaths,
  touchMainAlive,
  tryAcquirePidLock,
} from "./signals.mjs";

export async function runCommand(command, env = process.env) {
  const paths = resolvePaths(env);
  if (command === "alive") {
    await touchMainAlive(paths);
    return { ok: true };
  }
  if (command === "peek") {
    const { signals } = await peekPending(paths);
    return { ok: true, signals };
  }
  if (command === "take") {
    await touchMainAlive(paths);
    if (!(await tryAcquirePidLock(paths.consumeLock))) {
      return { ok: false, busy: true, signals: [] };
    }
    try {
      const { signals, end } = await peekPending(paths);
      await commitOffset(paths, end);
      return { ok: true, signals };
    } finally {
      await releasePidLock(paths.consumeLock);
    }
  }
  throw new Error("usage: main-session.mjs alive|peek|take");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const result = await runCommand(process.argv[2]);
    if (result.busy) {
      process.stdout.write("值守正在处理积压信号，稍后再 take。\n");
    } else if (result.signals) {
      if (result.signals.length === 0) process.stdout.write("没有新信号。\n");
      for (const signal of result.signals) {
        process.stdout.write(`[${signal.at}] ${signal.reason}: ${signal.message}\n`);
      }
    }
  } catch (error) {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}
