/**
 * X API の鍵が使えるかを確かめる（投稿はしない）。
 *
 *   node src/x-check.js
 *
 * - GET /2/users/me でアカウントを確認する
 * - 画像アップロードだけ試す（この時点では投稿されない。アップロードした画像は使わなければ消える）
 */
import path from "node:path";
import { loadWork } from "./work.js";
import { loadCredentials, authHeader, uploadMedia } from "./x-auth.js";
import { log } from "./lib.js";

const cred = loadCredentials();

const url = "https://api.twitter.com/2/users/me";
const res = await fetch(url, { headers: { Authorization: authHeader(cred, "GET", url) } });
const text = await res.text();
if (!res.ok) {
  console.error(`アカウント確認に失敗 ${res.status}: ${text.slice(0, 400)}`);
  console.error("401なら鍵の写し間違い、403なら権限（Read and write）かトークンの作り直し漏れ、402なら残高切れ");
  process.exit(1);
}
const me = JSON.parse(text).data;
log(`アカウント: @${me.username}（${me.name}）`);

// 画像アップロードまで通るか（＝書き込み権限があるか）を確かめる
const work = loadWork(process.argv[2] ?? "30日後にS○Xする女医さん");
const img = work?.patreon?.enDir && work.patreon.previews?.[0]
  ? path.join(work.patreon.enDir, "previews", "preview_1.jpg")
  : null;
if (!img) {
  log("画像アップロードの確認は飛ばしました（作品データが見つかりません）");
  process.exit(0);
}
try {
  const id = await uploadMedia(cred, img);
  log(`画像アップロード OK（media_id ${id}）→ 書き込み権限あり。投稿はしていません`);
} catch (e) {
  console.error(e.message);
  console.error("403なら Access Token が古い権限のままの可能性（Read and write に変更後、トークンを作り直す）");
  process.exit(1);
}
