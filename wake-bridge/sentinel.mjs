#!/usr/bin/env node
// 主会话后台哨兵：只看不消费。哨兵活着就持续打卡；signals.jsonl 一变长就退出，harness 叫醒主会话。
// Windows / macOS / Linux 通用。
import { statSync, writeFileSync, utimesSync, closeSync, openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { paths } from "./common.mjs";

closeSync(openSync(paths.signals, "a"));
const size = () => statSync(paths.signals).size;
const start = size();
const beat = () => {
  try {
    const now = new Date();
    utimesSync(paths.mainAlive, now, now);
  } catch {
    writeFileSync(paths.mainAlive, "");
  }
};
beat();
const timer = setInterval(() => {
  if (size() !== start) {
    clearInterval(timer);
    beat();
    console.log(`garden wake: run node "${fileURLToPath(new URL("./consume.mjs", import.meta.url))}"`);
    return;
  }
  beat();
}, 2000);
