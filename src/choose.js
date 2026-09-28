/**
 * candidates.js が出した候補から選んだものを記録する。
 * 記録が溜まると、次回以降の候補の並び順に反映される。
 *
 *   node src/choose.js --title 2 --image 5
 *   node src/choose.js --title "自分で考えたタイトル" --image 3
 *   node src/choose.js --title 3 --title-text "手直しした文" --image 3
 *        … 候補3番の「型」は学習しつつ、文言だけ差し替える。
 *          直した語（例 ワンルーム→お部屋）は次回から自動で反映される。
 *   node src/choose.js --stats     … これまでの傾向を見る
 */
import path from "node:path";
import { readJson, writeJson, log, ROOT } from "./lib.js";
import { extractFeatures } from "./features.js";
import { buildTitles } from "./titles.js";
import { diffSubstitution, recordSubstitution } from "./wordprefs.js";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const choicesPath = path.join(ROOT, "data/choices.json");
const store = readJson(choicesPath, { items: [] });

// ---------- 傾向の確認 ----------
if (flag("stats")) {
  if (store.items.length === 0) {
    console.log("まだ記録がありません。");
    process.exit(0);
  }
  console.log(`記録 ${store.items.length}件\n`);
  const tpl = {}, tags = {};
  for (const c of store.items) {
    if (c.titleTemplate) tpl[c.titleTemplate] = (tpl[c.titleTemplate] ?? 0) + 1;
    for (const t of c.imageTags ?? []) tags[t] = (tags[t] ?? 0) + 1;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log("よく選ぶタイトルの型:");
  top(tpl, 5).forEach(([k, n]) => console.log(`  ${n}回  ${k}`));
  console.log("\nよく選ぶサムネの特徴:");
  top(tags, 12).forEach(([k, n]) => console.log(`  ${n}回  ${k}`));
  console.log("\n作品ごとの記録:");
  store.items.forEach((c) => console.log(`  ${c.recordedAt?.slice(0, 10)}  ${c.title}`));
  process.exit(0);
}

// ---------- 選択の記録 ----------
const candPath = path.join(ROOT, "logs/candidates/candidates.json");
const cand = readJson(candPath);
if (!cand) {
  console.error("候補ファイルがありません。先に node src/candidates.js を実行してください。");
  process.exit(1);
}

const titleArg = opt("title");
const imageArg = opt("image");
if (!titleArg || !imageArg) {
  console.error("使い方: node src/choose.js --title <番号 or 文字列> --image <番号>");
  process.exit(1);
}

// タイトル: 番号なら候補から、文字列ならそのまま
let title, titleTemplate = null;
const titles = buildTitles(
  (cand.images ?? []).map((i) => ({ tags: i.tags, prompt: "" })),
  store.items
);
if (/^\d+$/.test(titleArg)) {
  const idx = Number(titleArg) - 1;
  title = cand.titles[idx];
  if (!title) {
    console.error(`タイトル候補 ${titleArg} 番がありません（1〜${cand.titles.length}）`);
    process.exit(1);
  }
  titleTemplate = titles.meta?.find((m) => m.text === title)?.template ?? null;
} else {
  title = titleArg;
}

// --title-text: 候補の型は残したまま文言だけ直す
const titleText = opt("title-text");
let learnedSub = null;
if (titleText && titleText !== title) {
  learnedSub = recordSubstitution(diffSubstitution(title, titleText));
  title = titleText;
}

const img = cand.images.find((i) => i.index === Number(imageArg));
if (!img) {
  console.error(`画像候補 ${imageArg} 番がありません（1〜${cand.images.length}）`);
  process.exit(1);
}

store.items.push({
  recordedAt: new Date().toISOString(),
  dir: cand.dir,
  title,
  titleTemplate,
  titleWasCustom: !/^\d+$/.test(titleArg),
  offeredTitles: cand.titles,
  image: img.file,
  imageTags: img.tags,
  imageScore: img.score,
  offeredImages: cand.images.map((i) => i.file),
});
writeJson(choicesPath, store);

log(`記録しました（通算 ${store.items.length}件）`);
if (learnedSub) {
  console.log(`  言い回しを学習: 「${learnedSub.from}」→「${learnedSub.to}」（通算${learnedSub.count}回）`);
}
console.log(`  タイトル: ${title}`);
console.log(`  サムネ  : ${path.basename(img.file)}`);
console.log("\n次:");
console.log(`  python tools\\make-thumbnail.py --image "${img.file}" --title "${title}" --out "logs\\thumbnail.jpg"`);
console.log(`  python tools\\make-booth-pdf.py --input "${cand.dir}" --title "${title}"`);
