/**
 * 作品の進捗をスプレッドシートの「作品管理」タブに書き出す。
 *
 *   node src/sync-sheet.js --show   … 書き込まず内容だけ表示
 *   node src/sync-sheet.js          … シートに反映
 *
 * 元データ:
 *   data/works/<作品名>.json … 登場人物・シーン・BOOTH URL
 *   data/queue.json          … pixivの投稿状況
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson, log, ROOT } from "./lib.js";
import { ensureTab, writeRange, styleHeader, hasCredentials } from "./sheets.js";

const cfg = loadConfig();
const show = process.argv.includes("--show");
const TAB = "作品管理";

if (!hasCredentials()) {
  console.error("サービスアカウントの鍵がありません（config/google-service-account.json）");
  process.exit(1);
}

// ---------- 作品データ ----------
const worksDir = path.join(ROOT, "data/works");
if (!fs.existsSync(worksDir)) {
  console.error("作品データがありません: data/works/");
  process.exit(1);
}
const works = fs
  .readdirSync(worksDir)
  .filter((n) => n.endsWith(".json"))
  .map((n) => readJson(path.join(worksDir, n)))
  .filter(Boolean);

// ---------- pixivの投稿状況 ----------
const queue = readJson(path.join(ROOT, "data/queue.json"), { items: [] });

// タイトルの「（1/9）」を落として作品名に戻す
const baseTitle = (t) => (t ?? "").replace(/（\d+\/\d+）\s*$/, "").trim();

const pixivStats = {};
for (const it of queue.items) {
  const key = it.workTitle ?? baseTitle(it.title);
  if (!pixivStats[key]) pixivStats[key] = { posted: 0, pending: 0, first: null, last: null };
  pixivStats[key][it.status === "posted" ? "posted" : "pending"]++;
  if (it.scheduledAt) {
    const s = pixivStats[key];
    if (!s.first || it.scheduledAt < s.first) s.first = it.scheduledAt;
    if (!s.last || it.scheduledAt > s.last) s.last = it.scheduledAt;
  }
}

// ---------- 行を組み立てる ----------
const HEADER = [
  "作品名", "シーン", "ヒロイン", "主人公",
  "BOOTH URL", "BOOTH公開日", "価格",
  "pixiv予約済", "pixiv残り", "pixiv開始", "pixiv終了",
  "最終更新",
];

const date = (iso) => (iso ? String(iso).slice(0, 10) : "");

const rows = works
  .sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""))
  .map((w) => {
    const p = pixivStats[w.title] ?? { posted: 0, pending: 0, first: "", last: "" };
    return [
      w.title ?? "",
      w.scene ?? "",
      w.heroine ?? "",
      w.hero ?? "",
      w.boothUrl ?? "",
      date(w.publishedAt),
      w.boothUrl ? cfg.booth.price : "",
      p.posted,
      p.pending,
      p.first ?? "",
      p.last ?? "",
      date(w.updatedAt),
    ];
  });

console.log(`\n${TAB} に書き出す内容（${rows.length}作品）\n`);
console.log(HEADER.join(" | "));
console.log("-".repeat(100));
rows.forEach((r) => console.log(r.map((v) => String(v)).join(" | ")));

// pixiv側にあるがworksに無いものを警告（作品データの作り忘れ）
const known = new Set(works.map((w) => w.title));
const orphan = Object.keys(pixivStats).filter((k) => k && !known.has(k));
if (orphan.length) {
  console.log(`\n! キューにあるが作品データが無い: ${orphan.join(", ")}`);
  console.log("  （story.js を実行すると data/works/ に作られます）");
}

if (show) {
  log("\n--show のため書き込んでいません。");
  process.exit(0);
}

// ---------- 書き込み ----------
const gid = await ensureTab(cfg.sheet.id, TAB);
const range = `${TAB}!A1:${String.fromCharCode(64 + HEADER.length)}${rows.length + 1}`;
await writeRange(cfg.sheet.id, range, [HEADER, ...rows]);
await styleHeader(cfg.sheet.id, gid, HEADER.length).catch(() => log("! 見出しの書式設定はスキップしました"));

log(`\n書き込み完了: ${TAB}（${rows.length}作品）`);
log(`https://docs.google.com/spreadsheets/d/${cfg.sheet.id}/edit#gid=${gid}`);
