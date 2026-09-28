/**
 * すでに作品フォルダがある作品を、モザイクからやり直して作り直す。
 * finish-pending.mjs は「作品フォルダがあれば済み」と見なすので、こちらを使う。
 *
 *   node tools/rebuild-works.mjs --variants kaseifu,fudosan,konbini,shisho
 *   node tools/rebuild-works.mjs --variants kaseifu --keep-mosaic   … モザイクはやり直さない
 *
 * モザイクは画面操作なので、実行中はPCをロックしないこと。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, readJson, log, ROOT } from "../src/lib.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const keepMosaic = argv.includes("--keep-mosaic");
const names = (opt("variants") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!names.length) {
  console.error("使い方: node tools/rebuild-works.mjs --variants kaseifu,fudosan");
  process.exit(1);
}

for (const name of names) {
  const V = readJson(path.join(ROOT, "config/variants", `${name}.json`));
  if (!V?.title) { log(`! ${name}: variant がありません`); continue; }
  const work = readJson(path.join(ROOT, "data/works", `${V.title}.json`)) ?? {};
  const moza = work?.fanza?.mozaDir;
  if (!keepMosaic && moza && fs.existsSync(moza)) {
    fs.rmSync(moza, { recursive: true, force: true });
    log(`${name}: 古いモザイクを消しました（${path.basename(moza)}）`);
  }
  const steps = keepMosaic
    ? "pages,panels,bubbles,covers,extras,zip"
    : "mosaic,pages,panels,bubbles,covers,extras,zip";
  log(`▶ ${V.title}（${steps}）`);
  const r = spawnSync("node", [path.join(ROOT, "src/fanza-build.js"), "--variant", name, "--steps", steps],
    { stdio: "inherit", cwd: ROOT, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (r.status !== 0) { log(`! ${name} で失敗しました。ここで止めます`); process.exit(1); }
  log(`✓ ${name} 完了`);
}
log("ぜんぶ終わりました");
