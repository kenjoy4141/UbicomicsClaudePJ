# -*- coding: utf-8 -*-
"""
単色背景で生成したヒロイン画像から背景を抜き、透過PNGにする。

背景色の判定は「色相」で行う。RGBの距離で判定すると、髪の毛先の色移り（黄緑）まで
背景と一緒に消えてしまうため。背景（ミントグリーン）と毛先（黄緑）は色相が大きく離れている。
外周から繋がっていない、髪と腕に囲まれた背景も同じ基準で消える。

  python tools/key-hero.py --in hero_1.png --out hero_1_cut.png
  python tools/key-hero.py --in ... --out ... --hue 20 --sat 0.18
"""
import argparse

import numpy as np
from PIL import Image, ImageFilter


def rgb_to_hsv(rgb):
    """rgb: float配列 0..1。h: 0..360, s: 0..1, v: 0..1"""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, axis=-1)
    mn = np.min(rgb, axis=-1)
    d = mx - mn
    h = np.zeros_like(mx)
    mask = d > 1e-6
    rm = mask & (mx == r)
    gm = mask & (mx == g) & ~rm
    bm = mask & ~rm & ~gm
    h[rm] = (60 * ((g[rm] - b[rm]) / d[rm]) + 360) % 360
    h[gm] = 60 * ((b[gm] - r[gm]) / d[gm]) + 120
    h[bm] = 60 * ((r[bm] - g[bm]) / d[bm]) + 240
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--hue", type=float, default=22, help="背景の色相からの許容幅（度）")
    ap.add_argument("--sat", type=float, default=0.16, help="背景とみなす彩度の上限の目安（実際は背景の彩度に合わせて下げる）")
    ap.add_argument("--halo", type=float, default=0.006, help="輪郭の色かぶりを抜く帯の幅（画像の短辺に対する割合）")
    ap.add_argument("--keep-islands", action="store_true", help="外周と繋がっていない背景色も消す（従来の動き）")
    ap.add_argument("--json", action="store_true", help="結果をJSONで出す（呼び出し側での判定用）")
    args = ap.parse_args()

    img = Image.open(args.src).convert("RGB")
    rgb = np.asarray(img).astype(np.float32) / 255.0
    h, s, v = rgb_to_hsv(rgb)

    # 背景の色相・彩度は四隅から推定
    def corners(a):
        return np.concatenate([a[:24, :24].ravel(), a[:24, -24:].ravel(), a[-24:, :24].ravel(), a[-24:, -24:].ravel()])
    bg_h = float(np.median(corners(h)))
    bg_s = float(np.median(corners(s)))
    bg_v = float(np.median(corners(v)))

    hue_dist = np.abs(((h - bg_h) + 180) % 360 - 180)
    # 背景の彩度が低い（薄い緑）ときは、しきい値もそれに合わせて下げる。
    # ただし白に近すぎる背景は色相で分けられないので、抜けない扱いにする
    sat_th = max(0.06, min(args.sat, bg_s * 0.55))
    keyable = bg_s >= 0.08
    # 背景より明らかに暗い画素（黒髪・紺のスカートなど）は、色味が近くても背景とみなさない
    is_bg = (hue_dist <= args.hue) & (s >= sat_th) & (v >= max(0.25, bg_v * 0.62)) if keyable else np.zeros_like(s, dtype=bool)

    # 服が背景と近い色（青背景＋ティールの制服など）だと、服まで背景と判定されて穴が開く。
    # 背景は必ず画面の外周と繋がっているので、外周から繋がっている領域だけを背景として残す。
    # （髪と腕に囲まれた閉じた背景は消えなくなるが、穴あきより実害が小さい）
    if not args.keep_islands and is_bg.any():
        h_px, w_px = is_bg.shape
        seen = np.zeros_like(is_bg, dtype=bool)
        stack = []
        for x in range(w_px):
            for y in (0, h_px - 1):
                if is_bg[y, x] and not seen[y, x]:
                    seen[y, x] = True
                    stack.append((y, x))
        for y in range(h_px):
            for x in (0, w_px - 1):
                if is_bg[y, x] and not seen[y, x]:
                    seen[y, x] = True
                    stack.append((y, x))
        # 4近傍で外周から塗り広げる
        while stack:
            y, x = stack.pop()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h_px and 0 <= nx < w_px and is_bg[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        # 外周と繋がっていない「島」は、髪や腕に囲まれた背景のこともあれば、背景と似た色の服のこともある。
        # 島ごとに色を見て、背景そのものの色（色相も彩度も明るさも近い）なら抜き、そうでなければ服として残す
        inside = is_bg & ~seen
        kept = np.zeros_like(inside)
        if inside.any():
            from collections import deque
            todo = np.transpose(np.nonzero(inside))
            visited = np.zeros_like(inside)
            removed_px = kept_px = 0
            for sy, sx in todo:
                if visited[sy, sx]:
                    continue
                q = deque([(sy, sx)])
                visited[sy, sx] = True
                cells = []
                while q:
                    y, x = q.popleft()
                    cells.append((y, x))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h_px and 0 <= nx < w_px and inside[ny, nx] and not visited[ny, nx]:
                            visited[ny, nx] = True
                            q.append((ny, nx))
                ys = np.array([c[0] for c in cells])
                xs = np.array([c[1] for c in cells])
                same_hue = float(np.median(hue_dist[ys, xs])) <= args.hue * 0.5
                same_sat = abs(float(np.median(s[ys, xs])) - bg_s) <= 0.18
                same_val = abs(float(np.median(v[ys, xs])) - bg_v) <= 0.18
                if same_hue and same_sat and same_val:
                    seen[ys, xs] = True          # 背景そのもの。抜く
                    removed_px += len(cells)
                else:
                    kept[ys, xs] = True          # 服や小物。残す
                    kept_px += len(cells)
            total = inside.size
            print("  囲まれた背景 {:.1f}% は抜き、服や小物 {:.1f}% は残しました".format(
                100.0 * removed_px / total, 100.0 * kept_px / total))

        # 輪郭に残る色かぶり（髪の毛先に乗った水色など）を抜く。
        # ここでの判定はゆるいので、背景の縁から数ピクセルの帯だけに限る。
        # 帯を限らないと、肩から服の中へ流れ込んで制服ごと消えてしまう
        band_px = max(3, int(min(h_px, w_px) * args.halo))
        seen_img = Image.fromarray((seen * 255).astype(np.uint8), "L")
        grown = np.asarray(seen_img.filter(ImageFilter.MaxFilter(band_px * 2 + 1))) > 127
        loose = (hue_dist <= args.hue * 2.0) & (s >= sat_th * 0.45) & (v >= max(0.18, bg_v * 0.4))
        halo = seen | (grown & loose)
        added = halo & ~seen
        if added.any():
            print("  輪郭の色かぶり {:.1f}%（帯 {}px）も抜きました".format(100.0 * added.mean(), band_px))
        is_bg = halo

    alpha = Image.fromarray(np.where(is_bg, 0, 255).astype(np.uint8), "L")
    # 小さな穴や点を消してから、縁を1px削って柔らかくする
    alpha = alpha.filter(ImageFilter.MedianFilter(5))
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.1))

    # 縁の色かぶりを抑える（背景が緑なら緑、青なら青を、他の2色の大きい方までに抑える）
    a = np.asarray(alpha).astype(np.float32) / 255.0
    edge = (a > 0.02) & (a < 0.98)
    out_rgb = rgb.copy()
    ch = 1 if 90 <= bg_h < 180 else (2 if 180 <= bg_h < 270 else 0)
    others = [c for c in (0, 1, 2) if c != ch]
    limit = np.maximum(out_rgb[..., others[0]], out_rgb[..., others[1]])
    out_rgb[..., ch] = np.where(edge & (out_rgb[..., ch] > limit), limit, out_rgb[..., ch])

    out = Image.fromarray((np.clip(out_rgb, 0, 1) * 255).astype(np.uint8), "RGB")
    out.putalpha(alpha)
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    out.save(args.out)
    area = 100.0 * (1 - is_bg.mean())
    if args.json:
        import json
        print(json.dumps({"out": args.out, "area": round(area, 1), "bg_hue": round(bg_h), "bg_sat": round(bg_s, 3), "keyable": bool(keyable)}))
    else:
        print("cutout: {} ({}x{}, 人物の面積 {:.0f}%, 背景の色相 {:.0f}度, 彩度 {:.2f})".format(
            args.out, out.width, out.height, area, bg_h, bg_s))


if __name__ == "__main__":
    main()
