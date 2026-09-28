/**
 * Google スプレッドシートの読み書き。
 *
 * サービスアカウントのJSON鍵で認証する。外部ライブラリは使わず、
 * JWTを自前で署名してアクセストークンに交換している（依存を増やさないため）。
 *
 * 準備:
 *   1. config/google-service-account.json に鍵を置く
 *   2. スプレッドシートを、その鍵の client_email に「編集者」で共有する
 *
 * 動作確認:
 *   node src/sheets.js --check
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadConfig, log, ROOT } from "./lib.js";

const KEY_PATH = path.join(ROOT, "config/google-service-account.json");
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let cachedToken = null;

export function hasCredentials() {
  return fs.existsSync(KEY_PATH);
}

function loadKey() {
  if (!hasCredentials()) {
    throw new Error(
      `サービスアカウントの鍵がありません: ${KEY_PATH}\n` +
      "Google Cloud で作成したJSON鍵をこのパスに置いてください。"
    );
  }
  return JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** サービスアカウントのJWTを作ってアクセストークンに交換する */
async function getToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value;

  const key = loadKey();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = b64url(signer.sign(key.private_key));
  const assertion = `${header}.${claims}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`トークン取得に失敗: ${body.error} ${body.error_description ?? ""}`);
  }
  cachedToken = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

async function api(url, init = {}) {
  const token = await getToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? res.statusText;
    if (res.status === 403) {
      throw new Error(
        `${msg}\n→ スプレッドシートをサービスアカウントのメールアドレスに「編集者」で共有しているか確認してください。`
      );
    }
    throw new Error(`Sheets API エラー (${res.status}): ${msg}`);
  }
  return body;
}

const base = (id) => `https://sheets.googleapis.com/v4/spreadsheets/${id}`;

/** シートの情報（タブ名とgid）を取る */
export async function getInfo(spreadsheetId) {
  const r = await api(`${base(spreadsheetId)}?fields=properties.title,sheets.properties`);
  return {
    title: r.properties.title,
    sheets: r.sheets.map((s) => ({
      title: s.properties.title,
      gid: s.properties.sheetId,
      rows: s.properties.gridProperties?.rowCount,
      cols: s.properties.gridProperties?.columnCount,
    })),
  };
}

/**
 * 範囲を読む  例: readRange(id, "pixiv_100_MB!A1:R110")
 * formulas: true にすると、計算結果ではなく数式そのものを返す
 */
export async function readRange(spreadsheetId, range, { formulas = false } = {}) {
  const q = formulas ? "?valueRenderOption=FORMULA" : "";
  const r = await api(`${base(spreadsheetId)}/values/${encodeURIComponent(range)}${q}`);
  return r.values ?? [];
}

/** 範囲を書き換える（既存の値を上書き） */
export async function writeRange(spreadsheetId, range, values) {
  return api(
    `${base(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values }) }
  );
}

/** 末尾に行を追加する */
export async function appendRows(spreadsheetId, range, values) {
  return api(
    `${base(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values }) }
  );
}

/** タブが無ければ作る。あれば何もしない */
export async function ensureTab(spreadsheetId, title) {
  const info = await getInfo(spreadsheetId);
  const hit = info.sheets.find((s) => s.title === title);
  if (hit) return hit.gid;

  const r = await api(`${base(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  return r.replies[0].addSheet.properties.sheetId;
}

/** 1行目を見出しとして固定し、太字にする */
export async function styleHeader(spreadsheetId, gid, cols) {
  return api(`${base(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId: gid, dimension: "COLUMNS", startIndex: 0, endIndex: cols },
          },
        },
      ],
    }),
  });
}

// ---------- 動作確認 ----------
if (process.argv.includes("--check")) {
  const cfg = loadConfig();
  if (!hasCredentials()) {
    console.error(`鍵がありません: ${KEY_PATH}`);
    console.error("手順は README の「スプレッドシートの書き込み」を見てください。");
    process.exit(1);
  }
  const key = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
  console.log("サービスアカウント:", key.client_email);
  console.log("→ このアドレスにシートを「編集者」で共有しておく必要があります\n");

  try {
    const info = await getInfo(cfg.sheet.id);
    console.log("接続OK:", info.title);
    console.log("タブ一覧:");
    info.sheets.forEach((s) => console.log(`  ${s.title}  (gid=${s.gid}, ${s.rows}行 x ${s.cols}列)`));
  } catch (e) {
    console.error("\n失敗:", e.message);
    process.exit(1);
  }
}
