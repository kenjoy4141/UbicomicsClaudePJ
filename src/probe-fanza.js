/**
 * FANZA同人の管理画面を調べる（調査用・何も登録しない）。
 *
 *   node src/probe-fanza.js A
 *   node src/probe-fanza.js A https://circle.dmm.co.jp/...
 *
 * アカウントごとにブラウザのプロファイルを分けている（data/browser-profile-fanza-A など）。
 */
import path from "node:path";
import { loadConfig, openBrowser, restoreCookies, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const account = process.argv[2] ?? "A";
const target = process.argv[3] ?? "https://circle.dmm.co.jp/";
const { ctx, page } = await openBrowser(cfg, { headless: false, profile: `fanza-${account}` });

await restoreCookies(ctx, `fanza-${account}`);
await page.goto(target, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
console.log("URL  :", page.url());
console.log("TITLE:", await page.title());

const info = await page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const links = [...document.querySelectorAll("a[href]")].filter(vis)
    .map((a) => `${(a.innerText || "").trim().replace(/\s+/g, " ").slice(0, 26)} -> ${a.href}`);
  const controls = [...document.querySelectorAll("input,select,textarea,button")].filter(vis)
    .map((el) => `<${el.tagName.toLowerCase()}${el.type ? ` type=${el.type}` : ""}${el.name ? ` name=${el.name}` : ""}` +
      `${el.id ? ` id=${el.id}` : ""}> ${(el.innerText || el.value || "").trim().slice(0, 30)}`);
  return { links: [...new Set(links)], controls: [...new Set(controls)], text: document.body.innerText.slice(0, 400) };
});

console.log("\n--- 本文の冒頭 ---");
console.log(info.text.replace(/\n{2,}/g, "\n"));
console.log("\n--- リンク ---");
info.links.slice(0, 40).forEach((l) => console.log("  " + l));
console.log("\n--- 入力欄・ボタン ---");
info.controls.slice(0, 40).forEach((c) => console.log("  " + c));

await page.screenshot({ path: path.join(ROOT, `logs/probe-fanza-${account}.png`), fullPage: true });
log(`スクショ: logs/probe-fanza-${account}.png`);
await ctx.close();
