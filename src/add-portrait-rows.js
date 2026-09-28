/**
 * サムネ・プロフィールカード用の「単体・着衣・ポートレート」行をシートに追加する。
 *
 *   node src/add-portrait-rows.js --dry   … 書き込まず内容だけ表示
 *   node src/add-portrait-rows.js         … 実際に追加
 *
 * Q列は数式（$C$2&D&E&F&H&I&J&K&G&L&M&N&O&P）なので、
 * 各列に値を入れ、Q列には同じ形の数式を書き込む。
 * 相手(L)・行為(M)・雰囲気(P) は空にするため、着衣の単体カットになる。
 */
import { readRange, writeRange } from "./sheets.js";
import { loadConfig, log } from "./lib.js";

const cfg = loadConfig();
const dry = process.argv.includes("--dry");
const TAB = "pixiv_100_MB";
const COLS = "ABCDEFGHIJKLMNOPQRS";

// ---------- 追加する行 ----------
const PORTRAITS = [
  { scene: "ポートレート正面", expr: "gentle smile, looking at viewer,",
    outfit: "blouse, cardigan, pencil skirt,", pose: "upper body, standing, front view, hands together," },
  { scene: "ポートレート斜め", expr: "calm expression, looking at viewer,",
    outfit: "blouse, long skirt,", pose: "cowboy shot, standing, hand on hip, three quarter view," },
  { scene: "ポートレート微笑み", expr: "soft smile, head tilt, looking at viewer,",
    outfit: "knit sweater, long skirt,", pose: "upper body, standing, arms at sides," },
  { scene: "ポートレート座り", expr: "relaxed expression, looking at viewer,",
    outfit: "blouse, pencil skirt, cardigan,", pose: "sitting on chair, legs together, cowboy shot," },
  { scene: "ポートレート振り向き", expr: "surprised expression, looking at viewer,",
    outfit: "blouse, long skirt,", pose: "looking back, over the shoulder, upper body," },
];

// ---------- 既存行から土台を取る ----------
const base = (await readRange(cfg.sheet.id, `${TAB}!A4:S4`))[0] ?? [];
const at = (c) => base[COLS.indexOf(c)] ?? "";
const person = at("D"), face = at("E"), body = at("J"), place = at("N");

if (!person || !face || !place) {
  console.error("4行目から土台の値を取得できませんでした。シート構成を確認してください。");
  process.exit(1);
}

// ---------- 書き込み開始行を決める ----------
const qcol = await readRange(cfg.sheet.id, `${TAB}!Q1:Q400`);
let lastRow = 0;
qcol.forEach((r, i) => { if ((r[0] ?? "").trim()) lastRow = i + 1; });
const startRow = lastRow + 1;
log(`既存の最終行: ${lastRow} → ${startRow}行目から追加`);

// ---------- 行を組み立てる ----------
// 列順: A B C D E F G H I J K L M N O P Q R S
const values = PORTRAITS.map((p, i) => {
  const r = startRow + i;
  const q = `=$C$2&D${r}&E${r}&F${r}&H${r}&I${r}&J${r}&K${r}&G${r}&L${r}&M${r}&N${r}&O${r}&P${r}`;
  return [
    "非エロ",       // A 分類
    "ポートレート",  // B 衣装メモ
    p.scene,        // C シーン
    person,         // D 人物
    face,           // E 顔・髪型
    p.expr,         // F 表情
    "",             // G 肌
    p.outfit,       // H 服装
    "",             // I 下着など
    body,           // J 体形
    p.pose,         // K ポーズ・構図
    "",             // L 相手（空 = 単体カットになる）
    "",             // M 行為（空）
    place,          // N 場所
    "",             // O 効果音
    "",             // P 雰囲気（nsfwを入れない）
    q,              // Q まとめ（数式）
    1,              // R 参考枚数
    "サムネ・プロフィール用",  // S メモ
  ];
});

console.log(`\n追加する ${values.length}行（${startRow}〜${startRow + values.length - 1}行目）\n`);
values.forEach((v, i) => {
  console.log(`  ${startRow + i}行目: ${v[2]}`);
  console.log(`    表情: ${v[5]}`);
  console.log(`    服装: ${v[7]}`);
  console.log(`    構図: ${v[10]}`);
  console.log(`    相手/行為/雰囲気: 空`);
});

if (dry) {
  log("--dry のため書き込んでいません。");
  process.exit(0);
}

const range = `${TAB}!A${startRow}:S${startRow + values.length - 1}`;
const res = await writeRange(cfg.sheet.id, range, values);
log(`書き込み完了: ${res.updatedRange}（${res.updatedCells}セル）`);

// 数式がちゃんと展開されたか確認する
const check = await readRange(cfg.sheet.id, `${TAB}!Q${startRow}:Q${startRow + values.length - 1}`);
const ok = check.filter((r) => (r[0] ?? "").length > 200).length;
log(`Q列の自動生成を確認: ${ok}/${values.length}行`);
if (ok > 0) console.log(`\nQ${startRow}の中身:\n${String(check[0][0]).slice(0, 300)}...`);
