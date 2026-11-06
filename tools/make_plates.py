"""Builds the Palace Garden image plates from tools/work/palace_garden.png.

Outputs (public/assets/scene/):
  palace_garden_bg.webp   full background plate
  palace_garden_fg.webp   foreground plate with alpha: everything in front of the board's two
                          near edges (front faces of the plinth, stairs, bushes, near finials,
                          left cypresses). The cut line sits just outside the painted gold frame,
                          projected from the solved camera, so 3D pieces, the board and frame
                          labels are never hidden but anything nearer the viewer is.
  palace_garden_blur.jpg  small blurred, darkened copy for letterbox fill
  palace_garden_colours.json  mean colours of painted light/dark squares (for material tuning)

Run after measure_board.py and solve_camera.py.
"""
import json
import cv2
import numpy as np
import os as _os, json as _json
ARENA = _os.environ.get('ARENA', 'palace-gardens')
CFG = _json.load(open('tools/arenas.json'))['arenas'][ARENA]
PREFIX = CFG['prefix']

SRC = f'tools/work/{PREFIX}.png'
OUT = 'public/assets/scene/'
FRAME_OFFSET = CFG['frameOffset']  # squares outside the playing area: outer edge of the painted gold frame
FEATHER_PX = 1.5

img = cv2.imread(SRC)
H, W = img.shape[:2]
cam = json.load(open(OUT + f'{PREFIX}_camera.json'))
f = cam['focal_px']
cx, cy = cam['principal_point_px']

# Build world->image projection from the camera JSON (three.js convention).
qx, qy, qz, qw = cam['quaternion']
R = np.array([
    [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
    [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
    [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
])
pos = np.array(cam['position'])


def project(p):
    c = R.T @ (np.asarray(p, float) - pos)  # camera space, three.js: looking down -z
    return np.array([cx + f * c[0] / -c[2], cy - f * c[1] / -c[2]])


e = 4 + FRAME_OFFSET
a8, a1, h1 = project((-e, 0, -e)), project((-e, 0, e)), project((e, 0, e))


def extend(p, q, dist=4000):
    d = (q - p) / np.linalg.norm(q - p)
    return q + d * dist


# Region below the polyline a8 -> a1 -> h1, extended past both ends, closed along the bottom.
poly = np.array([
    extend(a1, a8), a8, a1, h1, extend(a1, h1),
    (W + 4000, H + 4000), (-4000, H + 4000),
], np.float64)
mask = np.zeros((H * 4, W * 4), np.uint8)  # 4x supersampled for a clean anti-aliased edge
cv2.fillPoly(mask, [np.round(poly * 4).astype(np.int32)], 255, lineType=cv2.LINE_AA)
mask = cv2.resize(mask, (W, H), interpolation=cv2.INTER_AREA)
mask = cv2.GaussianBlur(mask, (0, 0), FEATHER_PX)

fg = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
fg[..., 3] = mask
cv2.imwrite(OUT + f'{PREFIX}_fg.webp', fg, [cv2.IMWRITE_WEBP_QUALITY, 101])  # 101 = lossless
cv2.imwrite(OUT + f'{PREFIX}_bg.webp', img, [cv2.IMWRITE_WEBP_QUALITY, 95])

blur = cv2.resize(img, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
blur = cv2.GaussianBlur(blur, (0, 0), 12)
blur = (blur * 0.45).astype(np.uint8)
cv2.imwrite(OUT + f'{PREFIX}_blur.jpg', blur, [cv2.IMWRITE_JPEG_QUALITY, 85])

# Mean colours of painted squares inside the playing area (sRGB 0-255).
ic = cam['image_corners']
quad = np.array([ic['a1'], ic['h1'], ic['h8'], ic['a8']], np.int32)
inside = np.zeros((H, W), np.uint8)
cv2.fillConvexPoly(inside, quad, 255)
inside = cv2.erode(inside, np.ones((15, 15), np.uint8))
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
dark = (hsv[..., 2] < CFG['dark']['v']) & (hsv[..., 1] < CFG['dark']['s']) & (inside > 0)
light = (hsv[..., 2] > 170) & (inside > 0)
colours = {
    'light_square_srgb': [round(float(v), 1) for v in img[light].mean(axis=0)[::-1]],
    'dark_square_srgb': [round(float(v), 1) for v in img[dark].mean(axis=0)[::-1]],
    'foreground_cut_image_px': {'a8': a8.round(1).tolist(), 'a1': a1.round(1).tolist(), 'h1': h1.round(1).tolist()},
}
json.dump(colours, open(OUT + f'{PREFIX}_colours.json', 'w'), indent=2)
print(json.dumps(colours, indent=2))

preview = img.copy()
preview[mask < 128] = (preview[mask < 128] * 0.25).astype(np.uint8)
cv2.imwrite(f'tools/work/{PREFIX}_foreground_preview.png', preview)

# Check image: the 3D board's 8x8 grid projected onto the painting.
grid = img.copy()
for i in range(9):
    t = -4 + i
    for a_, b_ in (((t, -4), (t, 4)), ((-4, t), (4, t))):
        p0, p1 = project((a_[0], 0, a_[1])), project((b_[0], 0, b_[1]))
        cv2.line(grid, tuple(int(round(v)) for v in p0), tuple(int(round(v)) for v in p1), (255, 0, 255), 2, cv2.LINE_AA)
cv2.imwrite(f'tools/work/{PREFIX}_grid_preview.png', grid)
