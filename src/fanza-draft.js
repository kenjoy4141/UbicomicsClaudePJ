/**
 * FANZA同人の作品登録フォームを、登録ボタンの直前まで自動で埋める。
 *
 *   node src/fanza-draft.js --work "巨乳ヨガインストラクターのマンツーマンレッスンがエロすぎる件"
 *   node src/fanza-draft.js --variant yoga
 *   node src/fanza-draft.js --variant yoga --account B --price 910
 *
 * 作品フォルダ（NNN_A_作品名）からアカウントを読み、そのアカウント専用の
 * ブラウザプロファイル（data/browser-profile-fanza-A）で開く。
 *
 * **登録ボタンは押さない。** 最後に内容を目で確認して、自分で押すこと。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, openBrowser, restoreCookies, saveCookies, readJson, log, titleFromDir, accountFromDir, ROOT } from "./lib.js";

const cfg = loadConfig();
const OUT = cfg.worksRoot;
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const POST = readJson(path.join(ROOT, "config/fanza-post.json")) ?? {};

const variantName = opt("variant");
const V = variantName ? readJson(path.join(ROOT, "config/variants", `${variantName}.json`)) : null;
const title = opt("work", V?.title);
if (!title) {
  console.error('使い方: node src/fanza-draft.js --variant <名前>  または  --work "作品名"');
  process.exit(1);
}

// ---------- 作品フォルダ ----------
const dirName = fs.readdirSync(OUT).find((d) => /^\d{3}_/.test(d) && titleFromDir(d) === title);
if (!dirName) {
  console.error(`! 作品フォルダが見つかりません: ${title}`);
  process.exit(1);
}
const workDir = path.join(OUT, dirName);
const no = dirName.slice(0, 3);
const account = opt("account", accountFromDir(dirName) ?? V?.account ?? "A");
const coverDir = path.join(workDir, "00_表紙");
const pagesDir = path.join(workDir, "01_本編");
log(`作品: ${dirName}（アカウント${account}）`);

const need = (p, what) => {
  if (!fs.existsSync(p)) { console.error(`! ${what}がありません: ${p}`); process.exit(1); }
  return p;
};
const zipPath = need(path.join(workDir, `${title}.zip`), "本編ZIP");
const packageImg = need(path.join(coverDir, `${no}サムネ_1.jpg`), "パッケージ画像");
const commentTxt = need(path.join(coverDir, `${no}作品コメント.txt`), "作品コメント");

// ---------- サムネイル画像（100×100）は無ければ作る ----------
const iconImg = path.join(coverDir, `${no}アイコン.jpg`);
if (!fs.existsSync(iconImg)) {
  const py = [
    "import sys",
    "from PIL import Image",
    "src, dst = sys.argv[1], sys.argv[2]",
    "im = Image.open(src).convert('RGB')",
    "w, h = im.size",
    "s = min(w, h)",
    "im = im.crop(((w - s) // 2, 0, (w - s) // 2 + s, s)).resize((100, 100), Image.LANCZOS)",
    "im.save(dst, 'JPEG', quality=92, optimize=True)",
    "print('icon:', dst)",
  ].join("\n");
  execFileSync("python", ["-c", py, packageImg, iconImg], { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
}

// ---------- サンプル画像 ----------
// 構成（ユーザー指定）: 目次 → プロフィール → セリフ付きの導入ページを流れに沿って → 導入の最後のページ
const sampleMax = Number(opt("samples", POST.sampleCount ?? 10));
const pages = fs.readdirSync(pagesDir).filter((f) => /\.jpe?g$/i.test(f)).sort();
const work = readJson(path.join(ROOT, "data/works", `${title}.json`)) ?? {};
const introCount = Number(work?.fanza?.introImages ?? 60);
const samples = [];
const tocImg = path.join(coverDir, `${no}目次.jpg`);
const profImg = path.join(coverDir, `${no}プロフィール.jpg`);
if (fs.existsSync(tocImg)) samples.push(tocImg);
if (fs.existsSync(profImg)) samples.push(profImg);

// 導入の最後のページ（「このあと めちゃくちゃ S〇Xした」）は必ず締めに入れる
const lastIntro = pages[Math.min(introCount, pages.length) - 1];
const middle = sampleMax - samples.length - 1;          // 途中のセリフ付きページの枚数
const introPages = pages.slice(0, Math.max(introCount - 1, 1));
for (let i = 0; i < middle; i++) {
  const idx = Math.floor(((i + 0.5) / middle) * introPages.length);
  samples.push(path.join(pagesDir, introPages[Math.min(idx, introPages.length - 1)]));
}
samples.push(path.join(pagesDir, lastIntro));
log(`サンプル: 目次・プロフィール＋導入${middle}枚＋締め（${lastIntro}）`);

const big = samples.filter((f) => fs.statSync(f).size > 2 * 1024 * 1024);
if (big.length) {
  console.error(`! 2MBを超えるサンプルがあります（${big.length}枚）。先に縮小してください`);
  process.exit(1);
}

// ---------- テキスト ----------
const comment = fs.readFileSync(commentTxt, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
const titleRuby = opt("ruby", V?.titleRuby ?? "");
const price = String(opt("price", POST.priceRetail ?? 910));
const keywords = (opt("keywords") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const wantKeywords = keywords.length ? keywords : (V?.fanzaKeywords ?? POST.defaultKeywords ?? []);

// ---------- ブラウザ ----------
const { ctx, page } = await openBrowser(cfg, { headless: false, profile: `fanza-${account}` });
// DMMのログインはセッションCookie。login.js が退避したものを戻す
const restored = await restoreCookies(ctx, `fanza-${account}`);
log(`Cookieを戻しました: ${restored}件`);
await page.goto("https://dojin.dmm.co.jp/addproduct", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
if (/accounts\.dmm\.co\.jp/.test(page.url())) {
  console.error(`! ログインしていません。node src/login.js fanza ${account} https://dojin.dmm.co.jp/addproduct を先に実行してください`);
  await ctx.close();
  process.exit(1);
}

const done = [];
const skipped = [];
const pick = async (sel, what) => {
  const el = page.locator(sel).first();
  if (await el.count() === 0) { skipped.push(what); return false; }
  await el.check({ force: true }).catch(async () => { await el.click({ force: true }); });
  done.push(what);
  return true;
};

// 作品形式・AI申告
await pick(`#article_type--${POST.articleType ?? "cg"}`, "作品形式（CG）");
await pick(`#ai_generated_type--${POST.aiGeneratedType ?? "2"}`, "AI利用（AIで作品を生成している）");

// ファイル類（隠れた input[type=file] に直接渡す）
const fileInputs = page.locator('input[type="file"]');
const fileCount = await fileInputs.count();
log(`ファイル欄: ${fileCount}個`);
// 並び順: 本体ZIP / パッケージ画像 / サムネイル画像 / サンプル画像 / サンプルムービー / 体験版
await fileInputs.nth(0).setInputFiles(zipPath);
done.push(`本編ZIP（${(fs.statSync(zipPath).size / 1e6).toFixed(0)}MB）`);
await fileInputs.nth(1).setInputFiles(packageImg);
done.push("パッケージ画像");
await fileInputs.nth(2).setInputFiles(iconImg);
done.push("サムネイル画像 100×100");
await fileInputs.nth(3).setInputFiles(samples);
done.push(`サンプル画像 ${samples.length}枚`);

await pick(`#revision_flg--${POST.revisionFlg ?? "1"}`, "作品修正対応");

// 基本情報
await page.fill('input[name="title"]', title);
done.push("作品タイトル");
if (titleRuby) { await page.fill('input[name="title_ruby"]', titleRuby); done.push("ふりがな"); }
else skipped.push("ふりがな（variant に titleRuby が無い）");
await page.fill("#id_form_comment", comment);
done.push(`作品コメント（${comment.length}文字）`);

// 詳細情報
await pick(`#keyword_age--${POST.keywordAge ?? "156023"}`, "年齢指定（成人向け）");
await pick(`#section--${POST.section ?? "1"}`, "作品区分（男性向け）");
await pick('input[name="series"][value="0"]', "シリーズ（追加しない）");
await pick("#keyword_event--0", "初回頒布イベント（なし）");

// キーワード（ラベルの文字で拾う。最大10個）
let picked = 0;
for (const w of wantKeywords) {
  if (picked >= 10) break;
  const box = page.locator(`label:has-text("${w}") input[type="checkbox"][name="keywords[]"], input[name="keywords[]"]`).first();
  const byLabel = page.locator(`xpath=//input[@name="keywords[]"][following-sibling::*[normalize-space(text())="${w}"] or ../*[normalize-space(text())="${w}"]]`).first();
  const target = (await byLabel.count()) ? byLabel : box;
  if (await target.count()) {
    await target.check({ force: true }).catch(() => {});
    picked++;
    done.push(`キーワード「${w}」`);
  } else skipped.push(`キーワード「${w}」が見つからない`);
}

// 販売情報
await page.fill('input[name="price_retail"]', price);
done.push(`販売価格 ${price}円（税抜）`);
if (POST.campaign) await pick("#id_campaign", "キャンペーン参加");
if (POST.coupon) await pick("#id_coupon", "クーポン参加");
await pick(`#campaign_auto_join_flg_set_days--${POST.campaignAutoJoinDays ?? "0"}`, "キャンペーン自動参加");
// 発売記念の割引設定（ユーザー指定: 14日間80%OFFで固定）
const disc = POST.preReleaseDiscount ?? {};
if (disc.enabled) {
  await pick("#pre_release_articles_campaign_flg--1", "割引設定（設定する）");
  await page.waitForTimeout(500);
  await page.selectOption("#pre_release_articles_campaign_discount_days", String(disc.days ?? "14")).catch(() => skipped.push("割引の実施期間"));
  await page.selectOption("#pre_release_articles_campaign_discount_rate", String(disc.rate ?? "80")).catch(() => skipped.push("割引率"));
  done.push(`割引 ${disc.days}日間 ${disc.rate}%OFF`);
} else {
  await pick("#pre_release_articles_campaign_flg--0", "割引設定（設定しない）");
}
await pick(`#release_date_type--${POST.releaseDateType ?? "1"}`, "配信開始日（最短で公開）");

// おすすめサービス（BOOTHでも売るので専売は希望しない）
await pick(`#monopoly_hope_flg--${POST.monopolyHope ?? "0"}`, "専売（希望しない）");
await pick(`#drm_hope--${POST.drmHope ?? "none"}`, "作品保護（なし）");

await page.screenshot({ path: path.join(ROOT, `logs/fanza-draft-${no}.png`), fullPage: true });

log("---- 入力した項目 ----");
done.forEach((d) => log(`  ✓ ${d}`));
if (skipped.length) {
  log("---- 手で直すところ ----");
  skipped.forEach((d) => log(`  ! ${d}`));
}
log(`スクショ: logs/fanza-draft-${no}.png`);
log("");
log("★ 登録ボタンは押していません。ZIPのアップロードが終わるのを待って、内容を確認してから自分で押してください。");
log("  ブラウザは開いたままにします。閉じると入力内容は消えます。");

// セッションを次回へ繋ぐ（閉じるまで定期的に保存）
const keep = setInterval(() => saveCookies(ctx, `fanza-${account}`), 15000);
await ctx.waitForEvent("close", { timeout: 0 });
clearInterval(keep);
