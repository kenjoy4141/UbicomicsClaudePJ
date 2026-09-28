/**
 * キューの未投稿ぶんのタイトルを、いまの言い回し集で付け直す。
 * pixivのタイトルに作品名を入れない方針（2026-09-25）に、古いキューを合わせるため。
 *
 *   node tools/retitle-pending.mjs --dry
 *   node tools/retitle-pending.mjs
 */
import path from "node:path";
import { loadConfig, readJson, writeJson, log, ROOT } from "../src/lib.js";
import { makePixivTitles } from "../src/titles-pixiv.js";

const cfg = loadConfig();
const dry = process.argv.includes("--dry");
const queuePath = path.join(ROOT, "data/queue.json");
const queue = readJson(queuePath, { items: [] });

const used = new Set(queue.items.filter((i) => i.status === "posted").map((i) => i.title));
const pending = queue.items.filter((i) => i.status === "pending");
if (!pending.length) { log("未投稿のキューはありません"); process.exit(0); }

const pool = makePixivTitles("", pending.length + 12, cfg.pixiv.titleVariants ?? [])
  .filter((t) => !used.has(t));

pending.forEach((it, i) => {
  const before = it.title;
  if (!pool[i]) return;
  it.title = pool[i];
  console.log(`  ${it.scheduledAt ?? "(予約なし)"}  ${before}\n    → ${it.title}`);
});

if (dry) { log("--dry のため保存しません"); process.exit(0); }
writeJson(queuePath, queue);
log(`${pending.length}件のタイトルを付け直しました`);
