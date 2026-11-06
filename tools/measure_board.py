"""Measures the four corners of the painted checker area in the Palace Garden image.

Method: mask the dark squares, take their convex hull, group hull edges by the four expected
side directions, fit a line per side and intersect neighbouring lines. Outer edges of dark
squares on each edge rank/file lie on the boundary, so this finds the true corners even where
a corner square is light. Writes tools/work/board_corners.json and an overlay image.
"""
import json
import cv2
import numpy as np
import os as _os, json as _json
ARENA = _os.environ.get('ARENA', 'palace-gardens')
CFG = _json.load(open('tools/arenas.json'))['arenas'][ARENA]
PREFIX = CFG['prefix']

SRC = f'tools/work/{PREFIX}.png'
if 'corners' in CFG:
    # Hand-measured checker corners (top, right, bottom, left) override the automatic search.
    names = ['top', 'right', 'bottom', 'left']
    import cv2 as _cv2
    _h, _w = _cv2.imread(SRC).shape[:2]
    json.dump({**{n: c for n, c in zip(names, CFG['corners'])}, 'image_size': [_w, _h], 'method': 'hand-measured (tools/arenas.json)'},
              open(f'tools/work/{PREFIX}_corners.json', 'w'), indent=2)
    print('dark squares found: n/a (hand-measured corners)')
    raise SystemExit(0)
# Rough outer-frame corners from the brief (orientation only): top, right, bottom, left.
ROUGH = np.array(CFG['rough'], dtype=np.float32)

img = cv2.imread(SRC)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
v = hsv[..., 2].astype(np.int32)
s = hsv[..., 1].astype(np.int32)

region = np.zeros(v.shape, np.uint8)
cv2.fillConvexPoly(region, ROUGH.astype(np.int32), 255)
dark = ((v < CFG['dark']['v']) & (s < CFG['dark']['s'])).astype(np.uint8) * 255
dark &= region
dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))

n, labels, stats, _ = cv2.connectedComponentsWithStats(dark)
keep = np.zeros_like(dark)
areas = []
for i in range(1, n):
    a = stats[i, cv2.CC_STAT_AREA]
    if 800 < a < 20000:
        keep[labels == i] = 255
        areas.append(a)
print(f'dark squares found: {len(areas)} (median area {int(np.median(areas))} px)')

pts = cv2.findNonZero(keep)
hull = cv2.convexHull(pts).reshape(-1, 2).astype(np.float64)

centre = ROUGH.mean(axis=0)
sides = [(ROUGH[i], ROUGH[(i + 1) % 4]) for i in range(4)]  # top-right, right-bottom, bottom-left, left-top
groups = [[] for _ in range(4)]
for i in range(len(hull)):
    p, q = hull[i], hull[(i + 1) % len(hull)]
    d = q - p
    length = np.hypot(*d)
    if length < 25:
        continue
    ang = np.arctan2(d[1], d[0])
    best, best_err = None, 1e9
    for k, (a, b) in enumerate(sides):
        e = b - a
        err = abs((np.arctan2(e[1], e[0]) - ang + np.pi) % (2 * np.pi) - np.pi)
        if err < best_err:
            best, best_err = k, err
    if best_err < np.radians(8):
        groups[best].append((p, q, length))

lines = []
for k, g in enumerate(groups):
    if not g:
        raise SystemExit(f'side {k}: no hull edges matched')
    samples = []
    for p, q, length in g:
        for t in np.linspace(0, 1, max(2, int(length // 5))):
            samples.append(p + (q - p) * t)
    vx, vy, x0, y0 = cv2.fitLine(np.array(samples, np.float32), cv2.DIST_L2, 0, 0.01, 0.01).ravel()
    lines.append((np.array([x0, y0]), np.array([vx, vy])))
    print(f'side {k}: {len(g)} hull edges, total length {sum(x[2] for x in g):.0f} px')


def cross2(a, b):
    return a[0] * b[1] - a[1] * b[0]


def intersect(l1, l2):
    (p, r), (q, s_) = l1, l2
    t = cross2(q - p, s_) / cross2(r, s_)
    return p + t * r


# Corner i is between side i-1 and side i: top = left-top & top-right, etc.
corners = [intersect(lines[(i - 1) % 4], lines[i]) for i in range(4)]
names = ['top', 'right', 'bottom', 'left']
result = {name: [round(float(c[0]), 2), round(float(c[1]), 2)] for name, c in zip(names, corners)}

# Gold frame inner edge: step each side line outwards and look for the brightness jump onto the
# gold bevel. Profiles are averaged along the middle 70% of each side to ignore the corners.
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
frame_lines = []
offsets = np.arange(-4, 30, 0.5)
side_offsets = []
for k, (p, d) in enumerate(lines):
    a, b = corners[k], corners[(k + 1) % 4]
    normal = np.array([-d[1], d[0]])
    if np.dot(normal, centre - (a + b) / 2) > 0:
        normal = -normal  # point outwards
    profile = []
    for off in offsets:
        vals = []
        for t in np.linspace(0.15, 0.85, 120):
            q = a + (b - a) * t + normal * off
            vals.append(cv2.getRectSubPix(gray, (1, 1), (float(q[0]), float(q[1])))[0, 0])
        profile.append(np.median(vals))
    profile = np.array(profile)
    grad = np.gradient(profile)
    # first strong rise after the dark groove = gold bevel starts
    i = int(np.argmax(grad[8:])) + 8
    off = float(offsets[i])
    side_offsets.append(off)
    frame_lines.append((p + normal * off, d))
    print(f'side {k}: frame inner edge {off:.1f} px outside the checker line')
frame_corners = [intersect(frame_lines[(i - 1) % 4], frame_lines[i]) for i in range(4)]
result['frame_inner'] = {name: [round(float(c[0]), 2), round(float(c[1]), 2)] for name, c in zip(names, frame_corners)}
result['frame_offsets_px'] = side_offsets
result['image_size'] = [img.shape[1], img.shape[0]]
result['method'] = 'convex hull of dark-square mask, line fit per side (tools/measure_board.py)'
with open(f'tools/work/{PREFIX}_corners.json', 'w') as f:
    json.dump(result, f, indent=2)
print(json.dumps(result, indent=2))

over = img.copy()
over[keep > 0] = (over[keep > 0] * 0.4 + np.array([255, 0, 255]) * 0.6).astype(np.uint8)
poly = np.array(corners, np.int32)
cv2.polylines(over, [poly], True, (0, 255, 255), 1, cv2.LINE_AA)
cv2.polylines(over, [np.array(frame_corners, np.int32)], True, (0, 255, 0), 1, cv2.LINE_AA)
for c in corners:
    cv2.circle(over, (int(round(c[0])), int(round(c[1]))), 4, (0, 255, 0), 1, cv2.LINE_AA)
cv2.imwrite(f'tools/work/{PREFIX}_corners_overlay.png', over)
