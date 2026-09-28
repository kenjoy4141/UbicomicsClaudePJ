# -*- coding: utf-8 -*-
"""
BOOTH用のPDFを作る。

  連番リネーム -> JPG変換 -> 1つのPDFに結合

使い方:
  python tools/make-booth-pdf.py --input "<モザイク済みフォルダ>" --title "女教師と温泉旅行"
  python tools/make-booth-pdf.py --input "..." --title "..." --outdir "..." --quality 88

出力:
  <outdir>/<title>.pdf         … BOOTHにアップするPDF
  <outdir>/jpg/0001.jpg ...    … 連番リネーム済みのJPG（中身確認・差し替え用に残す）
"""
import argparse
import os
import sys

from PIL import Image

EXTS = (".png", ".jpg", ".jpeg", ".webp")


def collect(input_dir):
    names = [n for n in os.listdir(input_dir) if n.lower().endswith(EXTS)]
    names.sort()
    return [os.path.join(input_dir, n) for n in names]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="モザイク済み画像のフォルダ")
    ap.add_argument("--title", required=True, help="作品タイトル（PDFのファイル名になる）")
    ap.add_argument("--outdir", default=None, help="出力先。既定は入力フォルダの隣に <title> フォルダを作る")
    ap.add_argument("--quality", type=int, default=88, help="JPEG品質 (既定 88)")
    ap.add_argument("--max-width", type=int, default=0, help="この幅を超える画像を縮小する。0で無効")
    args = ap.parse_args()

    if not os.path.isdir(args.input):
        sys.exit("入力フォルダがありません: " + args.input)

    files = collect(args.input)
    if not files:
        sys.exit("画像がありません: " + args.input)

    outdir = args.outdir or os.path.join(os.path.dirname(args.input.rstrip("/\\")), args.title)
    jpgdir = os.path.join(outdir, "jpg")
    os.makedirs(jpgdir, exist_ok=True)

    print("入力: {} ({}枚)".format(args.input, len(files)))
    print("出力: {}".format(outdir))

    pages = []
    for i, src in enumerate(files, start=1):
        img = Image.open(src)
        if img.mode != "RGB":
            img = img.convert("RGB")
        if args.max_width and img.width > args.max_width:
            h = int(img.height * args.max_width / img.width)
            img = img.resize((args.max_width, h), Image.LANCZOS)

        dst = os.path.join(jpgdir, "{:04d}.jpg".format(i))
        img.save(dst, "JPEG", quality=args.quality, optimize=True)
        pages.append(dst)

        if i % 20 == 0 or i == len(files):
            print("  変換 {}/{}".format(i, len(files)))

    pdf_path = os.path.join(outdir, args.title + ".pdf")
    first = Image.open(pages[0])
    rest = [Image.open(p) for p in pages[1:]]
    first.save(pdf_path, "PDF", save_all=True, append_images=rest, resolution=150.0)

    size_mb = os.path.getsize(pdf_path) / 1048576.0
    print("")
    print("PDF: {} ({:.1f}MB / {}ページ)".format(pdf_path, size_mb, len(pages)))
    if size_mb > 100:
        print("! 100MBを超えています。--quality を下げるか --max-width で縮小してください。")


if __name__ == "__main__":
    main()
