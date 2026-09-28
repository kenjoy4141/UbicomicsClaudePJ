import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config/config.json"), "utf8"));
  cfg.profileDir = path.resolve(ROOT, cfg.profileDir);
  return cfg;
}

/**
 * ログイン状態を保持したブラウザを開く。
 * 永続プロファイルなので、一度手動ログインすれば以降は素通りできる。
 */
export async function openBrowser(cfg, { headless = cfg.headless, profile = null } = {}) {
  // profile を渡すと data/browser-profile-<profile> を使う。
  // FANZAは複数アカウントを使い分けるので、アカウントごとにログイン状態を分ける必要がある
  const dir = profile ? `${cfg.profileDir}-${profile}` : cfg.profileDir;
  const ctx = await chromium.launchPersistentContext(dir, {
    headless,
    slowMo: cfg.slowMo ?? 0,
    viewport: { width: 1440, height: 950 },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page };
}

/**
 * セッションCookie（ブラウザを閉じると消えるもの）をファイルに退避・復元する。
 * DMMのログインは login_session_id というセッションCookieを使うので、
 * プロファイルを使い回すだけではログイン状態が続かない。
 */
export function cookieFile(profile) {
  return path.join(ROOT, "data", `cookies-${profile}.json`);
}

/** いま開いているブラウザのCookieを丸ごと保存する */
export async function saveCookies(ctx, profile) {
  try {
    const cookies = await ctx.cookies();
    if (!cookies.length) return 0;
    fs.writeFileSync(cookieFile(profile), JSON.stringify(cookies, null, 2), "utf8");
    return cookies.length;
  } catch {
    return 0;   // ブラウザが閉じかけのときは失敗する。無視してよい
  }
}

/** 保存しておいたCookieを注入する。期限切れのものは捨てる */
export async function restoreCookies(ctx, profile) {
  const f = cookieFile(profile);
  if (!fs.existsSync(f)) return 0;
  const now = Date.now() / 1000;
  const cookies = JSON.parse(fs.readFileSync(f, "utf8"))
    .filter((c) => !c.expires || c.expires < 0 || c.expires > now);
  if (!cookies.length) return 0;
  await ctx.addCookies(cookies);
  return cookies.length;
}

export function log(...args) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  console.log(`[${ts}]`, ...args);
}

export function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

export function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** フォルダ内の画像を名前順で返す */
export function listImages(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && IMG_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => a.localeCompare(b, "ja"));
}

/**
 * 作品フォルダの名前。アカウントを使い分けるので、番号の次にアカウント名を入れる。
 *   016_30日後に…            … アカウント指定なし（既存作品）
 *   025_B_私がお届けものです…  … アカウントB
 */
export function workDirName(no, account, title) {
  return account ? `${no}_${account}_${title}` : `${no}_${title}`;
}

/** 作品フォルダ名から作品名を取り出す（アカウント名が入っていても取れる） */
export function titleFromDir(dir) {
  const m = String(dir).match(/^\d{3}_(?:([A-Z])_)?(.+)$/);
  return m ? m[2] : dir;
}

/** 作品フォルダ名からアカウント名を取り出す。無ければ null */
export function accountFromDir(dir) {
  return String(dir).match(/^\d{3}_([A-Z])_/)?.[1] ?? null;
}
