// Claude Code 分流层的共享约定：全是文件，不碰任何 Claude 内部 API、不敲任何窗口。
//
//   signals.jsonl   注入器只往这里 append，一次唤醒一行
//   signals.offset  消费进度，只有“唯一收件人”能推进；看（tail/peek）不动它
//   .main-alive     主会话考勤卡，mtime 在 TTL 内算主会话在场
//   .bind-main      绑死开关，存在就永远只递主会话，不起值守
//   .consume.lock   消费锁，保证同一时刻只有一个收件人
//   .duty.pid       一次性 claude -p 值守的进程锁

import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const DEFAULT_MAIN_ALIVE_TTL_MS = 10 * 60 * 1000;
const MAX_ENVELOPE_BYTES = 64 * 1024;

export class SignalsError extends Error {
  constructor(message) {
    super(message);
    this.name = "SignalsError";
  }
}

export function resolvePaths(env = process.env) {
  const configured = env.GARDEN_SIGNALS_DIR?.trim();
  const dir = configured || path.join(os.homedir(), ".garden-wake");
  if (!path.isAbsolute(dir)) {
    throw new SignalsError("GARDEN_SIGNALS_DIR must be an absolute path");
  }
  return {
    dir,
    signals: path.join(dir, "signals.jsonl"),
    offset: path.join(dir, "signals.offset"),
    mainAlive: path.join(dir, ".main-alive"),
    bindMain: path.join(dir, ".bind-main"),
    consumeLock: path.join(dir, ".consume.lock"),
    dutyPid: path.join(dir, ".duty.pid"),
    dutyLog: path.join(dir, "duty.log"),
  };
}

export function parseMainAliveTtl(value) {
  if (value === undefined || value === "") return DEFAULT_MAIN_ALIVE_TTL_MS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000) {
    throw new SignalsError("GARDEN_MAIN_ALIVE_TTL_MS must be an integer >= 1000");
  }
  return parsed;
}

export function parseEnvelope(body) {
  if (Buffer.byteLength(body, "utf8") > MAX_ENVELOPE_BYTES) {
    throw new SignalsError(`stdin exceeds ${MAX_ENVELOPE_BYTES} bytes`);
  }
  let envelope;
  try {
    envelope = JSON.parse(body);
  } catch {
    throw new SignalsError("stdin must contain one JSON wake envelope");
  }
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    envelope.version !== 1 ||
    envelope.type !== "garden_wake" ||
    typeof envelope.reason !== "string" ||
    envelope.reason.trim() === "" ||
    typeof envelope.message !== "string" ||
    envelope.message.trim() === ""
  ) {
    throw new SignalsError("invalid Garden wake envelope");
  }
  return { reason: envelope.reason, message: envelope.message };
}

// 不做去重：同一 reason 连着来两次也是两个回合，去重窗口会把新回合吞掉。
export async function appendSignal(paths, { reason, message }, now = new Date()) {
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  const line = JSON.stringify({ id: randomUUID(), at: now.toISOString(), reason, message });
  await appendFile(paths.signals, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}

async function mtimeMs(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

// 返回 "bound"（绑死主会话）、"alive"（主会话在场）或 "absent"（没人在场）。
export async function mainPresence(paths, ttlMs, now = Date.now()) {
  if ((await mtimeMs(paths.bindMain)) !== undefined) return "bound";
  const alive = await mtimeMs(paths.mainAlive);
  if (alive !== undefined && now - alive <= ttlMs) return "alive";
  return "absent";
}

export async function touchMainAlive(paths) {
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  await writeFile(paths.mainAlive, "", { flag: "a" });
  const now = new Date();
  await utimes(paths.mainAlive, now, now);
}

export function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readPidFile(file) {
  try {
    return Number.parseInt((await readFile(file, "utf8")).trim(), 10);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

// 基于 O_EXCL 的 pid 锁；持有者进程已死的锁视为过期并回收。
export async function tryAcquirePidLock(file, pid = process.pid) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(file, "wx", 0o600);
      await handle.writeFile(`${pid}\n`);
      await handle.close();
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const holder = await readPidFile(file);
    if (holder !== undefined && isProcessAlive(holder)) return false;
    await unlink(file).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  return false;
}

export async function releasePidLock(file, pid = process.pid) {
  if ((await readPidFile(file)) !== pid) return;
  await unlink(file).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

export async function isPidLockHeld(file) {
  const holder = await readPidFile(file);
  return holder !== undefined && isProcessAlive(holder);
}

async function readOffset(paths) {
  try {
    const value = Number.parseInt((await readFile(paths.offset, "utf8")).trim(), 10);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

// 只读：返回 offset 之后所有完整的行，不推进进度。
export async function peekPending(paths) {
  let buffer;
  try {
    buffer = await readFile(paths.signals);
  } catch (error) {
    if (error?.code === "ENOENT") return { signals: [], end: 0 };
    throw error;
  }
  let start = await readOffset(paths);
  if (start > buffer.length) start = 0; // 文件被清空或轮转过
  const lastNewline = buffer.lastIndexOf(0x0a);
  if (lastNewline < start) return { signals: [], end: start };
  const end = lastNewline + 1;
  const signals = buffer
    .subarray(start, end)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  return { signals, end };
}

export async function commitOffset(paths, end) {
  const temporary = `${paths.offset}.${process.pid}.tmp`;
  await writeFile(temporary, `${end}\n`, { mode: 0o600 });
  await rename(temporary, paths.offset);
}

export async function readStdin(input = process.stdin) {
  let body = "";
  input.setEncoding("utf8");
  for await (const chunk of input) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > MAX_ENVELOPE_BYTES) {
      throw new SignalsError(`stdin exceeds ${MAX_ENVELOPE_BYTES} bytes`);
    }
  }
  return body;
}
