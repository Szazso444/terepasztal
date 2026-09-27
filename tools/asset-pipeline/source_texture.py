"""Put the source image's own colours back on a Pixal3D mesh. Runs inside Blender (bpy + numpy).

A Pixal3D mesh is pixel-aligned with the image it was conditioned on: it sits in that image's
camera frame (camera at -Y looking +Y, +Z up, the object inside a unit cube, a perspective camera
with the horizontal field of view MoGe estimated; comfy/ldm/trellis2/model.py,
_project_points_to_image). The generated texture drifts from the source (the Rocket's yellow went
olive), so every texel the source camera sees takes the source's colour, and the texels it cannot see
keep the generated colour mapped through a colour transfer fitted on the visible ones.
"""
import math

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


def reproject(obj, view, out_path, cfg, mirror=None):
    """Replace obj's base colour texture with the source's colours where the source camera sees the
    surface. A texel it cannot see takes the colour of its mirror twin across the vehicle's centre plane
    when the camera sees that (rolling stock is left-right symmetric; mirror = the rotation from the raw
    frame to the aligned one, whose y = const planes are the vehicle's sides), else the generated colour
    mapped through a colour transfer fitted on the seen texels. obj must still carry its raw transform."""
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
    hidden = mapped
    wm = np.zeros(len(P))
    if mirror is not None:
        R = np.asarray(mirror)
        Q, Qn = P @ R.T, N @ R.T
        yc = float(np.mean(np.percentile(Q[:, 1], [2, 98])))
        Q[:, 1], Qn[:, 1] = 2 * yc - Q[:, 1], -Qn[:, 1]
        wm, seen_m = seen_weight(view, Q @ R, Qn @ R, cfg)
        hidden = wm[:, None] * seen_m + (1 - wm[:, None]) * mapped
    out = w[:, None] * seen + (1 - w[:, None]) * hidden
    full = gen.copy()
    full[baked] = out
    rgba = np.concatenate([full.reshape(size, size, 3), np.ones((size, size, 1), np.float32)], 2)
    new = bpy.data.images.new(f"{obj.name}_source", size, size, alpha=True)
    new.colorspace_settings.name = "sRGB"
    new.pixels.foreach_set(rgba.astype(np.float32).ravel())
    new.filepath_raw = str(out_path)
    new.file_format = "PNG"
    new.save()
    tex_node.image = new
    before = float(np.median(delta_e(g[train], seen[train])))
    after = float(np.median(delta_e(mapped[train], seen[train])))
    mirrored = float(((1 - w) * wm > 0.5).mean())
    report = {"fov_deg": round(view.fov, 3), "silhouette_iou": round(float(view.iou), 4),
              "texels": int(baked.sum()), "source_texels": int((w > 0.5).sum()),
              "source_share": round(float((w > 0.5).mean()), 3), "mirrored_share": round(mirrored, 3),
              "median_delta_e_generated": round(before, 2), "median_delta_e_transferred": round(after, 2),
              "texture": str(out_path)}
    log(f"source texture: {report['source_share']:.0%} of texels from the source, {mirrored:.0%} from their "
        f"mirror twin; generated colours dE {before:.1f} -> {after:.1f} after transfer")
    return report


class SourceView:
    """The source camera after the fit: back-projects source pixels onto the mesh surface."""

    def __init__(self, fov, zbuf, image):
        self.fov, self.zbuf, self.image = fov, zbuf, image
        self.res = zbuf.shape[0]
        self.inner, self.iou = None, None

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
