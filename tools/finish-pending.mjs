/**
 * 生成済みで仕上げが残っている作品を、順番にモザイク〜ZIPまで通す。
 *
 *   node tools/finish-pending.mjs
 *   node tools/finish-pending.mjs --variants biyoshi,okami,takuhai2
 *
 * モザイクは画面操作なので、実行中はPCをロックしないこと。
 * 既に organize 済み（raw_FNNN_<作品名> がある）作品は、作品番号がずれていれば付け替える。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, readJson, log, ROOT } from "../src/lib.js";

const cfg = loadConfig();
const OUT = cfg.worksRoot;
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const names = (opt("variants") ?? "biyoshi,okami,takuhai2").split(",").map((s) => s.trim()).filter(Boolean);

const listPng = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)) : []);
const nextWorkNo = () => {
  const nums = fs.readdirSync(OUT).map((d) => d.match(/^(\d{3})_/)?.[1]).filter(Boolean).map(Number);
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0");
};

for (const name of names) {
  const V = readJson(path.join(ROOT, "config/variants", `${name}.json`));
  if (!V?.title) { log(`! ${name}: variant がありません`); continue; }
  const title = V.title;
  const built = fs.readdirSync(OUT).some((d) => /^\d{3}_/.test(d) && d.endsWith(title));
  if (built) { log(`= ${name}: もう仕上げ済み`); continue; }

  const no = nextWorkNo();
  // organize 済みのフォルダ（番号が古いことがある）を探して、今の番号に付け替える
  const rawNow = path.join(OUT, `raw_F${no}_${title}`);
  if (!fs.existsSync(rawNow)) {
    const old = fs.readdirSync(OUT).find((d) => /^raw_F\d{3}_/.test(d) && d.endsWith(title) && !d.endsWith("moza"));
    if (old) {
      fs.renameSync(path.join(OUT, old), rawNow);
      const oldMoza = path.join(OUT, old + "moza");
      if (fs.existsSync(oldMoza)) fs.rmSync(oldMoza, { recursive: true, force: true });  // 途中で失敗した分は作り直す
      log(`${name}: ${old} → raw_F${no}_${title}（番号を付け替え）`);
    }
  } else if (fs.existsSync(rawNow + "moza")) {
    fs.rmSync(rawNow + "moza", { recursive: true, force: true });
  }

  const organized = listPng(rawNow).length;
  const staged = listPng(path.join(OUT, `RAW_${name}`)).length;
  const args = ["src/fanza-build.js", "--variant", name];
  if (organized) args.push("--steps", "mosaic,pages,bubbles,covers,extras,zip");
  else if (staged) args.push("--src", `RAW_${name}`);
  else { log(`! ${name}: 生成画像が見つかりません（RAW_${name} も raw_F* も空）`); continue; }

  log(`▶ ${no}_${title}（${organized || staged}枚）`);
  try {
    execFileSync("node", args.map((a) => (a.startsWith("src/") ? path.join(ROOT, a) : a)), {
      stdio: "inherit", cwd: ROOT, env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    log(`✓ ${name} 仕上げ完了`);
  } catch {
    log(`! ${name} で失敗しました。ここで止めます`);
    process.exit(1);
  }
}
log("ぜんぶ終わりました");
