/**
 * PNG に埋め込まれた Stable Diffusion のプロンプトを読み、
 * 女の子の外見的な特徴を日本語の一文にする。
 *
 * describe-map.json に載っている語だけを拾うホワイトリスト方式なので、
 * 辞書に無い語（性的表現を含む）は一切出力に混ざらない。
 *
 *   node src/describe.js "C:\path\to\image.png"
 */
import fs from "node:fs";
import path from "node:path";
import { readJson, ROOT } from "./lib.js";

const MAP = readJson(path.join(ROOT, "config/describe-map.json"));

/** PNG のテキストチャンクから "parameters"（A1111のプロンプト）を取り出す */
export function readPngPrompt(file) {
  const b = fs.readFileSync(file);
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  while (off < b.length - 8) {
    const len = b.readUInt32BE(off);
    const type = b.toString("ascii", off + 4, off + 8);
    if (type === "IEND") break;
    if (type === "tEXt" || type === "iTXt") {
      const raw = b.toString("utf8", off + 8, off + 8 + len);
      const nul = raw.indexOf("\u0000");
      const key = raw.slice(0, nul);
      if (key === "parameters") {
        // Negative prompt 以降は使わない
        return raw.slice(nul + 1).split("Negative prompt:")[0];
      }
    }
    if (type === "IDAT") break;
    off += 12 + len;
  }
  return null;
}

/**
 * モザイク後のファイルからモザイク前の同名ファイルを推測する。
 * 例: .../2026-07-25moza/00000-x.png → .../2026-07-25/00000-x.png
 */
export function findSourceImage(file) {
  if (readPngPrompt(file)) return file; // そのままメタデータを持っている
  const dir = path.dirname(file);
  const base = path.basename(file);
  const candidates = [
    dir.replace(/moza$/i, ""),
    dir.replace(/[（(]モザイク済[）)]$/i, ""),
    dir.replace(/mosaic$/i, ""),
  ];
  for (const c of candidates) {
    if (c === dir) continue;
    const p = path.join(c, base);
    if (fs.existsSync(p) && readPngPrompt(p)) return p;
  }
  return null;
}

/** 単語境界つきでトークンを含むか判定する（正規表現エスケープを避けるため手書き） */
function hasToken(hay, needle) {
  const isAlpha = (c) => c >= "a" && c <= "z";
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    const before = i === 0 ? " " : hay[i - 1];
    const after = i + needle.length >= hay.length ? " " : hay[i + needle.length];
    if (!isAlpha(before) && !isAlpha(after)) return true;
    i += needle.length;
  }
  return false;
}

/** プロンプト文字列から、辞書にある語だけを拾う */
function extract(prompt) {
  // 重み表記 (xxx:1.2) や lora タグを剥がして素のトークン列にする
  const clean = prompt
    .replace(/<[^>]*>/g, " ")
    .replace(/[()\[\]{}]/g, " ")
    .replace(/:\s*[\d.]+/g, " ")
    .toLowerCase();

  const found = {};
  for (const [category, dict] of Object.entries(MAP)) {
    if (category.startsWith("_")) continue;
    const hits = [];
    // 長い語を先に見て、短い語での誤検出を防ぐ（"long hair" を "hair" より先に）
    for (const en of Object.keys(dict).sort((a, b) => b.length - a.length)) {
      if (hasToken(clean, en) && !hits.includes(dict[en])) hits.push(dict[en]);
    }
    // 包含関係の除去: 「マイクロビキニ」が取れていれば「ビキニ」は冗長なので捨てる
    found[category] = hits.filter((h) => !hits.some((o) => o !== h && o.includes(h)));
  }
  return found;
}

/** 候補配列から、優先リストの順で最初に当たったものを返す */
function prefer(hits, priority) {
  for (const want of priority) if (hits.includes(want)) return want;
  return null;
}

// 髪型のうち「長さ・シルエット」を表す語。これを髪色と直結させる
const HAIR_LENGTH = ["ロング", "ミディアム", "ショート", "ボブ", "ポニーテール", "ツインテール",
  "サイドポニー", "三つ編み", "お団子", "姫カット", "巻き髪", "ウェーブヘア", "ストレート"];
// 目は「形」を色より優先する（垂れ目の方が特徴として強い）
const EYE_SHAPE = ["垂れ目", "つり目", "オッドアイ"];
// 役柄は具体的なものを優先し、汎用語は最後の砦
const ROLE_GENERIC = ["大人の女性", "お姉さん", "熟女"];
// 表情は連体形に変換して頭に付ける。「こちらを見つめる」は情報量が薄いので使わない
const EXPR_PREFIX = {
  "微笑み": "微笑む", "笑顔": "笑顔の", "頬を染めて": "頬を染めた",
  "恥ずかしそうな": "恥ずかしそうな", "緊張した表情": "緊張した",
};

/** 抽出結果を日本語の一文に組み立てる */
export function buildDescription(file) {
  const src = findSourceImage(file);
  if (!src) return null;
  const prompt = readPngPrompt(src);
  if (!prompt) return null;

  const f = extract(prompt);

  // 髪: 色 + 長さ を直結（「茶髪ミディアム」）。それ以外の髪型は別要素として後ろに回す
  const hairLen = prefer(f.hairStyle, HAIR_LENGTH);
  const hairExtra = f.hairStyle.filter((h) => h !== hairLen);
  const hair = [f.hairColor[0], hairLen].filter(Boolean).join("");

  const eye = prefer(f.eyes, EYE_SHAPE) ?? f.eyes[0];
  const role = f.role.find((r) => !ROLE_GENERIC.includes(r)) ?? f.role[0] ?? "女の子";
  const expr = prefer(f.expression, Object.keys(EXPR_PREFIX));

  // 「微笑む茶髪ミディアム・垂れ目の女教師」
  const looks = [hair, ...hairExtra.slice(0, 1), eye].filter(Boolean);
  const subject = (expr ? EXPR_PREFIX[expr] : "") +
    (looks.length ? looks.join("・") + "の" : "") + role;

  const sentences = [subject + "。"];
  const outfit = f.outfit.slice(0, 2).join("に");
  const place = f.place[0];
  if (outfit && place) sentences.push(outfit + "姿で" + place + "。");
  else if (outfit) sentences.push(outfit + "姿。");
  else if (place) sentences.push(place + "にて。");

  return { text: sentences.join(""), source: src, found: f };
}

// CLI として叩かれたとき
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const target = process.argv[2];
  if (!target) {
    console.error('使い方: node src/describe.js "C:\path\to\image.png"');
    process.exit(1);
  }
  const r = buildDescription(target);
  if (!r) {
    console.error("プロンプトを取得できませんでした（モザイク前の元画像が見つからない可能性）");
    process.exit(1);
  }
  console.log("元画像:", r.source);
  console.log("抽出  :", JSON.stringify(r.found, null, 1));
  console.log("\n説明文:", r.text);
}
