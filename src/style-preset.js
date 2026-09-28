/**
 * 画風のプリセット。プロンプトの中身は変えず、足りない要素を足すだけにする。
 *
 * shiron: 参考にした作風（濡れた肌の強いハイライト・寄りの構図・背景を落とす）。
 *   絵柄やキャラを真似るのではなく、「照り」「寄り」「光の置き方」を寄せる。
 */

export const PRESETS = {
  shiron: {
    // 肌の照りと光。ここが一番効く
    quality: "(glossy skin:1.25), (wet skin:1.2), (sweat:1.15), dewy skin, " +
      "(specular highlights:1.2), subsurface scattering, (soft rim light:1.15), " +
      "warm key light, (shallow depth of field:1.15), blurred background,",
    // 導入（着衣・非性的）用。汗と濡れは入れず、光とボケだけ寄せる
    qualityIntro: "(soft rim light:1.15), warm key light, (shallow depth of field:1.15), " +
      "blurred background, subsurface scattering, clean skin,",
    // 表情。淡泊になりがちなのを寄せる
    face: "(flushed cheeks:1.2), heavy blush, half-closed eyes, parted lips,",
    // 導入は表情も控えめ。初対面から潤んだ目をしているのはおかしい
    faceIntro: "(beautiful detailed eyes:1.1), soft expression,",
    negative: "flat lighting, matte skin, dry skin, dull colors, washed out, " +
      "busy background, cluttered background, harsh shadows,",
    // 構図。行ごとに順番に当てて、立ち絵ばかりにならないようにする
    framing: [
      "(close-up:1.1), upper body,",
      "cowboy shot,",
      "(from above:1.15),",
      "upper body, (dutch angle:1.05),",
      "(close-up:1.15), face focus,",
      "from side,",
    ],
  },
  // flat: 線が太くて塗りが平たい、同人表紙でよく見る作風。
  // shiron とは正反対（照り・濡れを入れない）ので、混ぜて使わない
  flat: {
    quality: "(flat color:1.35), (bold outline:1.25), (thick lineart:1.2), clean lineart, " +
      "cel shading, minimal shading, limited palette, (high contrast:1.05), " +
      "(simple background:1.2), crisp edges,",
    qualityIntro: "(flat color:1.35), (bold outline:1.25), (thick lineart:1.2), clean lineart, " +
      "cel shading, minimal shading, limited palette, (simple background:1.2),",
    // 目の描き方。参考にした作風は「大きい虹彩・太いまつ毛・ハイライトは単純」
    eyes: "(large eyes:1.15), big round iris, (bold eyelashes:1.15), thick upper eyelashes, " +
      "simple eye highlights, bright iris,",
    face: "(flushed cheeks:1.15), simple blush, half-closed eyes, parted lips,",
    faceIntro: "(beautiful detailed eyes:1.1), simple blush, calm expression,",
    negative: "glossy skin, wet skin, sweat, specular highlights, subsurface scattering, " +
      "gradient shading, soft shading, airbrush, photorealistic, 3d, detailed background, " +
      "busy background, depth of field, bokeh,",
    framing: [
      "(close-up:1.1), upper body,",
      "cowboy shot,",
      "upper body,",
      "(from above:1.1),",
      "(close-up:1.15), face focus,",
      "cowboy shot, from side,",
    ],
  },
};

// すでに構図の指定がある行には足さない
const HAS_FRAMING = /(close-?up|cowboy shot|full body|upper body|from above|from below|from side|wide shot|portrait)/i;

/**
 * プリセットを当てたプロンプトを返す。
 * @param {string} prompt 元のプロンプト
 * @param {number} index  行番号（構図を順番に回すのに使う）
 * @param {string} name   プリセット名
 */
export function applyStyle(prompt, index, name, { intro = false } = {}) {
  const p = PRESETS[name];
  if (!p) return prompt;
  // 導入（着衣・非性的）は濡れ・汗を入れない。玄関先の会話で汗だくの絵になるため
  const add = intro
    ? [p.qualityIntro ?? p.quality, p.faceIntro ?? p.face]
    : [p.quality, p.face];
  if (p.eyes) add.push(p.eyes);
  if (!HAS_FRAMING.test(prompt)) add.push(p.framing[index % p.framing.length]);
  return prompt + " " + add.join(" ");
}

/** プリセットのネガティブ。無ければ空文字 */
export function styleNegative(name) {
  return PRESETS[name]?.negative ?? "";
}
