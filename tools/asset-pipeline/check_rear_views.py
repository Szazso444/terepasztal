"""Checks generated second images (rear views, trucks) before the pipeline uses them.

python tools/asset-pipeline/check_rear_views.py [id ...]          every rear view and truck image in place
python tools/asset-pipeline/check_rear_views.py <id> <file.png>     one attempt, before it goes in place
python tools/asset-pipeline/check_rear_views.py <id> <file.png> --truck
Reads assets/source/base-v1/rear-view-prompts.json, checks images against the studio image they were made from,
prints PASS / WARN / FAIL with reasons and exits 1 when anything fails. Checking images in place also records the
verdicts in assets/source/base-v1/rear-view-check.json. Needs numpy and Pillow only.

What the pipeline needs: the whole vehicle on a transparent background (its outline is how the camera is found),
the same size and framing as the studio image, and a real turned-round view, not the studio image redrawn or flipped.
The rest (right end facing the viewer, wheel count, livery) needs eyes: see
assets/source/base-v1/REAR-VIEWS.md.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "assets" / "source" / "base-v1"


def load(path):
    im = Image.open(path)
    return im.mode, np.asarray(im.convert("RGBA")).astype(np.float64)


def axis_slope(alpha):
    """Covariance of the opaque pixels' x and y, normalised: > 0 when the long axis runs upper-left to lower-right."""
    ys, xs = np.nonzero(alpha > 128)
    if len(xs) < 50:
        return 0.0, 0.0
    c = np.cov(np.stack([xs, ys]))
    w = np.linalg.eigvalsh(c)
    return c[0, 1] / np.sqrt(c[0, 0] * c[1, 1]), float(w[-1] / max(w[0], 1e-9))


def crop_to(img, alpha, size=256):
    """The opaque part, scaled to fit size x size, for comparing two images of one vehicle."""
    ys, xs = np.nonzero(alpha > 128)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    im = Image.fromarray(img.astype(np.uint8)).crop(box).resize((size, size), Image.BILINEAR)
    return np.asarray(im).astype(np.float64)


def check(new_path, ref_path, kind):
    fails, warns = [], []
    mode, img = load(new_path)
    _, ref = load(ref_path)
    a = img[..., 3]
    if img.shape[:2] != ref.shape[:2]:
        fails.append(f"size {img.shape[1]}x{img.shape[0]}, the studio image is {ref.shape[1]}x{ref.shape[0]}")
    if mode not in ("RGBA", "LA", "PA") or a.min() > 0:
        fails.append("no transparency: needs a real RGBA PNG with a transparent background")
        return fails, warns
    border = np.concatenate([a[:3].ravel(), a[-3:].ravel(), a[:, :3].ravel(), a[:, -3:].ravel()])
    if (border > 16).mean() > 0.002:
        fails.append("opaque pixels on the image border: background not transparent, or the vehicle is cropped")
    if (a < 8).mean() < 0.3:
        fails.append(f"only {(a < 8).mean():.0%} of the image is transparent: a backdrop or a far too large vehicle")
    ys, xs = np.nonzero(a > 128)
    if len(xs) == 0:
        fails.append("empty image")
        return fails, warns
    h, w = a.shape
    margin = min(xs.min() / w, ys.min() / h, 1 - (xs.max() + 1) / w, 1 - (ys.max() + 1) / h)
    if margin < 0.01:
        fails.append("the vehicle touches the edge of the image (cropped)")
    elif margin < 0.04:
        warns.append(f"tight margin ({margin:.1%}); the studio images keep about 12%")
    soft = ((a > 16) & (a < 240)).sum() / max(1, (a > 16).sum())
    if soft > 0.06:
        warns.append(f"{soft:.0%} of the vehicle is half-transparent: a soft shadow, glow or smoke?")
    if kind == "rear":
        ra = ref[..., 3]
        s_new, k_new = axis_slope(a)
        s_ref, _ = axis_slope(ra)
        if k_new > 2.5 and s_new * s_ref < 0:
            fails.append("the long axis runs the other way: the studio image flipped, not the vehicle turned round")
        area = (a > 128).sum() / max(1, (ra > 128).sum())
        if not 0.6 <= area <= 1.6:
            warns.append(f"the vehicle covers {area:.0%} of the studio image's area: a different size in the frame")
        cn, cr = crop_to(img, a), crop_to(ref, ra)
        both = (cn[..., 3] > 128) & (cr[..., 3] > 128)
        diff = float(np.abs(cn[..., :3] - cr[..., :3])[both].mean()) if both.any() else 255.0
        if diff < 6:
            fails.append("nearly identical to the studio image: redrawn, not turned round")
        cf = crop_to(np.ascontiguousarray(ref[:, ::-1]), np.ascontiguousarray(ra[:, ::-1]))
        both_f = (cn[..., 3] > 128) & (cf[..., 3] > 128)
        if both_f.any() and float(np.abs(cn[..., :3] - cf[..., :3])[both_f].mean()) < 6:
            fails.append("nearly identical to the studio image mirrored")
    return fails, warns


def main():
    rows = json.loads((BASE / "rear-view-prompts.json").read_text(encoding="utf-8"))
    args = [a for a in sys.argv[1:] if a != "--truck"]
    if len(args) == 2 and args[1].lower().endswith(".png"):
        row = next((r for r in rows if r["id"] == args[0]), None)
        if row is None:
            sys.exit(f"unknown id {args[0]}")
        kind = "truck" if "--truck" in sys.argv else "rear"
        fails, warns = check(Path(args[1]), ROOT / row["attach"], kind)
        verdict = "FAIL" if fails else "WARN" if warns else "PASS"
        print(f"{verdict:4} {args[1]}" + "".join(f"\n     - {m}" for m in fails + warns))
        sys.exit(1 if fails else 0)
    want = set(args)
    report, bad = {}, False
    for r in rows:
        if want and r["id"] not in want:
            continue
        items = [("rear", r["save_as"])] + [("truck", t["save_as"]) for t in r.get("trucks", [])]
        for kind, rel in items:
            path = ROOT / rel
            if not path.exists():
                if want and kind == "rear":
                    print(f"MISSING {rel}")
                    bad = True
                continue
            fails, warns = check(path, ROOT / r["attach"], kind)
            verdict = "FAIL" if fails else "WARN" if warns else "PASS"
            bad |= bool(fails)
            report[rel] = {"id": r["id"], "kind": kind, "verdict": verdict, "fail": fails, "warn": warns}
            print(f"{verdict:4} {rel}" + "".join(f"\n     - {m}" for m in fails + warns))
    if report:
        out = BASE / "rear-view-check.json"
        old = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
        old.update(report)
        out.write_text(json.dumps(old, indent=1) + "\n", encoding="utf-8")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
