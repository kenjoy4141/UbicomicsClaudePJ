/**
 * BOOTHの商品登録フォームを埋める。「公開で保存する」は押さない。
 *
 *   node src/booth-draft.js --pdf "<PDFパス>" --thumb "<サムネ>" --profile "<プロフィール画像>" --title "作品タイトル"
 *   商品画像は --thumb → --profile の順に登録される（1枚目が一覧のメイン画像）
 *   node src/booth-draft.js ... --item 8821192      … 既存の下書きを使う（新規作成しない）
 *   node src/booth-draft.js ... --story-file story.txt --tags "先生,保健室"
 *
 * 注意: 商品種別「ダウンロード」を選ぶと、その時点でBOOTH側に下書きが作られる。
 *       作り過ぎないよう、既存の下書きがあれば --item で使い回すこと。
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, openBrowser, render, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const B = cfg.booth;
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const pdf = opt("pdf");
const thumb = opt("thumb");
const profileImg = opt("profile");
// 商品画像は「1枚目が一覧のメイン画像」になるので、サムネ→プロフィールの順で並べる
const images = [thumb, profileImg, ...(opt("images", "").split(",").map((s) => s.trim()).filter(Boolean))]
  .filter(Boolean);
const title = opt("title");
const itemId = opt("item");

if (!pdf || images.length === 0 || !title) {
  console.error('使い方: node src/booth-draft.js --pdf "<PDF>" --thumb "<画像>" --title "タイトル"');
  process.exit(1);
}
if (!fs.existsSync(pdf)) {
  console.error(`PDFが見つかりません: ${pdf}`);
  process.exit(1);
}
for (const p of images) {
  if (!fs.existsSync(p)) {
    console.error(`商品画像が見つかりません: ${p}`);
    process.exit(1);
  }
}

// ---------- 商品紹介文 ----------
const storyFile = opt("story-file");
const story = storyFile && fs.existsSync(storyFile)
  ? fs.readFileSync(storyFile, "utf8").trim()
  : opt("story", "");
if (!story) log("! ストーリー本文が未指定です。該当箇所は空欄のままになります（あとで手で書いてください）");

// --pages が無ければPDFのページ数を数える（紹介文の「全Nページ」に入る）
function countPdfPages(file) {
  try {
    const buf = fs.readFileSync(file).toString("latin1");
    const counts = buf.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
    if (counts > 0) return counts;
    const n = [...buf.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
    return n.length ? Math.max(...n) : null;
  } catch {
    return null;
  }
}
const pages = Number(opt("pages", 0)) || (pdf && fs.existsSync(pdf) ? countPdfPages(pdf) : null);
if (pages) log(`  ページ数: ${pages}`);
else log("! ページ数が分からないので紹介文は「（ページ数）」のままになります");
const description = render(B.descriptionTemplate, {
  pages: pages ?? "（ページ数）",
  story: story || "（ここに紹介文を書いてください）",
  width: opt("width", "1024"),
  height: opt("height", "1536"),
});

const tags = [...new Set([...(opt("tags", "").split(",").filter(Boolean)), ...B.tags])].slice(0, 10);

/**
 * ボタンを押してモーダルが開くまで粘る。
 * BOOTHのモーダルは1回目のクリックが効かないことがあるため、数回試す。
 */
async function openModal(page, buttonName, expectText, tries = 4) {
  const btn = page.getByRole("button", { name: buttonName });
  await btn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  for (let i = 1; i <= tries; i++) {
    await btn.click();
    try {
      await page.getByText(expectText).first().waitFor({ timeout: 8000 });
      return true;
    } catch {
      log(`  モーダルが開かず、再試行 ${i}/${tries}`);
      await page.waitForTimeout(1500);
    }
  }
  return false;
}

/**
 * クリックでネイティブのファイル選択が開く要素に、ファイルを渡す。
 * BOOTHのドロップゾーンは input[type=file] を持たないので filechooser で受ける。
 */
async function pickFile(page, clickTarget, file, label) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 20000 }),
    clickTarget(),
  ]);
  await chooser.setFiles(file);
  log(`  ${label}: ${path.basename(file)} を送信`);
}

// ---------- ブラウザ ----------
const { ctx, page } = await openBrowser(cfg, { headless: false });

if (itemId) {
  await page.goto(`${B.manageUrl}/items/${itemId}/edit`, { waitUntil: "domcontentloaded" });
} else {
  log("新しい下書きを作ります（この操作でBOOTH側に下書きが1件できます）");
  await page.goto(`${B.manageUrl}/items/select_type`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /ダウンロード.*登録/ }).click();
}
await page.waitForTimeout(8000);

if (/users\/sign_in/.test(page.url())) {
  log("未ログインです。node src/login.js booth を実行してください。");
  await ctx.close();
  process.exit(2);
}
log(`編集ページ: ${page.url()}`);

// ---------- 商品名 ----------
const titleInput = page.locator('input[type=text]').first();
await titleInput.fill(title);
log(`  商品名: ${title}`);

// ---------- 商品画像 ----------
// 1枚目が商品一覧のメイン画像になるので、渡された順にアップロードする。
// 既にN枚登録済みなら、N枚目以降だけを足す（重複アップロードを避けるため）。
try {
  const countExisting = () =>
    page.evaluate(() => {
      const label = [...document.querySelectorAll("label,div")].find(
        (e) => (e.innerText || "").trim() === "商品画像"
      );
      let scope = label;
      for (let i = 0; i < 5 && scope?.parentElement; i++) scope = scope.parentElement;
      const lis = [...(scope?.querySelectorAll("li") ?? [])];
      // 「画像を追加」のボタン以外が、登録済みの画像
      return lis.filter((l) => (l.innerText || "").trim() !== "画像を追加").length;
    });

  let existing = await countExisting();
  if (flag("replace-image")) {
    log(`  商品画像: --replace-image のため ${images.length}枚すべてを追加します`);
    existing = 0;
  }

  const todo = images.slice(existing);
  if (todo.length === 0) {
    log(`  商品画像: 既に${existing}枚登録済み。追加なし`);
  } else {
    if (existing > 0) log(`  商品画像: 既に${existing}枚あるので、残り${todo.length}枚を追加します`);
    for (const [i, img] of todo.entries()) {
      const hasAdd = await page.getByText("画像を追加", { exact: true }).count();
      await pickFile(page, async () => {
        if (hasAdd > 0) await page.getByText("画像を追加", { exact: true }).first().click();
        else await page.getByText("画像ファイルをドラッグ＆ドロップ").first().click();
      }, img, `商品画像 ${existing + i + 1}/${images.length}`);
      await page.waitForTimeout(8000);
    }
    log(`  商品画像: 合計 ${await countExisting()}枚`);
  }
} catch (e) {
  log(`  ! 商品画像のアップロードに失敗（手動で追加してください）: ${String(e?.message ?? e).split("\n")[0]}`);
}

// ---------- 年齢制限 ----------
if (B.adult) {
  await page.locator('input[name=adult][value="true"]').check({ force: true }).catch(async () => {
    await page.getByText("R-18", { exact: true }).first().click();
  });
  log("  年齢制限: R-18");
}

// ---------- カテゴリ ----------
// カテゴリのボタンは type=submit なので、商品名が空だとバリデーションで弾かれる。
// 必ず商品名を入れたあとに開くこと。
try {
  await page.getByRole("button", { name: /カテゴリ(を選択してください|を変更)/ }).click();
  await page.waitForTimeout(2000);
  for (const step of B.category) {
    await page.getByText(step, { exact: true }).first().click();
    await page.waitForTimeout(1200);
  }
  // 選択後は「閉じる」でモーダルを畳む。開いたままだと後続のボタンが押せなくなる
  const close = page.getByRole("button", { name: "閉じる" }).first();
  if (await close.count()) await close.click();
  await page.waitForTimeout(1500);
  // 念のため、まだ開いていれば Escape でも試す
  if (await page.getByText("カテゴリを選択", { exact: true }).count()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
  }
  log(`  カテゴリ: ${B.category.join(" > ")}`);
} catch (e) {
  log(`  ! カテゴリ選択に失敗（手動で選んでください）: ${e.message.split("\n")[0]}`);
}

// ---------- 商品紹介文 ----------
try {
  let box = page.locator("textarea").first();
  if ((await box.count()) === 0 || !(await box.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "段落" }).click();
    await page.waitForTimeout(1200);
    box = page.locator("textarea").first();
  }
  await box.fill(description);
  log(`  商品紹介文: ${description.length}文字`);
} catch (e) {
  log(`  ! 商品紹介文の入力に失敗: ${e.message.split("\n")[0]}`);
}

// ---------- タグ ----------
try {
  const tagInput = page.getByPlaceholder("タグの追加");
  for (const t of tags) {
    await tagInput.fill(t);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  }
  log(`  タグ: ${tags.join(", ")}`);
} catch (e) {
  log(`  ! タグ入力に失敗: ${e.message.split("\n")[0]}`);
}

// ---------- 価格 ----------
await page.locator('input[name=price]').fill(String(B.price));
log(`  価格: ${B.price}円`);

// ---------- 作品ファイル(PDF) ----------
try {
  // 既に同じファイルが添付されていれば二重添付を避ける（--replace-file で無視）
  // 判定はページ全体ではなく「作品ファイル」欄の中だけを見る。
  // 全体を見るとタイトルなど別の場所の文字列に引っかかって誤検知する。
  const attached = await page.evaluate(() => {
    const label = [...document.querySelectorAll("label,div")].find(
      (e) => (e.innerText || "").trim() === "作品ファイル"
    );
    if (!label) return false;
    let scope = label;
    for (let k = 0; k < 4 && scope?.parentElement; k++) scope = scope.parentElement;
    return /.pdf|.zip/i.test(scope?.innerText ?? "");
  });

  if (attached > 0 && !flag("replace-file")) {
    log("  作品ファイル: 既に添付済みのためスキップ（差し替えるなら --replace-file）");
  } else {
    const opened = await openModal(page, "ファイルの追加・管理", "ファイルをドラッグ");
    if (!opened) throw new Error("ファイル追加モーダルを開けませんでした");

    await pickFile(page, async () => {
      await page.getByText("ファイルをドラッグ").first().click();
    }, pdf, "作品ファイル");

    const mb = (fs.statSync(pdf).size / 1048576).toFixed(1);
    log(`  作品ファイル: ${mb}MB アップロード中...`);
    await page.getByText(path.basename(pdf), { exact: false }).first()
      .waitFor({ timeout: 300000 })
      .catch(() => log("  ! ファイル名の表示を確認できませんでした。画面で確認してください"));
    await page.waitForTimeout(3000);

    const close = page.getByRole("button", { name: "閉じる" }).first();
    if (await close.count()) await close.click();
    await page.waitForTimeout(1500);
    log("  作品ファイル: 完了");
  }
} catch (e) {
  log(`  ! 作品ファイルの添付に失敗（手動で追加してください）: ${String(e?.message ?? e).split("\n")[0]}`);
}

// ---------- 代理購入 ----------
try {
  const sel = page.locator("select").nth(1);
  await sel.selectOption(B.proxyPurchase);
  log(`  代理購入: ${B.proxyPurchase}`);
} catch (e) {
  log(`  ! 代理購入設定に失敗: ${e.message.split("\n")[0]}`);
}

await page.screenshot({ path: path.join(ROOT, "logs/booth-filled.png"), fullPage: true });
log(`スクショ: logs/booth-filled.png`);
console.log("\n入力が終わりました。内容を確認して、自分で「公開で保存する」を押してください。");
console.log("（このスクリプトは保存も公開もしません）");

if (!flag("close")) {
  console.log("\nブラウザは開いたままにします。確認が終わったら手動で閉じてください。");
  await new Promise(() => {});
}
await ctx.close();
