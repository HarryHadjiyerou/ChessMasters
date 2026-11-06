"""Menu screens: copies the four screen images, writes web versions, and checks hotspot boxes.

Source (read-only): ..\\SCREEN IMAGE\\*.png (1846x852)
Outputs:
  public/assets/screens/<id>.webp, <id>_blur.jpg (letterbox fill)
  public/data/screens.json  hotspot rectangles as percentages of the image
  tools/work/screens/<id>_hotspots.png  overlay check images

Hotspot boxes are measured in image pixels below (x0, y0, x1, y1), checked against the
overlay images, and converted to percentages.
"""
import json
import os
import shutil
import cv2

SRC = '../SCREEN IMAGE/'
OUT = 'public/assets/screens/'
WORK = 'tools/work/screens/'
SCREENS = {
    'start': {'file': 'START SCREEN.png', 'hotspots': {}},
    'side': {'file': 'CHOOSE SIDE.png', 'hotspots': {
        'light': (614, 616, 912, 718),
        'dark': (934, 616, 1236, 718),
    }},
    'arena': {'file': 'Chess Masters_ Choose Your Arena (1).png', 'hotspots': {
        'palace-gardens': (318, 610, 548, 806),
        'dark-kingdom': (556, 610, 786, 806),
        'frozen-kingdom': (801, 610, 1033, 806),
        'jungle-temple': (1050, 610, 1280, 806),
        'arabian-palace': (1292, 610, 1524, 806),
    }},
    'play': {'file': 'Chess Masters_ Royal Clash at Sunset.png', 'hotspots': {
        'play': (726, 643, 1112, 758),
    }},
}

os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)
data = {'image_size': None, 'screens': {}}
for sid, s in SCREENS.items():
    work_png = WORK + sid + '.png'
    shutil.copyfile(SRC + s['file'], work_png)
    img = cv2.imread(work_png)
    H, W = img.shape[:2]
    data['image_size'] = [W, H]
    cv2.imwrite(OUT + sid + '.webp', img, [cv2.IMWRITE_WEBP_QUALITY, 92])
    blur = cv2.GaussianBlur(cv2.resize(img, (W // 4, H // 4), interpolation=cv2.INTER_AREA), (0, 0), 10)
    cv2.imwrite(OUT + sid + '_blur.jpg', (blur * 0.5).astype('uint8'), [cv2.IMWRITE_JPEG_QUALITY, 85])
    spots = {}
    over = img.copy()
    for hid, (x0, y0, x1, y1) in s['hotspots'].items():
        spots[hid] = {k: round(v, 3) for k, v in {
            'left': 100 * x0 / W, 'top': 100 * y0 / H, 'width': 100 * (x1 - x0) / W, 'height': 100 * (y1 - y0) / H}.items()}
        cv2.rectangle(over, (x0, y0), (x1, y1), (0, 255, 0), 2)
    cv2.imwrite(WORK + sid + '_hotspots.png', over)
    data['screens'][sid] = {'image': f'assets/screens/{sid}.webp', 'blur': f'assets/screens/{sid}_blur.jpg', 'hotspots': spots}

with open('public/data/screens.json', 'w') as f:
    json.dump(data, f, indent=2)
print(json.dumps(data['screens'], indent=1)[:600])
