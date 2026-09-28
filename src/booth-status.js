/**
 * BOOTHの商品一覧から、公開・非公開の状態を取る（何も変更しない）。
 *
 *   node src/booth-status.js
 */
import { loadConfig, openBrowser, log } from "./lib.js";

const cfg = loadConfig();
const { ctx, page } = await openBrowser(cfg, { headless: true });
await page.goto("https://manage.booth.pm/items", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const items = await page.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href*="/items/"]')) {
    const id = a.getAttribute("href").match(/items\/(\d+)/)?.[1];
    if (!id) continue;
    const box = a.closest("tr, li, article, div[class*='item']");
    const text = (box?.innerText ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push({ id, text: text.slice(0, 120) });
  }
  const seen = new Set();
  return out.filter((x) => !seen.has(x.id) && seen.add(x.id));
});

for (const it of items.slice(0, 15)) {
  const state = /非公開|下書き/.test(it.text) ? "非公開/下書き" : "公開";
  console.log(`${it.id}  ${state}  ${it.text.slice(0, 60)}`);
}
log(`${items.length}件`);
await ctx.close();
