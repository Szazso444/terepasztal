"""Post stage: supersampled renders -> final sprites, per-asset atlas + JSON, preview sheets."""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def downsample(im: Image.Image, ss: int) -> Image.Image:
    """Premultiplied box filter, so transparent edges don't darken."""
    a = np.asarray(im.convert("RGBA"), dtype=np.float64) / 255.0
    if ss > 1:
        h, w = a.shape[0] // ss, a.shape[1] // ss
        a = a[:h * ss, :w * ss]
        rgb_p = a[..., :3] * a[..., 3:4]
        rgb_p = rgb_p.reshape(h, ss, w, ss, 3).mean((1, 3))
        alpha = a[..., 3].reshape(h, ss, w, ss).mean((1, 3))
        rgb = np.where(alpha[..., None] > 1e-6, rgb_p / np.maximum(alpha[..., None], 1e-6), 0)
        a = np.concatenate([rgb, alpha[..., None]], axis=2)
    return Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8), "RGBA")


def hard_alpha(im, threshold):
    a = np.asarray(im).copy()
    a[..., 3] = np.where(a[..., 3] >= threshold, 255, 0)
    return Image.fromarray(a, "RGBA")


def shared_palette(frames, colors):
    strip = Image.new("RGB", (sum(f.width for f in frames), max(f.height for f in frames)))
    x = 0
    for f in frames:
        strip.paste(f.convert("RGB"), (x, 0), f)
        x += f.width
    pal = strip.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    out = []
    for f in frames:
        q = f.convert("RGB").quantize(palette=pal, dither=Image.Dither.NONE).convert("RGBA")
        q.putalpha(f.getchannel("A"))
        out.append(q)
    return out


def checker(w, h, cell=8):
    yy, xx = np.mgrid[0:h, 0:w]
    v = np.where(((xx // cell) + (yy // cell)) % 2 == 0, 70, 90).astype(np.uint8)
    return Image.fromarray(np.stack([v, v, v, np.full_like(v, 255)], 2), "RGBA")


def process_asset(meta_path: Path, post_cfg: dict, dirs: dict):
    """One atlas row per sprite set (the whole asset, or each part of a cut vehicle)."""
    meta = json.loads(Path(meta_path).read_text(encoding="utf-8"))
    aid, ss = meta["id"], meta["supersample"]
    sets = []
    for rd in meta["renders"]:
        frames = [downsample(Image.open(d["file"]), ss) for d in rd["dirs"]]
        if post_cfg.get("alpha_hard_threshold"):
            frames = [hard_alpha(f, post_cfg["alpha_hard_threshold"]) for f in frames]
        sets.append((rd, frames))
    if post_cfg.get("palette_colors"):  # one palette across every part, so they match
        flat = shared_palette([f for _, fs in sets for f in fs], post_cfg["palette_colors"])
        it = iter(flat)
        sets = [(rd, [next(it) for _ in fs]) for rd, fs in sets]

    sprite_dir = Path(dirs["sprites"]) / aid
    sprite_dir.mkdir(parents=True, exist_ok=True)
    AW = max(rd["canvas_px"][0] * len(fs) for rd, fs in sets)
    AH = sum(rd["canvas_px"][1] for rd, _ in sets)
    atlas = Image.new("RGBA", (AW, AH), (0, 0, 0, 0))
    atlas_frames, y = [], 0
    for rd, frames in sets:
        W, H = rd["canvas_px"]
        stem = f"{aid}_{rd['part']}" if rd["part"] else aid
        for d, f in zip(rd["dirs"], frames):
            file = sprite_dir / f"{stem}_d{d['index']}.png"
            f.save(file)
            atlas.paste(f, (W * d["index"], y))
            atlas_frames.append({"part": rd["part"], "dir": d["index"], "yaw_deg": d["yaw_deg"],
                                 "facing": d.get("facing"), "file": str(file),
                                 "x": W * d["index"], "y": y, "w": W, "h": H, "anchor_px": rd["anchor_px"],
                                 "tiles": d["tiles"], "screen_heading": d["screen_heading"],
                                 "footprint_px": d["footprint_px"]})
        y += H
    atlas_dir = Path(dirs["atlas"])
    atlas_dir.mkdir(parents=True, exist_ok=True)
    atlas.save(atlas_dir / f"{aid}.png")
    info = {k: meta.get(k) for k in ("id", "category", "plan", "tiles", "footprint_m", "final_dims_m",
                                     "real_dims_m", "compression", "split", "px_per_m", "align", "warnings")}
    info["parts"] = [{k: rd[k] for k in ("part", "tiles", "compression", "final_dims_m", "canvas_px", "anchor_px")}
                     for rd, _ in sets]
    info["frames"] = atlas_frames
    (atlas_dir / f"{aid}.json").write_text(json.dumps(info, indent=2), encoding="utf-8")

    # preview: every direction of every part on a checkerboard with footprint + anchor, then debug views
    sc = int(post_cfg.get("preview_scale", 2))
    row = checker(AW, AH)
    row.alpha_composite(atlas)
    draw = ImageDraw.Draw(row)
    for fr in atlas_frames:
        poly = [(fr["x"] + x, fr["y"] + y) for x, y in fr["footprint_px"]]
        draw.line(poly + [poly[0]], fill=(255, 220, 0, 255), width=1)
        axp, ayp = fr["x"] + fr["anchor_px"][0], fr["y"] + fr["anchor_px"][1]
        draw.line([(axp - 3, ayp), (axp + 3, ayp)], fill=(255, 0, 80, 255))
        draw.line([(axp, ayp - 3), (axp, ayp + 3)], fill=(255, 0, 80, 255))
    row = row.resize((row.width * sc, row.height * sc), Image.NEAREST)
    parts = [row]
    dbg = [Image.open(p).convert("RGBA") for p in (meta.get("debug") or {}).values() if Path(p).exists()]
    if dbg:
        dh = max(i.height for i in dbg)
        drow = Image.new("RGBA", (sum(i.width for i in dbg), dh), (45, 45, 45, 255))
        x = 0
        for i in dbg:
            drow.alpha_composite(i, (x, 0))
            x += i.width
        parts.append(drow)
    sheet = Image.new("RGBA", (max(p.width for p in parts), sum(p.height for p in parts)), (30, 30, 30, 255))
    y = 0
    for p in parts:
        sheet.alpha_composite(p, (0, y))
        y += p.height
    prev_dir = Path(dirs["previews"])
    prev_dir.mkdir(parents=True, exist_ok=True)
    sheet.save(prev_dir / f"{aid}.png")
    return info
