/**
 * 生成済みフォルダのSDプロンプトを集計して、BOOTH向けの作品タイトル候補を出す。
 * BOOTHはアダルト表現に厳しいので、性的な語は一切使わず
 * 「女性の役柄」と「シチュエーション・場所」だけで組み立てる。
 *
 *   node src/suggest-title.js "<画像フォルダ>"
 */
import fs from "node:fs";
import path from "node:path";
import { readPngPrompt, findSourceImage } from "./describe.js";
import { readJson, ROOT } from "./lib.js";

const MAP = readJson(path.join(ROOT, "config/describe-map.json"));
const dir = process.argv[2];
if (!dir) {
  console.error('使い方: node src/suggest-title.js "<画像フォルダ>"');
  process.exit(1);
}

const files = fs
  .readdirSync(dir)
  .filter((n) => /\.(png|jpe?g|webp)$/i.test(n))
  .map((n) => path.join(dir, n));

if (files.length === 0) {
  console.error("画像がありません: " + dir);
  process.exit(1);
}

const tally = { role: {}, place: {}, outfit: {}, hairColor: {}, hairStyle: {} };
let read = 0;

for (const f of files) {
  const src = findSourceImage(f);
  if (!src) continue;
  const prompt = readPngPrompt(src);
  if (!prompt) continue;
  read++;

  const clean = prompt.replace(/<[^>]*>/g, " ").toLowerCase();
  for (const cat of Object.keys(tally)) {
    for (const [en, ja] of Object.entries(MAP[cat] ?? {})) {
      if (clean.includes(en)) tally[cat][ja] = (tally[cat][ja] ?? 0) + 1;
    }
  }
}

console.log(`${read}/${files.length}枚からプロンプトを読み取りました\n`);

const top = (obj, n = 5) =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);

const GENERIC_ROLE = ["大人の女性", "熟女"];

for (const [cat, label] of [["role", "役柄"], ["place", "場所"], ["outfit", "服装"]]) {
  const t = top(tally[cat]);
  console.log(`${label}: ${t.map(([k, n]) => `${k}(${n})`).join(" / ") || "なし"}`);
}

// --- タイトル候補 ---

/** 包含関係のある語を落とす（ワンルームがあれば「部屋」は捨てる）*/
function dedupe(list) {
  return list.filter((a) => !list.some((b) => b !== a && b.includes(a)));
}

const roles = dedupe(top(tally.role, 8).map(([k]) => k).filter((r) => !GENERIC_ROLE.includes(r)));
const places = dedupe(top(tally.place, 8).map(([k]) => k));
const role = roles[0] ?? top(tally.role, 1).map(([k]) => k)[0] ?? "お姉さん";
const place = places[0];

console.log("\nタイトル候補:");
const seen = new Set();
const push = (s) => {
  if (s && !seen.has(s) && s.length <= 20) {
    seen.add(s);
    console.log("  " + s);
  }
};

if (place) {
  push(`${role}の${place}でふたりきり`);
  push(`${place}で${role}とふたりきり`);
  push(`となりの${role}の${place}`);
  push(`${role}と${place}で過ごす休日`);
}
push(`${role}とふたりきりの休日`);
push(`${role}と過ごす夜`);
for (const r of roles.slice(1, 3)) push(`${r}とふたりきり`);

console.log("\n※ そのまま使わず、しっくりくるものを選ぶか手直ししてください。");
console.log("※ BOOTHの規約上、性的表現を含む語は避けています。");
