"""Solves the fixed camera that views the 3D board exactly as the Palace Garden image does.

Input:  tools/work/board_corners.json (from measure_board.py)
Output: public/assets/scene/palace_garden_camera.json

World (three.js): y up, board on y=0, centred at the origin, 1 unit = 1 square.
Files a..h run along +x, ranks 1..8 along -z. The light player's home rank (rank 1) is the
edge nearest the stairs, so: a1 corner = image 'bottom', h1 = 'right', h8 = 'top', a8 = 'left'.
The art is AI-painted, so its board is not a perfect square seen through a centred lens (a
centred-lens fit leaves 4-6 px error). We therefore solve focal length AND principal point:
a square planar target gives two constraints on (f, cx, cy) via the homography, leaving a
curve of exact solutions; we take the point on it closest to the image centre.
"""
import json
import os
import cv2
import numpy as np
import os as _os, json as _json
ARENA = _os.environ.get('ARENA', 'palace-gardens')
CFG = _json.load(open('tools/arenas.json'))['arenas'][ARENA]
PREFIX = CFG['prefix']

corners = json.load(open(f'tools/work/{PREFIX}_corners.json'))
W, H = corners['image_size']
order = ['bottom', 'right', 'top', 'left']
img_pts = np.array([corners[k] for k in order], np.float64)
obj_pts = np.array([(-4, 0, 4), (4, 0, 4), (4, 0, -4), (-4, 0, -4)], np.float64)


def solve(f, cx, cy):
    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1]], np.float64)
    ok, rvec, tvec = cv2.solvePnP(obj_pts, img_pts, K, None, flags=cv2.SOLVEPNP_IPPE)
    if not ok:
        return None
    proj, _ = cv2.projectPoints(obj_pts, rvec, tvec, K, None)
    err = np.linalg.norm(proj.reshape(-1, 2) - img_pts, axis=1)
    return err, rvec, tvec, K, proj.reshape(-1, 2)


# Homography from board plane (x, -z) to image.
Hm, _ = cv2.findHomography(obj_pts[:, [0, 2]] * np.array([1, -1]), img_pts)
h1, h2 = Hm[:, 0], Hm[:, 1]


def focal_sq(cx, cy):
    a, b, c = h1[0] - cx * h1[2], h1[1] - cy * h1[2], h1[2]
    a2, b2, c2 = h2[0] - cx * h2[2], h2[1] - cy * h2[2], h2[2]
    f_orth = -(a * a2 + b * b2) / (c * c2)
    f_norm = (a2 * a2 + b2 * b2 - a * a - b * b) / (c * c - c2 * c2)
    return f_orth, f_norm


def mismatch(cx, cy):
    fo, fn = focal_sq(cx, cy)
    return (fo - fn) / max(abs(fo), 1e-9)


# Walk outwards from the centre: for each cx, bisect cy for mismatch = 0.
candidates = []
for cx in np.arange(W / 2 - 300, W / 2 + 300, 0.5):
    ys = np.arange(H / 2 - 300, H / 2 + 300, 2.0)
    vals = [mismatch(cx, y) for y in ys]
    for i in range(len(ys) - 1):
        if np.sign(vals[i]) != np.sign(vals[i + 1]):
            lo, hi = ys[i], ys[i + 1]
            for _ in range(60):
                mid = (lo + hi) / 2
                if np.sign(mismatch(cx, mid)) == np.sign(mismatch(cx, lo)):
                    lo = mid
                else:
                    hi = mid
            cy = (lo + hi) / 2
            fo, _ = focal_sq(cx, cy)
            if fo > 0:
                candidates.append((np.hypot(cx - W / 2, cy - H / 2), cx, cy, np.sqrt(fo)))
if candidates:
    _, cx, cy, f = min(candidates)
    err, rvec, tvec, K, proj = solve(f, cx, cy)
else:
    # The painted board is not a perspective-consistent square: fall back to the best centred-lens
    # fit (a few px of error, hidden by the 3D gold lip).
    cx, cy = W / 2, H / 2
    best = None
    for f0 in np.geomspace(500, 20000, 3000):
        r = solve(f0, cx, cy)
        if r is not None and (best is None or r[0].max() < best[1][0].max()):
            best = (f0, r)
    f, (err, rvec, tvec, K, proj) = best
    print('fallback fit, max error px', round(float(err.max()), 2))
R_cv, _ = cv2.Rodrigues(rvec)
# OpenCV camera axes (x right, y down, z forward) -> three.js camera axes (x right, y up, z back)
flip = np.diag([1, -1, -1])
R_world_to_cam = flip @ R_cv
t_cam = flip @ tvec.reshape(3)
R_cam_to_world = R_world_to_cam.T
position = -R_cam_to_world @ t_cam

# rotation matrix -> quaternion (x, y, z, w)
m = R_cam_to_world
tr = np.trace(m)
if tr > 0:
    s = np.sqrt(tr + 1.0) * 2
    q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
else:
    i = int(np.argmax(np.diag(m)))
    j, k = (i + 1) % 3, (i + 2) % 3
    s = np.sqrt(1.0 + m[i, i] - m[j, j] - m[k, k]) * 2
    q = [0.0] * 4
    q[i] = 0.25 * s
    q[j] = (m[j, i] + m[i, j]) / s
    q[k] = (m[k, i] + m[i, k]) / s
    q[3] = (m[k, j] - m[j, k]) / s

fov_y = float(np.degrees(2 * np.arctan(H / 2 / f)))
out = {
    'image_size': [W, H],
    'focal_px': round(float(f), 3),
    'principal_point_px': [round(float(cx), 3), round(float(cy), 3)],
    'fov_y_deg': round(fov_y, 4),
    'position': [round(float(v), 6) for v in position],
    'quaternion': [round(float(v), 8) for v in q],
    'board': {'square_size': 1, 'centre': [0, 0, 0], 'files_axis': '+x', 'ranks_axis': '-z'},
    'image_corners': {'a1': corners['bottom'], 'h1': corners['right'], 'h8': corners['top'], 'a8': corners['left']},
    'reprojected_corners': {k: [round(float(x), 2) for x in p] for k, p in zip(['a1', 'h1', 'h8', 'a8'], proj)},
    'reprojection_error_px': {k: round(float(e), 3) for k, e in zip(['a1', 'h1', 'h8', 'a8'], err)},
    'notes': 'Off-centre principal point (image y down). fov_y_deg is for a centred lens and is informational only; render with an asymmetric frustum from focal_px and principal_point_px. Generated by tools/solve_camera.py.',
}
os.makedirs('public/assets/scene', exist_ok=True)
with open(f'public/assets/scene/{PREFIX}_camera.json', 'w') as fh:
    json.dump(out, fh, indent=2)
print(json.dumps(out, indent=2))
