/**
 * Patreonの投稿を下書きまで入力する。「掲載する」は押さない（人間が押す）。
 *
 *   node src/patreon-draft.js --work "30日後にS○Xする女医さん" --kind free
 *   node src/patreon-draft.js --work "30日後にS○Xする女医さん" --kind premium --tiers "Premium" --sell 12
 *   node src/patreon-draft.js --work "..." --kind free --post https://www.patreon.com/ubi_comics/posts/123/edit
 *
 * --kind free    … 無料の見本投稿。cover_en.jpg と previews/ の着衣カットだけ。本文は post_free_en.txt
 * --kind premium … 有料投稿。cover_en.jpg と profile_en.jpg、添付に PDF と ZIP。本文は post_premium_en.txt
 * --tiers        … 有料投稿を見られるランク名（カンマ区切り）。省略時はすべてのランク
 * --sell <USD>   … 会員以外にもこの投稿を単品で販売する
 * --post         … 既存の下書きの編集URLを使い回す（Patreonは編集画面を開いた時点で空の下書きを作るため）
 *
 * 素材は patreon-fanza-assets.js が作った <作品>/02_patreon_en/ を使う。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, openBrowser, log } from "./lib.js";
import { loadWork, saveWork } from "./work.js";

const cfg = loadConfig();
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const workTitle = opt("work");
const kind = opt("kind", "free");
const work = workTitle ? loadWork(workTitle) : null;
const enDir = work?.patreon?.enDir;
if (!work || !enDir || !fs.existsSync(enDir) || !["free", "premium"].includes(kind)) {
  console.error('使い方: node src/patreon-draft.js --work "作品名" --kind free|premium  （先に patreon-fanza-assets.js）');
  process.exit(1);
}
const titleEn = work.patreon.titleEn;
const slug = work.patreon.slug;
const bodyFile = path.join(enDir, kind === "free" ? "post_free_en.txt" : "post_premium_en.txt");
const lines = fs.readFileSync(bodyFile, "utf8").split(/\r?\n/);
// 本文ファイルの1行目はタイトルなので、本文からは外す
const postTitle = kind === "free" ? `[Preview] ${titleEn}` : titleEn;
const body = lines.slice(1).join("\n").trim();

const images = kind === "free"
  ? [path.join(enDir, "cover_en.jpg"), ...fs.readdirSync(path.join(enDir, "previews")).sort().map((f) => path.join(enDir, "previews", f))]
  : [path.join(enDir, "cover_en.jpg"), path.join(enDir, "profile_en.jpg")];
const attachments = kind === "premium" ? [path.join(enDir, `${slug}.pdf`), path.join(enDir, `${slug}.zip`)] : [];
const tags = kind === "free"
  ? ["anime", "illustration", "original character", "romance", "AI art"]
  : ["anime", "illustration", "original character", "romance", "AI art", "18+"];
for (const f of [...images, ...attachments]) {
  if (!fs.existsSync(f)) {
    console.error("素材がありません: " + f);
    process.exit(1);
  }
}

const { ctx, page } = await openBrowser(cfg, { headless: false });
const step = async (label, fn) => {
  try {
    await fn();
    log(`OK  ${label}`);
  } catch (e) {
    log(`NG  ${label}: ${e.message.split("\n")[0]}`);
    throw e;
  }
};

// ---------- 編集画面を開く ----------
const reuse = opt("post");
if (reuse) {
  await page.goto(reuse, { waitUntil: "domcontentloaded" });
} else {
  await page.goto("https://www.patreon.com/feed", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.locator('[data-tag="create-content-button"]:visible').first().click();
  await page.getByText("投稿する", { exact: true }).click();
}
// URLとタイトル欄が出るまで待つ（Patreonは読み込みイベントが当てにならない）
{
  const until = Date.now() + 60000;
  // タイトルを付けると URL が /posts/preview-30-days-169608700/edit のようにスラッグ付きになる
  while (!(/\/posts\/(?:[\w-]+-)?\d+\/edit/.test(page.url()) && (await page.locator('textarea[aria-label="タイトル"]').count()))) {
    if (Date.now() > until) {
      await page.screenshot({ path: path.join(path.dirname(bodyFile), "_draft_error.png") });
      throw new Error(`編集画面になりません: ${page.url()}`);
    }
    await page.waitForTimeout(1000);
  }
}
await page.waitForTimeout(4000);
const editUrl = page.url();
log(`編集画面: ${editUrl}`);

// --publish-only: 入力はやり直さず、確認して掲載だけする（再実行で画像が増えるのを防ぐ）
const publishOnly = argv.includes("--publish-only");
if (publishOnly && !reuse) {
  console.error("--publish-only には --post <編集URL> が必要です");
  process.exit(1);
}

// ---------- タイトル・本文 ----------
if (!publishOnly) {
await step("タイトル", async () => {
  const t = page.locator('textarea[aria-label="タイトル"]');
  await t.fill(postTitle);
});
await step("本文", async () => {
  const box = page.locator('[role=textbox][aria-label="投稿コンテンツのテキスト入力フィールド"]');
  await box.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  // エディタは Enter 1回で段落が分かれて余白が付くので、空行は入れない
  const paras = body.split("\n").filter((l) => l.trim());
  for (let i = 0; i < paras.length; i++) {
    await page.keyboard.insertText(paras[i]);
    if (i < paras.length - 1) await page.keyboard.press("Enter");
  }
});

// ---------- オーディエンス ----------
// 設定まわりは画像・添付より先に入れる（途中で止まったときに、大きいファイルを二重に上げないため）
if (kind === "free") {
  await step("無料でアクセス", async () => {
    await page.locator('label[data-tag="public"]').click();
  });
} else {
  await step("有料アクセス", async () => {
    await page.getByText("有料アクセス", { exact: true }).click();
    await page.waitForTimeout(1500);
  });
  const tierNames = (opt("tiers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (tierNames.length) {
    await step(`ランク ${tierNames.join(", ")}`, async () => {
      await page.locator('button[aria-label="ランクを選択する"]').click();
      await page.waitForTimeout(1500);
      // ランクの一覧は role の付いた入れ物に入っていないことがあるので、見つからなければページ全体から探す
      const named = page.locator("[role=dialog], [role=listbox], [role=menu]").filter({ hasText: "すべてのランクを選択" });
      const dialog = (await named.count()) ? named.last() : page;
      // 「すべてのランクを選択」が入ったままだと個別指定にならないので、先に外す
      const all = dialog.getByText("すべてのランクを選択", { exact: true }).first();
      if (await all.count()) {
        await all.click();
        await page.waitForTimeout(800);
      }
      for (const name of tierNames) {
        const hit = dialog.getByText(name, { exact: true }).first();
        if (!(await hit.count())) throw new Error(`ランク「${name}」が見つかりません`);
        await hit.click();
        await page.waitForTimeout(800);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1500);
      // ボタンの表示で確かめる（「すべてのランク」のままなら指定できていない）
      const label = (await page.locator('button[aria-label="ランクを選択する"]').innerText()).trim();
      log(`    ランクの表示: ${label}`);
      if (label.includes("すべてのランク")) throw new Error("ランクを個別に指定できていません");
    });
  }
  const sell = opt("sell");
  if (sell) {
    await step(`単品販売 $${sell}`, async () => {
      const toggle = page.locator('input[aria-label="1回限りの支払いに切り替える"]');
      if (!(await toggle.isChecked())) await toggle.click({ force: true });
      await page.waitForTimeout(1500);
      await page.locator('input[name="product-price"]').fill(String(sell));
    });
  }
}

// ---------- タグ ----------
await step(`タグ ${tags.join(", ")}`, async () => {
  const input = page.locator('input[data-tag="tags-auto-complete"]');
  for (const t of tags) {
    await input.click();
    await input.fill(t);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  }
});

// ---------- 画像 ----------
await step(`画像 ${images.length}枚`, async () => {
  // 「画像」ボタンはドロップ枠を出すだけでファイル選択は開かない。
  // 編集画面には最初から隠れた input[type=file] があるので、画像専用（複数可）のものに直接渡す
  const accept = "image/jpeg,image/png,image/gif,image/webp,image/avif,image/tiff,image/heic,image/heif";
  await page.locator(`input[type=file][accept="${accept}"][multiple]`).first().setInputFiles(images);
  // アップロードの完了を待つ（img が増えるまで）
  await page.waitForFunction((n) => document.querySelectorAll("main img, [role=main] img, img[src*='patreonusercontent']").length >= n,
    images.length, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(5000);
});

// ---------- 添付ファイル ----------
if (attachments.length) {
  await step(`添付 ${attachments.map((f) => path.basename(f)).join(", ")}`, async () => {
    // 添付は accept="*" の隠れた input に渡す
    await page.locator('input[type=file][accept="*"]').first().setInputFiles(attachments);
    // 大きいファイル（100MB超）なので、ファイル名が画面に出るまで長めに待つ
    for (const f of attachments) {
      await page.getByText(path.basename(f)).first().waitFor({ timeout: 15 * 60 * 1000 });
    }
    await page.waitForTimeout(10000);
  });
}

// ---------- 添付のアップロード完了を確かめる ----------
// ファイル名が出ただけでは転送中のことがある。進捗表示が消えるまで待つ
if (attachments.length) {
  await step("添付の完了待ち", async () => {
    const until = Date.now() + 30 * 60 * 1000;
    while (Date.now() < until) {
      const busy = await page.evaluate(() => {
        const t = document.body.innerText;
        return /\d+\s?%/.test(t) || /アップロード中|Uploading|処理中/.test(t) ||
          document.querySelectorAll("progress, [role=progressbar]").length > 0;
      });
      if (!busy) return;
      await page.waitForTimeout(5000);
    }
    throw new Error("添付のアップロードが終わりません");
  });
}

} // --publish-only ここまで（入力の工程を飛ばす）

// ---------- 保存を待つ ----------
await page.waitForTimeout(8000);
// 入力結果の確認用に、編集画面と右の設定パネルを撮っておく
await page.screenshot({ path: path.join(enDir, `_draft_${kind}.png`), fullPage: false });
saveWork(workTitle, { patreon: { ...(loadWork(workTitle)?.patreon ?? {}), [`${kind}Draft`]: editUrl } });
log("下書きの入力が終わりました。内容を確認して「掲載する」はご自身で押してください。");
log(editUrl);
// ---------- 掲載（--publish のときだけ） ----------
// Patreonだけは自動投稿を許可している（2026-09-21 ユーザー判断）。FANZA・BOOTHは手動のまま。
// 公開範囲と添付を確かめてからでないと押さない
if (argv.includes("--publish")) {
  await step("掲載前の確認", async () => {
    // 説明文は両方とも常に表示されるので、文字ではなくラジオボタンの選択状態で判定する
    const picked = await page.evaluate(() => {
      const radios = [...document.querySelectorAll('input[type=radio]')];
      const hit = radios.find((r) => r.checked && ["public", "paid"].includes(r.value));
      return hit?.value ?? null;
    });
    const want = kind === "free" ? "public" : "paid";
    if (picked !== want) throw new Error(`公開範囲が「${picked ?? "不明"}」になっています（期待: ${want}）`);
    const panel = await page.evaluate(() => document.body.innerText);
    if (attachments.length) {
      for (const f of attachments) {
        if (!panel.includes(path.basename(f))) throw new Error(`添付が見当たりません: ${path.basename(f)}`);
      }
    }
  });
  await step("掲載する", async () => {
    await page.locator('[data-tag="make-a-post-action-publish"]').first().click();
    await page.waitForTimeout(8000);
    // 掲載されると編集画面から投稿ページへ移る
    const url = page.url();
    // 配信ペースの判定に使うので、無料・有料それぞれの掲載日を残す
    saveWork(workTitle, { patreon: {
      ...(loadWork(workTitle)?.patreon ?? {}),
      [`${kind}Url`]: url.replace(/\/edit$/, ""),
      [`${kind === "free" ? "free" : "premium"}PublishedAt`]: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
    } });
    log(`掲載しました: ${url}`);
  });
}

// --close: 確認せずにブラウザを閉じて終わる（下書きを続けて作るとき用。掲載は押さない）
if (argv.includes("--close")) {
  await ctx.close();
} else {
  log("ブラウザを閉じると終了します。");
  await ctx.waitForEvent("close", { timeout: 0 });
}
