/** pixivの予約投稿一覧を取得する（読み取りのみ・何も変更しない） */
import { loadConfig, openBrowser, log } from "./lib.js";

const cfg = loadConfig();
const { ctx, page } = await openBrowser(cfg, { headless: false });
await page.goto("https://www.pixiv.net/manage/illusts", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

if (/accounts\.pixiv\.net\/login/.test(page.url())) {
  log("未ログインです。node src/login.js を実行してください。");
  await ctx.close();
  process.exit(2);
}

const items = await page.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href*="illust_reserve_id"]')) {
    const id = a.getAttribute("href").match(/illust_reserve_id=(\d+)/)?.[1];
    if (!id || out.some((o) => o.id === id)) continue;

    // 「公開予定」が現れるまで親をたどると、その予約1件ぶんのカードになる
    let box = a;
    for (let i = 0; i < 8 && box.parentElement; i++) {
      box = box.parentElement;
      if ((box.innerText || "").includes("公開予定")) break;
    }
    const lines = (box.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const when = lines.find((l) => l.includes("公開予定")) ?? "";
    const title = lines.find((l) => !/^\d+$/.test(l) && !/R-18|AI生成|公開予定|^-$/.test(l)) ?? "";
    out.push({ id, title, when });
  }
  return out;
});

items.sort((a, b) => a.when.localeCompare(b.when));
console.log(`pixivの予約投稿: ${items.length}件\n`);
items.forEach((i, n) => console.log(`  ${String(n + 1).padStart(2)}. ${i.when.padEnd(26)} ${i.title}`));
await ctx.close();
