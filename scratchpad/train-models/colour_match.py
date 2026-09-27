"""Colour match of a rendered sprite against its source image (and the rejected Rocket proof of concept).

For each subject: the source crop's object pixels (its mask) against the facing-0 sprite's opaque pixels
(facing 0 is the source's own view: nose to the lower right). Reports the difference of mean colours
(CIE76 delta E) and a five-colour palette of each, so a shift like the POC's yellow-to-olive shows as
numbers and swatches. Also writes side-by-side panels for the review page.

python colour_match.py <pipeline out root> <review dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT, REVIEW = Path(sys.argv[1]), Path(sys.argv[2])
POC = Path("G:/DEV/Terepasztal/poc/rocket-original-v1/renders/game-f0.png")
SUBJECTS = {"rocket": ["body"], "flying_scotsman": ["engine", "tender"], "sd40": ["body"], "f7": ["body"],
            "black_five": ["engine", "tender"], "nine_f": ["engine", "tender"]}


def lab(rgb):
    c = np.clip(rgb / 255.0, 0, 1)
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def palette(rgb, k=5, iters=12, seed=1):
    """k-means in Lab; returns colours (sRGB) sorted by share, and shares."""
    rng = np.random.default_rng(seed)
    px = rgb[rng.choice(len(rgb), min(len(rgb), 20000), replace=False)]
    L = lab(px)
    cent = L[rng.choice(len(L), k, replace=False)]
    for _ in range(iters):
        lab_d = ((L[:, None, :] - cent[None]) ** 2).sum(2)
        lbl = lab_d.argmin(1)
        cent = np.array([L[lbl == i].mean(0) if (lbl == i).any() else cent[i] for i in range(k)])
    share = np.bincount(lbl, minlength=k) / len(lbl)
    cols = np.array([px[lbl == i].mean(0) if (lbl == i).any() else [0, 0, 0] for i in range(k)])
    order = np.argsort(-share)
    return cols[order].round().astype(int).tolist(), share[order].round(3).tolist()


def pixels(path, mask=None):
    im = np.asarray(Image.open(path).convert("RGBA")).astype(np.float64)
    if mask is not None:
        m = np.asarray(Image.open(mask).convert("L")) > 127
        return im[..., :3][m]
    return im[..., :3][im[..., 3] > 200]


def panel(images, height, bg=(46, 52, 49)):
    ims = []
    for p in images:
        im = Image.open(p).convert("RGBA")
        if im.getchannel("A").getextrema()[0] < 255:  # a sprite: trim its transparent canvas
            im = im.crop(im.getchannel("A").getbbox())
        im = im.resize((round(im.width * height / im.height), height), Image.LANCZOS)
        ims.append(im)
    W = sum(i.width for i in ims) + 16 * (len(ims) + 1)
    out = Image.new("RGBA", (W, height + 32), bg + (255,))
    x = 16
    for im in ims:
        out.alpha_composite(im, (x, 16))
        x += im.width + 16
    return out.convert("RGB")


report = {}
(REVIEW / "img").mkdir(parents=True, exist_ok=True)
for aid, parts in SUBJECTS.items():
    src, msk = OUT / "models_raw" / f"{aid}.source.png", OUT / "models_raw" / f"{aid}.mask.png"
    s_px = pixels(src, msk)
    sprites = [OUT / "sprites" / aid / f"{aid}_{p}_d0.png" for p in parts]
    n_px = np.concatenate([pixels(p) for p in sprites])
    row = {"source_mean": s_px.mean(0).round(1).tolist(), "new_mean": n_px.mean(0).round(1).tolist(),
           "delta_e_mean": round(float(np.linalg.norm(lab(s_px.mean(0)[None]) - lab(n_px.mean(0)[None]))), 2)}
    row["source_palette"], row["source_share"] = palette(s_px)
    row["new_palette"], row["new_share"] = palette(n_px)
    shows = [src] + sprites[:1]
    if aid == "rocket" and POC.exists():
        p_px = pixels(POC)
        row["poc_mean"] = p_px.mean(0).round(1).tolist()
        row["poc_delta_e_mean"] = round(float(np.linalg.norm(lab(s_px.mean(0)[None]) - lab(p_px.mean(0)[None]))), 2)
        row["poc_palette"], row["poc_share"] = palette(p_px)
        shows.append(POC)
    panel(shows, 300).save(REVIEW / "img" / f"colour-{aid}.jpg", quality=90)
    report[aid] = row
    print(aid, "dE(mean) new", row["delta_e_mean"], "poc", row.get("poc_delta_e_mean"))
(REVIEW / "colour.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
