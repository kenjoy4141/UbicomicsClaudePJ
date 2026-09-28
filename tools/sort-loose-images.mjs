/**
 * 日付フォルダに残っている生成画像を、プロンプトの中身で作品ごとに仕分ける。
 * まとめ処理（fanza-stage）が失敗して複数作品ぶんが混ざったときの復旧用。
 *
 *   node tools/sort-loose-images.mjs --dates 2026-09-23,2026-09-24 --dry
 *   node tools/sort-loose-images.mjs --dates 2026-09-23,2026-09-24
 *
 * 作品の見分けは variant の introPlaces / replace に出てくる固有の語で行う。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson, log, ROOT } from "../src/lib.js";
import { readPngPrompt } from "../src/describe.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const dry = argv.includes("--dry");
const dates = (opt("dates") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!dates.length) {
  console.error("使い方: node tools/sort-loose-images.mjs --dates 2026-09-23,2026-09-24 [--dry]");
  process.exit(1);
}

// 作品の見分けは E列（顔・髪型）で行う。どのプロンプトにも必ず丸ごと入っていて、作品ごとに違うため
const variantDir = path.join(ROOT, "config/variants");
const MARKS = {};
for (const f of fs.readdirSync(variantDir).filter((x) => x.endsWith(".json"))) {
  const V = readJson(path.join(variantDir, f));
  if (V?.face) MARKS[f.replace(/\.json$/, "")] = [V.face.trim().toLowerCase()];
}

const OUT = cfg.worksRoot;
const files = dates.flatMap((d) => {
  const dir = path.join(OUT, d);
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort().map((f) => path.join(dir, f))
    : [];
});
log(`対象: ${files.length}枚`);

const buckets = {};
const unknown = [];
for (const f of files) {
  const prompt = (readPngPrompt(f) ?? "").toLowerCase();
  const hit = Object.entries(MARKS).find(([, words]) => words.some((w) => prompt.includes(w)));
  if (hit) (buckets[hit[0]] ??= []).push(f);
  else unknown.push(f);
}

for (const [name, list] of Object.entries(buckets)) console.log(`  ${name}: ${list.length}枚`);
if (unknown.length) console.log(`  判別できず: ${unknown.length}枚`);

if (dry) {
  log("--dry のため移動しません");
  process.exit(0);
}

for (const [name, list] of Object.entries(buckets)) {
  const dest = path.join(OUT, `RAW_${name}`);
  fs.mkdirSync(dest, { recursive: true });
  // 既にある枚数の続きから番号を振る（生成順＝ファイル名順を保つ）
  const offset = fs.readdirSync(dest).filter((f) => /\.png$/i.test(f)).length;
  list.forEach((f, i) => {
    fs.renameSync(f, path.join(dest, `${String(offset + i + 1).padStart(5, "0")}_${path.basename(f)}`));
  });
  log(`${name}: ${list.length}枚 → ${dest}`);
}
if (unknown.length) log(`判別できなかった ${unknown.length}枚は日付フォルダに残しました`);
