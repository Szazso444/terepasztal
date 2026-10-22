"""Narrow depot (depot_narrow) blockout scaffold.  blender -b -P build_nd.py -- <out dir>

Modelled directly: 2 x 1 tile footprint, long axis along X, single track.  Blender X = game x,
Blender Y = - game y.  Front (crew door, windows) wall is on -Y: lower left at r0.  Units: tiles
(1 tile of height = 39.19 game px).  Renders r0..r3 at the game camera on the t1x2 canvas.
"""
import json, math, os, sys
import bpy, bmesh
import numpy as np
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)

CANVAS = (1024, 1024)
CENTRE = (512, 800)            # t1x2 guide anchor
SCALE = 8
GROUND = 32 / math.cos(math.radians(45))
RISE = GROUND * math.cos(math.radians(30))
EL, AZ = math.radians(30), math.radians(-45)
TO_CAMERA = np.array([math.cos(EL) * math.cos(AZ), math.cos(EL) * math.sin(AZ), math.sin(EL)])
RIGHT = np.array([1, 1, 0]) / math.sqrt(2)
UP = np.cross(RIGHT, -TO_CAMERA)

# ---------------- dimensions (tiles) ----------------
HL, HW = 0.94, 0.44            # base half length / half width: footprint 2 x 1 set in by 0.06
E = 34 / RISE                  # eaves height: the guide block's 34 game px
FOOT = 0.12                    # cream stone footing
PITCH = math.radians(34)
R = E + HW * math.tan(PITCH)   # ridge of the wall shell
WALL = 0.05
FLOOR = 0.015
ARCH_W, ARCH_H = 0.44, 24 / RISE   # portal 0.44 tile wide, 24 game px high
AR = ARCH_W / 2
ARCH_SPRING = ARCH_H - AR


def srgb(c):
    return [(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c]


COL = {
    'cream': (0.90, 0.82, 0.62), 'brick': (0.72, 0.34, 0.22), 'plank': (0.17, 0.36, 0.22),
    'timber': (0.45, 0.28, 0.15), 'slate': (0.30, 0.33, 0.40), 'monitor': (0.13, 0.30, 0.18),
    'louvre': (0.80, 0.74, 0.55), 'door': (0.10, 0.42, 0.20), 'glass': (0.20, 0.28, 0.36),
    'interior': (0.16, 0.12, 0.10), 'floor': (0.27, 0.21, 0.16), 'chimney': (0.66, 0.30, 0.20), 'slot': (0.12, 0.12, 0.14),
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


def prism(name, pts, x0, x1, mat):
    """pts: closed polygon in (y, z), extruded along X from x0 to x1."""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in pts]
    b = [bm.verts.new((x1, y, z)) for y, z in pts]
    n = len(pts)
    bm.faces.new(a)
    bm.faces.new(b[::-1])
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, [mat])


def arch_pts(r, z0=0.0, n=14):
    zs = ARCH_SPRING
    pts = [(-r, z0), (-r, zs)]
    for i in range(1, n):
        t = math.pi - math.pi * i / n
        pts.append((r * math.cos(t), zs + r * math.sin(t)))
    pts += [(r, zs), (r, z0)]
    return pts


def boolean(target, cutter):
    bpy.context.view_layer.objects.active = target
    md = target.modifiers.new('b', 'BOOLEAN')
    md.operation, md.operand_type, md.object, md.solver = 'DIFFERENCE', 'OBJECT', cutter, 'EXACT'
    try:
        md.material_mode = 'TRANSFER'
    except Exception as e:
        print('no material_mode', e)
    bpy.ops.object.modifier_apply(modifier=md.name)


# ---------------- the shell ----------------
posts = [(-0.94, -0.89), (-0.30, -0.25), (0.25, 0.30), (0.89, 0.94)]
stations = sorted({s for p in posts for s in p})
P = [(-HW, 0), (-HW, FOOT), (-HW, E), (0, R), (HW, E), (HW, FOOT), (HW, 0)]
bm = bmesh.new()
ring = {x: [bm.verts.new((x, y, z)) for y, z in P] for x in stations}
MI = {k: i for i, k in enumerate(['cream', 'brick', 'plank', 'timber', 'slate'])}


def f(vs, key):
    fc = bm.faces.new(vs)
    fc.material_index = MI[key]


for x0, x1 in zip(stations, stations[1:]):
    a, b = ring[x0], ring[x1]
    wall = 'timber' if (x0, x1) in posts else 'plank'

    def q(i, j, key):
        f((a[i], a[j], b[j], b[i]), key)
    q(0, 1, 'cream'); q(1, 2, wall); q(2, 3, 'slate'); q(3, 4, 'slate')
    q(4, 5, wall); q(5, 6, 'cream'); f((a[6], a[0], b[0], b[6]), 'cream')
for x in (stations[0], stations[-1]):
    r_ = ring[x]
    f((r_[0], r_[1], r_[5], r_[6]), 'cream')
    f((r_[1], r_[2], r_[3], r_[4], r_[5]), 'brick')
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
shell = new_obj('shell', bm, ['cream', 'brick', 'plank', 'timber', 'slate'])

cutters = []
cutters.append(box('cavity', 0, 0, (FLOOR + E - 0.07) / 2, 2 * (HL - WALL), 2 * (HW - WALL), E - 0.07 - FLOOR, 'interior'))
for sgn in (1, -1):
    x0, x1 = (HL - 0.10, HL + 0.05) if sgn > 0 else (-HL - 0.05, -HL + 0.10)
    cutters.append(prism('tunnel', [(y, max(z, FLOOR)) for y, z in arch_pts(AR, FLOOR)], x0, x1, 'interior'))
# windows (both long walls) and the crew door (front, -Y), recessed 0.03 into the wall
for side in (-1, 1):
    ylo, yhi = (side * HW - 0.03, side * HW + 0.06) if side > 0 else (side * HW - 0.06, side * HW + 0.03)
    for x in (-0.60, 0.60):
        cutters.append(box('window', x, (ylo + yhi) / 2, 0.44, 0.14, yhi - ylo, 0.24, 'glass'))
ylo, yhi = -HW - 0.06, -HW + 0.03
cutters.append(box('crewdoor', 0.0, (ylo + yhi) / 2, (0.46 - 0.02) / 2, 0.16, yhi - ylo, 0.48, 'door'))
for c in cutters:
    boolean(shell, c)
for c in cutters:
    bpy.data.objects.remove(c, do_unlink=True)

parts = [shell]
# ---------------- solid portal floor (Core review 2) ----------------
# The doorway must read as SOLID: an opaque dark floor and hall inside it, no see-through notch, no cream
# footing sliver across the sill.  A dark plate fills the portal sill from the ground up to just above the
# hall floor (it stands 0.0015 tile proud of the end-wall plane, over the footing strip the tunnel cut
# leaves), and a dark floor slab runs the whole length of the hall under the portals.
FL_TOP = FLOOR + 0.004
for sgn in (1, -1):
    x_in, x_out = HL - 0.10, HL + 0.0015
    xa, xb = (x_in, x_out) if sgn > 0 else (-x_out, -x_in)
    parts.append(box('sill', (xa + xb) / 2, 0, FL_TOP / 2, xb - xa, 2 * AR, FL_TOP, 'floor'))
parts.append(box('hall_floor', 0, 0, FL_TOP / 2 - 0.001, 2 * (HL - WALL) - 0.004, 2 * (HW - WALL) - 0.008, FL_TOP, 'floor'))
# ---------------- roof ----------------
t = 0.03
ov, vo = 0.025, 0.02


def zb(y):
    return R - abs(y) * math.tan(PITCH)


RT = t / math.cos(PITCH)
rp = [(-(HW + ov), zb(HW + ov)), (0, R), (HW + ov, zb(HW + ov)), (HW + ov, zb(HW + ov) + RT), (0, R + RT), (-(HW + ov), zb(HW + ov) + RT)]
parts.append(prism('roof', rp, -HL - vo, HL + vo, 'slate'))


def roof_top(y):
    return R + RT - abs(y) * math.tan(PITCH)


# ridge monitor (the smoke / ventilation lantern along the ridge)
mx0, mx1, mw = -0.45, 0.65, 0.10
mz0 = roof_top(mw) - 0.03
mz1 = R + RT + 0.095
parts.append(prism('monitor', [(-mw, mz0), (-mw, mz1), (mw, mz1), (mw, mz0)], mx0, mx1, 'monitor'))
for side in (-1, 1):
    parts.append(box('louvre', (mx0 + mx1) / 2, side * (mw + 0.004), (roof_top(mw) + mz1) / 2 + 0.002,
                     (mx1 - mx0) - 0.14, 0.008, mz1 - roof_top(mw) - 0.05, 'louvre'))
mc = [(-(mw + 0.03), mz1), (0, mz1 + 0.05), (mw + 0.03, mz1), (mw + 0.03, mz1 + 0.012), (0, mz1 + 0.062), (-(mw + 0.03), mz1 + 0.012)]
parts.append(prism('monitor_roof', mc, mx0 - 0.03, mx1 + 0.03, 'slate'))
# chimney / smoke stack on the west gable
cx = -HL + 0.08
parts.append(box('chimney', cx, 0, (R - 0.12 + R + 0.30) / 2, 0.15, 0.15, 0.42, 'chimney'))
parts.append(box('chimney_cap', cx, 0, R + 0.315, 0.19, 0.19, 0.03, 'cream'))
# small slope vents, two on each slope
for side in (-1, 1):
    for x in (-0.60, 0.60):
        y = side * 0.28
        parts.append(box('vent', x, y, roof_top(y) + 0.012, 0.10, 0.09, 0.05, 'cream', rot_x=(-PITCH if side > 0 else PITCH)))
# arch surrounds and folded-back door leaves
for sgn in (1, -1):
    xo = sgn * HL
    xa, xb = (xo - 0.01, xo + 0.012) if sgn > 0 else (xo - 0.012, xo + 0.01)
    outer = prism('ring', [(y, max(z, FLOOR)) for y, z in arch_pts(AR + 0.05, FLOOR)], xa, xb, 'cream')
    inner = prism('ringcut', [(y, max(z, FLOOR)) for y, z in arch_pts(AR, FLOOR)], xa - 0.05, xb + 0.05, 'interior')
    boolean(outer, inner)
    bpy.data.objects.remove(inner, do_unlink=True)
    parts.append(outer)
    phi = math.radians(10)
    for ys in (-1, 1):
        wlen, hgt, thick = 0.19, 0.50, 0.012
        u = [(0, FLOOR), (wlen, FLOOR), (wlen, 0.40), (0, hgt)]
        bm = bmesh.new()

        def lp(uu, vv, tt):
            return (xo + sgn * (0.012 + uu * math.sin(phi) + tt * math.cos(phi)), ys * (AR + uu * math.cos(phi)), vv)
        v0 = [bm.verts.new(lp(uu, vv, 0.0)) for uu, vv in u]
        v1 = [bm.verts.new(lp(uu, vv, thick)) for uu, vv in u]
        bm.faces.new(v0)
        bm.faces.new(v1[::-1])
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((v0[i], v0[j], v1[j], v1[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        parts.append(new_obj('leaf', bm, ['door']))

# ---------------- join ----------------
bpy.ops.object.select_all(action='DESELECT')
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = shell
bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
obj.name = 'depot_narrow'
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
    render(os.path.join(OUT, f'depot_narrow-r{rot}-lit.png'))
    set_all(clay)
    if sun.name not in scene.collection.objects:
        scene.collection.objects.link(sun)
    scene.world = wld
    render(os.path.join(OUT, f'depot_narrow-r{rot}-bare.png'))
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

    fw, fh = 1.0, 0.5
    bw, bh = HL, HW
    o = np.array(proj((0, 0, 0)))
    ux = np.array(proj((1, 0, 0))) - o
    uy = np.array(proj((0, 1, 0))) - o
    uz = np.array(proj((0, 0, 1))) - o
    fwd = np.array(cam.matrix_world.to_3x3() @ Vector((0, 0, -1)))
    azim = math.degrees(math.atan2(fwd[1], fwd[0]))
    measures[f'r{rot}'] = {
        'footprint_px': corners(fw, fh), 'model_base_px': corners(bw, bh),
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
    'footprint_tiles_r0': [2, 1], 'base_tiles_r0': [2 * HL, 2 * HW], 'eaves_h_tiles': E, 'eaves_h_game_px': E * RISE,
    'ridge_h_tiles': R + RT, 'ridge_h_game_px': (R + RT) * RISE, 'monitor_top_tiles': mz1 + 0.062,
    'chimney_top_tiles': R + 0.33, 'pitch_deg': 34, 'portal_w_tiles': ARCH_W, 'portal_h_game_px': ARCH_H * RISE,
    'footing_h_tiles': FOOT, 'wall_thickness_tiles': WALL, 'portal_floor': 'opaque dark floor slab and sill'}}, open(os.path.join(OUT, 'measures.json'), 'w'), indent=1)
obj.rotation_euler = (0, 0, 0)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'depot_narrow.blend'))
print('done')
