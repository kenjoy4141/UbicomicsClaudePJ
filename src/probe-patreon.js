/** Patreonの管理画面・投稿作成ページのDOMを調べる（調査用・何も投稿しない） */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, openBrowser, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const target = process.argv[2] ?? "https://www.patreon.com/home";
const shot = process.argv[3] ?? "probe-patreon";
const { ctx, page } = await openBrowser(cfg, { headless: false });

await page.goto(target, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
console.log("URL  :", page.url());
console.log("TITLE:", await page.title());
if (/\/login/.test(page.url())) {
  log("未ログインです。node src/login.js patreon を実行してください。");
  await ctx.close();
  process.exit(2);
}

const info = await page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const links = [...document.querySelectorAll("a[href]")].filter(vis)
    .map((a) => `${(a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 30).replace(/\s+/g, " ")} -> ${a.href}`);
  const controls = [...document.querySelectorAll("input,textarea,select,button,[contenteditable=true],[role=button]")].filter(vis)
    .map((el) => `<${el.tagName.toLowerCase()}${el.type ? ` type=${el.type}` : ""}${el.name ? ` name=${el.name}` : ""}` +
      `${el.getAttribute("data-tag") ? ` data-tag=${el.getAttribute("data-tag")}` : ""}` +
      `${el.getAttribute("aria-label") ? ` aria="${el.getAttribute("aria-label")}"` : ""}` +
      `${el.placeholder ? ` ph="${el.placeholder}"` : ""}> ${(el.innerText || "").trim().slice(0, 40).replace(/\s+/g, " ")}`);
  return { links: [...new Set(links)], controls };
});
console.log("\n--- links ---");
info.links.slice(0, 80).forEach((l) => console.log("  " + l));
console.log("\n--- controls ---");
info.controls.slice(0, 80).forEach((c) => console.log("  " + c));

const out = path.join(ROOT, "logs", `${shot}.png`);
await page.screenshot({ path: out });
log(`screenshot: ${out}`);
await ctx.close();
