/**
 * いまの状況を STATUS.md に書き出す。セッションが切れても、これを読めば続きから動ける。
 *
 *   node tools/write-status.mjs
 *
 * daily-check から毎日2回呼ばれる。手で書き換えないこと（上書きされる）。
 * 積み上げたノウハウは CLAUDE.md に書く。こちらは「いまの状態」だけ。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, readJson, titleFromDir, accountFromDir, log, ROOT } from "../src/lib.js";
import { loadWork } from "../src/work.js";

const cfg = loadConfig();
const OUT = cfg.worksRoot;
const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const exists = (p) => fs.existsSync(p);
const countJpg = (p) => (exists(p) ? fs.readdirSync(p).filter((f) => /\.jpe?g$/i.test(f)).length : 0);
const countPng = (p) => (exists(p) ? fs.readdirSync(p).filter((f) => /\.png$/i.test(f)).length : 0);

const accounts = readJson(path.join(ROOT, "config/accounts.json")) ?? {};
const accountKeys = Object.keys(accounts).filter((k) => !k.startsWith("_"));
const variants = fs.readdirSync(path.join(ROOT, "config/variants"))
  .map((f) => ({ name: f.replace(/\.json$/, ""), ...readJson(path.join(ROOT, "config/variants", f)) }));

const dirs = fs.readdirSync(OUT).filter((d) => /^\d{3}_/.test(d)).sort();
const rows = [];
const used = Object.fromEntries(accountKeys.map((k) => [k, 0]));
for (const d of dirs) {
  const title = titleFromDir(d);
  const work = loadWork(title) ?? {};
  const pages = countJpg(path.join(OUT, d, "01_本編"));
  if (!pages) continue;
  const zip = fs.readdirSync(path.join(OUT, d)).some((f) => /\.zip$/i.test(f));
  const acc = accountFromDir(d) ?? work.fanzaAccount ?? "-";
  if (String(work.fanzaPosted ?? "").startsWith(month)) used[work.fanzaAccount ?? acc] ??= 0, used[work.fanzaAccount ?? acc]++;
  rows.push({
    no: d.slice(0, 3), acc, title, pages, zip,
    fanza: work.fanzaPosted ?? "", booth: work.boothUrl ? "済" : "",
    plan: work.fanzaPlan ? `${work.fanzaPlan.month}/${work.fanzaPlan.account}` : "",
  });
}

// 生成は済んでいるが仕上げていないもの
const waitingBuild = fs.readdirSync(OUT)
  .filter((d) => /^RAW_/.test(d) && countPng(path.join(OUT, d)) > 0)
  .map((d) => `${d.replace(/^RAW_/, "")}（${countPng(path.join(OUT, d))}枚）`);

const queue = readJson(path.join(ROOT, "data/queue.json"), { items: [] });
const xq = readJson(path.join(ROOT, "data/x-queue.json"), []) ?? [];

const L = [];
L.push("# いまの状況（自動生成）");
L.push("");
L.push(`最終更新: ${now.toLocaleString("ja-JP")}　/　`
  + "このファイルは `node tools/write-status.mjs` が上書きします。手で書かないこと。");
L.push("ノウハウ・踏んだ罠は CLAUDE.md に書く。ここは状態だけ。");
L.push("");
L.push("## FANZAの枠（1アカウント月3本）");
L.push("");
L.push("| アカ | サークル | モデル | 画風 | 今月 | 残り |");
L.push("|---|---|---|---|---|---|");
for (const k of accountKeys) {
  const a = accounts[k];
  L.push(`| ${k} | ${a.circle ?? "-"} | ${a.model} | ${a.stylePreset ?? cfg.sd.stylePreset ?? "-"} | ${used[k] ?? 0}本 | ${3 - (used[k] ?? 0)}本 |`);
}
L.push("");
L.push("## 作品");
L.push("");
L.push("| 番号 | アカ | 作品 | 頁 | ZIP | FANZA | BOOTH | 予定 |");
L.push("|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  L.push(`| ${r.no} | ${r.acc} | ${r.title.slice(0, 30)} | ${r.pages} | ${r.zip ? "○" : "×"} | ${r.fanza || "-"} | ${r.booth || "-"} | ${r.plan || "-"} |`);
}
L.push("");
L.push("## 待ち行列");
L.push("");
L.push(`- 仕上げ待ち（生成済み）: ${waitingBuild.length ? waitingBuild.join(" / ") : "なし"}`);
L.push(`- pixiv: 未投稿 ${queue.items.filter((i) => i.status === "pending").length}件 / 投稿済み ${queue.items.filter((i) => i.status === "posted").length}件`);
L.push(`- X: 未投稿 ${xq.filter((q) => !q.posted).length}件`);
L.push("");
L.push("## 作品ごとの設定（variant）");
L.push("");
L.push("| 名前 | アカ | タイトル | 1ビートの枚数 |");
L.push("|---|---|---|---|");
for (const v of variants) {
  if (!v.title) continue;
  let per = "-";
  try {
    const sb = v.introStoryboard ? readJson(path.join(ROOT, v.introStoryboard)) : null;
    per = sb ? String(sb.beats?.[0]?.poses?.length ?? sb.imagesPerBeat ?? "-") : "-";
  } catch { /* 読めなければそのまま */ }
  L.push(`| ${v.name} | ${v.account ?? "-"} | ${v.title.slice(0, 30)} | ${per} |`);
}
L.push("");

fs.writeFileSync(path.join(ROOT, "STATUS.md"), L.join("\n"), "utf8");
log(`STATUS.md を更新しました（作品 ${rows.length}件）`);
