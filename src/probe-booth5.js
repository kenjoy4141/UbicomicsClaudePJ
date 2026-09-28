/** カテゴリの階層を掘る（読み取りのみ・保存しない） */
import path from "node:path";
import { loadConfig, openBrowser, ROOT } from "./lib.js";

const cfg = loadConfig();
const top = process.argv[2] ?? "イラスト";
const { ctx, page } = await openBrowser(cfg, { headless: false });
await page.goto("https://manage.booth.pm/items/8821192/edit", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.locator("input[type=text]").first().fill("カテゴリ調査用");
await page.waitForTimeout(600);

await page.getByRole("button", { name: /カテゴリ(を選択してください|を変更)/ }).click();
await page.waitForTimeout(3000);

const before = await page.evaluate(() => document.body.innerText);
await page.getByText(top, { exact: true }).first().click();
await page.waitForTimeout(2500);
const after = await page.evaluate(() => document.body.innerText);

console.log(`「${top}」の下:`);
console.log(after.split("\n").filter((l) => l.trim() && !before.includes(l)).slice(0, 40).join(" | "));
await page.screenshot({ path: path.join(ROOT, "logs/booth-category3.png") });
await ctx.close();
