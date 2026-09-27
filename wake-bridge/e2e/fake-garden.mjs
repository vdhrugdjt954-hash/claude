// 本地假花园：只给 e2e 用，按 stdin 指令推 wake。不连生产。
import { createServer } from "node:http";
import { createInterface } from "node:readline";
const token = process.env.FAKE_TOKEN || "test-token";
let client;
createServer((req, res) => {
  if (req.url !== "/api/machine-events/stream") return res.writeHead(404).end();
  if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end();
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.flushHeaders();
  res.write(`event: connected\ndata: {"version":1}\n\n`);
  client = res;
  console.log("client connected");
}).listen(Number(process.env.FAKE_PORT || 18777), "127.0.0.1", () => console.log("listening"));
createInterface({ input: process.stdin }).on("line", (line) => {
  const [reason, ...rest] = line.split(" ");
  client?.write(`event: wake\ndata: ${JSON.stringify({ reason, message: rest.join(" ") })}\n\n`);
});
