import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson, ROOT } from "../src/lib.js";
import { readPngPrompt } from "../src/describe.js";
const cfg = loadConfig();
const date = process.argv[2] ?? "2026-09-26";
const dir = path.join(cfg.worksRoot, date);
const files = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f));
const bases = {};
for (const f of fs.readdirSync(path.join(ROOT, "config/variants"))) {
  const V = readJson(path.join(ROOT, "config/variants", f));
  if (V?.face) bases[f.replace(/\.json$/, "")] = V.face.trim();
}
const cnt = { 判別不能: 0 };
for (const f of files) {
  const p = readPngPrompt(path.join(dir, f)) ?? "";
  const hit = Object.entries(bases).find(([, b]) => p.includes(b));
  if (hit) cnt[hit[0]] = (cnt[hit[0]] ?? 0) + 1;
  else cnt["判別不能"]++;
}
console.log(`${date}: ${files.length}枚`, cnt);
