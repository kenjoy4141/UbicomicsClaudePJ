/** Playwright が Chromium を見つけられるか診断する */
import fs from "node:fs";
import { chromium } from "playwright";

console.log("node            :", process.version);
console.log("cwd             :", process.cwd());
console.log("LOCALAPPDATA    :", process.env.LOCALAPPDATA);
console.log("PW_BROWSERS_PATH:", process.env.PLAYWRIGHT_BROWSERS_PATH ?? "(未設定)");

let exe = "(取得失敗)";
try {
  exe = chromium.executablePath();
} catch (e) {
  exe = `(エラー) ${e.message.split("\n")[0]}`;
}
console.log("executablePath  :", exe);
console.log("存在するか      :", fs.existsSync(exe) ? "OK" : "NG ← ここが原因");

try {
  const b = await chromium.launch({ headless: true });
  console.log("起動テスト      : OK", b.version());
  await b.close();
} catch (e) {
  console.log("起動テスト      : NG", e.message.split("\n")[0]);
}
