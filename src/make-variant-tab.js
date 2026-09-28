/**
 * 既存タブ（fanza_500 など）から、場所・シチュ・服装・キャラを差し替えた派生タブを作る。
 *
 *   node src/make-variant-tab.js --variant esthe --dry   … 書き込まず、置き換え結果と検査だけ
 *   node src/make-variant-tab.js --variant esthe         … タブを作って書き込む
 *
 * 定義は config/variants/<名前>.json。Q列の数式はそのまま写す（同じ行番号を参照するので崩れない）。
 * 書き込み後の Q列を safety-lint と LoRA 許可リストにかけ、置き換え漏れ（元の場所の語）も報告する。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson, log, ROOT } from "./lib.js";
import { ensureTab, readRange, writeRange } from "./sheets.js";
import { lintPrompt, disallowedLoras } from "./safety-lint.js";
import { buildIntro } from "./intro-rows.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const name = opt("variant");
const dry = argv.includes("--dry");
if (!name) {
  console.error("使い方: node src/make-variant-tab.js --variant esthe [--dry]");
  process.exit(1);
}
const V = readJson(path.join(ROOT, "config/variants", `${name}.json`));

const src = await readRange(cfg.sheet.id, `${V.sourceTab}!A1:S1000`, { formulas: true });
const firstData = cfg.sheet.firstRow - 1;

const transform = (s) => {
  let out = String(s ?? "");
  for (const [from, to] of V.replace) out = out.split(from).join(to);
  return out;
};

// ストーリーボードがある作品は、導入パート（A列が非エロの区切り）を丸ごと作り直す。
// 元のシートの導入は女医版の流用で、作品の設定と噛み合わないため
let introRows = null;
let introEnd = 0;   // 元シートで導入が終わる行番号（0始まり）
if (V.introStoryboard) {
  ({ rows: introRows } = buildIntro(V));
  let blocks = 0;
  for (let i = firstData; i < src.length; i++) {
    const label = String(src[i]?.[0] ?? "").trim();
    if (label) {
      if (label.includes("非エロ")) blocks++;
      else if (blocks > 0) { introEnd = i; break; }
    }
  }
  if (!introEnd) {
    console.error("元シートの導入パートの終わりが分かりません");
    process.exit(1);
  }
}

const out = src.map((r, i) => {
  const row = [...r];
  while (row.length < 19) row.push("");
  if (i < firstData) return row;
  for (let c = 3; c <= 15; c++) row[c] = transform(row[c]);
  const scene = String(row[2] ?? "").trim();
  if (V.sceneRename?.[scene]) row[2] = V.sceneRename[scene];
  if (String(row[4]).trim()) row[4] = V.face;
  return row;
});

// 導入パートを差し替えた並びにする（見出し3行 + 新しい導入 + 元のエロ行）
const final = introRows
  ? [...out.slice(0, firstData), ...introRows, ...out.slice(introEnd)]
  : out;

// Q列は「自分の行」を参照する数式なので、行が動いたぶんを入れ直す
const order = [3, 4, 5, 7, 8, 9, 10, 6, 11, 12, 13, 14, 15];
const COLS = ["D", "E", "F", "H", "I", "J", "K", "G", "L", "M", "N", "O", "P"];
for (let i = firstData; i < final.length; i++) {
  const hasContent = String(final[i][4] ?? "").trim() || String(final[i][3] ?? "").trim();
  final[i][16] = hasContent ? "=$C$2&" + COLS.map((c) => c + (i + 1)).join("&") : "";
}

// 置き換え後のプロンプトを、数式と同じ順で組み立てて検査する
const prefix = String(out[1]?.[2] ?? "");
const prompts = final.slice(firstData)
  // sd-generate は E列（キャラ）を含む行だけ生成するので、検査も同じ行に揃える
  .map((r, k) => ({ row: firstData + k + 1, prompt: String(r[16] ?? "").trim() && String(r[4] ?? "").trim() ? prefix + order.map((c) => r[c] ?? "").join("") : "" }))
  .filter((p) => p.prompt);

const LEFTOVER = ["clinic", "stethoscope", "lab coat", "medical", "patient", "doctor", "nurse"];
let bad = 0;
const leftovers = new Map();
for (const p of prompts) {
  if (!lintPrompt(p.prompt).ok) bad++;
  const low = p.prompt.toLowerCase();
  for (const w of LEFTOVER) if (low.includes(w)) leftovers.set(w, (leftovers.get(w) ?? 0) + 1);
}
const loras = [...new Set(prompts.flatMap((p) => disallowedLoras(p.prompt, cfg.sd.allowedLoras ?? [])))];

console.log(`${V.sourceTab} → ${V.tab}: ${prompts.length}行`);
console.log(`  安全チェック不合格: ${bad} / 許可外LoRA: ${loras.join(",") || "なし"}`);
console.log(`  置き換え漏れ: ${[...leftovers].map(([w, n]) => `${w}×${n}`).join(", ") || "なし"}`);
if (bad || loras.length) {
  console.error("! 検査に通らないので書き込みません");
  process.exit(2);
}
if (dry) {
  console.log(`\n例（行${prompts[1]?.row}）: ${prompts[1]?.prompt.slice(0, 400)}`);
  process.exit(0);
}

await ensureTab(cfg.sheet.id, V.tab);
// 行数が減ることがあるので、余った行を消すために広めに空で埋めてから書く
await writeRange(cfg.sheet.id, `${V.tab}!A1:S${Math.max(final.length, out.length) + 5}`,
  [...final, ...Array.from({ length: Math.max(0, out.length + 5 - final.length) }, () => new Array(19).fill(""))]);
if (introRows) log(`導入パートをストーリーボードから作り直しました（${introRows.length}行）`);

// 目次・プロフィール・作品コメントが使う情報を、タブ名で引けるように登録する
{
  const file = path.join(ROOT, "config/fanza-toc.json");
  const toc = readJson(file);
  toc[V.tab] = {
    ...(toc[V.tab] ?? {}),
    age: V.age ?? "28歳",
    job: V.job,
    jobEn: V.jobEn,
    titleEn: V.titleEn,
    coverEn: V.coverEn,
    sections: V.sections,
    sectionsEn: V.sectionsEn,
    story: V.story,
    storyEn: V.storyEn,
    appeal: V.appeal,
    appealEn: V.appealEn,
    variant: name,
    setup: V.setup,
    setupEn: V.setupEn,
  };
  fs.writeFileSync(file, JSON.stringify(toc, null, 2) + "\n", "utf8");
  log(`config/fanza-toc.json に ${V.tab} を登録しました`);
}

// 書き込み後の Q列（数式の計算結果）でもう一度確かめる
const q = (await readRange(cfg.sheet.id, `${V.tab}!Q4:Q400`)).map((r) => r[0] ?? "").filter((s) => s.trim());
const badAfter = q.filter((s) => !lintPrompt(s).ok).length;
log(`書き込み完了: ${V.tab}（Q列 ${q.length}行 / 不合格 ${badAfter}）`);
if (badAfter) process.exit(2);
