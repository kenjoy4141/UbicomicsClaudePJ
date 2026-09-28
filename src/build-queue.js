/**
 * pixiv 投稿キューを作る。2つのモードがある。
 *
 * 【作品モード】BOOTH作品と連動させる本番用
 *   node src/build-queue.js "016_作品タイトル" --days 3 --random
 *   → 作品フォルダ直下の pixiv/ に入れた画像が母集団。meta.json に boothUrl を書く。
 *
 * 【フォルダモード】任意フォルダから直接。お試し・単発用
 *   node src/build-queue.js --dir "C:/.../2026-07-25moza" --days 3 --random
 *
 * 枚数の決め方（上から優先）:
 *   --days N   … 今後N日ぶんの予約枠を数え、枠数 x imagesPerPost 枚を使う（推奨）
 *   --posts N  … N投稿ぶん = N x imagesPerPost 枚を使う
 *   --count N  … N枚を使う
 *   無指定     … 母集団すべてを使う
 *
 * その他: --random（ランダム抽出）--schedule / --no-schedule --show（確認のみ）
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, listImages, readJson, writeJson, render, log, ROOT } from "./lib.js";
import { buildDescription } from "./describe.js";
import { makePixivTitles } from "./titles-pixiv.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);

const flag = (name) => argv.includes(`--${name}`);
function opt(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}

const showOnly = flag("show");
const dirMode = opt("dir");
const positional = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const per = Math.max(1, cfg.pixiv.imagesPerPost);

let meta, pool, sourceKey, useSchedule;

if (dirMode) {
  // ---------- フォルダモード ----------
  const dir = path.resolve(dirMode);
  if (!fs.existsSync(dir)) {
    console.error(`フォルダが見つかりません: ${dir}`);
    process.exit(1);
  }
  pool = listImages(dir);
  sourceKey = path.basename(dir);
  meta = { workId: sourceKey, title: opt("title", sourceKey), boothUrl: opt("booth", ""), tags: [], caption: "" };
  useSchedule = flag("schedule");
  log(`フォルダモード: ${dir}`);
} else {
  // ---------- 作品モード ----------
  if (!positional) {
    console.error("使い方: node src/build-queue.js \"016_作品タイトル\" --days 3 --random");
    process.exit(1);
  }
  const workDir = path.join(cfg.worksRoot, positional);
  if (!fs.existsSync(workDir)) {
    console.error(`作品フォルダが見つかりません: ${workDir}`);
    process.exit(1);
  }

  const pixivDir = path.join(workDir, "pixiv");
  if (!fs.existsSync(pixivDir)) {
    fs.mkdirSync(pixivDir, { recursive: true });
    log(`pixiv投稿用フォルダを作りました: ${pixivDir}`);
    log("→ ここにBOOTH作品の画像をコピーしてから、もう一度実行してください。");
    process.exit(0);
  }

  pool = listImages(pixivDir);
  const metaPath = path.join(workDir, "meta.json");
  meta = readJson(metaPath);
  if (!meta) {
    meta = {
      workId: positional.split("_")[0],
      title: positional.replace(/^\d+_/, ""),
      boothUrl: "",
      tags: [],
      captions: [],
      _note: "boothUrl と tags を埋めてから、もう一度実行してください。captions[] に煽り文を複数書くと投稿ごとに巡回します。",
    };
    writeJson(metaPath, meta);
    log(`meta.json の雛形を作りました: ${metaPath}`);
    log("→ boothUrl と tags を埋めてから、もう一度実行してください。");
    process.exit(0);
  }
  if (!meta.boothUrl) {
    console.error(`meta.json の boothUrl が空です: ${metaPath}`);
    process.exit(1);
  }
  sourceKey = positional;
  useSchedule = !flag("no-schedule");
}

if (pool.length === 0) {
  console.error("画像がありません");
  process.exit(1);
}

// ---------- 何投稿ぶん作るかを決める ----------
const days = opt("days") ? Number(opt("days")) : null;
const postsOpt = opt("posts") ? Number(opt("posts")) : null;
const countOpt = opt("count") ? Number(opt("count")) : null;

// --days のときは先に枠を数え、その枠数ぶんの投稿を作る
let slots = [];
let wantPosts = null;
if (days) {
  slots = assignSlots(Infinity, days);
  wantPosts = slots.length;
  useSchedule = true;
} else if (postsOpt) {
  wantPosts = postsOpt;
}

let need = wantPosts ? wantPosts * per : countOpt ?? pool.length;
if (need > pool.length) {
  log(`! 必要 ${need}枚 に対し母集団は ${pool.length}枚 しかないので、全部使います`);
  need = pool.length;
}

// ---------- 画像を選ぶ（--random は重複なしのランダム抽出）----------
const images = flag("random") ? shuffle(pool).slice(0, need) : pool.slice(0, need);

const chunks = [];
for (let i = 0; i < images.length; i += per) chunks.push(images.slice(i, i + per));

if (useSchedule && slots.length === 0) slots = assignSlots(chunks.length);

// ---------- 組み立て ----------
const total = chunks.length;
// 連番は付けず、投稿ごとに言い回しを変える（最後まで追われて購買意欲が落ちるのを避ける）
const postTitles = makePixivTitles(meta.title, total, cfg.pixiv.titleVariants ?? ["{{title}}"]);
const items = chunks.map((files, i) => {
  const n = i + 1;
  const title = postTitles[i];
  const tpl = meta.boothUrl ? cfg.pixiv.captionTemplate : cfg.pixiv.captionTemplateNoBooth;
  return {
    id: `${meta.workId}-${String(n).padStart(2, "0")}`,
    workName: sourceKey,
    workTitle: meta.title,
    title,
    caption: pickCaption(i, tpl, files),
    tags: [...new Set([...(meta.tags || []), ...cfg.pixiv.defaultTags])].slice(0, 10),
    files,
    scheduledAt: useSchedule && slots[i] ? toLocalIso(slots[i]) : null,
    status: "pending",
  };
});

// ---------- 出力 ----------
console.log(`\n作品: ${meta.title}`);
if (meta.boothUrl) console.log(`BOOTH: ${meta.boothUrl}`);
console.log(`母集団 ${pool.length}枚 → ${images.length}枚を抽出 → ${total}投稿（1投稿 ${per}枚）\n`);
for (const it of items) {
  console.log(`  ${it.id}  ${it.scheduledAt ?? "(予約なし)"}  ${it.title}  [${it.files.length}枚]`);
}
console.log(`\nタグ: ${items[0]?.tags.join(", ")}`);
console.log(`\nキャプション例(1件目):\n${items[0]?.caption}\n`);

if (showOnly) {
  log("--show 指定のためキューは書き出していません。");
  process.exit(0);
}

const queuePath = path.join(ROOT, "data/queue.json");
const existing = readJson(queuePath, { items: [] });
const kept = existing.items.filter((it) => it.workName !== sourceKey);
writeJson(queuePath, { items: [...kept, ...items] });
log(`キューを書き出しました: ${queuePath}（${items.length}件）`);
log("次: node src/pixiv-draft.js");

// ---------- helpers ----------

/**
 * 投稿ごとのキャプションを組み立てる。上から順に連結される。
 *   1. 画像の説明文 … captionFromImage=true のとき、1枚目のSDプロンプトから自動生成
 *   2. 煽り文       … meta.captions[] > cfg.pixiv.captionPool[] を投稿順に巡回
 *   3. 定型フッター … captionTemplate（BOOTHリンク・AI注記）
 * meta.caption を書いた場合は 1〜3 を無視してそれだけを使う。
 */
function pickCaption(index, tpl, files) {
  const vars = { title: meta.title, boothUrl: meta.boothUrl };
  if (meta.caption) return render(meta.caption, vars);

  const blocks = [];
  if (cfg.pixiv.captionFromImage && files?.length) {
    const d = buildDescription(files[0]);
    if (d) blocks.push(d.text);
    else log(`  ! 説明文を生成できません（元画像のプロンプトなし）: ${path.basename(files[0])}`);
  }
  const captionPool = (meta.captions?.length ? meta.captions : cfg.pixiv.captionPool) || [];
  if (captionPool.length) blocks.push(render(captionPool[index % captionPool.length], vars));
  blocks.push(render(tpl, vars));
  return blocks.join("\n\n");
}

function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** 予約枠を返す。maxDays を渡すとその日数ぶんの枠を全部返す */
function assignSlots(need, maxDays = 60) {
  const out = [];
  const start = new Date();
  if (cfg.schedule.startTomorrow) start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  for (let day = 0; out.length < need && day < maxDays; day++) {
    const d = new Date(start);
    d.setDate(d.getDate() + day);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    for (const t of isWeekend ? cfg.schedule.weekend : cfg.schedule.weekday) {
      if (out.length >= need) break;
      const [h, m] = t.split(":").map(Number);
      const at = new Date(d);
      at.setHours(h, m, 0, 0);
      if (at <= new Date()) continue;
      out.push(at);
    }
  }
  return out;
}

function toLocalIso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
