"""Blender stage. Run: blender -b --factory-startup --python-exit-code 1 -P blender_stage.py -- job.json

raw GLB -> Manhattan alignment (upright + axis-aligned) -> real-world scale -> class compression
-> tile footprint -> fixed 2:1 ortho camera at constant px/m -> N direction renders + meta JSON.
A vehicle whose body plan has several parts (engine + tender, Garratt) is cut into them first and
every part is rendered on its own, as the game draws them.
Any exception exits non-zero (with --python-exit-code 1).
"""
import json
import math
import os
import sys
import time
from pathlib import Path

import bpy
import bmesh  # after bpy: the bpy module from pip only finds bmesh once bpy is loaded
import numpy as np
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # Blender does not add the script's folder
import game_rules  # noqa: E402
import running_gear  # noqa: E402
import source_texture  # noqa: E402


def log(*a):
    print("[blender]", *a, flush=True)


# ---------------- math ----------------
def rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def compose(yaw, pitch, roll):  # degrees; object-frame correction, yaw applied last
    return rz(math.radians(yaw)) @ rx(math.radians(pitch)) @ ry(math.radians(roll))


def manhattan_scores(N, grid):
    Rs = np.stack([compose(*g) for g in grid])
    out = np.empty(len(grid))
    for i in range(0, len(grid), 64):
        P = np.einsum("mij,nj->mni", Rs[i:i + 64], N)
        out[i:i + 64] = (P ** 4).sum(2).mean(1)
    return out


def manhattan_align(N, pitch_rng, roll_rng):
    """Rotation maximizing sum((R n)_k^4): aligns dominant planes with world axes."""
    def rng(lo, hi, step):
        return list(np.arange(lo, hi + 1e-9, step))

    grid = [(y, p, r) for y in rng(0, 85, 5) for p in rng(*pitch_rng, 5) for r in rng(*roll_rng, 5)]
    s = manhattan_scores(N, grid)
    best = grid[int(s.argmax())]
    for span, step in ((5, 1.0), (1, 0.25)):
        grid = [(best[0] + dy, float(np.clip(best[1] + dp, *pitch_rng)), float(np.clip(best[2] + dr, *roll_rng)))
                for dy in rng(-span, span, step) for dp in rng(-span, span, step) for dr in rng(-span, span, step)]
        s = manhattan_scores(N, grid)
        best = grid[int(s.argmax())]
    return best, float(s.max())


def measure_wheels(wheels_raw, R):
    """[(landmark, hub centre, radius)] in the rotated frame, raw units: the radius is the mean
    distance in the wheel's plane (XZ) from the hub to the measured tyre edge points."""
    out = []
    for w, hub, rims in wheels_raw:
        hc = R @ hub
        rad = float(np.mean([math.hypot(*(R @ q - hc)[[0, 2]]) for q in rims]))
        out.append((w, hc, rad))
    return out


def refine_axes(P, R, max_deg=6.0):
    """Turn R so the body runs exactly along X and level. Manhattan alignment lands within a few
    degrees; a vehicle off by even 2 degrees sits visibly askew on straight rails. Yaw: the turn that
    makes the body narrowest across (its long sides then run along X). Pitch: the principal axis of
    the body in side view. Only the body band is used (30-85% of the height): wheels, chimneys and
    domes do not steer it. Returns the new R and the two corrections in degrees."""
    def band(Q):
        z0, z1 = np.percentile(Q[:, 2], [2, 98])
        return Q[(Q[:, 2] > z0 + 0.3 * (z1 - z0)) & (Q[:, 2] < z0 + 0.85 * (z1 - z0))]

    B = band(P @ R.T)

    def width(th):
        y = math.sin(th) * B[:, 0] + math.cos(th) * B[:, 1]  # y after rz(th)
        return float(np.subtract(*np.percentile(y, [98, 2])))

    ths = np.radians(np.arange(-max_deg, max_deg + 1e-9, 0.1))
    th = float(ths[int(np.argmin([width(t) for t in ths]))])
    fine = np.radians(np.arange(-0.1, 0.1001, 0.01)) + th
    th = float(fine[int(np.argmin([width(t) for t in fine]))])
    R = rz(th) @ R
    B = band(P @ R.T)
    XZ = B[:, [0, 2]] - B[:, [0, 2]].mean(0)
    w, v = np.linalg.eigh(np.cov(XZ.T))
    ax = v[:, int(np.argmax(w))]
    ax = ax if ax[0] > 0 else -ax
    tilt = math.atan2(ax[1], ax[0])
    if abs(tilt) > math.radians(max_deg):
        tilt = 0.0  # a body taller than it is long is not levelled by its axis
    R = ry(tilt) @ R
    return R, math.degrees(th), math.degrees(tilt)


def detaper(ob, x_lo, x_hi, yc, zg, slices=12):
    """Make a box body equally wide and tall along its length. A reconstruction keeps a little of its
    source's perspective: one end comes out wider and the roof slopes, so the body's edges are not
    parallel to the rails. Fits the body band's width and roof height over the middle 70% of the
    length and scales so both fits are level. Returns the width and height changes it removed (m)."""
    me = ob.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    V = co.reshape(-1, 3)
    ztop = np.percentile(V[:, 2], 99)
    band = V[V[:, 2] > zg + 0.45 * (ztop - zg)]
    L = x_hi - x_lo
    edges = np.linspace(x_lo + 0.15 * L, x_hi - 0.15 * L, slices + 1)
    xs, ws = [], []
    for a_, b_ in zip(edges, edges[1:]):
        S = band[(band[:, 0] >= a_) & (band[:, 0] < b_)]
        if len(S) > 50:
            xs.append((a_ + b_) / 2)
            ws.append(np.subtract(*np.percentile(S[:, 1] - yc, [97, 3])))
    if len(xs) < 4:
        return 0.0, 0.0
    k, b = np.polyfit(xs, ws, 1)
    w_mid = k * (x_lo + x_hi) / 2 + b
    scale = w_mid / np.maximum(k * V[:, 0] + b, 1e-6)
    V[:, 1] = yc + (V[:, 1] - yc) * scale
    # the roof the same way: heights scale about the rail, so the running gear stays where it is
    xr, hs = [], []
    for a_, b_ in zip(edges, edges[1:]):
        S = band[(band[:, 0] >= a_) & (band[:, 0] < b_)]
        if len(S) > 50:
            xr.append((a_ + b_) / 2)
            hs.append(np.percentile(S[:, 2], 97) - zg)
    kz, bz = np.polyfit(xr, hs, 1)
    h_mid = kz * (x_lo + x_hi) / 2 + bz
    V[:, 2] = zg + (V[:, 2] - zg) * h_mid / np.maximum(kz * V[:, 0] + bz, 1e-6)
    me.vertices.foreach_set("co", V.ravel())
    me.update()
    return float(k * L), float(kz * L)


def body_profile(ob, M, n=6):
    """Roof height (97th percentile) and body width (3rd-97th) in n slices from the rear to the nose,
    final frame: a reconstruction that tapers towards the source's far end shows up here."""
    co = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get("co", co)
    m = np.array(M)
    V = co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]
    edges = np.linspace(V[:, 0].min(), V[:, 0].max(), n + 1)
    top, width = [], []
    for a_, b_ in zip(edges, edges[1:]):
        S = V[(V[:, 0] >= a_) & (V[:, 0] < b_) & (V[:, 2] > 0.35 * V[:, 2].max())]
        top.append(round(float(np.percentile(S[:, 2], 97)), 2) if len(S) else None)
        width.append(round(float(np.subtract(*np.percentile(S[:, 1], [97, 3]))), 2) if len(S) else None)
    return {"top": top, "width": width}


def to4(m3):
    m = Matrix.Identity(4)
    for i in range(3):
        for j in range(3):
            m[i][j] = float(m3[i][j])
    return m


# ---------------- scene ----------------
def import_mesh(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"no mesh in {path}")
    if len(meshes) > 1:
        with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes,
                                       selected_objects=meshes):
            bpy.ops.object.join()
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    obj = meshes[0]
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mw
    for o in list(bpy.data.objects):
        if o is not obj:
            bpy.data.objects.remove(o)
    return obj


def load_part(spec, R, cfg, shading, painted):
    """A piece reconstructed from an image of its own (a truck, REAR-VIEWS.md): imported beside the
    vehicle, painted with its own image's colours, turned into the vehicle's aligned frame with the
    vehicle's rotation (its image was drawn from the same camera, front to the lower right) and its
    hidden side rebuilt as the mirror of the seen one. Unscaled; fit_part places it."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=spec["glb"])
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"no mesh in {spec['glb']}")
    if len(meshes) > 1:
        with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes,
                                       selected_objects=meshes):
            bpy.ops.object.join()
    pm = next(o for o in bpy.data.objects if o in set(meshes))
    mw = pm.matrix_world.copy()
    pm.parent = None
    pm.matrix_world = mw
    for o in new:
        if o is not pm and o.name in bpy.data.objects:
            bpy.data.objects.remove(o)
    view = source_texture.fit_view(surface_points(pm, 1500000), spec["source"]["image"], spec["source"]["mask"], cfg)
    source_texture.reproject(pm, view, spec["source"]["texture"], cfg, mirror=R)
    if painted:
        running_gear.repaint(pm, shading)
    pm.data.transform(to4(np.asarray(R)) @ pm.matrix_world)
    pm.matrix_world = Matrix.Identity(4)
    Pa = surface_points(pm, 100000)
    yc = float(np.mean(np.percentile(Pa[:, 1], [1, 99])))
    cam_y = float((np.asarray(R) @ source_texture.camera_position(view.fov))[1])
    running_gear.symmetrize(pm, yc, cam_y < yc)
    return pm


def fit_part(pm, target, zg):
    """Scale and place a part onto the piece of the vehicle's own model it replaces: its length (and
    height with it) and width to the target's, centred on it, standing on the rail plane zg."""
    A, B = surface_points(target, 100000), surface_points(pm, 100000)
    ta, tb = np.percentile(A, [2, 98], axis=0), np.percentile(B, [2, 98], axis=0)
    s = (ta[1, 0] - ta[0, 0]) / (tb[1, 0] - tb[0, 0])
    sy = (ta[1, 1] - ta[0, 1]) / (tb[1, 1] - tb[0, 1])
    bottom = float(np.percentile(B[:, 2], 0.5))
    pm.data.transform(Matrix.Translation(Vector((ta.mean(0)[0], ta.mean(0)[1], zg)))
                      @ Matrix.Diagonal((s, sy, s, 1.0))
                      @ Matrix.Translation(Vector((-tb.mean(0)[0], -tb.mean(0)[1], -bottom))))
    return s, sy


def surface_points(obj, n, seed=1):
    """Area-weighted random points on the mesh surface, world coords. Profiles need points on the
    faces, not only vertices: a long flat face has no vertex in its middle."""
    me = obj.data
    me.calc_loop_triangles()
    tri = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", tri)
    tri = tri.reshape(-1, 3)
    co = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get("co", co)
    mw = np.array(obj.matrix_world)
    co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    A, B, C = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    area = np.linalg.norm(np.cross(B - A, C - A), axis=1)
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(tri), size=n, p=area / area.sum())
    u, v = rng.random(n), rng.random(n)
    over = u + v > 1
    u[over], v[over] = 1 - u[over], 1 - v[over]
    return A[idx] + (B[idx] - A[idx]) * u[:, None] + (C[idx] - A[idx]) * v[:, None]


def find_cuts(P, nose, length, expected, window, step=0.1):
    """Cut positions (m from the nose) at the lowest point of the side silhouette near each expected
    boundary: couplings, cab backs and tender fronts sit lower than the bodies they join.
    Returns the cuts and their summed silhouette height (lower = cleaner joints)."""
    nb = int(math.ceil(length / step)) + 1
    b = np.clip(((nose - P[:, 0]) / step).astype(int), 0, nb - 1)
    top = np.full(nb, -np.inf)
    np.maximum.at(top, b, P[:, 2])
    top = np.where(np.isfinite(top), top - P[:, 2].min(), 0.0)  # an empty slice is an open gap
    cuts, total = [], 0.0
    for e in expected:
        idx = np.arange(max(1, int((e - window) / step)), min(nb - 1, int((e + window) / step)) + 1)
        score = top[idx] + 0.02 * np.abs(idx * step - e)  # nearest the expected place breaks ties
        cuts.append(round(float(idx[score.argmin()] * step + step / 2), 2))
        total += float(score.min())
    return cuts, total


def support_line(P, max_deg=8.0, lo_frac=0.06, hi_frac=0.94, bins=64):
    """The rail under a vehicle, from its side view (aligned frame: x along, z up). The lower outline
    is taken in slices along the body, the ends left out (buffers, pilots, ploughs). Every tilt up to
    max_deg is tried: at each, the rail is the level where most slices touch (within 1 % of the
    height), looked for among the lowest slices, so that a part hanging below the wheels at one end
    (guard irons, hoses) counts as a few stray slices and not as a support. The tilt that puts the
    most slices on the rail on BOTH sides of the middle wins; ties go to the smaller tilt.
    Returns (dz/dx, z of the rail at the middle, x of the middle, slices touching)."""
    x, z = P[:, 0], P[:, 2]
    x0, x1 = float(x.min()), float(x.max())
    H = float(z.max() - z.min())
    edges = np.linspace(x0 + lo_frac * (x1 - x0), x0 + hi_frac * (x1 - x0), bins + 1)
    idx = np.digitize(x, edges) - 1
    xs, zs = [], []
    for b in range(bins):
        zz = z[idx == b]
        if len(zz) >= 30:
            xs.append((edges[b] + edges[b + 1]) / 2)
            zs.append(float(np.percentile(zz, 0.5)))
    xs, zs = np.array(xs), np.array(zs)
    mid = (x0 + x1) / 2
    tol, left = 0.010 * H, xs < mid
    best = None
    for deg in np.arange(-max_deg, max_deg + 1e-9, 0.05):
        t = math.tan(math.radians(deg))
        r = zs - t * (xs - mid)
        for b in np.sort(r)[:max(3, len(r) // 6)]:
            on = (r >= b - 1e-12) & (r <= b + tol)
            below = int((r < b - 1e-12).sum())
            if below > max(2, len(r) // 16):
                continue
            score = (min(int((on & left).sum()), int((on & ~left).sum())), int(on.sum()) - 2 * below, -abs(deg))
            if best is None or score > best[0]:
                best = (score, t, float(np.mean(r[on])), int(on.sum()))
    return best[1], best[2], mid, best[3]


def lower_outline(P, x_lo, x_hi, step=0.04):
    """The underside of the points P between x_lo and x_hi: (x of each slice, its 1st percentile z)."""
    n = max(8, int(round((x_hi - x_lo) / step)))
    edges = np.linspace(x_lo, x_hi, n + 1)
    inside = (P[:, 0] >= x_lo) & (P[:, 0] <= x_hi)
    Q = P[inside]
    idx = np.clip(np.digitize(Q[:, 0], edges) - 1, 0, n - 1)
    z = np.full(n, np.nan)
    for b in range(n):
        zz = Q[idx == b, 2]
        if len(zz) >= 12:
            z[b] = np.percentile(zz, 1)
    return (edges[:-1] + edges[1:]) / 2, z


def find_axles(P, yc, zg, x_lo, x_hi, us, ds):
    """Where the model has the wheels the gear table lists: near each expected axle (us: 0 = rear end
    of the part, 1 = its front; ds: real diameters) the lowest stretch of the underside. Returns
    [{x, z, y}]: the axle's place along, its wheels' bottom and how far its treads stand from the
    centre plane; z and y are None where no wheel reaches down to within 0.3 m of the rail (hidden
    behind a skirt, or not modelled) and x is then the table's."""
    xs, zl = lower_outline(P, x_lo, x_hi)
    out = []
    for u, d in zip(us, ds):
        xe = x_lo + u * (x_hi - x_lo)
        m = (np.abs(xs - xe) <= max(0.3, 0.3 * d)) & np.isfinite(zl)
        if not m.any() or zl[m].min() > zg + 0.3:
            out.append({"x": float(xe), "z": None, "y": None})
            continue
        zmin = float(zl[m].min())
        near = m & (zl <= zmin + 0.02)
        xa = float(xs[near].mean())
        sel = (np.abs(P[:, 0] - xa) < max(0.1, 0.12 * d)) & (P[:, 2] < zmin + 0.10)
        ya = float(np.median(np.abs(P[sel, 1] - yc))) if sel.sum() >= 8 else None
        out.append({"x": xa, "z": zmin, "y": ya})
    return out


def wheel_factor(cx, xs, ds):
    """How much smaller than life the built wheels are: a body is compressed along the track, and its
    wheels with it (they stay round), never so large that neighbours on one frame touch."""
    k = min(1.0, max(0.55, cx))
    order = np.argsort(xs)
    for i, j in zip(order, order[1:]):
        gap = cx * abs(xs[j] - xs[i])
        k = min(k, 0.97 * gap / ((ds[i] + ds[j]) / 2))
    return max(0.35, k)


def wheel_cycle(ds_f, spokes, drivers, rods):
    """The turning of a group of wheels drawn as one layer: (phases, the reference wheel's turn in
    one cycle, each axle's share of it, metres of track per cycle). With rods the cycle is one turn of
    the coupled wheels, in eight phases; without, one step of the reference wheel's symmetry (a spoke,
    or a quarter turn of a disc with its four bosses), in four. Every other axle goes round by whole
    steps of its own symmetry per cycle, the number nearest its true speed, so the cycle closes."""
    sym = [sp if sp else 4 for sp in spokes]
    ref = drivers[0] if (rods and drivers) else 0
    if rods and drivers:
        phases, total = 8, 2 * math.pi
        share = []
        for i, (d, n) in enumerate(zip(ds_f, sym)):
            share.append(1.0 if i in drivers else max(1, round(n * ds_f[ref] / d)) / n)
    else:
        phases, total = 4, 2 * math.pi / sym[ref]
        share = []
        for d, n in zip(ds_f, sym):
            m = max(1, round((n / sym[ref]) * (ds_f[ref] / d)))
            share.append(m * sym[ref] / n)
    return phases, total, share, total * ds_f[ref] / 2


def wheel_colours(base, spec=None):
    """The built running gear's colours from the wheel centre's (sRGB 0..1; None: dark grey). spec
    (the wheels data of the group) may give "color", "tyre" and "rod" as 0..255 triples."""
    spec = spec or {}

    def rgb(key, default):
        return np.array(spec[key], dtype=np.float64) / 255 if spec.get(key) else np.array(default, dtype=np.float64)
    w = rgb("color", base if base is not None else (0.17, 0.18, 0.2))
    return {"tyre": rgb("tyre", (0.36, 0.37, 0.39)), "wheel": w, "hub": np.clip(w * 0.75 + 0.12, 0, 1),
            "rod": rgb("rod", (0.6, 0.6, 0.58)), "detail": np.array((0.16, 0.165, 0.18)),
            "frame": np.array((0.12, 0.125, 0.14)), "spring": np.array((0.27, 0.28, 0.29)),
            "splasher": np.array((0.12, 0.125, 0.14))}


def rod_spec(rods, axles, drivers, k, cx):
    """bogie()'s rods for coupled wheels: axles are the group's (final x, d_f), front to back; drivers
    their indices. rods: True or {crank, connect, cylinders: front | rear | none | jackshaft,
    crosshead: {dx, z}}. The small end stands ahead of the leading coupled wheel at axle height
    (behind the last one for cylinders at the rear), or where crosshead puts it (real metres from
    the driven axle, height over the rail); without cylinders only the coupling rod is drawn."""
    r_ = rods if isinstance(rods, dict) else {}
    dr = [axles[i] for i in drivers]
    d_drv = dr[0]["d_f"]
    con = int(r_.get("connect", 0 if len(dr) <= 2 else 1))
    con = max(0, min(con, len(dr) - 1))
    out = {"crank": float(r_.get("crank", 0.19 * d_drv / k)), "crank_deg": -35, "connect": con}
    cyl = r_.get("cylinders", "front")
    xh = r_.get("crosshead") or {}
    if "dx" in xh:
        out["crosshead"] = {"x": dr[con]["x"] + cx * float(xh["dx"]), "z_f": float(xh.get("z", d_drv / 2)),
                            "bar": 0.45 * d_drv}
    elif cyl == "front":
        out["crosshead"] = {"x": dr[0]["x"] + 1.15 * d_drv, "z_f": d_drv / 2, "bar": 0.45 * d_drv}
    elif cyl == "rear":
        out["crosshead"] = {"x": dr[-1]["x"] - 1.15 * d_drv - 0.45 * d_drv, "z_f": d_drv / 2, "bar": 0.45 * d_drv}
    return out


def gear_shear(ob, xm, zg, slope, height):
    """Bring the wheels to a level rail without tilting the body: a reconstruction's wheels do not
    always run parallel to its body (the rear ones higher than the front, say), so levelling the whole
    model on its wheels would tilt the body, and levelling the body leaves wheels in the air. Such
    a model is a wedge: level along the roof, tilted along the wheels, and everything between (the
    footplate, the frames) tilted in proportion. So each point is slid up or down by what the wheel
    line is off at its place along the body: fully under 0.16 of the height above the wheels' own
    line, less and less above, and not at all from 0.85 up."""
    me = ob.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    off = slope * (co[:, 0] - xm)
    h = co[:, 2] - (zg + off)
    w = np.clip((0.85 * height - h) / (0.69 * height), 0.0, 1.0)
    co[:, 2] -= off * w
    me.vertices.foreach_set("co", co.ravel())
    me.update()


def gauge_warp(ob, yc, zg, y_target, height, clamp=0.6):
    """Push the running gear sideways so the wheels stand on the game's rails. A single-view model
    keeps its wheels too far in (or a narrow-gauge one too far out) for the drawn gauge: below the
    body (full strength under 0.16 of the height, fading out at 0.30) everything outside the frames
    moves across by the difference, and what lies between the frames is stretched to follow.
    Returns (where the wheels stood, how far they moved) in metres, or None when no wheel is found."""
    me = ob.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    side = co[:, 1] - yc
    ay, z = np.abs(side), co[:, 2] - zg
    low = (z < 0.035 * height + 0.04) & (z > -0.05)
    if low.sum() < 20:
        return None
    y_w = float(np.median(ay[low]))
    if y_w < 0.05:
        return None
    d = float(np.clip(y_target - y_w, -clamp * y_w, clamp * y_target))
    z0, z1 = 0.16 * height, 0.30 * height
    wz = np.clip((z1 - z) / (z1 - z0), 0.0, 1.0)
    wy = np.clip(ay / (0.6 * y_w), 0.0, 1.0)
    co[:, 1] = yc + np.sign(side) * np.maximum(ay + d * wz * wy, 0.0)
    me.vertices.foreach_set("co", co.ravel())
    me.update()
    return y_w, d


def clip_mesh(ob, co, no):
    """Delete ob's mesh on the +no side of the plane (object space) and cap the cut."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5,
                                 plane_co=co, plane_no=no, clear_outer=True)
    edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge) and e.is_valid and e.is_boundary]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bm.to_mesh(ob.data)
    bm.free()
    if not ob.data.vertices:
        raise RuntimeError(f"cut left nothing of {ob.name}")


def local_bounds(ob, M):
    co = np.empty(len(ob.data.vertices) * 3, np.float64)
    ob.data.vertices.foreach_get("co", co)
    m = np.array(M)
    V = co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]
    return V.min(0), V.max(0)


def mesh_arrays(obj, sample, seed=0):
    me = obj.data
    mw = np.array(obj.matrix_world)
    nv = len(me.vertices)
    co = np.empty(nv * 3, np.float32)
    me.vertices.foreach_get("co", co)
    V = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    nf = len(me.polygons)
    nrm = np.empty(nf * 3, np.float32)
    area = np.empty(nf, np.float32)
    me.polygons.foreach_get("normal", nrm)
    me.polygons.foreach_get("area", area)
    N = nrm.reshape(-1, 3) @ np.linalg.inv(mw[:3, :3])  # inverse-transpose for normals
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    p = area.astype(np.float64)
    p /= p.sum()
    idx = np.random.default_rng(seed).choice(nf, size=min(sample, nf), replace=False, p=p)
    return V, N[idx], nv, nf


def force_dielectric():
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                sock = n.inputs["Metallic"]
                for link in list(sock.links):
                    mat.node_tree.links.remove(link)
                sock.default_value = 0.0


def setup_render(r, res_x, res_y):
    sc = bpy.context.scene
    sc.render.engine = r["engine"]
    if r["engine"] == "CYCLES":
        sc.cycles.samples = r["samples"]
        sc.cycles.use_denoising = True
        sc.cycles.device = "CPU"
        if r["device"].upper() == "GPU":
            prefs = bpy.context.preferences.addons["cycles"].preferences
            for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
                try:
                    prefs.compute_device_type = backend
                    prefs.get_devices()
                    devs = [d for d in prefs.devices if d.type == backend]
                    if devs:
                        for d in devs:
                            d.use = True
                        sc.cycles.device = "GPU"
                        log("GPU backend", backend, [d.name for d in devs])
                        break
                except TypeError:
                    continue
            else:
                log("WARNING: no GPU backend found, rendering on CPU")
    sc.render.resolution_x, sc.render.resolution_y = res_x, res_y
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    world = bpy.data.worlds.new("ambient")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = r["ambient"]


def sun_vector(r):
    az, el = math.radians(r["sun_azimuth_deg"]), math.radians(r["sun_elevation_deg"])
    return Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def add_sun(r):
    L = sun_vector(r)
    lamp = bpy.data.lights.new("sun", "SUN")
    lamp.energy = r["sun_strength"]
    lamp.angle = math.radians(3)
    ob = bpy.data.objects.new("sun", lamp)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = L.to_track_quat("Z", "Y").to_euler()
    return L


def add_shadow_catcher():
    me = bpy.data.meshes.new("ground")
    s = 500.0
    me.from_pydata([(-s, -s, -0.01), (s, -s, -0.01), (s, s, -0.01), (-s, s, -0.01)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("ground", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.is_shadow_catcher = True
    return ob


def make_camera(name):
    cam = bpy.data.cameras.new(name)
    cam.type = "ORTHO"
    cam.clip_start, cam.clip_end = 0.1, 5000
    ob = bpy.data.objects.new(name, cam)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def render_to(path):
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def show_only(objs, keep):
    for o in objs:
        o.hide_render = o not in keep


def debug_view(items, cam, view, path, res):
    """Orthographic look at [(obj, matrix)] from 'front' (-Y), 'side' (+X) or 'top'."""
    corners = []
    for ob, M in items:
        ob.matrix_world = M
        # from the vertices: ob.bound_box goes stale once bmesh has cut the mesh
        blo, bhi = local_bounds(ob, M)
        corners += [Vector((x, y, z)) for x in (blo[0], bhi[0]) for y in (blo[1], bhi[1]) for z in (blo[2], bhi[2])]
    ctr = sum(corners, Vector()) / len(corners)
    size = max((max(c[i] for c in corners) - min(c[i] for c in corners)) for i in range(3))
    rot = {"front": (90, 0, 0), "side": (90, 0, 90), "top": (0, 0, 0)}[view]
    back = {"front": Vector((0, -1, 0)), "side": Vector((1, 0, 0)), "top": Vector((0, 0, 1))}[view]
    cam.rotation_euler = [math.radians(a) for a in rot]
    cam.location = ctr + back * (size * 10 + 10)
    cam.data.ortho_scale = size * 1.15
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = res
    render_to(path)
    return {"center": [round(float(v), 4) for v in ctr], "size": round(float(size * 1.15), 4), "res": res,
            "view": view}


def render_sets(job, renders, scene_objs, shadow, L, k_px, ss, res_x):
    """Render every sprite set in every direction from the fixed game camera. A set is one object
    (plus its extras, e.g. built wheels) at matrix M; its canvas fits all directions and the anchor is
    the projection of the set's origin. Returns the per-set render records for the meta JSON."""
    a, g, r, ccfg = job["asset"], job["grid"], job["render"], job["class_cfg"]
    cat = a["category"]
    cam = make_camera("game_cam")
    cam.rotation_euler = (math.radians(90 - g["elevation_deg"]), 0, math.radians(g["azimuth_deg"]))
    bpy.context.view_layer.update()
    cm = cam.matrix_world.to_3x3()
    right, up, back = cm.col[0], cm.col[1], cm.col[2]
    dir_list = game_rules.directions(ccfg["dirs"])
    sc = bpy.context.scene
    sc.camera = cam
    pad = int(r["pad_px"]) * res_x
    out, out_lit = [], []
    holdouts = {False: running_gear.holdout_material("holdout"), True: running_gear.holdout_material("holdout_culled", True)}
    for rd in renders:
        part, ob, M, plo, phi = rd["part"], rd["ob"], rd["M"], rd["lo"], rd["hi"]
        extras = rd.get("extras", [])
        show_only(scene_objs, [ob] + [e for e, _ in extras])
        box = [Vector((x, y, z)) for x in (plo[0], phi[0]) for y in (plo[1], phi[1]) for z in (0.0, phi[2])]
        if shadow:
            box += [p - (p.z / L.z) * L for p in box if p.z > 0]
        pts = []
        for yaw_d, _ in dir_list:
            Rz_ = Matrix.Rotation(math.radians(yaw_d), 3, "Z")
            pts += [Rz_ @ p for p in box]
        pr = [p.dot(right) for p in pts]
        pu = [p.dot(up) for p in pts]
        W = math.ceil((max(pr) - min(pr)) * k_px) + 2 * pad
        H = math.ceil((max(pu) - min(pu)) * k_px) + 2 * pad
        W += W % 2
        H += H % 2
        ax = pad + math.ceil(-min(pr) * k_px)
        ay = pad + math.ceil(max(pu) * k_px)
        cr, cu = (W / 2 - ax) / k_px, (ay - H / 2) / k_px
        cam.location = right * cr + up * cu + back * 1000
        cam.data.ortho_scale = max(W, H) / k_px
        sc.render.resolution_x, sc.render.resolution_y = W * ss, H * ss

        def to_px(p):
            return [round(ax + p.dot(right) * k_px, 3), round(ay - p.dot(up) * k_px, 3)]

        fx, fy = rd["footprint_m"][0] / 2, rd["footprint_m"][1] / 2
        fp = [Vector(c) for c in ((-fx, -fy, 0), (fx, -fy, 0), (fx, fy, 0), (-fx, fy, 0))]
        stem = f"{a['id']}_{part}" if part else a["id"]
        dirs, lit_files = [], []
        wl = rd.get("wheels")
        wheel_files = [[] for _ in range(wl["phases"])] if wl else []
        for i, (yaw_d, facing) in enumerate(dir_list):
            Rz4 = Matrix.Rotation(math.radians(yaw_d), 4, "Z")
            ob.matrix_world = Rz4 @ M
            for e, EM in extras:
                e.matrix_world = Rz4 @ EM
            path = f"{job['sprites_raw_dir']}/{stem}_d{i}.png"
            tr = time.time()
            render_to(path)
            if rd.get("lit"):
                # the same view with the window mask as the only light: where the panes show
                objs = [ob] + [e for e, _ in extras]
                saved = [[sl.material for sl in o.material_slots] for o in objs]
                for o in objs:
                    for sl in o.material_slots:
                        sl.material = rd["lit"] if o is ob else rd["dark"]
                lit_path = f"{job['sprites_raw_dir']}/{stem}_lit_d{i}.png"
                render_to(lit_path)
                for o, mats in zip(objs, saved):
                    for sl, m in zip(o.material_slots, mats):
                        sl.material = m
                lit_files.append(lit_path)
            if wl:
                # the wheels alone, one image per phase of their turning; the body (or the truck's
                # frame) covers what it covers and renders as nothing
                objs = [ob] + [e for e, _ in extras]
                saved = [[sl.material for sl in o.material_slots] for o in objs]
                for o in objs:
                    for sl in o.material_slots:
                        sl.material = holdouts[bool(rd.get("holdout_culled")) and o is ob]
                for ph, wob in enumerate(wl["objs"]):
                    wob.hide_render = False
                    wob.matrix_world = Rz4.copy()
                    wpath = f"{job['sprites_raw_dir']}/{stem}_w{ph}_d{i}.png"
                    render_to(wpath)
                    wob.hide_render = True
                    wheel_files[ph].append(wpath)
                for o, mats in zip(objs, saved):
                    for sl, m in zip(o.material_slots, mats):
                        sl.material = m
            R3 = Rz4.to_3x3()
            head = R3 @ Vector((1, 0, 0))
            hv = Vector((head.dot(right), -head.dot(up)))
            hv.normalize()
            t_ = rd["tiles"]
            rot_tiles = t_[::-1] if cat == "building" and round(yaw_d / 90) % 2 else t_
            dirs.append({"index": i, "yaw_deg": yaw_d, "facing": facing, "file": path,
                         "screen_heading": [round(hv.x, 4), round(hv.y, 4)],
                         "tiles": rot_tiles,
                         "footprint_px": [to_px(R3 @ c) for c in fp]})
            log(f"{part or 'dir'} {i} ({yaw_d:.0f} deg) rendered in {time.time() - tr:.1f}s")
        if lit_files:
            out_lit.append({"part": f"{part or 'body'}@lit", "tiles": rd["tiles"], "footprint_m": rd["footprint_m"],
                            "compression": rd["comp"].round(4).tolist(),
                            "final_dims_m": (phi - plo).round(3).tolist(),
                            "canvas_px": [W, H], "anchor_px": [ax, ay],
                            "dirs": [dict(d, file=f) for d, f in zip(dirs, lit_files)]})
        for ph, files in enumerate(wheel_files):
            out_lit.append({"part": f"{part or 'body'}@w{ph}", "tiles": rd["tiles"], "footprint_m": rd["footprint_m"],
                            "compression": rd["comp"].round(4).tolist(),
                            "final_dims_m": (phi - plo).round(3).tolist(),
                            "canvas_px": [W, H], "anchor_px": [ax, ay],
                            "dirs": [dict(d, file=f) for d, f in zip(dirs, files)]})
        out.append({"part": part, "tiles": rd["tiles"], "footprint_m": rd["footprint_m"], "gear": rd.get("gear"),
                    "wheels": {"phases": wl["phases"], "cycle_m": wl["cycle_m"]} if wl else None,
                    "profile": rd.get("profile"), "anchors": rd.get("anchors"),
                    "compression": rd["comp"].round(4).tolist(),
                    "final_dims_m": (phi - plo).round(3).tolist(),
                    "canvas_px": [W, H], "anchor_px": [ax, ay], "dirs": dirs})
    return out + out_lit


def painted_shading(g, r):
    """Painted shading: the colour times ambient + light * max(0, N.L), L fixed to the game camera."""
    cam_rot = Euler((math.radians(90 - g["elevation_deg"]), 0, math.radians(g["azimuth_deg"]))).to_matrix()
    light = cam_rot @ Vector(r.get("light_cam", (-0.5, 0.7, 0.5)))
    light.normalize()
    return {"light_world": tuple(light), "ambient": r.get("ambient_level", 1.0), "light": r.get("light_level", 0.0)}


def parametric_bogie(job):
    """A bogie built from its spec (bogies.json) instead of a reconstruction: no image, no alignment;
    the group is already in the game frame with its pivot at the origin."""
    a, g, r, ccfg = job["asset"], job["grid"], job["render"], job["class_cfg"]
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    spec = job["bogie"]
    tile = g["tile_m"]
    shading = painted_shading(g, r)
    colors = {k: np.array(v, dtype=np.float64) / 255 for k, v in spec["colors"].items()}
    bob = running_gear.bogie(a["id"], spec, tile, colors, shading)
    M = Matrix.Identity(4)
    plo, phi = local_bounds(bob, M)
    res_x = int(r.get("resolution", 1))
    k_px = g["tile_px"] / (tile * math.sqrt(2)) * res_x
    ss = int(r["supersample"])
    setup_render(r, 64, 64)
    L = add_sun(r)
    shadow = False
    debug, debug_cams = {}, {}
    if r["debug_views"]:
        dcam = make_camera("debug_cam")
        for name, view in (("front", "front"), ("side", "side"), ("top", "top")):
            path = f"{job['debug_dir']}/{a['id']}_{name}.png"
            debug_cams[name] = debug_view([(bob, M)], dcam, view, path, r["debug_res"])
            debug[name] = path
    renders = [{"part": None, "ob": bob, "M": M, "lo": plo, "hi": phi, "comp": np.ones(3), "tiles": None,
                "footprint_m": [float(phi[0] - plo[0]), float(phi[1] - plo[1])]}]
    out = render_sets(job, renders, [bob], shadow, L, k_px, ss, res_x)
    meta = {
        "id": a["id"], "category": "bogie", "plan": None, "tiles": None, "footprint_m": renders[0]["footprint_m"],
        "scale": 1.0, "scale_ref": "parametric (bogies.json)", "compression": out[0]["compression"],
        "real_dims_m": None, "final_dims_m": out[0]["final_dims_m"], "split": None, "width_fix": 1.0,
        "px_per_m": round(k_px, 5), "supersample": ss, "resolution": res_x, "source": None, "spec": spec,
        "anchor": "the pivot the game hangs the bogie at, on the rail; continuous px coords from top-left",
        "align": {"mode": "parametric"}, "warnings": [], "debug": debug, "debug_cams": debug_cams, "renders": out,
        "seconds": round(time.time() - t0, 1),
    }
    with open(job["meta_path"], "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    log(f"done {a['id']} (parametric) in {meta['seconds']}s -> {job['meta_path']}")


# ---------------- main ----------------
def main():
    job = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
    if job.get("bogie"):
        return parametric_bogie(job)
    a, g, r, al = job["asset"], job["grid"], job["render"], job["align"]
    ccfg = job["class_cfg"]
    cat = a["category"]
    t0 = time.time()
    warnings = []

    obj = import_mesh(job["glb"])
    mw0 = obj.matrix_world.copy()
    V, N, nv, nf = mesh_arrays(obj, al["sample_faces"])
    log(f"{a['id']}: {nv} verts, {nf} faces, import {time.time() - t0:.1f}s")

    shading = painted_shading(g, r)

    # 0. the source's own colours onto the mesh, and the measured landmarks off it
    src_report, view = None, None
    if job.get("source"):
        P_src = surface_points(obj, 3000000)
        view = source_texture.fit_view(P_src, job["source"]["image"], job["source"]["mask"],
                                       job.get("source_cfg") or {})
        m_persp = float((job.get("fit") or {}).get("deperspective") or 0.0)
        if m_persp:
            # the model standard: the camera's perspective out of the mesh, before anything is measured
            obj.data.transform(obj.matrix_world)
            obj.matrix_world = Matrix.Identity(4)
            co_ = np.empty(len(obj.data.vertices) * 3)
            obj.data.vertices.foreach_get("co", co_)
            obj.data.vertices.foreach_set("co", source_texture.warp(co_.reshape(-1, 3), view.fov, m_persp).ravel())
            obj.data.update()
            view.m = m_persp
            mw0 = obj.matrix_world.copy()
            V, N, nv, nf = mesh_arrays(obj, al["sample_faces"])
            P_src = surface_points(obj, 3000000)
            log(f"perspective: {m_persp:.2f} of the source camera's (fov {view.fov:.1f} deg) taken out of the mesh")
    lm = job.get("landmarks") or {}
    if (lm.get("wheels") or lm.get("nose_px")) and not view:
        raise RuntimeError("landmarks need the source crop (models_raw/<id>.source.png): rerun the comfy stage")
    wheels_raw = []
    for w in lm.get("wheels", []):
        rims = []
        for q in w["rim_px"]:
            try:
                rims.append(view.point(q, reach=10))
            except RuntimeError as e:  # the reconstruction may not reach the outline there
                warnings.append(f"wheel {w['name']}: rim point {q} skipped ({e})")
        if not rims:
            raise RuntimeError(f"wheel {w['name']}: no rim point lies on the mesh")
        wheels_raw.append((w, view.point(w["hub_px"]), rims))

    # 1. upright + axis alignment
    align_info = {"mode": a["align"]}
    if a["align"] == "auto" and al["enabled"]:
        (yaw, pitch, roll), score = manhattan_align(N, al["pitch_range"], al["roll_range"])
        align_info.update(yaw=yaw, pitch=pitch, roll=roll, score=round(score, 4))
        log(f"align yaw={yaw:.2f} pitch={pitch:.2f} roll={roll:.2f} score={score:.3f}")
        if score < al["min_score"]:
            raise RuntimeError(f"alignment score {score:.3f} < min_score {al['min_score']}: mesh not boxy enough. "
                               f"Set align=none (and yaw_offset_deg) for this asset.")
        R = compose(yaw, pitch, roll)
    else:
        yaw, R = 0.0, np.eye(3)

    # 2. resolve the 90-degree yaw ambiguity: long horizontal axis on X (= length_m) for every asset;
    #    of the two remaining choices keep the one closest to the photo view (flip with yaw_offset_deg)
    V1 = V @ R.T
    ext = V1.max(0) - V1.min(0)
    cands = []
    for k in range(4):
        total = (yaw + 90 * k + 180) % 360 - 180
        x_long = (ext[0] >= ext[1]) if k % 2 == 0 else (ext[1] >= ext[0])
        if x_long:
            cands.append((abs(total), k))
    k = min(cands)[1]
    R = rz(math.radians(a["yaw_offset_deg"] or 0.0)) @ rz(math.radians(90 * k)) @ R
    if lm.get("nose_px"):
        # a measured point on the nose decides which end is the front
        nose = R @ view.point(lm["nose_px"])
        if nose[0] < float(np.median(V @ R.T, axis=0)[0]):
            R = rz(math.pi) @ R
            align_info["nose_turned"] = True
    wheel_geo = measure_wheels(wheels_raw, R)
    level = lm.get("level") or ("wheels" if (a.get("size_tiles") or 1) <= 1 else "body")
    if cat == "vehicle" and level == "body":
        R, dyaw, dpitch = refine_axes(surface_points(obj, 300000), R)
        align_info.update(refined_yaw_deg=round(dyaw, 3), refined_pitch_deg=round(dpitch, 3))
        log(f"refined: yaw {dyaw:+.2f} deg, pitch {dpitch:+.2f} deg (body band)")
        wheel_geo = measure_wheels(wheels_raw, R)
    elif len(wheel_geo) >= 2:
        # level the chassis: the wheel bottoms of the source on one line (a reconstruction tilts)
        xs = np.array([hc[0] for _, hc, _ in wheel_geo])
        zb = np.array([hc[2] - rad for _, hc, rad in wheel_geo])
        fit = np.polyfit(xs, zb, 1)
        res = np.abs(zb - np.polyval(fit, xs))
        keep = res <= max(3 * np.median(res), 1e-9)  # one badly measured wheel must not tilt the rest
        if keep.sum() >= 2:
            fit = np.polyfit(xs[keep], zb[keep], 1)
        tilt = math.atan(fit[0])
        R = ry(tilt) @ R
        wheel_geo = measure_wheels(wheels_raw, R)
        align_info["levelled_deg"] = round(math.degrees(tilt), 3)
    fitd = job.get("fit") or {}
    zrail_raw = None
    for key, rot in (("yaw_deg", rz), ("pitch_deg", ry), ("roll_deg", rx)):
        if fitd.get(key):  # set by hand where the automatic alignment is off
            R = rot(math.radians(fitd[key])) @ R
    wheel_slope, x_mid_raw = 0.0, 0.0
    if cat == "vehicle" and fitd.get("stance") == "support":
        # where the model's own wheels put the rail. A body squared up above (level "body") keeps
        # its pose and its running gear is slid onto a level rail further down (gear_shear); a small
        # engine without that squaring up is turned as a whole until its wheels stand level.
        slope, z_mid, x_mid_raw, n_on = support_line(surface_points(obj, 300000) @ R.T)
        if level == "body" and fitd.get("stance_mode", "shear") == "shear":
            wheel_slope, zrail_raw = slope, z_mid
            align_info.update(stance="shear", stance_pitch_deg=round(math.degrees(math.atan(slope)), 3),
                              stance_wheels=n_on)
            log(f"stance: the wheels run {math.degrees(math.atan(slope)):+.2f} deg off the body's level "
                f"({n_on} slices on the rail): the running gear is slid onto a level rail, the body stays")
        else:
            best = None
            for sign in (1.0, -1.0):
                R_try = ry(sign * math.atan(slope)) @ R
                s2, z2, m2, n2 = support_line(surface_points(obj, 300000) @ R_try.T, max_deg=2.0)
                if best is None or abs(s2) < abs(best[1]):
                    best = (R_try, s2, z2, m2, n2)
            R, wheel_slope, zrail_raw, x_mid_raw = best[0], best[1], best[2], best[3]
            align_info.update(stance="turn", stance_pitch_deg=round(math.degrees(math.atan(slope)), 3),
                              stance_left_deg=round(math.degrees(math.atan(best[1])), 3), stance_wheels=best[4])
            log(f"stance: turned {math.degrees(math.atan(slope)):+.2f} deg to stand on its wheels "
                f"({best[4]} slices on the rail, {math.degrees(math.atan(best[1])):+.2f} deg left to the gear slide)")
        wheel_geo = measure_wheels(wheels_raw, R)
    if view is not None:
        # the source's colours onto the texture, now that the vehicle's centre plane is known (the
        # side the source camera never saw takes its mirror twin's colours)
        extras = []
        # a rear view is the source's camera turned 180 degrees round the vehicle (REAR-VIEWS.md)
        cam = R @ (source_texture.camera_position(view.fov) - (P_src.min(0) + P_src.max(0)) / 2)
        rear_az = math.atan2(cam[1], cam[0]) + math.pi
        for vp in job.get("views", []):
            # more images of the same vehicle (a rear three-quarter view): their cameras are fitted to
            # the aligned mesh's silhouette, and they colour what the source cannot see
            try:
                extras.append(source_texture.ExtraView(
                    vp, P_src, R, view.fov, job.get("source_cfg") or {},
                    debug_path=f"{job['debug_dir']}/{a['id']}_view{len(extras) + 1}.png",
                    expect_az=rear_az if Path(vp).stem.endswith("-rear") else None))
            except RuntimeError as e:
                warnings.append(f"extra view skipped: {e}")
        src_report = source_texture.reproject(obj, view, job["source"]["texture"], job.get("source_cfg") or {},
                                              mirror=R if (cat == "vehicle" and lm.get("mirror", True)) else None,
                                              extras=extras)
    if r.get("shading") == "painted":
        running_gear.repaint(obj, shading)
    part_models = {pid: load_part(spec, R, job.get("source_cfg") or {}, shading, r.get("shading") == "painted")
                   for pid, spec in (job.get("parts") or {}).items()}
    for pid, pm in part_models.items():
        pm.hide_render = True
        log(f"part {pid}: reconstructed from its own image, painted and mirrored")
    V2 = V @ R.T
    lo, hi = V2.min(0), V2.max(0)
    dims = hi - lo

    # 3. real-world scale
    if cat in ("vehicle", "bogie") and lm.get("scale") and len(wheel_geo) >= 2:
        # a real dimension between two measured wheels (a coupled or truck wheelbase) sets the scale
        by = {w["name"]: hc for w, hc, _ in wheel_geo}
        w0, w1 = lm["scale"]["between"]
        s = lm["scale"]["m"] / abs(by[w0][0] - by[w1][0])
        ref = f"{w0}-{w1} = {lm['scale']['m']} m"
    elif cat == "vehicle" and fitd.get("roof_height_m"):
        # an engine drawn with its pantograph up: the roof, not the top, is the height to hold on to
        rail = zrail_raw if zrail_raw is not None else lo[2]
        Pr = surface_points(obj, 200000) @ R.T
        edges = np.linspace(lo[0] + 0.1 * dims[0], hi[0] - 0.1 * dims[0], 49)
        col = np.digitize(Pr[:, 0], edges) - 1
        tops = [float(Pr[col == b, 2].max()) for b in range(48) if (col == b).sum() >= 20]
        s = fitd["roof_height_m"] / (float(np.percentile(tops, 50)) - rail)
        ref = "roof_height_m"
    elif cat == "vehicle" and a.get("height_m"):
        # the prototype's height over the rail: the dimension a person is measured against, and one
        # an illustration keeps better than its compressed lengths
        rail = zrail_raw if zrail_raw is not None else (
            float(np.median([hc[2] - rad for _, hc, rad in wheel_geo])) if wheel_geo else lo[2])
        s = a["height_m"] / (hi[2] - rail)
        ref = "height_m"
    elif cat in ("vehicle", "bogie"):
        s = a["length_m"] / dims[0]
        ref = "length_m"
    else:
        ref = next(k_ for k_ in ("height_m", "length_m", "width_m") if a.get(k_))
        s = a[ref] / dims[{"height_m": 2, "length_m": 0, "width_m": 1}[ref]]
    std = cat == "vehicle" and bool(fitd.get("standard"))
    if std and fitd.get("uniform_k"):
        s *= float(fitd["uniform_k"])  # smaller (or larger) than life as a whole, never along one axis
        ref += f" x {float(fitd['uniform_k']):.3f}"
    real = dims * s
    # width from the body, not from a stray reconstructed blob: the 0.5th to 99.5th percentile across
    # of area-weighted surface points (a wheel is a lot of surface, a stray lump little)
    Ps = surface_points(obj, 200000) @ R.T
    body_w = float(np.subtract(*np.percentile(Ps[:, 1], [99.5, 0.5]))) * s
    width_fix = 1.0
    if cat == "vehicle" and a.get("width_m") and ref != "width_m" and not std:
        # an illustration is rarely drawn to scale across; the real width keeps the body in
        # proportion to the rails (gauge and width both go into the game at DRAWN_WIDTH)
        width_fix = a["width_m"] / body_w
        real[1] = real[1] * width_fix
    for key, i in (("length_m", 0), ("width_m", 1), ("height_m", 2)):
        if a.get(key) and key != ref and not (key == "width_m" and width_fix != 1.0):
            err = real[i] / a[key] - 1
            if abs(err) > ccfg["max_dim_error"]:
                warnings.append(f"{key}: model {real[i]:.2f} m vs spec {a[key]} m ({err:+.0%})")

    # 4. class compression + tiles -> renderables: one per sprite set, {part, ob, M, lo, hi, ...}
    tile = g["tile_m"]
    M_real = to4(s * R) @ mw0  # raw object -> aligned, real metres, not yet centred
    lo_r, hi_r = lo * s, hi * s
    scene_objs = [obj]
    renders = []
    split = None
    if cat in ("vehicle", "bogie"):
        # body.ts: stock is drawn DRAWN_WIDTH wider than its LENGTH scale. A compressed body is narrowed
        # with its length, so the image's proportions survive; a short one is never widened by a stretch
        # run.py --lengths: the game's own segments (src/data/gear.json) at a length of any size,
        # [(part, tiles, rendered)] front to back, in place of the plan's
        gear_parts = [tuple(p) for p in job["gear_parts"]] if job.get("gear_parts") else None
        cx_all = 1.0
        if cat == "vehicle" and ccfg.get("width_follows_length", True):
            n_parts = sum(1 for p in (gear_parts or game_rules.plan_parts(a.get("plan") or "rigid",
                                                                          a.get("size_tiles") or 1)) if p[2]) \
                if a.get("size_tiles") else 1
            cx_all = min(1.0, ((a.get("size_tiles") or 1) * tile - n_parts * ccfg["coupler_gap_m"]) / real[0])
        wf = game_rules.DRAWN_WIDTH * width_fix * cx_all
        if std:
            wf = 1.0
        elif cat == "vehicle" and fitd.get("width_k"):
            wf = float(fitd["width_k"]) * width_fix  # the real width times this
        elif cat == "vehicle" and gear_parts:
            # at its own length a body is hardly compressed, and DRAWN_WIDTH on top of that reads as
            # too wide: between the real width and a fifth more
            wf = min(1.2, max(1.0, game_rules.DRAWN_WIDTH * cx_all)) * width_fix
        if cat == "vehicle" and gear_parts:
            size_tiles, parts = a["size_tiles"], gear_parts
        elif cat == "vehicle":
            size_tiles = a.get("size_tiles") or max(1, round(real[0] / tile))
            if size_tiles not in game_rules.SIZE_TILES and size_tiles not in game_rules.CLASS_SIZE_TILES:
                raise RuntimeError(f"{real[0]:.1f} m makes {size_tiles} tiles; the game's bodies are "
                                   f"{sorted(game_rules.SIZE_TILES)}. Set size_tiles.")
            parts = game_rules.plan_parts(a.get("plan") or "rigid", size_tiles)
        else:
            size_tiles, parts = None, [(None, None, True)]
        # cut positions in metres from the nose (+X); the game's segment proportions are the guess
        total = sum(p[1] for p in parts) if size_tiles else 1
        expected, acc = [], 0.0
        for p in parts[:-1]:
            acc += p[1]
            expected.append(acc / total * real[0])
        if a.get("split_m"):
            cuts = list(a["split_m"])
            if len(cuts) != len(expected):
                raise RuntimeError(f"split_m has {len(cuts)} cuts; plan {a.get('plan')} needs {len(expected)}")
            split = {"mode": "given", "cuts_m": cuts}
        elif expected:
            P = surface_points(obj, 200000) @ (s * R).T
            cuts, score = find_cuts(P, hi_r[0], real[0], expected, 0.12 * real[0])
            split = {"mode": "auto", "cuts_m": cuts, "expected_m": [round(e, 2) for e in expected]}
            if a["yaw_offset_deg"] is None and not lm.get("nose_px"):
                # the photo cannot tell nose from tail; an engine + tender can: its joints are where
                # the plan puts them from one end only. Turn round when the other end fits better.
                Pf = P * np.array([-1.0, -1.0, 1.0])
                cuts_f, score_f = find_cuts(Pf, -lo_r[0], real[0], expected, 0.12 * real[0])
                if score_f < score:
                    R = rz(math.pi) @ R
                    M_real = to4(s * R) @ mw0
                    lo_r, hi_r = np.array([-hi_r[0], -hi_r[1], lo_r[2]]), np.array([-lo_r[0], -lo_r[1], hi_r[2]])
                    wheel_slope, x_mid_raw = -wheel_slope, -x_mid_raw  # the wheel line turns with it
                    cuts = cuts_f
                    split.update(cuts_m=cuts, turned=True)
                    warnings.append("turned round: the plan's joints fit better from the other end "
                                    "(set yaw_offset_deg to decide)")
        else:
            cuts = []
        if split:
            log(f"split {split['mode']} at {cuts} m from the nose (plan guess {[round(e, 2) for e in expected]})")
        # a reconstruction may run a piece out past the vehicle's ends (buffers drawn out into a horn):
        # trim_front_m / trim_rear_m (real metres) cut it off before the parts are measured
        bounds = [float(lm.get("trim_front_m", 0.0))] + cuts + [real[0] - float(lm.get("trim_rear_m", 0.0))]
        if any(b1 <= b0 for b0, b1 in zip(bounds, bounds[1:])):
            raise RuntimeError(f"cuts {cuts} are not in order inside 0..{real[0]:.1f} m")
        std_parts = None
        if std:
            # the model standard: nothing is stretched, so each part is as long as the model has it and
            # the vehicle's length in tiles follows. A part drawn as its namesake's mirror is as long as
            # the one that is rendered.
            lens = [(b1 - b0 + ccfg["coupler_gap_m"]) / tile for b0, b1 in zip(bounds, bounds[1:])]
            drawn = {p_[0]: lens[i] for i, p_ in enumerate(parts) if p_[2]}
            lens = [lens[i] if p_[2] else drawn.get(p_[0], lens[i]) for i, p_ in enumerate(parts)]
            given_tiles = size_tiles
            parts = [(p_[0], round(float(l_), 4), p_[2]) for p_, l_ in zip(parts, lens)]
            size_tiles = round(float(sum(lens)), 4)
            acc_, std_parts = size_tiles, []
            for p_ in parts:  # front to back; fractions run from the rear end (0) to the nose (1)
                std_parts.append({"part": p_[0], "from": round((acc_ - p_[1]) / size_tiles, 4),
                                  "to": round(acc_ / size_tiles, 4), "mirror": not p_[2]})
                acc_ -= p_[1]
            log(f"standard: {size_tiles} tiles from the model's own length (the table said {given_tiles}); "
                f"parts {[(p_[0], p_[1]) for p_ in parts]}")
        # clip heights: one for every part, or one per rendered part (an engine above its drivers,
        # a tender above its own wheels)
        clips = list(a.get("clip_below_m") or [0.0])
        n_rendered = sum(1 for p in parts if p[2])
        if len(clips) == 1:
            clips *= n_rendered
        if len(clips) != n_rendered:
            raise RuntimeError(f"clip_below_m has {len(clips)} heights; {n_rendered} parts are rendered")
        clips = iter(clips)
        yc, zg = (lo_r[1] + hi_r[1]) / 2, lo_r[2]
        if zrail_raw is not None:
            zg = zrail_raw * s  # the rail is under the wheels, not under the lowest stray point
        sym = cat == "vehicle" and view is not None and lm.get("symmetric", True)
        if sym:
            # the seen side is the one facing the source camera; the plane between the sides' outer
            # surfaces is the vehicle's centre plane, and the track's centre line
            Pa = surface_points(obj, 200000) @ (s * R).T
            yc = float(np.mean(np.percentile(Pa[:, 1], [1, 99])))
            cam_y = float(((s * R) @ source_texture.camera_position(view.fov))[1])
            log(f"symmetric: the {'-Y' if cam_y < yc else '+Y'} side is seen; centre plane y = {yc:+.3f} m")
        # measured wheels: the vehicle stands on them, so their bottoms are the rail plane
        wheels_real = [{"w": w, "x": hc[0] * s, "z": hc[2] * s, "d": 2 * rad * s} for w, hc, rad in wheel_geo]
        if wheels_real and lm.get("rail") != "lowest":
            zg = float(np.median([wr["z"] - wr["d"] / 2 for wr in wheels_real]))
        zg += float(fitd.get("lift_m") or 0.0) * -1.0  # by hand: raise the vehicle by this much
        lit_image = None
        ann = job.get("annot") or {}
        if cat == "vehicle" and view is not None and view.tex is not None and ann.get("windows"):
            lit_image, lit_share = source_texture.window_mask(view, ann["windows"], job.get("source_cfg") or {},
                                                              f"{a['id']}_windows")
            log(f"windows: {len(ann['windows'])} panes of the source light {lit_share:.2%} of the texels")
            lit_mats = (running_gear.mask_material("window_light", lit_image), running_gear.mask_material("dark"))
        # points marked on the source (chimney tops, headlamps), on the mesh in real metres
        marks = {}
        if cat == "vehicle" and view is not None:
            for kind in ("smoke", "headlamps"):
                for px in ann.get(kind) or []:
                    try:
                        marks.setdefault(kind, []).append((s * R) @ view.point(px, reach=12))
                    except RuntimeError as e:
                        warnings.append(f"{kind} point {px} skipped ({e})")
        for wr in wheels_real:
            if wr["w"].get("d_m"):
                # a real diameter for a wheel the source hides behind its frame (only an axle box and the
                # tyre's bottom show): it keeps its measured axle position and stands on the rail plane
                wr["d"] = float(wr["w"]["d_m"])
                wr["z"] = zg + wr["d"] / 2
        if os.environ.get("TP_DUMP"):
            # measuring only (train-sizes/distortion): the aligned model in real metres, untouched
            Pd = surface_points(obj, 600000) @ (s * R).T
            me_ = obj.data
            me_.calc_loop_triangles()
            ti_ = np.empty(len(me_.loop_triangles) * 3, np.int32)
            me_.loop_triangles.foreach_get("vertices", ti_)
            vc_ = np.empty(len(me_.vertices) * 3)
            me_.vertices.foreach_get("co", vc_)
            mw_ = np.array(obj.matrix_world)
            vc_ = vc_.reshape(-1, 3) @ mw_[:3, :3].T + mw_[:3, 3]
            ti_ = ti_.reshape(-1, 3)
            pick_ = np.random.default_rng(3).choice(len(ti_), min(len(ti_), 250000), replace=False)
            Td = (vc_[ti_[pick_]] @ (s * R).T).astype(np.float32)
            np.savez_compressed(os.path.join(os.environ["TP_DUMP"], a["id"] + ".npz"), P=Pd.astype(np.float32),
                                zg=zg, yc=yc, s=s, real=real, hi=hi_r, lo=lo_r, bounds=np.array(bounds),
                                wheel_slope=wheel_slope, x_mid=x_mid_raw * s, R=np.asarray(R), T=Td,
                                fov=(view.fov if view is not None else 0.0),
                                parts=np.array([str(p_[0]) for p_ in parts]),
                                tiles=np.array([float(p_[1] or 0) for p_ in parts]))
            log(f"dumped {a['id']} for measuring")
            if os.environ.get("TP_DUMP_ONLY", "1") == "1":
                return
        post_fix = None  # what the stance check finds left over, for every part
        for part_i, ((part, L_tiles, rendered), d0, d1) in enumerate(zip(parts, bounds, bounds[1:])):
            if not rendered:
                continue
            clip = next(clips)
            ob = obj.copy()
            ob.data = obj.data.copy()
            ob.name = f"part_{part}"
            bpy.context.scene.collection.objects.link(ob)
            ob.data.transform(M_real)
            ob.matrix_world = Matrix.Identity(4)
            if sym:
                w0, w1 = running_gear.symmetrize(ob, yc, cam_y < yc)
                # the width was measured before; the mirrored far side keeps it
                ob.data.transform(Matrix.Translation((0, yc, 0)) @ Matrix.Diagonal((1, w0 / w1, 1, 1))
                                  @ Matrix.Translation((0, -yc, 0)))
                log(f"{part or 'body'}: far side rebuilt as the mirror of the seen side (width {w1 / w0 - 1:+.1%} "
                    f"before keeping the measured width)")
            if cat == "vehicle" and fitd.get("rail_half_m") and fitd.get("gauge_warp", not std):
                gw = gauge_warp(ob, yc, zg, float(fitd["rail_half_m"]) / wf,
                                float(fitd.get("roof_height_m") or real[2]))
                if gw:
                    log(f"{part or 'body'}: wheels stood {gw[0] * wf:.2f} m from the centre line, rails are at "
                        f"{fitd['rail_half_m']:.2f} m: running gear moved {gw[1] * wf:+.2f} m across")
            if cat == "vehicle" and wheel_slope:
                gear_shear(ob, x_mid_raw * s, zg, wheel_slope, float(fitd.get("roof_height_m") or real[2]))
            if cat == "vehicle" and zrail_raw is not None and "stance_after_deg" not in align_info:
                # the check: the same search on the finished model must find a level rail at zg. The
                # first search saw both sides of the raw model; the far side is now the seen side's
                # mirror and the wheels sit on the gauge, so a little can be left over. Where the
                # check stands on enough of the wheels, that is put right too.
                s3, z3, xm3, n3 = support_line(surface_points(ob, 200000), max_deg=4.0)
                align_info.update(stance_after_deg=round(math.degrees(math.atan(s3)), 3),
                                  stance_after_gap_m=round(z3 - zg, 4), stance_after_wheels=n3)
                log(f"stance check: wheel line {math.degrees(math.atan(s3)):+.2f} deg, {z3 - zg:+.3f} m off the rail, "
                    f"{n3} slices on it")
                if n3 >= 8 and (abs(math.degrees(math.atan(s3))) >= 0.3 or abs(z3 - zg) > 0.02):
                    post_fix = (s3 if abs(math.degrees(math.atan(s3))) >= 0.3 else 0.0, xm3, z3)
                    if abs(z3 - zg) > 0.02:
                        zg = z3  # the whole vehicle down (or up) onto its wheels
                    align_info.update(stance_fixed_after=True)
                    log(f"stance: the residual put right ({math.degrees(math.atan(post_fix[0])):+.2f} deg slid, "
                        f"rail at {z3:+.3f} m)")
            if post_fix and post_fix[0]:
                gear_shear(ob, post_fix[1], post_fix[2], post_fix[0], float(fitd.get("roof_height_m") or real[2]))
            x_hi, x_lo = hi_r[0] - d0, hi_r[0] - d1
            if d0 > 0:
                clip_mesh(ob, (x_hi, 0, 0), (1, 0, 0))
            if d1 < real[0]:
                clip_mesh(ob, (x_lo, 0, 0), (-1, 0, 0))
            if clip > 0:
                clip_mesh(ob, (0, 0, zg + clip), (0, 0, -1))  # running gear the game draws itself
            length = d1 - d0
            if cat == "vehicle":
                slot = L_tiles * tile - ccfg["coupler_gap_m"]
                cx = 1.0 if std else slot / length
                lo_c, hi_c = ccfg["compress_range"]
                if not lo_c <= cx <= hi_c:
                    raise RuntimeError(f"{part or 'body'}: length factor {cx:.2f} outside {ccfg['compress_range']} "
                                       f"({length:.1f} m into {L_tiles} tiles). Change size_tiles, length_m or split_m.")
                if cx > ccfg.get("stretch_max", hi_c) and not gear_parts:
                    # a short prototype is stretched only so far; it then stands shorter than its slot
                    warnings.append(f"{part or 'body'}: {length:.1f} m would stretch {cx:.2f}x into {L_tiles} "
                                    f"tile(s); kept at {ccfg['stretch_max']}x, {length * ccfg['stretch_max']:.1f} m")
                    cx = ccfg["stretch_max"]
                tiles_p, footprint = [L_tiles, 1], [L_tiles * tile, tile]
            else:
                cx = a.get("length_factor") or ccfg["length_factor"]  # its vehicles' compression
                tiles_p, footprint = None, None
            comp = np.array([cx, wf, 1.0])
            # centred on its own middle and the track, standing where the whole vehicle stands
            M = to4(np.diag(comp)) @ Matrix.Translation(Vector((-(x_hi + x_lo) / 2, -yc, -zg)))
            if cat == "bogie" and a.get("anchor_offset_m"):
                # the game hangs a bogie at its pivot; a steam driver set sits ahead of the rear
                # pivot, so draw it that far forward of its anchor (metres, after compression)
                M = Matrix.Translation(Vector((a["anchor_offset_m"], 0, 0))) @ M
            extras, gear = [], []
            pname = part or "body"
            if pname in lm.get("detaper", []):
                dw, dh = detaper(ob, x_lo, x_hi, yc, zg)
                log(f"{pname}: de-tapered, removed {dw:+.2f} m of width and {dh:+.2f} m of roof height change "
                    f"along the body")
            xmid = (x_hi + x_lo) / 2
            final_x = {wr["w"]["name"]: cx * (wr["x"] - xmid) for wr in wheels_real if x_lo <= wr["x"] <= x_hi}
            train_bogies = [tb for tb in lm.get("bogies", []) if tb["part"] == pname]
            chunks, attached, own = {}, {}, {}
            for tb in train_bogies:
                if tb.get("mesh"):
                    ch = ob.copy()
                    ch.data = ob.data.copy()
                    ch.name = f"bogie_{tb['style']}"
                    bpy.context.scene.collection.objects.link(ch)
                    xs_ = [xf / cx + xmid for xf in tb["mesh"]["x"]]
                    n_keep = running_gear.keep_box(ch, min(xs_), max(xs_), zg + tb["mesh"]["top"])
                    dyaw, dpitch = running_gear.square_up(ch, (min(xs_) + max(xs_)) / 2, zg)
                    running_gear.cull_backfaces(ch)
                    chunks[tb["style"]] = own[tb["style"]] = ch
                    log(f"{pname}: bogie {tb['style']} keeps {n_keep} faces of the model's own truck, "
                        f"squared up by yaw {dyaw:+.2f}, pitch {dpitch:+.2f} deg")
                    if tb.get("model"):
                        # a truck reconstructed from its own image takes the place of the model's own
                        src_pm = part_models[tb["model"]]
                        pm = src_pm.copy()
                        pm.data = src_pm.data.copy()
                        pm.name = f"bogie_{tb['style']}_part"
                        pm.hide_render = False
                        bpy.context.scene.collection.objects.link(pm)
                        sx, sy = fit_part(pm, ch, zg)
                        ch.hide_render = True  # replaced; kept only to mark its texels
                        dyaw, dpitch = running_gear.square_up(pm, (min(xs_) + max(xs_)) / 2, zg)
                        chunks[tb["style"]] = pm
                        log(f"{pname}: bogie {tb['style']} from part {tb['model']} (scaled {sx:.3f} along, "
                            f"{sy:.3f} across, squared up by yaw {dyaw:+.2f}, pitch {dpitch:+.2f} deg)")
                for at in tb.get("attach", []):
                    # end gear the prototype hangs on this bogie (a Crocodile's or GG1's frame ends):
                    # it leaves the body and turns with the bogie, kept where it is relative to the pivot
                    ch2 = ob.copy()
                    ch2.data = ob.data.copy()
                    ch2.name = f"attach_{tb['style']}"
                    bpy.context.scene.collection.objects.link(ch2)
                    xs2 = [xf / cx + xmid for xf in at["x"]]
                    running_gear.keep_box(ch2, min(xs2), max(xs2), zg + at["top"])
                    running_gear.cull_backfaces(ch2)
                    attached.setdefault(tb["style"], []).append(ch2)
                    n_at = running_gear.cut_box(ob, min(xs2), max(xs2), zg + at["top"])
                    log(f"{pname}: {n_at} faces of end gear go with bogie {tb['style']} ({at.get('note', '')})")
            if view is not None and view.tex is not None and (own or attached):
                # hidden texels of each piece that turns with a truck take that piece's own seen colours
                pieces = list(own.values()) + [c_ for cs in attached.values() for c_ in cs]
                source_texture.fill_hidden(view, [source_texture.uv_cover(c_, view.tex["size"]) for c_ in pieces])
                log(f"{pname}: hidden texels refilled per piece ({len(pieces)} pieces apart from the body)")
            for cw in [c_ for c_ in lm.get("cut_wheels", []) if c_["part"] == pname]:
                # coupled wheels baked into the body replace the model's own: outboard of the frames only
                half_w = (hi_r[1] - lo_r[1]) / 2
                sel = [wr for wr in wheels_real if wr["w"]["name"] in cw["wheels"]]
                n_cw = running_gear.cut_wheels(ob, sel, cw.get("inner_y", 0.45) * half_w, y_center=yc,
                                               margin=cw.get("margin", 1.05))
                log(f"{pname}: cut {n_cw} faces of the model's wheels {cw['wheels']}")
            for bk in [b_ for b_ in lm.get("baked", []) if b_["part"] == pname]:
                # running gear rigid with the body (coupled wheels, rods): part of the body sprite
                spec = dict(bk["spec"])
                spec["axles"] = [dict(ax_, x=final_x[ax_["wheel"]]) if "wheel" in ax_ else ax_ for ax_ in spec["axles"]]
                colors = {k: np.array(v, dtype=np.float64) / 255 for k, v in spec["colors"].items()}
                bob = running_gear.bogie(f"baked_{pname}", {"x_scale": 1.0, "offset_m": 0.0, **spec}, tile, colors,
                                         shading)
                extras.append((bob, Matrix.Identity(4)))
                scene_objs.append(bob)
                log(f"{pname}: baked {len(spec['axles'])} axles into the body")
            for cb in [c_ for c_ in lm.get("cut_boxes", []) if c_["part"] == (part or "body")]:
                # the model's own running gear, which the game draws as bogie sprites beneath the body
                xs_ = [xf / cx + (x_hi + x_lo) / 2 for xf in cb["x"]]
                n_box = running_gear.cut_box(ob, min(xs_), max(xs_), zg + cb["top"])
                log(f"{part or 'body'}: cut {n_box} faces in x {cb['x']} m below {cb['top']} m ({cb.get('note', '')})")
            skirts = [sk for sk in lm.get("skirts", []) if sk["part"] == (part or "body")]
            if skirts:
                sob = running_gear.skirts(f"skirt_{part or 'body'}", skirts, tile, shading)
                extras.append((sob, Matrix.Identity(4)))
                scene_objs.append(sob)
            mine = [wr for wr in wheels_real if x_lo <= wr["x"] <= x_hi]
            if mine and cat == "vehicle" and size_tiles > 1:
                # the game draws this part's running gear as bogie sprites; record where the source
                # has its wheels (final frame) for sizing and placing them
                gear = [{"name": wr["w"]["name"], "x_m": round(cx * (wr["x"] - (x_hi + x_lo) / 2), 3),
                         "x_real_m": round(wr["x"] - (x_hi + x_lo) / 2, 3), "d_m": round(wr["d"], 3)}
                        for wr in mine]
                log(f"{part}: measured wheels {gear}")
            elif mine:
                # the model's own wheels go; round ones take their place on the game's rails
                half_w = (hi_r[1] - lo_r[1]) / 2
                n_cut = running_gear.cut_wheels(ob, mine, lm.get("inner_y", 0.7) * half_w, y_center=yc)
                colors = {k: view.color(box) for k, box in lm["color_px"].items()}
                axles = [{"x": cx * (wr["x"] - (x_hi + x_lo) / 2), "d": wr["d"], "spokes": wr["w"].get("spokes", 0)}
                         for wr in mine]
                # gauge_mm (landmarks): narrow-gauge stock, its rails closer by the real rail-centre spacing
                wob = running_gear.wheelset(f"wheels_{part or 'body'}", axles, tile, colors, shading,
                                            gauge_mm=lm.get("gauge_mm"))
                extras.append((wob, Matrix.Identity(4)))
                scene_objs.append(wob)
                gear = [{"x_m": round(ax["x"], 3), "d_m": round(ax["d"], 3), "spokes": ax["spokes"]} for ax in axles]
                log(f"{part or 'body'}: cut {n_cut} faces of the model's wheels, built {len(axles)} axles {gear}")
            body_wheels, built_trucks = None, []
            gi = (job.get("gear_info") or [None] * len(parts))[part_i] if cat == "vehicle" else None
            if gi and gi.get("wheels"):
                # ---- running gear the game draws (run.py --wheels). Each truck leaves the body and
                # becomes a sprite set of its own, hung by the game at its place on the rail; wheels are
                # built round on the game's rails and rendered as layers of their own, one per phase of
                # their turning: under a truck's frame, or over the body they are fixed in.
                wd = gi["wheels"]
                g_fin = float(fitd.get("rail_half_m") or running_gear.half_gauge_m(tile))
                y_model = g_fin / wf  # where the treads stand in the model's own frame (wf widens it)
                Pp = surface_points(ob, 250000)
                xmid_p = (x_hi + x_lo) / 2

                def fin(x):
                    return cx * (x - xmid_p)

                def at(u):
                    return x_lo + u * (x_hi - x_lo)

                def per_axle(v, n, cast=float):
                    return [cast(q) for q in (v if isinstance(v, list) else [v] * n)]

                def build_layers(name, base_spec, ds_f, spokes, drivers, rods):
                    phases, total, share, cycle = wheel_cycle(ds_f, spokes, drivers, rods)
                    objs = []
                    for ph in range(phases):
                        spec = dict(base_spec)
                        spec["turn"] = total * ph / phases
                        spec["axles"] = [dict(ax_, turn=share[i]) for i, ax_ in enumerate(base_spec["axles"])]
                        wob = running_gear.bogie(f"{name}_w{ph}", spec, tile, base_spec["colors"], shading)
                        wob.hide_render = True
                        scene_objs.append(wob)
                        objs.append(wob)
                    return {"objs": objs, "phases": phases, "cycle_m": round(float(cycle), 4)}

                def clear_wheels(mesh_ob, xs, ds, inside):
                    """The model's own wheels go: everything outside the frames (wheels that show), or
                    only the layer the wheels are in (an outside frame stays). Returns the colour they
                    had and how many faces went."""
                    sel = [{"x": x, "z": zg + d_ / 2, "d": d_} for x, d_ in zip(xs, ds)]
                    y_in = max(0.2, y_model - 0.14)
                    y_out = 1e9 if inside else y_model + 0.1

                    def is_wheel(c):
                        return y_in <= abs(c.y - yc) <= y_out and any(
                            (c.x - w_["x"]) ** 2 + (c.z - w_["z"]) ** 2 < (w_["d"] * 0.45) ** 2 for w_ in sel)
                    col = running_gear.faces_colour(mesh_ob, is_wheel)
                    if inside:
                        n = running_gear.cut_wheels(mesh_ob, sel, y_in, y_center=yc, margin=1.08)
                    else:
                        n = running_gear.cut_wheel_discs(mesh_ob, sel, y_in, y_out, y_center=yc)
                    return col, n

                def group_spec(xs_fin, ds, spokes, drivers, rods, k, cols):
                    """bogie() spec of a group of wheels, front to back, and what wheel_cycle needs."""
                    order_ = sorted(range(len(xs_fin)), key=lambda i: -xs_fin[i])
                    axles = [{"x": xs_fin[i], "d_f": k * ds[i], "spokes": spokes[i], "driver": i in drivers}
                             for i in order_]
                    drv_o = [j for j, i in enumerate(order_) if i in drivers]
                    spec = {"scale": k, "x_scale": 1.0, "gauge_half": g_fin, "colors": cols, "axles": axles}
                    if rods and drv_o:
                        spec["rods"] = rod_spec(rods, axles, drv_o, k, cx)
                    return spec, [a_["d_f"] for a_ in axles], [a_["spokes"] for a_ in axles], drv_o

                # the model's own running gear where the game draws none (a truck the picture has and
                # the gear table drops), and what hangs there instead (a fuel tank)
                for cl in wd.get("clear", []):
                    n_c = running_gear.cut_box(ob, at(cl["u"][0]), at(cl["u"][1]), zg + float(cl["top"]))
                    log(f"{pname}: {n_c} faces of the model's own gear cleared at {cl['u']} below {cl['top']} m")
                for ti_k, tk in enumerate(wd.get("tanks", [])):
                    tb_ = running_gear.Builder(f"tank_{pname}_{ti_k}", {"tank": np.array(tk["color"]) / 255}, shading)
                    r_t = float(tk["d"]) / 2
                    tb_.barrel((0.0, float(tk.get("z", r_t + 0.25))), r_t, fin(at(tk["u"][0])), fin(at(tk["u"][1])),
                               "tank", n=20)
                    tob = tb_.finish()
                    extras.append((tob, Matrix.Identity(4)))
                    scene_objs.append(tob)
                    log(f"{pname}: tank built at {tk['u']}, {tk['d']} m across")
                # one factor for every wheel of the part: the smallest any of its groups needs
                ks = []
                tws_all = wd.get("trucks") or []
                for ti_, us_ in enumerate(gi["trucks"]):
                    if not tws_all:
                        raise RuntimeError(f"{pname}: wheels data has no trucks, the gear table has {len(gi['trucks'])}")
                    tw_ = tws_all[min(ti_, len(tws_all) - 1)]
                    ks.append(wheel_factor(cx, [at(u) for u in us_], per_axle(tw_["d"], len(us_))))
                if gi["rigid"]:
                    if not wd.get("rigid"):
                        raise RuntimeError(f"{pname}: wheels data has no rigid axles, the gear table has {len(gi['rigid'])}")
                    ks.append(wheel_factor(cx, [at(u) for u in gi["rigid"]], per_axle(wd["rigid"]["d"], len(gi["rigid"]))))
                k_part = float(wd.get("scale") or min(ks))
                trucks_only = not gi["rigid"] and len(gi["trucks"]) >= 2
                order = sorted(range(len(gi["trucks"])), key=lambda i: -float(np.mean(gi["trucks"][i])))
                for ti, us in enumerate(gi["trucks"]):
                    tw = tws_all[min(ti, len(tws_all) - 1)]
                    n_ax = len(us)
                    ds = per_axle(tw["d"], n_ax)
                    spokes = per_axle(tw.get("spokes", 0), n_ax, int)
                    d = max(ds)
                    outside = tw.get("frame", "outside") == "outside"
                    rods = tw.get("rods")
                    ax_m = find_axles(Pp, yc, zg, x_lo, x_hi, us, ds)
                    xs_a = [m_["x"] for m_ in ax_m]
                    x0, x1 = min(xs_a) - 0.62 * d, max(xs_a) + 0.62 * d
                    if trucks_only and tw.get("end_gear", True):
                        # end gear of a body on two or more trucks turns with them (pilot, coupler, steps)
                        if ti == order[0]:
                            x1 = x_hi + 0.01
                        if ti == order[-1]:
                            x0 = x_lo - 0.01
                    x0, x1 = max(x0, x_lo - 0.01), min(x1, x_hi + 0.01)
                    top = float(tw.get("top", (1.08 if outside else 0.92) * d))
                    ch = ob.copy()
                    ch.data = ob.data.copy()
                    ch.name = f"truck_{pname}_{ti}"
                    bpy.context.scene.collection.objects.link(ch)
                    n_keep = running_gear.keep_box(ch, x0, x1, zg + top)
                    n_cut = running_gear.cut_box(ob, x0, x1, zg + top)
                    dyaw = dpitch = dz = 0.0
                    ky = 1.0
                    if outside:
                        # a truck taken from the model: squared up on its own axis (a turn the search
                        # runs into its limit with is not a finding and is left out), then its own
                        # wheels onto the rail and the gauge, as a whole
                        co0 = np.empty(len(ch.data.vertices) * 3)
                        ch.data.vertices.foreach_get("co", co0)
                        dyaw, dpitch = running_gear.square_up(ch, (x0 + x1) / 2, zg, max_deg=4.0)
                        if abs(dyaw) > 3.85 or abs(dpitch) > 3.85:
                            ch.data.vertices.foreach_set("co", co0)
                            ch.data.update()
                            dyaw = dpitch = 0.0
                        Pc = surface_points(ch, 60000)
                        ax_c = find_axles(Pc, yc, zg, x0, x1, [(x - x0) / (x1 - x0) for x in xs_a], ds)
                        zs = [m_["z"] for m_ in ax_c if m_["z"] is not None]
                        ys = [m_["y"] for m_ in ax_c if m_["y"]]
                        dz = float(np.clip(zg - float(np.mean(zs)), -0.25, 0.25)) if zs else 0.0
                        ky = float(np.clip(y_model / np.median(ys), 0.9, 1.12)) if ys else 1.0
                        ch.data.transform(Matrix.Translation((0, yc, dz)) @ Matrix.Diagonal((1, ky, 1, 1))
                                          @ Matrix.Translation((0, -yc, 0)))
                    base, n_w = clear_wheels(ch, xs_a, ds, not outside) if tw.get("clear", True) else (None, 0)
                    running_gear.cull_backfaces(ch)
                    k = k_part
                    c_real = float(np.mean(xs_a))
                    exp_fin = fin(at(float(np.mean(us))))
                    # the sprite's origin is where the game hangs the truck: the table's place along the
                    # part's whole slot (the body is drawn a coupler gap shorter than its slot). What the
                    # model has there is drawn where the model has it, so it sits under its own cut.
                    c_fin = (float(np.mean(us)) - 0.5) * L_tiles * tile
                    cols = wheel_colours(base, tw)
                    drivers = list(range(n_ax)) if rods else []
                    spec, ds_o, sp_o, drv_o = group_spec([fin(x) - c_fin for x in xs_a], ds, spokes, drivers, rods, k, cols)
                    t_extras = []
                    if not outside:
                        fspec = {key: v for key, v in spec.items() if key != "rods"}
                        fspec.update(wheels=False, frame={
                            "type": "plate_inside", "x0": min(a_["x"] for a_ in spec["axles"]) - 0.42 * k * d,
                            "x1": max(a_["x"] for a_ in spec["axles"]) + 0.42 * k * d,
                            "bottom_f": 0.22 * k * d, "top_f": 0.66 * k * d, "inset": 0.3})
                        fob = running_gear.bogie(f"truckframe_{pname}_{ti}", fspec, tile, cols, shading)
                        t_extras.append((fob, Matrix.Identity(4)))
                        scene_objs.append(fob)
                    layers = build_layers(f"truck_{pname}_{ti}", spec, ds_o, sp_o, drv_o, bool(rods))
                    scene_objs.append(ch)
                    if outside:
                        t_ob, TM = ch, Matrix.Translation(Vector((-c_fin, 0, 0))) @ M
                    else:
                        # wheels that show stand in a frame built between them: what the model had
                        # there (a lump under the cylinders) is left out
                        ch.hide_render = True
                        (t_ob, TM), t_extras = t_extras[0], []
                    blo, bhi = local_bounds(t_ob, TM)
                    for eob in [e for e, _ in t_extras] + layers["objs"][:1]:
                        elo, ehi = local_bounds(eob, Matrix.Identity(4))
                        blo, bhi = np.minimum(blo, elo), np.maximum(bhi, ehi)
                    built_trucks.append({
                        "part": f"{pname}-t{ti}", "ob": t_ob, "M": TM, "lo": blo, "hi": bhi, "comp": comp, "tiles": None,
                        "extras": t_extras, "footprint_m": [float(bhi[0] - blo[0]), float(bhi[1] - blo[1])],
                        "gear": [{"truck": ti, "centre_m": round(c_fin, 3), "model_off_m": round(fin(c_real) - exp_fin, 3),
                                  "d_m": ds, "wheel_scale": round(k, 3), "frame": "outside" if outside else "inside"}],
                        "wheels": layers, "holdout_culled": outside})
                    log(f"{pname}: truck {ti} ({n_ax} axles, {'outside' if outside else 'inside'} frames) keeps "
                        f"{n_keep} faces of the model below {top:.2f} m ({n_cut} cut from the body, {n_w} of them its "
                        f"wheels), squared up by yaw {dyaw:+.2f}, pitch {dpitch:+.2f} deg, moved {dz:+.3f} m onto the "
                        f"rail, {ky:.2f}x across; the model has it {fin(c_real) - exp_fin:+.3f} m from the table's "
                        f"place; wheels {[round(k * d_, 2) for d_ in ds]} m ({k:.2f} of life)"
                        f"{', coupled with rods' if rods else ''}, {layers['phases']} phases")
                if gi["rigid"]:
                    rw = wd["rigid"]
                    n_ax = len(gi["rigid"])
                    ds = per_axle(rw["d"], n_ax)
                    spokes = per_axle(rw.get("spokes", 0), n_ax, int)
                    inside = rw.get("frame", "inside") == "inside"
                    rods = rw.get("rods")
                    drivers = list(rw.get("drivers", range(n_ax))) if rods else []
                    ax_m = find_axles(Pp, yc, zg, x_lo, x_hi, gi["rigid"], ds)
                    xs_a = [m_["x"] for m_ in ax_m]
                    base, n_w = clear_wheels(ob, xs_a, ds, inside) if rw.get("clear", True) else (None, 0)
                    k = k_part
                    cols = wheel_colours(base, rw)
                    spec, ds_o, sp_o, drv_o = group_spec([fin(x) for x in xs_a], ds, spokes, drivers, rods, k, cols)
                    body_wheels = build_layers(f"wheels_{pname}", spec, ds_o, sp_o, drv_o, bool(rods and drv_o))
                    if inside:
                        # the frames between the wheels, so the cut does not show the model's inside
                        x_a, x_b = min(a_["x"] for a_ in spec["axles"]), max(a_["x"] for a_ in spec["axles"])
                        d_big = max(ds)
                        sob = running_gear.skirts(f"skirt_{pname}", [{
                            "x": [x_a - 0.5 * cx * d_big, x_b + 0.5 * cx * d_big], "bottom": 0.2 * k * d_big,
                            "top": 0.96 * d_big, "inset": 0.3,
                            "color": [int(v * 255) for v in cols["frame"]]}], tile, shading, gauge_half=g_fin)
                        extras.append((sob, Matrix.Identity(4)))
                        scene_objs.append(sob)
                    gear = [{"x_m": round(float(a_["x"]), 3), "d_m": round(float(a_["d_f"]), 3), "spokes": a_["spokes"],
                             "driver": bool(a_.get("driver"))} for a_ in spec["axles"]]
                    log(f"{pname}: {n_ax} fixed axles ({'inside' if inside else 'outside'} frames, {n_w} faces of the "
                        f"model's wheels cut) built round at {[g_['x_m'] for g_ in gear]} m, "
                        f"{[g_['d_m'] for g_ in gear]} m ({k:.2f} of life), "
                        f"{'coupled with rods, ' if rods and drv_o else ''}{body_wheels['phases']} phases, "
                        f"{body_wheels['cycle_m']:.2f} m of track per cycle")
            plo, phi = local_bounds(ob, M)
            for eob, EM in extras:
                elo, ehi = local_bounds(eob, EM)
                plo, phi = np.minimum(plo, elo), np.maximum(phi, ehi)
            if footprint is None:
                footprint = [float(phi[0] - plo[0]), float(phi[1] - plo[1])]
            scene_objs.append(ob)
            profile = body_profile(ob, M)
            log(f"{pname}: profile (rear->front) top {profile['top']} m, width {profile['width']} m")
            anchors = {}
            for kind, pts in marks.items():
                # metres from the part's centre on the rail: along (+ towards the nose), across, up
                inside = [p for p in pts if x_lo - 0.05 <= p[0] <= x_hi + 0.05]
                if inside:
                    anchors[kind] = [[round(float(cx * (p[0] - (x_hi + x_lo) / 2)), 3),
                                      round(float(wf * (p[1] - yc)), 3), round(float(p[2] - zg), 3)] for p in inside]
            renders.append({"part": part, "ob": ob, "M": M, "lo": plo, "hi": phi, "comp": comp,
                            "tiles": tiles_p, "footprint_m": footprint, "extras": extras, "gear": gear,
                            "profile": profile, "anchors": anchors or None,
                            "lit": lit_mats[0] if lit_image else None, "dark": lit_mats[1] if lit_image else None})
            if body_wheels:
                renders[-1]["wheels"] = body_wheels
                for wob in body_wheels["objs"][:1]:
                    elo, ehi = local_bounds(wob, Matrix.Identity(4))
                    renders[-1]["lo"] = np.minimum(renders[-1]["lo"], elo)
                    renders[-1]["hi"] = np.maximum(renders[-1]["hi"], ehi)
            renders.extend(built_trucks)
            piv = game_rules.pivots(a.get("plan") or "rigid", size_tiles, job.get("pivot_ratio"),
                                    job.get("bogies"), job.get("pivots")).get(pname, []) if cat == "vehicle" else []
            if train_bogies:
                # where the source has this part's trucks, and a steam frame's coupled wheelbase:
                # src/data pivots / coupled put the game's pivots there
                img = {tb["index"]: (float(np.mean([final_x[n] for n in tb["centre"]])) if isinstance(tb["centre"], list)
                                     else float(tb["centre"])) / tile for tb in train_bogies}
                log(f"{pname}: pivots in the image {[round(img[i], 3) for i in sorted(img)]} tiles from the part's "
                    f"centre; the game's {[round(v, 3) for v in piv]}")
                for i, v in img.items():
                    if i < len(piv) and abs(v - piv[i]) > 0.02:
                        warnings.append(f"{pname}: bogie {i} is {v - piv[i]:+.3f} tiles from its pivot; set src/data "
                                        f"pivots.{pname} to the image's truck centres")
                drv = [n for bk in lm.get("baked", []) if bk["part"] == pname for ax_ in bk["spec"]["axles"]
                       if ax_.get("driver") and (n := ax_.get("wheel")) in final_x]
                if drv:
                    log(f"{pname}: coupled wheelbase centred {np.mean([final_x[n] for n in drv]) / tile:+.3f} tiles "
                        f"from the part's centre (src/data coupled.{pname})")
            for tb in train_bogies:
                # the game hangs bogie `index` of this part at its pivot; the sprite is drawn where the
                # source has the truck, bogieDraw tiles along the track from there (src/data)
                c = (float(np.mean([final_x[n] for n in tb["centre"]])) if isinstance(tb["centre"], list)
                     else float(tb["centre"]))
                pivot_m = piv[tb["index"]] * tile
                # where the sprite is drawn: at its pivot (the game's own mechanism, bogieDraw 0) or,
                # with at = "image", where the source has the group (bogieDraw = that offset)
                draw_img = (c - pivot_m) / tile
                draw = draw_img if tb.get("at", "pivot") == "image" else 0.0
                T_ = Matrix.Translation(Vector((-c, 0, 0)))
                b_extras = []
                if tb["style"] in chunks:
                    bob, BM = chunks[tb["style"]], T_ @ M
                else:
                    spec = dict(tb["spec"])
                    spec["axles"] = [dict(ax_, x=final_x[ax_["wheel"]] - c) if "wheel" in ax_ else ax_
                                     for ax_ in spec["axles"]]
                    colors = {k: np.array(v, dtype=np.float64) / 255 for k, v in spec["colors"].items()}
                    bob = running_gear.bogie(f"bogie_{tb['style']}", {"x_scale": 1.0, "offset_m": 0.0, **spec},
                                             tile, colors, shading)
                    BM = Matrix.Identity(4)
                if tb.get("wheels"):
                    # round wheels on the rails under a truck taken from the model
                    ws = dict(tb["wheels"])
                    ws["axles"] = [dict(ax_, x=final_x[ax_["wheel"]] - c) if "wheel" in ax_ else ax_
                                   for ax_ in ws["axles"]]
                    wcol = {k: np.array(v, dtype=np.float64) / 255 for k, v in ws["colors"].items()}
                    wob = running_gear.bogie(f"wheels_{tb['style']}", {"x_scale": 1.0, "offset_m": 0.0, **ws},
                                             tile, wcol, shading)
                    b_extras.append((wob, Matrix.Identity(4)))
                    scene_objs.append(wob)
                for ch2 in attached.get(tb["style"], []):
                    # relative to the pivot the sprite is drawn at, not to the truck's own centre
                    b_extras.append((ch2, Matrix.Translation(Vector((-(pivot_m + draw * tile), 0, 0))) @ M))
                    scene_objs.append(ch2)
                blo, bhi = local_bounds(bob, BM)
                for eob, EM in b_extras:
                    elo, ehi = local_bounds(eob, EM)
                    blo, bhi = np.minimum(blo, elo), np.maximum(bhi, ehi)
                scene_objs.append(bob)
                renders.append({"part": f"bogie-{tb['style']}", "ob": bob, "M": BM, "lo": blo, "hi": bhi,
                                "comp": comp, "tiles": None, "extras": b_extras,
                                "footprint_m": [float(bhi[0] - blo[0]), float(bhi[1] - blo[1])],
                                "gear": [{"style": tb["style"], "pivot_tiles": round(piv[tb["index"]], 4),
                                          "centre_m": round(c, 3), "draw_tiles": round(draw, 4),
                                          "image_offset_tiles": round(draw_img, 4)}]})
                log(f"{pname}: bogie {tb['style']} centred {c:+.3f} m in the image, pivot {pivot_m:+.3f} m -> "
                    f"bogieDraw {draw:+.4f} tiles ({'at the image position' if draw else 'at its pivot'})")
            log(f"{part or cat}: {length:.2f} m, compression {comp.round(3).tolist()}, "
                f"final dims {(phi - plo).round(2).tolist()} m")
        tiles = [size_tiles, 1] if size_tiles else None
        footprint_m = [size_tiles * tile, tile] if size_tiles else renders[0]["footprint_m"]
        # aligned debug views show the whole model at real scale, centred
        M_view = Matrix.Translation(Vector((-(lo_r[0] + hi_r[0]) / 2, -yc, -zg))) @ M_real
    else:
        # uniform x/y compression near footprint_factor, snapped so the footprint fills whole tiles;
        # size_tiles fixes a square footprint instead (the game's stations are 1x1, its depots 2x2)
        f, fill = ccfg["footprint_factor"], ccfg["fill"]
        cz = 1.0
        if a.get("size_tiles"):
            n = int(a["size_tiles"])
            tiles = [n, n]
            lo_c, hi_c = ccfg["sized_footprint_range"]
            c = min(min(tiles[i] * tile * fill / real[i] for i in (0, 1)), hi_c)
            if c < lo_c:
                raise RuntimeError(f"footprint factor {c:.2f} below sized_footprint_range {lo_c} "
                                   f"({real[0]:.1f} x {real[1]:.1f} m into {n}x{n} tiles). "
                                   f"Raise size_tiles or lower the range.")
            # height follows part of the way, so a crushed footprint does not stand as a tower
            cz = c ** ccfg["sized_height_exponent"]
        else:
            lo_c, hi_c = ccfg["footprint_range"]
            tiles = [max(1, round(real[i] * f / tile)) for i in (0, 1)]
            while True:
                fits = [tiles[i] * tile * fill / real[i] for i in (0, 1)]
                c = min(min(fits), hi_c)
                if c >= lo_c:
                    break
                tiles[int(np.argmin(fits))] += 1
        comp = np.array([c, c, cz])
        footprint_m = [tiles[0] * tile, tiles[1] * tile]
        S = np.diag(s * comp)
        V3 = V2 @ S
        lo3, hi3 = V3.min(0), V3.max(0)
        T = -np.array([(lo3[0] + hi3[0]) / 2, (lo3[1] + hi3[1]) / 2, lo3[2]])
        fd = hi3 - lo3
        M_base = Matrix.Translation(Vector(T)) @ to4(S @ R) @ mw0
        renders.append({"part": None, "ob": obj, "M": M_base, "lo": np.array([-fd[0] / 2, -fd[1] / 2, 0.0]),
                        "hi": np.array([fd[0] / 2, fd[1] / 2, fd[2]]), "comp": comp, "tiles": tiles,
                        "footprint_m": footprint_m})
        M_view = M_base
    log(f"scale {s:.4f} ({ref}), tiles {tiles}, {len(renders)} sprite set(s)")

    # 5. scene
    if r["force_dielectric"] and r.get("shading") != "painted":
        force_dielectric()
    res_x = int(r.get("resolution", 1))  # texels per logical game pixel (the atlas JSON's resolution)
    k_px = g["tile_px"] / (tile * math.sqrt(2)) * res_x
    ss = int(r["supersample"])
    setup_render(r, 64, 64)
    L = add_sun(r)
    shadow = ccfg.get("shadow", r["shadow"])
    ground = add_shadow_catcher() if (shadow and r["engine"] == "CYCLES") else None

    # debug previews (raw pose vs aligned; the parts side by side when the model was cut)
    debug, debug_cams = {}, {}
    if r["debug_views"]:
        if ground:
            ground.hide_render = True
        dcam = make_camera("debug_cam")
        views = [("raw_front", [(obj, mw0.copy())], "front"), ("aligned_front", [(obj, M_view)], "front"),
                 ("aligned_side", [(obj, M_view)], "side"), ("aligned_top", [(obj, M_view)], "top")]
        if len(renders) > 1 or (renders[0]["ob"] is not obj) or renders[0].get("extras"):
            laid, x = [], 0.0
            for rd in renders:  # nose part on the right, as the front view shows the model
                T_ = Matrix.Translation(Vector((-x - rd["hi"][0], 0, 0)))
                laid.append((rd["ob"], T_ @ rd["M"]))
                laid += [(e, T_ @ EM) for e, EM in rd.get("extras", [])]
                x += rd["hi"][0] - rd["lo"][0] + 1.0
            views.append(("parts_front", laid, "front"))
            gear_only = [(e, EM) for rd in renders for e, EM in rd.get("extras", [])]
            if gear_only:
                views.append(("gear_front", gear_only, "front"))
        samples = bpy.context.scene.cycles.samples if r["engine"] == "CYCLES" else None
        if samples:
            bpy.context.scene.cycles.samples = 8
        for name, items, view in views:
            show_only(scene_objs, [ob for ob, _ in items])
            p = f"{job['debug_dir']}/{a['id']}_{name}.png"
            debug_cams[name] = debug_view(items, dcam, view, p, r["debug_res"] * (2 if name.startswith("parts") else 1))
            debug[name] = p
        if samples:
            bpy.context.scene.cycles.samples = samples
        if ground:
            ground.hide_render = False

    # 6. fixed game camera; per sprite set a canvas sized for all directions (+ shadow)
    out = render_sets(job, renders, scene_objs, shadow, L, k_px, ss, res_x)

    meta = {
        "id": a["id"], "category": cat, "plan": a.get("plan") or ("rigid" if cat == "vehicle" else None),
        "tiles": tiles, "footprint_m": footprint_m,
        "scale": round(float(s), 6), "scale_ref": ref, "compression": out[0]["compression"],
        "real_dims_m": real.round(3).tolist(), "final_dims_m": out[0]["final_dims_m"], "split": split,
        "width_fix": round(width_fix, 4),
        "standard": ({"deperspective": float(fitd.get("deperspective") or 0.0),
                      "uniform_k": float(fitd.get("uniform_k") or 1.0), "parts": std_parts}
                     if cat == "vehicle" and fitd.get("standard") else None),
        "px_per_m": round(k_px, 5), "supersample": ss, "resolution": res_x, "source": src_report,
        "anchor": "ground center of the footprint (a part's own centre), continuous px coords from top-left",
        "align": align_info, "warnings": warnings, "debug": debug, "debug_cams": debug_cams, "renders": out,
        "seconds": round(time.time() - t0, 1),
    }
    with open(job["meta_path"], "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    for w in warnings:
        log("WARNING", w)
    log(f"done {a['id']} in {meta['seconds']}s -> {job['meta_path']}")


if __name__ == "__main__":
    main()
