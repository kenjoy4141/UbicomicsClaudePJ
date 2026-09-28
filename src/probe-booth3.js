/** カテゴリピッカーと画像アップロード領域を調べる（読み取りのみ・保存しない） */
import path from "node:path";
import { loadConfig, openBrowser, ROOT } from "./lib.js";

const cfg = loadConfig();
const { ctx, page } = await openBrowser(cfg, { headless: false });
await page.goto("https://manage.booth.pm/items/8821192/edit", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);

// 画像アップロードらしき領域の文言を拾う
const zones = await page.evaluate(() =>
  [...document.querySelectorAll("div,section,button,label")]
    .filter((el) => /画像|ドラッグ|アップロード|追加/.test(el.innerText || ""))
    .map((el) => (el.innerText || "").trim().slice(0, 60).replace(/\s+/g, " "))
    .filter((t, i, a) => t && a.indexOf(t) === i)
    .slice(0, 15)
);
console.log("--- アップロード関連の文言 ---");
zones.forEach((z) => console.log("  " + z));

// カテゴリピッカーを開く
await page.getByRole("button", { name: /カテゴリを選択してください/ }).click();
await page.waitForTimeout(2500);
const cats = await page.evaluate(() =>
  [...document.querySelectorAll("button,li,div[role=option],a")]
    .map((el) => (el.innerText || "").trim())
    .filter((t) => t && t.length < 20)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 60)
);
console.log("\n--- カテゴリピッカーの選択肢 ---");
console.log(cats.join(" | "));
await page.screenshot({ path: path.join(ROOT, "logs/booth-category.png"), fullPage: true });
await ctx.close();
