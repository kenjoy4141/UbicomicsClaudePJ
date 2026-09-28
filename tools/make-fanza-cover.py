# -*- coding: utf-8 -*-
"""
FANZA用の表紙・サムネ（横長4:3）を作る。

  python tools/make-fanza-cover.py --hero hero_cut.png --pages p1.jpg p2.jpg p3.jpg \
      --title "30日後[に]/結ばれる/看護師さん" --out cover.jpg

タイトルの書き方:
  /       … 改行
  [に]    … ハートの上に載せる助詞
  {blue}  … 行頭に付けると、その行を青字＋白フチにする（既定はピンク）
  例: "30日後[に]/{blue}S⚪︎Xする女医さん"

※ 「⚪」はフォントに無く豆腐になるので、見た目が同じ「○」に置き換えて描く

構成:
  背景   … 本編ページを傾けて散らし、ピンク×水色の2色刷りにする
  人物   … 切り抜いたヒロインを中央〜右に大きく置く
  文字   … 極太明朝、ピンクのグラデーション＋白フチ＋青い光彩
"""
import argparse
import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = r"C:\Windows\Fonts\NotoSerifJP-VF.ttf"

INK = (214, 79, 115)      # 2色刷りの濃い側（ピンク）
PAPER = (200, 236, 238)   # 2色刷りの淡い側（水色）
BASE = (214, 240, 242)    # 下地
PINK_TOP = (255, 168, 190)
PINK_BOTTOM = (232, 82, 124)
GLOW = (110, 178, 226)
BLUE_TOP = (120, 196, 248)
BLUE_BOTTOM = (34, 102, 196)
GLOW_FOR_BLUE = (246, 160, 190)

STYLES = {
    "pink": {"top": PINK_TOP, "bottom": PINK_BOTTOM, "glow": GLOW},
    "blue": {"top": BLUE_TOP, "bottom": BLUE_BOTTOM, "glow": GLOW_FOR_BLUE},
}

# フォントに無い記号を、見た目が同じ収録文字に置き換える
GLYPH_FIX = {"\u26aa": "\u25cb", "\u26ab": "\u25cf", "\ufe0e": "", "\ufe0f": ""}
HEART = (240, 112, 146)


def font(size, weight="Black"):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def duotone(img, ink=None, paper=None):
    """明るさを2色に写す。既定はピンク(暗)〜水色(明)"""
    g = np.asarray(img.convert("L")).astype(np.float32) / 255.0
    g = np.clip((g - 0.15) / 0.8, 0, 1)
    ink = np.array(ink if ink else INK, dtype=np.float32)
    paper = np.array(paper if paper else PAPER, dtype=np.float32)
    out = ink[None, None, :] * (1 - g[..., None]) + paper[None, None, :] * g[..., None]
    return Image.fromarray(out.astype(np.uint8), "RGB")


# 背景の色づかい。dark は黒地にピンクのページを散らす（同人サムネによくある形）
BG_THEMES = {
    "pink": {"base": BASE, "ink": INK, "paper": PAPER, "border": (255, 255, 255)},
    "dark": {"base": (16, 14, 18), "ink": (150, 40, 80), "paper": (250, 210, 225), "border": (250, 250, 250)},
}


def draw_background(W, H, pages, rng, theme="pink"):
    th = BG_THEMES.get(theme, BG_THEMES["pink"])
    canvas = Image.new("RGB", (W, H), th["base"])
    if not pages:
        return canvas
    # 画面を覆うように、ページを少しずつずらして傾けて置く
    slots = [(-0.08, -0.10), (0.18, 0.28), (0.40, -0.18), (0.62, 0.22), (0.86, -0.06), (0.05, 0.55)]
    order = list(pages)
    rng.shuffle(order)
    for i, (sx, sy) in enumerate(slots):
        src = Image.open(order[i % len(order)]).convert("RGB")
        ph = int(H * rng.uniform(0.85, 1.05))
        pw = int(ph * src.width / src.height)
        page = duotone(src.resize((pw, ph), Image.LANCZOS), th["ink"], th["paper"])

        border = max(4, W // 180)
        framed = Image.new("RGB", (pw + border * 2, ph + border * 2), th["border"])
        framed.paste(page, (border, border))
        framed = framed.convert("RGBA").rotate(rng.uniform(-14, 14), resample=Image.BICUBIC, expand=True)

        x = int(W * sx) - framed.width // 4
        y = int(H * sy) - framed.height // 4
        canvas.paste(framed, (x, y), framed)

    if theme == "dark":
        # ページで埋まると黒地が見えなくなるので、全体を暗く沈めて周辺をさらに落とす
        shade = Image.new("RGBA", (W, H), (0, 0, 0, 150))
        canvas = Image.alpha_composite(canvas.convert("RGBA"), shade).convert("RGB")
        vign = Image.new("L", (W, H), 0)
        ImageDraw.Draw(vign).ellipse(
            [-int(W * 0.15), -int(H * 0.25), int(W * 1.15), int(H * 1.25)], fill=255)
        vign = vign.filter(ImageFilter.GaussianBlur(W // 12)).point(lambda v: 255 - int(v * 0.75))
        dark = Image.new("RGBA", (W, H), (0, 0, 0, 255))
        dark.putalpha(vign)
        canvas = Image.alpha_composite(canvas.convert("RGBA"), dark).convert("RGB")
    return canvas


def gradient_text_layer(size, text, fnt, xy, top_color=PINK_TOP, bottom_color=PINK_BOTTOM):
    """文字の形をした縦グラデーション"""
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).text(xy, text, font=fnt, fill=255)
    top, bottom = np.array(top_color, np.float32), np.array(bottom_color, np.float32)
    bbox = mask.getbbox() or (0, 0, size[0], size[1])
    ys = np.clip((np.arange(size[1]) - bbox[1]) / max(1, bbox[3] - bbox[1]), 0, 1)
    grad = top[None, :] * (1 - ys[:, None]) + bottom[None, :] * ys[:, None]
    img = np.repeat(grad[:, None, :], size[0], axis=1).astype(np.uint8)
    layer = Image.fromarray(img, "RGB").convert("RGBA")
    layer.putalpha(mask)
    return layer


def heart_polygon(cx, cy, r):
    pts = []
    for k in range(80):
        t = 2 * math.pi * k / 80
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * r / 17, cy - y * r / 17))
    return pts


def parse_title(title):
    """'30日後[に]/結ばれる' を行ごとの (文字列, 助詞かどうか) の並びにする"""
    for k, v in GLYPH_FIX.items():
        title = title.replace(k, v)
    lines = []
    for raw in title.split("/"):
        style = "pink"
        if raw.startswith("{") and "}" in raw:
            name = raw[1:raw.index("}")]
            if name in STYLES:
                style = name
                raw = raw[raw.index("}") + 1:]
        parts, buf, i = [], "", 0
        while i < len(raw):
            if raw[i] == "<":
                j = raw.find(">", i)
                if j < 0:
                    buf += raw[i:]
                    break
                if buf:
                    parts.append((buf, False))
                    buf = ""
                parts.append((raw[i + 1:j], "emph"))
                i = j + 1
                continue
            if raw[i] == "[":
                j = raw.find("]", i)
                if j < 0:
                    buf += raw[i:]
                    break
                if buf:
                    parts.append((buf, False))
                    buf = ""
                parts.append((raw[i + 1:j], True))
                i = j + 1
            else:
                buf += raw[i]
                i += 1
        if buf:
            parts.append((buf, False))
        lines.append((style, parts))
    return lines


def draw_title(canvas, title, W, H, width_ratio=0.68):
    lines = parse_title(title)
    left = int(W * 0.035)
    max_w = int(W * width_ratio)
    measure = ImageDraw.Draw(canvas)

    # 一番長い行が枠に収まる文字サイズを探す（<...> は EMPH 倍で数える）
    EMPH = 1.5
    size = int(H * 0.24)
    while size > 12:
        f, fb = font(size), font(int(size * EMPH))
        widest = 0
        for _, parts in lines:
            w = 0
            for text, kind in parts:
                if kind == "emph":
                    w += measure.textlength(text, font=fb)
                elif kind:
                    w += int(size * 1.04)
                else:
                    w += measure.textlength(text, font=f)
            widest = max(widest, w)
        if widest <= max_w:
            break
        size -= 2
    f = font(size)
    fb = font(int(size * EMPH))
    fp = font(int(size * 0.44), "Bold")
    line_h = int(size * EMPH * 1.06)
    stroke = max(3, size // 11)

    text_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    stroke_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    glow_masks = {name: Image.new("L", canvas.size, 0) for name in STYLES}
    sd = ImageDraw.Draw(stroke_layer)

    y = int(H * 0.05)
    hearts = []
    for style, parts in lines:
        st = STYLES[style]
        gd = ImageDraw.Draw(glow_masks[style])
        x = left
        base = int(size * (EMPH - 1))  # 大きい文字と下端を揃えるためのずらし量
        for text, kind in parts:
            if kind == "emph":
                # 強調は大きく、ピンクのグラデーション＋白フチ
                gd.text((x, y), text, font=fb, fill=255, stroke_width=stroke * 3, stroke_fill=255)
                sd.text((x, y), text, font=fb, fill=(255, 255, 255, 255),
                        stroke_width=int(stroke * EMPH), stroke_fill=(255, 255, 255, 255))
                text_layer = Image.alpha_composite(
                    text_layer, gradient_text_layer(canvas.size, text, fb, (x, y), PINK_TOP, PINK_BOTTOM))
                x += int(measure.textlength(text, font=fb))
                continue
            if kind:
                r = int(size * 0.50)
                cx, cy = x + r + int(size * 0.04), y + base + int(size * 0.66)
                hearts.append((cx, cy, r, text))
                x += int(size * 1.04)
                continue
            gd.text((x, y + base), text, font=f, fill=255, stroke_width=stroke * 3, stroke_fill=255)
            sd.text((x, y + base), text, font=f, fill=(255, 255, 255, 255),
                    stroke_width=stroke, stroke_fill=(255, 255, 255, 255))
            text_layer = Image.alpha_composite(
                text_layer, gradient_text_layer(canvas.size, text, f, (x, y + base), st["top"], st["bottom"]))
            x += int(measure.textlength(text, font=f))
        y += line_h

    # 光彩 → 白フチ → 文字 の順に重ねる（光彩の色は行のスタイルごと）
    out = canvas.convert("RGBA")
    for name, mask in glow_masks.items():
        if not mask.getbbox():
            continue
        glow = Image.new("RGBA", canvas.size, STYLES[name]["glow"] + (0,))
        glow.putalpha(mask.filter(ImageFilter.GaussianBlur(size // 7)).point(lambda v: int(v * 0.85)))
        out = Image.alpha_composite(out, glow)
    out = Image.alpha_composite(out, stroke_layer)
    out = Image.alpha_composite(out, text_layer)

    # ハートの上の助詞
    d = ImageDraw.Draw(out)
    for cx, cy, r, text in hearts:
        d.polygon(heart_polygon(cx, cy, r + stroke), fill=(255, 255, 255, 255))
        d.polygon(heart_polygon(cx, cy, r), fill=HEART + (255,))
        bb = d.textbbox((0, 0), text, font=fp)
        tx = cx - (bb[0] + bb[2]) / 2
        ty = (cy - r * 0.08) - (bb[1] + bb[3]) / 2
        d.text((tx, ty), text, font=fp, fill=(255, 255, 255, 255))
    return out


def draw_title_poster(canvas, title, W, H):
    """
    同人サムネによくある構成。
      1行目 … 右端に縦書きの大見出し
      2行目 … 左下に横書きの一言（別の色）
    どちらも白フチ＋外側に濃いフチを付けて、背景の上でも読めるようにする。
    """
    lines = parse_title(title)
    main_style, main_parts = lines[0]
    # <...> で囲んだところは大きく・ピンクで目立たせる
    main_chars = [(ch, kind == "emph") for text, kind in main_parts for ch in text]
    sub_style, sub_parts = lines[1] if len(lines) > 1 else (None, [])
    sub_text = "".join(t for t, _ in sub_parts)

    out = canvas.convert("RGBA")
    text_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    stroke_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(stroke_layer)
    measure = ImageDraw.Draw(canvas)

    # ---- 縦書きの大見出し（右端）----
    EMPH = 1.7  # 強調文字の倍率
    n_plain = sum(1 for _, e in main_chars if not e)
    n_emph = sum(1 for _, e in main_chars if e)
    usable_h = H * 0.94
    size = int(min(H * 0.20, usable_h / max(1, (n_plain + n_emph * EMPH) * 1.02)))
    big = int(size * EMPH)
    f, fb = font(size), font(big)
    st = STYLES[main_style]
    # 一番大きい文字を基準に右端の位置を決める
    cx = int(W - big * 0.60 - max(4, big // 8))
    y = int((H - (n_plain * size + n_emph * big) * 1.02) / 2)
    for ch, emph in main_chars:
        fc = fb if emph else f
        sz = big if emph else size
        stroke = max(4, sz // 8)
        bb = measure.textbbox((0, 0), ch, font=fc)
        x = int(cx - (bb[0] + bb[2]) / 2)
        if emph:
            # 強調: ピンクのグラデーション＋白フチ
            sd.text((x, y), ch, font=fc, fill=(255, 255, 255, 255),
                    stroke_width=stroke, stroke_fill=(255, 255, 255, 255))
            text_layer = Image.alpha_composite(
                text_layer, gradient_text_layer(canvas.size, ch, fc, (x, y), PINK_TOP, PINK_BOTTOM))
        else:
            # ふつうの文字: 白抜き＋濃いフチ
            sd.text((x, y), ch, font=fc, fill=(255, 255, 255, 255),
                    stroke_width=stroke, stroke_fill=st["bottom"] + (255,))
            ImageDraw.Draw(text_layer).text((x, y), ch, font=fc, fill=(255, 255, 255, 255))
        y += int(sz * 1.02)

    # ---- サブタイトル（左端に縦書き・小さめ）----
    if sub_text:
        s2 = int(min(size * 0.72, H * 0.9 / max(1, len(sub_text)) / 1.02))
        f2 = font(s2)
        st2 = STYLES[sub_style or "blue"]
        stroke2 = max(3, s2 // 8)
        cx2 = int(W * 0.035 + s2 * 0.5)
        y2 = int(H * 0.06)
        for ch in sub_text:
            bb = measure.textbbox((0, 0), ch, font=f2)
            x2 = int(cx2 - (bb[0] + bb[2]) / 2)
            sd.text((x2, y2), ch, font=f2, fill=(255, 255, 255, 255),
                    stroke_width=stroke2, stroke_fill=(255, 255, 255, 255))
            text_layer = Image.alpha_composite(
                text_layer, gradient_text_layer(canvas.size, ch, f2, (x2, y2), st2["top"], st2["bottom"]))
            y2 += int(s2 * 1.02)

    # 白フチのさらに外側に濃い輪郭を置いて、明るい背景でも文字が埋もれないようにする
    edge = stroke_layer.getchannel("A").filter(ImageFilter.MaxFilter(5))
    outline = Image.new("RGBA", canvas.size, INK + (0,))
    outline.putalpha(edge.point(lambda v: int(v * 0.9)))
    out = Image.alpha_composite(out, outline)
    out = Image.alpha_composite(out, stroke_layer)
    out = Image.alpha_composite(out, text_layer)
    return out


def draw_badge(canvas, text, W, H, corner="tl"):
    """「総500P」のような帯びたバッジを角に置く。参考にした売れ筋の表紙で必ず入っている要素"""
    if not text:
        return canvas
    d = ImageDraw.Draw(canvas)
    size = int(H * 0.085)
    f = font(size)
    tw = d.textlength(text, font=f)
    pad = int(size * 0.32)
    bw, bh = int(tw + pad * 2), int(size * 1.45)
    m = int(W * 0.018)
    x = m if corner in ("tl", "bl") else W - bw - m
    y = m if corner in ("tl", "tr") else H - bh - m
    d.rectangle((x, y, x + bw, y + bh), fill=(18, 18, 22))
    d.rectangle((x, y, x + bw, y + bh), outline=(255, 255, 255), width=max(2, W // 400))
    d.text((x + pad, y + int(bh * 0.5 - size * 0.62)), text, font=f, fill=(255, 255, 255))
    return canvas


def detect_face(hero_rgba):
    """透過PNGのヒロインから一番大きいアニメ顔の枠 (x, y, w, h) を返す。見つからなければ None"""
    import os
    try:
        import cv2
    except ImportError:
        return None
    cascade_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lbpcascade_animeface.xml")
    if not os.path.exists(cascade_path):
        return None
    flat = Image.new("RGB", hero_rgba.size, (255, 255, 255))
    flat.paste(hero_rgba, (0, 0), hero_rgba)
    gray = cv2.equalizeHist(cv2.cvtColor(np.asarray(flat), cv2.COLOR_RGB2GRAY))
    cascade = cv2.CascadeClassifier(cascade_path)
    # 条件を少しずつ緩めて探す
    for scale_factor, neighbors in ((1.08, 4), (1.05, 3), (1.03, 2)):
        faces = cascade.detectMultiScale(gray, scaleFactor=scale_factor, minNeighbors=neighbors,
                                         minSize=(hero_rgba.width // 12, hero_rgba.width // 12))
        if len(faces):
            return max(faces, key=lambda f: f[2] * f[3])
    return None


def estimate_head(hero_rgba):
    """顔検出が外れたときの予備。切り抜きの上端付近（＝頭）の不透明部分から、顔のおおよその枠を出す"""
    a = np.asarray(hero_rgba.getchannel("A")) > 128
    rows = np.where(a.any(axis=1))[0]
    if len(rows) == 0:
        return None
    top = rows[0]
    band = a[top:top + int(hero_rgba.height * 0.20)]
    cols = np.where(band.any(axis=0))[0]
    if len(cols) == 0:
        return None
    # 髪の広がりに引っ張られないよう、両端1割を除いた範囲を頭とみなす
    left = int(np.percentile(cols, 10))
    right = int(np.percentile(cols, 90))
    return (left, top, right - left, int(hero_rgba.height * 0.20))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hero", required=True, help="透過PNGのヒロイン")
    ap.add_argument("--pages", nargs="*", default=[], help="背景に散らす本編ページ")
    ap.add_argument("--title", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="560x420")
    ap.add_argument("--scale", type=int, default=2, help="この倍率で描いてから縮小する（文字をきれいにするため）")
    ap.add_argument("--hero-x", type=float, default=0.58, help="ヒロインの中心の横位置（0〜1）")
    ap.add_argument("--hero-h", type=float, default=1.50, help="ヒロインの高さ（画面の高さに対する倍率）")
    ap.add_argument("--title-w", type=float, default=0.60, help="タイトルが使ってよい幅（画面幅に対する割合）")
    ap.add_argument("--avoid", choices=["auto", "right", "down"], default="auto",
                    help="顔がタイトルと被るときの逃がし方。auto は中央を保てるなら下に逃がす")
    ap.add_argument("--bg", choices=["pink", "dark"], default="pink", help="背景の色づかい")
    ap.add_argument("--hero2", default="", help="2人目の切り抜き（duo レイアウト用。同じ子の別ポーズ）")
    ap.add_argument("--badge", default="", help="角に置く帯（例: 総472P）")
    ap.add_argument("--badge-corner", choices=["tl", "tr", "bl", "br"], default="tl")
    ap.add_argument("--layout", choices=["left", "poster", "duo"], default="left",
                    help="left=左上に横書き / poster=右に縦書きの大見出し＋左下に一言")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()

    w0, h0 = [int(v) for v in args.size.lower().split("x")]
    W, H = w0 * args.scale, h0 * args.scale
    rng = random.Random(args.seed)

    canvas = draw_background(W, H, args.pages, rng, args.bg).convert("RGBA")

    # タイトルは透明な層に描き、その範囲（光彩を除いた濃い部分）を測る
    if args.layout == "poster":
        title_layer = draw_title_poster(Image.new("RGBA", (W, H), (0, 0, 0, 0)), args.title, W, H)
    else:
        title_layer = draw_title(Image.new("RGBA", (W, H), (0, 0, 0, 0)), args.title, W, H, args.title_w)
    solid = title_layer.getchannel("A").point(lambda v: 255 if v > 90 else 0)
    tb = solid.getbbox() or (0, 0, 0, 0)

    # duo: 同じ子の別ポーズを2体並べる。参考にした表紙で使われている見せ方
    if args.layout == "duo" and args.hero2:
        pair = []
        for f, cx in ((args.hero, 0.34), (args.hero2, 0.68)):
            im = Image.open(f).convert("RGBA")
            # 2体並べるときは頭まで入れる。見切れると顔で売れなくなる
            hh2 = int(H * 0.86)
            hw2 = int(hh2 * im.width / im.height)
            im = im.resize((hw2, hh2), Image.LANCZOS)
            pair.append((im, int(W * cx - hw2 / 2), H - hh2))
        for im, x, y in pair:
            sh = Image.new("RGBA", im.size, (60, 40, 70, 0))
            sh.putalpha(im.getchannel("A").filter(ImageFilter.GaussianBlur(W // 90)).point(lambda v: int(v * 0.35)))
            canvas.paste(sh, (x + W // 120, y + W // 120), sh)
            canvas.paste(im, (x, y), im)
        # タイトルが人物に埋もれないよう、左側に暗い帯を敷いてから文字を乗せる
        band = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(band).rectangle((0, 0, int(W * 0.30), H), fill=(20, 12, 24, 165))
        canvas = Image.alpha_composite(canvas, band)
        out = Image.alpha_composite(canvas, title_layer).convert("RGB")
        out = draw_badge(out, args.badge, W, H, args.badge_corner)
        out = out.resize((w0, h0), Image.LANCZOS)
        out.save(args.out, "JPEG", quality=94)
        print("cover(duo): {} ({}x{})".format(args.out, w0, h0))
        return

    hero = Image.open(args.hero).convert("RGBA")
    hh = int(H * args.hero_h)
    hw = int(hh * hero.width / hero.height)
    scale = hh / hero.height
    face = detect_face(hero)
    face_src = "検出"
    if face is None:
        face = estimate_head(hero)
        face_src = "推定"
    hero = hero.resize((hw, hh), Image.LANCZOS)
    hx = int(W * args.hero_x - hw / 2)
    hy = -int(H * 0.02)

    if face is not None:
        fx, fy, fw, fh = [int(v * scale) for v in face]
        margin = int(W * 0.02)
        face_top, face_bottom = hy + fy, hy + fy + fh
        # 顔がタイトルと被るなら逃がす。
        # 右に逃がすとヒロインが端に寄って弱くなるので、少しで済まないときは下に逃がして中央を保つ
        if face_top < tb[3] and face_bottom > tb[1]:
            need_right = tb[2] + margin - (hx + fx)
            need_down = tb[3] + margin - face_top
            if need_right > 0:
                if args.avoid == "down" or (args.avoid == "auto" and need_right > W * 0.04 and need_down <= H * 0.32):
                    hy += need_down
                else:
                    hx += need_right
        # 顔が画面の右端からはみ出さないようにする
        overflow = (hx + fx + fw) - (W - margin)
        if overflow > 0:
            hx -= overflow
        print("face: {}（顔の左端 {} / タイトルの右端 {}）".format(face_src, hx + fx, tb[2]))
    else:
        print("face: 検出も推定もできず。既定の位置に置きます")

    # 人物が左右に見切れないよう、中身（透明でない部分）が画面に収まる位置へ寄せる
    content = hero.getchannel("A").getbbox()
    if content:
        cl, ct, cr, cb = content
        if hx + cl < 0:
            hx = -cl
        if hx + cr > W:
            hx = W - cr

    # 人物の後ろに薄い影を落として背景から浮かせる
    shadow = Image.new("RGBA", hero.size, (60, 40, 70, 0))
    shadow.putalpha(hero.getchannel("A").filter(ImageFilter.GaussianBlur(W // 90)).point(lambda v: int(v * 0.35)))
    off = W // 120
    canvas.paste(shadow, (hx + off, hy + off), shadow)
    canvas.paste(hero, (hx, hy), hero)

    out = Image.alpha_composite(canvas, title_layer).convert("RGB")
    out = draw_badge(out, args.badge, W, H, args.badge_corner)
    out = out.resize((w0, h0), Image.LANCZOS)
    out.save(args.out, "JPEG", quality=94)
    print("cover: {} ({}x{})".format(args.out, w0, h0))


if __name__ == "__main__":
    main()
