#!/usr/bin/env node
// 消费：唯一推进 signals.offset 的地方。打印新信号（每行一条 JSON），然后前移进度。
// 只想看不想消费，用 tail，别调这个。
import { readFileSync, writeFileSync, openSync, readSync, closeSync, fstatSync } from "node:fs";
import { paths, withLock } from "./common.mjs";

export async function consume() {
  return withLock(paths.consumeLock, () => {
    let offset = 0;
    try {
      offset = Number(readFileSync(paths.offset, "utf8").trim()) || 0;
    } catch {}
    let fd;
    try {
      fd = openSync(paths.signals, "r");
    } catch {
      return [];
    }
    try {
      const size = fstatSync(fd).size;
      if (size < offset) offset = 0; // 文件被轮转过
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      const end = buf.lastIndexOf(0x0a) + 1; // 只收完整的行
      if (end === 0) return [];
      writeFileSync(paths.offset, String(offset + end));
      return buf
        .subarray(0, end)
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } finally {
      closeSync(fd);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const signal of await consume()) process.stdout.write(`${JSON.stringify(signal)}\n`);
}
