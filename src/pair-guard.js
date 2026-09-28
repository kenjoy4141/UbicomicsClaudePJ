/**
 * 男女の作品なのに女どうしの絡みが生成される問題への対策。
 *
 * Illustrious系のモデルは danbooru のタグに強く反応するので、
 * 相手役の男がいる行には `1boy, 1girl, hetero` を、
 * 居ない行には「2人目の女が出ない」ようにネガティブを足す。
 *
 * プロンプトの文章を書き換えるのではなく、足りないタグを前に付けるだけにする。
 */

/** 相手役の男がいる行かどうか。シートの英語プロンプトから見分ける */
const MAN_CUES = [
  /\badult man\b/i,
  /\bbroad shoulders\b/i,
  /\bhetero\b/i,
  /\bmale\b/i,
  /\bboyfriend\b/i,
  /\bpenis\b/i,
  /\bcum\b/i,
  /\bpaizuri\b/i,
  /\bfellatio\b/i,
  /\bblowjob\b/i,
  /\bhandjob\b/i,
  /\bvaginal\b/i,
  /\bcowgirl\b/i,
  /\bmissionary\b/i,
  /\bdoggystyle\b/i,
];

export function hasMan(prompt) {
  return MAN_CUES.some((re) => re.test(prompt));
}

/** 女どうしになるのを防ぐネガティブ。相手役の有無に関係なく足す */
export const PAIR_NEGATIVE =
  "yuri, 2girls, 3girls, multiple girls, girl on girl, futanari, futa, " +
  "shemale, otoko no ko, trap, crossdressing,";

/**
 * 足りないタグを前に付けたプロンプトを返す。
 * すでに書いてあるタグは足さない（重みがおかしくなるため）。
 */
export function pairTags(prompt) {
  const add = [];
  if (hasMan(prompt)) {
    if (!/\b1boy\b/i.test(prompt)) add.push("1boy");
    if (!/\b1girl\b/i.test(prompt)) add.push("1girl");
    if (!/\bhetero\b/i.test(prompt)) add.push("hetero");
  } else {
    if (!/\b1girl\b/i.test(prompt)) add.push("1girl");
    // solo は足さない。相手役の手だけ写る構図などを消してしまうため、
    // 2人目の女を出さないのはネガティブ側に任せる
  }
  return add.length ? add.join(", ") + ", " + prompt : prompt;
}
