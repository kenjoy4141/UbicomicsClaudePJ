/**
 * 導入パートだけ焼き直して、既存の生成フォルダの先頭を差し替える。
 *
 *   node tools/replace-intro.mjs --variant kaseifu --dest "raw_F033_巨乳人妻家政婦のご奉仕"
 *
 * 導入はシートの先頭から連続する行なので、行数はストーリーボードから数える。
 * 差し替え後は通し番号を保つので、本編の並びは崩れない。
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
const dest = opt("dest");
if (!name || !dest) {
  console.error('使い方: node tools/replace-intro.mjs --variant kaseifu --dest "raw_F033_..."');
  process.exit(1);
}
const V = readJson(path.join(ROOT, "config/variants", `${name}.json`));
const sb = readJson(path.join(ROOT, V.introStoryboard));
const introRows = sb.beats.reduce((n, b) => n + (b.poses?.length ?? b.images ?? sb.imagesPerBeat ?? 2), 0);
const destDir = path.join(cfg.worksRoot, dest);
const have = fs.readdirSync(destDir).filter((f) => /\.png$/i.test(f)).sort();
log(`${name}: 導入 ${introRows}行 / 既存 ${have.length}枚`);
if (have.length < introRows) { console.error("! 既存の枚数が導入より少ないです"); process.exit(1); }

// シートの行番号。ヘッダが3行あるので 4 から始まる
const rows = `4-${3 + introRows}`;
log(`${rows} 行目を焼き直します（アカウント${V.account}）`);
const r = spawnSync("node", [path.join(ROOT, "src/sd-generate.js"), "--tab", V.tab,
  ...(V.account ? ["--account", V.account] : []), "--rows", rows],
  { stdio: "inherit", cwd: ROOT, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
if (r.status !== 0) { console.error("! 生成に失敗しました"); process.exit(1); }

const face = (V.face ?? "").trim();
const fresh = [];
for (const d of fs.readdirSync(cfg.worksRoot).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
  const dir = path.join(cfg.worksRoot, d);
  for (const f of fs.readdirSync(dir).filter((x) => /\.png$/i.test(x)).sort()) {
    const full = path.join(dir, f);
    if ((readPngPrompt(full) ?? "").includes(face)) fresh.push(full);
  }
}
if (fresh.length !== introRows) {
  console.error(`! 焼き直した枚数が合いません（${fresh.length} / ${introRows}）。日付フォルダに残したままにします`);
  process.exit(1);
}

// 古い導入を退避してから、同じ通し番号で置き換える
const old = path.join(cfg.worksRoot, `_古い導入_${dest}`);
fs.mkdirSync(old, { recursive: true });
have.slice(0, introRows).forEach((f) => fs.renameSync(path.join(destDir, f), path.join(old, f)));
fresh.forEach((f, i) => {
  fs.renameSync(f, path.join(destDir, `${String(i + 1).padStart(5, "0")}_${path.basename(f)}`));
});
log(`導入 ${introRows}枚を差し替えました（古いぶんは ${old}）`);
