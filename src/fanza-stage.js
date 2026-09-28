/**
 * 日付をまたいで2つのフォルダに分かれた生成画像を、生成順のまま1つのフォルダにまとめる。
 * A1111 は日付フォルダごとに 00000 から番号を振り直すので、名前順で並べると順番が壊れる。
 * そのため「フォルダの順 → フォルダ内の名前順」で通し番号を先頭に付けて移動する。
 *
 *   node src/fanza-stage.js --dates 2026-09-14,2026-09-15 --out F016_raw --expected 500
 *
 * まとめたフォルダは fanza-build.js の --src に渡す。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, log } from "./lib.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const dates = (opt("dates") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const outName = opt("out");
const expectedOpt = opt("expected", "500");
const expected = expectedOpt === "auto" ? null : Number(expectedOpt);
if (!dates.length || !outName) {
  console.error("使い方: node src/fanza-stage.js --dates 2026-09-14,2026-09-15 --out F016_raw --expected 500");
  process.exit(1);
}

const OUT = cfg.worksRoot;
const files = dates.flatMap((d) => {
  const dir = path.join(OUT, d);
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort().map((f) => path.join(dir, f))
    : [];
});

if (expected !== null && files.length !== expected && !argv.includes("--force")) {
  console.error(`! 画像が ${files.length}枚です（想定 ${expected}枚）。移動しません`);
  process.exit(1);
}
if (!files.length) {
  console.error("! まとめる画像がありません");
  process.exit(1);
}

const dest = path.join(OUT, outName);
fs.mkdirSync(dest, { recursive: true });
files.forEach((f, i) => {
  fs.renameSync(f, path.join(dest, `${String(i + 1).padStart(5, "0")}_${path.basename(f)}`));
});
log(`${files.length}枚 → ${dest}`);
