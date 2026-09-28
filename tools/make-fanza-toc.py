# -*- coding: utf-8 -*-
"""
FANZA作品の目次画像を作る。黒背景に「目次」と「pNN〜・・・パート名」の一覧、
本編から選んだページを傾けた写真風に散らす。

  python tools/make-fanza-toc.py --spec toc.json --out 目次.jpg

spec(JSON):
  { "lines": [["1", "日常パート"], ["89", "診察室でえろえろ"], ...],
    "photos": ["C:/.../01_本編/120.jpg", ...] }
"""
import argparse
import json
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_BOLD = r"C:\Windows\Fonts\BIZ-UDGothicB.ttc"
BG = (18, 18, 20)
INK = (255, 255, 255)


def font(size):
    path = FONT_BOLD if os.path.exists(FONT_BOLD) else r"C:\Windows\Fonts\meiryo.ttc"
    return ImageFont.truetype(path, size)


def photo(path, w, h, border, angle):
    """白フチ付きの写真にして傾ける。影付きのRGBAを返す"""
    img = Image.open(path).convert("RGB")
    scale = max(w / img.width, h / img.height)
    img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    left = (img.width - w) // 2
    top = int((img.height - h) * 0.15)  # 顔が入りやすいよう上寄りで切る
    img = img.crop((left, top, left + w, top + h))

    card = Image.new("RGBA", (w + border * 2, h + border * 2), (250, 250, 250, 255))
    card.paste(img, (border, border))

    pad = 24
    base = Image.new("RGBA", (card.width + pad * 2, card.height + pad * 2), (0, 0, 0, 0))
    shadow = Image.new("RGBA", card.size, (0, 0, 0, 150))
    base.paste(shadow, (pad + 6, pad + 8), shadow)
    base = base.filter(ImageFilter.GaussianBlur(8))
    base.paste(card, (pad, pad), card)
    return base.rotate(angle, resample=Image.BICUBIC, expand=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=1200)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    with open(args.spec, encoding="utf-8") as f:
        spec = json.load(f)
    rnd = random.Random(args.seed)
    W, H = args.width, args.height
    canvas = Image.new("RGBA", (W, H), BG + (255,))

    # --- 写真（文字の後ろに回らないよう、先に置いて文字を上に描く）---
    # 右側に縦3枚、下に横並び。文字の領域（左上）は避ける
    photos = spec.get("photos", [])
    pw, ph, border = int(W * 0.15), int(W * 0.15 * 1.4), 8
    slots = [
        (0.66, 0.02), (0.83, 0.22), (0.66, 0.44),
        (0.02, 0.60), (0.20, 0.64), (0.38, 0.58), (0.54, 0.66), (0.83, 0.62),
    ]
    for i, p in enumerate(photos[:len(slots)]):
        if not os.path.exists(p):
            continue
        card = photo(p, pw, ph, border, rnd.uniform(-9, 9))
        sx, sy = slots[i]
        x = int(sx * W + rnd.uniform(-10, 10))
        y = int(sy * H + rnd.uniform(-8, 8))
        canvas.alpha_composite(card, (max(-20, min(W - card.width + 20, x)), max(-20, min(H - card.height + 20, y))))

    # --- 文字 ---
    lines = spec["lines"]
    f_title = font(int(H * 0.11))
    size = int(H * 0.052)
    if len(lines) > 7:
        size = int(size * 7 / len(lines) * 1.08)
    f_line = font(size)

    # 文字の背面だけ少し暗くして、写真と重なっても読めるようにする
    texts = [(f"p{p}〜・・・{name}") for p, name in lines]
    text_w = max(ImageDraw.Draw(canvas).textlength(t, font=f_line) for t in texts)
    step = int(size * 1.32)
    text_bottom = int(H * 0.16) + (len(lines) - 1) * step + size
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shade).rounded_rectangle(
        [10, 10, int(text_w + 70), text_bottom + 16],
        radius=18, fill=BG + (215,))
    canvas.alpha_composite(shade)

    d = ImageDraw.Draw(canvas)
    d.text((34, 20), "目次", font=f_title, fill=INK)
    y = int(H * 0.16)
    # 「p」の位置を揃えず、数字の桁で右揃えにする（サンプルと同じ見た目）
    num_w = max(d.textlength(f"p{p}", font=f_line) for p, _ in lines)
    for (p, name), t in zip(lines, texts):
        head = f"p{p}"
        x = 40 + (num_w - d.textlength(head, font=f_line))
        d.text((x, y), t, font=f_line, fill=INK)
        y += step

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    canvas.convert("RGB").save(args.out, "JPEG", quality=93)
    print("目次: {} ({}x{})".format(args.out, W, H))


if __name__ == "__main__":
    main()
