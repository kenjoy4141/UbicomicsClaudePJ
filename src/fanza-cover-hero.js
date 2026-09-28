/**
 * FANZA表紙用のヒロイン画像を、青一色の背景で生成する（あとでクロマキーで切り抜く）。
 * 本編と同じキャラ（fanza_500 の人物・顔髪型・体形）を使い、服装とポーズだけ表紙向けにする。
 *
 *   node src/fanza-cover-hero.js --char black-bob --out logs/fanza/test/hero
 *   node src/fanza-cover-hero.js --out ... --outfit "nurse, white coat, pink camisole,"
 *
 * 生成前に safety-lint を通す。表紙はパッケージ画像なので着衣のみ。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson, log, ROOT } from "./lib.js";
import { loadSheetRows } from "./sheet-data.js";
import { lintPrompt, disallowedLoras } from "./safety-lint.js";
import { hairNegative } from "./hair-guard.js";
import { execFileSync } from "node:child_process";

const cfg = loadConfig();
const chars = readJson(path.join(ROOT, "config/characters.json"));
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const out = path.resolve(opt("out", path.join(ROOT, "logs/fanza/hero")));
fs.mkdirSync(out, { recursive: true });

// fanza_500 から人物・顔髪型・体形・固定文言を取る
cfg.sheet = { ...cfg.sheet, tab: opt("tab", "fanza_500") };
const rows = await loadSheetRows(cfg);
const r4 = rows[cfg.sheet.firstRow - 1] ?? [];
const prefix = String(rows[1]?.[2] ?? "");
const negative = String(rows[0]?.[2] ?? "") + " " + (cfg.sd.negativeExtra ?? "") +
  " detailed background, scenery, gradient background, patterned background, shadow on background, text, watermark," +
  " ";

const person = String(r4[3] ?? "");
const baseFace = String(r4[4] ?? "");
const body = String(r4[9] ?? "");
const charArg = opt("char");
const face = charArg ? (chars.presets[charArg] ?? charArg) : baseFace;
// 髪色のブレ対策（本編と同じ）
// 表紙はパッケージ画像なので、はだけ過ぎ・露出はネガティブで抑える
const coverNegative = opt("negative",
  "nipples, exposed breasts, topless, open shirt, unbuttoned shirt, areola, nude, bare breasts,");
const negativeFull = negative + hairNegative(face) + " " + coverNegative;

const outfit = opt("outfit", "female doctor, open white lab coat, pink camisole, stethoscope around neck, dark pencil skirt,");

// --expr-from "イキ顔" のように渡すと、そのシーン行の表情(F列)と肌の質感(G列)だけを表紙に使う。
// 行為や相手役は持ってこない（表紙はヒロイン単体・着衣のため）
const exprFrom = opt("expr-from");
let expr = "";
if (exprFrom) {
  const hit = rows.findIndex((r, k) => k >= cfg.sheet.firstRow - 1 && String(r?.[2] ?? "").includes(exprFrom));
  if (hit < 0) {
    console.error(`シーン「${exprFrom}」がタブに見つかりません`);
    process.exit(1);
  }
  expr = String(rows[hit][5] ?? "") + String(rows[hit][6] ?? "");
  log(`表情を「${String(rows[hit][2])}」から取りました: ${expr.slice(0, 80)}`);
}
// 注意: ネガティブに "green" を含む語を入れると、背景の緑まで薄くなって切り抜けなくなる
// 緑だと黒髪に黄緑のメッシュが映り込むため青にする（黒髪に青いツヤはアニメ絵として自然）
// 髪色はキャラ文字列（E列）側で指定する。ここに髪色を書くと別キャラの本編と食い違う
const BG = "(simple background:1.4), (solid bright blue background:1.5), (chroma key:1.3), no scenery,";

// 表紙のポーズ。作品ごとに違う組み合わせが出るよう、プールから作品名で位置をずらして取る。
// 以前は3つ固定だったので、どの作品も同じ構えのサムネになっていた
const POSE_POOL = [
  "cowboy shot, standing, one hand in hair, looking at viewer, gentle smile, blush,",
  "upper body, arms raised, hands behind head, looking at viewer, shy smile, blush,",
  "thigh up, leaning forward slightly, hands clasped in front, looking at viewer, soft smile,",
  "cowboy shot, hand on own hip, weight on one leg, looking at viewer, confident smile,",
  "upper body, arms crossed under chest, looking at viewer, teasing smile, blush,",
  "thigh up, looking back over shoulder, hand on collar, glancing at viewer,",
  "cowboy shot, both hands holding the hem of her skirt, looking down at viewer, shy smile,",
  "upper body, finger on lips, head tilted, looking at viewer, playful smile,",
  "thigh up, sitting on heels, hands on thighs, looking up at viewer, soft smile,",
  "cowboy shot, hands clasped behind back, leaning forward, looking at viewer, inviting smile,",
  "upper body, one hand pulling her collar open slightly, looking at viewer, flushed,",
  "thigh up, kneeling, one hand on the floor, looking up at viewer, half-closed eyes,",
];

// variant で coverPoses（英語の断片の配列）を書けば、そちらを優先する
const variantName = opt("variant");
const V = variantName ? readJson(path.join(ROOT, "config/variants", `${variantName}.json`)) : null;
const posesFromVariant = Array.isArray(V?.coverPoses) && V.coverPoses.length ? V.coverPoses : null;
// 作品ごとにプールの取り出し位置をずらす。タブ名（作品ごとに違う）を種にする
const seedText = V?.title ?? cfg.sheet.tab ?? "";
const seed = [...String(seedText)].reduce((a, c) => a + c.codePointAt(0), 0);
const POSES = posesFromVariant ?? Array.from({ length: POSE_POOL.length },
  (_, i) => POSE_POOL[(seed + i) % POSE_POOL.length]);

const count = Math.min(Number(opt("count", 3)), POSES.length);
const maxTries = Number(opt("tries", 5));

/** 1枚生成して、切り抜けたかを確かめる。人物の面積が極端なら失敗扱い */
async function generateOne(prompt, file) {
  const res = await fetch(`${cfg.sd.baseUrl}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt, negative_prompt: negativeFull,
      steps: cfg.sd.steps, sampler_name: cfg.sd.sampler, scheduler: cfg.sd.scheduler,
      cfg_scale: cfg.sd.cfgScale, width: cfg.sd.width, height: cfg.sd.height,
      seed: -1, n_iter: 1, batch_size: 1,
      save_images: false, send_images: true,
    }),
  });
  if (!res.ok) throw new Error(`生成失敗 HTTP ${res.status}`);
  const j = await res.json();
  fs.writeFileSync(file, Buffer.from(j.images[0], "base64"));

  const cut = file.replace(/\.png$/, "_cut.png");
  const r = JSON.parse(execFileSync("python", [
    path.join(ROOT, "tools/key-hero.py"), "--in", file, "--out", cut, "--json",
  ], { encoding: "utf8" }).trim().split("\n").pop());
  // 背景が抜けていれば、人物は画面の3〜8割ほどになる
  r.ok = r.keyable && r.area >= 30 && r.area <= 85;
  return r;
}

for (let i = 0; i < count; i++) {
  const prompt = `${prefix}${person}${face}${expr}${outfit}${body}${POSES[i]}${BG}`;
  const lint = lintPrompt(prompt);
  if (!lint.ok) {
    console.error(`中止: 安全チェック不合格 (${[lint.blocked.join(","), lint.missingAdult ? "大人の明示なし" : ""].filter(Boolean).join(" / ")})`);
    process.exit(2);
  }
  const loras = disallowedLoras(prompt, cfg.sd.allowedLoras ?? []);
  if (loras.length) {
    console.error(`中止: 許可リストに無いLoRA (${loras.join(", ")})`);
    process.exit(2);
  }

  const file = path.join(out, `hero_${i + 1}.png`);
  let ok = false;
  for (let t = 1; t <= maxTries && !ok; t++) {
    const r = await generateOne(prompt, file);
    ok = r.ok;
    log(`  hero_${i + 1} 試行${t}: 人物の面積 ${r.area}% / 背景の彩度 ${r.bg_sat}${ok ? "  → OK" : "  → 切り抜けないので焼き直し"}`);
  }
  if (!ok) log(`  ! hero_${i + 1} は ${maxTries}回焼いても切り抜けませんでした`);
}
log(`出力: ${out}`);
await new Promise((r) => setTimeout(r, 150));
