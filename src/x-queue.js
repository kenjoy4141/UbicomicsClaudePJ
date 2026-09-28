/**
 * X（@ubicomics1）の投稿予定を作る。画像は公開して問題ないページだけを使う。
 *
 *   node src/x-queue.js --work "30日後にS○Xする女医さん" --weeks 2
 *   node src/x-queue.js --work "..." --weeks 2 --start 2026-09-17
 *
 * 週4本: 見本2回 / セリフ付きページ1回 / 作品紹介1回。すべて Patreon の無料投稿へ誘導する。
 * 出力: data/x-queue.json（1件ずつ {text, images, scheduledAt, posted:false}）
 *
 * 画像は patreon-fanza-assets.js が選んだ safePages（着衣・単体・透けなし・相手役なし）から取る。
 */
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson, log, ROOT } from "./lib.js";
import { loadWork } from "./work.js";

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const title = opt("work");
const weeks = Number(opt("weeks", 2));
const work = title ? loadWork(title) : null;
const P = work?.patreon;
if (!P?.safePages?.length || !P.enDir) {
  console.error('使い方: node src/x-queue.js --work "作品名" --weeks 2  （先に patreon-fanza-assets.js）');
  process.exit(1);
}

// 無料投稿の公開URL（下書きの編集URLから投稿IDだけ取る）
const freeUrl = P.freeUrl ?? (P.freeDraft?.match(/(\d+)\/edit/) ? `https://www.patreon.com/posts/${P.freeDraft.match(/(\d+)\/edit/)[1]}` : null);
if (!freeUrl) {
  console.error("Patreonの無料投稿URLが分かりません。作品データの patreon.freeUrl に入れてください");
  process.exit(1);
}

const pagesDir = path.join(P.enDir, "pages");
const heroine = work.heroineEn.split(" ")[0];
const titleEn = P.titleEn;
const TAGS = "#anime #animeart #originalcharacter #AIart #ecchi";

// 本文のひな形。最後は必ず無料投稿への誘導にする
const TEMPLATES = {
  teaser: [
    `Day by day, ${heroine} gets a little closer.\n"${titleEn}" — free preview on Patreon.\n${freeUrl}\n${TAGS}`,
    `${heroine} keeps saving the last slot of the day for him.\n"${titleEn}"\nFree preview: ${freeUrl}\n${TAGS}`,
    `She says it's just work. Her face says otherwise.\n"${titleEn}"\nFree preview: ${freeUrl}\n${TAGS}`,
  ],
  dialogue: [
    `Every page is dated. 30 days, one step at a time.\n"${titleEn}"\nFree preview: ${freeUrl}\n${TAGS}`,
    `The dialogue changes as the days go by.\n"${titleEn}"\nFree preview: ${freeUrl}\n${TAGS}`,
  ],
  announce: [
    `NEW: "${titleEn}"\n500 pages with dated dialogue, from the first visit to day 30.\nFree preview: ${freeUrl}\n${TAGS}`,
    `"${titleEn}" is out.\n500 pages. All characters are adults. AI-generated illustrations.\nFree preview: ${freeUrl}\n${TAGS}`,
  ],
};

// 月・水・金・日の 21:00（日本時間）
const SLOTS = [
  { day: 1, type: "teaser" },
  { day: 3, type: "dialogue" },
  { day: 5, type: "teaser" },
  { day: 0, type: "announce" },
];
const HOUR = Number(opt("hour", 21));

const start = opt("start") ? new Date(`${opt("start")}T00:00:00+09:00`) : new Date();
const pool = [...P.safePages];
const pick = (n) => {
  const out = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out.map((p) => path.join(pagesDir, `${String(p).padStart(3, "0")}.jpg`));
};

const queueFile = path.join(ROOT, "data/x-queue.json");
const queue = readJson(queueFile, []) ?? [];
const used = { teaser: 0, dialogue: 0, announce: 0 };
let added = 0;

for (let w = 0; w < weeks; w++) {
  for (const slot of SLOTS) {
    const d = new Date(start);
    d.setDate(d.getDate() + w * 7 + ((slot.day - start.getDay() + 7) % 7));
    d.setHours(HOUR, 0, 0, 0);
    if (d <= new Date()) continue;
    const images = pick(slot.type === "announce" ? 4 : 2);
    if (!images.length) continue;
    const texts = TEMPLATES[slot.type];
    queue.push({
      id: `${Date.now()}_${added}`,
      work: title,
      type: slot.type,
      text: texts[used[slot.type]++ % texts.length],
      images,
      scheduledAt: d.toISOString(),
      posted: false,
    });
    added++;
  }
}

queue.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
writeJson(queueFile, queue);
log(`${added}件を追加（全${queue.length}件）: ${queueFile}`);
for (const q of queue.filter((x) => !x.posted)) {
  console.log(`\n--- ${new Date(q.scheduledAt).toLocaleString("ja-JP")} [${q.type}] ${q.images.map((i) => path.basename(i)).join(", ")}`);
  console.log(q.text);
}
