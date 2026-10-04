import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { Readable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPrompt,
  hasOpenDialog,
  injectWake,
  parseExpectCommands,
  parseTarget,
  readEnvelope,
} from "../inject.mjs";

const SCRIPT = fileURLToPath(new URL("../inject.mjs", import.meta.url));
const ENVELOPE = {
  version: 1,
  type: "garden_wake",
  reason: "forum_notification_available",
  message: "你有新的帖子通知。\n第二行",
};

test("parseTarget only accepts session:window.pane", () => {
  assert.equal(parseTarget(" linfan:0.0 "), "linfan:0.0");
  for (const bad of ["linfan", "linfan:0", ":0.0", "a b:0.0", "x;rm:0.0", undefined]) {
    assert.throws(() => parseTarget(bad), /CLAUDE_TMUX_TARGET/, String(bad));
  }
});

test("parseExpectCommands defaults and splits", () => {
  assert.deepEqual(parseExpectCommands(undefined), ["claude", "node"]);
  assert.deepEqual(parseExpectCommands(" claude , cat "), ["claude", "cat"]);
});

test("readEnvelope validates the wake envelope", async () => {
  const ok = await readEnvelope(Readable.from([JSON.stringify(ENVELOPE)]));
  assert.deepEqual(ok, { reason: ENVELOPE.reason, message: ENVELOPE.message });
  await assert.rejects(
    readEnvelope(Readable.from([JSON.stringify({ ...ENVELOPE, version: 2 })])),
    /unsupported/,
  );
  await assert.rejects(
    readEnvelope(Readable.from([JSON.stringify({ ...ENVELOPE, message: " " })])),
    /wake message/,
  );
  await assert.rejects(readEnvelope(Readable.from(["{"])), /JSON/);
});

test("buildPrompt keeps the server message verbatim", () => {
  assert.equal(buildPrompt({ reason: "r", message: "a\n b\r\nc" }, "ab12"), "[garden_wake ab12] reason=r | a / b / c");
});

test("hasOpenDialog spots permission and picker prompts", () => {
  assert.ok(hasOpenDialog("Bash command\n Do you want to proceed?\n ❯ 1. Yes\n   2. No"));
  assert.ok(hasOpenDialog(" Choose the text style\n ❯ ✔ Dark mode\n   Light mode"));
  assert.ok(!hasOpenDialog("> 帮我看看花园\n\n────\n❯ \n  ? for shortcuts"));
});

test("injectWake does not press Enter while a dialog is open", async () => {
  const calls = [];
  const tmux = async (args) => {
    calls.push(args[0]);
    if (args[0] === "display-message") return "%1 claude\n";
    if (args[0] === "capture-pane") return "Do you want to proceed?\n ❯ 1. Yes\n";
    return "";
  };
  await assert.rejects(
    injectWake({ target: "x:0.0", expectCommands: ["claude"], timeoutMs: 1000, envelope: { reason: "r", message: "m" }, tmux }),
    /dialog is open/,
  );
  assert.ok(!calls.includes("send-keys") && !calls.includes("paste-buffer"));
});

test("injectWake refuses a missing pane or the wrong program", async () => {
  const envelope = { reason: "r", message: "m" };
  const missing = async () => {
    throw new Error("can't find pane");
  };
  await assert.rejects(
    injectWake({ target: "x:0.0", expectCommands: ["claude"], timeoutMs: 1000, envelope, tmux: missing }),
    /does not exist/,
  );

  const calls = [];
  const wrong = async (args) => {
    calls.push(args[0]);
    return args[0] === "display-message" ? "%3 bash\n" : "";
  };
  await assert.rejects(
    injectWake({ target: "x:0.0", expectCommands: ["claude"], timeoutMs: 1000, envelope, tmux: wrong }),
    /running "bash"/,
  );
  assert.deepEqual(calls, ["has-session", "display-message"]);
});

function tmux(...args) {
  return execFileSync("tmux", args, { encoding: "utf8" });
}

function runScript(env, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, TMUX_TMPDIR: process.env.TMUX_TMPDIR, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test("end to end against a real tmux pane", async () => {
  const session = `gwtest${process.pid}`;
  tmux("new-session", "-d", "-s", session, "-x", "200", "-y", "50", "cat");
  try {
    const env = {
      CLAUDE_TMUX_TARGET: `${session}:0.0`,
      CLAUDE_TMUX_EXPECT_COMMAND: "cat",
      CLAUDE_INJECTOR_TIMEOUT_MS: "5000",
    };
    const ok = await runScript(env, JSON.stringify(ENVELOPE));
    assert.equal(ok.code, 0, ok.stderr);
    const { deliveryId } = JSON.parse(ok.stdout);
    const screen = tmux("capture-pane", "-p", "-t", `${session}:0.0`);
    assert.match(screen, new RegExp(`\\[garden_wake ${deliveryId}\\] reason=forum_notification_available`));
    assert.match(screen, /第二行/);

    const wrongProgram = await runScript(
      { ...env, CLAUDE_TMUX_EXPECT_COMMAND: "claude" },
      JSON.stringify(ENVELOPE),
    );
    assert.equal(wrongProgram.code, 1);
    assert.match(wrongProgram.stderr, /running "cat"/);

    const noPane = await runScript(
      { ...env, CLAUDE_TMUX_TARGET: "nosuchsession:0.0" },
      JSON.stringify(ENVELOPE),
    );
    assert.equal(noPane.code, 1);
    assert.match(noPane.stderr, /does not exist/);
    assert.throws(() => tmux("has-session", "-t", "nosuchsession"));
  } finally {
    tmux("kill-session", "-t", session);
  }
});
