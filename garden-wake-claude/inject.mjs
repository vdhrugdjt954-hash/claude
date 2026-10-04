#!/usr/bin/env node

// Galatea Garden wake bridge -> Claude Code Routine injector.
// 从 stdin 读花园唤醒信封，POST 到绑定了目标会话的 Routine /fire 端点，
// 只有返回的 session_id 与配置的目标会话一致才算投递成功。

import { isIP } from "node:net";
import process from "node:process";
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_TEXT_BYTES = 60 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const ANTHROPIC_HOST = "api.anthropic.com";
const DEFAULT_BETA = "experimental-cc-routine-2026-04-01";
const ANTHROPIC_VERSION = "2023-06-01";
const FIRE_PATH = /^\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/;
const SESSION_ID = /^session_[A-Za-z0-9]+$/;

class InjectorError extends Error {
  constructor(message) {
    super(message);
    this.name = "InjectorError";
  }
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InjectorError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function parseTimeout(value) {
  if (value === undefined || value === "") return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
    throw new InjectorError(
      "CLAUDE_INJECTOR_TIMEOUT_MS must be an integer from 1000 to 120000",
    );
  }
  return parsed;
}

function isLoopback(hostname) {
  if (hostname === "localhost") return true;
  const bare = hostname.replace(/^\[|\]$/g, "");
  const addressType = isIP(bare);
  if (addressType === 4) return bare.startsWith("127.");
  if (addressType === 6) return bare === "::1";
  return false;
}

// Routine token 只允许发往 api.anthropic.com 的 /fire 路径；
// http 仅放行回环地址，留给本地测试。
function parseFireUrl(value) {
  let url;
  try {
    url = new URL(requireString(value, "CLAUDE_ROUTINE_FIRE_URL"));
  } catch (error) {
    if (error instanceof InjectorError) throw error;
    throw new InjectorError("CLAUDE_ROUTINE_FIRE_URL must be a valid URL");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new InjectorError(
      "CLAUDE_ROUTINE_FIRE_URL must not contain credentials, a query or a fragment",
    );
  }
  if (url.protocol === "http:" && isLoopback(url.hostname)) return url;
  if (url.protocol !== "https:" || url.hostname !== ANTHROPIC_HOST) {
    throw new InjectorError(
      `CLAUDE_ROUTINE_FIRE_URL must be https://${ANTHROPIC_HOST}/... (http only for loopback)`,
    );
  }
  if (!FIRE_PATH.test(url.pathname)) {
    throw new InjectorError(
      "CLAUDE_ROUTINE_FIRE_URL must look like /v1/claude_code/routines/trig_.../fire",
    );
  }
  return url;
}

function parseSessionId(value) {
  const id = requireString(value, "CLAUDE_TARGET_SESSION_ID");
  if (!SESSION_ID.test(id)) {
    throw new InjectorError("CLAUDE_TARGET_SESSION_ID must look like session_...");
  }
  return id;
}

async function readEnvelope(input) {
  let body = "";
  input.setEncoding("utf8");
  for await (const chunk of input) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > MAX_INPUT_BYTES) {
      throw new InjectorError(`stdin exceeds ${MAX_INPUT_BYTES} bytes`);
    }
  }

  let envelope;
  try {
    envelope = JSON.parse(body);
  } catch {
    throw new InjectorError("stdin must contain one JSON wake envelope");
  }
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    envelope.version !== 1 ||
    envelope.type !== "garden_wake"
  ) {
    throw new InjectorError("unsupported wake envelope");
  }
  return {
    reason: requireString(envelope.reason, "wake reason"),
    message: requireString(envelope.message, "wake message"),
  };
}

// 服务端 message 原样带上，前面加一行固定标记，方便会话里的 Routine 提示词认出这是花园唤醒。
function buildFireText({ reason, message }) {
  const text = `[garden_wake] reason=${reason}\n${message}`;
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
    throw new InjectorError(`fire text exceeds ${MAX_TEXT_BYTES} bytes`);
  }
  return text;
}

async function fireRoutine({ url, token, beta, timeoutMs, text, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": beta,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new InjectorError("routine fire timed out");
    }
    throw new InjectorError(`routine fire request failed: ${error?.message ?? error}`);
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  if (!response.ok) {
    // 只报状态码和服务端错误类型，不回显完整响应，避免把敏感内容打进桥日志。
    let kind = "";
    try {
      kind = JSON.parse(raw)?.error?.type ?? "";
    } catch {}
    throw new InjectorError(
      `routine fire returned HTTP ${response.status}${kind ? ` (${kind})` : ""}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new InjectorError("routine fire returned non-JSON body");
  }
}

// HTTP 200 不算成功：必须是 routine_fire，且落在配置的那个会话里。
function assertDelivered(result, targetSessionId) {
  if (result?.type !== "routine_fire") {
    throw new InjectorError(`unexpected fire response type ${String(result?.type)}`);
  }
  const sessionId = result.claude_code_session_id;
  if (sessionId !== targetSessionId) {
    throw new InjectorError(
      `routine fired into ${String(sessionId)} instead of ${targetSessionId}; ` +
        "check that the routine is bound to the target session",
    );
  }
  return sessionId;
}

async function injectWake({ url, token, beta, timeoutMs, targetSessionId, envelope, fetchImpl }) {
  const text = buildFireText(envelope);
  const result = await fireRoutine({ url, token, beta, timeoutMs, text, fetchImpl });
  return assertDelivered(result, targetSessionId);
}

async function main() {
  const envelope = await readEnvelope(process.stdin);
  const url = parseFireUrl(process.env.CLAUDE_ROUTINE_FIRE_URL);
  const token = requireString(process.env.CLAUDE_ROUTINE_TOKEN, "CLAUDE_ROUTINE_TOKEN");
  const targetSessionId = parseSessionId(process.env.CLAUDE_TARGET_SESSION_ID);
  const timeoutMs = parseTimeout(process.env.CLAUDE_INJECTOR_TIMEOUT_MS);
  const beta = process.env.CLAUDE_ROUTINE_BETA?.trim() || DEFAULT_BETA;
  const sessionId = await injectWake({
    url,
    token,
    beta,
    timeoutMs,
    targetSessionId,
    envelope,
  });
  process.stdout.write(`${JSON.stringify({ accepted: true, sessionId })}\n`);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Claude routine injector failed: ${message}\n`);
    process.exitCode = 1;
  });
}

export {
  InjectorError,
  assertDelivered,
  buildFireText,
  injectWake,
  parseFireUrl,
  parseSessionId,
  parseTimeout,
  readEnvelope,
};
