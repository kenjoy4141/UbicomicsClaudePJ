# -*- coding: utf-8 -*-
"""
生成済みの絵を並べて、コマ割りのページを作る。

  python tools/make-panel-page.py --images a.jpg,b.jpg,c.jpg --layout 1+2 --out page.jpg

レイアウト（まずは単純なものだけ）
  1+2   … 上に大ゴマ1、下に小ゴマ2
  2     … 上下に2分割
  3     … 横に3段
  2+1   … 上に小ゴマ2、下に大ゴマ1

絵は各コマの縦横比に合わせて中央から切り出す（顔が入るよう上寄りに切る）。
"""
import argparse
import os
from PIL import Image, ImageDraw

LAYOUTS = {
    # (x, y, w, h) を0〜1の割合で持つ
    "1+2": [(0, 0, 1, 0.56), (0, 0.56, 0.5, 0.44), (0.5, 0.56, 0.5, 0.44)],
    "2+1": [(0, 0, 0.5, 0.44), (0.5, 0, 0.5, 0.44), (0, 0.44, 1, 0.56)],
    "2": [(0, 0, 1, 0.5), (0, 0.5, 1, 0.5)],
    "3": [(0, 0, 1, 1 / 3), (0, 1 / 3, 1, 1 / 3), (0, 2 / 3, 1, 1 / 3)],
}


def fit(img, w, h, focus=0.38):
    """コマの縦横比に合わせて切り出す。focus は縦方向のどこを中心にするか（0=上）"""
    tw, th = w / h, img.width / img.height
    if th > tw:                      # 横に長い → 左右を切る
        nw = int(img.height * tw)
        x = (img.width - nw) // 2
        img = img.crop((x, 0, x + nw, img.height))
    else:                            # 縦に長い → 上下を切る（顔を残すため上寄り）
        nh = int(img.width / tw)
        y = int((img.height - nh) * focus)
        img = img.crop((0, y, img.width, y + nh))
    return img.resize((w, h), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True, help="コマに入れる画像をカンマ区切りで")
    ap.add_argument("--layout", default="1+2", choices=list(LAYOUTS))
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--height", type=int, default=1536)
    ap.add_argument("--gutter", type=int, default=14, help="コマの間隔")
    ap.add_argument("--margin", type=int, default=26, help="ページの余白")
    ap.add_argument("--border", type=int, default=5, help="枠線の太さ")
    ap.add_argument("--focus", default="", help="コマごとの切り出し位置（0〜1）をカンマ区切りで")
    args = ap.parse_args()

    cells = LAYOUTS[args.layout]
    files = [f.strip() for f in args.images.split(",") if f.strip()]
    if len(files) < len(cells):
        raise SystemExit(f"! {args.layout} は画像が {len(cells)}枚必要です（渡されたのは {len(files)}枚）")
    focus = [float(x) for x in args.focus.split(",")] if args.focus else [0.38] * len(cells)

    page = Image.new("RGB", (args.width, args.height), (255, 255, 255))
    d = ImageDraw.Draw(page)
    iw = args.width - args.margin * 2
    ih = args.height - args.margin * 2
    g = args.gutter // 2

    for i, (cx, cy, cw, ch) in enumerate(cells):
        x0 = args.margin + int(iw * cx) + (g if cx > 0 else 0)
        y0 = args.margin + int(ih * cy) + (g if cy > 0 else 0)
        x1 = args.margin + int(iw * (cx + cw)) - (g if cx + cw < 1 else 0)
        y1 = args.margin + int(ih * (cy + ch)) - (g if cy + ch < 1 else 0)
        im = Image.open(files[i]).convert("RGB")
        page.paste(fit(im, x1 - x0, y1 - y0, focus[i] if i < len(focus) else 0.38), (x0, y0))
        if args.border:
            d.rectangle((x0, y0, x1 - 1, y1 - 1), outline=(20, 20, 24), width=args.border)

    page.save(args.out, "JPEG", quality=92, optimize=True)
    print(f"{args.layout}: {len(cells)}コマ → {args.out}")


if __name__ == "__main__":
    main()
