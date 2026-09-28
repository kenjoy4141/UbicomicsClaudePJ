/**
 * 手動ログイン用。ブラウザが開くので自分で pixiv / BOOTH にログインしてください。
 * ログイン情報はこのスクリプトには一切渡さず、ブラウザプロファイルにだけ残ります。
 * 終わったらブラウザを閉じれば保存されます。
 */
import { loadConfig, openBrowser, saveCookies, log } from "./lib.js";

const TARGETS = {
  booth: "https://accounts.booth.pm/users/sign_in",
  patreon: "https://www.patreon.com/login",
  pixiv: "https://accounts.pixiv.net/login",
  // FANZA（同人の管理画面）。アカウントごとにプロファイルを分ける:
  //   node src/login.js fanza A
  fanza: "https://www.dmm.co.jp/my/-/login/",
};
const site = process.argv[2] ?? "pixiv";
const account = process.argv[3] ?? null;   // fanza のときだけ使う
// 4つめの引数で行き先を指定できる（例: 作品登録ページまで開いてログインする）
const target = process.argv[4] ?? TARGETS[site] ?? TARGETS.pixiv;

const cfg = loadConfig();
const { ctx, page } = await openBrowser(cfg, { headless: false, profile: account ? `${site}-${account}` : null });

await page.goto(target, { waitUntil: "domcontentloaded" });
log(`ログインページを開きました: ${target}${account ? `（アカウント${account}・専用プロファイル）` : ""}`);
log("ログインが終わったらブラウザを閉じてください（プロファイルに保存されます）");



// DMMのログインはセッションCookieなので、プロファイルだけでは残らない。
// 開いている間はずっとCookieを退避し続ける（data/cookies-<プロファイル>.json）
const profileName = account ? `${site}-${account}` : site;
let saved = 0;
const timer = setInterval(async () => {
  const n = await saveCookies(ctx, profileName);
  if (n && n !== saved) { saved = n; log(`Cookieを保存しました（${n}件）`); }
}, 5000);

ctx.on("close", () => log("ブラウザを閉じました"));
await ctx.waitForEvent("close", { timeout: 0 });
clearInterval(timer);
log(`保存しました。プロファイル: ${profileName}`);
if (!saved) log("! Cookieを保存できませんでした。ログインし直してください");
