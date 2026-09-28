/**
 * @ubicomics1 の現状を見る（投稿しない）。フォロワー数と直近の投稿の反応。
 *   node tools/x-stats.mjs
 */
import { loadCredentials, authHeader } from "../src/x-auth.js";

const cred = loadCredentials();

// OAuth 1.0a の署名は「URL本体」と「クエリをパラメータとして渡す」の2つに分ける。
// クエリ付きのURLをそのまま渡すと署名が合わず 401 になる
async function get(base, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${base}?${qs}` : base;
  const res = await fetch(url, { headers: { Authorization: authHeader(cred, "GET", base, params) } });
  const text = await res.text();
  if (!res.ok) { console.error(res.status, text.slice(0, 300)); process.exit(1); }
  return JSON.parse(text);
}

const me = await get("https://api.twitter.com/2/users/me", { "user.fields": "public_metrics,created_at,description" });
const u = me.data;
const m = u.public_metrics ?? {};
console.log(`@${u.username}（${u.name}）`);
console.log(`  フォロワー ${m.followers_count} / フォロー ${m.following_count} / 投稿 ${m.tweet_count}`);
console.log(`  開設 ${String(u.created_at).slice(0, 10)}`);
console.log(`  プロフィール: ${u.description}`);

const tl = await get(`https://api.twitter.com/2/users/${u.id}/tweets`, { max_results: "20", "tweet.fields": "public_metrics,created_at" });
console.log("\n直近の投稿:");
let imp = 0, n = 0;
for (const t of tl.data ?? []) {
  const p = t.public_metrics ?? {};
  imp += p.impression_count ?? 0; n++;
  console.log(`  ${String(t.created_at).slice(0, 10)}  表示${String(p.impression_count ?? 0).padStart(6)}  いいね${String(p.like_count).padStart(3)}  RT${String(p.retweet_count).padStart(3)}  ${t.text.split("\n")[0].slice(0, 32)}`);
}
if (n) console.log(`\n  平均表示 ${Math.round(imp / n)} / 投稿${n}本`);
