# -*- coding: utf-8 -*-
"""
Patreon用の英語サムネイル。
英語は縦書きできないので、画像の下部に帯を敷いて横書きでタイトルを置く。

  python tools/make-thumbnail-en.py --image "<画像>" --title "Overtime with My Senior" --out thumb_en.jpg
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\georgiab.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
]
SUB_FONT = [r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"]


def pick(paths):
    for p in paths:
        if os.path.exists(p):
            return p
    sys.exit("フォントが見つかりません")


def wrap(draw, text, font, max_w):
    """単語単位で折り返す"""
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--sub", default="Adult 18+  |  AI-generated illustrations")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    img = Image.open(args.image).convert("RGB")
    W, H = img.size
    d = ImageDraw.Draw(img, "RGBA")

    pad = int(W * 0.06)
    max_w = W - pad * 2

    # タイトルの文字サイズを、2行以内に収まるように決める
    size = int(W * 0.095)
    font_path = pick(FONT_CANDIDATES)
    while size > 24:
        f = ImageFont.truetype(font_path, size)
        lines = wrap(d, args.title, f, max_w)
        if len(lines) <= 2:
            break
        size -= 4
    f_title = ImageFont.truetype(font_path, size)
    f_sub = ImageFont.truetype(pick(SUB_FONT), max(18, int(size * 0.34)))

    line_h = int(size * 1.15)
    band_h = pad + line_h * len(lines) + int(size * 0.55) + pad
    top = H - band_h

    # 下部に半透明の白帯
    d.rectangle([0, top, W, H], fill=(255, 255, 255, 232))
    d.rectangle([0, top, W, top + 6], fill=(34, 32, 38, 255))

    y = top + pad
    for line in lines:
        tw = d.textlength(line, font=f_title)
        d.text(((W - tw) / 2, y), line, font=f_title, fill=(24, 22, 28))
        y += line_h

    sw = d.textlength(args.sub, font=f_sub)
    d.text(((W - sw) / 2, y + int(size * 0.12)), args.sub, font=f_sub, fill=(110, 104, 118))

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    img.save(args.out, "JPEG", quality=92)
    print("thumbnail_en: {} ({}x{}, {} lines, {}px)".format(args.out, W, H, len(lines), size))


if __name__ == "__main__":
    main()
