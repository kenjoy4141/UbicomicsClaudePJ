/**
 * pixivの予約投稿一覧を見て、キューの状態を実態に合わせる。
 *
 *   node src/sync-queue.js --show   … 差分を表示するだけ
 *   node src/sync-queue.js          … キューを実態に合わせる
 *
 * 投稿ボタンが押されたかどうかをURLの変化で判定しているため、
 * タブを閉じた・別ページに移動しただけでも posted になってしまうことがある。
 * pixiv側を正として突き合わせ直すのがこのスクリプト。
 */
import path from "node:path";
import { loadConfig, openBrowser, readJson, writeJson, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const show = process.argv.includes("--show");
const queuePath = path.join(ROOT, "data/queue.json");
const queue = readJson(queuePath, { items: [] });

const { ctx, page } = await openBrowser(cfg, { headless: false });
await page.goto("https://www.pixiv.net/manage/illusts", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

if (/accounts\.pixiv\.net\/login/.test(page.url())) {
  log("未ログインです。node src/login.js を実行してください。");
  await ctx.close();
  process.exit(2);
}

const reserved = await page.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href*="illust_reserve_id"]')) {
    const id = a.getAttribute("href").match(/illust_reserve_id=(\d+)/)?.[1];
    if (!id || out.some((o) => o.id === id)) continue;
    let box = a;
    for (let i = 0; i < 8 && box.parentElement; i++) {
      box = box.parentElement;
      if ((box.innerText || "").includes("公開予定")) break;
    }
    const lines = (box.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const title = lines.find((l) => !/^\d+$/.test(l) && !/R-18|AI生成|公開予定|^-$/.test(l)) ?? "";
    out.push({ id, title });
  }
  return out;
});
await ctx.close();

log(`pixivの予約: ${reserved.length}件`);

// 公開済み（予約時刻を過ぎたもの）はここに出ないので、過去の予約は posted のまま扱う
const now = new Date();
const titles = new Set(reserved.map((r) => r.title));
const changes = [];

for (const it of queue.items) {
  const past = it.scheduledAt && new Date(it.scheduledAt.replace(" ", "T")) < now;
  const onPixiv = titles.has(it.title);
  const should = onPixiv || (it.status === "posted" && past) ? "posted" : "pending";
  if (it.status !== should) changes.push({ it, from: it.status, to: should });
}

if (changes.length === 0) {
  log("キューは実態と一致しています。");
  process.exit(0);
}

console.log("\n--- 差分 ---");
changes.forEach((c) => console.log(`  ${c.from} → ${c.to}  ${c.it.title}`));

if (show) {
  log("\n--show のため変更していません。");
  process.exit(0);
}

for (const c of changes) {
  c.it.status = c.to;
  if (c.to === "pending") delete c.it.postedAt;
}
writeJson(queuePath, queue);
log(`\n${changes.length}件を修正しました。`);

const pending = queue.items.filter((i) => i.status === "pending").length;
log(`pending: ${pending}件 / posted: ${queue.items.length - pending}件`);
