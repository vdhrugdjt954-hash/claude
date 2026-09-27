#!/usr/bin/env node

// 一次性值守：没人在场时由 inject.mjs 拉起，跑全新的 claude -p 处理积压信号，干完就退出。
// 不 --resume、不 --continue，不碰任何已开的窗口。它在处理期间是唯一收件人。

import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  SignalsError,
  commitOffset,
  mainPresence,
  parseMainAliveTtl,
  peekPending,
  releasePidLock,
  resolvePaths,
  tryAcquirePidLock,
} from "./signals.mjs";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_ROUNDS = 5;

function parseArgs(value) {
  if (value === undefined || value === "") return ["-p"];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SignalsError("CLAUDE_DUTY_ARGS_JSON must be a JSON string array");
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new SignalsError("CLAUDE_DUTY_ARGS_JSON must be a JSON string array");
  }
  return parsed;
}

function parseTimeout(value) {
  if (value === undefined || value === "") return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 10_000) {
    throw new SignalsError("CLAUDE_DUTY_TIMEOUT_MS must be an integer >= 10000");
  }
  return parsed;
}

export function buildPrompt(signals) {
  const items = signals.map(
    (signal, index) => `${index + 1}. [${signal.reason}] ${signal.message}`,
  );
  return [
    `Galatea Garden 唤醒信号，共 ${signals.length} 条，按顺序处理：`,
    "",
    ...items,
    "",
    "每条都按 message 里的指引去做，做完就结束。",
    "",
  ].join("\n");
}

function runClaude({ bin, args, cwd, timeoutMs, prompt, env }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      env,
      shell: false,
      stdio: ["pipe", "inherit", "inherit"],
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      process.stderr.write(`claude start failed: ${error.message}\n`);
      resolve(false);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        process.stderr.write(`claude exited with ${signal ?? code}\n`);
      }
      resolve(code === 0);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

// 返回本轮是否成功消费了信号；main 回来、没信号、拿不到消费锁或 claude 失败都返回 false。
async function oneRound(paths, config) {
  if ((await mainPresence(paths, config.ttlMs)) !== "absent") return false;
  if (!(await tryAcquirePidLock(paths.consumeLock))) return false;
  try {
    const { signals, end } = await peekPending(paths);
    if (signals.length === 0) {
      await commitOffset(paths, end);
      return false;
    }
    const ok = await runClaude({ ...config, prompt: buildPrompt(signals) });
    if (!ok) return false;
    await commitOffset(paths, end);
    return true;
  } finally {
    await releasePidLock(paths.consumeLock);
  }
}

export async function duty(env = process.env) {
  const paths = resolvePaths(env);
  const config = {
    bin: env.CLAUDE_BIN?.trim() || "claude",
    args: parseArgs(env.CLAUDE_DUTY_ARGS_JSON),
    cwd: env.CLAUDE_DUTY_CWD?.trim() || paths.dir,
    timeoutMs: parseTimeout(env.CLAUDE_DUTY_TIMEOUT_MS),
    ttlMs: parseMainAliveTtl(env.GARDEN_MAIN_ALIVE_TTL_MS),
    env,
  };

  let rounds = 0;
  while (rounds < MAX_ROUNDS) {
    if (!(await tryAcquirePidLock(paths.dutyPid))) return rounds;
    let progressed = false;
    try {
      while (rounds < MAX_ROUNDS && (await oneRound(paths, config))) {
        rounds += 1;
        progressed = true;
      }
    } finally {
      await releasePidLock(paths.dutyPid);
    }
    // 放锁之后再看一眼：放锁前一瞬间写进来的信号，注入器会以为值守还在而不再起新的。
    const { signals } = await peekPending(paths);
    if (!progressed || signals.length === 0) return rounds;
  }
  return rounds;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const rounds = await duty();
    process.stderr.write(`${new Date().toISOString()} duty done, rounds=${rounds}\n`);
  } catch (error) {
    process.stderr.write(`${new Date().toISOString()} duty failed: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}
