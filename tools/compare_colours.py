"""Compares mean square colours of a 1536x1024 screenshot against the painted backdrop.

Usage: tools\\.venv\\Scripts\\python tools/compare_colours.py <screenshot.png>
Squares are sampled by their true 3D layout (solved camera), eroded to avoid the edges.
"""
import json
import sys
import cv2
import numpy as np
import os
CFG = json.load(open('tools/arenas.json'))['arenas'][os.environ.get('ARENA', 'palace-gardens')]
PREFIX = CFG['prefix']

cam = json.load(open(f'public/assets/scene/{PREFIX}_camera.json'))
f = cam['focal_px']
cx, cy = cam['principal_point_px']
qx, qy, qz, qw = cam['quaternion']
R = np.array([
    [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
    [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
    [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
])
pos = np.array(cam['position'])


def project(x, z):
    c = R.T @ (np.array([x, 0.0, z]) - pos)
    return [cx + f * c[0] / -c[2], cy - f * c[1] / -c[2]]


shot = cv2.imread(sys.argv[1])
orig = cv2.imread(f'tools/work/{PREFIX}.png')
H, W = orig.shape[:2]
light = np.zeros((H, W), np.uint8)
dark = np.zeros((H, W), np.uint8)
for col in range(8):
    for row in range(8):
        x0, z0 = -4 + col + 0.25, 4 - row - 0.25
        quad = np.array([project(x0, z0), project(x0 + 0.5, z0), project(x0 + 0.5, z0 - 0.5), project(x0, z0 - 0.5)], np.int32)
        cv2.fillConvexPoly(dark if (col + row) % 2 == 0 else light, quad, 255)

# The painting's own squares don't follow the true grid, so classify its pixels by brightness.
hsv = cv2.cvtColor(orig, cv2.COLOR_BGR2HSV)
board = cv2.bitwise_or(light, dark)
p_dark = (hsv[..., 2] < CFG['dark']['v']) & (board > 0)
p_light = (hsv[..., 2] > CFG['dark']['v'] + 60) & (board > 0)


def mean(img, m):
    return img[m].mean(axis=0)[::-1].round(1).tolist()


res = {
    'painted_light': mean(orig, p_light), 'render_light': mean(shot, light > 0),
    'painted_dark': mean(orig, p_dark), 'render_dark': mean(shot, dark > 0),
}
res['light_ratio'] = (np.array(res['painted_light']) / np.array(res['render_light'])).round(3).tolist()
res['dark_ratio'] = (np.array(res['painted_dark']) / np.array(res['render_dark'])).round(3).tolist()
print(json.dumps(res, indent=2))
