"""Hydro plant (hydro_plant) blockout scaffold.  blender -b -P build_hydro.py -- <out dir>

Modelled directly (no painted source): a brick turbine house on a stone base, one tall arched window and a
door in the long front wall, a tailrace arch low in the front, a slate gable roof with a small ridge lantern,
and on the uphill (back right) side a small stone intake chamber with a sluice gate, from which one riveted
penstock runs down the right end wall into the house.  Footprint 1 x 1 tile (the review-2 plan: canvas
1024 x 1024, anchor (512, 832), 8 canvas px to a game px), base 0.9 x 0.6254 tiles, eaves 40 game px.
Blender X = game x, Blender Y = - game y.  Front (long, window) wall is on -Y: lower left at r0; the penstock
end wall is +X: lower right at r0.  Units: tiles (1 tile of height = 39.19 game px).
"""
import json, math, os, sys
import bpy, bmesh
import numpy as np
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)

CANVAS = (1024, 1024)
CENTRE = (512, 832)            # the review-2 plan's anchor for hydro_plant
SCALE = 8
GROUND = 32 / math.cos(math.radians(45))
RISE = GROUND * math.cos(math.radians(30))
EL, AZ = math.radians(30), math.radians(-45)
TO_CAMERA = np.array([math.cos(EL) * math.cos(AZ), math.cos(EL) * math.sin(AZ), math.sin(EL)])
RIGHT = np.array([1, 1, 0]) / math.sqrt(2)
UP = np.cross(RIGHT, -TO_CAMERA)

# ---------------- dimensions (tiles) ----------------
HL, HW = 0.45, 0.3127          # base half length / half width: the plan's 0.9 x 0.6254 on the 1 x 1 plinth
E = 40 / RISE                  # eaves height: the plan's block, 40 game px
FOOT = 0.27                    # rusticated stone base
PITCH = math.radians(33)
R = E + HW * math.tan(PITCH)   # ridge of the wall shell
WALL = 0.05
PR = 0.042                     # penstock radius
PX = HL + PR + 0.006           # penstock axis, hugging the right end wall


def srgb(c):
    return [(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c]


COL = {
    'stone': (0.74, 0.66, 0.50), 'cream': (0.90, 0.82, 0.62), 'brick': (0.72, 0.34, 0.22),
    'slate': (0.30, 0.33, 0.40), 'monitor': (0.13, 0.30, 0.18), 'louvre': (0.80, 0.74, 0.55),
    'door': (0.10, 0.42, 0.20), 'glass': (0.20, 0.28, 0.36), 'interior': (0.16, 0.12, 0.10),
    'floor': (0.27, 0.21, 0.16), 'pipe': (0.12, 0.33, 0.20), 'copper': (0.64, 0.42, 0.26),
}
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
MATS = {}
for k, c in COL.items():
    m = bpy.data.materials.new(k)
    m.diffuse_color = (*srgb(c), 1)
    MATS[k] = m


def base_of(mat):
    return tuple(MATS[mat.name].diffuse_color[:3]) if mat.name in MATS else (0.5, 0.5, 0.5)


def new_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for k in mats:
        me.materials.append(MATS[k])
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def box(name, cx, cy, cz, sx, sy, sz, mat, rot_x=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_x, 3, 'X'))
    for v in bm.verts:
        v.co += Vector((cx, cy, cz))
    return new_obj(name, bm, [mat])


def prism(name, pts, a0, a1, mat, axis='x'):
    """pts: closed polygon, extruded from a0 to a1 along `axis`: 'x' -> pts are (y, z); 'y' -> pts are (x, z)."""
    def at(p, a):
        return (a, p[0], p[1]) if axis == 'x' else (p[0], a, p[1])
    bm = bmesh.new()
    a = [bm.verts.new(at(p, a0)) for p in pts]
    b = [bm.verts.new(at(p, a1)) for p in pts]
    n = len(pts)
    bm.faces.new(a)
    bm.faces.new(b[::-1])
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, [mat])


def arch_pts(cx, r, z0, spring, n=14):
    """Round-arched opening centred on `cx`, half-width r, from z0 to the springing line, then a half circle."""
    pts = [(cx - r, z0), (cx - r, spring)]
    for i in range(1, n):
        t = math.pi - math.pi * i / n
        pts.append((cx + r * math.cos(t), spring + r * math.sin(t)))
    pts += [(cx + r, spring), (cx + r, z0)]
    return pts


def circ(cy, cz, r, n=12):
    return [(cy + r * math.cos(2 * math.pi * i / n), cz + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def cyl(name, A, B, r, mat, seg=14):
    A, B = Vector(A), Vector(B)
    d = B - A
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    for v in bm.verts:
        v.co = q @ v.co + (A + B) / 2
    return new_obj(name, bm, [mat])


def ball(name, C, r, mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=r)
    for v in bm.verts:
        v.co += Vector(C)
    return new_obj(name, bm, [mat])


def boolean(target, cutter):
    bpy.context.view_layer.objects.active = target
    md = target.modifiers.new('b', 'BOOLEAN')
    md.operation, md.operand_type, md.object, md.solver = 'DIFFERENCE', 'OBJECT', cutter, 'EXACT'
    try:
        md.material_mode = 'TRANSFER'
    except Exception as e:
        print('no material_mode', e)
    bpy.ops.object.modifier_apply(modifier=md.name)


# ---------------- the shell: stone base, brick walls with cream corner quoins ----------------
quoins = [(-0.45, -0.39), (0.39, 0.45)]
stations = sorted({s for p in quoins for s in p})
P = [(-HW, 0), (-HW, FOOT), (-HW, E), (0, R), (HW, E), (HW, FOOT), (HW, 0)]
bm = bmesh.new()
ring = {x: [bm.verts.new((x, y, z)) for y, z in P] for x in stations}
MI = {k: i for i, k in enumerate(['stone', 'brick', 'cream', 'slate'])}


def f(vs, key):
    fc = bm.faces.new(vs)
    fc.material_index = MI[key]


for x0, x1 in zip(stations, stations[1:]):
    a, b = ring[x0], ring[x1]
    wall = 'cream' if (x0, x1) in quoins else 'brick'

    def q(i, j, key):
        f((a[i], a[j], b[j], b[i]), key)
    q(0, 1, 'stone'); q(1, 2, wall); q(2, 3, 'slate'); q(3, 4, 'slate')
    q(4, 5, wall); q(5, 6, 'stone'); f((a[6], a[0], b[0], b[6]), 'stone')
for x in (stations[0], stations[-1]):
    r_ = ring[x]
    f((r_[0], r_[1], r_[5], r_[6]), 'stone')
    f((r_[1], r_[2], r_[3], r_[4], r_[5]), 'brick')
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
shell = new_obj('shell', bm, ['stone', 'brick', 'cream', 'slate'])

# ---- cuts into the front wall (-Y): the tall arched window, the door, the tailrace arch
WX, WR, WZ0, WSP = -0.06, 0.105, 0.40, 0.76          # window centre x, half width, sill, springing line
DX, DW, DH = 0.27, 0.075, 0.40                        # door centre x, half width, height
TX, TR, TSP = -0.31, 0.085, 0.10                      # tailrace arch centre x, half width, springing line
YF = -HW
cutters = [
    prism('window', arch_pts(WX, WR, WZ0, WSP), YF - 0.06, YF + 0.03, 'glass', axis='y'),
    box('door', DX, YF - 0.015, DH / 2 - 0.0, 2 * DW, 0.09, DH, 'door'),
    prism('tailrace', arch_pts(TX, TR, 0.012, TSP), YF - 0.06, YF + 0.13, 'interior', axis='y'),
]
for c in cutters:
    boolean(shell, c)
for c in cutters:
    bpy.data.objects.remove(c, do_unlink=True)

parts = [shell]
# round gable vents, both end walls: a cream ring and a dark disc
OZ, OR_ = E + 0.115, 0.05
for sgn in (1, -1):
    xo = sgn * HL
    xa, xb = (xo - 0.016, xo + 0.004) if sgn > 0 else (xo - 0.004, xo + 0.016)
    ring_o = prism('oring', circ(0, OZ, OR_ + 0.028), xa, xb, 'cream')
    ring_i = prism('oringcut', circ(0, OZ, OR_), xa - 0.05, xb + 0.05, 'glass')
    boolean(ring_o, ring_i)
    bpy.data.objects.remove(ring_i, do_unlink=True)
    parts.append(ring_o)
    disc = prism('odisc', circ(0, OZ, OR_), xo - 0.001 if sgn > 0 else xo - 0.004, xo + 0.004 if sgn > 0 else xo + 0.001, 'glass')
    parts.append(disc)
# ---------------- solid tailrace floor: an opaque dark sill and floor, no see-through notch ----------------
parts.append(box('tail_sill', TX, YF - 0.0015 + 0.07, 0.0075, 2 * TR, 0.14, 0.015, 'floor'))
# ---------------- roof ----------------
t = 0.03
ov, vo = 0.03, 0.025


def zb(y):
    return R - abs(y) * math.tan(PITCH)


RT = t / math.cos(PITCH)
rp = [(-(HW + ov), zb(HW + ov)), (0, R), (HW + ov, zb(HW + ov)), (HW + ov, zb(HW + ov) + RT), (0, R + RT), (-(HW + ov), zb(HW + ov) + RT)]
parts.append(prism('roof', rp, -HL - vo, HL + vo, 'slate'))


def roof_top(y):
    return R + RT - abs(y) * math.tan(PITCH)


# small vented ridge lantern at the middle of the ridge
mx0, mx1, mw = -0.17, 0.17, 0.075
mz0 = roof_top(mw) - 0.03
mz1 = R + RT + 0.075
parts.append(prism('monitor', [(-mw, mz0), (-mw, mz1), (mw, mz1), (mw, mz0)], mx0, mx1, 'monitor'))
for side in (-1, 1):
    parts.append(box('louvre', (mx0 + mx1) / 2, side * (mw + 0.004), (roof_top(mw) + mz1) / 2 + 0.002,
                     (mx1 - mx0) - 0.08, 0.008, mz1 - roof_top(mw) - 0.045, 'louvre'))
mc = [(-(mw + 0.025), mz1), (0, mz1 + 0.04), (mw + 0.025, mz1), (mw + 0.025, mz1 + 0.012), (0, mz1 + 0.052), (-(mw + 0.025), mz1 + 0.012)]
parts.append(prism('monitor_roof', mc, mx0 - 0.025, mx1 + 0.025, 'slate'))

# ---------------- front wall details: window surround and sill, door lintel, tailrace surround ----------------
y0, y1 = YF - 0.016, YF + 0.004
outer = prism('wring', arch_pts(WX, WR + 0.036, WZ0 - 0.0, WSP), y0, y1, 'cream', axis='y')
inner = prism('wringcut', arch_pts(WX, WR, WZ0 - 0.1, WSP), y0 - 0.05, y1 + 0.05, 'glass', axis='y')
boolean(outer, inner)
bpy.data.objects.remove(inner, do_unlink=True)
parts.append(outer)
parts.append(box('wsill', WX, YF - 0.014, WZ0 - 0.012, 2 * (WR + 0.05), 0.03, 0.024, 'cream'))
parts.append(box('lintel', DX, YF - 0.010, DH + 0.018, 2 * (DW + 0.025), 0.022, 0.036, 'cream'))
outer = prism('tring', arch_pts(TX, TR + 0.04, 0.0, TSP), y0, y1, 'cream', axis='y')
inner = prism('tringcut', arch_pts(TX, TR, -0.1, TSP), y0 - 0.05, y1 + 0.05, 'interior', axis='y')
boolean(outer, inner)
bpy.data.objects.remove(inner, do_unlink=True)
parts.append(outer)

# ---------------- the intake chamber (uphill, back right) and its sluice ----------------
parts.append(box('weir_base', 0.30, 0.406, 0.04, 0.35, 0.188, 0.08, 'stone'))       # stepped stone footing
parts.append(box('intake', 0.295, 0.415, 0.34, 0.31, 0.17, 0.52, 'cream'))           # the chamber, z 0.08 .. 0.60
parts.append(box('intake_cap', 0.295, 0.415, 0.615, 0.35, 0.19, 0.03, 'stone'))      # top slab
parts.append(box('gate', 0.34, 0.415, 0.70, 0.11, 0.07, 0.14, 'pipe'))               # sluice gate housing
cap = box('wheel', 0.34, 0.415, 0.80, 0.10, 0.015, 0.10, 'copper')                    # handwheel (a plate on edge)
parts.append(cap)
# ---------------- the penstock: intake outlet -> down the right end wall -> into the house ----------------
Y_TOP, Z_TOP, Y_LOW, Z_LOW = 0.415, 0.50, 0.02, 0.30
P1, P2, P3 = (PX, Y_TOP, Z_TOP), (PX, Y_LOW, Z_LOW), (HL - 0.01, Y_LOW, Z_LOW)
parts.append(cyl('pen_stub', (HL - 0.01, Y_TOP, Z_TOP), P1, PR, 'pipe'))
parts.append(ball('pen_elbow1', P1, PR * 1.02, 'pipe'))
parts.append(cyl('pen_run', P1, P2, PR, 'pipe'))
parts.append(ball('pen_elbow2', P2, PR * 1.02, 'pipe'))
parts.append(cyl('pen_entry', P2, P3, PR, 'pipe'))
for s in (0.2, 0.4, 0.6, 0.8):
    c = Vector(P1).lerp(Vector(P2), s)
    d = (Vector(P2) - Vector(P1)).normalized()
    parts.append(cyl('flange', c - d * 0.014, c + d * 0.014, PR * 1.28, 'copper'))
parts.append(cyl('flange_entry', (HL + 0.004, Y_LOW, Z_LOW), (HL + 0.03, Y_LOW, Z_LOW), PR * 1.3, 'copper'))
parts.append(cyl('flange_top', (HL + 0.004, Y_TOP, Z_TOP), (HL + 0.03, Y_TOP, Z_TOP), PR * 1.3, 'copper'))

# ---------------- join ----------------
bpy.ops.object.select_all(action='DESELECT')
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = shell
bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
obj.name = 'hydro_plant'
for p in list(scene.objects):
    if p is not obj:
        bpy.data.objects.remove(p, do_unlink=True)
me = obj.data
for pl in me.polygons:
    pl.use_smooth = False
print('faces', len(me.polygons), 'materials', [s.material.name for s in obj.material_slots])

# ---------------- camera / render setup ----------------
for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.resolution_x, scene.render.resolution_y = CANVAS
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
cam_data = bpy.data.cameras.new('game')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = CANVAS[0] / (SCALE * GROUND)
cam = bpy.data.objects.new('game', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
target = Vector((0, 0, (CENTRE[1] - CANVAS[1] / 2) / (SCALE * RISE)))
cam.location = target + Vector(TO_CAMERA) * 20
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_data.clip_end = 100

sun_dir = UP * 0.75 - RIGHT * 0.55 + TO_CAMERA * 0.55
sun_dir = sun_dir / np.linalg.norm(sun_dir)


def light(n):
    return 0.55 + 0.65 * np.clip(n @ sun_dir, 0, None)


slot_base = np.array([base_of(s.material) for s in obj.material_slots], np.float32)
face_base = slot_base[np.array([p.material_index for p in me.polygons])]
poly_of_loop = np.empty(len(me.loops), np.int32)
for p in me.polygons:
    poly_of_loop[p.loop_start:p.loop_start + p.loop_total] = p.index
N0 = np.empty(len(me.polygons) * 3)
me.polygons.foreach_get('normal', N0)
N0 = N0.reshape(-1, 3)
attr = me.color_attributes.new('lit', 'FLOAT_COLOR', 'CORNER')
lit_mat = bpy.data.materials.new('lit')
lit_mat.use_nodes = True
nt = lit_mat.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
ca = nt.nodes.new('ShaderNodeAttribute')
ca.attribute_name = 'lit'
ca.attribute_type = 'GEOMETRY'
em = nt.nodes.new('ShaderNodeEmission')
out = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(ca.outputs['Color'], em.inputs['Color'])
nt.links.new(em.outputs['Emission'], out.inputs['Surface'])

clay = bpy.data.materials.new('clay')
clay.use_nodes = True
bsdf = next(n for n in clay.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Base Color'].default_value = (0.72, 0.70, 0.66, 1)
bsdf.inputs['Roughness'].default_value = 0.9
sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = 3.2
sun = bpy.data.objects.new('sun', sun_data)
sun.rotation_euler = (-Vector(sun_dir)).to_track_quat('-Z', 'Y').to_euler()
wld = bpy.data.worlds.new('w')
wld.use_nodes = True
wld.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.5, 0.5, 1)
wld.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.55


def render(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def set_all(m):
    for s in obj.material_slots:
        s.material = m


measures = {}
for rot in range(4):
    ang = -math.pi / 2 * rot
    obj.rotation_euler = (0, 0, ang)
    bpy.context.view_layer.update()
    c, s_ = math.cos(ang), math.sin(ang)
    Rz = np.array([[c, -s_, 0], [s_, c, 0], [0, 0, 1]])
    Nn = N0 @ Rz.T
    col = np.ones((len(me.loops), 4), np.float32)
    col[:, :3] = (face_base * light(Nn)[:, None])[poly_of_loop]
    attr.data.foreach_set('color', col.ravel())
    me.update()
    scene.world = None
    set_all(lit_mat)
    render(os.path.join(OUT, f'hydro_plant-r{rot}-lit.png'))
    set_all(clay)
    if sun.name not in scene.collection.objects:
        scene.collection.objects.link(sun)
    scene.world = wld
    render(os.path.join(OUT, f'hydro_plant-r{rot}-bare.png'))
    scene.collection.objects.unlink(sun)
    set_all(lit_mat)

    def proj(p):
        co = world_to_camera_view(scene, cam, Vector(p))
        return [co.x * CANVAS[0], (1 - co.y) * CANVAS[1]]

    def corners(hx, hy):
        px = []
        for (x, y) in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)):
            px.append(proj(Matrix.Rotation(ang, 3, 'Z') @ Vector((x, y, 0))))
        w = min(px, key=lambda p: p[0]); e = max(px, key=lambda p: p[0])
        s = max(px, key=lambda p: p[1]); n = min(px, key=lambda p: p[1])
        return {k: [round(v[0], 2), round(v[1], 2)] for k, v in zip('wsen', (w, s, e, n))}

    fw, fh = 0.5, 0.5
    o = np.array(proj((0, 0, 0)))
    ux = np.array(proj((1, 0, 0))) - o
    uy = np.array(proj((0, 1, 0))) - o
    uz = np.array(proj((0, 0, 1))) - o
    fwd = np.array(cam.matrix_world.to_3x3() @ Vector((0, 0, -1)))
    azim = math.degrees(math.atan2(fwd[1], fwd[0]))
    measures[f'r{rot}'] = {
        'footprint_px': corners(fw, fh), 'model_base_px': corners(HL, HW),
        'camera': {
            'elevation_deg': round(math.degrees(math.asin(-fwd[2])), 4),
            'look_azimuth_deg_from_x': round(azim, 4),
            'azimuth_off_45_deg': round(abs(abs(azim) - 135), 4), 'ortho': True,
            'canvas_px_per_tile_edge_along_x': [round(float(ux[0]), 3), round(float(ux[1]), 3)],
            'canvas_px_per_tile_edge_along_y': [round(float(uy[0]), 3), round(float(uy[1]), 3)],
            'canvas_px_per_tile_of_height': round(float(-uz[1]), 3),
            'origin_px': [round(float(o[0]), 2), round(float(o[1]), 2)], 'anchor_px': list(CENTRE)},
    }
json.dump({'measures': measures, 'dims': {
    'footprint_tiles': [1, 1], 'base_tiles_r0': [2 * HL, 2 * HW], 'eaves_h_tiles': E, 'eaves_h_game_px': E * RISE,
    'ridge_h_tiles': R + RT, 'ridge_h_game_px': (R + RT) * RISE, 'lantern_top_tiles': mz1 + 0.052,
    'pitch_deg': 33, 'stone_base_h_tiles': FOOT, 'wall_thickness_tiles': WALL,
    'intake_top_tiles': 0.63, 'intake_wheel_top_tiles': 0.85, 'penstock_radius_tiles': PR,
    'window_half_w_tiles': WR, 'window_top_tiles': WSP + WR, 'tailrace_top_tiles': TSP + TR,
    'tailrace_floor': 'opaque dark floor and sill (no see-through notch)'}}, open(os.path.join(OUT, 'measures.json'), 'w'), indent=1)
obj.rotation_euler = (0, 0, 0)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'hydro_plant.blend'))
print('done')
