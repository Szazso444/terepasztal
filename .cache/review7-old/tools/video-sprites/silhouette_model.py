"""Mk48 reconstruction from the turntable video + game-camera facing renders.
Run: venv/bin/python mk48.py <outdir> [scale_px_per_tile_unit]
Model frame: Z up, origin = ground centre of footprint at rail top, nose (long hood) toward +X.
Dimensions measured on a side-on video frame (px), converted with S metres/px.
"""
import bpy, math, sys, os, mathutils

OUT = sys.argv[1]
SS = int(sys.argv[2]) if len(sys.argv) > 2 else 4          # supersample
os.makedirs(OUT, exist_ok=True)

S = 7.6 / 818.0              # m per video px: frame length 818 px -> 7.6 m (1 tile 8 m minus coupler gap)
X0, Y0 = 669.0, 578.0        # video px of frame centre / rail level
W = 1.3                      # game DRAWN_WIDTH
def X(px): return (px - X0) * S
def Z(py): return (Y0 - py) * S

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

def mat(name, rgb, rough=0.6, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*[c ** 2.2 for c in rgb], 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = 0
    if emit:
        b.inputs['Emission Color'].default_value = (1, 0.9, 0.6, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m

RED = mat('red', (0.70, 0.17, 0.06), 0.55)
REDD = mat('red_dark', (0.50, 0.11, 0.04), 0.6)
DARK = mat('frame', (0.15, 0.17, 0.17), 0.7)
DARKER = mat('wheel', (0.11, 0.11, 0.10), 0.6)
BOGIE = mat('bogie', (0.30, 0.31, 0.28), 0.45)
YEL = mat('yellow', (0.92, 0.70, 0.12), 0.4)
GLASS = mat('glass', (0.27, 0.55, 0.56), 0.15)
TANK = mat('tank', (0.36, 0.40, 0.37), 0.5)
LAMP = mat('lamp', (1, 0.9, 0.6), 0.3, emit=6)

def box(name, x0, x1, z0, z1, hw, m, y=0.0, bevel=0.03, hwx=None):
    """axis box: x0..x1 and z0..z1 in metres, half width hw (already includes DRAWN_WIDTH)."""
    bpy.ops.mesh.primitive_cube_add()
    o = bpy.context.object
    o.name = name
    o.scale = ((x1 - x0) / 2, hw, (z1 - z0) / 2)
    o.location = ((x0 + x1) / 2, y, (z0 + z1) / 2)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(m)
    if bevel:
        bm = o.modifiers.new('bv', 'BEVEL')
        bm.width = bevel; bm.segments = 2
    return o

def cyl(name, r, depth, loc, rot, m, verts=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.data.materials.append(m)
    return o

def sphere(name, r, loc, m):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=16, ring_count=8)
    o = bpy.context.object; o.name = name; o.data.materials.append(m)
    return o

def tube(name, pts, r, m):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = r; cu.bevel_resolution = 3
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for p, v in zip(sp.points, pts): p.co = (*v, 1)
    o = bpy.data.objects.new(name, cu); sc.collection.objects.link(o)
    o.data.materials.append(m)
    return o

# ---- widths (half, metres, x DRAWN_WIDTH) -------------------------------------
HW_FRAME = 1.25 * W
HW_CAB = 1.22 * W
HW_HOOD = 0.98 * W

# ---- frame / deck --------------------------------------------------------------
deck_z0, deck_z1 = Z(480), Z(455)
box('deck', X(260), X(1078), deck_z0, deck_z1, HW_FRAME, DARK)
box('end_a', X(262), X(318), Z(555), deck_z0, HW_FRAME * 0.8, DARK)       # headstock blocks
box('end_b', X(1012), X(1078), Z(555), deck_z0, HW_FRAME * 0.8, DARK)
box('belly', X(330), X(1000), Z(498), deck_z0, HW_FRAME * 0.75, DARK)

# ---- bogies ----------------------------------------------------------------------
WR = 35 * S
for bx in (450, 890):
    cx = X(bx)
    box(f'bogie_{bx}', cx - 1.0, cx + 1.0, Z(548), Z(500), HW_FRAME * 0.62, BOGIE, bevel=0.05)
    for dx in (-0.6, 0.6):
        for side in (-1, 1):
            cyl('wheel', WR, 0.14, (cx + dx, side * HW_FRAME * 0.62, WR), (math.pi / 2, 0, 0), DARKER)
        cyl('axle', 0.07, HW_FRAME * 1.3, (cx + dx, 0, WR), (math.pi / 2, 0, 0), DARKER, 12)
    for side in (-1, 1):
        box('springbox', cx - 0.7, cx + 0.7, Z(540), Z(510), 0.08, BOGIE, y=side * HW_FRAME * 0.55, bevel=0.02)

# ---- fuel tank -----------------------------------------------------------------------
cyl('tank', 30 * S, 1.6 * W, (X(660), 0, Z(515)), (math.pi / 2, 0, 0), TANK, 24)

# ---- short hood (x 275..410), cab, long hood -----------------------------------------
box('short_hood', X(275), X(412), deck_z1, Z(278), HW_HOOD, RED, bevel=0.04)
box('cab', X(410), X(610), deck_z1, Z(268 - 24), HW_CAB, RED, bevel=0.04)
box('cab_roof', X(404), X(616), Z(243), Z(150), HW_CAB + 0.06, RED, bevel=0.05)
box('long_hood', X(610), X(966), deck_z1, Z(245), HW_HOOD, RED, bevel=0.04)
box('end_cap', X(964), X(1046), deck_z1, Z(247), HW_HOOD, RED, bevel=0.05)
box('hood_grille', X(795), X(918), Z(248), Z(287), HW_HOOD * 0.55, DARKER, bevel=0.01).location.z += 0.0  # roof radiator grille
box('hatch', X(648), X(684), Z(250), Z(278), HW_HOOD * 0.22, REDD, bevel=0.02)
sphere('roof_knob', 0.09, (X(520), 0, Z(150) + 0.04), REDD)
sphere('cap_knob', 0.07, (X(1010), 0, Z(247) + 0.03), REDD)

# ---- louvres & doors on hoods (thin dark panels proud of the side) ---------------------
for side in (-1, 1):
    y = side * (HW_HOOD + 0.012)
    for a, b in ((625, 678), (686, 730), (742, 798), (806, 852), (866, 918), (925, 955)):
        box('louvre', X(a), X(b), Z(430), Z(320), 0.012, REDD, y=y, bevel=0)
        for k in range(6):
            zz = Z(425 - 17 * k)
            box('slat', X(a + 6), X(b - 6), zz - 0.012, zz + 0.012, 0.012, DARKER, y=y + side * 0.012, bevel=0)
    for a, b in ((290, 330), (338, 378)):
        box('louvre_s', X(a), X(b), Z(430), Z(370), 0.012, REDD, y=y, bevel=0)
    box('door_end', X(968), X(1030), Z(430), Z(335), 0.012, REDD, y=y, bevel=0)

# ---- cab glazing -------------------------------------------------------------------------
for side in (-1, 1):
    y = side * (HW_CAB + 0.012)
    for a, b in ((428, 458), (478, 520), (546, 592)):
        box('win_side', X(a), X(b), Z(332), Z(268), 0.012, GLASS, y=y, bevel=0)
    for px in (462, 527, 620):
        tube('grab', [(X(px), y + side * 0.06, Z(440)), (X(px), y + side * 0.06, Z(270))], 0.03, YEL)
for sx, d, zt, zb in ((X(410), -1, Z(186), Z(250)), (X(610), 1, Z(178), Z(232))):
    for ww in (-1, 1):
        x0, x1 = (sx - 0.014, sx + 0.004) if d < 0 else (sx - 0.004, sx + 0.014)
        box('win_end', x0, x1, zt, zb, 0.40 * W, GLASS, y=ww * 0.55 * W, bevel=0).location.x += 0

# ---- handrails & end details ------------------------------------------------------------------
def rail_u(x, side, xe, z0=None):
    y = side * (HW_FRAME - 0.06)
    z = deck_z1
    tube('rail', [(X(x), y, z), (X(x), y, z + 0.55), (X(xe), y, z + 0.55), (X(xe), y, z)], 0.028, YEL)
for side in (-1, 1):
    rail_u(280, side, 318)
    rail_u(1040, side, 1000)
    y = side * (HW_FRAME - 0.05)
    tube('post_a', [(X(276), y, deck_z1), (X(276), y, Z(300))], 0.03, YEL)
    tube('post_b', [(X(1044), y, deck_z1), (X(1044), y, Z(380))], 0.03, YEL)
for xe, d in ((X(262), -1), (X(1078), 1)):
    box('coupler', xe - 0.02 if d < 0 else xe - 0.02, xe + (-0.25 if d < 0 else 0.25), Z(535), Z(505), 0.17, DARK, bevel=0.02)
    for side in (-1, 1):
        tube('hose', [(xe, side * 0.75 * W, Z(525)), (xe + d * 0.18, side * 0.75 * W, Z(525)), (xe + d * 0.18, side * 0.75 * W, Z(490))], 0.03, DARKER)
# headlamps, both ends
sphere('lamp_a', 0.11, (X(275) - 0.03, 0, Z(330)), LAMP)
sphere('lamp_b', 0.11, (X(1046) + 0.03, 0, Z(330)), LAMP)
for xs, d in ((X(275), -1), (X(1046), 1)):
    box('end_grille', xs + d * 0.005 - 0.01, xs + d * 0.02 + 0.01 if d > 0 else xs - 0.02, Z(395), Z(350), HW_HOOD * 0.45, REDD, bevel=0)

# ---- join the model ------------------------------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
for o in list(bpy.data.objects):
    if o.type == 'CURVE':
        bpy.context.view_layer.objects.active = o; o.select_set(True)
        bpy.ops.object.convert(target='MESH')
    o.select_set(False)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
loco = bpy.context.object; loco.name = 'mk48'
bpy.ops.object.shade_smooth()
bpy.ops.object.shade_flat()

# empty pivot for yaw
pivot = bpy.data.objects.new('pivot', None); sc.collection.objects.link(pivot)
loco.parent = pivot

# ---- scene: ground shadow catcher, sun, ambient ---------------------------------------------------------
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.001))
gnd = bpy.context.object; gnd.is_shadow_catcher = True
if os.environ.get('NOSHADOW'): gnd.hide_render = True
sun_data = bpy.data.lights.new('sun', 'SUN'); sun_data.energy = 2.4; sun_data.angle = math.radians(3)
sun = bpy.data.objects.new('sun', sun_data); sc.collection.objects.link(sun)
az = math.radians(-100); el = math.radians(45)
d = mathutils.Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))   # direction TO the light
sun.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
w = bpy.data.worlds.new('w'); w.use_nodes = True; sc.world = w
bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = (1, 1, 1, 1); bg.inputs['Strength'].default_value = 0.5

# ---- camera: orthographic, rot (60,0,45), 1 unit = 64/sqrt2 px ----------------------------------------------
TILE_PX = 64
PX = TILE_PX / (8.0 * math.sqrt(2))             # px per metre (tile_m = 8)
CANVAS = 96                                     # game px
ortho = CANVAS * math.sqrt(2) / TILE_PX * 8.0 * 1.0   # ortho_scale in metres at tile_m = 8  (= 11.3137 * CANVAS/64*... )
cam_d = bpy.data.cameras.new('cam'); cam_d.type = 'ORTHO'
cam_d.ortho_scale = CANVAS / PX
cam = bpy.data.objects.new('cam', cam_d); sc.collection.objects.link(cam)
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.view_layer.update()
fwd = cam.rotation_euler.to_quaternion() @ mathutils.Vector((0, 0, -1))
# aim the optical axis at a point on the ground plane (origin lifted so the model sits mid-canvas)
target = mathutils.Vector((0, 0, 1.6))
cam.location = target - fwd * 40
sc.camera = cam
cam_d.clip_start = 0.1; cam_d.clip_end = 200

r = sc.render
r.resolution_x = r.resolution_y = CANVAS * SS
r.film_transparent = True
try:
    r.engine = 'CYCLES'
except TypeError:
    pass
sc.cycles.device = 'CPU'; sc.cycles.samples = int(os.environ.get('SAMPLES', 96)); sc.cycles.use_denoising = not os.environ.get('NOSHADOW')
sc.cycles.film_exposure = 1.0
r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'

FAC = 48
drawn = [f for f in range(FAC) if f <= (12 - f) % FAC]
if os.environ.get('ALLFAC'): drawn = list(range(FAC))
# anchor = projection of the world origin on the canvas (px from top-left, game px)
bpy.context.view_layer.update()
from bpy_extras.object_utils import world_to_camera_view
co = world_to_camera_view(sc, cam, mathutils.Vector((0, 0, 0)))
ax, ay = co.x * CANVAS, (1 - co.y) * CANVAS
print('ANCHOR', ax, ay, 'drawn', drawn)
open(os.path.join(OUT, 'anchor.txt'), 'w').write(f'{ax} {ay}\n')
for f in drawn:
    pivot.rotation_euler = (0, 0, math.radians(-7.5 * f))
    r.filepath = os.path.join(OUT, f'mk48_f{f}.png')
    bpy.ops.render.render(write_still=True)
print('DONE')
