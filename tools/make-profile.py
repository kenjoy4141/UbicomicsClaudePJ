# -*- coding: utf-8 -*-
"""
登場ヒロインのプロフィールカードを作る。

  python tools/make-profile.py --image "<画像>" --name "高橋 莉奈" \
      --height 161 --weight 47 --bwh "B85・W55・H83" --birthday "1/1" --blood "A型" \
      --personality "明るくて天真爛漫。" --hook "（ここに一行）" --out profile.jpg

--image2 を渡すと右側にインセット画像も入る。
"""
import argparse
import os
import sys
import textwrap

from PIL import Image, ImageDraw, ImageFont

FONT_BOLD = r"C:\Windows\Fonts\BIZ-UDGothicB.ttc"
FONT_REG = r"C:\Windows\Fonts\BIZ-UDGothicR.ttc"

BG = (252, 246, 248)
PANEL = (255, 255, 255)
INK = (34, 32, 38)
ACCENT = (150, 120, 200)
GRID = (238, 224, 232)


def font(path, size):
    if not os.path.exists(path):
        path = r"C:\Windows\Fonts\meiryo.ttc"
    return ImageFont.truetype(path, size)


def fit_cover(img, box_w, box_h):
    """アスペクト比を保ったまま、指定サイズを覆うように切り抜く"""
    scale = max(box_w / img.width, box_h / img.height)
    w, h = int(img.width * scale), int(img.height * scale)
    img = img.resize((w, h), Image.LANCZOS)
    left = (w - box_w) // 2
    top = int((h - box_h) * 0.18)  # 顔が入りやすいよう少し上寄りで切る
    return img.crop((left, top, left + box_w, top + box_h))


def rounded(img, radius):
    from PIL import ImageDraw as D
    mask = Image.new("L", img.size, 0)
    D.Draw(mask).rounded_rectangle([0, 0, img.width, img.height], radius=radius, fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--image2", default=None)
    ap.add_argument("--name", required=True)
    ap.add_argument("--height", required=True)
    ap.add_argument("--weight", required=True)
    ap.add_argument("--bwh", required=True)
    ap.add_argument("--birthday", required=True)
    ap.add_argument("--blood", required=True)
    ap.add_argument("--labels", default="", help="JSON。英語版などでラベルを差し替える")
    ap.add_argument("--lang", default="ja")
    ap.add_argument("--age", default="")
    ap.add_argument("--job", default="")
    ap.add_argument("--hobby", default="")
    ap.add_argument("--food", default="")
    ap.add_argument("--type", dest="ftype", default="")
    ap.add_argument("--personality", default="")
    ap.add_argument("--hook", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=1200)
    ap.add_argument("--height-px", type=int, default=900)
    args = ap.parse_args()

    W, H = args.width, args.height_px
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)

    # --- 左のテキストパネル（先に敷く）---
    pad = 46
    panel_w = int(W * 0.50)
    d.rectangle([0, 0, panel_w, H], fill=PANEL)

    # 左上の格子模様（パネルの上に描く）
    for x in range(0, int(panel_w * 0.72), 26):
        d.line([(x, 0), (x, int(H * 0.12))], fill=GRID, width=3)
    for y in range(0, int(H * 0.12), 26):
        d.line([(0, y), (int(panel_w * 0.72), y)], fill=GRID, width=3)

    # --- 右側の構成 ---
    # サンプルに合わせて「帯状のメイン画像」＋「その右に細長いスマホ枠」にする。
    # スマホを大きくしすぎると背後の画像を潰してしまうので、実機に近い縦長比率に抑える。
    strip_w = int(W * 0.29)
    main = fit_cover(Image.open(args.image).convert("RGB"), strip_w, H)
    canvas.paste(main, (panel_w, 0))

    if args.image2 and os.path.exists(args.image2):
        pw = int(W * 0.24)          # 画面幅の約1/4。サンプルと同じくらいの細さ
        ph = int(H * 0.88)
        px = W - pw - int(W * 0.035)
        py = (H - ph) // 2

        sub = fit_cover(Image.open(args.image2).convert("RGB"), pw, ph)

        bezel = 12
        body = Image.new("RGB", (pw + bezel * 2, ph + bezel * 2), (26, 26, 30))
        body.paste(sub, (bezel, bezel))
        body = rounded(body, 34)

        # 影を先に落としてから本体を重ねる
        shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            [px - bezel + 8, py - bezel + 10, px + pw + bezel + 8, py + ph + bezel + 10],
            radius=34, fill=(90, 80, 100, 70))
        canvas.paste(Image.alpha_composite(canvas.convert("RGBA"), shadow).convert("RGB"), (0, 0))

        canvas.paste(body, (px - bezel, py - bezel), body)

        # ノッチ（サンプルのスマホにある上部の黒い帯）
        nw, nh = int(pw * 0.34), 16
        ImageDraw.Draw(canvas).rounded_rectangle(
            [px + (pw - nw) // 2, py + 4, px + (pw + nw) // 2, py + 4 + nh],
            radius=8, fill=(26, 26, 30))

    d = ImageDraw.Draw(canvas)

    if args.lang == "en":
        global FONT_BOLD, FONT_REG
        FONT_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
        FONT_REG = r"C:\Windows\Fonts\segoeui.ttf"
    f_name = font(FONT_BOLD, 62)
    f_key = font(FONT_BOLD, 30)
    f_val = font(FONT_REG, 30)
    f_body = font(FONT_REG, 27)

    y = pad
    d.text((pad, y), args.name, font=f_name, fill=INK)
    nb = d.textbbox((pad, y), args.name, font=f_name)
    d.rectangle([pad, nb[3] + 10, nb[2] + 40, nb[3] + 18], fill=ACCENT)
    y = nb[3] + 52

    import json
    L = {
        "age": "年齢", "job": "職業",
        "height": "身長", "weight": "体重", "bwh": "スリーサイズ", "birthday": "誕生日",
        "blood": "血液型", "hobby": "趣味", "food": "好きな食べ物", "type": "好きなタイプ",
    }
    if args.labels:
        L.update(json.loads(args.labels))

    # 年齢・職業は渡されたときだけ先頭に出す（FANZA作品では成人であることを明示する）
    rows = []
    if args.age:
        rows.append((L["age"], args.age))
    if args.job:
        rows.append((L["job"], args.job))
    rows += [
        (L["height"], f"{args.height}cm"),
        (L["weight"], f"{args.weight}kg"),
        (L["bwh"], args.bwh),
        (L["birthday"], args.birthday),
        (L["blood"], args.blood),
    ]
    # 余白が空きすぎるので、渡された項目で埋める
    if args.hobby:
        rows.append((L["hobby"], args.hobby))
    if args.food:
        rows.append((L["food"], args.food))
    if args.ftype:
        rows.append((L["type"], args.ftype))
    # 項目はすべて「ラベル：値」で揃える。
    # 値が長い場合は折り返し、続きは値の開始位置にぶら下げる。
    label_x = pad
    value_x = pad + max(int(d.textlength(k, font=f_key)) for k, _ in rows) + 40
    avail = panel_w - value_x - pad

    for k, v in rows:
        d.text((label_x, y), k, font=f_key, fill=INK)
        d.text((value_x - 30, y), ":" if args.lang == "en" else "：", font=f_val, fill=INK)

        if d.textlength(v, font=f_val) <= avail:
            d.text((value_x, y), v, font=f_val, fill=INK)
            y += 48
        else:
            # 入りきらない値は折り返す（英語は単語単位、日本語は文字単位）
            line = ""
            first = True
            units = [w + " " for w in v.split(" ")] if args.lang == "en" else list(v)
            for ch in units:
                if d.textlength(line + ch, font=f_val) > avail:
                    d.text((value_x, y), line, font=f_val, fill=INK)
                    y += 42
                    line = ch
                    first = False
                else:
                    line += ch
            if line:
                d.text((value_x, y), line, font=f_val, fill=INK)
                y += 48

    y += 18
    d.line([(pad, y), (panel_w - pad, y)], fill=GRID, width=3)
    y += 26

    body = [t for t in [args.personality, args.hook] if t]
    wrap_w = 34 if args.lang == "en" else 20
    for para in body:
        lines = textwrap.wrap(para, wrap_w, break_long_words=args.lang != "en")
        # 行頭に句読点や閉じ括弧が来ないよう、前の行へ寄せる（禁則処理）
        for i in range(1, len(lines)):
            while lines[i] and lines[i][0] in "。、，．！？）」』":
                lines[i - 1] += lines[i][0]
                lines[i] = lines[i][1:]
        for line in [l for l in lines if l]:
            # 下にはみ出す行は描かない
            if y + 40 > H - 16:
                break
            d.text((pad, y), line, font=f_body, fill=INK)
            y += 40
        y += 10
        if y > H - 60:
            break

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    canvas.save(args.out, "JPEG", quality=93)
    print("プロフィール: {} ({}x{})".format(args.out, W, H))


if __name__ == "__main__":
    main()
