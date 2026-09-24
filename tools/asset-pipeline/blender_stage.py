"""Blender stage. Run: blender -b --factory-startup --python-exit-code 1 -P blender_stage.py -- job.json

raw GLB -> Manhattan alignment (upright + axis-aligned) -> real-world scale -> class compression
-> tile footprint -> fixed 2:1 ortho camera at constant px/m -> N direction renders + meta JSON.
Any exception exits non-zero (with --python-exit-code 1).
"""
import json
import math
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector


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


def directions(ccfg):
    """(yaw_deg, game facing or None) for every rendered direction.

    dirs = "game" renders the game's drawn facings: src/sim/body.ts has FACINGS = 48 (7.5 deg apart)
    and draws only f <= mirrorFacing(f) = (12 - f) mod 48, 25 of them. Tile +ty is Blender -Y, so
    facing f is a yaw of -7.5 f degrees (clockwise seen from above); facing 0 points down-right.
    """
    d = ccfg["dirs"]
    if d == "game":
        return [(-7.5 * f + 0.0, f) for f in range(48) if f <= (12 - f) % 48]  # + 0.0: no -0.0
    return [(360 * i / int(d), None) for i in range(int(d))]


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


def debug_view(obj, cam, M, view, path, res):
    """Orthographic look at obj with matrix M from 'front' (-Y), 'side' (+X) or 'top'."""
    obj.matrix_world = M
    corners = [M @ Vector(c) for c in obj.bound_box]
    ctr = sum(corners, Vector()) / 8
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


# ---------------- main ----------------
def main():
    job = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
    a, g, r, al = job["asset"], job["grid"], job["render"], job["align"]
    ccfg = job["class_cfg"]
    cat = a["category"]
    t0 = time.time()
    warnings = []

    obj = import_mesh(job["glb"])
    mw0 = obj.matrix_world.copy()
    V, N, nv, nf = mesh_arrays(obj, al["sample_faces"])
    log(f"{a['id']}: {nv} verts, {nf} faces, import {time.time() - t0:.1f}s")

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
    R = rz(math.radians(a["yaw_offset_deg"])) @ rz(math.radians(90 * k)) @ R
    V2 = V @ R.T
    lo, hi = V2.min(0), V2.max(0)
    dims = hi - lo

    # 3. real-world scale
    if cat == "vehicle":
        s = a["length_m"] / dims[0]
        ref = "length_m"
    else:
        ref = next(k_ for k_ in ("height_m", "length_m", "width_m") if a.get(k_))
        s = a[ref] / dims[{"height_m": 2, "length_m": 0, "width_m": 1}[ref]]
    real = dims * s
    for key, i in (("length_m", 0), ("width_m", 1), ("height_m", 2)):
        if a.get(key) and key != ref:
            err = real[i] / a[key] - 1
            if abs(err) > ccfg["max_dim_error"]:
                warnings.append(f"{key}: model {real[i]:.2f} m vs spec {a[key]} m ({err:+.0%})")

    # 4. class compression + tiles
    tile = g["tile_m"]
    if cat == "vehicle":
        size_tiles = a.get("size_tiles") or max(1, round(real[0] / tile))
        cx = (size_tiles * tile - ccfg["coupler_gap_m"]) / real[0]
        lo_c, hi_c = ccfg["compress_range"]
        if not lo_c <= cx <= hi_c:
            raise RuntimeError(f"length factor {cx:.2f} outside {ccfg['compress_range']} "
                               f"({real[0]:.1f} m into {size_tiles} tiles). Change size_tiles or length_m.")
        comp = np.array([cx, 1.0, 1.0])
        tiles = [int(size_tiles), 1]
        footprint_m = [size_tiles * tile, tile]
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
    final_dims = hi3 - lo3
    M3 = S @ R
    M_base = Matrix.Translation(Vector(T)) @ to4(M3) @ mw0
    log(f"scale {s:.4f} ({ref}), compression {comp.round(3).tolist()}, tiles {tiles}, "
        f"final dims {final_dims.round(2).tolist()} m")

    # 5. scene
    if r["force_dielectric"]:
        force_dielectric()
    k_px = g["tile_px"] / (tile * math.sqrt(2))
    ss = int(r["supersample"])
    setup_render(r, 64, 64)
    L = add_sun(r)
    ground = add_shadow_catcher() if (r["shadow"] and r["engine"] == "CYCLES") else None

    # debug previews (raw pose vs aligned)
    debug = {}
    if r["debug_views"]:
        if ground:
            ground.hide_render = True
        dcam = make_camera("debug_cam")
        mw_raw = mw0.copy()
        views = [("raw_front", mw_raw, "front"), ("aligned_front", M_base, "front"),
                 ("aligned_side", M_base, "side"), ("aligned_top", M_base, "top")]
        samples = bpy.context.scene.cycles.samples if r["engine"] == "CYCLES" else None
        if samples:
            bpy.context.scene.cycles.samples = 8
        for name, M, view in views:
            p = f"{job['debug_dir']}/{a['id']}_{name}.png"
            debug_view(obj, dcam, M, view, p, r["debug_res"])
            debug[name] = p
        if samples:
            bpy.context.scene.cycles.samples = samples
        if ground:
            ground.hide_render = False

    # 6. fixed game camera, canvas sized for all directions (+ shadow)
    cam = make_camera("game_cam")
    cam.rotation_euler = (math.radians(90 - g["elevation_deg"]), 0, math.radians(g["azimuth_deg"]))
    bpy.context.view_layer.update()
    cm = cam.matrix_world.to_3x3()
    right, up, back = cm.col[0], cm.col[1], cm.col[2]
    dir_list = directions(ccfg)
    hx, hy, hz = final_dims / 2
    box = [Vector((sx * hx, sy * hy, z)) for sx in (-1, 1) for sy in (-1, 1) for z in (0.0, final_dims[2])]
    if r["shadow"]:
        box += [p - (p.z / L.z) * L for p in box if p.z > 0]
    pts = []
    for yaw_d, _ in dir_list:
        Rz_ = Matrix.Rotation(math.radians(yaw_d), 3, "Z")
        pts += [Rz_ @ p for p in box]
    pr = [p.dot(right) for p in pts]
    pu = [p.dot(up) for p in pts]
    pad = int(r["pad_px"])
    W = math.ceil((max(pr) - min(pr)) * k_px) + 2 * pad
    H = math.ceil((max(pu) - min(pu)) * k_px) + 2 * pad
    W += W % 2
    H += H % 2
    ax = pad + math.ceil(-min(pr) * k_px)
    ay = pad + math.ceil(max(pu) * k_px)
    cr, cu = (W / 2 - ax) / k_px, (ay - H / 2) / k_px
    cam.location = right * cr + up * cu + back * 1000
    cam.data.ortho_scale = max(W, H) / k_px
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = W * ss, H * ss

    def to_px(p):
        return [round(ax + p.dot(right) * k_px, 3), round(ay - p.dot(up) * k_px, 3)]

    fx, fy = footprint_m[0] / 2, footprint_m[1] / 2
    fp = [Vector(c) for c in ((-fx, -fy, 0), (fx, -fy, 0), (fx, fy, 0), (-fx, fy, 0))]
    dirs = []
    for i, (yaw_d, facing) in enumerate(dir_list):
        Rz4 = Matrix.Rotation(math.radians(yaw_d), 4, "Z")
        obj.matrix_world = Rz4 @ M_base
        path = f"{job['sprites_raw_dir']}/{a['id']}_d{i}.png"
        tr = time.time()
        render_to(path)
        R3 = Rz4.to_3x3()
        head = R3 @ Vector((1, 0, 0))
        hv = Vector((head.dot(right), -head.dot(up)))
        hv.normalize()
        rot_tiles = tiles if round(yaw_d / 90) % 2 == 0 or cat == "vehicle" else tiles[::-1]
        dirs.append({"index": i, "yaw_deg": yaw_d, "facing": facing, "file": path,
                     "screen_heading": [round(hv.x, 4), round(hv.y, 4)],
                     "tiles": rot_tiles,
                     "footprint_px": [to_px(R3 @ c) for c in fp]})
        log(f"dir {i} ({yaw_d:.0f} deg) rendered in {time.time() - tr:.1f}s")

    meta = {
        "id": a["id"], "category": cat, "tiles": tiles, "footprint_m": footprint_m,
        "scale": round(float(s), 6), "scale_ref": ref, "compression": comp.round(4).tolist(),
        "real_dims_m": real.round(3).tolist(), "final_dims_m": final_dims.round(3).tolist(),
        "px_per_m": round(k_px, 5), "canvas_px": [W, H], "anchor_px": [ax, ay], "supersample": ss,
        "anchor": "ground center of footprint, continuous px coords from top-left",
        "align": align_info, "warnings": warnings, "debug": debug, "dirs": dirs,
        "seconds": round(time.time() - t0, 1),
    }
    with open(job["meta_path"], "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    for w in warnings:
        log("WARNING", w)
    log(f"done {a['id']} in {meta['seconds']}s -> {job['meta_path']}")


if __name__ == "__main__":
    main()
