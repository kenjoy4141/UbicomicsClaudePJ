/**
 * ストーリーボード（config/intro-storyboard-*.json）から、シートの導入パートの行を組み立てる。
 *
 * 絵の指定（服装・場所・構図・表情）とセリフを同じビートから作るので、
 * 「絵は玄関で荷物を渡しているのにセリフは膝枕」のようなズレが起きない。
 *
 * variant 側に必要なもの:
 *   introStoryboard … ストーリーボードのパス
 *   introOutfits    … { neat, loose, off, inner, underwear } 服装の段階
 *   introPlaces     … { outer, inner, room } 場所
 *   words           … セリフと構図に差し込む言葉
 */
import path from "node:path";
import { readJson, render, ROOT } from "./lib.js";

/** シートの1行ぶん（A〜S列）。列の意味は config.sheet の _note を参照 */
function rowFor(beat, V, first) {
  const words = V.words ?? {};
  const outfit = V.introOutfits?.[beat.outfit] ?? V.coverOutfit ?? "";
  const place = V.introPlaces?.[beat.place] ?? "";
  const row = new Array(19).fill("");
  row[0] = first ? "非エロ" : "";                      // A: 区切り
  row[2] = beat.scene;                                  // C: シーン名
  row[3] = "1girl, woman, mature female, 28 years old woman,"; // D: 人物
  row[4] = V.face;                                      // E: 顔・髪型
  row[5] = beat.expr ?? "(beautiful detailed eyes:1.1),"; // F: 表情
  row[7] = outfit;                                      // H: 服装
  row[8] = beat.undies ?? "";                           // I: 下着
  row[9] = V.introBody ?? "(towering:1.2), tall woman, long legs, adult proportion, voluptuous body, (curvaceous body:1.1), healthy body, (large breasts:1.3), soft breasts, tight clothing fit, wide hips, plump thighs,"; // J: 体形
  row[10] = render(beat.pose ?? "", words);             // K: ポーズ・構図
  row[13] = place;                                      // N: 場所
  row[17] = String(beat.images ?? 2);                   // R: 枚数
  row[18] = `Day${beat.day}`;                           // S: メモ
  return row;
}

/** ストーリーボードから導入パートの行とセリフを作る */
export function buildIntro(V) {
  const sb = readJson(path.join(ROOT, V.introStoryboard));
  const per = sb.imagesPerBeat ?? 2;
  const rows = [];
  const beats = [];
  let image = 0;
  sb.beats.forEach((b, i) => {
    // poses（構図の配列）があれば1構図=1枚ずつ行を作る。
    // コマ割りで並べたときに同じ絵が2つ並ばないようにするため
    const poses = Array.isArray(b.poses) && b.poses.length ? b.poses : null;
    const n = poses ? poses.length : (b.images ?? per);
    if (poses) {
      poses.forEach((pose, j) => rows.push(rowFor({ ...b, pose, images: 1 }, V, i === 0 && j === 0)));
    } else {
      rows.push(rowFor({ ...b, images: n }, V, i === 0));
    }
    beats.push({ ...b, images: n, firstImage: image + 1, lastImage: image + n });
    image += n;
  });
  return { rows, beats, totalImages: image };
}
