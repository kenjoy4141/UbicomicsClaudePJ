/**
 * 作品ごとの設定（ヒロイン名・主人公名・プロフィール）を1箇所で持つ。
 * プロフィールカードとストーリーで名前が食い違わないようにするため。
 *
 * 保存先: data/works/<作品タイトル>.json
 */
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson, ROOT } from "./lib.js";

const DIR = path.join(ROOT, "data/works");

const slug = (title) => title.replace(/[\/:*?"<>|]/g, "_").slice(0, 80);

export function workPath(title) {
  return path.join(DIR, `${slug(title)}.json`);
}

export function loadWork(title) {
  return readJson(workPath(title), null);
}

export function saveWork(title, data) {
  fs.mkdirSync(DIR, { recursive: true });
  const cur = loadWork(title) ?? {};
  const next = { ...cur, ...data, title, updatedAt: new Date().toISOString() };
  writeJson(workPath(title), next);
  return next;
}

/** 作品の登場人物を決める。既に決まっていればそれを使う */
export function ensureCast(title, { heroine, hero, names, story } = {}) {
  const cur = loadWork(title) ?? {};
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  const cast = {
    heroine: heroine ?? cur.heroine ?? `${pick(names.sei)} ${pick(names.mei)}`,
    hero: hero ?? cur.hero ?? pick(story.heroNames),
  };
  return saveWork(title, cast);
}
