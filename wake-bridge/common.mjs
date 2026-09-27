import { appendFileSync, mkdirSync, rmSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const WAKE_DIR = process.env.GARDEN_WAKE_DIR || join(homedir(), ".garden-wake");
export const MAIN_TTL_MS = Number(process.env.GARDEN_MAIN_TTL_SEC || 600) * 1000;

export const paths = {
  signals: join(WAKE_DIR, "signals.jsonl"),
  offset: join(WAKE_DIR, "signals.offset"),
  mainAlive: join(WAKE_DIR, ".main-alive"),
  bindMain: join(WAKE_DIR, ".bind-main"),
  consumeLock: join(WAKE_DIR, ".consume.lock"),
  oneshotLock: join(WAKE_DIR, ".oneshot.lock"),
  log: join(WAKE_DIR, "wake.log"),
};

mkdirSync(WAKE_DIR, { recursive: true });

export function log(line) {
  appendFileSync(paths.log, `${new Date().toISOString()} ${line}\n`);
}

// 主会话在场：.bind-main 存在，或者 .main-alive 在 TTL 内被 touch 过
export function mainPresent(now = Date.now()) {
  if (existsSync(paths.bindMain)) return "bind";
  try {
    return now - statSync(paths.mainAlive).mtimeMs < MAIN_TTL_MS ? "alive" : null;
  } catch {
    return null;
  }
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// mkdir 锁，拿不到就等一会儿，锁主死了就清掉
export async function withLock(dir, fn, { waitMs = 5000 } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(dir);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - statSync(dir).mtimeMs > 60_000) rmSync(dir, { recursive: true, force: true });
      else if (Date.now() > deadline) throw new Error(`lock busy: ${dir}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
