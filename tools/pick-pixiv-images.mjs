/**
 * 作品の本編から、pixivに出す45枚を選んで <作品>/pixiv/ に置く。
 *
 *   node tools/pick-pixiv-images.mjs "018_30日後にS○Xする巫女さん"
 *   node tools/pick-pixiv-images.mjs "018_..." --count 45 --from 61
 *
 * 導入（セリフ入り）は小出しに向かないので既定では飛ばし、
 * 本編から等間隔で拾う。すでに pixiv/ に画像があれば何もしない。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson, writeJson, log, ROOT } from "../src/lib.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const dirName = argv.find((a) => !a.startsWith("--"));
if (!dirName) {
  console.error('使い方: node tools/pick-pixiv-images.mjs "018_作品名" [--count 45] [--from 61]');
  process.exit(1);
}
const workDir = path.join(cfg.worksRoot, dirName);
const pagesDir = path.join(workDir, "01_本編");
if (!fs.existsSync(pagesDir)) {
  console.error(`本編フォルダがありません: ${pagesDir}`);
  process.exit(1);
}

const title = dirName.replace(/^\d{3}_([A-Z]_)?/, "");
const work = readJson(path.join("data/works", `${title}.json`)) ?? {};
const intro = Number(work?.fanza?.introImages ?? 60);
const from = Number(opt("from", intro + 1));           // 導入の次から
// 1投稿の枚数 × 投稿数。1投稿5枚→15枚に増やしたので、拾う枚数も増やす
const perPost = Math.max(1, cfg.pixiv?.imagesPerPost ?? 15);
const posts = Number(opt("posts", 6));
const count = Number(opt("count", perPost * posts));

const all = fs.readdirSync(pagesDir).filter((f) => /\.jpe?g$/i.test(f)).sort();

// 吹き出しのCSVに載っているページ（セリフ入り）は絶対に使わない。
// 導入の枚数だけで判定すると、番号がずれたときに混ざる
const csv = work?.fanza?.dialogueCsv;
const withLines = new Set();
if (csv && fs.existsSync(csv)) {
  for (const line of fs.readFileSync(csv, "utf8").split(new RegExp(String.fromCharCode(92) + "r?" + String.fromCharCode(92) + "n")).slice(1)) {
    const name = line.split(",")[0].replace(/^\uFEFF/, "").trim();
    if (name) withLines.add(name);
  }
}
const body = all.slice(from - 1).filter((f) => !withLines.has(f));
if (withLines.size) log(`セリフ入り ${withLines.size}ページを除外しました`);
if (body.length < count) {
  console.error(`! 本編が ${body.length}枚しかありません（必要 ${count}枚）`);
  process.exit(1);
}

const out = path.join(workDir, "pixiv");
fs.mkdirSync(out, { recursive: true });
const already = fs.readdirSync(out).filter((f) => /\.jpe?g$/i.test(f));
if (already.length) {
  log(`すでに ${already.length}枚あります。何もしません（入れ替えるなら中身を消してから）`);
  process.exit(0);
}

for (let i = 0; i < count; i++) {
  const f = body[Math.floor((i / count) * body.length)];
  fs.copyFileSync(path.join(pagesDir, f), path.join(out, f));
}
log(`${count}枚 → ${out}（${from}ページ目以降から等間隔）`);

// 作品ごとのタグを meta.json に入れる。
// 固定タグだけだと検索流入を取りこぼすので、職業・場所・ジャンルを足す
const metaPath = path.join(workDir, "meta.json");
const meta = readJson(metaPath) ?? { workId: dirName.slice(0, 3), title, boothUrl: "", tags: [], captions: [] };
const variants = path.join(ROOT, "config/variants");
const V = fs.existsSync(variants)
  ? fs.readdirSync(variants).map((f) => readJson(path.join(variants, f)))
      .find((v) => v?.title === title)
  : null;
// variant が見つからない旧作（タイトルを変えた作品など）は、作品データの職業から作る
const fallback = V ? null : [work?.profile?.job, "巨乳", "お姉さん", "中出し"].filter(Boolean);
if (fallback) {
  meta.tags = [...new Set([...fallback, ...(meta.tags ?? [])])].slice(0, 7);
  if (!meta.boothUrl) meta.boothUrl = work?.boothUrl ?? "";
  writeJson(metaPath, meta);
  log(`タグ（作品データから）: ${meta.tags.join(", ")}`);
}
if (V) {
  // FANZAのジャンル名は pixiv だと使われない言い回しがあるので直す
  const FIX = { "人妻・主婦": "人妻", "オフィス・職場": "OL", "オリジナル": "オリジナル" };
  const fromWork = [V.job, V.words?.place, ...(V.fanzaKeywords ?? [])]
    .filter(Boolean)
    .map((t) => FIX[t] ?? t)
    .filter((t) => !/^(オリジナル|イチャラブ)$/.test(t));
  meta.tags = [...new Set([...fromWork, ...(meta.tags ?? [])])].slice(0, 7);
  if (!meta.boothUrl) meta.boothUrl = work?.boothUrl ?? "";
  writeJson(metaPath, meta);
  log(`タグ: ${meta.tags.join(", ")}`);
}
