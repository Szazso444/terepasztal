"""Put the source image's own colours back on a Pixal3D mesh. Runs inside Blender (bpy + numpy).

A Pixal3D mesh is pixel-aligned with the image it was conditioned on: it sits in that image's
camera frame (camera at -Y looking +Y, +Z up, the object inside a unit cube, a perspective camera
with the horizontal field of view MoGe estimated; comfy/ldm/trellis2/model.py,
_project_points_to_image). The generated texture drifts from the source (the Rocket's yellow went
olive), so every texel the source camera sees takes the source's colour, and the texels it cannot see
keep the generated colour mapped through a colour transfer fitted on the visible ones.
"""
import math
from pathlib import Path

import bpy
import numpy as np


def log(*a):
    print("[blender]", *a, flush=True)


# ---------------- camera ----------------
def project(P, fov_deg, res):
    """Pixel coords (u right, v down, pixel i covers [i, i+1)) and depth of raw-frame points."""
    t = math.tan(math.radians(fov_deg) / 2)
    depth = P[:, 1] + 0.5 / t
    f = res / (2 * t)
    return f * P[:, 0] / depth + res / 2, -f * P[:, 2] / depth + res / 2, depth


def camera_position(fov_deg):
    return np.array([0.0, -0.5 / math.tan(math.radians(fov_deg) / 2), 0.0])


def splat(P, fov, res):
    u, v, d = project(P, fov, res)
    x, y = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)
    ok = (x >= 0) & (x < res) & (y >= 0) & (y < res) & (d > 0)
    return x[ok], y[ok], d[ok]


def fit_fov(P, mask):
    """Field of view whose projection of the surface points best covers the source mask (IoU)."""
    res = mask.shape[0]

    def iou(fov):
        x, y, _ = splat(P, fov, res)
        img = np.zeros_like(mask)
        img[y, x] = True
        img = erode(dilate(img, 1), 1)  # close the gaps between samples
        return (img & mask).sum() / max(1, (img | mask).sum())

    grid = np.arange(2.0, 60.0, 2.0)
    scores = [iou(f) for f in grid]
    lo, hi = max(1.0, grid[int(np.argmax(scores))] - 2), grid[int(np.argmax(scores))] + 2
    for _ in range(18):  # golden section on the bracket
        a, b = hi - (hi - lo) / 1.618, lo + (hi - lo) / 1.618
        if iou(a) > iou(b):
            hi = b
        else:
            lo = a
    fov = (lo + hi) / 2
    return fov, iou(fov)


def zbuffer(P, fov, res):
    """Nearest depth per source pixel. A pixel no sample landed on takes its nearest neighbours'
    depth: left empty it would let a hidden texel behind it pass as seen."""
    x, y, d = splat(P, fov, res)
    z = np.full(res * res, np.inf)
    np.minimum.at(z, y * res + x, d)
    z = z.reshape(res, res)
    for _ in range(3):
        hole = ~np.isfinite(z)
        if not hole.any():
            break
        pad = np.pad(z, 1, constant_values=np.inf)
        near = np.min([pad[1 + dy:1 + dy + res, 1 + dx:1 + dx + res]
                       for dy in (-1, 0, 1) for dx in (-1, 0, 1)], axis=0)
        z = np.where(hole, near, z)
    return z


# ---------------- images ----------------
def load_rgba(path):
    """Image file -> float array (H, W, 4), row 0 at the top, values as stored (sRGB for PNG)."""
    im = bpy.data.images.load(str(path), check_existing=False)
    im.colorspace_settings.name = "Non-Color"  # read the stored values, no conversion
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[::-1].copy()


def image_array(im):
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(h, w, 4)  # Blender order: row 0 at the bottom, like the UVs


def dilate(m, r):
    return ~erode(~m, r)


def erode(m, r):
    out = m.copy()
    for _ in range(r):
        o = out.copy()
        o[1:] &= out[:-1]
        o[:-1] &= out[1:]
        o[:, 1:] &= out[:, :-1]
        o[:, :-1] &= out[:, 1:]
        out = o
    return out


def bilinear(img, u, v):
    """Sample img (H, W, C) at continuous pixel coords (pixel centres at i + 0.5)."""
    h, w = img.shape[:2]
    x, y = np.clip(u - 0.5, 0, w - 1.001), np.clip(v - 0.5, 0, h - 1.001)
    x0, y0 = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    return ((img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx) * (1 - fy)
            + (img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx) * fy)


# ---------------- baking ----------------
def base_color_image(obj):
    for slot in obj.material_slots:
        mat = slot.material
        if not (mat and mat.node_tree):
            continue
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                links = n.inputs["Base Color"].links
                if links and links[0].from_node.type == "TEX_IMAGE":
                    return mat, links[0].from_node
    raise RuntimeError(f"{obj.name}: no image texture on a Principled Base Color")


def bake_attribute(obj, mat, attr, size):
    """Bake the world-space Position or Normal of every texel (float image, Blender row order)."""
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output)
    old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].links else None
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    emit = nt.nodes.new("ShaderNodeEmission")
    img = bpy.data.images.new(f"bake_{attr}", size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(geo.outputs[attr], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    for n in nt.nodes:
        n.select = False
    tex.select = True
    nt.nodes.active = tex
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 1
    sc.render.bake.margin = 6
    with bpy.context.temp_override(active_object=obj, selected_objects=[obj], object=obj):
        bpy.ops.object.bake(type="EMIT", use_clear=True)
    a = image_array(img)
    # an unbaked texel keeps the clear colour; the alpha of a baked one is 1
    for n in (geo, emit, tex):
        nt.nodes.remove(n)
    if old:
        nt.links.new(old, out.inputs["Surface"])
    bpy.data.images.remove(img)
    return a


# ---------------- colour transfer ----------------
def srgb_to_lab(c):
    c = np.clip(c, 0, 1)
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def delta_e(a, b):
    return np.linalg.norm(srgb_to_lab(a) - srgb_to_lab(b), axis=1)


def fit_transfer(src, dst, w, n=17, sigma=1.2):
    """Smooth colour lookup (n^3 grid of offsets) taking src colours to dst: trilinear splats of the
    weighted offsets, blurred by sigma grid cells, regularised towards the mean offset."""
    g = np.clip(src, 0, 1) * (n - 1)
    i0 = np.minimum(np.floor(g).astype(np.int64), n - 2)
    f = g - i0
    num = np.zeros((n, n, n, 3))
    den = np.zeros((n, n, n))
    off = dst - src
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                k = (np.where(dx, f[:, 0], 1 - f[:, 0]) * np.where(dy, f[:, 1], 1 - f[:, 1])
                     * np.where(dz, f[:, 2], 1 - f[:, 2])) * w
                idx = (i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz)
                np.add.at(den, idx, k)
                np.add.at(num, idx, k[:, None] * off)
    r = int(math.ceil(3 * sigma))
    ker = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    ker /= ker.sum()

    def blur(a):
        for ax in range(3):
            a = np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode="edge"), ker, "valid"), ax, a)
        return a

    num = np.stack([blur(num[..., c]) for c in range(3)], -1)
    den = blur(den)
    mean = (off * w[:, None]).sum(0) / max(w.sum(), 1e-9)
    prior = den.mean() * 0.05
    return (num + prior * mean) / (den + prior)[..., None]


def match_levels(src, dst):
    """Per channel, the straight line taking src's colour levels to dst's (5th to 95th percentiles): an
    image drawn in the same palette is nudged, not remapped. It compares the two sets of colours as
    wholes, so pixels that do not line up exactly between two images (a drawn detail a little off the
    model) cannot teach it that grey should turn red, as a per-texel colour lookup would."""
    q = [5, 25, 50, 75, 95]
    return [np.polyfit(np.percentile(src[:, k], q), np.percentile(dst[:, k], q), 1) for k in range(3)]


def apply_levels(fit, c):
    return np.clip(np.stack([np.polyval(fit[k], c[:, k]) for k in range(3)], 1), 0, 1)


def apply_transfer(lut, c):
    n = lut.shape[0]
    g = np.clip(c, 0, 1) * (n - 1)
    i0 = np.minimum(np.floor(g).astype(np.int64), n - 2)
    f = g - i0
    out = np.zeros_like(c)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                k = (np.where(dx, f[:, 0], 1 - f[:, 0]) * np.where(dy, f[:, 1], 1 - f[:, 1])
                     * np.where(dz, f[:, 2], 1 - f[:, 2]))
                out += k[:, None] * lut[i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz]
    return np.clip(c + out, 0, 1)


# ---------------- main entry ----------------
def fit_view(P_raw, source_path, mask_path, cfg):
    """Fit the source camera to the mesh (still in its raw, as-imported frame): the field of view whose
    projection of the surface covers the source's mask best, and a depth buffer for visibility."""
    src = load_rgba(source_path)[..., :3]
    mask = load_rgba(mask_path)[..., 0] > 0.5
    if src.shape[:2] != mask.shape:
        raise RuntimeError(f"source {src.shape[:2]} and mask {mask.shape} differ")
    fov, iou = fit_fov(P_raw, mask)
    log(f"source camera: fov {fov:.2f} deg, silhouette IoU {iou:.3f}")
    if iou < cfg.get("min_iou", 0.8):
        raise RuntimeError(f"source projection IoU {iou:.3f} < {cfg.get('min_iou', 0.8)}: "
                           "the mesh is not in the source's camera frame (not a Pixal3D mesh?)")
    view = SourceView(fov, zbuffer(P_raw, fov, mask.shape[0]), src)
    view.inner = erode(mask, int(cfg.get("mask_erode_px", 3)))
    view.iou = iou
    return view


# ---------------- extra views ----------------
def _axes(theta, phi, psi):
    """Camera looking at the object from azimuth theta, elevation phi (aligned frame, z up), rolled
    by psi: the direction to the camera and the right, up and forward axes."""
    d = np.array([math.cos(phi) * math.cos(theta), math.cos(phi) * math.sin(theta), math.sin(phi)])
    f = -d
    r = np.cross(f, [0.0, 0.0, 1.0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return d, math.cos(psi) * r + math.sin(psi) * u, -math.sin(psi) * r + math.cos(psi) * u, f


def _shrink(mask, k):
    h, w = mask.shape
    m = np.pad(mask, ((0, (-h) % k), (0, (-w) % k)))
    return m.reshape(m.shape[0] // k, k, m.shape[1] // k, k).mean((1, 3)) > 0.5


def _nelder_mead(fn, x0, step, iters=220):
    n = len(x0)
    pts = [np.array(x0, float)] + [np.array(x0, float) + np.eye(n)[i] * step[i] for i in range(n)]
    val = [fn(q) for q in pts]
    for _ in range(iters):
        order = np.argsort(val)
        pts, val = [pts[i] for i in order], [val[i] for i in order]
        c = np.mean(pts[:-1], axis=0)
        xr = c + (c - pts[-1])
        fr = fn(xr)
        if fr < val[0]:
            xe = c + 2 * (c - pts[-1])
            fe = fn(xe)
            pts[-1], val[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < val[-2]:
            pts[-1], val[-1] = xr, fr
        else:
            xc = c + 0.5 * (pts[-1] - c)
            fc = fn(xc)
            if fc < val[-1]:
                pts[-1], val[-1] = xc, fc
            else:
                pts = [pts[0] + 0.5 * (q - pts[0]) for q in pts]
                val = [fn(q) for q in pts]
    i = int(np.argmin(val))
    return pts[i], val[i]


class ExtraView:
    """A second source image of the same vehicle, e.g. a rear three-quarter view: its camera is not
    known, so it is found by fitting the mesh's silhouette to the image's alpha (azimuth, elevation,
    roll, scale and offset around the object, at the main camera's distance). Works in the aligned
    frame (R: raw -> aligned rotation), z up. A box-like vehicle has nearly the same outline from either
    end, so the search stays within 60 degrees of `expect_az` (radians) when it is given: a rear view is
    the source's camera turned 180 degrees round the vehicle."""

    def __init__(self, path, P, R, fov, cfg, debug_path=None, expect_az=None):
        img = load_rgba(path)
        self.path, self.R, self.image = str(path), np.asarray(R), img[..., :3]
        mask = img[..., 3] > 0.5
        if mask.mean() > 0.97:
            raise RuntimeError(f"{path}: no transparent background to take the silhouette from")
        Q = P @ self.R.T
        self.o = (Q.min(0) + Q.max(0)) / 2
        self.D = 0.5 / math.tan(math.radians(fov) / 2)
        k = max(1, int(math.ceil(max(mask.shape) / 256)))
        small = _shrink(mask, k)
        sub = Q[np.random.default_rng(3).choice(len(Q), min(len(Q), 60000), replace=False)]
        ys, xs = np.nonzero(small)
        box_m = np.array([xs.min(), ys.min(), xs.max() + 1, ys.max() + 1], float)

        def off(theta):
            return 0.0 if expect_az is None else abs((theta - expect_az + math.pi) % (2 * math.pi) - math.pi)

        def iou(pose, pts=sub, target=small):
            if off(pose[0]) > math.radians(75):
                return 0.0
            u, v, z = self._project(pts, pose)
            x, y = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)
            ok = (z > 0) & (x >= 0) & (x < target.shape[1]) & (y >= 0) & (y < target.shape[0])
            im = np.zeros_like(target)
            im[y[ok], x[ok]] = True
            im = erode(dilate(im, 1), 1)
            return (im & target).sum() / max(1, (im | target).sum())

        def framed(theta, phi):
            u, v, _ = self._project(sub, (theta, phi, 0.0, 1.0, 0.0, 0.0))
            bu, bv = np.percentile(u, [0.5, 99.5]), np.percentile(v, [0.5, 99.5])
            sc = 0.5 * ((box_m[2] - box_m[0]) / (bu[1] - bu[0]) + (box_m[3] - box_m[1]) / (bv[1] - bv[0]))
            return np.array([theta, phi, 0.0, sc, (box_m[0] + box_m[2]) / 2 - sc * bu.mean(),
                             (box_m[1] + box_m[3]) / 2 - sc * bv.mean()])

        cands = sorted(((iou(q), tuple(q)) for q in (framed(math.radians(t), math.radians(e))
                                                        for t in range(0, 360, 10) for e in range(0, 61, 10)
                                                        if off(math.radians(t)) <= math.radians(60))),
                       reverse=True)[:3]
        best, score = None, -1.0
        for _, q in cands:
            q = np.array(q)
            step = [math.radians(5), math.radians(5), math.radians(2), 0.05 * q[3], 3.0, 3.0]
            x, fx = _nelder_mead(lambda z: -iou(z), q, step)
            if -fx > score:
                best, score = x, -fx
        best[3:] = best[3:] * k  # the fit ran on the image shrunk k times
        self.pose, self.iou = best, score
        self.inner = erode(mask, int(cfg.get("mask_erode_px", 3)))
        # depth buffer for visibility, at the image's own resolution
        u, v, z = self._project(Q, self.pose)
        x, y = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)
        h, w = mask.shape
        ok = (z > 0) & (x >= 0) & (x < w) & (y >= 0) & (y < h)
        zb = np.full(h * w, np.inf)
        np.minimum.at(zb, y[ok] * w + x[ok], z[ok])
        zb = zb.reshape(h, w)
        for _ in range(3):
            hole = ~np.isfinite(zb)
            if not hole.any():
                break
            pad = np.pad(zb, 1, constant_values=np.inf)
            near = np.min([pad[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] for dy in (-1, 0, 1) for dx in (-1, 0, 1)], 0)
            zb = np.where(hole, near, zb)
        self.zbuf = zb
        if debug_path:
            # the image beside the fitted mesh's visible samples, coloured front (green) to rear (blue)
            # along the vehicle and lighter towards its +Y side
            vis = ok.copy()
            vis[ok] = z[ok] <= zb[y[ok], x[ok]] + 0.01
            fx = (Q[:, 0] - Q[:, 0].min()) / np.ptp(Q[:, 0])
            fy = (Q[:, 1] - Q[:, 1].min()) / np.ptp(Q[:, 1])
            col = np.stack([0.4 * fy, fx, 1 - fx, np.ones_like(fx)], 1).astype(np.float32)
            fit = np.zeros((h, w, 4), np.float32)
            fit[..., 3] = 1
            fit[y[vis], x[vis]] = col[vis]
            dbg = np.concatenate([np.concatenate([self.image, np.ones((h, w, 1), np.float32)], 2), fit], 1)
            im = bpy.data.images.new("extra_debug", dbg.shape[1], dbg.shape[0], alpha=True)
            im.pixels.foreach_set(dbg[::-1].astype(np.float32).ravel())
            im.filepath_raw, im.file_format = str(debug_path), "PNG"
            im.save()
            bpy.data.images.remove(im)
        t, e, r_ = (math.degrees(a) for a in best[:3])
        log(f"extra view {Path(path).name}: azimuth {t % 360:.1f}, elevation {e:.1f}, roll {r_:.1f} deg, "
            f"silhouette IoU {score:.3f}")
        if score < cfg.get("extra_min_iou", 0.8):
            raise RuntimeError(f"extra view {path}: silhouette IoU {score:.3f} < {cfg.get('extra_min_iou', 0.8)}; "
                               "is it the same vehicle, on a transparent background?")

    def _project(self, Q, pose):
        theta, phi, psi, k, cx, cy = pose
        d, r, u, f = _axes(theta, phi, psi)
        X = Q - (self.o + self.D * d)
        z = X @ f
        return cx + k * (X @ r) / z, cy - k * (X @ u) / z, z

    def seen(self, P, N, cfg):
        """How fully this view sees each raw-frame surface point (0..1), and its colour there."""
        Q, Nq = P @ self.R.T, N @ self.R.T
        u, v, z = self._project(Q, self.pose)
        h, w = self.zbuf.shape
        x, y = np.clip(np.floor(u).astype(np.int64), 0, w - 1), np.clip(np.floor(v).astype(np.int64), 0, h - 1)
        d, *_ = _axes(*self.pose[:3])
        to_cam = (self.o + self.D * d)[None, :] - Q
        to_cam /= np.linalg.norm(to_cam, axis=1, keepdims=True)
        lo, hi = cfg.get("facing_ramp", [0.12, 0.4])
        wt = np.clip(((Nq * to_cam).sum(1) - lo) / (hi - lo), 0, 1)
        inside = (u >= 0) & (u < w) & (v >= 0) & (v < h)
        wt *= inside & (z <= self.zbuf[y, x] + cfg.get("depth_tol", 0.012)) & self.inner[y, x]
        return wt, bilinear(self.image, u, v)


def seen_weight(view, P, N, cfg):
    """How fully the source camera sees each surface point (0..1), and its source colour."""
    res = view.res
    u, v, d = project(P, view.fov, res)
    x = np.clip(np.floor(u).astype(np.int64), 0, res - 1)
    y = np.clip(np.floor(v).astype(np.int64), 0, res - 1)
    to_cam = camera_position(view.fov)[None, :] - P
    to_cam /= np.linalg.norm(to_cam, axis=1, keepdims=True)
    facing = (N * to_cam).sum(1)
    lo, hi = cfg.get("facing_ramp", [0.12, 0.4])
    w = np.clip((facing - lo) / (hi - lo), 0, 1)
    w *= (d <= view.zbuf[y, x] + cfg.get("depth_tol", 0.012)) & view.inner[y, x]
    return w, bilinear(view.image, u, v)


def nearest_fill(Pk, Ck, Q, k=6):
    """Colours for the points Q from their k nearest known points Pk (colours Ck), inverse-distance
    weighted: a surface the source never shows (a rear end, a truck's top) takes the colours of the
    seen surface next to it, so a stripe runs on round a corner instead of a generated colour."""
    from mathutils.kdtree import KDTree
    if len(Pk) > 400000:  # plenty of samples; the tree is built in Python
        pick = np.random.default_rng(1).choice(len(Pk), 400000, replace=False)
        Pk, Ck = Pk[pick], Ck[pick]
    tree = KDTree(len(Pk))
    for j, p in enumerate(Pk):
        tree.insert(p, j)
    tree.balance()
    # one query per small cell of space (most hidden texels are neighbours on the same surface)
    cell = 0.004
    keys, inv = np.unique(np.floor(Q / cell).astype(np.int64), axis=0, return_inverse=True)
    hits = [tree.find_n(q, k) for q in (keys + 0.5) * cell]
    idx = np.array([[h[1] for h in hs] for hs in hits], np.int64)
    w = 1.0 / (np.array([[h[2] for h in hs] for hs in hits]) + 1e-4)
    return ((w[..., None] * Ck[idx]).sum(1) / w.sum(1, keepdims=True))[inv.ravel()]


def reproject(obj, view, out_path, cfg, mirror=None, extras=()):
    """Replace obj's base colour texture with the source's colours where the source camera sees the
    surface. A texel it cannot see takes, in turn: the colour of an extra view that sees it (a rear
    three-quarter image, colour-matched to the source on the texels both see), the colour of its mirror
    twin across the vehicle's centre plane where a view sees that (rolling stock is left-right
    symmetric; mirror = the rotation from the raw frame to the aligned one, whose y = const planes are
    the vehicle's sides), else the colour of the nearest seen surface (cfg hidden = "nearest", the
    default) or the generated colour mapped through a colour transfer fitted on the seen texels
    (hidden = "transfer"). obj must still carry its raw transform."""
    mat, tex_node = base_color_image(obj)
    img = tex_node.image
    size = img.size[0]
    gen = image_array(img)[..., :3].reshape(-1, 3)
    pos = bake_attribute(obj, mat, "Position", size)
    nrm = bake_attribute(obj, mat, "Normal", size)
    baked = pos[..., 3].reshape(-1) > 0.5
    P = pos[..., :3].reshape(-1, 3)[baked]
    N = nrm[..., :3].reshape(-1, 3)[baked]
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
    w, seen = seen_weight(view, P, N, cfg)
    g = gen[baked]
    train = w > 0.75
    lut = fit_transfer(g[train], seen[train], w[train])
    mapped = apply_transfer(lut, g)
    if mirror is not None:
        R = np.asarray(mirror)
        Q, Qn = P @ R.T, N @ R.T
        yc = float(np.mean(np.percentile(Q[:, 1], [2, 98])))
        Q[:, 1], Qn[:, 1] = 2 * yc - Q[:, 1], -Qn[:, 1]
        Pm, Nm = Q @ R, Qn @ R
    layers = [("source", w, seen)]
    extra_rep, luts = [], []
    for ev in extras:
        we, ce = ev.seen(P, N, cfg)
        both = train & (we > 0.75)
        # the extra image's colour levels onto the source's, from the surface both see
        lut_e = match_levels(ce[both], seen[both]) if both.sum() >= 500 else None
        luts.append(lut_e)
        layers.append((f"extra:{Path(ev.path).name}", we, ce if lut_e is None else apply_levels(lut_e, ce)))
        extra_rep.append({"image": ev.path, "silhouette_iou": round(float(ev.iou), 4),
                          "pose_deg": [round(math.degrees(a), 2) for a in ev.pose[:3]],
                          "colour_matched": lut_e is not None, "overlap_texels": int(both.sum())})
    if mirror is not None:
        wm, cm = seen_weight(view, Pm, Nm, cfg)
        layers.append(("mirror:source", wm, cm))
        for ev, lut_e in zip(extras, luts):
            wm, cm = ev.seen(Pm, Nm, cfg)
            layers.append((f"mirror:extra:{Path(ev.path).name}", wm, cm if lut_e is None else apply_levels(lut_e, cm)))
    new = bpy.data.images.new(f"{obj.name}_source", size, size, alpha=True)
    new.colorspace_settings.name = "sRGB"
    new.filepath_raw = str(out_path)
    new.file_format = "PNG"
    view.tex = {"P": P, "layers": layers, "mapped": mapped, "gen": gen, "baked": baked, "size": size,
                "image": new, "fill": cfg.get("hidden", "nearest"), "N": N,
                "mirror": (Pm, Nm) if mirror is not None else None}
    shares = fill_hidden(view)
    tex_node.image = new
    before = float(np.median(delta_e(g[train], seen[train])))
    after = float(np.median(delta_e(mapped[train], seen[train])))
    report = {"fov_deg": round(view.fov, 3), "silhouette_iou": round(float(view.iou), 4),
              "texels": int(baked.sum()), "source_texels": int((w > 0.5).sum()),
              "source_share": shares["source"], "mirrored_share": round(sum(v for k, v in shares.items()
                                                                          if k.startswith("mirror:")), 3),
              "extra_share": round(sum(v for k, v in shares.items() if k.startswith("extra:")), 3),
              "nearest_share": shares["hidden"], "extras": extra_rep,
              "median_delta_e_generated": round(before, 2), "median_delta_e_transferred": round(after, 2),
              "texture": str(out_path)}
    log(f"source texture: {report['source_share']:.0%} of texels from the source, {report['extra_share']:.0%} from "
        f"extra views, {report['mirrored_share']:.0%} from mirror twins, {report['nearest_share']:.0%} from the "
        f"nearest seen surface; generated colours dE {before:.1f} -> {after:.1f} after transfer")
    return report


def polygon_mask(polys, res):
    """Source-space polygons ([[x, y], ...] in source pixels) -> float mask (res, res), row 0 at the top."""
    m = np.zeros((res, res), np.float32)
    yy, xx = np.mgrid[0:res, 0:res]
    for poly in polys:
        p = np.asarray(poly, np.float64)
        if len(p) < 3:
            continue
        x0, y0 = np.maximum(np.floor(p.min(0)).astype(int), 0)
        x1, y1 = np.minimum(np.ceil(p.max(0)).astype(int), res - 1)
        gx, gy = xx[y0:y1 + 1, x0:x1 + 1] + 0.5, yy[y0:y1 + 1, x0:x1 + 1] + 0.5
        inside = np.zeros(gx.shape, bool)
        j = len(p) - 1
        for i in range(len(p)):
            (xi, yi), (xj, yj) = p[i], p[j]
            inside ^= ((yi > gy) != (yj > gy)) & (gx < (xj - xi) * (gy - yi) / (yj - yi + 1e-12) + xi)
            j = i
        m[y0:y1 + 1, x0:x1 + 1] = np.maximum(m[y0:y1 + 1, x0:x1 + 1], inside)
    return m


def window_mask(view, polys, cfg, name):
    """The source's window panes (polygons in source pixels) as a texture on the mesh reproject() has
    textured: 1 on a texel the source camera sees inside a pane, or whose mirror twin it does (the far
    side's windows). Returns the image (same UVs as the colour texture) and the share of lit texels."""
    t = view.tex
    img = np.repeat(polygon_mask(polys, view.res)[..., None], 3, 2)
    mv = SourceView(view.fov, view.zbuf, img)
    mv.inner = view.inner
    w, c = seen_weight(mv, t["P"], t["N"], cfg)
    val = c[:, 0] * (w > 0.2)
    if t.get("mirror") is not None:
        wm, cm = seen_weight(mv, t["mirror"][0], t["mirror"][1], cfg)
        val = np.maximum(val, cm[:, 0] * (wm > 0.2))
    size = t["size"]
    full = np.zeros(size * size, bool)
    full[t["baked"]] = val > 0.5
    g = dilate(full.reshape(size, size), 1).astype(np.float32)
    rgba = np.stack([g, g, g, np.ones_like(g)], 2)
    image = bpy.data.images.new(name, size, size, alpha=False)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(rgba.ravel())
    image.update()
    return image, float((val > 0.5).mean())


def fill_hidden(view, regions=None):
    """Blend the colour layers (the source, extra views, mirror twins: each takes what the earlier ones
    left), colour what none of them sees and write the texture. regions: (core, padded) texel masks of
    separate pieces (a truck, a pilot): a hidden texel inside one takes colours only from seen texels
    under the piece's own faces (core), the rest only from outside them all, so a truck's top stays
    truck-coloured instead of taking the red of the body side just above it. Returns each layer's
    share of the texels."""
    t = view.tex
    P = t["P"]
    out = np.zeros((len(P), 3))
    rest_w = np.ones(len(P))
    best, best_w = np.zeros((len(P), 3)), np.zeros(len(P))
    shares = {}
    for name, w, c in t["layers"]:
        take = rest_w * w
        out += take[:, None] * c
        shares[name] = round(float((take > 0.5).mean()), 3)
        better = take > best_w
        best[better], best_w[better] = c[better], take[better]
        rest_w = rest_w * (1 - w)
    unseen = rest_w > 0.5
    fallback = t["mapped"]
    if t["fill"] == "nearest" and unseen.any():
        fallback = t["mapped"].copy()
        groups = [(c[t["baked"]], m[t["baked"]]) for c, m in regions or []]
        rest = ~np.logical_or.reduce([m for _, m in groups]) if groups else np.ones(len(P), bool)
        for core, pad in groups + [(rest, rest)]:
            known, want = core & ~unseen, pad & unseen
            if want.any() and known.sum() >= 20:
                fallback[want] = nearest_fill(P[known], best[known], P[want])
    out += rest_w[:, None] * fallback
    shares["hidden"] = round(float(unseen.mean()), 3)
    full = t["gen"].copy()
    full[t["baked"]] = out
    size = t["size"]
    rgba = np.concatenate([full.reshape(size, size, 3), np.ones((size, size, 1), np.float32)], 2)
    t["image"].pixels.foreach_set(rgba.astype(np.float32).ravel())
    t["image"].update()
    t["image"].save()
    return shares


def uv_cover(ob, size, grow=3):
    """Texel masks (Blender row order, flattened) of the texture area ob's faces use: the texels under
    its triangles, and those grown by `grow` texels into the bake margin."""
    me = ob.data
    me.calc_loop_triangles()
    uvl = me.uv_layers.active.data
    uv = np.empty(len(uvl) * 2)
    uvl.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2) * size - 0.5
    lt = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("loops", lt)
    mask = np.zeros((size, size), bool)
    for a, b, c in uv[lt.reshape(-1, 3)]:
        x0, x1 = max(0, int(np.floor(min(a[0], b[0], c[0])))), min(size - 1, int(np.ceil(max(a[0], b[0], c[0]))))
        y0, y1 = max(0, int(np.floor(min(a[1], b[1], c[1])))), min(size - 1, int(np.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:  # no area
            continue
        l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / d
        l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / d
        ins = (l1 >= 0) & (l2 >= 0) & (1 - l1 - l2 >= 0)
        # a thin triangle may miss every texel centre: keep its nearest texel
        if not ins.any():
            ins[int(round(np.clip(a[1], y0, y1))) - y0, int(round(np.clip(a[0], x0, x1))) - x0] = True
        mask[y0:y1 + 1, x0:x1 + 1] |= ins
    return mask.ravel(), dilate(mask, grow).ravel()


class SourceView:
    """The source camera after the fit: back-projects source pixels onto the mesh surface."""

    def __init__(self, fov, zbuf, image):
        self.fov, self.zbuf, self.image = fov, zbuf, image
        self.res = zbuf.shape[0]
        self.inner, self.iou = None, None
        self.tex = None  # reproject's per-texel state, for fill_hidden

    def point(self, px, reach=6):
        """Raw-frame surface point under source pixel px = (x, y). A pixel on the outline (a tyre's
        outer edge) may fall just off the mesh: the window grows up to `reach` px until it finds
        surface, and the nearest depth there is taken."""
        x, y = int(px[0]), int(px[1])
        for r in range(2, reach + 1):
            win = self.zbuf[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]
            d = float(win.min())
            if np.isfinite(d):
                break
        else:
            raise RuntimeError(f"source pixel {px} is off the mesh")
        t = math.tan(math.radians(self.fov) / 2)
        f = self.res / (2 * t)
        u, v = px[0] + 0.5, px[1] + 0.5
        return np.array([(u - self.res / 2) * d / f, d - 0.5 / t, -(v - self.res / 2) * d / f])

    def color(self, box):
        """Median source colour (sRGB 0..1) of box = [x0, y0, x1, y1]."""
        x0, y0, x1, y1 = box
        return np.median(self.image[y0:y1, x0:x1].reshape(-1, 3), axis=0)
