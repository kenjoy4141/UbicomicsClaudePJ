/**
 * FANZA作品のプロフィール画像と目次画像を作る（00_表紙/ に出す）。
 *
 *   node src/fanza-extras.js --title "30日後にS○Xする女医さん" --tab fanza_500
 *   node src/fanza-extras.js --title "30日後にS○Xするエステのお姉さん" --tab fanza_500_esthe --only toc
 *
 * - 目次: シートの A列の区切りと R列の枚数から、各パートの開始ページを出す（生成順＝ページ順）
 * - プロフィール: BOOTHと同じ src/profile.js。名前は作品データ（セリフと同じ）、年齢・職業は config/fanza-toc.json
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, readJson, log, titleFromDir, ROOT } from "./lib.js";
import { readRange } from "./sheets.js";
import { loadWork } from "./work.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const title = opt("title");
const tab = opt("tab", "fanza_500");
const only = opt("only");
if (!title) {
  console.error('使い方: node src/fanza-extras.js --title "作品名" --tab fanza_500 [--only toc|profile]');
  process.exit(1);
}
const TOC = readJson(path.join(ROOT, "config/fanza-toc.json"))[tab];
if (!TOC) {
  console.error(`config/fanza-toc.json に ${tab} の設定がありません`);
  process.exit(1);
}

const work = loadWork(title);
const OUT = cfg.worksRoot;
const workDir = work?.fanza?.workDir ?? fs.readdirSync(OUT).map((d) => path.join(OUT, d)).find((d) => titleFromDir(path.basename(d)) === title);
if (!workDir || !fs.existsSync(workDir)) {
  console.error(`作品フォルダが見つかりません: ${title}`);
  process.exit(1);
}
const no = path.basename(workDir).slice(0, 3);
const coverDir = path.join(workDir, "00_表紙");
const pagesDir = path.join(workDir, "01_本編");
fs.mkdirSync(coverDir, { recursive: true });

// ---------- 目次 ----------
if (!only || only === "toc") {
  const rows = await readRange(cfg.sheet.id, `${tab}!A1:S1000`);
  const sections = [];
  let imageNo = 0;
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (!String(r[16] ?? "").trim()) continue; // Q列が空の行は生成していない
    const label = String(r[0] ?? "").trim();
    const count = Number(r[17]) || 1;
    const name = label ? (TOC.sections[label] ?? label) : null;
    // 同じ名前の区切りが続く場合（非エロの前半・後半）は1行にまとめる
    if (name && name !== sections.at(-1)?.name) sections.push({ name, start: imageNo + 1, rows: [] });
    sections.at(-1)?.rows.push({ image: imageNo + 1, count, act: String(r[12] ?? "").trim() });
    imageNo += count;
  }
  log(`目次: ${sections.length}パート / 全${imageNo}ページ`);

  // 写真は日常パート以外から1枚ずつ。行為の指定（M列）が無いコマ＝顔が見えやすいコマを優先する
  const rnd = (n) => Math.floor(Math.random() * n);
  const photos = sections.filter((s, i) => i > 0).map((s) => {
    const calm = s.rows.filter((x) => !x.act);
    const pool = calm.length ? calm : s.rows;
    const pick = pool[rnd(pool.length)];
    return path.join(pagesDir, `${String(pick.image + rnd(pick.count)).padStart(3, "0")}.jpg`);
  });

  const spec = path.join(workDir, "_work", "toc.json");
  fs.mkdirSync(path.dirname(spec), { recursive: true });
  fs.writeFileSync(spec, JSON.stringify({ lines: sections.map((s) => [String(s.start), s.name]), photos }, null, 2), "utf8");
  sections.forEach((s) => console.log(`  p${s.start}〜 ${s.name}`));

  execFileSync("python", [
    path.join(ROOT, "tools/make-fanza-toc.py"), "--spec", spec, "--out", path.join(coverDir, `${no}目次.jpg`),
    "--seed", String(Number(no) * 13),
  ], { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
}

// ---------- プロフィール ----------
if (!only || only === "profile") {
  const mozaDir = work?.fanza?.mozaDir;
  if (!mozaDir || !fs.existsSync(mozaDir)) {
    console.error("モザイク済みフォルダが見つかりません（プロンプトを読むのに使う）: " + mozaDir);
    process.exit(1);
  }
  execFileSync("node", [
    path.join(ROOT, "src/profile.js"), "--dir", mozaDir, "--work", title,
    "--age", TOC.age, "--job", TOC.job,
    "--out", path.join(coverDir, `${no}プロフィール.jpg`),
  ], { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
}
