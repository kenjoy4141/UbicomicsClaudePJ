/**
 * タブを複数開いて、キューの内容をまとめて埋める。
 * 埋め終わったらタブを回って「投稿する」を押していくだけ。
 * 押されたタブは自動で検知して posted になるので、どこまで押したか覚えなくていい。
 *
 *   node src/pixiv-batch.js              … pending を全部
 *   node src/pixiv-batch.js --max 5      … 先頭5件だけ
 *
 * pixivの予約投稿は同時に config.pixiv.maxReservations 件まで。
 * それを超える分は自動で次回に回される。
 *   node src/pixiv-batch.js --keep-open  … 終了時にブラウザを閉じない
 */
import path from "node:path";
import readline from "node:readline/promises";
import { loadConfig, openBrowser, readJson, writeJson, log, ROOT } from "./lib.js";
import { fillUploadForm, looksSubmitted } from "./fill-form.js";
import { execFileSync } from "node:child_process";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const keepOpen = argv.includes("--keep-open");
const maxOpt = argv.indexOf("--max");
const max = maxOpt >= 0 && argv[maxOpt + 1] ? Number(argv[maxOpt + 1]) : Infinity;

const queuePath = path.join(ROOT, "data/queue.json");
const queue = readJson(queuePath, { items: [] });
const allPending = queue.items.filter((it) => it.status === "pending");

// pixivの予約投稿は同時に一定数までしか持てない。超える分はここで切る。
const cap = cfg.pixiv.maxReservations ?? Infinity;
const limit = Math.min(max, cap);
const todo = allPending.slice(0, limit);

if (allPending.length > limit) {
  log(`予約投稿の上限が ${cap}件のため、先頭 ${limit}件だけを処理します（残り ${allPending.length - limit}件は pending のまま）`);
  log("公開されて枠が空いたら、もう一度このコマンドを実行してください。");
}

if (todo.length === 0) {
  log("処理対象がありません。先に build-queue.js を実行してください。");
  process.exit(0);
}

const { ctx, page: firstPage } = await openBrowser(cfg, { headless: false });

// pixivの予約は同時N件まで。実際の予約数を見て、入る分だけに絞る
let usable = todo;
try {
  await firstPage.goto("https://www.pixiv.net/manage/illusts", { waitUntil: "domcontentloaded" });
  await firstPage.waitForTimeout(6000);
  const current = await firstPage.evaluate(() => {
    const ids = new Set();
    for (const a of document.querySelectorAll('a[href*="illust_reserve_id"]')) {
      const m = a.getAttribute("href").match(/illust_reserve_id=(d+)/);
      if (m) ids.add(m[1]);
    }
    return ids.size;
  });
  const free = Math.max(0, (cfg.pixiv.maxReservations ?? Infinity) - current);
  log(`pixivの予約: 現在${current}件 / 上限${cfg.pixiv.maxReservations} → 空き${free}件`);
  if (todo.length > free) {
    usable = todo.slice(0, free);
    log(`空き枠に合わせて ${usable.length}件だけ処理します（残り ${todo.length - usable.length}件は次回）`);
  }
} catch (e) {
  log(`! 予約数を確認できませんでした。そのまま進めます: ${String(e?.message ?? e).split("\n")[0]}`);
}

if (usable.length === 0) {
  log("空き枠がありません。予約が公開されてから再実行してください。");
  await ctx.close();
  process.exit(0);
}

log(`${usable.length}件ぶんのタブを開いて埋めます。しばらく待ってください。`);

const tabs = [];
for (let i = 0; i < usable.length; i++) {
  const item = usable[i];
  const page = i === 0 ? firstPage : await ctx.newPage();
  try {
    await fillUploadForm(page, item, cfg, `  [${i + 1}/${usable.length}] `);
    await page.screenshot({ path: path.join(ROOT, `logs/${item.id}.png`), fullPage: true });
    tabs.push({ item, page, done: false });
  } catch (e) {
    log(`  [${i + 1}/${usable.length}] ${item.id}: 失敗 - ${e.message.split("\n")[0]}`);
    tabs.push({ item, page, done: false, failed: true });
  }
}

const ok = tabs.filter((t) => !t.failed).length;
console.log(`\n${"=".repeat(50)}`);
console.log(`${ok}/${usable.length}件のタブを準備しました。タブを順に回って「投稿する」を押してください。`);
console.log("押したタブは自動で検知します。\n");
tabs.forEach((t, i) => {
  console.log(`  タブ${i + 1}  ${t.item.scheduledAt ?? "予約なし"}  ${t.item.title}${t.failed ? "  ← 入力失敗。手動で確認して" : ""}`);
});
console.log(`${"=".repeat(50)}\n`);

// --- 投稿されたタブを検知しつづける ---
let watching = true;
const watcher = (async () => {
  while (watching) {
    for (const t of tabs) {
      if (t.done) continue;
      if (t.page.isClosed()) {
        if (!t.warnedClosed) {
          t.warnedClosed = true;
          log(`! タブが閉じられました（未投稿のまま）: ${t.item.title}`);
        }
        continue;
      }
      if (looksSubmitted(t.page)) {
        t.done = true;
        t.item.status = "posted";
        t.item.postedAt = new Date().toISOString();
        writeJson(queuePath, queue);
        const rest = tabs.filter((x) => !x.done).length;
        log(`投稿を検知: ${t.item.title}（残り ${rest}件）`);
      }
    }
    if (tabs.every((t) => t.done || t.page.isClosed())) {
      log("全部投稿されました。");
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
})();

// 対話できる端末なら Enter で終了できるようにする。
// バックグラウンド実行など標準入力が無い場合は、全部投稿されるまで待ち続ける
// （ここで即終了するとブラウザが閉じてしまい、投稿ボタンを押せなくなるため）。
if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("全部押し終わった、または中断する場合は Enter > ");
  watching = false;
  rl.close();
} else {
  log("対話端末ではないので、全件が投稿されるまで待機します（中断はこのプロセスを終了してください）");
  await watcher.catch(() => {});
}
await watcher.catch(() => {});

const posted = tabs.filter((t) => t.done).length;
writeJson(queuePath, queue);
log(`終了: ${posted}件を投稿済みにしました。残り ${tabs.length - posted}件は pending のままです。`);
const closed = tabs.filter((t) => !t.done && t.page.isClosed());
if (closed.length) {
  log(`うち ${closed.length}件はタブが閉じられたため未投稿です:`);
  closed.forEach((t) => log(`  - ${t.item.title}`));
}
log("実際に予約されたかは node src/sync-queue.js で突き合わせられます。");

if (!keepOpen) {
  await ctx.close();
  // タブの検知は目安にすぎないので、最後に pixiv の予約一覧を正として突き合わせる
  log("pixivの予約一覧と突き合わせています...");
  try {
    const out = execFileSync("node", [path.join(ROOT, "src/sync-queue.js")], { encoding: "utf8" });
    console.log(out.trim());
  } catch (e) {
    log("! 突き合わせに失敗しました。node src/sync-queue.js を手動で実行してください");
  }
}
