#!/usr/bin/env node
// 花园唤醒桥 → Claude Code routine → 林帆这个窗口。
// 照着 name613/garden-wake-operit 的边界改的：只敲配好的那个 routine，
// token 只发给 api.anthropic.com，HTTP 2xx 之外还要核对回来的会话。

import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 16 * 1024;
const TIMEOUT_MS = 15_000;
const ALLOWED_HOST = "api.anthropic.com";

class InjectorError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "InjectorError";
    this.exitCode = exitCode;
  }
}

function requireEnv(name, env) {
  const value = env[name]?.trim();
  if (!value) throw new InjectorError(`${name} is required`, 3);
  return value;
}

function parseFireUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new InjectorError("CLAUDE_ROUTINE_FIRE_URL must be a valid URL", 3);
  }
  if (url.protocol !== "https:" || url.hostname !== ALLOWED_HOST) {
    throw new InjectorError(`Refusing to send the routine token anywhere but https://${ALLOWED_HOST}`, 3);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new InjectorError("CLAUDE_ROUTINE_FIRE_URL must be a bare fire URL", 3);
  }
  if (!/\/trig_[A-Za-z0-9]+\/fire$/.test(url.pathname)) {
    throw new InjectorError("CLAUDE_ROUTINE_FIRE_URL must end with /trig_.../fire", 3);
  }
  return url;
}

function parseWakeEnvelope(raw) {
  let value;
  try {
    value = JSON.parse(raw.split("\n")[0]);
  } catch {
    throw new InjectorError("stdin must contain one Garden wake JSON envelope", 3);
  }
  if (
    value === null ||
    typeof value !== "object" ||
    value.version !== 1 ||
    value.type !== "garden_wake" ||
    typeof value.reason !== "string" ||
    !value.reason.trim() ||
    typeof value.message !== "string" ||
    !value.message.trim()
  ) {
    throw new InjectorError("invalid Garden wake envelope", 3);
  }
  if (value.message.length > 4096) {
    throw new InjectorError("Garden wake message is too long", 3);
  }
  return { reason: value.reason.trim(), message: value.message.trim() };
}

async function readStdin(stdin = process.stdin) {
  stdin.setEncoding("utf8");
  let raw = "";
  for await (const chunk of stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > MAX_INPUT_BYTES) {
      throw new InjectorError("Garden wake envelope is too large", 3);
    }
  }
  return raw.trim();
}

// 回包里能找到的会话 ID；字段名没有公开文档，几种常见写法都认。
function returnedSessionId(result) {
  if (!result || typeof result !== "object") return undefined;
  return result.claude_code_session_id ?? result.session_id ?? result.session?.id;
}

async function injectWake({ envelope, env = process.env, fetchImpl = fetch }) {
  const url = parseFireUrl(requireEnv("CLAUDE_ROUTINE_FIRE_URL", env));
  const token = requireEnv("CLAUDE_ROUTINE_TOKEN", env);
  const expectedSession = env.CLAUDE_SESSION_ID?.trim();

  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: `reason: ${envelope.reason}\nmessage: ${envelope.message}` }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new InjectorError(`request failed: ${error?.name || "Error"}`);
  }

  const bodyText = await response.text();
  if (!response.ok) {
    // 4xx 是配置错（钥匙、门牌号），重试没用；5xx 交给桥重试。
    throw new InjectorError(`HTTP ${response.status} ${bodyText.slice(0, 300)}`, response.status < 500 ? 3 : 1);
  }
  let result;
  try {
    result = JSON.parse(bodyText);
  } catch {
    result = undefined;
  }
  const sessionId = returnedSessionId(result);
  if (expectedSession && sessionId && sessionId !== expectedSession) {
    throw new InjectorError(`routine woke ${sessionId}, not ${expectedSession}; delivery rejected`, 3);
  }
  return { sessionId };
}

async function main(argv = process.argv.slice(2)) {
  let envelope;
  if (argv[0] === "--test") {
    envelope = { reason: "bridge_test", message: "门铃测试：桥这头通了，不用回花园。" };
  } else if (argv[0] === "--bridge-down") {
    envelope = {
      reason: "bridge_down",
      message: `花园唤醒桥断了（退出码 ${argv[1] ?? "?"}），不会自己重连。提醒雨墨在 garden-wake-claude 里跑 ./start.sh。`,
    };
  } else {
    envelope = parseWakeEnvelope(await readStdin());
  }
  const { sessionId } = await injectWake({ envelope });
  process.stderr.write(`delivered${sessionId ? ` to ${sessionId}` : ""}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof InjectorError ? error.exitCode : 1;
  });
}

export { InjectorError, injectWake, parseFireUrl, parseWakeEnvelope, returnedSessionId };
