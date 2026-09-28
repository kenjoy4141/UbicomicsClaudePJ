/** 予約投稿ドロップダウンの選択肢の構造を調べる（調査用・何も投稿しない） */
import { loadConfig, openBrowser } from "./lib.js";

const cfg = loadConfig();
const { ctx, page } = await openBrowser(cfg, { headless: false });
await page.goto(cfg.pixiv.createUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByText("投稿日時を指定", { exact: true }).click();
await page.waitForTimeout(1200);

const dds = page.locator('input[name="reserve"]').locator("xpath=../..").locator('div[tabindex="0"]');
await dds.nth(1).click(); // 時刻
await page.waitForTimeout(1200);

const info = await page.evaluate(() => {
  // "00:30" を含む最小の共通祖先＝リストボックス を探す
  const hit = [...document.querySelectorAll("*")].filter(
    (e) => e.children.length === 0 && e.textContent.trim() === "00:30"
  );
  if (hit.length === 0) return { err: "00:30 が見つからない" };
  let box = hit[0];
  for (let i = 0; i < 4 && box.parentElement; i++) box = box.parentElement;
  const optEl = hit[0];
  return {
    optionTag: optEl.tagName.toLowerCase(),
    optionRole: optEl.getAttribute("role"),
    optionClass: (optEl.className || "").toString(),
    parentChain: (() => {
      const c = [];
      let p = optEl;
      for (let i = 0; i < 4 && p.parentElement; i++) {
        p = p.parentElement;
        c.push(`${p.tagName.toLowerCase()}[role=${p.getAttribute("role")}].${(p.className||"").toString().split(" ")[0]}`);
      }
      return c;
    })(),
    sample: box.outerHTML.replace(/></g, ">\n<").slice(0, 800),
    countOf2200: [...document.querySelectorAll("*")].filter(
      (e) => e.children.length === 0 && e.textContent.trim() === "22:00"
    ).length,
  };
});
console.log(JSON.stringify(info, null, 2));
await ctx.close();
