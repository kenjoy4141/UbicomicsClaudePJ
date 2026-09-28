/**
 * FANZA作品を、生成済みの500枚から納品フォルダ一式に仕上げる。
 *
 *   node src/fanza-build.js --title "30日後にS○Xする女医さん" --cover "30日後[に]/{blue}S⚪︎Xする女医さん" --date 2026-09-14
 *
 * 工程（--steps で一部だけ実行できる。例: --steps pages,bubbles）
 * 派生タブの作品（例: エステ）:
 *   node src/fanza-build.js --title "..." --cover "..." --src F017_raw --tab fanza_500_esthe
 *        --dialogue config/fanza-dialogue-esthe.json --outfit "esthetician, fitted white tunic, ..."
 *
 *   organize … 日付フォルダ（または --src のフォルダ）の生成画像を作品用のフォルダに移す
 *   mosaic   … モザイクツールをかける
 *   pages    … JPG化して 001.jpg〜 の連番で 01_本編/ に並べる
 *   bubbles  … 導入シーンにセリフの吹き出しを付ける（元画像は _intro_original/ に退避）
 *   covers   … 表紙用ヒロインを生成・切り抜きし、サムネ3枚を 00_表紙/ に作る
 *   extras   … プロフィール画像と目次画像を 00_表紙/ に作る（src/fanza-extras.js）
 *   zip      … 01_本編/ を 作品名.zip に固める
 *
 * 出力:
 *   outputs/txt2img-images/NNN_作品名/
 *     00_表紙/NNNサムネ_1.jpg 〜 _3.jpg
 *     01_本編/001.jpg 〜 500.jpg
 *     作品名.zip
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, readJson, log, workDirName, titleFromDir, ROOT } from "./lib.js";
import { loadWork, saveWork } from "./work.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

// --variant を渡すと、作品名・表紙タイトル・タブ・表紙の服装を config/variants/<名前>.json から取る
const variantName = opt("variant");
const V = variantName ? readJson(path.join(ROOT, "config/variants", `${variantName}.json`)) : null;
const title = opt("title", V?.title);
const coverTitle = opt("cover", V?.cover ?? title);
const date = opt("date");
const expected = Number(opt("expected", 500));
const ALL = ["organize", "mosaic", "pages", "panels", "bubbles", "covers", "extras", "zip"];
const steps = (opt("steps") ?? ALL.join(",")).split(",").map((s) => s.trim());

if (!title) {
  console.error('使い方: node src/fanza-build.js --title "作品名" --cover "表紙用タイトル" --date YYYY-MM-DD');
  process.exit(1);
}

const tab = opt("tab", V?.tab ?? "fanza_500");
const OUT = cfg.worksRoot;
const run = (cmd, args, extra = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" }, ...extra });

// ---------- 作品番号とフォルダ ----------
function nextWorkNo() {
  const nums = fs.readdirSync(OUT).map((d) => d.match(/^(\d{3})_/)?.[1]).filter(Boolean).map(Number);
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0");
}
const existing = fs.readdirSync(OUT).find((d) => /^\d{3}_/.test(d) && titleFromDir(d) === title);
const no = opt("no") ?? (existing ? existing.slice(0, 3) : nextWorkNo());
// アカウントを使い分けるので、フォルダ名にもアカウント名を入れる
const account = opt("account", V?.account ?? null);
const workDir = path.join(OUT, existing ?? workDirName(no, account, title));
const coverDir = path.join(workDir, "00_表紙");
const pagesDir = path.join(workDir, "01_本編");
const rawDir = path.join(OUT, `${date ?? "raw"}_F${no}_${title}`);
const mozaDir = rawDir + "moza";

log(`作品: ${no}_${title}`);
log(`工程: ${steps.join(" → ")}`);

const listPng = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort() : [];

// ---------- organize ----------
if (steps.includes("organize")) {
  // --src: fanza-stage.js でまとめたフォルダ（日付をまたいだとき）。無ければ --date の日付フォルダ
  const srcOpt = opt("src");
  if (!date && !srcOpt) {
    console.error("organize には --date か --src が必要です（生成画像が入っているフォルダ）");
    process.exit(1);
  }
  const src = path.join(OUT, srcOpt ?? date);
  const files = listPng(src);
  if (!files.length) {
    console.error(`! ${src} に画像がありません`);
    process.exit(1);
  }
  // 導入の枚数を変えると総数も変わるので、枚数は「シートの想定と違ったら知らせる」だけにする。
  // --expected で明示したときだけ、食い違いを致命扱いにする
  if (argv.includes("--expected") && files.length !== expected) {
    console.error(`! ${src} の画像が ${files.length}枚です（指定 ${expected}枚）`);
    if (!argv.includes("--force")) process.exit(1);
  } else if (files.length !== expected) {
    log(`枚数: ${files.length}枚（既定の想定 ${expected}枚と違いますが、そのまま進めます）`);
  }
  fs.mkdirSync(rawDir, { recursive: true });
  for (const f of files) fs.renameSync(path.join(src, f), path.join(rawDir, f));
  log(`organize: ${files.length}枚 → ${rawDir}`);
}

// ---------- mosaic ----------
if (steps.includes("mosaic")) {
  run("powershell", [
    "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "tools/run-mosaic.ps1"),
    "-InputDir", rawDir, "-OutputDir", mozaDir, "-Force",
  ]);
  const n = listPng(mozaDir).length;
  log(`mosaic: ${n}枚`);
  if (n !== listPng(rawDir).length) {
    console.error("! モザイク前後で枚数が合いません");
    process.exit(1);
  }
}

// ---------- pages ----------
if (steps.includes("pages")) {
  const files = listPng(mozaDir);
  if (!files.length) {
    console.error(`モザイク済みの画像がありません: ${mozaDir}`);
    process.exit(1);
  }
  fs.mkdirSync(pagesDir, { recursive: true });
  const py = [
    "import os, sys",
    "from PIL import Image",
    "src, dst = sys.argv[1], sys.argv[2]",
    "files = sorted(f for f in os.listdir(src) if f.lower().endswith('.png'))",
    "for i, f in enumerate(files, 1):",
    "    Image.open(os.path.join(src, f)).convert('RGB').save(os.path.join(dst, '%03d.jpg' % i), 'JPEG', quality=90, optimize=True)",
    "    if i % 50 == 0: print('  変換', i, '/', len(files))",
    "print('pages:', len(files))",
  ].join("\n");
  const tmp = path.join(ROOT, "logs/_to_pages.py");
  fs.writeFileSync(tmp, py, "utf8");
  run("python", [tmp, mozaDir, pagesDir]);
  fs.unlinkSync(tmp);
}

// ---------- panels ----------
// 導入だけコマ割りにする。1ビート4枚のうち2枚ずつ1ページにして、
// 後ろのページを詰め直す。吹き出しはこのあとの工程で乗せる
if (steps.includes("panels")) {
  const sb = V?.introStoryboard ? readJson(path.join(ROOT, V.introStoryboard)) : null;
  const per = sb?.imagesPerBeat ?? 0;
  if (per < 4) {
    log("panels: この作品は1ビートが4枚未満なので飛ばします");
  } else {
    const intro = sb.beats.reduce((n, b) => n + (b.images ?? per), 0);   // 導入の枚数
    const jpgs = fs.readdirSync(pagesDir).filter((f) => /^\d{3}\.jpg$/i.test(f)).sort();
    if (jpgs.length < intro) {
      console.error(`! 導入の枚数が足りません（${jpgs.length} < ${intro}）`);
      process.exit(1);
    }
    const tmp = path.join(workDir, "_work", "_panels");
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const name3 = (n) => `${String(n).padStart(3, "0")}.jpg`;
    let page = 0;
    for (let i = 0; i < intro; i += 2) {
      page += 1;
      run("python", [path.join(ROOT, "tools/make-panel-page.py"),
        "--images", [jpgs[i], jpgs[i + 1]].map((f) => path.join(pagesDir, f)).join(","),
        "--layout", "2", "--out", path.join(tmp, name3(page)),
        "--width", String(cfg.sd.width), "--height", String(cfg.sd.height)]);
    }
    // 導入をコマ割り版で入れ替え、残りを詰め直す
    for (const f of jpgs.slice(0, intro)) fs.unlinkSync(path.join(pagesDir, f));
    const rest = jpgs.slice(intro);
    const moved = rest.map((f, i) => {
      const to = path.join(tmp, name3(page + i + 1));
      fs.renameSync(path.join(pagesDir, f), to);
      return to;
    });
    for (const f of fs.readdirSync(tmp)) fs.renameSync(path.join(tmp, f), path.join(pagesDir, f));
    fs.rmSync(tmp, { recursive: true, force: true });
    log(`panels: 導入 ${intro}枚 → ${page}ページ（2コマ）、全体 ${page + moved.length}ページ`);
  }
}

// ---------- bubbles ----------
if (steps.includes("bubbles")) {
  const csv = path.join(workDir, "_work", "bubbles.csv");
  run("node", [path.join(ROOT, "src/fanza-dialogue.js"), "--title", title, "--out", csv,
    "--tab", tab, ...(variantName ? ["--variant", variantName] : []),
    ...(opt("dialogue") ? ["--dialogue", opt("dialogue")] : [])]);

  // 元の導入シーン（吹き出し前・入れ替え前の番号のまま）を退避する。やり直しても二重に吹き出しが付かないよう、
  // 吹き出しの入力は常にこの退避先から作る
  const backup = path.join(workDir, "_work", "_intro_original");
  fs.mkdirSync(backup, { recursive: true });
  const csvNames = fs.readFileSync(csv, "utf8").split(/\r?\n/).slice(1)
    .map((l) => l.split(",")[0].replace(/^﻿/, "").trim()).filter(Boolean);
  for (const f of csvNames) {
    const b = path.join(backup, f);
    if (!fs.existsSync(b) && fs.existsSync(path.join(pagesDir, f))) fs.copyFileSync(path.join(pagesDir, f), b);
  }

  // 最後のページを下着姿のコマにするため、2枚を入れ替えた入力を作る
  const swapFile = csv.replace(/\.csv$/i, "") + ".swap.json";
  const swap = fs.existsSync(swapFile) ? JSON.parse(fs.readFileSync(swapFile, "utf8")).swap : null;
  const name3 = (n) => `${String(n).padStart(3, "0")}.jpg`;
  const input = path.join(workDir, "_work", "intro_input");
  fs.rmSync(input, { recursive: true, force: true });
  fs.mkdirSync(input, { recursive: true });
  for (const f of csvNames) fs.copyFileSync(path.join(backup, f), path.join(input, f));
  if (swap) {
    const [a, b] = swap.map(name3);
    fs.copyFileSync(path.join(backup, a), path.join(input, b));
    fs.copyFileSync(path.join(backup, b), path.join(input, a));
    log(`入れ替え: ${a} ⇔ ${b}`);
  }

  const bubbled = path.join(workDir, "_work", "bubbled");
  const dayLabel = opt("day-label", V?.dayLabel);
  run("node", [path.join(ROOT, "src/fanza-bubbles.js"), "--pages", input, "--csv", csv, "--out", bubbled,
    ...(dayLabel ? ["--day-label", dayLabel] : [])]);

  let replaced = 0;
  // フォルダをエクスプローラーで開くと desktop.ini ができるので、画像だけを対象にする
  for (const f of fs.readdirSync(bubbled).filter((n) => /\.(jpe?g|png)$/i.test(n))) {
    const target = path.join(pagesDir, f);
    if (!fs.existsSync(target)) continue;
    // 吹き出しツールはPNGで出すことがあるので、JPGに揃えて置き換える
    run("python", ["-c",
      "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], 'JPEG', quality=90)",
      path.join(bubbled, f), target]);
    replaced++;
  }
  log(`bubbles: ${replaced}枚を吹き出し付きに置き換え（元画像は ${backup}）`);
}

// ---------- covers ----------
if (steps.includes("covers")) {
  const heroDir = path.join(workDir, "_work", "hero");
  const outfit = opt("outfit", V?.coverOutfit);
  run("node", [path.join(ROOT, "src/fanza-cover-hero.js"), "--out", heroDir, "--tab", tab,
    ...(variantName ? ["--variant", variantName] : []),
    ...(outfit ? ["--outfit", outfit] : []),
    ...(V?.coverExprFrom ? ["--expr-from", V.coverExprFrom] : [])]);

  // 背景は吹き出し付きの導入シーンから使う（パッケージ画像なので性的なページは入れない）
  const introCount = 88;
  const pages = fs.readdirSync(pagesDir).filter((f) => /\.jpg$/i.test(f)).sort().slice(0, introCount)
    .map((f) => path.join(pagesDir, f));
  fs.mkdirSync(coverDir, { recursive: true });
  // サムネ3枚は見た目を変える。作品名を種にして並びをずらすので、
  // 作品ごとに違う組み合わせになる（同じ作品なら何度やっても同じ）
  const pageCount = fs.readdirSync(pagesDir).filter((f) => /\.jpg$/i.test(f)).length;
  const badge = `総${pageCount}P`;
  const LAYOUTS = ["left", "poster", "duo"];
  const seedNum = [...title].reduce((a, c) => a + c.codePointAt(0), 0);
  for (let i = 1; i <= 3; i++) {
    const cut = path.join(heroDir, `hero_${i}_cut.png`);
    if (!fs.existsSync(cut)) {
      log(`! hero_${i}_cut.png がありません。サムネ${i}は作れませんでした`);
      continue;
    }
    const layout = V?.coverLayout ?? LAYOUTS[(seedNum + i) % LAYOUTS.length];
    // duo は2体並べるので、別ポーズの切り抜きがもう1枚要る
    const other = path.join(heroDir, `hero_${(i % 3) + 1}_cut.png`);
    const useDuo = layout === "duo" && fs.existsSync(other);
    // 背景に散らすページは毎回ランダムに12枚
    const pick = [...pages].sort(() => Math.random() - 0.5).slice(0, 12);
    run("python", [
      path.join(ROOT, "tools/make-fanza-cover.py"),
      "--hero", cut, "--pages", ...pick,
      "--title", coverTitle,
      "--layout", useDuo ? "duo" : (layout === "duo" ? "poster" : layout),
      ...(useDuo ? ["--hero2", other] : []),
      "--badge", badge,
      "--badge-corner", i === 2 ? "tr" : "tl",
      ...(V?.coverBg ? ["--bg", V.coverBg] : []),
      ...(V?.coverHeroH ? ["--hero-h", String(V.coverHeroH)] : []),
      ...(V?.coverHeroX ? ["--hero-x", String(V.coverHeroX)] : []),
      "--out", path.join(coverDir, `${no}サムネ_${i}.jpg`),
      "--seed", String(i * 97),
    ]);
  }
  log(`covers: ${coverDir}`);
}

// ---------- extras ----------
// プロフィール画像と目次画像（00_表紙/NNNプロフィール.jpg, NNN目次.jpg）
if (steps.includes("extras")) {
  // 作品データの mozaDir を先に更新しておく（extras がプロンプトを読むのに使う）
  if (steps.includes("organize") || steps.includes("mosaic")) {
    saveWork(title, { fanza: { ...(loadWork(title)?.fanza ?? {}), workNo: no, workDir, rawDir, mozaDir } });
  } else if (!loadWork(title)?.fanza?.workDir) {
    saveWork(title, { fanza: { ...(loadWork(title)?.fanza ?? {}), workNo: no, workDir } });
  }
  run("node", [path.join(ROOT, "src/fanza-extras.js"), "--title", title, "--tab", tab]);
  // 作品コメント（目次・プロフィールを使うので extras の後）
  run("node", [path.join(ROOT, "src/fanza-description.js"), "--title", title, "--tab", tab]);
}

// ---------- zip ----------
if (steps.includes("zip")) {
  const zipPath = path.join(workDir, `${title}.zip`);
  const py = [
    "import os, sys, zipfile",
    "pages, out = sys.argv[1], sys.argv[2]",
    "files = sorted(f for f in os.listdir(pages) if f.lower().endswith('.jpg'))",
    "with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:",
    "    for f in files:",
    "        z.write(os.path.join(pages, f), '01_本編/' + f)",
    "print('zip:', len(files), '枚', round(os.path.getsize(out) / 1048576, 1), 'MB')",
  ].join("\n");
  const tmp = path.join(ROOT, "logs/_zip.py");
  fs.writeFileSync(tmp, py, "utf8");
  run("python", [tmp, pagesDir, zipPath]);
  fs.unlinkSync(tmp);
}

// 生成元のフォルダ名は --date から決まるので、organize/mosaic を回したときだけ記録する
// （一部の工程だけやり直したときに、存在しないパスで上書きしないため）
const touchedRaw = steps.includes("organize") || steps.includes("mosaic");
// saveWork は1階層だけのマージなので、fanza の中身は既存の値と合わせてから渡す
saveWork(title, {
  fanza: {
    ...(loadWork(title)?.fanza ?? {}),
    workNo: no, workDir, ...(touchedRaw ? { rawDir, mozaDir } : {}), builtAt: new Date().toISOString(),
  },
});
log(`完了: ${workDir}`);
