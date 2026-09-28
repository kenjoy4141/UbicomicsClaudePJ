/** 既存の空下書きで「有料アクセス」の中身を調べる（調査用・掲載しない） */
import path from "node:path";
import { loadConfig, openBrowser, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const url = process.argv[2];
const { ctx, page } = await openBrowser(cfg, { headless: false });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const panelDump = async (label) => {
  const lines = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left > 1000; };
    return [...document.querySelectorAll("input,button,[role=checkbox],[role=radio],[role=switch],[role=combobox],label,h2,h3,p,span")].filter(vis)
      .map((el) => `<${el.tagName.toLowerCase()}${el.type ? ` type=${el.type}` : ""}${el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : ""}` +
        `${el.getAttribute("aria-label") ? ` aria="${el.getAttribute("aria-label")}"` : ""}${el.getAttribute("data-tag") ? ` data-tag=${el.getAttribute("data-tag")}` : ""}` +
        `${el.checked !== undefined ? ` checked=${el.checked}` : ""}> ${(el.innerText || el.value || "").trim().slice(0, 60).replace(/\s+/g, " ")}`)
      .filter((l) => !/> $/.test(l) || /input|role=/.test(l));
  });
  console.log(`\n=== ${label}`);
  [...new Set(lines)].slice(0, 80).forEach((l) => console.log("  " + l));
  await page.screenshot({ path: path.join(ROOT, "logs", `probe-patreon-${label}.png`) });
};

await page.getByText("有料アクセス", { exact: true }).click();
await page.waitForTimeout(2500);
await panelDump("paid");
await page.locator('button[aria-label="ランクを選択する"]').click();
await page.waitForTimeout(2000);
const ranks = await page.evaluate(() => [...document.querySelectorAll("[role=dialog] *, [role=listbox] *, [role=menu] *")].map((e) => (e.innerText || "").trim()).filter(Boolean));
console.log("=== ranks");
[...new Set(ranks)].slice(0, 30).forEach((r) => console.log("  " + r.replace(/\s+/g, " ").slice(0, 80)));
await page.screenshot({ path: path.join(ROOT, "logs", "probe-patreon-ranks.png") });
await page.keyboard.press("Escape");
log("閉じます（掲載はしていません）");
await ctx.close();
