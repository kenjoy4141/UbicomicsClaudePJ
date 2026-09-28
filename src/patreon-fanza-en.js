/**
 * FANZA作品（仕上げ済み）から、Patreon用の英語版ページを作る。
 * 導入シーンの吹き出しだけ英語（横書き）に差し替え、それ以外のページは日本語版と同じ（モザイク済み）。
 *
 *   node src/patreon-fanza-en.js --title "30日後にS○Xする女医さん" --tab fanza_500 --dialogue config/fanza-dialogue-en.json
 *
 * 事前に data/works/<作品名>.json に heroineEn（"Ayane Shirase"）と heroEn（"Minato"）を入れておく。
 * 出力: <作品フォルダ>/02_patreon_en/pages/001.jpg〜
 *
 * 関門: 生成元（モザイク前）の全画像のプロンプトを safety-lint にかけ、1枚でも引っかかったら中止する。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { log, ROOT } from "./lib.js";
import { loadWork } from "./work.js";
import { readPngPrompt } from "./describe.js";
import { lintPrompt } from "./safety-lint.js";

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const title = opt("title");
const tab = opt("tab", "fanza_500");
const variantName = opt("variant");
const dialogue = opt("dialogue");
if (!title || (!dialogue && !variantName)) {
  console.error('使い方: node src/patreon-fanza-en.js --title "作品名" --tab fanza_500 --variant <名前>（または --dialogue <英語セリフ集>）');
  process.exit(1);
}
const work = loadWork(title);
const workDir = work?.fanza?.workDir;
const rawDir = work?.fanza?.rawDir;
if (!workDir || !fs.existsSync(workDir) || !rawDir || !fs.existsSync(rawDir)) {
  console.error("作品フォルダか生成元フォルダが見つかりません。先に fanza-build.js で仕上げてください");
  process.exit(1);
}
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });

// ---------- 安全チェック（生成元のプロンプト全件） ----------
const raws = fs.readdirSync(rawDir).filter((f) => /\.png$/i.test(f));
let bad = 0;
for (const f of raws) {
  const p = readPngPrompt(path.join(rawDir, f));
  if (!p || !lintPrompt(p).ok) bad++;
}
if (bad) {
  console.error(`! 安全チェックに通らない画像が ${bad}/${raws.length}枚あるため中止します`);
  process.exit(2);
}
log(`安全チェック: ${raws.length}枚すべて通過`);

// ---------- 英語の吹き出し ----------
const enDir = path.join(workDir, "02_patreon_en");
const work2 = path.join(enDir, "_work");
fs.mkdirSync(work2, { recursive: true });
const csv = path.join(work2, "bubbles_en.csv");
run("node", [path.join(ROOT, "src/fanza-dialogue.js"), "--title", title, "--tab", tab, "--lang", "en", "--out", csv,
  ...(variantName ? ["--variant", variantName] : []), ...(dialogue ? ["--dialogue", dialogue] : [])]);

const backup = path.join(workDir, "_work", "_intro_original");
const names = fs.readFileSync(csv, "utf8").split(/\r?\n/).slice(1).map((l) => l.split(",")[0].replace(/^﻿/, "").trim()).filter(Boolean);
const input = path.join(work2, "intro_input");
fs.rmSync(input, { recursive: true, force: true });
fs.mkdirSync(input, { recursive: true });
for (const f of names) fs.copyFileSync(path.join(backup, f), path.join(input, f));
const swapFile = csv.replace(/\.csv$/i, "") + ".swap.json";
const swap = fs.existsSync(swapFile) ? JSON.parse(fs.readFileSync(swapFile, "utf8")).swap : null;
if (swap) {
  const [a, b] = swap.map((n) => `${String(n).padStart(3, "0")}.jpg`);
  fs.copyFileSync(path.join(backup, a), path.join(input, b));
  fs.copyFileSync(path.join(backup, b), path.join(input, a));
}
const bubbled = path.join(work2, "bubbled");
const V = variantName ? JSON.parse(fs.readFileSync(path.join(ROOT, "config/variants", `${variantName}.json`), "utf8")) : null;
run("python", [path.join(ROOT, "tools/en-bubbles.py"), "--input", input, "--csv", csv, "--output", bubbled,
  ...(V?.dayLabelEn ? ["--day-label", V.dayLabelEn] : [])]);

// ---------- ページ一式（導入だけ英語版に差し替え） ----------
const pages = path.join(enDir, "pages");
fs.mkdirSync(pages, { recursive: true });
const src = path.join(workDir, "01_本編");
const all = fs.readdirSync(src).filter((f) => /\.jpg$/i.test(f)).sort();
for (const f of all) {
  const en = path.join(bubbled, f);
  fs.copyFileSync(fs.existsSync(en) ? en : path.join(src, f), path.join(pages, f));
}
log(`英語版: ${all.length}ページ（うち導入 ${names.length}枚が英語の吹き出し）→ ${pages}`);
