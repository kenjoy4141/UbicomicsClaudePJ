/**
 * BOOTH作品用の「タイトル候補」と「サムネ画像候補」を6件ずつ出す。
 * サムネは実際にプレビュー画像を書き出すので、見て選べる。
 *
 *   node src/candidates.js "<画像フォルダ>"
 *   node src/candidates.js "<画像フォルダ>" --n 6 --title-for-preview "お姉さんのワンルームでふたりきり"
 *
 * 出力: logs/candidates/  にプレビューJPGと candidates.json
 *
 * 選んだあとは:
 *   node src/choose.js --title 2 --image 5
 * で記録される。記録が溜まると、次回から傾向を反映した順に並ぶ。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readJson, writeJson, log, ROOT } from "./lib.js";
import { extractFeatures, learnedWeights, scoreWith } from "./features.js";
import { buildTitles } from "./titles.js";

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith("--"));
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const N = Number(opt("n", 6));

if (!dir) {
  console.error('使い方: node src/candidates.js "<画像フォルダ>"');
  process.exit(1);
}

const files = fs
  .readdirSync(dir)
  .filter((n) => /\.(png|jpe?g|webp)$/i.test(n))
  .map((n) => path.join(dir, n));
if (files.length === 0) {
  console.error("画像がありません: " + dir);
  process.exit(1);
}

// ---------- 特徴抽出 ----------
const feats = [];
for (const f of files) {
  const x = extractFeatures(f);
  if (x) feats.push(x);
}
log(`${feats.length}/${files.length}枚からプロンプトを読み取りました`);

// ---------- 学習データ ----------
const choicesPath = path.join(ROOT, "data/choices.json");
const choices = readJson(choicesPath, { items: [] }).items;
const { weights, samples } = learnedWeights(choices);
const strength = samples === 0 ? 0 : Math.min(1, samples / 5); // 5件で最大まで効かせる
log(samples === 0
  ? "学習データなし（初回はヒューリスティックのみで並べます）"
  : `学習データ ${samples}件を反映（影響度 ${(strength * 100).toFixed(0)}%）`);

// ---------- サムネ候補 ----------
const ranked = feats
  .map((f) => ({ ...f, score: scoreWith(f, weights, strength) }))
  .sort((a, b) => b.score - a.score);

// 似た絵ばかりにならないよう、タグが被りすぎるものは飛ばす
const picked = [];
for (const cand of ranked) {
  if (picked.length >= N) break;
  const tooSimilar = picked.some((p) => {
    const inter = cand.tags.filter((t) => p.tags.includes(t)).length;
    const uni = new Set([...cand.tags, ...p.tags]).size;
    return uni > 0 && inter / uni > 0.85;
  });
  if (!tooSimilar) picked.push(cand);
}
while (picked.length < N && ranked.length > picked.length) {
  const next = ranked.find((r) => !picked.includes(r));
  if (!next) break;
  picked.push(next);
}

// ---------- タイトル候補 ----------
const titles = buildTitles(feats, choices).slice(0, N);

// ---------- プレビュー生成 ----------
const outDir = path.join(ROOT, "logs/candidates");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const previewTitle = opt("title-for-preview", titles[0] ?? "タイトル");
picked.forEach((p, i) => {
  const out = path.join(outDir, `image-${i + 1}.jpg`);
  try {
    execFileSync("python", [
      path.join(ROOT, "tools/make-thumbnail.py"),
      "--image", p.file,
      "--title", previewTitle,
      "--out", out,
    ], { stdio: "pipe" });
  } catch (e) {
    log(`  ! プレビュー生成に失敗: ${path.basename(p.file)}`);
  }
});

writeJson(path.join(outDir, "candidates.json"), {
  dir,
  createdAt: new Date().toISOString(),
  previewTitle,
  titles,
  images: picked.map((p, i) => ({ index: i + 1, file: p.file, score: p.score, tags: p.tags })),
});

console.log("\nタイトル候補:");
titles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
console.log("\nサムネ画像候補:");
picked.forEach((p, i) => console.log(`  ${i + 1}. ${path.basename(p.file)} (score ${p.score})`));
console.log(`\nプレビュー: ${outDir}`);
console.log("選んだら: node src/choose.js --title <番号> --image <番号>");
