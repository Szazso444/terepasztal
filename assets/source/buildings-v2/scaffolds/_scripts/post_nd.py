"""Outlines, plan fit, json and sheets for the narrow depot scaffold.
Run with the ComfyUI venv python:  python post_nd.py <render dir> <guides dir> <final dir> <contact dir>"""
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
S, C = 8, (512, 800)


def pr(x, y, z=0):
    return [C[0] + S * (x - y) * 32, C[1] + S * ((x + y) * 16 - z)]


def plan(rot, inset):
    w, h = (2, 1) if rot % 2 == 0 else (1, 2)
    x, y = w / 2 - inset, h / 2 - inset
    return {'n': pr(-x, -y), 'e': pr(x, -y), 's': pr(x, y), 'w': pr(-x, y)}


def outline(alpha, eps=2.0):
    m = (alpha > 127).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cs = [c for c in cs if cv2.contourArea(c) > 60]
    cs.sort(key=lambda c: -cv2.contourArea(c))
    return [[[int(x), int(y)] for x, y in cv2.approxPolyDP(c, eps, True)[:, 0]] for c in cs]


def err(a, b):
    return max(float(np.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1])) for k in 'wsen')


def inside_plinth_overshoot(alpha, fp):
    """Largest distance (canvas px) by which the lowest opaque pixel of a column lies below the plinth's two
    lower edges, or beyond its left/right corners."""
    ys, xs = np.nonzero(alpha > 127)
    over = 0.0
    w, s, e = fp['w'], fp['s'], fp['e']
    for x in range(xs.min(), xs.max() + 1):
        col = ys[xs == x]
        if not len(col):
            continue
        yb = col.max() + 1  # pixel bottom edge
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
    lit = np.array(Image.open(src / f'depot_narrow-r{v}-lit.png').convert('RGBA'))
    bare = np.array(Image.open(src / f'depot_narrow-r{v}-bare.png').convert('RGBA'))
    m = meas['measures'][f'r{v}']
    base_plan = plan(v, 0.06)
    foot_plan = plan(v, 0.0)
    rule90 = {}
    w_, h_ = (2, 1) if v % 2 == 0 else (1, 2)
    x, y = 0.9 * w_ / 2, 0.9 * h_ / 2
    rule90 = {'n': pr(-x, -y), 'e': pr(x, -y), 's': pr(x, y), 'w': pr(-x, y)}
    ys, xs = np.nonzero(lit[:, :, 3] > 127)
    a, b = lit[:, :, 3] > 127, bare[:, :, 3] > 127
    ol = outline(lit[:, :, 3])
    # silhouette extremes at the wall base against the plan
    ov = inside_plinth_overshoot(lit[:, :, 3], foot_plan)
    # the lowest opaque pixel of the lit render in the column of the near corner s
    scol = np.nonzero(lit[:, int(round(base_plan['s'][0])), 3] > 127)[0]
    meta = {
        'job': 'depot_narrow', 'view': f'r{v}', 'canvas': [W, H], 'anchor': list(C),
        'camera': m['camera'],
        'footprint_px': m['footprint_px'],
        'plan_base_px': {k: [round(c, 2) for c in base_plan[k]] for k in 'wsen'},
        'model_base_px': m['model_base_px'],
        'model_base_tiles': [1.88, 0.88] if v % 2 == 0 else [0.88, 1.88],
        'footprint_tiles': [2, 1] if v % 2 == 0 else [1, 2],
        'rule_0.90_base_px': {k: [round(c, 2) for c in rule90[k]] for k in 'wsen'},
        'dimensions': meas['dims'],
        'source': 'modelled directly in Blender (no painted source): blockout of a single-track engine shed',
        'outline_polygon_px': ol,
        'silhouette': {
            'bbox_px': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
            'area_px': int(a.sum()), 'top_row_px': int(ys.min()), 'bottom_row_px': int(ys.max()),
            'inside_canvas': bool(xs.min() > 0 and ys.min() > 0 and xs.max() < W - 1 and ys.max() < H - 1),
            'lit_vs_bare_iou': round(float((a & b).sum() / max(1, (a | b).sum())), 4),
            'lowest_opaque_px_in_near_corner_column': int(scol.max()) if len(scol) else None,
            'max_overshoot_beyond_footprint_px': round(float(ov), 2),
        },
        'fit_vs_plan': {
            'model_base_corners_vs_guide_wallbase_max_error_px': round(err(m['model_base_px'], base_plan), 3),
            'footprint_corners_vs_guide_plinth_max_error_px': round(err(m['footprint_px'], foot_plan), 3),
        },
        'note': 'Scaffold render: paint over the lit render, check the outline_polygon_px against the bare render. Canvas and anchor are the t1x2 guide\'s; camera is the game camera. Base = the guide\'s wall base (footprint set in by 0.06 tile: 1.88 x 0.88 tiles at r0).',
    }
    json.dump(meta, open(final / f'depot_narrow-r{v}.json', 'w'), indent=1)
    for kind in ('lit', 'bare'):
        Image.fromarray(lit if kind == 'lit' else bare).save(final / f'depot_narrow-r{v}-{kind}.png', optimize=True)
    summary[f'r{v}'] = {k: meta[k] for k in ('silhouette', 'fit_vs_plan')}
    # guide overlay (review)
    g = Image.open(guides / f't1x2-r{v}.png').convert('RGBA')
    bgc = Image.new('RGBA', g.size, (236, 233, 226, 255))
    bgc.alpha_composite(g)
    comp = bgc.copy()
    comp.alpha_composite(Image.fromarray(lit))
    d = ImageDraw.Draw(comp)
    d.polygon([tuple(base_plan[k]) for k in 'wsen'], outline=(0, 160, 255, 255), width=2)
    comp.convert('RGB').save(src / f'overlay-r{v}.png')

json.dump(summary, open(src / 'summary.json', 'w'), indent=1)
print(json.dumps(summary, indent=1))

# contact sheet: four lit renders on the cream background, labelled
ims = []
for v in range(4):
    bgc = Image.new('RGBA', (W, H), (236, 233, 226, 255))
    bgc.alpha_composite(Image.open(final / f'depot_narrow-r{v}-lit.png').convert('RGBA'))
    im = bgc.convert('RGB').crop((60, 120, 960, 1020)).resize((600, 600), Image.LANCZOS)
    ImageDraw.Draw(im).text((10, 8), f'r{v}', fill=(20, 20, 20))
    im.save(contact / f'depot_narrow-r{v}-lit.png', optimize=True)
    ims.append(im)
sheet = Image.new('RGB', (1200, 1200))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % 2) * 600, (i // 2) * 600))
sheet.save(contact / 'depot_narrow-contact.jpg', quality=88)
