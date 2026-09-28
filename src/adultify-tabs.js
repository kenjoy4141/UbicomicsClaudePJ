/**
 * スプレッドシートの全タブを「登場人物が全員はっきり成人」の版に書き換える。
 *
 *   node src/adultify-tabs.js --dry   … 書き込まず、置き換え後に全行が安全チェックを通るか確認
 *   node src/adultify-tabs.js         … 書き込む（元に戻すときはスプレッドシートの「版の履歴」から）
 *
 * Q列は数式なので触らない（他の列から自動で組み直される）。
 * 書き込み後、計算されたQ列を safety-lint にかけ、不合格が残ればタブ名と行を報告する。
 */
import { getInfo, readRange, writeRange } from "./sheets.js";
import { lintPrompt } from "./safety-lint.js";
import { loadConfig, log } from "./lib.js";

const cfg = loadConfig();
const dry = process.argv.includes("--dry");
const SKIP = new Set(["作品管理", "patreon_100"]);

// 長く具体的なものから先に置き換える
const REPLACE = [
  ["onee-shotacon,", ""],

  // 相手役: 成人男性に
  ["1 very young black-haired boy,gakuran,", "1 adult man, 20s, short black hair, tall, broad shoulders, business suit,"],
  ["1 very young black-haired boy,", "1 adult man, 20s, short black hair, tall, broad shoulders,"],

  // 年齢表記
  ["45 years old girl", "45 years old woman"],
  ["35 years old girl", "35 years old woman"],
  ["girl's room", "woman's bedroom"],

  // 保健室 → クリニック
  ["school infirmary room, unoccupied bed near sliding windows, sheer white curtains swaying, vision test poster, seasonal health notices,",
   "private clinic examination room, unoccupied bed near windows, sheer white curtains swaying, eye chart, health notices,"],
  ["school infirmary, medical examination,", "private clinic, medical examination,"],
  ["school infirmary", "private clinic"],
  ["caring for student", "caring for patient"],

  // 制服 → 大人の服装
  ["wearing a traditional sailor school uniform", "wearing an elegant office blouse and pencil skirt"],
  ["school uniform,serafuku,white shirt,short sleeves,pleats navy skirt,red ribbon,", "office blouse, fitted pencil skirt, pearl earrings,"],

  // 教室 → オフィス
  ["class room,indoor,", "office meeting room,indoor,"],
  ["classroom,(night:1.5),", "office,(night:1.5),"],
  ["classroom,night,", "office,night,"],
  ["classroom,", "office,"],
  ["female teacher", "office lady"],

  // 通学路 → 並木道
  ["set in a quiet outdoor school path during sunset", "set in a quiet tree-lined city path during sunset"],

  // 学校のプール → ホテルのプール
  ["school pool side,", "hotel pool side,"],
];

function transform(s) {
  let out = String(s ?? "");
  for (const [from, to] of REPLACE) out = out.split(from).join(to);
  return out;
}

const info = await getInfo(cfg.sheet.id);
const summary = [];

for (const s of info.sheets) {
  if (SKIP.has(s.title)) continue;

  const values = await readRange(cfg.sheet.id, `${s.title}!A1:P1200`);
  let last = 0;
  const qcol = await readRange(cfg.sheet.id, `${s.title}!Q1:Q1200`);
  qcol.forEach((r, i) => { if (String(r[0] ?? "").trim()) last = i + 1; });
  if (last < 4) continue;

  // A〜P列だけ置き換える（Qは数式、R・Sは枚数とメモ）
  let changed = 0;
  const out = [];
  for (let r = 0; r < last; r++) {
    const row = values[r] ?? [];
    const next = [];
    for (let c = 0; c < 16; c++) {
      const before = row[c] ?? "";
      const after = transform(before);
      if (before !== after) changed++;
      next.push(after);
    }
    out.push(next);
  }

  // 書き込み前の見込み: 置き換え後の各列を Q と同じ順で連結して検査する
  const order = [3, 4, 5, 7, 8, 9, 10, 6, 11, 12, 13, 14, 15];
  const prefix = out[1]?.[2] ?? "";
  const fails = [];
  for (let r = 3; r < last; r++) {
    const q = prefix + order.map((c) => out[r][c] ?? "").join("");
    const res = lintPrompt(q);
    if (!res.ok) fails.push({ row: r + 1, why: [res.blocked.join(","), res.missingAdult ? "大人の明示なし" : ""].filter(Boolean).join(" / ") });
  }

  summary.push({ tab: s.title, rows: last - 3, changed, fails: fails.length });
  console.log(`\n${s.title}: ${last - 3}行 / 置き換え ${changed}セル / 置き換え後の不合格 ${fails.length}行`);
  fails.slice(0, 5).forEach((f) => console.log(`   行${f.row}: ${f.why}`));

  if (dry) continue;
  if (fails.length) {
    log(`! ${s.title} は不合格が残るため書き込みを見送りました`);
    continue;
  }
  await writeRange(cfg.sheet.id, `${s.title}!A1:P${last}`, out);

  // 書き込み後、実際に計算されたQ列で再確認
  const q = await readRange(cfg.sheet.id, `${s.title}!Q4:Q${last}`);
  const after = q.filter((r) => String(r[0] ?? "").trim() && !lintPrompt(r[0]).ok).length;
  log(`  書き込み完了。実際のQ列で再検査: 不合格 ${after}行`);
}

console.log("\n=== まとめ ===");
console.table(summary);
if (dry) log("--dry のため書き込んでいません。");
