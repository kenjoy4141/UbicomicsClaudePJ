/**
 * 画風プリセットの効きを、同じ行・同じ種で見比べる（作品フォルダは汚さない）。
 *
 *   node tools/style-compare.mjs --tab fanza_500_cafe --rows 200,260,320 --style shiron
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, log, ROOT } from "../src/lib.js";
import { readRange } from "../src/sheets.js";
import { pairTags, PAIR_NEGATIVE } from "../src/pair-guard.js";
import { applyStyle, styleNegative } from "../src/style-preset.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const tab = opt("tab", "fanza_500_cafe");
const style = opt("style", "shiron");
const rows = (opt("rows") ?? "200,260,320").split(",").map(Number);
const outDir = path.join(ROOT, "logs/style-compare");
fs.mkdirSync(outDir, { recursive: true });

const sheet = cfg.sheet;
const all = await readRange(sheet.id, `${tab}!A1:R400`);
const negBase = (all[0]?.[sheet.negativeCol] ?? "").trim() + " " + (cfg.sd.negativeExtra ?? "") + " " + PAIR_NEGATIVE;

const accounts = JSON.parse(fs.readFileSync(path.join(ROOT, "config/accounts.json"), "utf8"));
const acc = accounts[opt("account", "B")] ?? {};
if (acc.model) {
  await fetch(`${cfg.sd.baseUrl}/sdapi/v1/options`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sd_model_checkpoint: acc.model }),
  });
  log(`モデル: ${acc.model}`);
}

async function shoot(prompt, negative, seed, file) {
  const res = await fetch(`${cfg.sd.baseUrl}/sdapi/v1/txt2img`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt, negative_prompt: negative,
      steps: cfg.sd.steps, sampler_name: cfg.sd.sampler, scheduler: cfg.sd.scheduler,
      cfg_scale: cfg.sd.cfgScale, width: cfg.sd.width, height: cfg.sd.height,
      seed, n_iter: 1, batch_size: 1, save_images: false, send_images: true,
    }),
  });
  const j = await res.json();
  fs.writeFileSync(file, Buffer.from(j.images[0], "base64"));
}

for (const r of rows) {
  const q = String(all[r - 1]?.[sheet.promptCol] ?? "").trim();
  if (!q) { log(`${r}行目: プロンプトなし`); continue; }
  const seed = 1234567 + r;
  const base = pairTags(q) + (acc.styleTags ?? "");
  await shoot(base, negBase, seed, path.join(outDir, `r${r}_before.png`));
  await shoot(applyStyle(pairTags(q), 0, style) + (acc.styleTags ?? ""),
    negBase + " " + styleNegative(style), seed, path.join(outDir, `r${r}_after.png`));
  log(`${r}行目: before / after を書き出し`);
}
log(`→ ${outDir}`);
