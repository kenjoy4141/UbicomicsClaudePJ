/**
 * 生成が二重に走って日付フォルダに混ざった画像から、作品ごとに正しい1セットを取り出す。
 *
 *   node tools/recover-mixed.mjs --variant nurse --date 2026-09-26 --dry
 *   node tools/recover-mixed.mjs --variant nurse --date 2026-09-26
 *
 * タブのQ列（プロンプト）とR列（枚数）から「本来の並び」を作り、
 * 同じプロンプトの画像を古い順に必要枚数だけ拾う。多重に生成された分は残す。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson, log, ROOT } from "../src/lib.js";
import { readRange } from "../src/sheets.js";
import { readPngPrompt } from "../src/describe.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const dry = argv.includes("--dry");
const name = opt("variant");
const date = opt("date");
if (!name || !date) {
  console.error("使い方: node tools/recover-mixed.mjs --variant nurse --date 2026-09-26 [--dry]");
  process.exit(1);
}
const V = readJson(path.join(ROOT, "config/variants", `${name}.json`));
const tab = V?.tab ?? `fanza_500_${name}`;
const sheet = cfg.sheet;

// ---------- 本来の並びをシートから作る ----------
const rows = await readRange(sheet.id, `${tab}!A1:R2000`);
const base = (rows[sheet.firstRow - 1]?.[4] ?? "").trim();
const wanted = [];   // [{prompt, n}] を枚数ぶん展開したもの
for (let r = sheet.firstRow - 1; r < rows.length; r++) {
  const q = (rows[r]?.[sheet.promptCol] ?? "").trim();
  if (!q || !q.includes(base)) continue;
  const count = Number((rows[r]?.[sheet.countCol] ?? "").trim()) || 1;
  for (let i = 0; i < count; i++) wanted.push(q);
}
log(`${tab}: 本来 ${wanted.length}枚`);

// ---------- 日付フォルダの画像を読む ----------
const uniq = [...new Set(wanted)].sort((a, b) => b.length - a.length);   // 長い方から試す
const dir = path.join(cfg.worksRoot, date);
const files = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f));
const byPrompt = new Map();
let mine = 0;
for (const f of files) {
  const full = path.join(dir, f);
  const p = (readPngPrompt(full) ?? "").trim();
  if (!p.includes(base)) continue;          // 別作品の画像
  mine++;
  // アカウントごとの画風タグが末尾に足されているので、前方一致でシートの行を探す
  const key = uniq.find((q) => p.startsWith(q)) ?? p;
  // 生成時刻（古い順）で並べたいので mtime を持つ
  const list = byPrompt.get(key) ?? [];
  list.push({ full, mtime: fs.statSync(full).mtimeMs });
  byPrompt.set(key, list);
}
for (const list of byPrompt.values()) list.sort((a, b) => a.mtime - b.mtime);
log(`この作品の画像: ${mine}枚（プロンプト ${byPrompt.size}種）`);

// ---------- 本来の並びどおりに、古いほうから拾う ----------
const used = new Map();
const picked = [];
const missing = [];
for (const q of wanted) {
  const list = byPrompt.get(q);
  const k = used.get(q) ?? 0;
  if (!list || !list[k]) { missing.push(q.slice(0, 50)); continue; }
  picked.push(list[k].full);
  used.set(q, k + 1);
}
log(`拾えた: ${picked.length}枚 / 足りない: ${missing.length}枚`);
if (missing.length) missing.slice(0, 3).forEach((m) => log(`  足りない例: ${m}…`));

if (dry) { log("--dry のため移動しません"); process.exit(missing.length ? 1 : 0); }
if (missing.length) { console.error("! 足りない行があるので移動しません"); process.exit(1); }

const dest = path.join(cfg.worksRoot, `RAW_${name}`);
fs.mkdirSync(dest, { recursive: true });
picked.forEach((f, i) => {
  fs.renameSync(f, path.join(dest, `${String(i + 1).padStart(5, "0")}_${path.basename(f)}`));
});
log(`${picked.length}枚 → ${dest}`);
const left = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).length;
log(`日付フォルダの残り: ${left}枚（重複ぶん・他作品ぶん）`);
