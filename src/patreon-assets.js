/**
 * Patreon用の英語素材を一式作る。
 *
 *   node src/patreon-assets.js --dir "<--patreon で生成したモザイク済みフォルダ>" --scene office
 *   node src/patreon-assets.js --dir "..." --scene office --title 2
 *
 * 出力: logs/patreon/<タイトル>/
 *   thumbnail_en.jpg  … 公開サムネ（着衣のカットのみ）
 *   profile_en.jpg    … プロフィールカード
 *   story_en.txt      … あらすじ
 *   previews/         … 無料投稿用の見本（着衣のカットのみ）
 *   meta.json
 *
 * 関門:
 *   フォルダ内の全画像のプロンプトを safety-lint にかけ、1枚でも引っかかったら中止する。
 *   BOOTH/pixiv 用に生成した作品（相手役が未成年を想起させるもの）は、ここで止まる。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readJson, writeJson, listImages, render, log, ROOT } from "./lib.js";
import { readPngPrompt, findSourceImage } from "./describe.js";
import { extractFeatures, baseScore, passesClothingLevel, isSolo } from "./features.js";
import { lintPrompt } from "./safety-lint.js";

const EN = readJson(path.join(ROOT, "config/patreon-en.json"));
const JA = readJson(path.join(ROOT, "config/names.json"));
const STORY = readJson(path.join(ROOT, "config/story.json"));
const cfg = readJson(path.join(ROOT, "config/config.json"));

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const dir = opt("dir");
const sceneKey = opt("scene");
if (!dir || !fs.existsSync(dir) || !sceneKey) {
  console.error('使い方: node src/patreon-assets.js --dir "<フォルダ>" --scene <シーン>');
  process.exit(1);
}
if (!cfg.patreon.allowedScenes.includes(sceneKey) || !EN.scenes[sceneKey]) {
  console.error(`Patreon用では「${sceneKey}」は使えません。使えるシーン: ${cfg.patreon.allowedScenes.join(", ")}`);
  process.exit(1);
}
const scene = EN.scenes[sceneKey];

// ---------- 関門: 全画像のプロンプトを検査 ----------
const files = listImages(dir);
if (files.length === 0) {
  console.error("画像がありません: " + dir);
  process.exit(1);
}
let noPrompt = 0;
const bad = [];
for (const f of files) {
  const src = findSourceImage(f);
  const prompt = src ? readPngPrompt(src) : null;
  if (!prompt) { noPrompt++; continue; }
  const r = lintPrompt(prompt);
  if (!r.ok) bad.push({ file: path.basename(f), blocked: r.blocked, missingAdult: r.missingAdult });
}
if (noPrompt === files.length) {
  console.error("どの画像からもプロンプトを読めません。モザイク前の元画像が同名で残っているか確認してください。");
  process.exit(1);
}
if (bad.length) {
  console.error(`\n中止: ${bad.length}/${files.length}枚が Patreon の基準を満たしません。`);
  console.error("このフォルダは Patreon 用に生成された作品ではない可能性があります（--patreon で生成したものだけが対象です）。");
  bad.slice(0, 8).forEach((b) =>
    console.error(`  ${b.file}: ${[b.blocked.join(","), b.missingAdult ? "大人の明示なし" : ""].filter(Boolean).join(" / ")}`)
  );
  process.exit(2);
}
log(`関門通過: ${files.length - noPrompt}枚すべて基準を満たしています`);

// ---------- 登場人物 ----------
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const romanize = (ja) => EN.readings[ja] ?? ja;

const sei = opt("sei") ?? pick(JA.sei);
const mei = opt("mei") ?? pick(JA.mei);
const heroJa = opt("hero") ?? pick(STORY.heroNames);
const heroineEn = `${romanize(mei)} ${romanize(sei)}`; // 英語は 名 姓 の順
const givenEn = romanize(mei);
const heroEn = romanize(heroJa);

// ---------- タイトル ----------
const titleIdx = Math.max(1, Math.min(scene.titles.length, Number(opt("title", 1)))) - 1;
const title = scene.titles[titleIdx];
const slug = title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
const outDir = path.join(ROOT, "logs/patreon", slug);
fs.mkdirSync(path.join(outDir, "previews"), { recursive: true });

// ---------- あらすじ ----------
let seen = 0;
const body = scene.body.replace(/\{\{heroine\}\}/g, () => (++seen === 1 ? "{{heroine}}" : "{{given}}"));
const vars = { heroine: heroineEn, given: givenEn, hero: heroEn };
const story = [render(scene.catch, vars), "", render(body, vars)].join("\n");
fs.writeFileSync(path.join(outDir, "story_en.txt"), story, "utf8");

// ---------- 画像選び（公開プレビューは着衣のみ）----------
const feats = files.map(extractFeatures).filter(Boolean);
const clothed = feats.filter((f) => passesClothingLevel(f, "strict") && isSolo(f));
if (clothed.length === 0) {
  console.error("着衣の単体カットが1枚もありません。シートにポートレート行があるか確認してください。");
  process.exit(1);
}
const ranked = clothed.map((f) => ({ ...f, score: baseScore(f) })).sort((a, b) => b.score - a.score);
const outfitOf = (f) => f.tags.filter((t) => t.startsWith("outfit:")).sort().join(",");

const main = ranked[0];
const sub = ranked.slice(1).find((f) => outfitOf(f) !== outfitOf(main)) ?? ranked[1] ?? null;

// ---------- サムネ ----------
execFileSync("python", [
  path.join(ROOT, "tools/make-thumbnail-en.py"),
  "--image", main.file, "--title", title, "--out", path.join(outDir, "thumbnail_en.jpg"),
], { stdio: "pipe" });

// ---------- プロフィール ----------
const P = EN.profile;
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const height = rand(155, 168);
const profileArgs = [
  path.join(ROOT, "tools/make-profile.py"),
  "--lang", "en",
  "--labels", JSON.stringify(P.labels),
  "--image", main.file,
  "--name", heroineEn,
  "--height", String(height),
  "--weight", String(height - 110 + rand(-3, 3)),
  "--bwh", `B${rand(83, 96)} / W${rand(54, 60)} / H${rand(82, 90)}`,
  "--birthday", `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][rand(0, 11)]} ${rand(1, 28)}`,
  "--blood", pick(["A", "B", "O", "AB"]),
  "--hobby", pick(P.hobbies),
  "--food", pick(P.foods),
  "--type", pick(P.types),
  "--personality", pick(P.personalities),
  "--hook", pick(P.hooks),
  "--out", path.join(outDir, "profile_en.jpg"),
];
if (sub) profileArgs.push("--image2", sub.file);
execFileSync("python", profileArgs, { stdio: "pipe" });

// ---------- 無料投稿用の見本 ----------
const previewCount = Math.min(Number(opt("previews", 4)), ranked.length);
const previews = ranked.slice(0, previewCount);
previews.forEach((f, i) => {
  fs.copyFileSync(f.file, path.join(outDir, "previews", `preview_${i + 1}${path.extname(f.file)}`));
});

// ---------- メタ ----------
const meta = {
  title, titleCandidates: scene.titles, scene: sceneKey,
  heroine: heroineEn, heroineJa: `${sei} ${mei}`, hero: heroEn,
  sourceDir: dir, pages: files.length,
  thumbnail: main.file, profileImages: [main.file, sub?.file].filter(Boolean),
  previews: previews.map((p) => p.file),
  createdAt: new Date().toISOString(),
};
writeJson(path.join(outDir, "meta.json"), meta);

console.log(`\nTitle    : ${title}`);
console.log(`Heroine  : ${heroineEn}  (${sei} ${mei})`);
console.log(`Hero     : ${heroEn}`);
console.log(`着衣の単体カット: ${clothed.length}枚 → サムネ1 / プロフィール${sub ? 2 : 1} / 見本${previews.length}`);
console.log(`\n${"-".repeat(50)}\n${story}\n${"-".repeat(50)}`);
log(`出力: ${outDir}`);
