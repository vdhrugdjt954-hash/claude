import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertDelivered,
  buildFireText,
  injectWake,
  parseFireUrl,
  parseSessionId,
  readEnvelope,
} from "../inject.mjs";

const SCRIPT = fileURLToPath(new URL("../inject.mjs", import.meta.url));
const SESSION = "session_016Lf7beGmJEbahGjTQSrQVi";
const ENVELOPE = {
  version: 1,
  type: "garden_wake",
  reason: "forum_notification_available",
  message: "你有新的帖子通知。",
};

test("parseFireUrl accepts the official fire endpoint", () => {
  const url = parseFireUrl(
    "https://api.anthropic.com/v1/claude_code/routines/trig_01ABCdef/fire",
  );
  assert.equal(url.hostname, "api.anthropic.com");
});

test("parseFireUrl rejects other hosts, plain http and wrong paths", () => {
  for (const bad of [
    "https://evil.example/v1/claude_code/routines/trig_01ABC/fire",
    "http://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire",
    "https://api.anthropic.com/v1/messages",
    "https://u:p@api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire",
    "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire?x=1",
    "not a url",
  ]) {
    assert.throws(() => parseFireUrl(bad), /CLAUDE_ROUTINE_FIRE_URL/, bad);
  }
  assert.ok(parseFireUrl("http://127.0.0.1:9/anything"));
});

test("parseSessionId requires a session_ id", () => {
  assert.equal(parseSessionId(` ${SESSION} `), SESSION);
  assert.throws(() => parseSessionId("abc"), /session_/);
  assert.throws(() => parseSessionId(undefined), /CLAUDE_TARGET_SESSION_ID/);
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

test("buildFireText keeps the server message verbatim", () => {
  assert.equal(
    buildFireText({ reason: "r", message: "第一行\n第二行" }),
    "[garden_wake] reason=r\n第一行\n第二行",
  );
});

test("assertDelivered requires the configured session", () => {
  const ok = { type: "routine_fire", claude_code_session_id: SESSION };
  assert.equal(assertDelivered(ok, SESSION), SESSION);
  assert.throws(
    () => assertDelivered({ ...ok, claude_code_session_id: "session_other" }, SESSION),
    /instead of/,
  );
  assert.throws(() => assertDelivered({}, SESSION), /response type/);
});

test("injectWake sends headers and body, surfaces HTTP errors", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url: String(url), init };
    return new Response(
      JSON.stringify({ type: "routine_fire", claude_code_session_id: SESSION }),
      { status: 200 },
    );
  };
  const args = {
    url: new URL("https://api.anthropic.com/v1/claude_code/routines/trig_01A/fire"),
    token: "tok",
    beta: "beta-x",
    timeoutMs: 1000,
    targetSessionId: SESSION,
    envelope: { reason: "r", message: "m" },
    fetchImpl,
  };
  assert.equal(await injectWake(args), SESSION);
  assert.equal(seen.init.headers.Authorization, "Bearer tok");
  assert.equal(seen.init.headers["anthropic-beta"], "beta-x");
  assert.deepEqual(JSON.parse(seen.init.body), { text: "[garden_wake] reason=r\nm" });

  const failing = async () =>
    new Response(JSON.stringify({ error: { type: "authentication_error" } }), {
      status: 401,
    });
  await assert.rejects(
    injectWake({ ...args, fetchImpl: failing }),
    /HTTP 401 \(authentication_error\)/,
  );
});

function runScript(env, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, ...env },
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

test("end to end against a loopback fake fire endpoint", async () => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ headers: req.headers, body: JSON.parse(body) });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({ type: "routine_fire", claude_code_session_id: SESSION }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    const env = {
      CLAUDE_ROUTINE_FIRE_URL: `http://127.0.0.1:${port}/fire`,
      CLAUDE_ROUTINE_TOKEN: "secret-token",
      CLAUDE_TARGET_SESSION_ID: SESSION,
    };
    const ok = await runScript(env, JSON.stringify(ENVELOPE));
    assert.equal(ok.code, 0, ok.stderr);
    assert.deepEqual(JSON.parse(ok.stdout), { accepted: true, sessionId: SESSION });
    assert.equal(requests[0].headers.authorization, "Bearer secret-token");
    assert.match(requests[0].body.text, /^\[garden_wake\] reason=forum_notification_available\n/);

    const wrong = await runScript(
      { ...env, CLAUDE_TARGET_SESSION_ID: "session_someoneElse" },
      JSON.stringify(ENVELOPE),
    );
    assert.equal(wrong.code, 1);
    assert.match(wrong.stderr, /instead of session_someoneElse/);
    assert.doesNotMatch(wrong.stderr, /secret-token/);
  } finally {
    server.close();
  }
});
