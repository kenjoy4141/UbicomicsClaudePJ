/**
 * FANZA同人の作品登録フォームの項目を全部書き出す（何も登録しない）。
 *
 *   node tools/dump-fanza-form.mjs A
 *
 * 出力: logs/fanza-addproduct.json / logs/fanza-addproduct.txt
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, openBrowser, restoreCookies, log, ROOT } from "../src/lib.js";

const cfg = loadConfig();
const account = process.argv[2] ?? "A";
const url = process.argv[3] ?? "https://dojin.dmm.co.jp/addproduct";
const { ctx, page } = await openBrowser(cfg, { headless: false, profile: `fanza-${account}` });

await restoreCookies(ctx, `fanza-${account}`);
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
log(`URL: ${page.url()}`);
if (/accounts\.dmm\.co\.jp/.test(page.url())) {
  console.error("! ログイン画面に飛ばされました。node src/login.js fanza " + account + " でログインしてください");
  await ctx.close();
  process.exit(1);
}

const dump = await page.evaluate(() => {
  const txt = (el) => (el?.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  // ラベルを探す: for= / 親のlabel / 直後のテキスト
  const labelOf = (el) => {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return txt(l);
    }
    const p = el.closest("label");
    if (p) return txt(p);
    const n = el.nextElementSibling;
    return n ? txt(n) : "";
  };
  // 見出し（section の名前）を拾う
  const sectionOf = (el) => {
    let n = el;
    while (n && n !== document.body) {
      const h = n.querySelector?.(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > dt, :scope > .ttl, :scope > legend");
      if (h) return txt(h);
      n = n.parentElement;
    }
    return "";
  };
  const out = [];
  for (const el of document.querySelectorAll("form input, form select, form textarea, form button, input, select, textarea, button")) {
    if (out.some((o) => o._el === el)) continue;
    const r = el.getBoundingClientRect();
    const item = {
      tag: el.tagName.toLowerCase(),
      type: el.type ?? "",
      name: el.name ?? "",
      id: el.id ?? "",
      required: !!el.required,
      maxLength: el.maxLength > 0 ? el.maxLength : undefined,
      accept: el.accept || undefined,
      value: (el.value ?? "").slice(0, 40),
      label: labelOf(el),
      section: sectionOf(el),
      visible: r.width > 0 && r.height > 0,
    };
    if (el.tagName === "SELECT") {
      item.options = [...el.options].slice(0, 60).map((o) => `${o.value}=${o.text.trim().slice(0, 30)}`);
    }
    out.push(item);
  }
  const forms = [...document.querySelectorAll("form")].map((f) => ({ action: f.action, method: f.method, id: f.id }));
  return { forms, controls: out, text: document.body.innerText.slice(0, 6000) };
});

fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "logs/fanza-addproduct.json"), JSON.stringify(dump, null, 2), "utf8");

const lines = [];
lines.push(`URL: ${page.url()}`);
lines.push("=== form ===");
dump.forms.forEach((f) => lines.push(`  ${f.method} ${f.action} (id=${f.id})`));
lines.push("=== 入力欄 ===");
let lastSection = null;
for (const c of dump.controls) {
  if (c.section !== lastSection) { lines.push(`\n--- ${c.section || "(見出しなし)"} ---`); lastSection = c.section; }
  lines.push(
    `  <${c.tag}${c.type ? ` type=${c.type}` : ""}${c.name ? ` name=${c.name}` : ""}${c.id ? ` id=${c.id}` : ""}>` +
    `${c.required ? " [必須]" : ""}${c.visible ? "" : " [非表示]"}${c.accept ? ` accept=${c.accept}` : ""}` +
    `${c.maxLength ? ` max=${c.maxLength}` : ""}${c.value ? ` value="${c.value}"` : ""}${c.label ? ` … ${c.label}` : ""}`
  );
  if (c.options) c.options.forEach((o) => lines.push(`        ${o}`));
}
lines.push("\n=== ページ本文 ===");
lines.push(dump.text);
fs.writeFileSync(path.join(ROOT, "logs/fanza-addproduct.txt"), lines.join("\n"), "utf8");

await page.screenshot({ path: path.join(ROOT, "logs/fanza-addproduct.png"), fullPage: true });
log(`書き出し: logs/fanza-addproduct.txt / .json / .png（入力欄 ${dump.controls.length}件）`);
await ctx.close();
