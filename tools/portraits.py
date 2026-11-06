r"""Crops HUD portraits from the T-pose concept art (read-only source: ..\ASSETS T-POSE).

Finds the eyes (the two big black pupils either side of the figure's centre line) and takes a
square around the face, so tall hats, plumes and crowns no longer push the face out of frame.
Writes public/assets/ui/portraits/<faction>_<piece>.webp (256x256) and a contact sheet.
"""
import itertools
import os
import cv2
import numpy as np

SRC = '../ASSETS T-POSE/'
OUT = 'public/assets/ui/portraits/'
PIECES = ['king', 'queen', 'bishop', 'knight', 'rook', 'pawn']
# Crop size in eye spacings, and how far below the eyes the crop centre sits (fraction of size).
FRAME = {'king': (4.1, 0.03), 'queen': (3.6, 0.07), 'bishop': (5.0, 0.1), 'knight': (3.9, 0.05), 'rook': (3.5, 0.04), 'pawn': (3.5, 0.05)}
# Pupils the detector cannot separate from dark costume parts: (eye centre x, y, spacing).
EYES = {'dark_bishop': (627, 452, 82), 'dark_rook': (627, 577, 150)}


def figure(img):
    bg = np.median(np.concatenate([img[:20, :20].reshape(-1, 3), img[:20, -20:].reshape(-1, 3)]), axis=0)
    mask = (np.linalg.norm(img.astype(np.float32) - bg, axis=2) > 40).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    ys, xs = np.nonzero(mask)
    top, bottom = ys.min(), ys.max()
    upper = ys < top + (bottom - top) * 0.3  # arms make the full bbox unreliable
    return top, bottom, int(np.median(xs[upper]))


def find_eyes(img):
    """Midpoint and spacing of the pupils: a pair of round, near-black blobs of similar size,
    level with each other and either side of the figure's centre."""
    w = img.shape[1]
    top, bottom, cx = figure(img)
    for thr in (30, 45, 60):
        dark = (img.max(axis=2) < thr).astype(np.uint8)
        n, _, stats, cent = cv2.connectedComponentsWithStats(dark)
        lim = top + (bottom - top) * 0.6
        blobs = [(stats[i], cent[i]) for i in range(1, n) if 400 < stats[i][4] < 20000 and top < cent[i][1] < lim]
        best = None
        for (a, ca), (b, cb) in itertools.combinations(blobs, 2):
            d = abs(ca[0] - cb[0])
            if abs(ca[1] - cb[1]) > 25 or not (0.6 < a[4] / b[4] < 1.6): continue
            if not all(0.55 < s[2] / s[3] < 1.6 for s in (a, b)): continue
            if not (max(a[2], b[2]) < d < max(a[2], b[2]) * 3.2) or abs((ca[0] + cb[0]) / 2 - cx) > w * 0.08: continue
            if best is None or a[4] + b[4] > best[0]:
                best = (a[4] + b[4], (ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, d)
        if best:
            return best[1:]
    return None


os.makedirs(OUT, exist_ok=True)
tiles = []
for faction in ['LIGHT', 'DARK']:
    for piece in PIECES:
        img = cv2.imread(f'{SRC}{faction} - {piece.upper()}.png')
        h, w = img.shape[:2]
        name = f'{faction.lower()}_{piece}'
        ex, ey, d = EYES.get(name) or find_eyes(img)
        k, dy = FRAME[piece]
        size = int(d * k)
        x0 = max(0, min(w - size, int(ex - size / 2)))
        y0 = max(0, min(h - size, int(ey + dy * size - size / 2)))
        crop = cv2.resize(img[y0:y0 + size, x0:x0 + size], (256, 256), interpolation=cv2.INTER_AREA)
        cv2.imwrite(f'{OUT}{name}.webp', crop, [cv2.IMWRITE_WEBP_QUALITY, 90])
        tiles.append(crop)

rows = [np.hstack(tiles[i:i + 6]) for i in (0, 6)]
os.makedirs('tools/work', exist_ok=True)
cv2.imwrite('tools/work/portraits_sheet.png', np.vstack(rows))
print('wrote', len(tiles), 'portraits')
