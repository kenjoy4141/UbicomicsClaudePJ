/**
 * BOOTH商品紹介文の「■ストーリー」を作る。ラブコメ仕立て。
 *
 *   node src/story.js --title "放課後の保健室の先生" --scene infirmary
 *   node src/story.js --title "..." --scene infirmary --heroine "白瀬 詩織" --hero "優太"
 *   node src/story.js --title "..." --scene infirmary --out logs/story.txt
 *
 * 決めた登場人物は data/works/<タイトル>.json に保存され、
 * プロフィールカード（profile.js --work）と共有される。
 */
import fs from "node:fs";
import path from "node:path";
import { readJson, render, log, ROOT } from "./lib.js";
import { ensureCast, saveWork } from "./work.js";

const S = readJson(path.join(ROOT, "config/story.json"));
const N = readJson(path.join(ROOT, "config/names.json"));
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const title = opt("title");
if (!title) {
  console.error('使い方: node src/story.js --title "作品タイトル" --scene infirmary');
  process.exit(1);
}

const sceneKey = opt("scene");
const scene = S.scenes[sceneKey] ?? S.fallback;
if (sceneKey && !S.scenes[sceneKey]) {
  log(`! シーン「${sceneKey}」の雛形がないので汎用のものを使います（利用可能: ${Object.keys(S.scenes).join(", ")}）`);
}

const cast = ensureCast(title, {
  heroine: opt("heroine"),
  hero: opt("hero"),
  names: N,
  story: S,
});

if (sceneKey) saveWork(title, { scene: sceneKey });

const vars = { heroine: cast.heroine, hero: cast.hero };
// 本文中で毎回フルネームだと硬いので、2回目以降は下の名前だけにする
const given = cast.heroine.includes(" ") ? cast.heroine.split(" ").pop() : cast.heroine;
let seen = 0;
const body = scene.body.replace(/{{heroine}}/g, () => (++seen === 1 ? "{{heroine}}" : "{{given}}"));

const text = [render(scene.catch, vars), "", render(body, { ...vars, given })].join("\n");

const out = opt("out", path.join(ROOT, "logs/story.txt"));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, text, "utf8");

console.log(`\nヒロイン: ${cast.heroine}`);
console.log(`主人公  : ${cast.hero}`);
console.log(`シーン  : ${sceneKey ?? "(汎用)"}\n`);
console.log("─".repeat(50));
console.log(text);
console.log("─".repeat(50));
log(`\n書き出しました: ${out}`);
log(`登場人物を保存: data/works/${title}.json`);
console.log("\nBOOTHに渡すとき: node src/booth-draft.js ... --story-file \"" + out + "\"");
