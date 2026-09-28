/** 作品ファイルモーダルを確実に開いて中身を見る（読み取りのみ・保存しない） */
import path from "node:path";
import { loadConfig, openBrowser, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const { ctx, page } = await openBrowser(cfg, { headless: false });
await page.goto("https://manage.booth.pm/items/8821192/edit", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

const btn = page.getByRole("button", { name: "ファイルの追加・管理" });
await btn.scrollIntoViewIfNeeded();
await page.waitForTimeout(1000);

for (let attempt = 1; attempt <= 3; attempt++) {
  await btn.click();
  log(`クリック ${attempt}回目`);
  try {
    await page.getByText("ファイルをドラッグ").first().waitFor({ timeout: 8000 });
    log("モーダルが開きました");
    break;
  } catch {
    log("  開かず。再試行");
    await page.waitForTimeout(1500);
  }
}

const info = await page.evaluate(() => {
  const zone = [...document.querySelectorAll("*")].find(
    (e) => (e.innerText || "").trim().startsWith("ファイルをドラッグ") && e.children.length <= 2
  );
  if (!zone) return { err: "ドロップゾーンなし" };
  // ゾーンの祖先をたどって input[type=file] を探す
  let scope = zone;
  for (let i = 0; i < 6 && scope.parentElement; i++) scope = scope.parentElement;
  return {
    zoneTag: zone.tagName.toLowerCase(),
    zoneHtml: zone.outerHTML.slice(0, 300),
    parentHtml: scope.outerHTML.slice(0, 1200),
    fileInputs: document.querySelectorAll("input[type=file]").length,
  };
});
console.log(JSON.stringify(info, null, 1).slice(0, 2200));
await page.screenshot({ path: path.join(ROOT, "logs/booth-filemodal.png") });
await ctx.close();
