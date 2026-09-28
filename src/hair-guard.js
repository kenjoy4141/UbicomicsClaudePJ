/**
 * 髪色のブレ対策。
 *
 * キャラ文字列（E列や --char）から髪色を読み取り、それ以外の髪色をネガティブに入れる。
 * 例: black hair のキャラなら silver / white / grey hair などを弾く。
 * 年齢を上げる語や夜のライティングで黒髪が銀髪・白髪に化ける事故が実際に起きたため入れている。
 */

// 同じグループの色は互いにネガティブに入れない（dark brown と brown など）
const GROUPS = [
  ["black", "jet black", "dark"],
  ["brown", "dark brown", "light brown", "chestnut", "ash brown"],
  ["blonde", "golden", "light blonde"],
  ["silver", "white", "grey", "gray", "platinum"],
  ["pink", "light pink"],
  ["red", "crimson"],
  ["orange"],
  ["blue", "dark blue", "light blue", "navy"],
  ["purple", "violet", "lavender"],
  ["green", "dark green"],
];

const NEGATIVE_ALWAYS = "multicolored hair, gradient hair, streaked hair, two-tone hair, colored inner hair, colored hair tips,";

/** キャラ文字列に含まれる髪色のグループ番号。見つからなければ -1 */
export function detectHairGroup(text) {
  const t = String(text ?? "").toLowerCase();
  let best = { group: -1, len: 0 };
  GROUPS.forEach((colors, g) => {
    for (const c of colors) {
      if (t.includes(`${c} hair`) && c.length > best.len) best = { group: g, len: c.length };
    }
  });
  return best.group;
}

/** 追加するネガティブプロンプト。髪色が読めなければ多色髪の抑制だけ返す */
export function hairNegative(characterText, weight = 1.2) {
  const g = detectHairGroup(characterText);
  if (g < 0) return NEGATIVE_ALWAYS;
  const others = GROUPS.filter((_, i) => i !== g).map((colors) => `${colors[0]} hair`);
  // 白髪・銀髪への化けが一番多いので、銀髪キャラ以外はそのグループを全部入れる
  if (g !== 3) others.push("white hair", "grey hair");
  return `(${others.join(", ")}:${weight}), ${NEGATIVE_ALWAYS}`;
}
