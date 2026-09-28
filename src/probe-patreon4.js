/** 下書き編集画面で「画像」「添付ファイル」ボタンを押した後の画面を調べる（調査用・掲載しない） */
import path from "node:path";
import { loadConfig, openBrowser, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const url = process.argv[2];
const { ctx, page } = await openBrowser(cfg, { headless: false });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const dump = async (label) => {
  const info = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const files = [...document.querySelectorAll("input[type=file]")].map((el) =>
      `<input type=file accept="${el.accept}" multiple=${el.multiple} visible=${vis(el)} data-tag=${el.getAttribute("data-tag")}>`);
    const dialogs = [...document.querySelectorAll("[role=dialog], [role=menu]")].filter(vis).map((d) =>
      `[${d.getAttribute("role")}] ${(d.innerText || "").trim().replace(/\s+/g, " ").slice(0, 200)}`);
    return { files, dialogs };
  });
  console.log(`\n=== ${label}`);
  info.files.forEach((l) => console.log("  " + l));
  info.dialogs.forEach((l) => console.log("  " + l));
  await page.screenshot({ path: path.join(ROOT, "logs", `probe-patreon-${label}.png`) });
};

await dump("before");
page.on("filechooser", () => log("filechooser が開きました（キャンセル扱い）"));
await page.getByRole("button", { name: "画像", exact: true }).click();
await page.waitForTimeout(2500);
await dump("image-click");
await page.keyboard.press("Escape");
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "添付ファイル", exact: true }).click();
await page.waitForTimeout(2500);
await dump("attach-click");
await page.keyboard.press("Escape");
log("閉じます（掲載はしていません）");
await ctx.close();
