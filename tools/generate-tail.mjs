/**
 * シートの読み取り範囲が400行で切れていたせいで生成されなかった後半の行を、
 * あとから焼き足して既存のフォルダの末尾に足す。
 *
 *   node tools/generate-tail.mjs --variant shisho --rows 401-453 --dest RAW_shisho
 *
 * 生成した画像は日付フォルダに出るので、そこから「この作品のぶん」だけを
 * プロンプトで見分けて、既存の通し番号の続きで移す。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, readJson, log, ROOT } from "../src/lib.js";
import { readPngPrompt } from "../src/describe.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const name = opt("variant");
const rows = opt("rows", "401-453");
const dest = opt("dest");
if (!name || !dest) {
  console.error("使い方: node tools/generate-tail.mjs --variant shisho --rows 401-453 --dest RAW_shisho");
  process.exit(1);
}
const V = readJson(path.join(ROOT, "config/variants", `${name}.json`));
const destDir = path.join(cfg.worksRoot, dest);
if (!fs.existsSync(destDir)) {
  console.error(`移動先がありません: ${destDir}`);
  process.exit(1);
}

const before = new Set(fs.existsSync(cfg.worksRoot)
  ? fs.readdirSync(cfg.worksRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  : []);

log(`${name}: ${rows} 行目を生成します（アカウント${V.account}）`);
const r = spawnSync("node", [path.join(ROOT, "src/sd-generate.js"), "--tab", V.tab,
  ...(V.account ? ["--account", V.account] : []), "--rows", rows],
  { stdio: "inherit", cwd: ROOT, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
if (r.status !== 0) { console.error("! 生成に失敗しました"); process.exit(1); }

// 日付フォルダから、この作品の画像だけ拾う
const face = (V.face ?? "").trim();
const dates = fs.readdirSync(cfg.worksRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
const found = [];
for (const d of dates) {
  const dir = path.join(cfg.worksRoot, d);
  for (const f of fs.readdirSync(dir).filter((x) => /\.png$/i.test(x)).sort()) {
    const full = path.join(dir, f);
    if ((readPngPrompt(full) ?? "").includes(face)) found.push(full);
  }
}
if (!found.length) { console.error("! 生成された画像が見つかりません"); process.exit(1); }

const offset = fs.readdirSync(destDir).filter((f) => /\.png$/i.test(f)).length;
found.forEach((f, i) => {
  fs.renameSync(f, path.join(destDir, `${String(offset + i + 1).padStart(5, "0")}_${path.basename(f)}`));
});
log(`${found.length}枚を ${dest} の末尾（${offset + 1}番から）に足しました`);
