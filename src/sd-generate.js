/**
 * スプレッドシートのQ列（結合済みプロンプト）を読み、E列(顔・髪型)だけを差し替えて
 * A1111 の API で一括生成する。
 *
 *   node src/sd-generate.js --list                       … キャラのプリセット一覧
 *   node src/sd-generate.js --char silver-hime --limit 2 … 2行だけ試す
 *   node src/sd-generate.js --char silver-hime           … 全100行を生成
 *   node src/sd-generate.js --char silver-hime --txt out.txt
 *        … 生成せず、A1111のUIに貼り付ける用のテキストを書き出すだけ
 *
 * 画像は save_images=true で A1111 側に保存されるので、
 * outputs/txt2img-images/<日付>/ に、いつも通りメタデータ付きで出てくる。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson, log, ROOT } from "./lib.js";
import { loadSheetRows } from "./sheet-data.js";
import { lintAll, disallowedLoras } from "./safety-lint.js";
import { hairNegative } from "./hair-guard.js";
import { pairTags, hasMan, PAIR_NEGATIVE } from "./pair-guard.js";
import { applyStyle, styleNegative } from "./style-preset.js";

const cfg = loadConfig();
const chars = readJson(path.join(ROOT, "config/characters.json"));
const scenes = readJson(path.join(ROOT, "config/scenes.json"));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
function opt(n, d = null) {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
}

if (flag("list")) {
  console.log("キャラのプリセット:");
  for (const [k, v] of Object.entries(chars.presets)) console.log(`  ${k.padEnd(16)} ${v}`);
  console.log("\n任意の文字列を直接渡すこともできます: --char \"tareme,blue eyes,...\"");
  process.exit(0);
}

// ---------- キャラの決定 ----------
// --char を省略した場合は、シートに書かれている顔・髪型をそのまま使う（差し替えない）
const charArg = opt("char");
let character = charArg ? (chars.presets[charArg] ?? charArg) : null;
if (charArg && !chars.presets[charArg]) log("プリセットに無いので、渡された文字列をそのまま使います");

// ---------- 配信先 ----------
// --patreon を付けると Patreon 専用タブを使い、学校系シーンを禁止し、生成前に全行を安全チェックする
const forPatreon = flag("patreon");
// --tab で任意のタブを使える（例: --tab fanza_500）
const tabOpt = opt("tab");
if (tabOpt && !forPatreon) {
  cfg.sheet = { ...cfg.sheet, tab: tabOpt };
  log(`タブ ${tabOpt} を使用`);
}
if (forPatreon) {
  cfg.sheet = { ...cfg.sheet, tab: cfg.patreon.tab };
  log(`Patreon用: タブ ${cfg.patreon.tab} を使用`);
}

// ---------- シーンの決定 ----------
const sceneArg = opt("scene");
let scene = null;
if (forPatreon && sceneArg && !cfg.patreon.allowedScenes.includes(sceneArg)) {
  console.error(`Patreon用では「${sceneArg}」は使えません（学校系は不可）。使えるシーン: ${cfg.patreon.allowedScenes.join(", ")}`);
  process.exit(1);
}
if (forPatreon && !sceneArg) {
  console.error(`Patreon用では --scene の指定が必須です。使えるシーン: ${cfg.patreon.allowedScenes.join(", ")}`);
  process.exit(1);
}
if (sceneArg) {
  scene = scenes.presets[sceneArg];
  if (!scene) {
    console.error(`シーン「${sceneArg}」がありません。一覧: node src/sd-generate.js --list`);
    process.exit(1);
  }
}

const sd0 = cfg.sd;

// ---------- シートを読む ----------
const sheet = cfg.sheet;
const rows = await loadSheetRows(cfg);

let negative = (rows[0]?.[sheet.negativeCol] ?? "").trim();
const useNegExtra = Boolean(sd0.negativeExtra) && !flag("no-neg-extra");
if (useNegExtra) negative = negative + " " + sd0.negativeExtra;
// 男女の作品なのに女どうしが混ざるのを防ぐ
negative = negative + " " + PAIR_NEGATIVE;

// 画風のプリセット。アカウントごとに変えられる（accounts.json の stylePreset）。
// --style で上書き、--style none で外せる
const ACCOUNTS = readJson(path.join(ROOT, "config/accounts.json")) ?? {};
const accountKey = opt("account", null);
const stylePreset = opt("style", null) ?? ACCOUNTS[accountKey]?.stylePreset ?? sd0.stylePreset ?? "";
if (stylePreset && stylePreset !== "none") {
  negative = negative + " " + styleNegative(stylePreset);
  log(`画風プリセット: ${stylePreset}`);
}
if (!negative) {
  console.error("ネガティブプロンプトが取れません。config.sheet.negativeCol を確認してください。");
  process.exit(1);
}

// ---------- プロンプトを組み立てる ----------
// E列（顔・髪型）の基準文字列はタブごとに違うので、そのタブの先頭データ行から読む
const baseFromSheet = (rows[sheet.firstRow - 1]?.[4] ?? "").trim();
const base = baseFromSheet || chars._base;
if (!character) {
  character = base;
  log("--char 未指定: シートの顔・髪型をそのまま使います");
}
if (baseFromSheet && baseFromSheet !== chars._base) log(`キャラ差し替えの基準（E列）: ${baseFromSheet.slice(0, 60)}`);
// N列(場所)の基準文字列。シートの先頭行から取る
const basePlace = (rows[sheet.firstRow - 1]?.[sheet.placeCol] ?? "").trim();
if (scene && !basePlace) {
  console.error("シートから場所(N列)を取得できません。config.sheet.placeCol を確認してください。");
  await finish(1);
}
// 役柄はキャラ文字列の末尾に足す
const charFull = scene?.role ? character + scene.role : character;
const jobs = [];
let skipped = 0;
for (let r = sheet.firstRow - 1; r < rows.length; r++) {
  const q = (rows[r]?.[sheet.promptCol] ?? "").trim();
  if (!q) continue;
  if (!q.includes(base)) {
    skipped++;
    continue;
  }
  const count = Number((rows[r]?.[sheet.countCol] ?? "").trim()) || 1;
  let p = q.split(base).join(charFull);
  if (scene && basePlace) p = p.split(basePlace).join(scene.place);
  jobs.push({ row: r + 1, prompt: p, count });
}

if (jobs.length === 0) {
  console.error("生成対象がありません。E列の基準文字列(_base)がQ列に見つかりませんでした。");
  await finish(1);
}
if (skipped) log(`! ${skipped}行はE列の文字列を含まないため飛ばしました`);

// 実際に送るプロンプト（キャラ・シーン差し替え後）を、タブに関係なく全件検査する。
// 未成年を想起させる相手役・文脈を含む性的な画像は生成しない。1件でも引っかかったら止める
{
  const problems = lintAll(jobs);
  if (problems.length) {
    console.error(`
安全チェックで ${problems.length}件の問題を検出したため、生成を中止します:`);
    problems.slice(0, 20).forEach((p) =>
      console.error(`  行${p.row}: ${[p.blocked.join(","), p.missingAdult ? "大人の明示なし" : ""].filter(Boolean).join(" / ")}`)
    );
    await finish(2);
  }
  log(`安全チェック: ${jobs.length}件すべて通過`);

  const loras = [...new Set(jobs.flatMap((j) => disallowedLoras(j.prompt, sd0.allowedLoras ?? [])))];
  if (loras.length) {
    console.error(`\n許可リスト(config.sd.allowedLoras)に無いLoRAが入っているため、生成を中止します: ${loras.join(", ")}`);
    console.error("キャラLoRAは使わない。画風LoRAなら内容を確認してから allowedLoras に追加する。");
    await finish(2);
  }
}

// 髪色のブレ対策: キャラの髪色以外をネガティブに足す
{
  const hn = hairNegative(charFull);
  negative = negative + " " + hn;
  log(`髪色ガード: ${hn}`);
}

const seedOpt = opt("seed") ? Number(opt("seed")) : -1;
// --rows "4,5,106-110" で行を指定できる（お試し生成用）
const rowsOpt = opt("rows");
let selected = jobs;
if (rowsOpt) {
  const wanted = new Set();
  for (const part of rowsOpt.split(",")) {
    const [a, b] = part.split("-").map((x) => Number(x.trim()));
    if (!Number.isFinite(a)) continue;
    for (let n = a; n <= (Number.isFinite(b) ? b : a); n++) wanted.add(n);
  }
  selected = jobs.filter((j) => wanted.has(j.row));
  log(`行指定: ${selected.length}行（${rowsOpt}）`);
}
const limit = opt("limit") ? Number(opt("limit")) : selected.length;
const targets = selected.slice(0, limit);
const totalImages = targets.reduce((s, j) => s + j.count, 0);

console.log(`\nキャラ: ${charFull}`);
if (scene) console.log(`シーン: ${scene.label} (${sceneArg})`);
console.log(`対象: ${targets.length}行 / 生成枚数: ${totalImages}枚`);
console.log(`ADetailer: ${flag("adetailer") ? "ON" : "OFF"} / ネガ追記: ${useNegExtra ? "ON" : "OFF"} / seed: ${seedOpt === -1 ? "ランダム" : seedOpt}\n`);

// ---------- テキスト書き出しモード ----------
const txtOut = opt("txt");
if (txtOut) {
  fs.writeFileSync(txtOut, targets.map((j) => j.prompt).join("\n"), "utf8");
  log(`書き出しました: ${txtOut}（${targets.length}行）`);
  log("A1111 の「Prompts from file or textbox」に貼り付けてください。");
  await finish(0);
}

// ---------- API で生成 ----------
const sd = cfg.sd;
const alive = await fetch(`${sd.baseUrl}/sdapi/v1/options`).then((r) => r.ok).catch(() => false);
if (!alive) {
  console.error(`A1111 に接続できません: ${sd.baseUrl}`);
  console.error("webui を --api 付きで起動してください。");
  await finish(1);
}

// ---------- アカウントごとの画風 ----------
// FANZAは1アカウント月3作品までなので複数アカウントで回す。
// 同じ作り手だと分かりにくくするため、アカウントごとにモデル（画風）を変える
let account = null;
if (accountKey) {
  account = ACCOUNTS[accountKey];
  if (!account) {
    console.error(`アカウント「${accountKey}」が config/accounts.json にありません`);
    await finish(1);
  }
  const res = await fetch(`${sd.baseUrl}/sdapi/v1/options`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sd_model_checkpoint: account.model }),
  });
  if (!res.ok) {
    console.error(`モデルの切り替えに失敗しました: ${account.model}`);
    await finish(1);
  }
  log(`アカウント ${accountKey}（${account.label}）: モデル ${account.model}`);
  if (account.negativeExtra) negative = negative + " " + account.negativeExtra;
}

const started = Date.now();
let done = 0;
for (const [i, job] of targets.entries()) {
  const payload = {
    // 女どうしの絡みにならないよう人数のタグを補い、画風プリセットを当ててから送る
    prompt: applyStyle(pairTags(job.prompt), i, stylePreset, { intro: !hasMan(job.prompt) }) + (account?.styleTags ?? ""),
    negative_prompt: negative,
    steps: sd.steps,
    sampler_name: sd.sampler,
    scheduler: sd.scheduler,
    cfg_scale: sd.cfgScale,
    width: sd.width,
    height: sd.height,
    n_iter: job.count,
    batch_size: 1,
    seed: seedOpt,
    save_images: true,
    send_images: false,
  };
  if (flag("adetailer")) {
    payload.alwayson_scripts = { ADetailer: { args: [true, false, { ad_model: sd.adetailerModel }] } };
  }

  const t0 = Date.now();
  const r = await fetch(`${sd.baseUrl}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    log(`行${job.row}: 失敗 HTTP ${r.status} - ${(await r.text()).slice(0, 200)}`);
    continue;
  }
  await r.json();
  done += job.count;

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const avg = (Date.now() - started) / done;
  const eta = Math.round((avg * (totalImages - done)) / 1000);
  log(`[${i + 1}/${targets.length}] 行${job.row} ${job.count}枚 ${sec}秒 (計${done}/${totalImages}枚, 残り約${fmt(eta)})`);
}

log(`完了: ${done}枚 / 所要 ${fmt(Math.round((Date.now() - started) / 1000))}`);
log(`保存先: A1111 の outputs/txt2img-images/<日付>/`);
await finish(0);

// ---------- helpers ----------

/** fetch のkeep-alive接続が残ったまま process.exit すると libuv がアサーションで落ちるので、少し待つ */
async function finish(code) {
  await new Promise((r) => setTimeout(r, 150));
  process.exit(code);
}
function fmt(sec) {
  if (sec < 60) return `${sec}秒`;
  return `${Math.floor(sec / 60)}分${sec % 60}秒`;
}
