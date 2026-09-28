/**
 * FANZA作品の英語版（02_patreon_en/pages）から、Patreon投稿用の素材を一式作る。
 *
 *   node src/patreon-fanza-assets.js --title "30日後にS○Xする女医さん" --tab fanza_500
 *
 * 出力: <作品フォルダ>/02_patreon_en/
 *   cover_en.jpg        … 公開用カバー（着衣のヒロイン＋着衣の導入ページだけを背景に使う）
 *   profile_en.jpg      … プロフィールカード（英語）
 *   previews/           … 無料投稿用の見本（着衣・単体の導入ページ、英語の吹き出し付き）
 *   <slug>.pdf / .zip   … 有料投稿の添付（全ページ）
 *   post_premium_en.txt … $12向け本編投稿の本文
 *   post_free_en.txt    … 無料の見本投稿の本文（性的な語を入れない）
 *
 * 公開面（カバー・見本・無料投稿）はPatreonの規約上、ヌードや性的な内容を出せないので
 * 着衣判定（features.js の strict）＋単体＋透け表現なしのコマだけを使う。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readJson, render, log, ROOT } from "./lib.js";
import { loadWork, saveWork } from "./work.js";
import { extractFeatures, passesClothingLevel, isSolo } from "./features.js";
import { lintPrompt } from "./safety-lint.js";

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const title = opt("title");
const tab = opt("tab", "fanza_500");
if (!title) {
  console.error('使い方: node src/patreon-fanza-assets.js --title "作品名" --tab fanza_500');
  process.exit(1);
}
const T = readJson(path.join(ROOT, "config/fanza-toc.json"))[tab];
const V = T?.variant ? readJson(path.join(ROOT, "config/variants", `${T.variant}.json`)) : null;
const EN = readJson(path.join(ROOT, "config/patreon-en.json")).profile;
const work = loadWork(title);
const workDir = work?.fanza?.workDir;
const enDir = workDir && path.join(workDir, "02_patreon_en");
const pagesDir = enDir && path.join(enDir, "pages");
if (!T?.titleEn || !work?.heroineEn || !pagesDir || !fs.existsSync(pagesDir)) {
  console.error("英語タイトル（fanza-toc.json）・英語名（作品データ）・英語版ページのどれかがありません。先に patreon-fanza-en.js を実行してください");
  process.exit(1);
}
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
const titleEn = T.titleEn;
const slug = titleEn.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
const doc = work.heroineEn.split(" ")[0];
const vars = { doc, docFull: work.heroineEn, pat: work.heroEn };
const pageName = (n) => `${String(n).padStart(3, "0")}.jpg`;
const pageCount = fs.readdirSync(pagesDir).filter((f) => /\.jpg$/i.test(f)).length;

// ---------- ページ番号 → 生成元（プロンプト） ----------
// pages 工程はモザイク済みフォルダを名前順に 001.jpg から並べている。導入の最後は入れ替えがある
const mozaDir = work.fanza.mozaDir;
const moza = fs.readdirSync(mozaDir).filter((f) => /\.png$/i.test(f)).sort();
const swapFile = path.join(workDir, "_work", "bubbles.swap.json");
const swap = fs.existsSync(swapFile) ? readJson(swapFile).swap : null;
const sourceOfPage = (n) => {
  let k = n;
  if (swap && n === swap[0]) k = swap[1];
  else if (swap && n === swap[1]) k = swap[0];
  return path.join(mozaDir, moza[k - 1]);
};

// 公開面に使えるコマ: 導入シーン（88枚）のうち、着衣・単体・透けなし
const intro = work.fanza.introImages ?? 88;
const safe = [];
for (let n = 1; n <= intro; n++) {
  const f = extractFeatures(sourceOfPage(n));
  if (!f || !lintPrompt(f.prompt).ok) continue;
  if (!passesClothingLevel(f, "strict") || !isSolo(f)) continue;
  // 下着（sports bra は着衣なので除く）と透け表現
  if (/nipple|see-through|undressing|underboob|panties|lingerie/.test(f.prompt)) continue;
  if (/(?<!sports )\bbra\b/.test(f.prompt)) continue;
  // 相手役が写るコマ（isSolo の取りこぼし）と、液体に見える濡れ・オイル表現も公開面には使わない
  // （エステ版は場所の説明に "oil bottles" が入るので、oil 単体では弾かない）
  // 「wet hair（濡れ髪）」はただの髪型なので弾かない。肌が濡れている表現だけを避ける
  // 「wet hair（濡れ髪）」や汗の一般的な表現は公開面でも問題ないので、肌が濡れている表現だけ避ける
  if (/\b(man|men|boy)\b|hetero|wet skin|wet body|oily skin|oil massage|pouring oil|saliva/.test(f.prompt)) continue;
  safe.push(n);
}
log(`公開面に使える導入ページ: ${safe.length}/${intro}枚`);
if (safe.length < 4) {
  console.error("! 公開用に使える着衣のページが足りません");
  process.exit(1);
}
const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);

// ---------- 見本 ----------
const previewDir = path.join(enDir, "previews");
fs.rmSync(previewDir, { recursive: true, force: true });
fs.mkdirSync(previewDir, { recursive: true });
const step = Math.floor(safe.length / 4);
const previews = [0, 1, 2, 3].map((i) => safe[i * step]);
previews.forEach((n, i) => fs.copyFileSync(path.join(pagesDir, pageName(n)), path.join(previewDir, `preview_${i + 1}.jpg`)));

// ---------- カバー ----------
const hero = path.join(workDir, "_work", "hero", "hero_1_cut.png");
if (fs.existsSync(hero)) {
  run("python", [
    path.join(ROOT, "tools/make-fanza-cover.py"),
    "--hero", hero, "--pages", ...shuffle(safe).slice(0, 12).map((n) => path.join(pagesDir, pageName(n))),
    "--title", T.coverEn ?? titleEn, "--size", "600x450", "--scale", "2", "--title-w", "0.62",
    ...(V?.coverLayout ? ["--layout", V.coverLayout] : []), ...(V?.coverBg ? ["--bg", V.coverBg] : []),
    ...(V?.coverHeroX ? ["--hero-x", String(V.coverHeroX)] : []),
    ...(V?.coverHeroH ? ["--hero-h", String(V.coverHeroH)] : []),
    "--out", path.join(enDir, "cover_en.jpg"), "--seed", "11",
  ]);
} else {
  log("! 表紙用ヒロイン（_work/hero/hero_1_cut.png）が無いのでカバーは作りませんでした");
}

// ---------- プロフィール ----------
const P = work.profile ?? {};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const [bm, bd] = String(P.birthday ?? "1/1").split("/").map(Number);
// プロフィールの写真は吹き出しが写り込まないよう、吹き出しを付ける前の導入ページ（_intro_original）から取る。
// _intro_original は入れ替え前の番号なので、入れ替えのあるページは相手側の番号で引く
const backupDir = path.join(workDir, "_work", "_intro_original");
const originalOf = (n) => pageName(swap && n === swap[0] ? swap[1] : swap && n === swap[1] ? swap[0] : n);
const profileImgs = shuffle(safe).slice(0, 2).map((n) => path.join(backupDir, originalOf(n)));
run("python", [
  path.join(ROOT, "tools/make-profile.py"),
  "--lang", "en", "--labels", JSON.stringify({ ...EN.labels, age: "Age", job: "Job" }),
  "--image", profileImgs[0], "--image2", profileImgs[1],
  "--name", work.heroineEn,
  "--age", String(P.age ?? T.age).replace("歳", ""), "--job", T.jobEn,
  "--height", String(P.height ?? 160), "--weight", String(P.weight ?? 48),
  "--bwh", String(P.bwh ?? "B88・W58・H86").replace(/・/g, " / "),
  "--birthday", `${months[(bm || 1) - 1]} ${bd || 1}`,
  "--blood", String(P.blood ?? "A型").replace("型", ""),
  "--hobby", pick(EN.hobbies), "--food", pick(EN.foods), "--type", pick(EN.types),
  "--personality", pick(EN.personalities), "--hook", pick(EN.hooks),
  "--out", path.join(enDir, "profile_en.jpg"),
]);

// ---------- 添付（PDF / ZIP） ----------
run("python", [path.join(ROOT, "tools/make-booth-pdf.py"), "--input", pagesDir, "--title", slug, "--outdir", enDir]);
// make-booth-pdf.py は確認用に jpg/ へ連番コピーを残すが、ここでは pages/ と重複するので消す
fs.rmSync(path.join(enDir, "jpg"), { recursive: true, force: true });
const zip = path.join(enDir, `${slug}.zip`);
run("python", ["-c", [
  "import os, sys, zipfile",
  "src, out = sys.argv[1], sys.argv[2]",
  "fs = sorted(f for f in os.listdir(src) if f.lower().endswith('.jpg'))",
  "z = zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED)",
  "[z.write(os.path.join(src, f), 'pages/' + f) for f in fs]",
  "z.close()",
  "print('zip:', len(fs), 'pages', round(os.path.getsize(out) / 1048576, 1), 'MB')",
].join("\n"), pagesDir, zip]);

// ---------- 投稿本文 ----------
const tocFile = path.join(workDir, "_work", "toc.json");
const tocLines = fs.existsSync(tocFile) ? readJson(tocFile).lines : [];
const jaToEn = Object.fromEntries(Object.entries(T.sections).map(([k, v]) => [v, T.sectionsEn?.[k] ?? v]));
const hr = "----------------------------------------";

const premium = [
  titleEn, "",
  render(T.setupEn ?? readJson(path.join(ROOT, T.dialogueEn ?? "config/fanza-dialogue-en.json")).setup ?? "", vars), "",
  hr, "STORY", hr, ...(T.storyEn ?? []).map((l) => render(l, vars)), "",
  hr, "CONTENTS", hr, `${pageCount} pages (JPG + PDF). Censored.`, "",
  ...tocLines.map(([p, name]) => `p.${p}  ${jaToEn[name] ?? name}`), "",
  hr, "HIGHLIGHTS", hr, ...(T.appealEn ?? []).map((l) => `- ${render(l, vars)}`), "",
  hr,
  "All characters depicted are adults.",
  "AI-generated illustrations (Stable Diffusion), edited and censored by the creator.",
  "Fiction. Any resemblance to real people is coincidental.",
];
const free = [
  `[Preview] ${titleEn}`, "",
  render(T.setupEn ?? readJson(path.join(ROOT, T.dialogueEn ?? "config/fanza-dialogue-en.json")).setup ?? "", vars), "",
  ...(T.storyEn ?? []).slice(0, 2).map((l) => render(l, vars)), "",
  `Full set: ${pageCount} pages with dialogue. Available for Premium members, or as a one-time purchase in the shop.`,
  "",
  "All characters are adults. AI-generated illustrations.",
];
fs.writeFileSync(path.join(enDir, "post_premium_en.txt"), premium.join("\n") + "\n", "utf8");
fs.writeFileSync(path.join(enDir, "post_free_en.txt"), free.join("\n") + "\n", "utf8");

saveWork(title, {
  patreon: {
    ...(work.patreon ?? {}), titleEn, slug, enDir,
    previews: previews.map(pageName),
    // X（Twitter）の投稿に使える、公開して問題ないページ番号
    safePages: safe,
    builtAt: new Date().toISOString(),
  },
});
log(`Patreon素材: ${enDir}`);
