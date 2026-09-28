/**
 * data/x-queue.json の投稿を X API で出す（@ubicomics1）。
 *
 *   node src/x-post.js --dry          … 出す予定のものを表示するだけ（既定）
 *   node src/x-post.js --post         … 予定時刻を過ぎたものを実際に投稿する
 *   node src/x-post.js --post --limit 1
 *
 * 鍵は config/x-credentials.json に置く（gitignore 済み）:
 *   { "appKey": "...", "appSecret": "...", "accessToken": "...", "accessSecret": "..." }
 * Developer Portal の App は「Read and write」権限にしておくこと。
 *
 * センシティブ設定は投稿ごとのAPI項目が無いので、アカウント設定の
 * 「投稿するメディアをセンシティブな内容を含むものとして設定する」をオンにしておく（1回だけ）。
 * オフのままだとX側の規約違反になるため、このスクリプトは設定の確認を促す。
 */
import path from "node:path";
import { readJson, writeJson, log, ROOT } from "./lib.js";
import { loadCredentials, uploadMedia, postTweet } from "./x-auth.js";

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const doPost = argv.includes("--post");
const limit = Number(opt("limit", 99));

const queueFile = path.join(ROOT, "data/x-queue.json");
const queue = readJson(queueFile, []) ?? [];
const now = new Date();
// --now: 予定時刻を待たずに、先頭の未投稿を対象にする（動作確認用）
const pending = queue.filter((q) => !q.posted).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
const due = (argv.includes("--now") ? pending : pending.filter((q) => new Date(q.scheduledAt) <= now)).slice(0, limit);

if (!due.length) {
  const next = queue.filter((q) => !q.posted).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  log(next ? `今出すものはありません。次は ${new Date(next.scheduledAt).toLocaleString("ja-JP")}` : "キューが空です");
  process.exit(0);
}

if (!doPost) {
  log(`--dry（既定）: ${due.length}件が対象。実際に投稿するには --post を付けてください`);
  for (const q of due) {
    console.log(`\n--- ${new Date(q.scheduledAt).toLocaleString("ja-JP")} [${q.type}] ${q.images.map((i) => path.basename(i)).join(", ")}`);
    console.log(q.text);
  }
  process.exit(0);
}

const cred = loadCredentials();

log("センシティブ設定（アカウント設定のメディア設定）がオンになっている前提で投稿します");
for (const q of due) {
  try {
    const ids = [];
    for (const img of q.images) ids.push(await uploadMedia(cred, img));
    const data = await postTweet(cred, q.text, ids);
    q.posted = true;
    q.postedAt = new Date().toISOString();
    q.url = `https://x.com/ubicomics1/status/${data.id}`;
    log(`投稿しました [${q.type}] ${q.url}`);
  } catch (e) {
    q.error = e.message;
    log(`! 失敗 [${q.type}] ${e.message}`);
  }
  writeJson(queueFile, queue);
}
