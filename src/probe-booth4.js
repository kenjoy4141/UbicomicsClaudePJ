/** 既存の公開商品から、カテゴリ・代理購入設定・タグを読み取る（読み取りのみ・保存しない） */
import { loadConfig, openBrowser } from "./lib.js";

const cfg = loadConfig();
const id = process.argv[2] ?? "8025565";
const { ctx, page } = await openBrowser(cfg, { headless: false });
await page.goto(`https://manage.booth.pm/items/${id}/edit`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);

const info = await page.evaluate(() => {
  const txt = (sel) => document.querySelector(sel)?.innerText?.trim() ?? null;
  const selects = [...document.querySelectorAll("select")].map((s) => ({
    value: s.value,
    selectedText: s.options[s.selectedIndex]?.text ?? "",
    count: s.options.length,
  }));
  // カテゴリのボタンに現在値が入っている
  const catBtn = [...document.querySelectorAll("button")]
    .map((b) => (b.innerText || "").trim())
    .filter((t) => t && !/段落|埋め込み|保存|削除|戻る|追加|管理|選択してください/.test(t));
  const price = document.querySelector("input[name=price]")?.value;
  const adult = [...document.querySelectorAll("input[name=adult]")].find((r) => r.checked)?.value;
  return { selects, catBtn: catBtn.slice(0, 25), price, adult, title: document.title };
});

console.log("価格:", info.price, "/ 年齢制限:", info.adult);
console.log("\n--- select の現在値 ---");
info.selects.forEach((s, i) => console.log(`#${i} value="${s.value}" text="${s.selectedText}" (${s.count}件)`));
console.log("\n--- ボタンの文言（カテゴリ・タグ含む）---");
console.log(info.catBtn.join(" | "));
await ctx.close();
