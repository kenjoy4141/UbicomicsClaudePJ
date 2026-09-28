/**
 * タイトル候補を組み立てる。
 * BOOTHのアダルト規制を踏まえ、性的表現は使わず「役柄 + 場所・シチュエーション」で作る。
 * 過去に選ばれたタイトルの型（テンプレート）を優先して並べ替える。
 */
import { applyPrefs } from "./wordprefs.js";

const GENERIC_ROLE = ["大人の女性", "熟女"];

/** 包含関係のある語を落とす（ワンルームがあれば「部屋」は捨てる）*/
function dedupe(list) {
  return list.filter((a) => !list.some((b) => b !== a && b.includes(a)));
}

function tallyByCategory(feats, category) {
  const t = {};
  for (const f of feats) {
    for (const tag of f.tags) {
      if (tag.startsWith(category + ":")) {
        const v = tag.slice(category.length + 1);
        t[v] = (t[v] ?? 0) + 1;
      }
    }
  }
  return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

// テンプレートはIDを持たせて、どの型が選ばれやすいかを学習できるようにする
const TEMPLATES = [
  { id: "role-place-futarikiri", need: ["role", "place"], make: (r, p) => `${r}の${p}でふたりきり` },
  { id: "place-role-futarikiri", need: ["role", "place"], make: (r, p) => `${p}で${r}とふたりきり` },
  { id: "tonari-role-place", need: ["role", "place"], make: (r, p) => `となりの${r}の${p}` },
  { id: "role-place-holiday", need: ["role", "place"], make: (r, p) => `${r}と${p}で過ごす休日` },
  { id: "role-holiday", need: ["role"], make: (r) => `${r}とふたりきりの休日` },
  { id: "role-night", need: ["role"], make: (r) => `${r}と過ごす夜` },
  { id: "role-himitsu", need: ["role"], make: (r) => `${r}とのひみつの時間` },
  { id: "tonari-role", need: ["role"], make: (r) => `となりの${r}` },
  { id: "role-houkago", need: ["role"], make: (r) => `放課後の${r}` },
  { id: "role-futarikiri", need: ["role"], make: (r) => `${r}とふたりきり` },
  { id: "role-place-omoide", need: ["role", "place"], make: (r, p) => `${p}の${r}との思い出` },
];

/**
 * @param feats extractFeatures の結果の配列
 * @param choices data/choices.json の items
 */
export function buildTitles(feats, choices = []) {
  const roles = dedupe(tallyByCategory(feats, "role").filter((r) => !GENERIC_ROLE.includes(r)));
  const places = dedupe(tallyByCategory(feats, "place"));
  const role = roles[0] ?? tallyByCategory(feats, "role")[0] ?? "お姉さん";
  // 「保健室の先生」と「保健室」のように役柄と場所が重なる場合、
  // 両方を並べると「となりの保健室の先生の保健室」になってしまうので場所を外す
  const place = places.find((p) => !role.includes(p) && !p.includes(role)) ?? null;

  // 過去に選ばれたテンプレートIDの回数
  const tplCount = {};
  for (const c of choices) if (c.titleTemplate) tplCount[c.titleTemplate] = (tplCount[c.titleTemplate] ?? 0) + 1;

  const out = [];
  const seen = new Set();
  for (const t of TEMPLATES) {
    if (t.need.includes("place") && !place) continue;
    const s = t.make(role, place);
    if (!s || s.length > 20 || seen.has(s)) continue;
    seen.add(s);
    out.push({ text: s, template: t.id, score: tplCount[t.id] ?? 0 });
  }

  // 2番目の役柄・場所でも作っておく（バリエーション用）
  for (const r of roles.slice(1, 3)) {
    const s = `${r}とふたりきり`;
    if (!seen.has(s)) {
      seen.add(s);
      out.push({ text: s, template: "role2-futarikiri", score: tplCount["role2-futarikiri"] ?? 0 });
    }
  }

  out.sort((a, b) => b.score - a.score);
  // 呼び出し側は文字列だけ使うが、テンプレートIDも引けるようにしておく
  // 学習済みの言い回し（例 ワンルーム -> お部屋）を反映する
  for (const o of out) o.text = applyPrefs(o.text);
  const list = out.map((o) => o.text);
  list.meta = out;
  return list;
}
