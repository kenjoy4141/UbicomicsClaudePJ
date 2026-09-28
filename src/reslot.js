/**
 * キューの予約日時を割り当て直す。
 * 複数作品を交互に流したいとき（同じキャラが連続して並ぶのを避けたいとき）に使う。
 *
 *   node src/reslot.js                 … 作品を交互に並べて枠を割り当てる
 *   node src/reslot.js --order sequential  … 作品ごとにまとめて並べる
 *   node src/reslot.js --days 6        … 割り当てる日数の上限
 *   node src/reslot.js --show          … 変更せず結果だけ表示
 *   node src/reslot.js --from 2026-09-29   … この日以降の枠に割り当てる（pixiv側に予約が残っているとき）
 *
 * 予約枠は config.schedule（平日/休日の時刻）から取る。pixivは30分刻みのみ。
 */
import path from "node:path";
import { loadConfig, readJson, writeJson, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const pad2 = (n) => String(n).padStart(2, "0");
const fmtDate = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

const queuePath = path.join(ROOT, "data/queue.json");
const queue = readJson(queuePath, { items: [] });
const pending = queue.items.filter((it) => it.status === "pending");

if (pending.length === 0) {
  log("pending の項目がありません。先に build-queue.js を実行してください。");
  process.exit(0);
}

// ---------- 作品ごとにまとめる ----------
const groups = new Map();
for (const it of pending) {
  if (!groups.has(it.workName)) groups.set(it.workName, []);
  groups.get(it.workName).push(it);
}
log(`${groups.size}作品 / 合計 ${pending.length}投稿`);
for (const [k, v] of groups) log(`  ${k}: ${v.length}投稿`);

// ---------- 並び順を決める ----------
const order = opt("order", "interleave");
let ordered = [];
if (order === "sequential") {
  for (const v of groups.values()) ordered.push(...v);
} else {
  // 交互（ラウンドロビン）。作品が3つ以上でも順番に回る
  const lists = [...groups.values()];
  const max = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const l of lists) if (l[i]) ordered.push(l[i]);
  }
}

// ---------- 既に埋まっている枠 ----------
// 投稿済み(posted)がその時刻を使っているので、二重に割り当てない
const taken = new Set(
  queue.items.filter((it) => it.status === "posted" && it.scheduledAt).map((it) => it.scheduledAt)
);
if (taken.size) log(`既に使われている枠: ${taken.size}個（避けて割り当てます）`);

// ---------- 枠を作る ----------
const maxDays = Number(opt("days", 60));
const slots = [];
// --from YYYY-MM-DD で割り当ての開始日を指定できる。
// pixiv側にこのキューが知らない予約が入っているときに使う
const fromOpt = opt("from");
const start = fromOpt ? new Date(`${fromOpt}T00:00:00`) : new Date();
if (fromOpt && Number.isNaN(start.getTime())) {
  console.error(`! --from の日付が読めません: ${fromOpt}（例: --from 2026-09-29）`);
  process.exit(1);
}
if (!fromOpt && cfg.schedule.startTomorrow) start.setDate(start.getDate() + 1);
start.setHours(0, 0, 0, 0);
if (fromOpt) log(`${fromOpt} 以降の枠に割り当てます`);

for (let day = 0; slots.length < ordered.length && day < maxDays; day++) {
  const d = new Date(start);
  d.setDate(d.getDate() + day);
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
  for (const t of isWeekend ? cfg.schedule.weekend : cfg.schedule.weekday) {
    if (slots.length >= ordered.length) break;
    const [h, m] = t.split(":").map(Number);
    const at = new Date(d);
    at.setHours(h, m, 0, 0);
    if (at <= new Date()) continue;
    if (taken.has(fmtDate(at))) continue;
    slots.push(at);
  }
}

if (slots.length < ordered.length) {
  log(`! 枠が ${slots.length}個しかありません（必要 ${ordered.length}個）。あふれた分は予約なしになります`);
}

// ---------- 割り当て ----------
const fmt = fmtDate;

ordered.forEach((it, i) => { it.scheduledAt = slots[i] ? fmt(slots[i]) : null; });

console.log(`\n並び順: ${order === "sequential" ? "作品ごとにまとめる" : "交互"}\n`);
let lastDate = "";
for (const it of ordered) {
  const date = (it.scheduledAt ?? "").slice(0, 10);
  if (date !== lastDate) {
    const wd = date ? "日月火水木金土"[new Date(date).getDay()] : "";
    console.log(`  ── ${date || "(予約なし)"} ${wd ? `(${wd})` : ""}`);
    lastDate = date;
  }
  console.log(`     ${(it.scheduledAt ?? "").slice(11) || "  --  "}  ${it.title}`);
}

if (flag("show")) {
  log("\n--show のため保存していません。");
  process.exit(0);
}

writeJson(queuePath, queue);
log(`\n割り当てました: ${ordered.filter((i) => i.scheduledAt).length}/${ordered.length}件`);
log("次: node src/pixiv-batch.js");
