#!/usr/bin/env node

// Galatea Garden wake bridge -> 本机 tmux 里的 Claude Code 会话。
// 从 stdin 读花园唤醒信封，粘贴进配置好的 tmux pane 并回车；
// 只有在 pane 里看到这次投递的标记才算成功。pane 不存在就失败，不新开。

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_EXPECT_COMMANDS = ["claude", "node"];
const SUBMIT_DELAY_MS = 300;
const POLL_INTERVAL_MS = 250;

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

// tmux 目标写死成 session:window.pane，不接受 "最近的" 之类的模糊目标。
function parseTarget(value) {
  const target = requireString(value, "CLAUDE_TMUX_TARGET");
  if (!/^[A-Za-z0-9_.-]+:[0-9]+\.[0-9]+$/.test(target)) {
    throw new InjectorError("CLAUDE_TMUX_TARGET must look like session:window.pane, e.g. linfan:0.0");
  }
  return target;
}

function parseExpectCommands(value) {
  if (value === undefined || value.trim() === "") return DEFAULT_EXPECT_COMMANDS;
  const list = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) throw new InjectorError("CLAUDE_TMUX_EXPECT_COMMAND is empty");
  return list;
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

// 服务端 message 原样带上，前面是带随机 ID 的标记，用来确认这一次确实进了 pane。
// 压成一行：Claude Code 会把多行长粘贴折叠成 [Pasted text]，标记就看不到了。
function buildPrompt({ reason, message }, deliveryId) {
  const flat = message.replace(/\s*\r?\n\s*/g, " / ").trim();
  return `[garden_wake ${deliveryId}] reason=${reason} | ${flat}`;
}

function runTmux(args, { input, timeoutMs, tmuxBin = "tmux" } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      tmuxBin,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || error.message).trim().split("\n")[0];
          reject(new InjectorError(`tmux ${args[0]} failed: ${detail}`));
          return;
        }
        resolve(stdout);
      },
    );
    if (input !== undefined) child.stdin.end(input);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 原生安装的 Claude Code 可执行文件是 ~/.local/share/claude/versions/<版本号>，
// tmux 显示的进程名就是版本号，所以期望里有 claude 时也认 2.1.289 这种名字。
function matchesExpected(current, expectCommands) {
  if (expectCommands.includes(current)) return true;
  return expectCommands.includes("claude") && /^\d+\.\d+\.\d+$/.test(current);
}

// Claude Code 的选择框会出现 "❯ 1. Yes" 这样的光标行，或 "Do you want to ..." 的确认问句。
function hasOpenDialog(screen) {
  const tail = screen.split("\n").filter((l) => l.trim() !== "").slice(-25).join("\n");
  return /^\s*❯\s*(\d+\.|✔)/m.test(tail) || /Do you want to /.test(tail);
}

async function injectWake({ target, expectCommands, timeoutMs, envelope, tmux = runTmux }) {
  const deadline = Date.now() + timeoutMs;
  const opts = () => ({ timeoutMs: Math.max(1_000, deadline - Date.now()) });

  // 1. 目标 pane 必须已经存在，并且跑的是 Claude Code。
  // display-message 对不存在的目标有时不报错只回空，所以先 has-session，再要求 pane 信息非空。
  const missing = new InjectorError(`tmux pane ${target} does not exist; start Claude Code there first`);
  let current;
  try {
    await tmux(["has-session", "-t", target.split(":")[0]], opts());
    const info = (await tmux(["display-message", "-p", "-t", target, "#{pane_id} #{pane_current_command}"], opts())).trim();
    const [paneId, ...rest] = info.split(" ");
    if (!paneId?.startsWith("%")) throw missing;
    current = rest.join(" ");
  } catch {
    throw missing;
  }
  if (!matchesExpected(current, expectCommands)) {
    throw new InjectorError(
      `tmux pane ${target} is running "${current}", expected one of ${expectCommands.join(", ")}`,
    );
  }

  // 2. 屏幕上有选择框（权限确认、主题选择等）时不能回车，否则会替她点掉选项。等它消失，超时就失败。
  for (;;) {
    const screen = await tmux(["capture-pane", "-p", "-t", target], opts());
    if (!hasOpenDialog(screen)) break;
    if (Date.now() + POLL_INTERVAL_MS >= deadline) {
      throw new InjectorError(`a selection dialog is open in ${target}; not pressing Enter`);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  // 3. 用 bracketed paste 贴进去，再单独回车提交。
  const deliveryId = randomBytes(4).toString("hex");
  const marker = `[garden_wake ${deliveryId}]`;
  const buffer = `garden-wake-${deliveryId}`;
  await tmux(["load-buffer", "-b", buffer, "-"], { ...opts(), input: buildPrompt(envelope, deliveryId) });
  await tmux(["paste-buffer", "-p", "-d", "-b", buffer, "-t", target], opts());
  await sleep(SUBMIT_DELAY_MS);
  await tmux(["send-keys", "-t", target, "Enter"], opts());

  // 4. 在 pane 里看到这次的标记才算投递成功。
  while (Date.now() < deadline) {
    const screen = await tmux(["capture-pane", "-p", "-J", "-S", "-200", "-t", target], opts());
    if (screen.includes(marker)) return deliveryId;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new InjectorError(`marker ${marker} never showed up in ${target}`);
}

async function main() {
  const envelope = await readEnvelope(process.stdin);
  const target = parseTarget(process.env.CLAUDE_TMUX_TARGET);
  const expectCommands = parseExpectCommands(process.env.CLAUDE_TMUX_EXPECT_COMMAND);
  const timeoutMs = parseTimeout(process.env.CLAUDE_INJECTOR_TIMEOUT_MS);
  const deliveryId = await injectWake({ target, expectCommands, timeoutMs, envelope });
  process.stdout.write(`${JSON.stringify({ accepted: true, target, deliveryId })}\n`);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Claude tmux injector failed: ${message}\n`);
    process.exitCode = 1;
  });
}

export {
  InjectorError,
  buildPrompt,
  hasOpenDialog,
  injectWake,
  matchesExpected,
  parseExpectCommands,
  parseTarget,
  parseTimeout,
  readEnvelope,
  runTmux,
};
