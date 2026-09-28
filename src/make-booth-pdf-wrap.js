/**
 * 仕上げ済みの作品から、BOOTH用のPDFと紹介文（ストーリー）を作る。
 *
 *   node src/make-booth-pdf-wrap.js --title "30日後にS○Xする女医さん"
 *
 * 出力: <作品フォルダ>/03_booth/<作品名>.pdf と story.txt
 * PDFは本編をそのまま全ページ入れる（FANZA版と同じ中身）。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, readJson, render, log, ROOT } from "./lib.js";
import { loadWork } from "./work.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const title = opt("title");
const work = title ? loadWork(title) : null;
const workDir = work?.fanza?.workDir;
const pagesDir = workDir && path.join(workDir, "01_本編");
if (!pagesDir || !fs.existsSync(pagesDir)) {
  console.error('使い方: node src/make-booth-pdf-wrap.js --title "作品名"（先に fanza-build.js）');
  process.exit(1);
}

const outDir = path.join(workDir, "03_booth");
fs.mkdirSync(outDir, { recursive: true });

// 紹介文のストーリー部分（タブ設定のあらすじを、登場人物の名前で埋める）
const tab = opt("tab", work.fanza?.tab);
const toc = readJson(path.join(ROOT, "config/fanza-toc.json"));
const T = (tab && toc[tab]) ?? Object.values(toc).find((x) => x?.titleEn && x.story && x.job && work.profile?.job === x.job) ?? null;
const doc = work.heroine?.includes(" ") ? work.heroine.split(" ").pop() : work.heroine;
const story = (T?.story ?? []).map((l) => render(l, { doc, docFull: work.heroine, pat: work.hero })).join("\n");
if (story) fs.writeFileSync(path.join(outDir, "story.txt"), story, "utf8");
else log("! あらすじが見つからないので story.txt は作りませんでした（--tab でタブ名を渡すと引けます）");

// BOOTHは大きすぎるファイルを弾くので、100MBを切るまで画質と幅を落として作り直す
const pdfPath = path.join(outDir, `${title}.pdf`);
const attempts = [
  ["--quality", "88"],
  ["--quality", "80"],
  ["--quality", "75", "--max-width", "900"],
  ["--quality", "70", "--max-width", "800"],
];
for (const [i, extra] of attempts.entries()) {
  execFileSync("python", [
    path.join(ROOT, "tools/make-booth-pdf.py"),
    "--input", pagesDir, "--title", title, "--outdir", outDir, ...extra,
  ], { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  const mb = fs.statSync(pdfPath).size / 1048576;
  if (mb < 100) {
    log(`PDF: ${mb.toFixed(1)}MB（${extra.join(" ")}）`);
    break;
  }
  if (i === attempts.length - 1) log(`! ${mb.toFixed(1)}MB。これ以上は落とせないので、そのまま使うか分割してください`);
  else log(`${mb.toFixed(1)}MB は大きいので、画質を落として作り直します`);
}

// 確認用の連番コピーは本編と重複するので消す
fs.rmSync(path.join(outDir, "jpg"), { recursive: true, force: true });
log(`BOOTH用: ${outDir}`);
