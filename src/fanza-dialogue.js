/**
 * FANZA作品の導入シーンに付けるセリフを、吹き出しツール用の bubbles.csv にする。
 *
 *   node src/fanza-dialogue.js --title "30日後にS○Xする女医さん" --out <作業フォルダ>/bubbles.csv
 *   node src/fanza-dialogue.js --title "..." --out ... --doc "如月 真央" --pat "航平"
 *
 * - シートの A列が「非エロ」の区切りを導入シーンとみなす（生成順に 001.jpg から番号を振る）
 * - 1つ目の区切り＝前半（1〜15日目）、2つ目＝後半（16〜30日目）
 * - 女医のセリフはピンク、患者はブルー
 * - 登場人物の名前は data/works/<作品名>.json に保存し、表紙や説明文と揃える
 *
 * 出力の列は manga_bubble/add_bubbles.py の形式:
 *   filename, day, text1, pos1, color1, text2, pos2, color2, text3, pos3, color3
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson, render, log, ROOT } from "./lib.js";
import { readRange } from "./sheets.js";
import { ensureCast, loadWork, saveWork } from "./work.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

// --variant を渡すと、共通のひな形 + その作品の単語（config/variants/<名前>.json の words）で組み立てる。
// --dialogue は作品ごとに手で書いたセリフ集を直接指定する（016/017 はこちら）
const variantName = opt("variant");
const V = variantName ? readJson(path.join(ROOT, "config/variants", `${variantName}.json`)) : null;
// 作品定義にセリフ集の指定（玄関シリーズなど）があればそれを使い、無ければ共通のひな形
const defaultDialogue = V
  ? (opt("lang", "ja") === "en"
    ? (V.dialogueEn ?? "config/fanza-dialogue-template-en.json")
    : (V.dialogue ?? "config/fanza-dialogue-template.json"))
  : "config/fanza-dialogue.json";
const D = readJson(path.resolve(ROOT, opt("dialogue", defaultDialogue)));
const N = readJson(path.join(ROOT, "config/names.json"));
const S = readJson(path.join(ROOT, "config/story.json"));

const title = opt("title");
const out = opt("out");
const tab = opt("tab", "fanza_500");
if (!title || !out) {
  console.error('使い方: node src/fanza-dialogue.js --title "作品名" --out <bubbles.csv>');
  process.exit(1);
}

// ---------- 登場人物 ----------
// --lang en: Patreon英語版。名前は作品データの heroineEn / heroEn（"Ayane Shirase" の順）を使い、
// 日本語版の作品データ（登場人物・CSVの場所）は書き換えない
const lang = opt("lang", "ja");
let docFull, doc, pat;
if (lang === "en") {
  const w = loadWork(title);
  if (!w?.heroine || !w?.hero) {
    console.error(`先に日本語版のセリフを作ってください（登場人物が決まっていません）: data/works/${title}.json`);
    process.exit(1);
  }
  // 英語名が無ければ、読み一覧（config/patreon-en.json の readings）から「名 姓」の順で作って保存する
  if (!w.heroineEn || !w.heroEn) {
    const readings = readJson(path.join(ROOT, "config/patreon-en.json")).readings ?? {};
    const romaji = (ja) => readings[ja] ?? null;
    const [sei, mei] = w.heroine.split(" ");
    const heroineEn = mei && romaji(sei) && romaji(mei) ? `${romaji(mei)} ${romaji(sei)}` : null;
    const heroEn = romaji(w.hero);
    if (!heroineEn || !heroEn) {
      console.error(`英語名を作れません（読みが未登録）: ${w.heroine} / ${w.hero}。作品データの heroineEn / heroEn に直接書いてください`);
      process.exit(1);
    }
    Object.assign(w, saveWork(title, { heroineEn, heroEn }));
    log(`英語名を決めました: ${heroineEn} / ${heroEn}`);
  }
  docFull = w.heroineEn;
  doc = docFull.split(" ")[0];
  pat = w.heroEn;
} else {
  const cast = ensureCast(title, { heroine: opt("doc"), hero: opt("pat"), names: N, story: S });
  docFull = cast.heroine;
  doc = docFull.includes(" ") ? docFull.split(" ").pop() : docFull;
  pat = cast.hero;
}
// ひな形の {{place}} などは、その作品の words から入れる
const vars = { docFull, doc, pat, ...(V?.words ?? {}) };
// シーン名を変えている作品（sceneRename）は、ひな形を引くときに元の名前へ戻す
const sceneBack = Object.fromEntries(Object.entries(V?.sceneRename ?? {}).map(([from, to]) => [to, from]));

// ---------- 導入シーンの行を、生成順の画像番号に対応づける ----------
const rows = await readRange(cfg.sheet.id, `${tab}!A1:S1000`);
const blocks = [];
let imageNo = 0;
let current = null;
for (let i = 3; i < rows.length; i++) {
  const r = rows[i] ?? [];
  if (!String(r[16] ?? "").trim()) continue; // Q列が空の行は生成対象外
  const label = String(r[0] ?? "").trim();
  if (label) current = label.includes("非エロ") ? { rows: [] } : null;
  if (current && label) blocks.push(current);
  const count = Number(r[17]) || 1;
  if (current) {
    for (let k = 0; k < count; k++) {
      current.rows.push({
        row: i + 1, scene: String(r[2] ?? "").trim(), nth: k, image: imageNo + k + 1,
        outfit: String(r[7] ?? "").toLowerCase(), underwear: String(r[8] ?? "").toLowerCase(),
      });
    }
  }
  imageNo += count;
}

if (blocks.length === 0) {
  console.error("A列が「非エロ」の区切りが見つかりません");
  process.exit(1);
}

// ---------- ストーリーボードがある作品は、そこから直に割り当てる ----------
// 絵の指定とセリフが同じビートから出るので、場面とセリフがズレない
if (V?.introStoryboard) {
  const { buildIntro } = await import("./intro-rows.js");
  const { beats } = buildIntro(V);
  const POSb = ["top-right", "bottom-left", "bottom-right"];
  const COLORb = { doc: "pink", pat: "blue", narr: "white" };
  const rows = [];
  const preview = [];
  // 導入はコマ割りにする（1ビート=4枚 → 2コマのページ2枚）。
  // ページ1に lines、ページ2に lines2。30日目の締めだけナレーションを足す。
  // コマ割りをしない作品（imagesPerBeat が 2）は、従来どおり1枚1ページ。
  const perBeat = beats[0]?.images ?? 2;
  const panels = perBeat >= 4 ? 2 : 1;                 // 1ページに入れるコマ数
  let page = 0;
  for (const b of beats) {
    const groups = panels === 2
      ? [b.lines, b.lines2 ?? []]                      // 2ページ（各2コマ）
      : Array.from({ length: b.images }, (_, k) => (k === 0 ? b.lines : (b.lines2 ?? null)));
    groups.forEach((lines, gi) => {
      page += 1;
      const row = { filename: `${String(page).padStart(3, "0")}.jpg`, day: String(b.day) };
      (lines ?? []).slice(0, 2).forEach(([who, text], j) => {
        row[`text${j + 1}`] = render(text, vars);
        row[`pos${j + 1}`] = j === 0 ? "top-right" : "bottom-left";
        row[`color${j + 1}`] = COLORb[who] ?? "white";
      });
      const last = gi === groups.length - 1;
      if (last && b.narration) {
        const k = Math.min((lines ?? []).length + 1, 3);
        row[`text${k}`] = render(b.narration, vars);
        row[`pos${k}`] = "bottom-right";
        row[`color${k}`] = "white";
      }
      rows.push(row);
      preview.push(`${row.filename}  ${String(b.day).padStart(2)}日目  [${b.scene}]  ` +
        [row.text1, row.text2, row.text3].filter(Boolean).map((t) => `「${t.replace(/　/g, "")}」`).join(" "));
    });
  }
  const header2 = ["filename", "day", "text1", "pos1", "color1", "text2", "pos2", "color2", "text3", "pos3", "color3"];
  const esc2 = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, "﻿" + [header2.join(","), ...rows.map((r) => header2.map((h) => esc2(r[h])).join(","))].join("\n"), "utf8");
  fs.writeFileSync(out.replace(/\.csv$/i, "") + ".swap.json", JSON.stringify({ swap: null }, null, 2), "utf8");
  if (lang !== "en") {
    saveWork(title, { fanza: { ...(loadWork(title)?.fanza ?? {}), dialogueCsv: path.resolve(out), introImages: rows.length } });
  }
  console.log(`\nヒロイン: ${docFull}（${doc}）/ 相手: ${pat}`);
  console.log(`導入シーン: ${rows.length}枚（ストーリーボード ${beats.length}日ぶん）\n`);
  preview.forEach((p) => console.log("  " + p));
  log(`\n書き出しました: ${out}`);
  process.exit(0);
}

// ---------- セリフを割り当てる ----------
const POS = ["top-right", "bottom-left", "center-left"];
const COLOR = { doc: "pink", pat: "blue", narr: "white" };
const csvRows = [];
const preview = [];

// 締めのナレーション（全作品共通。セリフ集に afterword があればそちらを優先）
const AFTERWORD = {
  text: "このあと　めちゃくちゃ　S〇Xした",
  pos: "bottom-right",
  preferScenes: ["下着になる", "下着になる　サイド"],
  ...(D.afterword ?? {}),
};

// まず全コマに通常のセリフを割り当てる
const used = {};
const items = [];
blocks.slice(0, 2).forEach((block, b) => {
  const half = b === 0 ? "early" : "late";
  const dayStart = b === 0 ? 1 : 16;
  const days = 15;
  block.rows.forEach((item, k) => {
    const day = dayStart + Math.floor((k * days) / block.rows.length);
    const lookup = D.scenes[item.scene] ? item.scene : (sceneBack[item.scene] ?? item.scene);
    const sets = D.scenes[lookup]?.[half] ?? D.fallback[half];
    const key = half + "|" + item.scene;
    const n = used[key] = (used[key] ?? -1) + 1;
    items.push({ ...item, half, day, lines: sets[n % sets.length] });
  });
});

// 30日目の最後のページ: できればヒロインの下着姿のコマを最後に持ってきて、締めのセリフ＋ナレーションを付ける。
// 下着姿のコマと元の最後のコマは画像ごと入れ替える（入れ替えは fanza-build.js が swap.json を見て行う）
// シーン名は当てにならない（「下着になる」でもセーター姿の行がある）ので、I列（下着）とH列（服装）で選ぶ。
// 優先: 下着だけの行（服装が空）の後半 → 前半 → 下着がある行の後半 → シーン名 → 最後のコマのまま
const last = items[items.length - 1];
const isUnderwear = (it) => /\b(bra|panties|lingerie|underwear)\b/.test(it.underwear + " " + it.outfit);
const rev = [...items].reverse();
const target =
  rev.find((it) => isUnderwear(it) && !it.outfit.trim() && it.half === "late") ??
  rev.find((it) => isUnderwear(it) && !it.outfit.trim()) ??
  rev.find((it) => isUnderwear(it) && it.half === "late") ??
  rev.find((it) => it.half === "late" && AFTERWORD.preferScenes.includes(it.scene)) ??
  last;
let swap = null;
if (target !== last) {
  swap = [target.image, last.image];
  // 入れ替わりで target の位置に来るコマには、その位置（前半/後半）に合ったセリフを付ける
  target.lines = target.half === last.half
    ? last.lines
    : (D.scenes[sceneBack[last.scene] ?? last.scene]?.[target.half]?.[0] ?? D.fallback[target.half][0]);
  [target.scene, last.scene] = [last.scene, target.scene];
}
last.lines = [...(D.finale ?? []).slice(0, 2), ["narr", AFTERWORD.text]];
last.narrPos = AFTERWORD.pos;

for (const item of items) {
  const row = { filename: `${String(item.image).padStart(3, "0")}.jpg`, day: String(item.day) };
  item.lines.slice(0, 3).forEach(([who, text], j) => {
    row[`text${j + 1}`] = render(text, vars);
    row[`pos${j + 1}`] = who === "narr" && item.narrPos ? item.narrPos : POS[j];
    row[`color${j + 1}`] = COLOR[who] ?? "white";
  });
  csvRows.push(row);
  const label = { doc: "ヒロイン", pat: "相手", narr: "ナレーション" };
  preview.push(`${row.filename}  ${String(item.day).padStart(2)}日目  [${item.scene}]  ` +
    item.lines.map(([who, text]) => `${label[who] ?? who}「${render(text, vars).replace(/　/g, "")}」`).join(" "));
}

// ---------- 書き出し ----------
const header = ["filename", "day", "text1", "pos1", "color1", "text2", "pos2", "color2", "text3", "pos3", "color3"];
const esc = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, "\ufeff" + [header.join(","), ...csvRows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n"), "utf8");

// 入れ替える画像番号。fanza-build.js が吹き出しを付ける前に画像を入れ替える
fs.writeFileSync(out.replace(/\.csv$/i, "") + ".swap.json", JSON.stringify({ swap }, null, 2), "utf8");
if (swap) log(`最後のページ: ${String(swap[0]).padStart(3, "0")}.jpg（下着姿）を ${String(swap[1]).padStart(3, "0")}.jpg と入れ替え`);

if (lang !== "en") {
  saveWork(title, { fanza: { ...(loadWork(title)?.fanza ?? {}), dialogueCsv: path.resolve(out), introImages: csvRows.length } });
}

console.log(`\nヒロイン: ${docFull}（${doc}）/ 相手: ${pat}`);
console.log(`導入シーン: ${csvRows.length}枚（区切り ${blocks.length}つ）\n`);
preview.forEach((p) => console.log("  " + p));
log(`\n書き出しました: ${out}`);
