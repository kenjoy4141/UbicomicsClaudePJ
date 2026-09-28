/**
 * サークルのアイコン（60×60 JPEG）を、アカウントごとの画風で作る。
 *
 *   node tools/make-circle-icon.mjs                 … 全アカウント
 *   node tools/make-circle-icon.mjs --accounts B,C  … 指定だけ
 *
 * サークルの顔なので、服を着た上半身の絵にする（性的な画像は使わない）。
 * 出力: logs/circle/<アカウント>_icon.jpg（60×60）と _large.png（確認用の元画像）
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, readJson, log, ROOT } from "../src/lib.js";
import { applyStyle, styleNegative } from "../src/style-preset.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const ACCOUNTS = readJson(path.join(ROOT, "config/accounts.json")) ?? {};
const keys = (opt("accounts") ?? Object.keys(ACCOUNTS).filter((k) => !k.startsWith("_")).join(","))
  .split(",").map((s) => s.trim()).filter(Boolean);

// サークルごとに見た目を変える。どれも成人女性・着衣
const LOOKS = {
  A: "(dark brown hair:1.3), long hair, low ponytail, brown eyes, white blouse,",
  B: "(black hair:1.3), medium hair, blunt bangs, red eyes, black turtleneck,",
  C: "(ash blonde hair:1.3), short bob, green eyes, beige knit sweater,",
  D: "(pink hair:1.2), medium hair, twin tails low, blue eyes, white shirt,",
  E: "(light brown hair:1.3), long straight hair, amber eyes, pastel yellow cardigan,",
  F: "(silver grey hair:1.2), long wavy hair, purple eyes, black jacket,",
};
const COMMON = "1girl, solo, young adult woman, (28 years old woman:1.05), " +
  "(beautiful face:1.25), (very cute face:1.2), idol face, symmetrical face, " +
  "(large detailed eyes:1.2), long eyelashes, small nose, glossy lips, " +
  "smooth clear skin, flawless skin, (upper body:1.2), looking at viewer, " +
  "soft smile, (simple background:1.5), plain light background, clean composition,";
const NEG_BASE = "nsfw, nude, nipples, cleavage, topless, underwear, lowres, bad anatomy, " +
  "extra fingers, text, watermark, signature, multiple girls, 2girls, " +
  // 老けて見える原因を潰す
  "(old:1.3), mature face, aged skin, wrinkles, nasolabial fold, sunken eyes, " +
  "tired face, dull skin, thin lips, small eyes, plain face, flat face,";

// 本編と同じ品質プレフィックス（score_9 や画風LoRA）を頭に付ける。
// これが無いと、同じモデルでも平凡な顔になる
const { loadSheetRows } = await import("../src/sheet-data.js");
const sheetRows = await loadSheetRows({ ...cfg, sheet: { ...cfg.sheet, tab: "fanza_500" } });
const PREFIX = String(sheetRows[1]?.[2] ?? "");
const SHEET_NEG = String(sheetRows[0]?.[2] ?? "");

const outDir = path.join(ROOT, "logs/circle");
fs.mkdirSync(outDir, { recursive: true });

for (const k of keys) {
  const acc = ACCOUNTS[k];
  if (!acc) { log(`! ${k}: accounts.json にありません`); continue; }
  const res = await fetch(`${cfg.sd.baseUrl}/sdapi/v1/options`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sd_model_checkpoint: acc.iconModel ?? acc.model }),
  });
  if (!res.ok) { log(`! ${k}: モデルを切り替えられません（${acc.model}）`); continue; }

  const preset = acc.stylePreset ?? cfg.sd.stylePreset ?? "";
  const prompt = PREFIX + applyStyle(`${COMMON} ${LOOKS[k] ?? LOOKS.A}`, 4, preset, { intro: true });
  const negative = `${SHEET_NEG} ${NEG_BASE} ${styleNegative(preset)}`;
  const r = await fetch(`${cfg.sd.baseUrl}/sdapi/v1/txt2img`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt, negative_prompt: negative,
      steps: cfg.sd.steps, sampler_name: cfg.sd.sampler, scheduler: cfg.sd.scheduler,
      cfg_scale: cfg.sd.cfgScale, width: 1024, height: 1024,
      seed: -1, n_iter: 1, batch_size: 1, save_images: false, send_images: true,
    }),
  });
  const j = await r.json();
  if (!j.images?.length) { log(`! ${k}: 生成できませんでした`); continue; }
  const large = path.join(outDir, `${k}_large.png`);
  fs.writeFileSync(large, Buffer.from(j.images[0], "base64"));

  // 顔まわりを正方形に切って 60×60 にする。小さいので最後に少しシャープをかける
  const py = [
    "import sys",
    "from PIL import Image, ImageFilter",
    "src, dst = sys.argv[1], sys.argv[2]",
    "im = Image.open(src).convert('RGB')",
    "w, h = im.size",
    "s = int(min(w, h) * 0.62)",
    "x = (w - s) // 2",
    "y = int(h * 0.06)",
    "im = im.crop((x, y, x + s, y + s)).resize((180, 180), Image.LANCZOS)",
    "im = im.filter(ImageFilter.UnsharpMask(radius=2, percent=120, threshold=3))",
    "im = im.resize((60, 60), Image.LANCZOS)",
    "im = im.filter(ImageFilter.UnsharpMask(radius=1, percent=90, threshold=2))",
    "im.save(dst, 'JPEG', quality=92, optimize=True)",
    "print('icon:', dst)",
  ].join("\n");
  const tmp = path.join(ROOT, "logs/_icon.py");
  fs.writeFileSync(tmp, py, "utf8");
  execFileSync("python", [tmp, large, path.join(outDir, `${k}_icon.jpg`)],
    { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  fs.unlinkSync(tmp);
  log(`${k}（${acc.label}）: ${acc.iconModel ?? acc.model} で作成`);
}
log(`→ ${outDir}`);
