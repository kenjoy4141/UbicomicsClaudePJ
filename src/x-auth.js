/**
 * X API の OAuth 1.0a 署名。鍵は config/x-credentials.json（gitignore済み）から読む。
 * 鍵の中身はログにも画面にも出さない。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readJson, ROOT } from "./lib.js";

export function loadCredentials() {
  const file = path.join(ROOT, "config/x-credentials.json");
  const cred = readJson(file);
  const missing = ["appKey", "appSecret", "accessToken", "accessSecret"].filter((k) => !cred?.[k]);
  if (missing.length) {
    console.error(`config/x-credentials.json の項目が足りません: ${missing.join(", ")}`);
    process.exit(1);
  }
  return cred;
}

const enc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** OAuth 1.0a の Authorization ヘッダを組み立てる。params はフォーム/クエリのパラメータ */
export function authHeader(cred, method, url, params = {}) {
  const oauth = {
    oauth_consumer_key: cred.appKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: cred.accessToken,
    oauth_version: "1.0",
  };
  const all = { ...oauth, ...params };
  const base = [method.toUpperCase(), enc(url), enc(Object.keys(all).sort().map((k) => `${enc(k)}=${enc(all[k])}`).join("&"))].join("&");
  const key = `${enc(cred.appSecret)}&${enc(cred.accessSecret)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(", ");
}

/**
 * 画像を1枚アップロードして media_id を返す。
 * v1.1 の upload.twitter.com は2025年6月に廃止されたので、v2 の /2/media/upload を使う。
 * multipart で送るとき、OAuth 1.0a の署名対象にボディのパラメータは含めない。
 */
export async function uploadMedia(cred, file) {
  const url = "https://api.x.com/2/media/upload";
  const form = new FormData();
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const type = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";
  form.append("media", new Blob([buf], { type }), path.basename(file));
  form.append("media_category", "tweet_image");

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader(cred, "POST", url) },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`画像アップロード失敗 ${res.status}: ${text.slice(0, 300)}`);
  const j = JSON.parse(text);
  return j.data?.id ?? j.media_id_string ?? j.id;
}

export async function postTweet(cred, text, mediaIds = []) {
  const url = "https://api.twitter.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader(cred, "POST", url), "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`投稿失敗 ${res.status}: ${body.slice(0, 300)}`);
  const data = JSON.parse(body).data;
  // 投稿IDは19桁あり、数値として読むと末尾が丸まる。生のJSONから文字列のまま取り出す
  const raw = body.match(/"id"\s*:\s*"?(\d+)"?/);
  return { ...data, id: raw ? raw[1] : String(data.id) };
}
