#!/usr/bin/env node
// Galatea Garden 唤醒桥的 injector：把 wake 信封转成 Claude Code Routine 的 /fire 请求。
// 从 stdin 读一行 JSON，POST 到 CLAUDE_ROUTINE_FIRE_URL，text 字段带上 reason 和 message。
// 成功退出 0；失败非零并把简短原因写 stderr（桥会重试一次，不会循环）。

import process from "node:process";

const MAX_INPUT_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;

function fail(msg, code = 1) {
  process.stderr.write(`inject-claude-routine: ${msg}\n`);
  process.exit(code);
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) fail("stdin too large", 3);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").split("\n")[0];
}

const fireUrl = process.env.CLAUDE_ROUTINE_FIRE_URL?.trim();
const token = process.env.CLAUDE_ROUTINE_TOKEN?.trim();
if (!fireUrl || !token) fail("CLAUDE_ROUTINE_FIRE_URL and CLAUDE_ROUTINE_TOKEN are required", 3);
if (!fireUrl.startsWith("https://")) fail("CLAUDE_ROUTINE_FIRE_URL must be https", 3);

let envelope;
try {
  envelope = JSON.parse(await readStdin());
} catch {
  fail("stdin is not valid JSON", 3);
}
if (envelope?.version !== 1 || envelope?.type !== "garden_wake") fail("unexpected envelope", 3);
if (typeof envelope.message !== "string" || envelope.message.trim() === "") fail("empty message", 3);

const text = `reason: ${envelope.reason}\nmessage: ${envelope.message}`;

let res;
try {
  res = await fetch(fireUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": process.env.CLAUDE_ROUTINE_BETA || "experimental-cc-routine-2026-04-01",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
} catch (err) {
  fail(`request failed: ${err.name}`);
}

if (!res.ok) {
  const detail = (await res.text().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
  // 4xx 是配置问题，重试没用
  fail(`HTTP ${res.status} ${detail}`, res.status >= 400 && res.status < 500 ? 3 : 1);
}
process.exit(0);
