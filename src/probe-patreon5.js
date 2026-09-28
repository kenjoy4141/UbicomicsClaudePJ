/** 「この投稿を販売する」を入れたときに出る項目を調べる（調査用・掲載しない） */
import path from "node:path";
import { loadConfig, openBrowser, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const { ctx, page } = await openBrowser(cfg, { headless: false });
await page.goto(process.argv[2], { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

const toggle = page.locator('input[aria-label="1回限りの支払いに切り替える"]');
log(`トグルの状態: ${await toggle.isChecked().catch(() => "不明")}`);
if (!(await toggle.isChecked().catch(() => false))) await toggle.click({ force: true });
await page.waitForTimeout(3000);

const lines = await page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return [...document.querySelectorAll("input,button,select,[role=combobox],[role=spinbutton],label,p,span,h3")]
    .filter((el) => vis(el) && el.getBoundingClientRect().left > 1000)
    .map((el) => `<${el.tagName.toLowerCase()}${el.type ? ` type=${el.type}` : ""}${el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : ""}` +
      `${el.getAttribute("aria-label") ? ` aria="${el.getAttribute("aria-label")}"` : ""}${el.name ? ` name=${el.name}` : ""}` +
      `${el.placeholder ? ` ph="${el.placeholder}"` : ""}${el.value ? ` value="${el.value}"` : ""}> ${(el.innerText || "").trim().slice(0, 50).replace(/\s+/g, " ")}`);
});
console.log("=== sell");
[...new Set(lines)].slice(0, 60).forEach((l) => console.log("  " + l));
await page.screenshot({ path: path.join(ROOT, "logs", "probe-patreon-sell.png") });
log("閉じます（掲載はしていません）");
await ctx.close();
