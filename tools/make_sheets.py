"""Builds comparison sheets for checkpoint reports.

Usage: tools\\.venv\\Scripts\\python tools/make_sheets.py <screenshot dir>
Expects board_empty.png and board_overlay.png (1536x1024) in that dir. Writes:
  original.png, side_by_side.png (original | render), overlay_corners.png (4x zoom per corner)
"""
import json
import os
import sys
from PIL import Image, ImageDraw

d = sys.argv[1]
orig = Image.open('tools/work/palace_garden.png').convert('RGB')
render = Image.open(os.path.join(d, 'board_empty.png')).convert('RGB')
overlay = Image.open(os.path.join(d, 'board_overlay.png')).convert('RGB')
orig.save(os.path.join(d, 'original.png'))

W, H = orig.size
sbs = Image.new('RGB', (W * 2 + 16, H + 56), (18, 11, 8))
sbs.paste(orig, (0, 56))
sbs.paste(render, (W + 16, 56))
dr = ImageDraw.Draw(sbs)
dr.text((12, 18), 'ORIGINAL IMAGE (Golden Chessboard in a Palace Garden.png)', fill=(244, 230, 200))
dr.text((W + 28, 18), 'RENDER: image plates + real 3D 8x8 board (empty)', fill=(244, 230, 200))
sbs.save(os.path.join(d, 'side_by_side.png'))

cam = json.load(open('public/assets/scene/palace_garden_camera.json'))
corners = cam['image_corners']
Z, R = 4, 40
tiles = []
for name in ['a8', 'h8', 'a1', 'h1']:
    x, y = corners[name]
    box = (int(x) - R, int(y) - R, int(x) + R, int(y) + R)
    t = overlay.crop(box).resize((R * 2 * Z, R * 2 * Z), Image.NEAREST)
    td = ImageDraw.Draw(t)
    mx, my = (x - box[0]) * Z, (y - box[1]) * Z
    td.ellipse((mx - 2 * Z, my - 2 * Z, mx + 2 * Z, my + 2 * Z), outline=(0, 255, 0), width=1)  # 2 px radius
    td.rectangle((0, 0, 330, 18), fill=(0, 0, 0))
    td.text((4, 3), f'{name}: measured corner (green = 2 px radius)', fill=(0, 255, 0))
    tiles.append(t)
sheet = Image.new('RGB', (R * 2 * Z * 2, R * 2 * Z * 2))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % 2) * R * 2 * Z, (i // 2) * R * 2 * Z))
sheet.save(os.path.join(d, 'overlay_corners.png'))
print('sheets written to', d)
