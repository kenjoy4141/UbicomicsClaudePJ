# -*- coding: utf-8 -*-
"""
BOOTH用のサムネイルを作る。
生成画像の上に「白地・黒縁の枠 + 縦書きタイトル」を重ねる。

  python tools/make-thumbnail.py --image "<画像>" --title "女教師と温泉旅行" --out thumb.jpg

調整:
  --box-width 0.42   枠の幅（画像幅に対する比率）
  --box-top   0.38   枠の上端位置（画像高さに対する比率）
  --box-height 0.45  枠の高さ（画像高さに対する比率）
  --cols 2           縦書きの列数。0で自動
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\BIZ-UDGothicB.ttc",
    r"C:\Windows\Fonts\meiryob.ttc",
    r"C:\Windows\Fonts\YuGothB.ttc",
    r"C:\Windows\Fonts\msgothic.ttc",
]


def pick_font_path():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    sys.exit("日本語フォントが見つかりません")


def split_columns(title, cols):
    """縦書きの列に分ける。縦書きは右から読むので、返り値の先頭が右端の列。"""
    n = len(title)
    if cols <= 0:
        cols = 1 if n <= 6 else 2 if n <= 14 else 3
    per = -(-n // cols)  # 切り上げ
    return [title[i:i + per] for i in range(0, n, per)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--box-width", type=float, default=0.42)
    ap.add_argument("--box-top", type=float, default=0.36)
    ap.add_argument("--box-height", type=float, default=0.46)
    ap.add_argument("--cols", type=int, default=0)
    ap.add_argument("--quality", type=int, default=92)
    args = ap.parse_args()

    if not os.path.exists(args.image):
        sys.exit("画像がありません: " + args.image)

    img = Image.open(args.image)
    if img.mode != "RGB":
        img = img.convert("RGB")
    W, H = img.size

    columns = split_columns(args.title, args.cols)
    max_chars = max(len(c) for c in columns)

    # 枠のサイズと位置
    bw = int(W * args.box_width)
    bh = int(H * args.box_height)
    bx = (W - bw) // 2
    by = int(H * args.box_top)

    pad = int(min(bw, bh) * 0.08)
    inner_w = bw - pad * 2
    inner_h = bh - pad * 2

    # 文字サイズは「列数」と「1列の最大文字数」の両方に収まるよう決める
    size_by_h = inner_h // max_chars
    size_by_w = inner_w // len(columns)
    font_size = max(12, int(min(size_by_h, size_by_w) * 0.92))
    font = ImageFont.truetype(pick_font_path(), font_size)

    draw = ImageDraw.Draw(img)
    border = max(2, int(W * 0.004))
    draw.rectangle([bx, by, bx + bw, by + bh], fill=(255, 255, 255), outline=(0, 0, 0), width=border)

    col_w = inner_w / len(columns)
    line_h = font_size * 1.02

    for ci, col in enumerate(columns):
        # 縦書きは右の列から読むので、先頭の列を右端に置く
        cx = bx + pad + col_w * (len(columns) - 1 - ci) + col_w / 2
        total_h = line_h * len(col)
        cy = by + pad + (inner_h - total_h) / 2

        for chi, ch in enumerate(col):
            bbox = font.getbbox(ch)
            ch_w = bbox[2] - bbox[0]
            x = cx - ch_w / 2 - bbox[0]
            y = cy + line_h * chi - bbox[1] + (line_h - (bbox[3] - bbox[1])) / 2
            draw.text((x, y), ch, font=font, fill=(0, 0, 0))

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    img.save(args.out, "JPEG", quality=args.quality)
    print("サムネイル: {} ({}x{} / タイトル {}列 / 文字サイズ {}px)".format(
        args.out, W, H, len(columns), font_size))


if __name__ == "__main__":
    main()
