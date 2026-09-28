/**
 * pixiv_100_MB をもとに、Patreon専用の patreon_100 タブを作る。
 *
 *   node src/make-patreon-tab.js --dry   … 書き込まず差し替え内容だけ表示
 *   node src/make-patreon-tab.js         … タブを作って書き込む（既にあれば上書き）
 *
 * Patreonは illustrated / AI生成の成人向け作品で「登場人物が間違いなく大人であること」を求める。
 * 未成年を想起させる要素（相手役・文脈・場所）を差し替え、最後に safety-lint で全行を検査する。
 * 検査に1行でも引っかかったら、タブは作っても生成には使えない状態として警告する。
 */
import { readRange, writeRange, ensureTab } from "./sheets.js";
import { lintAll } from "./safety-lint.js";
import { loadConfig, log } from "./lib.js";

const cfg = loadConfig();
const dry = process.argv.includes("--dry");
const SRC = "pixiv_100_MB";
const DST = "patreon_100";

// 差し替えルール。Q列（数式）以外の全セルに適用する
const REPLACE = [
  // 著作権リスクのあるキャラLoRAは外す（顔・髪は --char で上書きしているので方向性は保てる）
  ["<lora:lala_satalin_devilukePDXL_scarxzys:1>,", ""],
  // 年齢差を示す概念タグは外す
  ["onee-shotacon,", ""],
  // 相手役を成人男性に
  ["1 very young black-haired boy,", "1 adult man, 20s, short black hair, tall,"],
  // 紛らわしい「girl」表記を woman に
  ["45 years old girl", "45 years old woman"],
  ["girl's room", "woman's bedroom"],
];

function transform(cell) {
  let s = String(cell ?? "");
  for (const [from, to] of REPLACE) s = s.split(from).join(to);
  return s;
}

// ---------- 元タブを読む（数式はそのまま移す）----------
const values = await readRange(cfg.sheet.id, `${SRC}!A1:S1000`);
const formulas = await readRange(cfg.sheet.id, `${SRC}!Q1:Q400`, { formulas: true });

let last = 0;
values.forEach((r, i) => { if ((r[16] ?? "").trim()) last = i + 1; });
log(`${SRC}: ${last}行を読み込み`);

const out = [];
let changed = 0;
for (let r = 0; r < last; r++) {
  const row = values[r] ?? [];
  const next = [];
  for (let c = 0; c < 19; c++) {
    if (c === 16) {
      // Q列は数式を優先して移す（他の列から自動で組まれる）
      next.push(formulas[r]?.[0] ?? row[c] ?? "");
      continue;
    }
    const before = row[c] ?? "";
    const after = transform(before);
    if (before !== after) changed++;
    next.push(after);
  }
  out.push(next);
}
log(`差し替えたセル: ${changed}個`);

// C2（全行に付く固定文言）の変化を見せる
console.log("\nC2 変更前:", String(values[1]?.[2] ?? "").slice(-140));
console.log("C2 変更後:", String(out[1]?.[2] ?? "").slice(-140));

if (dry) {
  log("\n--dry のため書き込んでいません。");
  process.exit(0);
}

// ---------- 書き込み ----------
await ensureTab(cfg.sheet.id, DST);
await writeRange(cfg.sheet.id, `${DST}!A1:S${out.length}`, out);
log(`\n${DST} に ${out.length}行を書き込みました`);

// ---------- 検査（数式が計算されたあとのQ列を読む）----------
const q = await readRange(cfg.sheet.id, `${DST}!Q4:Q${out.length}`);
const prompts = q.map((r, i) => ({ row: i + 4, prompt: r[0] ?? "" })).filter((p) => p.prompt.trim());
const problems = lintAll(prompts);

console.log(`\n安全チェック: ${prompts.length}行を検査`);
if (problems.length === 0) {
  console.log("問題なし。このタブは生成に使えます。");
} else {
  console.log(`! ${problems.length}行で問題を検出。生成には使わないでください:`);
  problems.slice(0, 20).forEach((p) =>
    console.log(`  行${p.row}: ${[p.blocked.join(","), p.missingAdult ? "大人の明示なし" : ""].filter(Boolean).join(" / ")}`)
  );
  process.exit(2);
}
