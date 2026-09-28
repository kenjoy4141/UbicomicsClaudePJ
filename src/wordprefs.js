/**
 * 候補タイトルを手直ししたときの「言い回しの好み」を覚える。
 * 例: 「となりのお姉さんのワンルーム」→「となりのお姉さんのお部屋」なら
 *     ワンルーム -> お部屋 という置換を学習し、次回から自動で適用する。
 */
import path from "node:path";
import { readJson, writeJson, ROOT } from "./lib.js";

const PREFS_PATH = path.join(ROOT, "data/word-prefs.json");

/** 候補文と採用文の差分から、単純な語の置換を1つ取り出す */
export function diffSubstitution(candidate, adopted) {
  if (!candidate || !adopted || candidate === adopted) return null;

  let head = 0;
  while (head < candidate.length && head < adopted.length && candidate[head] === adopted[head]) head++;

  let tail = 0;
  while (
    tail < candidate.length - head &&
    tail < adopted.length - head &&
    candidate[candidate.length - 1 - tail] === adopted[adopted.length - 1 - tail]
  ) tail++;

  const from = candidate.slice(head, candidate.length - tail);
  const to = adopted.slice(head, adopted.length - tail);

  // 全文が入れ替わっている場合は「言い回しの直し」ではないので学習しない
  if (!from || from.length > 8 || to.length > 8) return null;
  return { from, to };
}

export function loadPrefs() {
  return readJson(PREFS_PATH, { subs: {} });
}

export function recordSubstitution(sub) {
  if (!sub) return null;
  const prefs = loadPrefs();
  prefs.subs[sub.from] = prefs.subs[sub.from] ?? { to: sub.to, count: 0 };
  // 別の語に直された場合は新しい方に更新する
  if (prefs.subs[sub.from].to !== sub.to) prefs.subs[sub.from] = { to: sub.to, count: 0 };
  prefs.subs[sub.from].count++;
  writeJson(PREFS_PATH, prefs);
  return { from: sub.from, to: sub.to, count: prefs.subs[sub.from].count };
}

/** 学習済みの置換をタイトルに適用する */
export function applyPrefs(text) {
  const prefs = loadPrefs();
  let out = text;
  for (const [from, v] of Object.entries(prefs.subs)) out = out.split(from).join(v.to);
  return out;
}
