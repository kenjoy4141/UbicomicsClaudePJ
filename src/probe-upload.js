/**
 * pixiv 投稿ページの DOM 構造を採取して logs/upload-dom.txt に出力する。
 * セレクタを確定させるための調査用スクリプト。何も投稿しない。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, openBrowser, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const { ctx, page } = await openBrowser(cfg, { headless: false });

await page.goto(cfg.pixiv.createUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

if (/accounts\.pixiv\.net\/login/.test(page.url())) {
  log("未ログインです。先に `npm run login` を実行してください。");
  await ctx.close();
  process.exit(1);
}

const dump = await page.evaluate(() => {
  const out = [];
  const sel = "input,textarea,select,button,[role=button],[role=radio],[role=checkbox],[role=switch],label,a[href*=upload]";
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
      role: el.getAttribute("role") || "",
      id: el.id || "",
      name: el.getAttribute("name") || "",
      cls: (el.className || "").toString().slice(0, 120),
      placeholder: el.getAttribute("placeholder") || "",
      aria: el.getAttribute("aria-label") || "",
      forAttr: el.getAttribute("for") || "",
      text: (el.innerText || el.value || "").trim().slice(0, 60).replace(/\s+/g, " "),
      visible: r.width > 0 && r.height > 0,
    });
  }
  return { url: location.href, title: document.title, elements: out };
});

const lines = [
  `URL: ${dump.url}`,
  `TITLE: ${dump.title}`,
  `ELEMENTS: ${dump.elements.length}`,
  "",
  ...dump.elements.map(
    (e, i) =>
      `#${i} <${e.tag}${e.type ? ` type=${e.type}` : ""}>` +
      `${e.role ? ` role=${e.role}` : ""}${e.id ? ` id=${e.id}` : ""}` +
      `${e.name ? ` name=${e.name}` : ""}${e.forAttr ? ` for=${e.forAttr}` : ""}` +
      `${e.placeholder ? ` ph="${e.placeholder}"` : ""}${e.aria ? ` aria="${e.aria}"` : ""}` +
      `${e.visible ? "" : " [hidden]"}` +
      `${e.text ? ` :: ${e.text}` : ""}` +
      `${e.cls ? `\n      class=${e.cls}` : ""}`
  ),
];

const outPath = path.join(ROOT, "logs/upload-dom.txt");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
await page.screenshot({ path: path.join(ROOT, "logs/upload-page.png"), fullPage: true });

log(`採取完了: ${outPath}`);
await ctx.close();
