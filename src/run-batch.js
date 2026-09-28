/**
 * 複数の作品を順番に生成して、生成画像をまとめておく（留守中の作りだめ用）。
 *
 *   node src/run-batch.js --variants miko,jokyoshi,bar
 *   node src/run-batch.js --variants ... --build    … 生成のあと仕上げ（モザイク）まで続ける
 *
 * 既定では **生成とまとめ（stage）だけ** を行い、モザイク以降はやらない。
 * モザイクツールは画面操作で動くため、PCがロックされていると失敗するため。
 * 帰ってきてから `node src/fanza-build.js --variant <名前> --src RAW_<名前>` で仕上げる。
 *
 * 進み具合は logs/batch.log と data/batch-state.json に残るので、途中で止まっても再開できる。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, readJson, writeJson, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);

// 二重起動を止める。同じ日付フォルダに2本が同時に書くと、画像が混ざって復旧が大変になる
const lockFile = path.join(ROOT, "data/run-batch.lock");
if (fs.existsSync(lockFile) && !argv.includes("--force")) {
  const lock = readJson(lockFile) ?? {};
  let alive = false;
  try { process.kill(lock.pid, 0); alive = true; } catch { alive = false; }
  if (alive) {
    console.error(`! すでに生成バッチが走っています（pid ${lock.pid} / ${lock.at}）`);
    console.error("  終わるまで待つか、そのプロセスを止めてから実行してください");
    process.exit(1);
  }
  log("古いロックが残っていたので無視します");
}
writeJson(lockFile, { pid: process.pid, at: new Date().toISOString(), variants: argv.join(" ") });
const releaseLock = () => { try { fs.unlinkSync(lockFile); } catch {} };
process.on("exit", releaseLock);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { releaseLock(); process.exit(1); });
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const variants = (opt("variants") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const withBuild = argv.includes("--build");
if (!variants.length) {
  console.error("使い方: node src/run-batch.js --variants miko,jokyoshi,bar [--build]");
  process.exit(1);
}

const stateFile = path.join(ROOT, "data/batch-state.json");
const state = readJson(stateFile, {}) ?? {};
const logFile = path.join(ROOT, "logs/batch.log");
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const note = (...a) => {
  const line = `[${new Date().toISOString().slice(0, 19).replace("T", " ")}] ${a.join(" ")}`;
  console.log(line);
  // ログに書けなくても処理は止めない（別プロセスが同じファイルを開いているとWindowsではEBUSYになる）
  try {
    fs.appendFileSync(logFile, line + "\n", "utf8");
  } catch { /* 画面には出ているので無視する */ }
};

const node = process.execPath;
const runStep = (name, args) => {
  note(`▶ ${name}`);
  const r = spawnSync(node, args, { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (r.status !== 0) throw new Error(`${name} が失敗しました（終了コード ${r.status}）`);
};

/** 失敗しても止めない版。成功したかどうかを返す */
const tryStep = (name, args) => {
  note(`▶ ${name}`);
  const r = spawnSync(node, args, { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (r.status !== 0) note(`  …${name} は失敗（終了コード ${r.status}）`);
  return r.status === 0;
};

/** そのタブで作られる画像の枚数（R列の合計）。導入の枚数を変えると総数も変わるため */
function expectedImages(V) {
  try {
    const r = spawnSync(node, ["-e", `
      import("./src/lib.js").then(async ({ loadConfig }) => {
        const { readRange } = await import("./src/sheets.js");
        const cfg = loadConfig();
        const rows = await readRange(cfg.sheet.id, "${V.tab}!A1:S1000");
        let n = 0;
        for (let i = 3; i < rows.length; i++) {
          if (!String(rows[i]?.[16] ?? "").trim()) continue;
          n += Number(rows[i]?.[17]) || 1;
        }
        console.log(n);
      });`], { encoding: "utf8", cwd: ROOT });
    return Number(String(r.stdout).trim()) || 500;
  } catch {
    return 500;
  }
}

/** 生成した画像が入っている日付フォルダ（またぐことがあるので2日ぶん見る） */
const dateFolders = () => {
  const d = new Date();
  const fmt = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(d.getTime() - 86400000);
  return [fmt(yesterday), fmt(d)].filter((n) => fs.existsSync(path.join(cfg.worksRoot, n)));
};

for (const v of variants) {
  const conf = path.join(ROOT, "config/variants", `${v}.json`);
  if (!fs.existsSync(conf)) {
    note(`! 定義がありません: ${conf}`);
    continue;
  }
  const V = readJson(conf);
  const raw = `RAW_${v}`;
  const rawDir = path.join(cfg.worksRoot, raw);
  // 生成済みなら生成は飛ばす。ただし --build のときは仕上げだけ進める。
  // 判定は「RAW_ フォルダが実在するか」を優先する（記録より実物。手でまとめた作品は記録が無いため）
  const staged = fs.existsSync(rawDir) && fs.readdirSync(rawDir).filter((f) => /\.png$/i.test(f)).length > 0;
  if (staged && !state[v]?.staged) {
    state[v] = { ...(state[v] ?? {}), staged: true, raw, title: V.title, at: new Date().toISOString() };
    writeJson(stateFile, state);
    note(`= ${v}: RAW_${v} があるので生成済みとして扱います`);
  }
  const alreadyStaged = staged;
  if (alreadyStaged && (!withBuild || state[v]?.built)) {
    note(`= ${v}（${V.title}）は${state[v]?.built ? "仕上げまで" : "生成"}済みなので飛ばします`);
    continue;
  }
  note(`=== ${v}: ${V.title} ===`);
  try {
    if (!alreadyStaged) {
      // 1. 派生タブ（無ければ作る。既にあれば上書きされるだけ）
      runStep(`${v}: タブ作成`, [path.join(ROOT, "src/make-variant-tab.js"), "--variant", v]);

      // 2. 生成（約4時間）
      const before = dateFolders();
      const account = opt("account", V.account ?? null);
      runStep(`${v}: 500枚生成${account ? `（アカウント${account}）` : ""}`,
        [path.join(ROOT, "src/sd-generate.js"), "--tab", V.tab, ...(account ? ["--account", account] : [])]);

      // 3. 日付フォルダをまとめる（日付をまたいでいても拾う）
      const dates = [...new Set([...before, ...dateFolders()])];
      // 導入の枚数を変えると合計も変わるので、シートの枚数（R列の合計）を想定枚数にする
      // 枚数が合わない（前の作品の残りが混ざっているなど）ときは、
      // プロンプトを見てこの作品の分だけ拾う道具に切り替える
      const staged = tryStep(`${v}: 画像をまとめる`, [path.join(ROOT, "src/fanza-stage.js"), "--dates", dates.join(","), "--out", raw,
        "--expected", String(expectedImages(V))]);
      if (!staged) {
        note(`${v}: 枚数が合わないので、プロンプトで仕分けます`);
        for (const d of dates) {
          if (tryStep(`${v}: ${d} から仕分け`, [path.join(ROOT, "tools/recover-mixed.mjs"), "--variant", v, "--date", d])) break;
        }
      }

      state[v] = { staged: true, raw, title: V.title, at: new Date().toISOString() };
      writeJson(stateFile, state);
      note(`✓ ${v} 生成完了 → ${rawDir}`);
    }

    if (withBuild) {
      runStep(`${v}: 仕上げ`, [path.join(ROOT, "src/fanza-build.js"), "--variant", v, "--src", raw]);
      state[v].built = true;
      writeJson(stateFile, state);
      note(`✓ ${v} 仕上げ完了`);
    }
  } catch (e) {
    note(`! ${v} で中断: ${e.message}`);
    state[v] = { ...(state[v] ?? {}), error: e.message, at: new Date().toISOString() };
    writeJson(stateFile, state);
    // 次の作品へ進む（1本コケても残りを作る）
  }
}
note("バッチ終了");
