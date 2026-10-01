"""Video stage: a turntable video of a vehicle -> the game's drawn facings, in the video's own painted style.

The video (flat background, camera about 30 degrees above, one full turn of the vehicle) supplies every
pixel. A box model of the vehicle is only a protractor: its silhouettes at the game's 48 facings, projected
with the game camera, are matched against each frame's silhouette to find the frame's heading. The model
comes from the asset's length_m/width_m/height_m (assets.csv) and the most side-on frame of the video,
which gives its profile along the length; the video-to-sprite scale S is searched around the side view's
own estimate. Every drawn facing then takes its best frame, cut out of the background, scaled by S and
placed so its silhouette centre sits on the model's: one canvas and one anchor for all of them.

Python: numpy, pillow, opencv-python-headless, scipy. No Blender.
"""
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

import game_rules
from postprocess import checker, downsample


class VideoError(RuntimeError):
    pass


# ---------------- frames and silhouettes ----------------
def read_frames(path, stride=1):
    """RGB uint8 frames of a video, every `stride`-th."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise VideoError(f"cannot open video {path}")
    frames, i = [], 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        if i % stride == 0:
            frames.append(np.ascontiguousarray(bgr[..., ::-1]))
        i += 1
    cap.release()
    if not frames:
        raise VideoError(f"no frames in {path}")
    return frames


def border(im, px=12):
    return np.concatenate([im[:px].reshape(-1, 3), im[-px:].reshape(-1, 3),
                           im[:, :px].reshape(-1, 3), im[:, -px:].reshape(-1, 3)])


def background(im, px=12):
    """The flat background: the median colour of the frame's border."""
    return np.median(border(im, px).astype(np.float32), axis=0)


def silhouette(im, bg, threshold):
    """The vehicle: pixels further than `threshold` (RGB distance) from the background, the largest
    connected piece, holes filled."""
    m = np.sqrt(((im.astype(np.float32) - bg) ** 2).sum(-1)) > threshold
    m = ndi.binary_opening(m, iterations=1)
    lab, n = ndi.label(m)
    if n == 0:
        return m
    sizes = ndi.sum(m, lab, range(1, n + 1))
    m = lab == (1 + int(np.argmax(sizes)))
    return ndi.binary_fill_holes(ndi.binary_closing(m, iterations=2))


def bbox(m):
    ys, xs = np.nonzero(m)
    if not len(xs):
        raise VideoError("empty silhouette")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


# ---------------- the game camera, in numpy ----------------
def camera_axes(elevation_deg, azimuth_deg):
    """Screen right and screen up as world vectors for the game's orthographic camera (Blender rotation
    (90 - elevation, 0, azimuth)): world +X projects to screen lower right, +Y upper right."""
    tx, tz = math.radians(90.0 - elevation_deg), math.radians(azimuth_deg)
    right = np.array([math.cos(tz), math.sin(tz), 0.0])
    up = np.array([-math.sin(tz) * math.cos(tx), math.cos(tz) * math.cos(tx), math.sin(tx)])
    return right, up


def project(points, yaw_deg, grid, scale=1.0):
    """World points (N, 3, metres) turned by yaw about Z -> screen px (x right, y down) about the origin."""
    right, up = camera_axes(grid["elevation_deg"], grid["azimuth_deg"])
    c, s = math.cos(math.radians(yaw_deg)), math.sin(math.radians(yaw_deg))
    p = points @ np.array([[c, s, 0.0], [-s, c, 0.0], [0.0, 0.0, 1.0]])
    ppm = px_per_m(grid) * scale
    return np.stack([p @ right * ppm, -(p @ up) * ppm], axis=1)


def px_per_m(grid):
    return grid["tile_px"] / (grid["tile_m"] * math.sqrt(2))


# ---------------- the box model ----------------
def side_view(masks):
    """Index of the most side-on frame: the one whose silhouette is widest for its height."""
    ratios = []
    for m in masks:
        x0, y0, x1, y1 = bbox(m)
        ratios.append((x1 - x0) / max(1, y1 - y0))
    return int(np.argmax(ratios))


def box_model(side_mask, a, slot_m, grid, bins):
    """Boxes [(x0, x1, z0, z1)] in metres (x along the vehicle from its centre, z up from the rail) and the
    full width, from the side view's profile and the asset's dimensions.

    The side view is taken as the length scale: its silhouette width is the slot length. A column of it
    spans the body's height (times cos elevation) plus its width (times sin elevation, the roof seen from
    above), so the height at each column is what is left once the roof band is taken off.
    """
    x0, y0, x1, y1 = bbox(side_mask)
    m_per_px = slot_m / (x1 - x0)
    k = slot_m / a["length_m"]  # the video and the sprite keep the prototype's proportions: one scale
    width = a["width_m"] * k
    el = math.radians(grid["elevation_deg"])
    rail = y1  # the near rail: the silhouette's lowest pixel
    edges = np.linspace(x0, x1, bins + 1).round().astype(int)
    boxes, tops = [], []
    for c0, c1 in zip(edges, edges[1:]):
        cols = side_mask[:, c0:max(c1, c0 + 1)]
        rows = np.nonzero(cols.any(1))[0]
        if not len(rows):
            continue
        top_up = (rail - rows.min()) * m_per_px
        bot_up = (rail - rows.max() - 1) * m_per_px
        z1 = max((top_up - width * math.sin(el)) / math.cos(el), 0.05)
        z0 = min(max(bot_up / math.cos(el), 0.0), z1 - 0.05)
        xa, xb = (c0 - (x0 + x1) / 2) * m_per_px, (c1 - (x0 + x1) / 2) * m_per_px
        boxes.append((xa, xb, z0, z1))
        tops.append(z1)
    height = max(tops)
    return {"boxes": boxes, "width_m": width, "height_m": height, "m_per_px": m_per_px,
            "scale_vs_prototype": k}


def box_corners(model):
    hw = model["width_m"] / 2
    pts = []
    for xa, xb, z0, z1 in model["boxes"]:
        for x in (xa, xb):
            for y in (-hw, hw):
                for z in (z0, z1):
                    pts.append((x, y, z))
    return np.array(pts).reshape(-1, 8, 3)


def model_silhouettes(model, grid, ss):
    """Binary silhouettes of the model at all 48 facings, at ss px per game px, each with the pixel of the
    world origin (the anchor) on its canvas."""
    corners = box_corners(model)
    out = []
    for f in range(game_rules.FACINGS):
        yaw = -360.0 * f / game_rules.FACINGS
        scr = project(corners.reshape(-1, 3), yaw, grid, ss).reshape(-1, 8, 2)
        lo, hi = np.floor(scr.reshape(-1, 2).min(0)) - 2, np.ceil(scr.reshape(-1, 2).max(0)) + 2
        w, h = int(hi[0] - lo[0]), int(hi[1] - lo[1])
        m = np.zeros((h, w), np.uint8)
        for quad in scr:
            hull = cv2.convexHull((quad - lo).round().astype(np.int32))
            cv2.fillConvexPoly(m, hull, 1)
        out.append({"mask": m.astype(bool), "origin": -lo})
    return out


# ---------------- matching ----------------
def crop(m):
    x0, y0, x1, y1 = bbox(m)
    return m[y0:y1, x0:x1]


def scaled(m, s):
    """A cropped silhouette scaled by s."""
    h, w = m.shape
    return cv2.resize(m.astype(np.uint8), (max(1, round(w * s)), max(1, round(h * s))),
                      interpolation=cv2.INTER_AREA) > 0


def iou_centred(a, b):
    """IoU of two cropped silhouettes laid over each other by their bounding-box centres."""
    H, W = max(a.shape[0], b.shape[0]), max(a.shape[1], b.shape[1])
    pa = np.zeros((H, W), bool)
    pb = np.zeros((H, W), bool)
    ya, xa = (H - a.shape[0]) // 2, (W - a.shape[1]) // 2
    yb, xb = (H - b.shape[0]) // 2, (W - b.shape[1]) // 2
    pa[ya:ya + a.shape[0], xa:xa + a.shape[1]] = a
    pb[yb:yb + b.shape[0], xb:xb + b.shape[1]] = b
    u = (pa | pb).sum()
    return float((pa & pb).sum() / u) if u else 0.0


def scores(crops, sils, s, mirror):
    """[frame, mirrored, facing] IoU of every frame against every model facing at video-to-canvas scale s."""
    sc = [crop(x["mask"]) for x in sils]
    out = np.zeros((len(crops), 2, len(sils)))
    for i, c in enumerate(crops):
        for fl in ((0, 1) if mirror else (0,)):
            v = scaled(c[:, ::-1] if fl else c, s)
            for f, m in enumerate(sc):
                out[i, fl, f] = iou_centred(v, m)
    return out


def search_scale(crops, sils, s0, vcfg):
    """The video-to-canvas scale with the best mean match, as factors of the side view's estimate s0."""
    lo, hi, step = vcfg["scale_search"]
    sub = crops[:: max(1, int(vcfg["scale_stride"]))]
    tried = []
    for f in np.arange(lo, hi + 1e-9, step):
        sc = scores(sub, sils, s0 * f, vcfg["mirror"])
        tried.append((float(sc.max(axis=(1, 2)).mean()), round(float(f), 4)))
    best = max(tried)
    return s0 * best[1], best[0], tried


def fit_turn(sc0, max_step=1, jump_penalty=2.0):
    """The vehicle's model facing in every frame, as one turn that never reverses: the path through the
    frames' match scores (Viterbi) that scores best when each frame moves 0..max_step facings, always the
    same way. A single frame cannot tell a box's two ends apart (its silhouette is nearly the same turned
    180 degrees); the path can, because it pays `jump_penalty` (in IoU summed over frames) to jump half a
    turn. A generated video does that now and then: the vehicle swaps ends between two frames. Such a jump
    is taken only when the frames after it keep agreeing, and is reported. The turn need not be steady.
    sc0: [frame, facing] scores of the unmirrored frames."""
    n, F = sc0.shape
    best = None
    for d in (1, -1):
        moves = [(d * k, 0.0) for k in range(max_step + 1)] + [(d * k + F // 2, jump_penalty) for k in range(max_step + 1)]
        acc = sc0[0].copy()
        back = np.zeros((n, F), np.int64)
        for i in range(1, n):
            cand = np.stack([np.roll(acc, s) - p for s, p in moves])  # arriving at f from f - s
            back[i] = cand.argmax(0)
            acc = cand.max(0) + sc0[i]
        f = int(acc.argmax())
        path, jumps = [f], []
        for i in range(n - 1, 0, -1):
            s, p = moves[int(back[i, f])]
            if p:
                jumps.append(i)
            f = (f - s) % F
            path.append(f)
        path = np.array(path[::-1])
        total = float(acc.max())
        if best is None or total > best[0]:
            steps = ((np.diff(path) * d) % F) % (F // 2) if jumps else (np.diff(path) * d) % F
            best = (total, path, d, int(steps.sum()), sorted(jumps))
    total, path, d, steps, jumps = best
    score = float(sc0[np.arange(n), path].mean())
    return {"path": path, "direction": d, "mean_iou": score, "turns": steps / F, "h0": float(path[0]),
            "jumps": jumps}


def facing_offset(h0, start_facing):
    """0 or 24: whether the side view showed the nose on the left. The video's first frame is the input
    image, whose heading is `start_facing`; the model was built with the side view's right end as +X."""
    F = game_rules.FACINGS
    d = (round(h0) - start_facing) % F
    return 0 if min(d, F - d) <= F // 4 else F // 2


def pick_frames(turn, sc, offset, mirror):
    """Each drawn facing's frame: of the frames the turn puts at that facing, the best match; with none
    there, the nearest. A mirrored frame stands for the mirrored heading (body.ts mirrorFacing: 12 - f).
    -> {facing: (frame, mirrored, iou, heading error in degrees)}."""
    F = game_rules.FACINGS
    h = (turn["path"] + offset) % F  # real facings
    cands = [(h, 0)] + ([((F // 4 - h) % F, 1)] if mirror else [])
    picks = {}
    for f in game_rules.drawn_facings():
        best = None
        for hh, fl in cands:
            err = np.abs((hh - f + F // 2) % F - F // 2)
            for i in np.nonzero(err == err.min())[0]:
                key = (int(err[i]), -sc[i, fl, (f - offset) % F])  # nearest, then best match
                if best is None or key < best[0]:
                    best = (key, int(i), fl, float(sc[i, fl, (f - offset) % F]), float(err[i]) * 360 / F)
        picks[f] = best[1:]
    return picks


# ---------------- checks (before any sprite is built) ----------------
def check_video(frames, masks, sc, turn, picks, vcfg):
    """Warnings for a video the sprites cannot trust: a background that does not key, a vehicle that
    leaves the frame, a camera whose elevation or scale drifts, headings the turn never reaches."""
    warn, info = [], {}
    bgs = np.array([background(f) for f in frames])
    spread = float(np.abs(bgs - np.median(bgs, 0)).max())
    noise = float(np.median([border(f).astype(np.float32).std(0).max() for f in frames[:: max(1, len(frames) // 12)]]))
    info.update(background=np.median(bgs, 0).round().tolist(), background_drift=round(spread, 1),
                background_noise=round(noise, 1))
    if spread > vcfg["check"]["max_background_drift"] or noise > vcfg["check"]["max_background_noise"]:
        warn.append(f"background does not key cleanly: drift {spread:.0f}, noise {noise:.0f} (RGB)")
    edge = [i for i, m in enumerate(masks) if m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any()]
    info["frames_touching_edge"] = len(edge)
    if edge:
        warn.append(f"vehicle touches the frame edge in {len(edge)} frames (first {edge[0]}): not all of it is seen")
    # scale and elevation: each frame's silhouette against the model at its fitted heading, along and
    # across the screen; a camera that dollies changes both, one that rises or sinks changes their ratio
    F = game_rules.FACINGS
    fitted = turn["path"]
    hs, vs = [], []
    for i, m in enumerate(masks):
        x0, y0, x1, y1 = bbox(m)
        hs.append(vcfg["_sil_wh"][fitted[i]][0] / (x1 - x0))
        vs.append(vcfg["_sil_wh"][fitted[i]][1] / (y1 - y0))
    hs, vs = np.array(hs), np.array(vs)
    scale_cv = float(hs.std() / hs.mean())
    elev_cv = float((vs / hs).std() / (vs / hs).mean())
    info.update(scale_spread=round(scale_cv, 3), elevation_spread=round(elev_cv, 3))
    if scale_cv > vcfg["check"]["max_scale_spread"]:
        warn.append(f"scale not constant: frame-to-model size varies {scale_cv:.0%} (camera dollies or zooms)")
    if elev_cv > vcfg["check"]["max_elevation_spread"]:
        warn.append(f"elevation not constant: height-to-width ratio varies {elev_cv:.0%}")
    # headings: one full turn, steady enough that the frames follow the fitted line, every facing reached
    on_line = float(np.mean(sc[np.arange(len(frames)), 0, fitted] >= 0.9 * sc[:, 0].max(1)))
    info.update(turns=round(turn["turns"], 3), fit_iou=round(turn["mean_iou"], 3), frames_on_fit=round(on_line, 3),
                direction=turn["direction"])
    info["half_turn_jumps"] = turn["jumps"]
    if turn["jumps"]:
        warn.append(f"the vehicle swaps ends between frames at {turn['jumps']}: the video is not one continuous "
                    f"turn there (the frames are still used at the headings they show)")
    if turn["turns"] < vcfg["check"]["min_turns"]:
        warn.append(f"the vehicle turns {turn['turns']:.2f} times: some headings are never seen")
    if on_line < vcfg["check"]["min_frames_on_fit"]:
        warn.append(f"only {on_line:.0%} of frames match well where the turn puts them: the rotation jumps or reverses")
    gaps = [f for f, p in picks.items() if p[3] > vcfg["check"]["max_heading_error_deg"]]
    weak = [f for f, p in picks.items() if p[2] < vcfg["min_iou"]]
    info.update(far_facings=gaps, weak_facings=weak)
    if gaps:
        warn.append(f"no frame within {vcfg['check']['max_heading_error_deg']} deg of facings {gaps}")
    if weak:
        warn.append(f"drawn facings matched below IoU {vcfg['min_iou']}: {weak}")
    return warn, info


# ---------------- sprites ----------------
def cut_out(im, m, vcfg):
    """Premultiplied RGBA float of the vehicle, cropped to its silhouette. Alpha ramps with the colour
    distance from the background across `key_soft` (an anti-aliased edge is part background), stays
    opaque inside the silhouette, and the background's share is taken back out of every edge pixel
    (F = (C - (1 - a) K) / a), so no magenta fringe survives the downscale."""
    lo, hi = vcfg["key_soft"]
    inner = int(vcfg["erode_px"])
    bg = background(im)
    x0, y0, x1, y1 = bbox(m)
    x0, y0 = max(0, x0 - 2), max(0, y0 - 2)
    x1, y1 = min(m.shape[1], x1 + 2), min(m.shape[0], y1 + 2)
    c = im[y0:y1, x0:x1].astype(np.float32)
    mm = m[y0:y1, x0:x1]
    d = np.sqrt(((c - bg) ** 2).sum(-1))
    a = np.clip((d - lo) / (hi - lo), 0.0, 1.0)
    a = np.maximum(a, ndi.binary_erosion(mm, iterations=inner + 1))  # dark paint near the key colour stays
    a = a * ndi.binary_dilation(mm, iterations=1)  # nothing outside the vehicle
    fg = (c - (1 - a[..., None]) * bg) / np.maximum(a[..., None], 1e-3)
    return np.dstack([np.clip(fg, 0, 255) * a[..., None], a * 255])


def build_sprites(a, frames, masks, picks, s, sils, ss, vcfg):
    """Each drawn facing's frame, scaled by s (video px -> canvas px at ss) and placed with its silhouette
    centre on the model's. One canvas and one anchor for every facing, with margin_px of empty border."""
    placed = {}
    for f, (i, fl, *_) in picks.items():
        im, m = frames[i], masks[i]
        if fl:
            im, m = im[:, ::-1], m[:, ::-1]
        rgba = cut_out(im, m, vcfg)
        h, w = rgba.shape[:2]
        w2, h2 = max(1, round(w * s)), max(1, round(h * s))
        rgba = cv2.resize(rgba, (w2, h2), interpolation=cv2.INTER_AREA)
        sil = sils[f]
        x0, y0, x1, y1 = bbox(sil["mask"])
        cx, cy = (x0 + x1) / 2 - sil["origin"][0], (y0 + y1) / 2 - sil["origin"][1]  # from the anchor
        placed[f] = (rgba, round(cx - w2 / 2), round(cy - h2 / 2))
    # the common canvas: the union of every placed frame round the anchor, plus a margin, whole game px
    mg = int(vcfg["margin_px"]) * ss
    left = min(ox for _, ox, _ in placed.values()) - mg
    top = min(oy for _, _, oy in placed.values()) - mg
    right = max(ox + r.shape[1] for r, ox, _ in placed.values()) + mg
    bottom = max(oy + r.shape[0] for r, _, oy in placed.values()) + mg
    left, top = -ss * math.ceil(-left / ss), -ss * math.ceil(-top / ss)
    W, H = ss * math.ceil((right - left) / ss), ss * math.ceil((bottom - top) / ss)
    out = {}
    for f, (rgba, ox, oy) in placed.items():
        c = np.zeros((H, W, 4), np.float32)
        x, y = ox - left, oy - top
        c[y:y + rgba.shape[0], x:x + rgba.shape[1]] = rgba
        al = c[..., 3:4] / 255
        rgb = np.where(al > 1e-3, c[..., :3] / np.maximum(al, 1e-3), 0)
        big = Image.fromarray(np.dstack([rgb.clip(0, 255), c[..., 3:4]]).round().astype(np.uint8), "RGBA")
        out[f] = downsample(big, ss)
    anchor = [-left // ss, -top // ss]  # left and top are whole game px
    return out, anchor, [W // ss, H // ss]


def screen_heading(f, grid):
    yaw = -360.0 * f / game_rules.FACINGS
    v = project(np.array([[1.0, 0, 0]]), yaw, grid)[0]
    return (v / np.linalg.norm(v)).round(4).tolist()


def analyse(a, video_path, grid, vcfg, log=print):
    """Everything up to the sprites: silhouettes, box model, scale, the turn, each drawn facing's frame and the
    video checks. The orbit stage runs this alone to vet a fresh video. Returns the state the build needs."""
    aid = a["id"]
    if a["category"] != "vehicle":
        raise VideoError("the video route is for vehicles")
    if (a.get("plan") or "rigid") != "rigid":
        raise VideoError(f"plan {a['plan']}: a video shows one rigid body; cut vehicles take the 3D route")
    if not a.get("size_tiles"):
        raise VideoError("the video route needs size_tiles (the body's length in tiles)")
    if not a.get("width_m"):
        raise VideoError("the video route needs width_m: the box model's width comes from it")
    slot = a["size_tiles"] * grid["tile_m"] - vcfg["coupler_gap_m"]
    k = slot / a["length_m"]
    if not vcfg["compress_range"][0] <= k <= vcfg["compress_range"][1]:
        raise VideoError(f"length factor {k:.2f} outside {vcfg['compress_range']} ({a['length_m']} m into "
                         f"{a['size_tiles']} tiles)")
    frames = read_frames(video_path)
    bg = background(frames[0])
    masks = [silhouette(f, background(f), vcfg["bg_threshold"]) for f in frames]
    side = side_view(masks)
    model = box_model(masks[side], a, slot, grid, int(vcfg["profile_bins"]))
    warnings = []
    if a.get("height_m"):
        err = model["height_m"] / (a["height_m"] * k) - 1
        if abs(err) > vcfg["max_dim_error"]:
            warnings.append(f"height: the video's {model['height_m'] / k:.2f} m (side view) vs height_m "
                            f"{a['height_m']} m ({err:+.0%})")
    mss = int(vcfg["match_supersample"])
    sils = model_silhouettes(model, grid, mss)
    crops = [crop(m) for m in masks]
    x0, _, x1, _ = bbox(masks[side])
    s0 = slot * px_per_m(grid) * mss / (x1 - x0)
    s, mean_iou, tried = search_scale(crops, sils, s0, vcfg)
    log(f"[video] {aid}: {len(frames)} frames, side view frame {side}, scale {s / mss:.4f} canvas px per video px "
        f"({s / s0:.3f} x the side view's), mean best IoU {mean_iou:.3f}")
    sc = scores(crops, sils, s, vcfg["mirror"])
    turn = fit_turn(sc[:, 0], int(vcfg["max_step"]), float(vcfg["jump_penalty"]))
    offset = facing_offset(turn["h0"], int(vcfg["start_facing"]))
    log(f"[video] {aid}: {turn['turns']:.2f} turns ({'+' if turn['direction'] > 0 else '-'}), mean IoU along the "
        f"turn {turn['mean_iou']:.3f}, first frame at model facing {turn['h0']:.0f}"
        + (f"; the side view showed the nose on the left, facings turned by {offset}" if offset else ""))
    picks = pick_frames(turn, sc, offset, vcfg["mirror"])
    vcfg = dict(vcfg, _sil_wh=[(lambda b: ((b[2] - b[0]) / s, (b[3] - b[1]) / s))(bbox(x["mask"])) for x in sils])
    check_warn, check_info = check_video(frames, masks, sc, turn, picks, vcfg)
    warnings += check_warn
    return {"a": a, "video": str(video_path), "frames": frames, "masks": masks, "bg": bg, "side": side, "model": model,
            "slot": slot, "k": k, "mss": mss, "s": s, "s0": s0, "mean_iou": mean_iou, "tried": tried, "sc": sc,
            "turn": turn, "offset": offset, "picks": picks, "warnings": warnings, "check": check_info, "vcfg": vcfg}


def process_asset(a, video_path, grid, vcfg, dirs, log=print):
    """Video -> sprites/<id>/<id>_body_d<i>.png, atlas/<id>.png|json (the post stage's format, so the game
    stage exports it unchanged) and previews/<id>.png. Returns the atlas info."""
    st = analyse(a, video_path, grid, vcfg, log)
    aid, frames, masks, bg, side, model = a["id"], st["frames"], st["masks"], st["bg"], st["side"], st["model"]
    slot, k, mss, s, s0 = st["slot"], st["k"], st["mss"], st["s"], st["s0"]
    mean_iou, tried, turn, offset, picks = st["mean_iou"], st["tried"], st["turn"], st["offset"], st["picks"]
    warnings, check_info, vcfg = st["warnings"], st["check"], st["vcfg"]
    drawn = game_rules.drawn_facings()
    # build at the sprite supersample: the scale and the model silhouettes follow it
    ss = int(vcfg["supersample"])
    sils_ss = [dict(x, origin=x["origin"]) for x in model_silhouettes(model, grid, ss)]
    sils_ss = [sils_ss[(f - offset) % game_rules.FACINGS] for f in range(game_rules.FACINGS)]
    sprites, anchor, canvas = build_sprites(a, frames, masks, picks, s * ss / mss, sils_ss, ss, vcfg)

    sprite_dir = Path(dirs["sprites"]) / aid
    sprite_dir.mkdir(parents=True, exist_ok=True)
    W, H = canvas
    atlas = Image.new("RGBA", (W * len(drawn), H), (0, 0, 0, 0))
    frames_out = []
    for d, f in enumerate(drawn):
        file = sprite_dir / f"{aid}_body_d{d}.png"
        sprites[f].save(file)
        atlas.paste(sprites[f], (W * d, 0))
        i, fl, iou, err = picks[f]
        frames_out.append({"part": "body", "dir": d, "yaw_deg": -360.0 * f / game_rules.FACINGS, "facing": f,
                           "file": str(file), "x": W * d, "y": 0, "w": W, "h": H, "anchor_px": anchor,
                           "tiles": [a["size_tiles"], 1], "screen_heading": screen_heading(f, grid),
                           "video_frame": i, "mirrored": bool(fl), "iou": round(iou, 3),
                           "heading_error_deg": round(err, 2)})
    atlas_dir = Path(dirs["atlas"])
    atlas_dir.mkdir(parents=True, exist_ok=True)
    atlas.save(atlas_dir / f"{aid}.png")
    info = {"id": aid, "category": "vehicle", "plan": "rigid", "route": "video", "tiles": [a["size_tiles"], 1],
            "final_dims_m": [round(slot, 3), round(model["width_m"], 3), round(model["height_m"], 3)],
            "compression": [round(k, 4)] * 3, "video": str(video_path), "side_view_frame": side,
            "scale": round(s / mss, 5), "scale_vs_side_view": round(s / s0, 4), "mean_iou": round(mean_iou, 4),
            "scale_search": tried, "turn": {key: v for key, v in turn.items() if key != "path"},
            "facing_offset": offset, "check": check_info, "warnings": warnings,
            "background": bg.round().tolist(), "canvas_px": canvas, "anchor_px": anchor, "frames": frames_out}
    (atlas_dir / f"{aid}.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    preview(info, sprites, drawn, dirs, frames, masks)
    return info


def preview(info, sprites, drawn, dirs, frames, masks, cols=5, sc=3):
    """The drawn facings on a checkerboard with the anchor (red cross) and each one's frame and IoU."""
    W, H = info["canvas_px"]
    rows = math.ceil(len(drawn) / cols)
    sheet = checker(W * cols, H * rows)
    for d, f in enumerate(drawn):
        sheet.alpha_composite(sprites[f], ((d % cols) * W, (d // cols) * H))
    sheet = sheet.resize((sheet.width * sc, sheet.height * sc), Image.NEAREST)
    dr = ImageDraw.Draw(sheet)
    ax, ay = info["anchor_px"]
    for d, fr in enumerate(info["frames"]):
        ox, oy = (d % cols) * W * sc, (d // cols) * H * sc
        px, py = ox + ax * sc, oy + ay * sc
        dr.line([(px - 4, py), (px + 4, py)], fill=(255, 0, 80, 255))
        dr.line([(px, py - 4), (px, py + 4)], fill=(255, 0, 80, 255))
        dr.text((ox + 3, oy + 2), f"f{fr['facing']} <- {fr['video_frame']}{'m' if fr['mirrored'] else ''} "
                                  f"{fr['iou']:.2f}", fill=(255, 230, 0, 255))
    out = Path(dirs["previews"]) / f"{info['id']}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
