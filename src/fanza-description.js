/**
 * FANZAに出すときの作品コメントをテキストファイルにする（00_表紙/NNN作品コメント.txt）。
 *
 *   node src/fanza-description.js --title "30日後にS○Xする女医さん" --tab fanza_500
 *
 * 構成: 作品構成（目次・総ページ数）/ キャラクター（プロフィール）/ ストーリー / アピールポイント / 注意書き
 * - 目次は fanza-extras.js が書いた _work/toc.json を使う（無ければ先に extras を回す）
 * - キャラは作品データ（プロフィール・相手の名前）、ストーリーとアピールは config/fanza-toc.json のタブ設定
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson, render, log, ROOT } from "./lib.js";
import { loadWork } from "./work.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const title = opt("title");
const tab = opt("tab", "fanza_500");
if (!title) {
  console.error('使い方: node src/fanza-description.js --title "作品名" --tab fanza_500');
  process.exit(1);
}
const T = readJson(path.join(ROOT, "config/fanza-toc.json"))[tab];
const work = loadWork(title);
const workDir = work?.fanza?.workDir;
if (!T || !work || !workDir || !fs.existsSync(workDir)) {
  console.error("タブ設定・作品データ・作品フォルダのどれかが見つかりません");
  process.exit(1);
}
const no = path.basename(workDir).slice(0, 3);
const tocFile = path.join(workDir, "_work", "toc.json");
if (!fs.existsSync(tocFile)) {
  console.error(`目次データがありません。先に node src/fanza-extras.js --title "${title}" --tab ${tab} を実行してください`);
  process.exit(1);
}
const toc = readJson(tocFile);
const pages = fs.readdirSync(path.join(workDir, "01_本編")).filter((f) => /\.jpg$/i.test(f)).length;

const heroine = work.heroine;
const doc = heroine.includes(" ") ? heroine.split(" ").pop() : heroine;
const vars = { docFull: heroine, doc, pat: work.hero };
const P = work.profile ?? {};
const D = T.dialogue ? readJson(path.join(ROOT, T.dialogue)) : {};

const hr = "━━━━━━━━━━━━━━━━━━━━";
const out = [];
const section = (name) => out.push("", hr, `■ ${name}`, hr);

out.push(`【${title}】`);
out.push("", render(T.setup ?? D.setup ?? "", vars));

section("作品構成");
out.push(`本編：全${pages}ページ（JPG）`, "", "＜目次＞");
const numW = Math.max(...toc.lines.map(([p]) => `p${p}`.length));
for (const [p, name] of toc.lines) out.push(`${`p${p}`.padStart(numW, " ")}〜 ${name}`);

section("キャラクター");
out.push(`◆ ${heroine}`);
const prof = [
  ["年齢", P.age ?? T.age], ["職業", P.job ?? T.job],
  ["身長", P.height && `${P.height}cm`], ["スリーサイズ", P.bwh],
  ["誕生日", P.birthday], ["血液型", P.blood],
  ["趣味", P.hobby], ["好きな食べ物", P.food], ["好きなタイプ", P.type],
].filter(([, v]) => v);
for (const [k, v] of prof) out.push(`${k}：${v}`);
if (P.personality) out.push("", P.personality);
if (P.hook) out.push(P.hook);
out.push("", `◆ ${work.hero}`, "社会人。本作の主人公。");

section("ストーリー");
for (const line of T.story ?? []) out.push(render(line, vars));

section("アピールポイント");
for (const line of T.appeal ?? []) out.push(`・${render(line, vars)}`);

section("ご注意");
out.push(
  "・本作品は画像生成AI（Stable Diffusion）を使用して制作し、加筆・修正を行っています。",
  "・登場人物はすべて成人（20歳以上）です。",
  "・本作品はフィクションです。実在の人物・団体とは関係ありません。",
  "・画像の一部に、手や指などの細部で不自然な描写が含まれる場合があります。",
);

const file = path.join(workDir, "00_表紙", `${no}作品コメント.txt`);
fs.mkdirSync(path.dirname(file), { recursive: true });
// メモ帳でも文字化けしないよう BOM 付き UTF-8・CRLF で保存する
fs.writeFileSync(file, "﻿" + out.join("\r\n") + "\r\n", "utf8");
log(`作品コメント: ${file}（${out.length}行）`);
