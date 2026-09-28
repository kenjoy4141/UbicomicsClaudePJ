/**
 * 参考にしたい作品のページを開いて、構成が分かる情報だけ控える（投稿はしない）。
 *
 *   node tools/peek-pixiv.mjs 139041931 140279451
 *
 * ログイン済みのプロファイル（data/browser-profile）をそのまま使う。
 * 画像は logs/ref/<id>/ に保存する。絵柄やキャラを真似るためではなく、
 * ページ構成・コマ割り・セリフの置き方を見るため。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, openBrowser, log, ROOT } from "../src/lib.js";

const cfg = loadConfig();
const ids = process.argv.slice(2).map((a) => a.match(/(\d{6,})/)?.[1]).filter(Boolean);
if (!ids.length) {
  console.error("使い方: node tools/peek-pixiv.mjs 139041931 140279451");
  process.exit(1);
}

const { ctx, page } = await openBrowser(cfg, { headless: false });
for (const id of ids) {
  const dir = path.join(ROOT, "logs/ref", id);
  fs.mkdirSync(dir, { recursive: true });
  await page.goto(`https://www.pixiv.net/artworks/${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // 年齢確認が出たら「はい」
  const yes = page.locator('button:has-text("はい"), button:has-text("Yes")').first();
  if (await yes.count()) { await yes.click().catch(() => {}); await page.waitForTimeout(3000); }

  const info = await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText.slice(0, 1200),
    imgs: [...document.querySelectorAll("img")].map((i) => i.src)
      .filter((s) => /i\.pximg\.net|img-original|img-master/.test(s)),
  }));
  fs.writeFileSync(path.join(dir, "info.txt"), `${info.title}\n\n${info.text}`, "utf8");
  log(`${id}: ${info.title.slice(0, 50)} / 画像候補 ${info.imgs.length}件`);

  // 「すべて見る」を押すと全ページが並ぶ
  const all = page.locator('button:has-text("すべて見る"), button:has-text("Show all")').first();
  if (await all.count()) { await all.click().catch(() => {}); await page.waitForTimeout(4000); }

  // 画面に出ている作品画像を上から順に撮る（ページ構成が見たいだけなので縮小でよい）
  const figs = page.locator('div[role="presentation"] img, figure img');
  const n = Math.min(await figs.count(), 12);
  for (let i = 0; i < n; i++) {
    const el = figs.nth(i);
    try {
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      await el.screenshot({ path: path.join(dir, `p${String(i + 1).padStart(2, "0")}.png`) });
    } catch { /* 読み込めないものは飛ばす */ }
  }
  log(`  ${n}枚を ${dir} に保存`);
}
await ctx.close();
log("おわり");
