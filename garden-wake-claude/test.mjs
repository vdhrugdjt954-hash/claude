import assert from "node:assert/strict";
import test from "node:test";
import { injectWake, parseFireUrl, parseWakeEnvelope } from "./inject-claude.mjs";

const env = {
  CLAUDE_ROUTINE_FIRE_URL: "https://api.anthropic.com/v1/claude_code/routines/trig_abc123/fire",
  CLAUDE_ROUTINE_TOKEN: "t",
  CLAUDE_SESSION_ID: "session_ours",
};
const envelope = { reason: "reply", message: "有人回帖" };
const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });

test("token 只发往 api.anthropic.com", () => {
  assert.throws(() => parseFireUrl("https://evil.example/v1/claude_code/routines/trig_a/fire"));
  assert.throws(() => parseFireUrl("http://api.anthropic.com/v1/claude_code/routines/trig_a/fire"));
  assert.throws(() => parseFireUrl("https://api.anthropic.com/v1/claude_code/routines/trig_a"));
});

test("信封格式不对就拒收", () => {
  assert.throws(() => parseWakeEnvelope("{}"));
  assert.deepEqual(
    parseWakeEnvelope('{"version":1,"type":"garden_wake","reason":" r ","message":" m "}'),
    { reason: "r", message: "m" },
  );
});

test("敲到我们的窗口算成功", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ claude_code_session_id: "session_ours" }), { status: 200 });
  };
  await injectWake({ envelope, env, fetchImpl });
  assert.equal(sent.url, env.CLAUDE_ROUTINE_FIRE_URL);
  assert.equal(sent.body.text, "reason: reply\nmessage: 有人回帖");
});

test("醒错窗口不算成功", async () => {
  await assert.rejects(
    injectWake({ envelope, env, fetchImpl: reply(200, { claude_code_session_id: "session_other" }) }),
    (e) => e.exitCode === 3,
  );
});

test("4xx 不重试，5xx 交给桥重试", async () => {
  await assert.rejects(injectWake({ envelope, env, fetchImpl: reply(401, {}) }), (e) => e.exitCode === 3);
  await assert.rejects(injectWake({ envelope, env, fetchImpl: reply(503, {}) }), (e) => e.exitCode === 1);
});
