r"""Calibrates each arena's 3D marble against its painting: renders the empty board (dev server
must be running), compares mean light/dark square colours with the painted ones, and scales the
palette in public/data/arenas.json (linear space). Repeats a few rounds.
Usage: tools\.venv\Scripts\python tools/calibrate_arenas.py <arena-id> [...] [--rounds 3]
"""
import json
import os
import subprocess
import sys

args = sys.argv[1:]
rounds = 3
if '--rounds' in args:
    i = args.index('--rounds'); rounds = int(args[i + 1]); del args[i:i + 2]
DATA = 'public/data/arenas.json'
NODE = r'C:\Program Files\nodejs\node.exe'

for arena in args:
    for r in range(rounds):
        out = 'tools/work/calib'
        subprocess.run([NODE, 'tools/screenshots.mjs', '--out', out, f'{arena}=empty&noambience&mute&arena={arena}'], check=True, capture_output=True)
        res = json.loads(subprocess.run([sys.executable, 'tools/compare_colours.py', f'{out}/{arena}.png'], env={**os.environ, 'ARENA': arena},
                                        check=True, capture_output=True, text=True).stdout)
        data = json.load(open(DATA, encoding='utf-8'))
        pal = data['arenas'][arena]['palette']
        for key, painted, render in (('light', 'painted_light', 'render_light'), ('dark', 'painted_dark', 'render_dark')):
            new = []
            for k in range(3):
                ratio = (res[painted][k] + 1) / (res[render][k] + 1)
                # sRGB ratio -> roughly linear ratio; damped so rounds converge smoothly.
                f = ratio ** (2.2 * 0.8)
                new.append(round(min(1.0, max(0.002, pal[key][k] * f)), 4))
            pal[key] = new
        json.dump(data, open(DATA, 'w', encoding='utf-8'), indent=2)
        print(arena, 'round', r + 1, 'light', res['light_ratio'], 'dark', res['dark_ratio'], '->', pal['light'], pal['dark'])
