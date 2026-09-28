/**
 * キューの内容で pixiv の投稿フォームを1件ずつ埋める。
 * 1件ごとに止まるので、内容を確認しながら投稿できる。
 * まとめてやりたい場合は pixiv-batch.js（タブを並べる版）を使う。
 *
 *   node src/pixiv-draft.js             … pending を1件ずつ
 *   node src/pixiv-draft.js 016-01      … 特定IDだけ
 *   node src/pixiv-draft.js --dry       … 埋めてスクショを撮るだけ（投稿もキュー更新もしない）
 *   node src/pixiv-draft.js --keep-open … 終了時にブラウザを閉じない
 */
import path from "node:path";
import readline from "node:readline/promises";
import { loadConfig, openBrowser, readJson, writeJson, log, ROOT } from "./lib.js";
import { fillUploadForm, S } from "./fill-form.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const only = argv.find((a) => !a.startsWith("--"));
const keepOpen = argv.includes("--keep-open");
const dryRun = argv.includes("--dry");

const queuePath = path.join(ROOT, "data/queue.json");
const queue = readJson(queuePath, { items: [] });
const todo = queue.items.filter((it) => it.status === "pending" && (!only || it.id === only));

if (todo.length === 0) {
  log("処理対象がありません。先に build-queue.js を実行してください。");
  process.exit(0);
}
log(`${todo.length}件を処理します（autoSubmit=${cfg.autoSubmit}${dryRun ? " / --dry" : ""}）`);

const { ctx, page } = await openBrowser(cfg, { headless: false });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

let processed = 0;
for (const item of todo) {
  log(`--- ${item.id} : ${item.title} ---`);
  try {
    await fillUploadForm(page, item, cfg);
  } catch (e) {
    log(`  失敗: ${e.message.split("\n")[0]}`);
    break;
  }

  await page.screenshot({ path: path.join(ROOT, `logs/${item.id}.png`), fullPage: true });

  if (dryRun) {
    log("  --dry のため投稿せず終了（キューは更新しません）");
    processed++;
    continue;
  }

  if (cfg.autoSubmit) {
    await page.locator(S.submit).first().click();
    await page.waitForTimeout(6000);
  } else {
    const ans = (await rl.question("  確認して「投稿する」を押し、完了したら Enter（s=スキップ, q=中断）> ")).trim().toLowerCase();
    if (ans === "q") break;
    if (ans === "s") {
      log("  スキップしました");
      continue;
    }
  }

  item.status = "posted";
  item.postedAt = new Date().toISOString();
  writeJson(queuePath, queue);
  processed++;
}

rl.close();
log(`終了（${processed}件処理）`);
if (!keepOpen) await ctx.close();
