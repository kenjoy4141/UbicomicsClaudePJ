/**
 * pixiv の投稿フォームを1件ぶん埋める処理。
 * 1件ずつ確認する pixiv-draft.js と、タブを並べる pixiv-batch.js で共用する。
 */
import path from "node:path";
import { readJson, log, ROOT } from "./lib.js";

export const S = readJson(path.join(ROOT, "config/selectors.json"));

/** ログインページに飛ばされていないか */
export function isLoggedOut(page) {
  return /accounts\.pixiv\.net\/login/.test(page.url());
}

/** 予約日時を「2026年9月8日」「22:00」の表示形式に変換する */
function toDropdownLabels(scheduledAt) {
  const [d, t] = scheduledAt.split(" ");
  const [y, mo, da] = d.split("-").map(Number);
  return { date: `${y}年${mo}月${da}日`, time: t };
}

/** トリガー内ではない（＝リスト側の）選択肢を返す */
async function findOption(page, optSel) {
  const opts = page.locator(optSel);
  const n = await opts.count();
  for (let i = 0; i < n; i++) {
    const el = opts.nth(i);
    const isTrigger = await el.evaluate((e) => !!e.closest("div[tabindex='0']"));
    if (!isTrigger && (await el.isVisible().catch(() => false))) return el;
  }
  return null;
}

/**
 * pixiv のカスタムドロップダウン（日付/時刻）から値を選ぶ。
 * 描画が間に合わないことがあるので、ポーリング＋開き直しで粘る。
 */
async function selectFromDropdown(page, triggerIndex, value, prefix = "") {
  const row = page.locator(S.reserveCheckbox).locator("xpath=../..");
  const triggers = row.locator(S.dropdownTrigger);
  const optSel = S.dropdownOption.replace("{value}", value);

  for (let attempt = 1; attempt <= 3; attempt++) {
    await triggers.nth(triggerIndex).click();
    await page.waitForTimeout(1000);

    for (let i = 0; i < 10; i++) {
      const hit = await findOption(page, optSel);
      if (hit) {
        await hit.scrollIntoViewIfNeeded();
        await hit.click();
        await page.waitForTimeout(400);
        return;
      }
      await page.waitForTimeout(500);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    log(`${prefix}! ドロップダウン再試行 ${attempt}/3（${value}）`);
  }

  const avail = await page.evaluate(() =>
    [...document.querySelectorAll("div.charcoal-text-ellipsis[title]")]
      .filter((e) => !e.closest("div[tabindex='0']"))
      .map((e) => e.getAttribute("title"))
  );
  throw new Error(`ドロップダウンに「${value}」が見つかりません。選択肢(${avail.length}件): ${avail.slice(0, 40).join(", ")}`);
}

/**
 * 投稿ページを開いて、キュー1件ぶんの内容を全部入力する。
 * 「投稿する」は押さない。
 */
export async function fillUploadForm(page, item, cfg, prefix = "  ") {
  await page.goto(cfg.pixiv.createUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  if (isLoggedOut(page)) throw new Error("未ログインです。node src/login.js を実行してください。");

  // 画像
  await page.locator(S.fileInput).setInputFiles(item.files);
  await page.waitForTimeout(1500 + item.files.length * 800);

  // タイトル / キャプション
  await page.locator(S.title).fill(item.title.slice(0, S.limits.title));
  await page.locator(S.caption).fill(item.caption.slice(0, S.limits.caption));

  // タグ
  const tags = item.tags.slice(0, S.limits.tags);
  const tagInput = page.locator(S.tagInput);
  for (const tag of tags) {
    await tagInput.fill(tag);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
  }

  // 必須項目
  await page.locator(S.ageRestrict.replace("{value}", cfg.pixiv.ageLimit)).check();
  await page.locator(S.aiType.replace("{value}", cfg.pixiv.aiFlag ? "aiGenerated" : "notAiGenerated")).check();

  if (cfg.pixiv.restrict) await page.locator(S.restrict.replace("{value}", cfg.pixiv.restrict)).check();
  if (cfg.pixiv.markOriginal) await page.locator(S.original).check();

  // 予約投稿
  if (item.scheduledAt) {
    const { date, time } = toDropdownLabels(item.scheduledAt);
    await page.getByText(S.reserveLabel, { exact: true }).click();
    await page.waitForTimeout(1000);
    await selectFromDropdown(page, 0, date, prefix);
    await selectFromDropdown(page, 1, time, prefix);
  }

  log(`${prefix}${item.id}: 画像${item.files.length}枚 / タグ${tags.length}件 / ${item.scheduledAt ?? "予約なし"}`);
}

/**
 * 投稿ボタンが押されたらしいかを判定する（途中経過の表示用）。
 *
 * 遷移先のURLはpixiv側の都合で変わるので決め打ちしない。
 * 正確な結果は、バッチ終了時に pixiv の予約一覧と突き合わせて確定させる。
 */
export function looksSubmitted(page) {
  if (page.isClosed()) return false;
  return !page.url().includes("/illustration/create");
}
