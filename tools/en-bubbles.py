# -*- coding: utf-8 -*-
"""
英語版の吹き出しを付ける（横書き）。manga_bubble/add_bubbles.py は縦書き専用なので英語には使えない。
CSV の形式は add_bubbles.py と同じ:
  filename, day, text1, pos1, color1, text2, pos2, color2, text3, pos3, color3

  python tools/en-bubbles.py --input <画像フォルダ> --csv bubbles_en.csv --output <出力フォルダ>

- 見た目は日本語版に合わせる（半透明の角丸＋しっぽ、左上に日付ラベル "Day 12"）
- 顔検出（lbpcascade_animeface.xml）で顔に被る位置はずらす
"""
import argparse
import csv
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
CASCADE = os.path.join(HERE, "lbpcascade_animeface.xml")
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\comicbd.ttf",   # 漫画の吹き出しらしい丸い字形
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
]
ALPHA = 185
COLORS = {
    "blue": (80, 170, 255), "pink": (255, 150, 200), "white": (255, 255, 255),
    "purple": (185, 130, 255), "yellow": (255, 228, 90), "gray": (195, 195, 195),
}
# (中心x, 中心y, しっぽの向き) を画像比率で
POSITIONS = {
    "top-left": (0.22, 0.14, "down-right"), "top-center": (0.50, 0.10, "down"),
    "top-right": (0.76, 0.12, "down-left"), "center-left": (0.20, 0.50, "right"),
    "center": (0.50, 0.50, "down"), "center-right": (0.80, 0.50, "left"),
    "bottom-left": (0.24, 0.86, "up-right"), "bottom-center": (0.50, 0.90, "up"),
    "bottom-right": (0.76, 0.86, "up-left"),
}


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def faces_of(img):
    if not os.path.exists(CASCADE):
        return []
    gray = cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2GRAY)
    gray = cv2.equalizeHist(gray)
    det = cv2.CascadeClassifier(CASCADE)
    found = det.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(80, 80))
    return [(x, y, x + w, y + h) for (x, y, w, h) in found]


def overlap(a, b, m=0):
    return not (a[2] + m < b[0] or b[2] + m < a[0] or a[3] + m < b[1] or b[3] + m < a[1])


def wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= max_w or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_bubble(canvas, text, pos, color, font, taken, faces):
    W, H = canvas.size
    d = ImageDraw.Draw(canvas)
    lines = wrap(d, text, font, int(W * 0.36))
    lh = int(font.size * 1.22)
    tw = max(d.textlength(l, font=font) for l in lines)
    pad_x, pad_y = int(font.size * 0.8), int(font.size * 0.6)
    bw, bh = int(tw + pad_x * 2), int(lh * len(lines) + pad_y * 2)

    cx_r, cy_r, tail = POSITIONS.get(pos, POSITIONS["center"])
    cx, cy = int(cx_r * W), int(cy_r * H)

    def box_at(x, y):
        x1 = min(max(8, x - bw // 2), W - bw - 8)
        y1 = min(max(8, y - bh // 2), H - bh - 8)
        return (x1, y1, x1 + bw, y1 + bh)

    box = box_at(cx, cy)
    # 顔や他の吹き出しに被るなら、上下に少しずつずらして空きを探す
    for step in range(0, 12):
        for sign in (1, -1):
            cand = box_at(cx, cy + sign * step * int(H * 0.035))
            if not any(overlap(cand, f, 10) for f in faces) and not any(overlap(cand, t, 6) for t in taken):
                box = cand
                break
        else:
            continue
        break

    fill = (*COLORS.get(color, COLORS["white"]), ALPHA)
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    x1, y1, x2, y2 = box
    tl = max(26, H // 30)
    bx, by = (x1 + x2) // 2, (y1 + y2) // 2
    tip = {
        "down": (bx, y2 + tl), "up": (bx, y1 - tl), "right": (x2 + tl, by), "left": (x1 - tl, by),
        "down-right": (x2 - bw // 4, y2 + tl), "down-left": (x1 + bw // 4, y2 + tl),
        "up-right": (x2 - bw // 4, y1 - tl), "up-left": (x1 + bw // 4, y1 - tl),
    }[tail]
    base_w = max(14, bw // 10)
    if tail in ("left", "right"):
        bx0 = x2 - 4 if tail == "right" else x1 + 4
        ld.polygon([(bx0, by - base_w), (bx0, by + base_w), tip], fill=fill)
    else:
        bx0 = tip[0]
        edge = y2 - 4 if "down" in tail else y1 + 4
        ld.polygon([(bx0 - base_w, edge), (bx0 + base_w, edge), tip], fill=fill)
    ld.rounded_rectangle(box, radius=min(bw, bh) // 3, fill=fill)
    canvas.alpha_composite(layer)

    d = ImageDraw.Draw(canvas)
    ty = y1 + pad_y
    for l in lines:
        lw = d.textlength(l, font=font)
        d.text((x1 + (bw - lw) / 2, ty), l, font=font, fill="black", stroke_width=2, stroke_fill="white")
        ty += lh
    taken.append(box)


def draw_day(canvas, day, font, template="Day {n}"):
    d = ImageDraw.Draw(canvas)
    label = template.replace("{n}", str(day))
    tw = d.textlength(label, font=font)
    pad = int(font.size * 0.5)
    box = (12, 12, int(12 + tw + pad * 2), int(12 + font.size * 1.25 + pad))
    d.rounded_rectangle(box, radius=(box[3] - box[1]) // 3, fill="white", outline="black", width=3)
    d.text((box[0] + pad, box[1] + pad // 2), label, font=font, fill="black")
    return box


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--csv", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--day-label", default="Day {n}", help="左上ラベルの書式。{n} が回数に置き換わる")
    args = ap.parse_args()
    os.makedirs(args.output, exist_ok=True)

    with open(args.csv, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    done = 0
    for row in rows:
        src = os.path.join(args.input, row["filename"])
        if not os.path.exists(src):
            print("  skip (missing):", row["filename"])
            continue
        img = Image.open(src).convert("RGBA")
        W, _ = img.size
        font = load_font(max(22, int(W * 0.030)))
        faces = faces_of(img)
        taken = []
        if row.get("day"):
            taken.append(draw_day(img, row["day"], load_font(max(20, int(W * 0.036))), args.day_label))
        for i in (1, 2, 3):
            text = (row.get(f"text{i}") or "").strip()
            pos = (row.get(f"pos{i}") or "").strip()
            if text and pos:
                draw_bubble(img, text, pos, (row.get(f"color{i}") or "white").strip(), font, taken, faces)
        img.convert("RGB").save(os.path.join(args.output, row["filename"]), "JPEG", quality=90)
        done += 1
    print(f"en-bubbles: {done}/{len(rows)}")


if __name__ == "__main__":
    main()
