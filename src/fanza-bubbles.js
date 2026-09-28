/**
 * 導入シーンに吹き出しを付ける。manga_bubble/add_bubbles.py を作業フォルダで呼び出す。
 *
 *   node src/fanza-bubbles.js --pages <001.jpg〜が入ったフォルダ> --csv <bubbles.csv> --out <出力フォルダ>
 *
 * add_bubbles.py は相対パス（input/ output/ bubbles.csv font/ 顔検出モデル）で動くので、
 * ユーザーが普段使っている manga_bubble フォルダを汚さないよう、専用の作業フォルダを用意して実行する。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { log, ROOT } from "./lib.js";

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

// 吹き出しツール（別リポジトリ manga_bubble）の場所。
// --tool > config.json の mangaBubbleDir > このプロジェクトと同じ階層の manga_bubble の順で探す
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config/config.json"), "utf8"));
const MB = opt("tool", cfg.mangaBubbleDir ?? path.resolve(ROOT, "..", "manga_bubble"));
const pages = opt("pages");
const csv = opt("csv");
const out = opt("out");
if (!pages || !csv || !out) {
  console.error("使い方: node src/fanza-bubbles.js --pages <フォルダ> --csv <bubbles.csv> --out <出力フォルダ>");
  process.exit(1);
}
if (!fs.existsSync(path.join(MB, "add_bubbles.py"))) {
  console.error(`吹き出しツールが見つかりません: ${MB}`);
  process.exit(1);
}

// ---------- 作業フォルダ ----------
const work = path.join(path.dirname(path.resolve(out)), "_bubble_work");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, "input"), { recursive: true });
fs.cpSync(path.join(MB, "font"), path.join(work, "font"), { recursive: true });
fs.copyFileSync(path.join(MB, "lbpcascade_animeface.xml"), path.join(work, "lbpcascade_animeface.xml"));
fs.copyFileSync(csv, path.join(work, "bubbles.csv"));

// CSVに載っている画像だけを入力に置く
const names = fs.readFileSync(csv, "utf8").split(/\r?\n/).slice(1).map((l) => l.split(",")[0].replace(/^\uFEFF/, "").trim()).filter(Boolean);
let copied = 0;
for (const n of names) {
  const src = path.join(pages, n);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(work, "input", n));
    copied++;
  }
}
log(`吹き出しを付ける画像: ${copied}/${names.length}枚`);
if (copied === 0) {
  console.error("CSVに載っている画像がフォルダにありません");
  process.exit(1);
}

// ---------- 左上ラベルの書式 ----------
// add_bubbles.py は「N日目」固定。別の書式（「N回目」など）にしたいときは、
// ユーザーの manga_bubble を汚さないよう作業フォルダにコピーしてその1行だけ差し替える
const dayLabel = opt("day-label");
let script = path.join(MB, "add_bubbles.py");
if (dayLabel) {
  const src = fs.readFileSync(script, "utf8");
  const from = 'label = f"{day_str}日目"';
  if (!src.includes(from)) {
    console.error("! add_bubbles.py のラベル行が見つからないので、書式の差し替えを飛ばします");
  } else {
    const replaced = src.replace(from, `label = ${JSON.stringify(dayLabel)}.replace("{n}", str(day_str))`);
    script = path.join(work, "add_bubbles.py");
    fs.writeFileSync(script, replaced, "utf8");
    log(`ラベルの書式: ${dayLabel}`);
  }
}

// ---------- 実行 ----------
execFileSync("python", [script], {
  cwd: work,
  stdio: "inherit",
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
});

// ---------- 回収 ----------
fs.mkdirSync(out, { recursive: true });
let done = 0;
for (const f of fs.readdirSync(path.join(work, "output"))) {
  fs.copyFileSync(path.join(work, "output", f), path.join(out, f));
  done++;
}
log(`吹き出し付き: ${done}枚 → ${out}`);
