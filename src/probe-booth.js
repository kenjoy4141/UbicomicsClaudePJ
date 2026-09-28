/** BOOTHの管理画面から商品登録ページを探し、DOM構造を調べる（調査用・何も投稿しない） */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, openBrowser, log, ROOT } from "./lib.js";

const cfg = loadConfig();
const target = process.argv[2];
const { ctx, page } = await openBrowser(cfg, { headless: false });

await page.goto(target ?? "https://manage.booth.pm/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

console.log("URL  :", page.url());
console.log("TITLE:", await page.title());

if (/users\/sign_in/.test(page.url())) {
  log("未ログインです。node src/login.js booth を実行してください。");
  await ctx.close();
  process.exit(2);
}

if (!target) {
  // 管理画面のリンクを列挙して、商品追加らしきものを探す
  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")]
      .map((a) => ({ href: a.href, text: (a.innerText || "").trim().slice(0, 30) }))
      .filter((l) => l.href.includes("booth.pm"))
  );
  const seen = new Set();
  const uniq = links.filter((l) => !seen.has(l.href) && seen.add(l.href));
  console.log("\n--- 管理画面のリンク ---");
  uniq.slice(0, 40).forEach((l) => console.log(`  ${l.text.padEnd(20)} ${l.href}`));
  const cand = uniq.filter((l) => /item/.test(l.href) || /追加|新規|出品/.test(l.text));
  console.log("\n--- 商品まわりの候補 ---");
  cand.forEach((l) => console.log(`  ${l.text.padEnd(20)} ${l.href}`));
  await ctx.close();
  process.exit(0);
}

const dump = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("input,textarea,select,button,label,[contenteditable=true]")) {
    const r = el.getBoundingClientRect();
    out.push(
      `<${el.tagName.toLowerCase()}${el.type ? ` type=${el.type}` : ""}` +
      `${el.id ? ` id=${el.id}` : ""}${el.name ? ` name=${el.name}` : ""}` +
      `${el.getAttribute("for") ? ` for=${el.getAttribute("for")}` : ""}` +
      `${el.placeholder ? ` ph="${el.placeholder}"` : ""}` +
      `${r.width > 0 && r.height > 0 ? "" : " [hidden]"}` +
      `${(el.innerText || "").trim() ? ` :: ${(el.innerText || "").trim().slice(0, 45).replace(/\s+/g, " ")}` : ""}`
    );
  }
  return out;
});

const out = path.join(ROOT, "logs/booth-dom.txt");
fs.writeFileSync(out, `URL: ${page.url()}\n\n` + dump.map((d, i) => `#${i} ${d}`).join("\n"), "utf8");
await page.screenshot({ path: path.join(ROOT, "logs/booth-new.png"), fullPage: true });
log(`採取完了: ${out}（${dump.length}要素）`);
await ctx.close();
