# -*- coding: utf-8 -*-
"""
X（Twitter）用のサンプル画像を作る。性的な部分を白く塗りつぶして、煽りの見出しを載せる。

  python tools/x-sample.py --work "030_B_裏喫茶で..." --pages 120,180,240,300 --headline "続きが気になる人はリプ欄へ"
  python tools/x-sample.py --work "..." --auto 4

隠す場所は「モザイク前」と「モザイク後」の差分から求める。
モザイクツールが処理した領域＝性器まわりなので、そこを白で塗れば確実に隠れる。
"""
import argparse
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

FONT_PATH = r"C:\Windows\Fonts\NotoSansJP-VF.ttf"
WHITE = (255, 255, 255)


def font(size, weight="Black"):
    f = ImageFont.truetype(FONT_PATH, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def png_list(d):
    return sorted(f for f in os.listdir(d) if f.lower().endswith(".png")) if os.path.isdir(d) else []


def detect_face(img):
    """アニメ絵の顔を1つ見つける。見つからなければ None"""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None
    cascade_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lbpcascade_animeface.xml")
    if not os.path.exists(cascade_path):
        return None
    gray = cv2.equalizeHist(cv2.cvtColor(np.asarray(img.convert("RGB")), cv2.COLOR_RGB2GRAY))
    cascade = cv2.CascadeClassifier(cascade_path)
    for scale, neighbors in ((1.05, 4), (1.02, 3), (1.01, 2)):
        faces = cascade.detectMultiScale(gray, scaleFactor=scale, minNeighbors=neighbors,
                                         minSize=(int(img.width * 0.05), int(img.height * 0.05)))
        if len(faces):
            return max(faces, key=lambda f: f[2] * f[3])
    return None


def chest_box(img):
    """顔の位置から胸のあたりを推定する。顔の下 1.1〜2.6 個分、横は顔幅の 2.6 倍"""
    f = detect_face(img)
    if f is None:
        return None
    fx, fy, fw, fh = [int(v) for v in f]
    cx = fx + fw // 2
    top = fy + fh + int(fh * 0.5)
    bottom = fy + fh + int(fh * 2.0)
    half = int(fw * 1.35)
    w, h = img.size
    return (max(0, cx - half), max(0, top), min(w, cx + half), min(h, bottom))


def bubble_boxes(img, min_ratio=0.004, max_ratio=0.16):
    """吹き出し（白い塊に黒い文字）のある場所を探す"""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return []
    a = np.asarray(img.convert("RGB"))
    white = ((a[:, :, 0] > 235) & (a[:, :, 1] > 235) & (a[:, :, 2] > 235)).astype("uint8") * 255
    white = cv2.morphologyEx(white, cv2.MORPH_CLOSE, np.ones((9, 9), "uint8"))
    n, _, stats, _ = cv2.connectedComponentsWithStats(white, 8)
    area_all = img.width * img.height
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if not (area_all * min_ratio <= area <= area_all * max_ratio):
            continue
        if w < img.width * 0.06 or h < img.height * 0.03:
            continue
        if w / max(1, h) > 6 or h / max(1, w) > 6:      # 細長いのは背景の光など
            continue
        # 中に黒い文字が入っていなければ吹き出しじゃない（窓・ブラインドよけ）
        crop = a[y:y + h, x:x + w]
        dark = (crop.max(axis=2) < 90).mean()
        if not (0.02 <= dark <= 0.30):
            continue
        out.append((int(x), int(y), int(x + w), int(y + h)))
    return out


def face_only(img, pad=0.45, keep_bubbles=True):
    """顔と吹き出しだけ残して、あとは白で塗りつぶす"""
    keep = []
    f = detect_face(img)
    if f is not None:
        fx, fy, fw, fh = [int(v) for v in f]
        px, py = int(fw * pad), int(fh * pad)
        keep.append((max(0, fx - px), max(0, fy - py),
                     min(img.width, fx + fw + px), min(img.height, fy + fh + py)))
    if keep_bubbles:
        keep += bubble_boxes(img)
    if not keep:
        return None
    out = Image.new("RGB", img.size, WHITE)
    for b in keep:
        out.paste(img.crop(b), (b[0], b[1]))
    # 白い余白だらけにならないよう、残したところに寄せて切り抜く
    x0 = min(b[0] for b in keep); y0 = min(b[1] for b in keep)
    x1 = max(b[2] for b in keep); y1 = max(b[3] for b in keep)
    m = int(min(img.width, img.height) * 0.06)
    box = (max(0, x0 - m), max(0, y0 - m), min(img.width, x1 + m), min(img.height, y1 + m))
    return out.crop(box)


def masked_boxes(raw_path, moza_path, pad_ratio=0.02):
    """モザイク前後の差分から、隠すべき四角を求める"""
    a = Image.open(raw_path).convert("RGB")
    b = Image.open(moza_path).convert("RGB")
    if a.size != b.size:
        b = b.resize(a.size)
    diff = ImageChops.difference(a, b).convert("L")
    # 細かいノイズを落としてから、差があるところだけ残す
    diff = diff.filter(ImageFilter.MedianFilter(5))
    mask = diff.point(lambda v: 255 if v > 18 else 0)
    box = mask.getbbox()
    if box is None:
        return []
    # 少し広めに取る（輪郭が残ると隠した意味が薄れる）
    w, h = a.size
    pad = int(min(w, h) * pad_ratio)
    x0, y0, x1, y1 = box
    return [(max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad))]


def draw_headline(img, text, sub=None):
    """下に白帯を足して見出しを書く"""
    if not text:
        return img
    w, h = img.size
    pad = int(w * 0.04)
    size = int(w * 0.062)
    f = font(size)
    fs = font(int(size * 0.62), "Medium")
    d = ImageDraw.Draw(img)
    lines = [text[i:i + 16] for i in range(0, len(text), 16)] or [text]
    band = pad * 2 + int(size * 1.25) * len(lines) + (int(size * 0.9) if sub else 0)

    out = Image.new("RGB", (w, h + band), WHITE)
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    y = h + pad
    for ln in lines:
        d.text((pad, y), ln, font=f, fill=(24, 24, 28))
        y += int(size * 1.25)
    if sub:
        d.text((pad, y), sub, font=fs, fill=(228, 60, 120))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="モザイク前のフォルダ（raw_FNNN_作品名）")
    ap.add_argument("--moza", required=True, help="モザイク後のフォルダ（同名＋moza）")
    ap.add_argument("--out", required=True, help="書き出し先フォルダ")
    ap.add_argument("--pages", default="", help="1始まりのページ番号をカンマ区切りで")
    ap.add_argument("--auto", type=int, default=0, help="隠す場所がある絵から自動で N 枚選ぶ")
    ap.add_argument("--headline", default="", help="1枚目に載せる見出し")
    ap.add_argument("--chest", action="store_true", default=True, help="胸も白で隠す（既定）")
    ap.add_argument("--no-chest", dest="chest", action="store_false", help="胸は隠さない")
    ap.add_argument("--band", action="store_true", help="点ではなく、横一本の帯で隠す")
    ap.add_argument("--mode", default="mosaic", choices=["mosaic", "face"],
                    help="mosaic=性的なところだけ白で隠す / face=顔とセリフ以外を全部白で隠す")
    ap.add_argument("--sub", default="続きはリプ欄のリンクから", help="見出しの下の小さい行")
    ap.add_argument("--width", type=int, default=1080, help="書き出しの横幅")
    args = ap.parse_args()

    raws, mozas = png_list(args.raw), png_list(args.moza)
    if len(raws) != len(mozas):
        print(f"! 枚数が違います: モザイク前 {len(raws)} / 後 {len(mozas)}", file=sys.stderr)
        sys.exit(1)
    if not raws:
        print("! 画像がありません", file=sys.stderr)
        sys.exit(1)

    if args.pages:
        idx = [int(p) - 1 for p in args.pages.split(",") if p.strip()]
    else:
        n = args.auto or 4
        # 後半（性的なパート）から等間隔に候補を出し、隠す場所がある絵だけ採る
        start = int(len(raws) * 0.25)
        cand = [start + int((len(raws) - start - 1) * i / max(1, n * 4 - 1)) for i in range(n * 4)]
        idx = []
        for i in cand:
            if len(idx) >= n:
                break
            if masked_boxes(os.path.join(args.raw, raws[i]), os.path.join(args.moza, mozas[i])):
                idx.append(i)
        if len(idx) < n:
            print(f"! 隠す場所のある絵が {len(idx)}枚しか見つかりませんでした", file=sys.stderr)

    os.makedirs(args.out, exist_ok=True)
    made = []
    for k, i in enumerate(idx):
        moza = os.path.join(args.moza, mozas[i])
        boxes = masked_boxes(os.path.join(args.raw, raws[i]), moza)
        img = Image.open(moza).convert("RGB")
        if args.mode == "face":
            shown = face_only(img)
            if shown is None:
                print(f"  {i + 1}ページ: 顔も吹き出しも見つからず飛ばします")
                continue
            img = shown
            boxes = []
        if args.mode == "mosaic" and args.chest:
            cb = chest_box(img)
            if cb:
                boxes = boxes + [cb]
        if args.band:
            # 幅いっぱいの帯にすると「意図的に隠してる感」が出て踏まれやすい
            boxes = [(0, b[1], img.width, b[3]) for b in boxes]
        d = ImageDraw.Draw(img)
        for b in boxes:
            d.rectangle(b, fill=WHITE)
            # 白塗りの上に「？」を置くと、隠してる感が出て踏まれやすい
            bw, bh = b[2] - b[0], b[3] - b[1]
            f = font(int(min(bw, bh) * 0.6))
            tw = d.textlength("?", font=f)
            d.text((b[0] + (bw - tw) / 2, b[1] + bh * 0.12), "?", font=f, fill=(210, 210, 216))
        if args.mode == "mosaic" and not boxes:
            print(f"  {i + 1}ページ: 隠す場所なし（そのまま使います）")
        if k == 0 and args.headline:
            img = draw_headline(img, args.headline, args.sub)
        if img.width != args.width:
            img = img.resize((args.width, int(img.height * args.width / img.width)), Image.LANCZOS)
        dst = os.path.join(args.out, f"x_{k + 1}.jpg")
        img.save(dst, "JPEG", quality=92, optimize=True)
        made.append(dst)
        print(f"  {i + 1}ページ → {os.path.basename(dst)}  隠した箇所 {len(boxes)}")
    print(f"{len(made)}枚 → {args.out}")


if __name__ == "__main__":
    main()
