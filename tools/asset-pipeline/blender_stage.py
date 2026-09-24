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

import bpy
import bmesh  # after bpy: the bpy module from pip only finds bmesh once bpy is loaded
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # Blender does not add the script's folder
import game_rules  # noqa: E402


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
    R = rz(math.radians(a["yaw_offset_deg"] or 0.0)) @ rz(math.radians(90 * k)) @ R
    V2 = V @ R.T
    lo, hi = V2.min(0), V2.max(0)
    dims = hi - lo

    # 3. real-world scale
    if cat in ("vehicle", "bogie"):
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

    # 4. class compression + tiles -> renderables: one per sprite set, {part, ob, M, lo, hi, ...}
    tile = g["tile_m"]
    M_real = to4(s * R) @ mw0  # raw object -> aligned, real metres, not yet centred
    lo_r, hi_r = lo * s, hi * s
    scene_objs = [obj]
    renders = []
    split = None
    if cat in ("vehicle", "bogie"):
        wf = game_rules.DRAWN_WIDTH  # the game draws rolling stock wider than long, so do we
        if cat == "vehicle":
            size_tiles = a.get("size_tiles") or max(1, round(real[0] / tile))
            if size_tiles not in game_rules.SIZE_TILES:
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
            if a["yaw_offset_deg"] is None:
                # the photo cannot tell nose from tail; an engine + tender can: its joints are where
                # the plan puts them from one end only. Turn round when the other end fits better.
                Pf = P * np.array([-1.0, -1.0, 1.0])
                cuts_f, score_f = find_cuts(Pf, -lo_r[0], real[0], expected, 0.12 * real[0])
                if score_f < score:
                    R = rz(math.pi) @ R
                    M_real = to4(s * R) @ mw0
                    lo_r, hi_r = np.array([-hi_r[0], -hi_r[1], lo_r[2]]), np.array([-lo_r[0], -lo_r[1], hi_r[2]])
                    cuts = cuts_f
                    split.update(cuts_m=cuts, turned=True)
                    warnings.append("turned round: the plan's joints fit better from the other end "
                                    "(set yaw_offset_deg to decide)")
        else:
            cuts = []
        if split:
            log(f"split {split['mode']} at {cuts} m from the nose (plan guess {[round(e, 2) for e in expected]})")
        bounds = [0.0] + cuts + [real[0]]
        if any(b1 <= b0 for b0, b1 in zip(bounds, bounds[1:])):
            raise RuntimeError(f"cuts {cuts} are not in order inside 0..{real[0]:.1f} m")
        clip = a.get("clip_below_m") or 0.0
        yc, zg = (lo_r[1] + hi_r[1]) / 2, lo_r[2]
        for (part, L_tiles, rendered), d0, d1 in zip(parts, bounds, bounds[1:]):
            if not rendered:
                continue
            ob = obj.copy()
            ob.data = obj.data.copy()
            ob.name = f"part_{part}"
            bpy.context.scene.collection.objects.link(ob)
            ob.data.transform(M_real)
            ob.matrix_world = Matrix.Identity(4)
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
                cx = slot / length
                lo_c, hi_c = ccfg["compress_range"]
                if not lo_c <= cx <= hi_c:
                    raise RuntimeError(f"{part or 'body'}: length factor {cx:.2f} outside {ccfg['compress_range']} "
                                       f"({length:.1f} m into {L_tiles} tiles). Change size_tiles, length_m or split_m.")
                tiles_p, footprint = [L_tiles, 1], [L_tiles * tile, tile]
            else:
                cx = ccfg["length_factor"]
                tiles_p, footprint = None, None
            comp = np.array([cx, wf, 1.0])
            # centred on its own middle and the track, standing where the whole vehicle stands
            M = to4(np.diag(comp)) @ Matrix.Translation(Vector((-(x_hi + x_lo) / 2, -yc, -zg)))
            plo, phi = local_bounds(ob, M)
            if footprint is None:
                footprint = [float(phi[0] - plo[0]), float(phi[1] - plo[1])]
            scene_objs.append(ob)
            renders.append({"part": part, "ob": ob, "M": M, "lo": plo, "hi": phi, "comp": comp,
                            "tiles": tiles_p, "footprint_m": footprint})
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
    if r["force_dielectric"]:
        force_dielectric()
    k_px = g["tile_px"] / (tile * math.sqrt(2))
    ss = int(r["supersample"])
    setup_render(r, 64, 64)
    L = add_sun(r)
    ground = add_shadow_catcher() if (r["shadow"] and r["engine"] == "CYCLES") else None

    # debug previews (raw pose vs aligned; the parts side by side when the model was cut)
    debug = {}
    if r["debug_views"]:
        if ground:
            ground.hide_render = True
        dcam = make_camera("debug_cam")
        views = [("raw_front", [(obj, mw0.copy())], "front"), ("aligned_front", [(obj, M_view)], "front"),
                 ("aligned_side", [(obj, M_view)], "side"), ("aligned_top", [(obj, M_view)], "top")]
        if len(renders) > 1 or (renders[0]["ob"] is not obj):
            laid, x = [], 0.0
            for rd in renders:  # nose part on the right, as the front view shows the model
                laid.append((rd["ob"], Matrix.Translation(Vector((-x - rd["hi"][0], 0, 0))) @ rd["M"]))
                x += rd["hi"][0] - rd["lo"][0] + 1.0
            views.append(("parts_front", laid, "front"))
        samples = bpy.context.scene.cycles.samples if r["engine"] == "CYCLES" else None
        if samples:
            bpy.context.scene.cycles.samples = 8
        for name, items, view in views:
            show_only(scene_objs, [ob for ob, _ in items])
            p = f"{job['debug_dir']}/{a['id']}_{name}.png"
            debug_view(items, dcam, view, p, r["debug_res"])
            debug[name] = p
        if samples:
            bpy.context.scene.cycles.samples = samples
        if ground:
            ground.hide_render = False

    # 6. fixed game camera; per sprite set a canvas sized for all directions (+ shadow)
    cam = make_camera("game_cam")
    cam.rotation_euler = (math.radians(90 - g["elevation_deg"]), 0, math.radians(g["azimuth_deg"]))
    bpy.context.view_layer.update()
    cm = cam.matrix_world.to_3x3()
    right, up, back = cm.col[0], cm.col[1], cm.col[2]
    dir_list = game_rules.directions(ccfg["dirs"])
    sc = bpy.context.scene
    sc.camera = cam
    pad = int(r["pad_px"])
    out = []
    for rd in renders:
        part, ob, M, plo, phi = rd["part"], rd["ob"], rd["M"], rd["lo"], rd["hi"]
        show_only(scene_objs, [ob])
        box = [Vector((x, y, z)) for x in (plo[0], phi[0]) for y in (plo[1], phi[1]) for z in (0.0, phi[2])]
        if r["shadow"]:
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
        dirs = []
        for i, (yaw_d, facing) in enumerate(dir_list):
            Rz4 = Matrix.Rotation(math.radians(yaw_d), 4, "Z")
            ob.matrix_world = Rz4 @ M
            path = f"{job['sprites_raw_dir']}/{stem}_d{i}.png"
            tr = time.time()
            render_to(path)
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
        out.append({"part": part, "tiles": rd["tiles"], "footprint_m": rd["footprint_m"],
                    "compression": rd["comp"].round(4).tolist(),
                    "final_dims_m": (phi - plo).round(3).tolist(),
                    "canvas_px": [W, H], "anchor_px": [ax, ay], "dirs": dirs})

    meta = {
        "id": a["id"], "category": cat, "plan": a.get("plan") or ("rigid" if cat == "vehicle" else None),
        "tiles": tiles, "footprint_m": footprint_m,
        "scale": round(float(s), 6), "scale_ref": ref, "compression": out[0]["compression"],
        "real_dims_m": real.round(3).tolist(), "final_dims_m": out[0]["final_dims_m"], "split": split,
        "px_per_m": round(k_px, 5), "supersample": ss,
        "anchor": "ground center of the footprint (a part's own centre), continuous px coords from top-left",
        "align": align_info, "warnings": warnings, "debug": debug, "renders": out,
        "seconds": round(time.time() - t0, 1),
    }
    with open(job["meta_path"], "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    for w in warnings:
        log("WARNING", w)
    log(f"done {a['id']} in {meta['seconds']}s -> {job['meta_path']}")


if __name__ == "__main__":
    main()
