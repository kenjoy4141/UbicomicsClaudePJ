/**
 * 画像のSDプロンプトから「サムネ選びに効きそうな特徴」を取り出す。
 * 学習（過去に選ばれたものの傾向）と、初回のヒューリスティック両方で使う。
 */
import path from "node:path";
import { readPngPrompt, findSourceImage } from "./describe.js";
import { readJson, ROOT } from "./lib.js";

const MAP = readJson(path.join(ROOT, "config/describe-map.json"));

// サムネとして「映える」要素。BOOTHの審査を考えて、露出が強すぎるものは下げる。
const POSITIVE = {
  "looking at viewer": 3,
  "upper body": 3,
  "portrait": 3,
  "face focus": 3,
  "cowboy shot": 2,
  "smile": 2,
  "blush": 1,
  "standing": 1,
  "dynamic angle": 1,
};
const NEGATIVE = {
  nude: -4,
  "completely nude": -5,
  "spread legs": -5,
  cum: -5,
  pussy: -5,
  fellatio: -5,
  "sex ": -4,
  penis: -5,
  "close-up": -2,
  "from behind": -2,
  "pov": -1,
};

/** 1枚ぶんの特徴を取り出す */
export function extractFeatures(file) {
  const src = findSourceImage(file);
  if (!src) return null;
  const prompt = readPngPrompt(src);
  if (!prompt) return null;

  const clean = prompt.replace(/<[^>]*>/g, " ").toLowerCase();
  const tags = new Set();

  for (const [cat, dict] of Object.entries(MAP)) {
    if (cat.startsWith("_")) continue;
    for (const [en, ja] of Object.entries(dict)) {
      if (clean.includes(en)) tags.add(`${cat}:${ja}`);
    }
  }
  for (const k of Object.keys(POSITIVE)) if (clean.includes(k)) tags.add(`cue:${k}`);
  for (const k of Object.keys(NEGATIVE)) if (clean.includes(k)) tags.add(`cue:${k}`);

  return { file, prompt: clean, tags: [...tags] };
}

/** 学習データ抜きの素点。露出が強いものを避け、顔が見える構図を上げる */
export function baseScore(feat) {
  let s = 0;
  for (const [k, v] of Object.entries(POSITIVE)) if (feat.prompt.includes(k)) s += v;
  for (const [k, v] of Object.entries(NEGATIVE)) if (feat.prompt.includes(k)) s += v;
  // 服を着ている構図は枠を重ねやすいので少し加点
  const hasOutfit = feat.tags.some((t) => t.startsWith("outfit:"));
  if (hasOutfit) s += 2;
  return s;
}

/**
 * 過去に選ばれたサムネのタグから重みを作る。
 * 選ばれた回数が多いタグほど加点される。データが無ければ全部0。
 */
export function learnedWeights(choices) {
  const w = {};
  const picks = choices.filter((c) => c.imageTags?.length);
  if (picks.length === 0) return { weights: w, samples: 0 };
  for (const c of picks) {
    for (const t of c.imageTags) w[t] = (w[t] ?? 0) + 1;
  }
  // 出現回数を「1件あたりの平均」に均す
  for (const k of Object.keys(w)) w[k] = w[k] / picks.length;
  return { weights: w, samples: picks.length };
}

export function scoreWith(feat, weights, strength) {
  let s = baseScore(feat);
  for (const t of feat.tags) s += (weights[t] ?? 0) * strength;
  return s;
}

// ---- 露出レベルによる絞り込み ----
// プロフィールカードは商品ページの顔になるので、どこまで許容するかを選べるようにする。

/** 体を覆う衣類。これが1つでもあれば「着衣」とみなす */
const COVERED_OUTFIT = [
  "lab coat", "white coat", "blazer", "fitted blazer", "pencil skirt", "long skirt",
  "miniskirt", "sweater", "cardigan", "blouse", "dress shirt", "suit", "business suit",
  "yukata", "kimono", "apron", "nurse uniform", "maid outfit", "gym uniform",
  "gakuran", "turtleneck", "hoodie", "jacket", "coat", "dress", "uniform",
  // 作品が増えて出てきた服装（ヨガ・宅配・バー・旅館など）。これが無いと「着衣なのに着衣と見なされない」
  "sports bra", "tank top", "crop top", "leggings", "bike shorts", "shorts",
  "polo shirt", "vest", "tunic", "haori", "hakama", "juban", "camisole",
  "bathrobe", "loungewear", "sweatshirt", "knit", "obi", "cap",
];

/** 全裸・脱衣を示す語 */
const FULL_NUDE = ["nude", "naked", "topless", "bottomless", "undressed", "bare breasts", "exposed breasts"];

/**
 * 水着・下着。
 * 「bra」は "sports bra"（スポーツブラ＝着衣）に含まれてしまうので、単独の語のときだけ下着とみなす。
 */
const SWIM_UNDER = ["bikini", "micro bikini", "swimsuit", "school swimsuit", "lingerie", "underwear", "panties"];
const isUnderwear = (p) => SWIM_UNDER.some((w) => p.includes(w)) || /(?<!sports )\bbra\b/.test(p);

/** 直接的な行為 */
const EXPLICIT_ACT = ["spread legs", "cum", "pussy", "fellatio", "penis", "sex ", "handjob", "paizuri"];

/**
 * 相手が写り込む・密着している構図。
 * プロフィールカードはその子単体を見せるものなので、これらは除外する。
 */
// 注意: "onee-shotacon" は全プロンプトの固定接頭辞に入っているため判定に使えない。
// 実際に相手が写るかどうかは、シートのL列(相手)由来の語と接触の描写で見る。
const WITH_PARTNER = [
  "black-haired boy", "1 boy", "young boy",
  "kiss", "hug", "embrace", "cuddle", "carrying",
  "arms around", "holding hands", "cheek to cheek", "two shot",
];

export function isSolo(feat) {
  return !WITH_PARTNER.some((w) => feat.prompt.includes(w));
}

/**
 * level:
 *   strict … きちんと服を着ているものだけ（水着・下着も除外）
 *   modest … 全裸と直接的な行為を除外。水着・下着は許容
 *   any    … 制限なし
 */
export function passesClothingLevel(feat, level) {
  const p = feat.prompt;
  if (level === "any") return true;
  if (EXPLICIT_ACT.some((w) => p.includes(w))) return false;
  if (FULL_NUDE.some((w) => p.includes(w))) return false;
  if (level === "modest") return true;
  // strict
  if (isUnderwear(p)) return false;
  return COVERED_OUTFIT.some((w) => p.includes(w));
}

export function countByLevel(feats) {
  return {
    strict: feats.filter((f) => passesClothingLevel(f, "strict")).length,
    modest: feats.filter((f) => passesClothingLevel(f, "modest")).length,
    any: feats.length,
  };
}
