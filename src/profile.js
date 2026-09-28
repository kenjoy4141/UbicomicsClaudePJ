/**
 * ヒロインのプロフィールを作ってカード画像を書き出す。
 *
 *   node src/profile.js --dir "<モザイク済みフォルダ>" --out logs/profile.jpg
 *   node src/profile.js --dir "..." --name "高橋 莉奈" --hook "自分で書いた一行"
 *
 * 名前・身長・体重・スリーサイズ・誕生日・血液型・性格は自動生成する。
 * 後半の一文（hook）も候補から自動で選ぶ。固定したい場合は --hook で渡す。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readJson, listImages, log, ROOT } from "./lib.js";
import { extractFeatures, baseScore, passesClothingLevel, countByLevel, isSolo } from "./features.js";
import { loadWork, saveWork } from "./work.js";

const N = readJson(path.join(ROOT, "config/names.json"));
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const dir = opt("dir");
const out = opt("out", path.join(ROOT, "logs/profile.jpg"));
if (!dir || !fs.existsSync(dir)) {
  console.error('使い方: node src/profile.js --dir "<画像フォルダ>" [--out profile.jpg]');
  process.exit(1);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ---------- プロフィール ----------
// --work を渡すと、story.js が決めたヒロイン名をそのまま使う（名前の食い違いを防ぐ）
const workTitle = opt("work");
const work = workTitle ? loadWork(workTitle) : null;
if (workTitle && !work) log(`! 作品データが見つかりません: data/works/${workTitle}.json`);
const name = opt("name") ?? work?.heroine ?? `${pick(N.sei)} ${pick(N.mei)}`;
const height = Number(opt("height", 0)) || rand(155, 168);
// 身長から自然な範囲の体重を出す
const weight = Number(opt("weight", 0)) || Math.round((height - 110) + rand(-3, 3));
const bwh = opt("bwh") ?? `B${rand(83, 96)}・W${rand(54, 60)}・H${rand(82, 90)}`;
const birthday = opt("birthday") ?? `${rand(1, 12)}/${rand(1, 28)}`;
const blood = opt("blood") ?? pick(["A型", "B型", "O型", "AB型"]);
const personality = opt("personality") ?? pick(N.personality);
const hobby = opt("hobby") ?? pick(N.hobbies);
const food = opt("food") ?? pick(N.foods);
const ftype = opt("type") ?? pick(N.types);
const hook = opt("hook") ?? pick(N.hooks);

// ---------- 画像を選ぶ ----------
const files = listImages(dir);
if (files.length === 0) {
  console.error("画像がありません: " + dir);
  process.exit(1);
}
const all = files.map((f) => extractFeatures(f)).filter(Boolean);

// 露出レベルで絞る。strict=きちんと着衣 / modest=全裸と行為を除外 / any=制限なし
// 既定は modest（strict だと該当が数枚しか無く、作品ごとに絵が変わらないため）
const level = opt("clothing", "modest");
const counts = countByLevel(all);
log(`候補: strict ${counts.strict}枚 / modest ${counts.modest}枚 / any ${counts.any}枚（指定: ${level}）`);

let pool = all.filter((f) => passesClothingLevel(f, level));

// プロフィールカードはヒロイン単体を見せるものなので、相手が写る構図は外す
if (!argv.includes("--allow-partner")) {
  const solo = pool.filter(isSolo);
  log(`単体カット ${solo.length}/${pool.length}枚`);
  if (solo.length >= 2) pool = solo;
  else log("! 単体カットが足りないので、この条件は緩めます");
}
if (pool.length === 0) {
  log(`! ${level} に該当するカットがありません。modest で選び直します`);
  pool = all.filter((f) => passesClothingLevel(f, "modest"));
}
if (pool.length === 0) {
  log("! modest でも該当なし。全カットから選びます");
  pool = all;
}

const ranked = pool
  .map((f) => ({ ...f, score: baseScore(f) }))
  .sort((a, b) => b.score - a.score);

const outfitOf = (f) => (f?.tags ?? []).filter((t) => t.startsWith("outfit:")).sort().join(",");

const mainFeat = ranked[0] ?? null;
const main = opt("image") ?? mainFeat?.file ?? files[0];

// 2枚目は1枚目と服装が違うものを優先する（同じ格好が2つ並ぶと情報量が減るため）
let subFeat = null;
if (mainFeat) {
  const mainOutfit = outfitOf(mainFeat);
  subFeat = ranked.slice(1).find((f) => outfitOf(f) !== mainOutfit) ?? null;
  if (!subFeat) {
    log("! 服装の違うカットが見つからないので、次点をそのまま使います");
    subFeat = ranked[1] ?? null;
  } else {
    log(`2枚目は服装違いを選択（1枚目: ${mainOutfit || "不明"} / 2枚目: ${outfitOf(subFeat) || "不明"}）`);
  }
}
const sub = opt("image2") ?? subFeat?.file ?? null;

// ---------- カード生成 ----------
const args = [
  path.join(ROOT, "tools/make-profile.py"),
  "--image", main,
  "--name", name,
  "--height", String(height),
  "--weight", String(weight),
  "--bwh", bwh,
  "--birthday", birthday,
  "--blood", blood,
  "--personality", personality,
  "--hobby", hobby,
  "--food", food,
  "--type", ftype,
  "--out", out,
];
if (sub) args.push("--image2", sub);
if (opt("age")) args.push("--age", opt("age"));
if (opt("job")) args.push("--job", opt("job"));
if (hook) args.push("--hook", hook);

const res = execFileSync("python", args, { encoding: "utf8" });

if (workTitle) {
  saveWork(workTitle, {
    heroine: name,
    profile: { age: opt("age"), job: opt("job"), height, weight, bwh, birthday, blood, hobby, food, type: ftype, personality, hook },
  });
}

console.log(`\n名前      : ${name}`);
console.log(`身長/体重 : ${height}cm / ${weight}kg`);
console.log(`スリーサイズ: ${bwh}`);
console.log(`誕生日    : ${birthday}  血液型: ${blood}`);
console.log(`趣味      : ${hobby}`);
console.log(`好きな食べ物: ${food}`);
console.log(`好きなタイプ: ${ftype}`);
console.log(`性格      : ${personality}`);
console.log(`ひとこと  : ${hook || "(未設定)"}`);
console.log(`\nメイン画像: ${path.basename(main)}`);
if (sub) console.log(`インセット: ${path.basename(sub)}`);
console.log(res.trim());
