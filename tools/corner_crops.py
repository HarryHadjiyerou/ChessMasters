"""Writes enlarged crops around approximate board corners with a pixel grid, for measuring.

Usage: tools\\.venv\\Scripts\\python tools/corner_crops.py x,y x,y ...
"""
import sys
from PIL import Image, ImageDraw

SRC = 'tools/work/palace_garden.png'
HALF = int(sys.argv.pop(1)) if len(sys.argv) > 1 and ',' not in sys.argv[1] else 50
ZOOM = max(1, 500 // (HALF * 2))

im = Image.open(SRC).convert('RGB')
tiles = []
for arg in sys.argv[1:]:
    cx, cy = (int(v) for v in arg.split(','))
    crop = im.crop((cx - HALF, cy - HALF, cx + HALF, cy + HALF)).resize((HALF * 2 * ZOOM,) * 2, Image.NEAREST)
    d = ImageDraw.Draw(crop)
    for i in range(0, HALF * 2 + 1, 10):
        colour = (0, 255, 255) if i == HALF else (255, 0, 255)
        d.line([(i * ZOOM, 0), (i * ZOOM, HALF * 2 * ZOOM)], fill=colour, width=1)
        d.line([(0, i * ZOOM), (HALF * 2 * ZOOM, i * ZOOM)], fill=colour, width=1)
    d.text((4, 4), f'centre {cx},{cy}  grid 10px', fill=(255, 255, 0))
    tiles.append(crop)

sheet = Image.new('RGB', (len(tiles) * HALF * 2 * ZOOM, HALF * 2 * ZOOM))
for i, t in enumerate(tiles):
    sheet.paste(t, (i * HALF * 2 * ZOOM, 0))
sheet.save('tools/work/corners.png')
