r"""Builds one arena's scene assets: copies the image (source is read-only), measures the painted
board, solves the matched camera and cuts the plates.
Usage: tools\.venv\Scripts\python tools/build_arena.py <arena-id> [<arena-id> ...]   (or: all)
"""
import json
import os
import shutil
import subprocess
import sys

cfg = json.load(open('tools/arenas.json'))['arenas']
ids = list(cfg) if sys.argv[1:] == ['all'] else sys.argv[1:]
os.makedirs('tools/work', exist_ok=True)
for a in ids:
    c = cfg[a]
    shutil.copyfile(f"../BOARD ASSETS/{c['image']}", f"tools/work/{c['prefix']}.png")
    env = {**os.environ, 'ARENA': a}
    for step in ['measure_board.py', 'solve_camera.py', 'make_plates.py']:
        r = subprocess.run([sys.executable, f'tools/{step}'], env=env, capture_output=True, text=True)
        if r.returncode:
            print(r.stdout[-2000:], r.stderr[-2000:])
            raise SystemExit(f'{a}: {step} failed')
        if step == 'measure_board.py':
            print(a, [l for l in r.stdout.splitlines() if 'dark squares' in l])
        if step == 'solve_camera.py':
            print(a, 'reprojection', json.load(open(f"public/assets/scene/{c['prefix']}_camera.json"))['reprojection_error_px'])
