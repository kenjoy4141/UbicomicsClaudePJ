/**
 * シートの読み取り口を1箇所にまとめる。
 *
 * サービスアカウントの鍵があればAPI経由で読む（非公開シートでも読める）。
 * 鍵が無い場合はCSVエクスポートにフォールバックする（シートの公開設定が必要）。
 */
import { log } from "./lib.js";
import { hasCredentials, readRange, getInfo } from "./sheets.js";

/** gid からタブ名を引く */
export async function resolveTabName(cfg) {
  if (cfg.sheet.tab) return cfg.sheet.tab;
  const info = await getInfo(cfg.sheet.id);
  const hit = info.sheets.find((s) => String(s.gid) === String(cfg.sheet.gid));
  if (!hit) throw new Error(`gid=${cfg.sheet.gid} のタブが見つかりません`);
  return hit.title;
}

/**
 * シートを2次元配列で返す。
 * 返り値は行の配列で、各行は列の配列（末尾の空セルは省かれることがある）。
 */
export async function loadSheetRows(cfg, range = "A1:S1000") {
  if (hasCredentials()) {
    const tab = await resolveTabName(cfg);
    const rows = await readRange(cfg.sheet.id, `${tab}!${range}`);
    log(`シートを読み込み: ${tab}!${range}（API経由 / ${rows.length}行）`);
    return rows;
  }

  log("! サービスアカウントの鍵が無いため、CSVエクスポートで読み込みます（シートが公開設定である必要があります）");
  const url = `https://docs.google.com/spreadsheets/d/${cfg.sheet.id}/gviz/tq?tqx=out:csv&gid=${cfg.sheet.gid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`シートを取得できません (HTTP ${res.status})`);
  return parseCsv(await res.text());
}

/** CSVフォールバック用のパーサ */
export function parseCsv(text) {
  const out = [];
  let field = "", row = [], inQuotes = false;
  const QUOTE = String.fromCharCode(34);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === QUOTE) {
        if (text[i + 1] === QUOTE) { field += QUOTE; i++; } else inQuotes = false;
      } else field += c;
    } else {
      if (c === QUOTE) inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); out.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
  }
  if (field || row.length) { row.push(field); out.push(row); }
  return out;
}
