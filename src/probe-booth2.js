/** 既にできている下書き商品の編集ページで、ファイル入力とカテゴリを調べる（読み取りのみ・保存しない） */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, openBrowser, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const itemId = process.argv[2] ?? "8821192";
const { ctx, page } = await openBrowser(cfg, { headless: false });

await page.goto(`https://manage.booth.pm/items/${itemId}/edit`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);

const info = await page.evaluate(() => {
  const files = [...document.querySelectorAll("input[type=file]")].map((el) => ({
    name: el.name || "", id: el.id || "", accept: el.accept || "",
    multiple: el.multiple,
    near: (el.closest("div,section,form")?.innerText || "").trim().slice(0, 60).replace(/\s+/g, " "),
  }));
  const selects = [...document.querySelectorAll("select")].map((el) => ({
    name: el.name || "", id: el.id || "",
    options: [...el.options].map((o) => `${o.value}:${o.text}`),
  }));
  return { files, selects, url: location.href };
});

console.log("URL:", info.url);
console.log("\n--- input[type=file] ---");
info.files.forEach((f, i) => console.log(`#${i} name=${f.name} id=${f.id} accept="${f.accept}" multiple=${f.multiple}\n     近くの文言: ${f.near}`));
console.log("\n--- select ---");
info.selects.forEach((s, i) => {
  console.log(`#${i} name=${s.name} id=${s.id} (${s.options.length}件)`);
  console.log("     " + s.options.slice(0, 30).join(" | "));
});

fs.writeFileSync(path.join(ROOT, "logs/booth-form.json"), JSON.stringify(info, null, 1), "utf8");
await ctx.close();
