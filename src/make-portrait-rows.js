/**
 * サムネ・プロフィールカード用の「単体・着衣・ポートレート」行を作る。
 *
 * 今のシートは全100行が「相手あり・水着/全裸」で埋まっているため、
 * 商品ページの顔に使えるカットが構造的に存在しない。
 * この行を数行足すと、以降の全作品で自動的にまともな候補が手に入る。
 *
 *   node src/make-portrait-rows.js            … 画面に出す
 *   node src/make-portrait-rows.js --out rows.tsv
 *
 * 出力は2種類:
 *   1. 列ごとの値（Q列が数式の場合、各列に貼ればQが自動で組まれる）
 *   2. 組み立て済みのQ列文字列（Q列が直打ちの場合、そのまま貼れる）
 */
import fs from "node:fs";
import { loadConfig, log } from "./lib.js";
import { loadSheetRows } from "./sheet-data.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const outFile = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;

// ---------- シートから土台を取る ----------
const rows = await loadSheetRows(cfg);
const r0 = rows[cfg.sheet.firstRow - 1];

const q4 = (r0?.[cfg.sheet.promptCol] ?? "").trim();
const person = (r0?.[3] ?? "").trim();     // D列 人物
const face = (r0?.[4] ?? "").trim();       // E列 顔・髪型
const place = (r0?.[cfg.sheet.placeCol] ?? "").trim(); // N列 場所

// 固定接頭辞（score_9 ... onee-shotacon, まで）を取り出す
const marker = "onee-shotacon,";
const prefix = q4.includes(marker) ? q4.slice(0, q4.indexOf(marker) + marker.length) : "";
if (!prefix) {
  console.error("固定接頭辞を取り出せませんでした。シートの構成が変わった可能性があります。");
  process.exit(1);
}

// ---------- 追加する行 ----------
// 相手なし・着衣・顔が見える構図だけ。行為やnsfwは入れない。
const PORTRAITS = [
  {
    scene: "正面バストアップ",
    expr: "gentle smile, looking at viewer,",
    outfit: "blouse, cardigan, pencil skirt,",
    pose: "upper body, standing, front view, hands together,",
  },
  {
    scene: "斜め立ち",
    expr: "calm expression, looking at viewer,",
    outfit: "blouse, long skirt,",
    pose: "cowboy shot, standing, hand on hip, three quarter view,",
  },
  {
    scene: "微笑み・小首",
    expr: "soft smile, head tilt, looking at viewer,",
    outfit: "knit sweater, long skirt,",
    pose: "upper body, standing, arms at sides,",
  },
  {
    scene: "座り",
    expr: "relaxed expression, looking at viewer,",
    outfit: "blouse, pencil skirt, cardigan,",
    pose: "sitting on chair, legs together, cowboy shot,",
  },
  {
    scene: "振り向き",
    expr: "surprised expression, looking at viewer,",
    outfit: "blouse, long skirt,",
    pose: "looking back, over the shoulder, upper body,",
  },
];

const built = PORTRAITS.map((p) => ({
  ...p,
  q: `${prefix}${person}${face}${p.expr}${p.outfit}${p.pose}${place}`,
}));

// ---------- 出力 ----------
console.log("追加する行（相手なし・着衣・ポートレート）\n");
console.log("【1】列ごとの値 — Q列が数式なら、各列にこれを貼る");
console.log("（人物D・顔髪E・場所N は既存行と同じ値を使う。相手L・行為M・雰囲気P は空にする）\n");
const header = ["シーン(C)", "表情(F)", "服装(H)", "ポーズ・構図(K)", "相手(L)", "行為(M)", "雰囲気(P)"];
console.log(header.join("\t"));
for (const b of built) {
  console.log([b.scene, b.expr, b.outfit, b.pose, "", "", ""].join("\t"));
}

console.log("\n\n【2】組み立て済みのQ列 — Q列が直打ちなら、これをそのまま貼る\n");
built.forEach((b, i) => console.log(`--- ${i + 1}. ${b.scene} ---\n${b.q}\n`));

if (outFile) {
  const tsv = [header.join("\t"), ...built.map((b) => [b.scene, b.expr, b.outfit, b.pose, "", "", ""].join("\t"))].join("\n");
  fs.writeFileSync(outFile, tsv + "\n\n" + built.map((b) => b.q).join("\n"), "utf8");
  log(`書き出しました: ${outFile}`);
}

console.log("※ 相手・行為・nsfw は入れていないので、着衣の単体カットになります。");
console.log("※ E列(顔・髪型)と N列(場所) は既存と同じ文字列なので、キャラ差し替えもシーン差し替えもそのまま効きます。");
