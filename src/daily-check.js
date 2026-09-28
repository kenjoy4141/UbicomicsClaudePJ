/**
 * 1日2回（朝7時・夜19時）に状態を見て、機械でできる作業を進め、人間がやる作業を通知する。
 *
 *   node src/daily-check.js            … 自動の作業を実行して通知する
 *   node src/daily-check.js --dry      … 何をするかだけ表示（実行も通知もしない）
 *   node src/daily-check.js --no-auto  … 実行はせず、通知だけ
 *
 * Discordへの通知先は config/discord-webhook.json の {"url": "..."}（gitignore済み）。
 *
 * 自動でやること（ブラウザもログインも要らないものだけ）:
 *   - 生成済み（RAW_*）で仕上げが終わっていない作品の仕上げ（モザイク含む）
 *   - 仕上げ済みで英語版が無い作品の英語版ページ・Patreon素材づくり
 *   - BOOTH公開済みでPDFが無い作品のPDF化
 *   - Xのキューが少なくなったら、公開済み作品ぶんを補充
 *   - SDが空いていて作りだめが足りないときは、次の作品の生成を始める
 *
 * 人間がやること（通知するだけ）:
 *   - BOOTH・pixiv・Patreon・FANZAの公開ボタン
 *   - pixivの予約（タブを回して押す）
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, readJson, log, titleFromDir, ROOT } from "./lib.js";
import { loadWork } from "./work.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const noAuto = argv.includes("--no-auto") || dry;

// 前回の実行が終わっていないのに次が始まると、同じ作品を二重に仕上げてしまう。
// 30分以上前のロックは、落ちた実行の残骸とみなして無視する
const lockFile = path.join(ROOT, "data/daily-check.lock");
if (fs.existsSync(lockFile)) {
  const age = Date.now() - fs.statSync(lockFile).mtimeMs;
  if (age < 6 * 60 * 60 * 1000) {
    log(`前回の実行がまだ動いています（${Math.round(age / 60000)}分前に開始）。今回は何もしません`);
    process.exit(0);
  }
  log("古いロックが残っていたので消します");
}
if (!dry) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, new Date().toISOString(), "utf8");
  const unlock = () => { try { fs.unlinkSync(lockFile); } catch { /* 消えていれば良い */ } };
  process.on("exit", unlock);
  process.on("SIGINT", () => { unlock(); process.exit(130); });
}

const OUT = cfg.worksRoot;
const exists = (p) => p && fs.existsSync(p);
const dirOf = (title) => fs.readdirSync(OUT).find((d) => /^\d{3}_/.test(d) && titleFromDir(d) === title);
const variantFiles = fs.readdirSync(path.join(ROOT, "config/variants")).filter((f) => f.endsWith(".json"));
const variants = variantFiles.map((f) => ({ name: f.replace(/\.json$/, ""), ...readJson(path.join(ROOT, "config/variants", f)) }));

const done = [];   // 自動でやったこと
const todoItems = [];  // 人間がやること { text, due, cycle }
const notes = [];  // 参考情報
const fanzaWaiting = [];   // FANZA投稿待ちの作品
const patreonWaiting = []; // Patreon掲載待ちの作品
const boothWaiting = [];   // BOOTH出品待ちの作品

/**
 * 人間がやることを1件足す。
 * @param text  やること
 * @param due   期限の目安（"今日中" "今週中" "10月上旬" など）
 * @param cycle 周期（"1回だけ" "毎週" "3日ごと" "作品ごと" など）
 */
const todo = (text, due = "急ぎでない", cycle = "1回だけ") => todoItems.push({ text, due, cycle });
todo.push = (text) => todoItems.push({ text, due: "今日中", cycle: "1回だけ" }); // 旧コード互換

const run = (label, args, timeoutMs = 60 * 60 * 1000) => {
  if (noAuto) {
    done.push(`（--dry）${label}`);
    return true;
  }
  log(`▶ ${label}`);
  const r = spawnSync(process.execPath, args, {
    stdio: "inherit", timeout: timeoutMs,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.status === 0) {
    done.push(label);
    return true;
  }
  todo(`${label} が失敗（終了コード ${r.status}）。ログを確認してください`, "今日中", "都度");
  return false;
};

// ---------- 1. 生成済みで仕上げていない作品 ----------
for (const v of variants) {
  if (!v.title) continue;
  const raw = path.join(OUT, `RAW_${v.name}`);
  const built = dirOf(v.title);
  const pages = built && path.join(OUT, built, "01_本編");
  if (exists(raw) && !exists(pages)) {
    run(`${v.title}: 仕上げ（モザイク〜ZIP）`, [path.join(ROOT, "src/fanza-build.js"), "--variant", v.name, "--src", `RAW_${v.name}`]);
  }
}

// ---------- 2. 仕上げ済みで英語版が無い作品 ----------
for (const v of variants) {
  const built = v.title && dirOf(v.title);
  if (!built) continue;
  const workDir = path.join(OUT, built);
  if (!exists(path.join(workDir, "01_本編"))) continue;
  const enPages = path.join(workDir, "02_patreon_en", "pages");
  if (!exists(enPages)) {
    if (run(`${v.title}: 英語版ページ`, [path.join(ROOT, "src/patreon-fanza-en.js"), "--title", v.title, "--tab", v.tab, "--variant", v.name])) {
      run(`${v.title}: Patreon素材`, [path.join(ROOT, "src/patreon-fanza-assets.js"), "--title", v.title, "--tab", v.tab]);
    }
  }
  // Patreonの下書きはブラウザが要るので人間に回す
  const work = loadWork(v.title);
  if (exists(enPages) && !work?.patreon?.freeDraft) {
    patreonWaiting.push(v);
  }
}

// ---------- 3. FANZA・BOOTHの公開待ち ----------
const builtWorks = fs.readdirSync(OUT).filter((d) => /^\d{3}_/.test(d));
for (const d of builtWorks) {
  const title = titleFromDir(d);
  const work = loadWork(title);
  if (!work?.fanza?.workDir) continue;
  const workDir = path.join(OUT, d);
  if (!exists(path.join(workDir, `${title}.zip`))) continue;
  if (!work.fanzaPosted) fanzaWaiting.push({ dir: d, plan: work.fanzaPlan ?? null });
  if (!work.boothUrl) {
    const pdf = path.join(workDir, "03_booth", `${title}.pdf`);
    if (!exists(pdf)) {
      run(`${title}: BOOTH用PDF`, [path.join(ROOT, "src/make-booth-pdf-wrap.js"), "--title", title]);
    }
    boothWaiting.push(title);
  }
}

// ---------- 4. pixivのキュー ----------
const queue = readJson(path.join(ROOT, "data/queue.json"), { items: [] });
const pending = queue.items.filter((i) => i.status === "pending");
if (pending.length) {
  todo(`pixivの予約を押す（${pending.length}件たまっています）: node src\\pixiv-batch.js`, "今日中", "3日ごと");
} else {
  // BOOTH公開済みなのに pixiv に流していない作品があれば、キューを作る
  for (const d of builtWorks) {
    const title = titleFromDir(d);
    const work = loadWork(title);
    if (!work?.boothUrl) continue;
    const already = queue.items.some((i) => i.workTitle === title);
    if (already) continue;
    // 投稿用の画像とタグが無ければ、ここで用意する（以前は手作業だった）
    const pixivDir = path.join(OUT, d, "pixiv");
    const hasImages = exists(pixivDir)
      && fs.readdirSync(pixivDir).filter((f) => /\.jpe?g$/i.test(f)).length > 0;
    if (!hasImages) run(`${title}: pixiv用の画像を選ぶ`, [path.join(ROOT, "tools/pick-pixiv-images.mjs"), d]);
    const meta = readJson(path.join(OUT, d, "meta.json"));
    if (meta?.boothUrl) {
      run(`${title}: pixivキュー作成`, [path.join(ROOT, "src/build-queue.js"), d, "--days", "3", "--random"]);
      todo(`pixivの予約を押す（新しくキューを作りました）: node src\\pixiv-batch.js`, "今日中", "3日ごと");
      break;
    }
  }
}

// ---------- 5. Xのキュー ----------
const xq = readJson(path.join(ROOT, "data/x-queue.json"), []) ?? [];
const xPending = xq.filter((q) => !q.posted);
if (xPending.length <= 2) {
  const target = builtWorks.map((d) => titleFromDir(d)).find((t) => {
    const w = loadWork(t);
    return w?.patreon?.safePages?.length && (w.patreon.freeUrl || w.patreon.freeDraft);
  });
  if (target) run(`${target}: Xの投稿キューを補充`, [path.join(ROOT, "src/x-queue.js"), "--work", target, "--weeks", "2"]);
  else notes.push("Xのキューが残りわずかですが、補充できる作品（Patreonの無料投稿つき）がありません");
} else {
  notes.push(`Xのキュー: 残り${xPending.length}件`);
}

// ---------- 6. 作りだめ ----------
const stock = variants.filter((v) => v.title && exists(path.join(OUT, `RAW_${v.name}`)) && !dirOf(v.title)).length;
const unstarted = variants.filter((v) => v.title && !exists(path.join(OUT, `RAW_${v.name}`)) && !dirOf(v.title));
notes.push(`未仕上げの在庫: ${stock}本 / 未生成の企画: ${unstarted.length}本`);
if (stock === 0 && unstarted.length) {
  const next = unstarted[0];
  notes.push(`次に生成できる企画: ${next.title}（node src\\run-batch.js --variants ${next.name}）`);
}

// ---------- 7. 配信ペース ----------
const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const allWorks = builtWorks.map((d) => ({ dir: d, title: titleFromDir(d), work: loadWork(titleFromDir(d)) }));

// FANZA: AI作品は「1アカウントあたり」月3本まで。アカウントごとに空きを数える
const accounts = readJson(path.join(ROOT, "config/accounts.json")) ?? {};
const accountKeys = Object.keys(accounts).filter((k) => !k.startsWith("_"));
const usedByAccount = {};
for (const k of accountKeys) usedByAccount[k] = 0;
for (const w of allWorks) {
  if (!String(w.work?.fanzaPosted ?? "").startsWith(month)) continue;
  const acc = w.work?.fanzaAccount ?? "A";
  usedByAccount[acc] = (usedByAccount[acc] ?? 0) + 1;
}
const freeAccounts = accountKeys.filter((k) => (usedByAccount[k] ?? 0) < 3);
notes.push(`FANZAの今月の枠: ${accountKeys.map((k) => `${k}=${3 - (usedByAccount[k] ?? 0)}本`).join(" / ")}`);
// 来月以降に出すと決めた作品（fanzaPlan）は今月の候補から外す
const laterPlans = fanzaWaiting.filter((w) => w.plan?.month && w.plan.month > month);
const readyNow = fanzaWaiting.filter((w) => !(w.plan?.month && w.plan.month > month));
for (const w of laterPlans) notes.push(`${w.dir}：${w.plan.month} にアカウント${w.plan.account ?? "A"}で出す予定`);
if (readyNow.length) {
  if (freeAccounts.length) {
    const pairs = readyNow.slice(0, freeAccounts.length)
      .map((w, i) => `${w.dir}（${w.plan?.account ?? freeAccounts[i]}）`);
    todo(`FANZAに出す: ${pairs.join(" / ")}`, "今月中", "1アカウント月3本まで");
  } else {
    notes.push(`FANZAは全アカウントが今月ぶんを使い切っています。待機 ${readyNow.length}本は来月へ`);
  }
}

// BOOTH: 短期間に大量に並べない（ユーザー判断 2026-09-21）。前回から中5日空けて1本ずつ
const lastBooth = allWorks.map((w) => w.work?.boothPostedAt).filter(Boolean).sort().pop();
const boothDays = lastBooth ? Math.floor((now - new Date(lastBooth)) / 86400000) : 99;
if (boothWaiting.length) {
  if (boothDays >= 5) {
    todo(`BOOTHに出す: ${boothWaiting[0]}（PDF・商品画像は用意済み。残り${boothWaiting.length}本）`, "今週中", "5日ごとに1本");
  } else {
    notes.push(`BOOTHは${boothDays}日前に出したばかり。次は${5 - boothDays}日後（待機 ${boothWaiting.length}本）`);
  }
}

// Patreon: 無料は2日ごと（週３本）、有料は3日ごと。2026-09-26 ユーザー指定。
// 無料は発見・流入用なので多め、有料は在庫を消化しつつ継続課金の価値を残す
const FREE_GATE_DAYS = 2;
const PAID_GATE_DAYS = 3;
const lastOf = (key) => {
  const at = allWorks.map((w) => w.work?.patreon?.[key]).filter(Boolean).sort().pop();
  return at ? Math.floor((now - new Date(at)) / 86400000) : 99;
};
// 古い作品は publishedAt しか無いので、それも見る
const freeDays = Math.min(lastOf("freePublishedAt"), lastOf("publishedAt"));
const paidDays = Math.min(lastOf("premiumPublishedAt"), lastOf("publishedAt"));

const freeWaiting = patreonWaiting.filter((v) => !loadWork(v.title)?.patreon?.freePublishedAt);
const paidWaiting = patreonWaiting.filter((v) => !loadWork(v.title)?.patreon?.premiumPublishedAt);

if (freeWaiting.length) {
  if (freeDays >= FREE_GATE_DAYS) {
    const v = freeWaiting[0];
    todo(`Patreonに無料投稿: ${v.title}
    node src\patreon-draft.js --work "${v.title}" --kind free --publish --close`,
      "今日中", "2日ごと（週３本）");
  } else {
    notes.push(`Patreonの無料投稿は${freeDays}日前。次は${FREE_GATE_DAYS - freeDays}日後（待機 ${freeWaiting.length}本）`);
  }
}
if (paidWaiting.length) {
  if (paidDays >= PAID_GATE_DAYS) {
    const v = paidWaiting[0];
    todo(`Patreonに有料投稿: ${v.title}
    node src\patreon-draft.js --work "${v.title}" --kind premium --tiers "Premium" --sell 12 --publish --close`,
      "今日中", "3日ごと");
  } else {
    notes.push(`Patreonの有料投稿は${paidDays}日前。次は${PAID_GATE_DAYS - paidDays}日後（待機 ${paidWaiting.length}本）`);
  }
}

// ---------- 6. 作り直しが必要な作品を見つける ----------
// 生成枚数と仕上がりのページ数が合わない作品は、途中の素材で仕上がっている
for (const d of builtWorks) {
  const title = titleFromDir(d);
  const work = loadWork(title);
  const raw = work?.fanza?.rawDir;
  const moza = work?.fanza?.mozaDir;
  if (!raw || !moza || !exists(raw) || !exists(moza)) continue;
  const n = (p2) => fs.readdirSync(p2).filter((f) => /\.png$/i.test(f)).length;
  if (n(raw) !== n(moza)) {
    const v = variants.find((x) => x.title === title);
    todo(`${title}: 生成 ${n(raw)}枚に対してモザイクが ${n(moza)}枚。作り直しが必要
    node tools\rebuild-works.mjs --variants ${v?.name ?? "?"}`,
      "今日中", "気づいたとき");
  }
}

// ---------- 7. 進捗をスプレッドシートと STATUS.md に書き出す ----------
run("進捗をシートに書き出し", [path.join(ROOT, "src/sync-sheet.js")]);
run("STATUS.md を更新", [path.join(ROOT, "tools/write-status.mjs")]);

// ---------- 通知 ----------
const stamp = now.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const lines = [`**作業チェック ${stamp}**`];
if (done.length) lines.push("", "__自動で終わらせたこと__", ...done.map((d) => `✅ ${d}`));
if (todoItems.length) {
  lines.push("", "__あなたがやること__");
  // 期限が近い順に並べる
  const order = { "今日中": 0, "今週中": 1, "今週の配信ぶん": 1, "今月中": 2, "急ぎでない": 3 };
  todoItems.sort((a, b) => (order[a.due] ?? 3) - (order[b.due] ?? 3));
  for (const t of todoItems) lines.push(`▶ [${t.due}・${t.cycle}] ${t.text}`);
}
if (notes.length) lines.push("", "__状況__", ...notes.map((n) => `・${n}`));
if (!done.length && !todoItems.length) lines.push("", "やることはありません。");
const message = lines.join("\n");
console.log("\n" + message);

const hook = readJson(path.join(ROOT, "config/discord-webhook.json"))?.url;
if (dry) {
  log("--dry のため通知しません");
} else if (!hook) {
  log("! config/discord-webhook.json が無いので通知を飛ばせません");
} else if (todoItems.length || done.length) {
  const res = await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message.slice(0, 1900) }),
  });
  log(res.ok ? "Discordに通知しました" : `! 通知に失敗 ${res.status}`);
} else {
  log("報告することが無いので通知しません");
}
