/** Patreonの「投稿を作成」の先を調べる（調査用・何も投稿しない。下書きも保存しない） */
import path from "node:path";
import { loadConfig, openBrowser, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const { ctx, page } = await openBrowser(cfg, { headless: false });
const dump = async (label) => {
  const info = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return [...document.querySelectorAll("a[href],input,textarea,select,button,[contenteditable=true],[role=button],[role=menuitem],[role=radio],[role=checkbox]")].filter(vis)
      .map((el) => `<${el.tagName.toLowerCase()}${el.type ? ` type=${el.type}` : ""}${el.name ? ` name=${el.name}` : ""}` +
        `${el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : ""}` +
        `${el.getAttribute("data-tag") ? ` data-tag=${el.getAttribute("data-tag")}` : ""}` +
        `${el.getAttribute("aria-label") ? ` aria="${el.getAttribute("aria-label")}"` : ""}` +
        `${el.placeholder ? ` ph="${el.placeholder}"` : ""}` +
        `${el.getAttribute("data-placeholder") ? ` dph="${el.getAttribute("data-placeholder")}"` : ""}` +
        `${el.href ? ` href=${el.href}` : ""}> ${(el.innerText || "").trim().slice(0, 50).replace(/\s+/g, " ")}`);
  });
  console.log(`\n=== ${label} | ${page.url()}`);
  info.filter((l) => !/utm_source|explore/.test(l)).slice(0, 90).forEach((l) => console.log("  " + l));
  await page.screenshot({ path: path.join(ROOT, "logs", `probe-patreon-${label}.png`) });
};

await page.goto("https://www.patreon.com/feed", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await page.locator('[data-tag="create-content-button"]:visible').first().click();
await page.waitForTimeout(3000);
await dump("menu");

// メニューに「投稿」系があれば開く
const post = page.locator('[role=menuitem], a, button').filter({ hasText: /^(投稿|テキスト|画像|Post|Text|Image)/ }).first();
if (await post.count()) {
  await post.click();
  await page.waitForTimeout(6000);
  await dump("editor");
}
log("閉じます（何も保存していません）");
await ctx.close();
