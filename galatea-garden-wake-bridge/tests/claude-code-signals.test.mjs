import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { duty } from "../integrations/claude-code-signals/duty.mjs";
import { inject } from "../integrations/claude-code-signals/inject.mjs";
import { runCommand } from "../integrations/claude-code-signals/main-session.mjs";
import {
  mainPresence,
  peekPending,
  resolvePaths,
  tryAcquirePidLock,
} from "../integrations/claude-code-signals/signals.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const injector = path.join(root, "integrations/claude-code-signals/inject.mjs");
const sentinel = path.join(root, "integrations/claude-code-signals/sentinel.sh");

function envelope(reason = "game_turn_required", message = "轮到你了") {
  return JSON.stringify({ version: 1, type: "garden_wake", reason, message });
}

async function withDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "garden-signals-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function fakeClaude(dir, exitCode = 0) {
  const script = path.join(dir, "fake-claude.mjs");
  await writeFile(
    script,
    [
      "#!/usr/bin/env node",
      'import { appendFileSync } from "node:fs";',
      "let body = '';",
      "for await (const chunk of process.stdin) body += chunk;",
      `appendFileSync(${JSON.stringify(path.join(dir, "prompts.log"))}, JSON.stringify({ argv: process.argv.slice(2), body }) + "\\n");`,
      `process.exit(${exitCode});`,
    ].join("\n"),
  );
  await chmod(script, 0o755);
  return script;
}

test("injector appends one line per wake and never dedupes", async () => {
  await withDir(async (dir) => {
    const env = { GARDEN_SIGNALS_DIR: dir };
    await writeFile(path.join(dir, ".bind-main"), "");
    await inject({ body: envelope(), env });
    const result = await inject({ body: envelope(), env });
    assert.deepEqual(result, { presence: "bound", duty: "skipped" });
    const { signals } = await peekPending(resolvePaths(env));
    assert.equal(signals.length, 2);
    assert.notEqual(signals[0].id, signals[1].id);
  });
});

test("fresh .main-alive means present, stale means absent", async () => {
  await withDir(async (dir) => {
    const paths = resolvePaths({ GARDEN_SIGNALS_DIR: dir });
    assert.equal(await mainPresence(paths, 600_000), "absent");
    await runCommand("alive", { GARDEN_SIGNALS_DIR: dir });
    assert.equal(await mainPresence(paths, 600_000), "alive");
    const old = new Date(Date.now() - 11 * 60 * 1000);
    await utimes(paths.mainAlive, old, old);
    assert.equal(await mainPresence(paths, 600_000), "absent");
  });
});

test("injector rejects invalid envelopes", async () => {
  await withDir(async (dir) => {
    const child = spawn(process.execPath, [injector], {
      env: { ...process.env, GARDEN_SIGNALS_DIR: dir },
      stdio: ["pipe", "ignore", "pipe"],
    });
    child.stdin.end('{"version":2}');
    const [code] = await once(child, "exit");
    assert.equal(code, 1);
  });
});

test("peek does not move progress, take is the only consumer", async () => {
  await withDir(async (dir) => {
    const env = { GARDEN_SIGNALS_DIR: dir };
    await writeFile(path.join(dir, ".bind-main"), "");
    await inject({ body: envelope("a", "one"), env });
    assert.equal((await runCommand("peek", env)).signals.length, 1);
    assert.equal((await runCommand("peek", env)).signals.length, 1);
    assert.equal((await runCommand("take", env)).signals.length, 1);
    assert.equal((await runCommand("take", env)).signals.length, 0);

    const paths = resolvePaths(env);
    assert.equal(await tryAcquirePidLock(paths.consumeLock, process.pid), true);
    await inject({ body: envelope("b", "two"), env });
    const busy = await runCommand("take", env);
    assert.equal(busy.busy, true);
  });
});

test("duty runs claude -p once for backlog and commits only on success", async () => {
  await withDir(async (dir) => {
    const env = {
      ...process.env,
      GARDEN_SIGNALS_DIR: dir,
      CLAUDE_BIN: await fakeClaude(dir, 1),
    };
    const paths = resolvePaths(env);
    await writeFile(path.join(dir, ".bind-main"), "");
    await inject({ body: envelope("a", "one"), env });
    await inject({ body: envelope("b", "two"), env });
    await rm(paths.bindMain);

    assert.equal(await duty(env), 0);
    assert.equal((await peekPending(paths)).signals.length, 2);

    env.CLAUDE_BIN = await fakeClaude(dir, 0);
    await rm(path.join(dir, "prompts.log"));
    assert.equal(await duty(env), 1);
    assert.equal((await peekPending(paths)).signals.length, 0);

    const [call] = (await readFile(path.join(dir, "prompts.log"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(call.argv, ["-p"]);
    assert.match(call.body, /\[a\] one/u);
    assert.match(call.body, /\[b\] two/u);
  });
});

test("duty stands down when main session is present", async () => {
  await withDir(async (dir) => {
    const env = { ...process.env, GARDEN_SIGNALS_DIR: dir, CLAUDE_BIN: await fakeClaude(dir) };
    await runCommand("alive", env);
    await inject({ body: envelope(), env });
    assert.equal(await duty(env), 0);
    assert.equal((await peekPending(resolvePaths(env))).signals.length, 1);
  });
});

test("injector starts a detached duty when nobody is present", async () => {
  await withDir(async (dir) => {
    const env = { ...process.env, GARDEN_SIGNALS_DIR: dir, CLAUDE_BIN: await fakeClaude(dir) };
    const result = await inject({ body: envelope("x", "hello"), env });
    assert.deepEqual(result, { presence: "absent", duty: "started" });
    const paths = resolvePaths(env);
    const deadline = Date.now() + 10_000;
    while ((await peekPending(paths)).signals.length > 0) {
      assert.ok(Date.now() < deadline, "duty did not consume in time");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.match(await readFile(path.join(dir, "prompts.log"), "utf8"), /\[x\] hello/u);
  });
});

test(
  "sentinel exits with only the new lines once signals grow",
  { skip: process.platform === "win32" },
  async () => {
    await withDir(async (dir) => {
      const env = { GARDEN_SIGNALS_DIR: dir };
      await writeFile(path.join(dir, ".bind-main"), "");
      await inject({ body: envelope("old", "old"), env });
      const child = spawn("sh", [sentinel], {
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "inherit"],
      });
      let out = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => (out += chunk));
      await new Promise((resolve) => setTimeout(resolve, 500));
      await inject({ body: envelope("new", "new"), env });
      const [code] = await once(child, "exit");
      assert.equal(code, 0);
      assert.match(out, /"reason":"new"/u);
      assert.doesNotMatch(out, /"reason":"old"/u);
      assert.equal((await peekPending(resolvePaths(env))).signals.length, 2);
    });
  },
);
