/**
 * まだpixivに上がっていない（pending の）投稿のタイトルを付け直す。
 * 投稿済み(posted)のタイトルは変えない（pixiv側と食い違うため）。
 *
 *   node src/retitle-pending.js --show   … 変更内容だけ表示
 *   node src/retitle-pending.js          … 保存
 */
import path from "node:path";
import { loadConfig, readJson, writeJson, log, ROOT } from "./lib.js";
import { makePixivTitles } from "./titles-pixiv.js";

const cfg = loadConfig();
const show = process.argv.includes("--show");
const queuePath = path.join(ROOT, "data/queue.json");
const queue = readJson(queuePath, { items: [] });

const baseTitle = (t) => (t ?? "").replace(/（\d+\/\d+）\s*$/, "").trim();

// 古いキューには workTitle が無いので補う
for (const it of queue.items) if (!it.workTitle) it.workTitle = baseTitle(it.title);

const groups = new Map();
for (const it of queue.items) {
  if (!groups.has(it.workTitle)) groups.set(it.workTitle, []);
  groups.get(it.workTitle).push(it);
}

const variants = cfg.pixiv.titleVariants ?? ["{{title}}"];
const changes = [];

for (const [work, items] of groups) {
  const pending = items.filter((i) => i.status === "pending");
  if (pending.length === 0) continue;

  // 同じ作品で既に使ったタイトルとは被らないようにする
  const used = new Set(items.filter((i) => i.status === "posted").map((i) => i.title));
  const fresh = makePixivTitles(work, pending.length + used.size + 4, variants).filter((t) => !used.has(t));
  const pool = fresh.length >= pending.length ? fresh : makePixivTitles(work, pending.length, variants);

  pending
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""))
    .forEach((it, k) => {
      const next = pool[k];
      if (next && next !== it.title) changes.push({ it, from: it.title, to: next });
    });
}

if (changes.length === 0) {
  log("変更はありません。");
  process.exit(0);
}

console.log(`\n${changes.length}件のタイトルを付け直します\n`);
for (const c of changes) console.log(`  ${c.it.scheduledAt ?? "(予約なし)"}  ${c.from}\n                    → ${c.to}`);

if (show) {
  log("\n--show のため保存していません。");
  process.exit(0);
}
for (const c of changes) c.it.title = c.to;
writeJson(queuePath, queue);
log(`\n保存しました（${changes.length}件）`);
