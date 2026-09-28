/**
 * Patreon向けプロンプトの安全チェック。
 *
 * Patreonは illustrated / AI生成の成人向け作品について
 * 「登場人物が間違いなく大人と解釈できること」を求め、
 * 未成年を想起させる要素（身体・文脈・場所）を判断材料にする。
 * CSAMはゼロトレランスで、手描き・AI生成を問わない。
 *
 * ここで1件でも引っかかったら生成を止める。例外は作らない。
 *
 *   node src/safety-lint.js --tab patreon_100   … シートのタブを検査
 */

// 必ず止める語。単語境界で判定する（"cowboy shot" の boy などは引っかからない）
const BLOCK = [
  "shota", "shotacon", "onee-shotacon", "loli", "lolicon", "toddler", "child", "children",
  "kid", "kids", "boy", "boys", "young boy", "very young", "teen", "teenage", "teenager",
  "underage", "minor", "minors", "preteen", "junior high", "middle school", "elementary",
  "high school", "schoolgirl", "schoolboy", "school uniform", "gakuran", "randoseru",
  "student", "students", "classroom", "class room", "school", "school infirmary", "infirmary", "kindergarten",
  "little sister", "little brother", "aged down", "younger",
];

// 判定の前に取り除く、紛らわしいが問題ない定型句
const ALLOW = [
  "cowboy shot", "cowgirl position", "reverse cowgirl position", "reverse cowgirl",
];

// 大人であることを明示する語。最低1つは入っていることを求める
const ADULT_CUES = ["mature female", "adult", "woman", "office lady", "milf", "adult proportion"];

/** 単語境界つきで含むか（正規表現を使わない。英字以外を境界とみなす） */
function hasWord(text, word) {
  const isAlpha = (c) => c >= "a" && c <= "z";
  let i = 0;
  while ((i = text.indexOf(word, i)) !== -1) {
    const before = i === 0 ? " " : text[i - 1];
    const after = i + word.length >= text.length ? " " : text[i + word.length];
    if (!isAlpha(before) && !isAlpha(after)) return true;
    i += word.length;
  }
  return false;
}

/**
 * @returns {{ ok: boolean, blocked: string[], missingAdult: boolean }}
 */
export function lintPrompt(prompt) {
  let text = String(prompt ?? "").toLowerCase();
  for (const a of ALLOW) text = text.split(a).join(" ");

  const blocked = BLOCK.filter((w) => hasWord(text, w));
  const missingAdult = !ADULT_CUES.some((c) => text.includes(c));
  return { ok: blocked.length === 0 && !missingAdult, blocked, missingAdult };
}

/**
 * 許可リストに無い LoRA を返す。キャラLoRAは既存作品のキャラ（年齢設定を含む）を持ち込むため、
 * config.sd.allowedLoras に明示したもの（画風LoRAなど）以外は使わせない。
 * @returns {string[]} 許可されていない LoRA 名
 */
export function disallowedLoras(prompt, allowed = []) {
  const text = String(prompt ?? "");
  const found = [];
  let i = 0;
  while ((i = text.indexOf("<lora:", i)) !== -1) {
    const end = text.indexOf(">", i);
    const name = text.slice(i + 6, end === -1 ? undefined : end).split(":")[0].trim();
    if (!allowed.includes(name) && !found.includes(name)) found.push(name);
    i += 6;
  }
  return found;
}

/** 複数のプロンプトをまとめて検査し、問題があれば詳細を返す */
export function lintAll(prompts) {
  const problems = [];
  prompts.forEach((p, i) => {
    const r = lintPrompt(p.prompt ?? p);
    if (!r.ok) problems.push({ index: i, row: p.row, ...r });
  });
  return problems;
}

// ---------- CLI ----------
if (process.argv[1]?.endsWith("safety-lint.js")) {
  const { loadConfig } = await import("./lib.js");
  const { readRange } = await import("./sheets.js");
  const cfg = loadConfig();
  const i = process.argv.indexOf("--tab");
  const tab = i >= 0 ? process.argv[i + 1] : null;
  if (!tab) {
    console.error("使い方: node src/safety-lint.js --tab <タブ名>");
    process.exit(1);
  }
  const rows = await readRange(cfg.sheet.id, `${tab}!Q4:Q400`);
  const prompts = rows.map((r, k) => ({ row: k + 4, prompt: r[0] ?? "" })).filter((p) => p.prompt.trim());
  const problems = lintAll(prompts);

  console.log(`${tab}: ${prompts.length}行を検査`);
  if (problems.length === 0) {
    console.log("問題なし");
    process.exit(0);
  }
  console.log(`\n! ${problems.length}行で問題を検出:`);
  for (const p of problems.slice(0, 30)) {
    const why = [
      p.blocked.length ? `禁止語: ${p.blocked.join(", ")}` : "",
      p.missingAdult ? "大人を示す語がない" : "",
    ].filter(Boolean).join(" / ");
    console.log(`  行${p.row}: ${why}`);
  }
  process.exit(2);
}
