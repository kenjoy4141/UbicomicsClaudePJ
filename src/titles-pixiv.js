/**
 * pixiv投稿用のタイトルを作る。
 *
 * 「（1/9）」のような連番は付けない（最後まで追われて購買意欲が落ちる）。
 * **作品名も入れない**（作品へ誘導している感じになるため。2026-09-25 ユーザー指定）。
 * タイトルは config.pixiv.titleVariants の言い回しだけで組む。
 */
import { render } from "./lib.js";

const LIMIT = 32; // pixivのタイトル上限

/** 配列をシャッフルした新しい配列を返す */
function shuffled(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/**
 * 作品名から、互いに重複しないタイトルを count 個作る。
 * 言い回しが足りない場合は一巡して使い回す（その場合も隣り合わないようにする）。
 */
export function makePixivTitles(workTitle, count, variants) {
  const usable = variants
    .map((v) => render(v, { title: workTitle }))
    .filter((t) => t.length <= LIMIT);

  // 言い回しが1つも使えないときだけ、作品名を切り詰めて使う
  if (usable.length === 0) return Array.from({ length: count }, () => workTitle.slice(0, LIMIT));

  const out = [];
  let pool = [];
  while (out.length < count) {
    if (pool.length === 0) {
      pool = shuffled(usable);
      // 一巡目の終わりと二巡目の頭が同じにならないようにする
      if (out.length && pool[0] === out[out.length - 1] && pool.length > 1) {
        [pool[0], pool[1]] = [pool[1], pool[0]];
      }
    }
    out.push(pool.shift());
  }
  return out;
}
