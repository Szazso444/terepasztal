"""Outlines, plan fit, json and sheets for the hydro plant scaffold.
Run with the ComfyUI venv python:  python post_hydro.py <render dir> <review-2 guides+plans dir> <final dir> <contact dir>
(the guides dir holds hydro_plant-r<v>.png and hydro_plant-r<v>-plan.json of claude/art-guides-review-2)"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

src, guides, final, contact = (Path(a) for a in sys.argv[1:5])
final.mkdir(parents=True, exist_ok=True)
contact.mkdir(parents=True, exist_ok=True)
W = H = 1024
meas = json.load(open(src / 'measures.json'))
S, C = 8, (512, 832)
HL, HW = 0.45, 0.3127


def pr(x, y, z=0):
    return [C[0] + S * (x - y) * 32, C[1] + S * ((x + y) * 16 - z)]


def plan(rot, hx, hy):
    if rot % 2:
        hx, hy = hy, hx
    return {'n': pr(-hx, -hy), 'e': pr(hx, -hy), 's': pr(hx, hy), 'w': pr(-hx, hy)}


def outline(alpha, eps=2.0):
    m = (alpha > 127).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cs = [c for c in cs if cv2.contourArea(c) > 60]
    cs.sort(key=lambda c: -cv2.contourArea(c))
    return [[[int(x), int(y)] for x, y in cv2.approxPolyDP(c, eps, True)[:, 0]] for c in cs]


def err(a, b):
    return max(float(np.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1])) for k in 'wsen')


def overshoot(alpha, fp):
    """Largest distance (canvas px) by which the lowest opaque pixel of a column lies below the plinth's two
    lower edges, or beyond its left/right corners."""
    ys, xs = np.nonzero(alpha > 127)
    over = 0.0
    w, s, e = fp['w'], fp['s'], fp['e']
    for x in range(xs.min(), xs.max() + 1):
        col = ys[xs == x]
        if not len(col):
            continue
        yb = col.max() + 1
        if x < w[0]:
            over = max(over, w[0] - x)
            continue
        if x > e[0]:
            over = max(over, x - e[0])
            continue
        if x <= s[0]:
            lim = w[1] + (s[1] - w[1]) * (x - w[0]) / (s[0] - w[0])
        else:
            lim = s[1] + (e[1] - s[1]) * (x - s[0]) / (e[0] - s[0])
        over = max(over, yb - lim)
    return over


summary = {}
for v in range(4):
    lit = np.array(Image.open(src / f'hydro_plant-r{v}-lit.png').convert('RGBA'))
    bare = np.array(Image.open(src / f'hydro_plant-r{v}-bare.png').convert('RGBA'))
    m = meas['measures'][f'r{v}']
    rp = json.load(open(guides / f'hydro_plant-r{v}-plan.json'))
    base_plan = {k: rp['base']['corners'][k] for k in 'wsen'}
    foot_plan = {k: rp['footprint']['corners'][k] for k in 'wsen'}
    ys, xs = np.nonzero(lit[:, :, 3] > 127)
    a, b = lit[:, :, 3] > 127, bare[:, :, 3] > 127
    ol = outline(lit[:, :, 3])
    ov = overshoot(lit[:, :, 3], foot_plan)
    meta = {
        'job': 'hydro_plant', 'view': f'r{v}', 'canvas': [W, H], 'anchor': list(C),
        'camera': m['camera'],
        'footprint_px': m['footprint_px'],
        'plan_base_px': {k: [round(c, 2) for c in base_plan[k]] for k in 'wsen'},
        'model_base_px': m['model_base_px'],
        'model_base_tiles': [0.9, 0.6254] if v % 2 == 0 else [0.6254, 0.9],
        'footprint_tiles': [1, 1],
        'plan_file': f'assets/source/buildings-v2/guides/review2/hydro_plant-r{v}-plan.json (branch claude/art-guides-review-2)',
        'dimensions': meas['dims'],
        'source': 'modelled directly in Blender (no painted source): blockout of a brick turbine house with a stone intake and a penstock',
        'outline_polygon_px': ol,
        'silhouette': {
            'bbox_px': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
            'area_px': int(a.sum()), 'top_row_px': int(ys.min()), 'bottom_row_px': int(ys.max()),
            'inside_canvas': bool(xs.min() > 0 and ys.min() > 0 and xs.max() < W - 1 and ys.max() < H - 1),
            'lit_vs_bare_iou': round(float((a & b).sum() / max(1, (a | b).sum())), 4),
            'max_overshoot_beyond_plinth_px': round(float(ov), 2),
        },
        'fit_vs_plan': {
            'model_base_corners_vs_plan_base_max_error_px': round(err(m['model_base_px'], base_plan), 3),
            'footprint_corners_vs_plan_plinth_max_error_px': round(err(m['footprint_px'], foot_plan), 3),
        },
        'note': 'Scaffold render: paint over the lit render, check the outline_polygon_px against the bare render. Canvas, anchor, footprint (1 x 1 plinth) and base (0.9 x 0.6254 tiles at r0, turned in r1 and r3) are the review-2 plan\'s; the camera is the game camera. The doorway of the tailrace arch is opaque: an opaque dark floor and interior, no transparent notch.',
    }
    json.dump(meta, open(final / f'hydro_plant-r{v}.json', 'w'), indent=1)
    for kind in ('lit', 'bare'):
        Image.fromarray(lit if kind == 'lit' else bare).save(final / f'hydro_plant-r{v}-{kind}.png', optimize=True)
    summary[f'r{v}'] = {k: meta[k] for k in ('silhouette', 'fit_vs_plan')}
    g = Image.open(guides / f'hydro_plant-r{v}.png').convert('RGBA')
    bgc = Image.new('RGBA', g.size, (236, 233, 226, 255))
    bgc.alpha_composite(g)
    comp = bgc.copy()
    comp.alpha_composite(Image.fromarray(lit))
    d = ImageDraw.Draw(comp)
    d.polygon([tuple(base_plan[k]) for k in 'wsen'], outline=(0, 160, 255, 255), width=2)
    comp.convert('RGB').save(src / f'overlay-r{v}.png')

json.dump(summary, open(src / 'summary.json', 'w'), indent=1)
print(json.dumps({k: {'bbox': s['silhouette']['bbox_px'], 'overshoot': s['silhouette']['max_overshoot_beyond_plinth_px'],
                      'fit': s['fit_vs_plan'], 'inside_canvas': s['silhouette']['inside_canvas']} for k, s in summary.items()}, indent=1))

ims = []
for v in range(4):
    bgc = Image.new('RGBA', (W, H), (236, 233, 226, 255))
    bgc.alpha_composite(Image.open(final / f'hydro_plant-r{v}-lit.png').convert('RGBA'))
    im = bgc.convert('RGB').crop((100, 120, 940, 1000)).resize((600, 629), Image.LANCZOS)
    ImageDraw.Draw(im).text((10, 8), f'r{v}', fill=(20, 20, 20))
    im.save(contact / f'hydro_plant-r{v}-lit.png', optimize=True)
    ims.append(im)
sheet = Image.new('RGB', (1200, 1258))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % 2) * 600, (i // 2) * 629))
sheet.save(contact / 'hydro_plant-contact.jpg', quality=88)
