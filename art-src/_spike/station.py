"""A station as a program, not a mesh: the shape an agent writes and the pipeline re-runs.

Everything is parametric and palette-locked to src/art/palette.ts. One key light from screen
upper-left plus a sky fill, Cycles for real ambient occlusion and contact shadows.

    python3 station.py <px_per_tile> <out.png>
"""

import math
import sys

import os

import bpy

PX_PER_TILE = int(sys.argv[1]) if len(sys.argv) > 1 else 64
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/station.png"
TILES_ACROSS = 2.3  # how much ground the frame covers
# parameters the agent loop tunes; defaults are the current best
P_WALL = float(os.environ.get("P_WALL", 0.36))
P_RIDGE = float(os.environ.get("P_RIDGE", 0.17))
P_OVERHANG = float(os.environ.get("P_OVERHANG", 0.12))
P_SUN = float(os.environ.get("P_SUN", -28))
P_ELEV = float(os.environ.get("P_ELEV", 52))
P_FILL = float(os.environ.get("P_FILL", 0.55))

# --- palette (src/art/palette.ts), linear-ised ---------------------------------------------------
def srgb(r, g, b):
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (lin(r), lin(g), lin(b), 1.0)


LIMESTONE = srgb(188, 169, 139)
LIMESTONE_TRIM = srgb(206, 190, 162)
SLATE = srgb(98, 107, 108)
TIMBER = srgb(158, 116, 70)
IRON = srgb(86, 96, 102)
AMBER = srgb(232, 170, 72)
BALLAST = srgb(152, 146, 134)
RAIL = srgb(128, 132, 136)
GRASS = srgb(122, 146, 76)
WHITE = srgb(236, 228, 208)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, colour, rough=0.85, emit=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = colour
        bsdf.inputs["Emission Strength"].default_value = emit
    return mat


MATS = {
    "limestone": material("limestone", LIMESTONE),
    "trim": material("trim", LIMESTONE_TRIM, 0.8),
    "slate": material("slate", SLATE, 0.7),
    "timber": material("timber", TIMBER),
    "iron": material("iron", IRON, 0.5),
    "amber": material("amber", AMBER, 0.4, emit=1.5),
    "ballast": material("ballast", BALLAST),
    "rail": material("rail", RAIL, 0.35),
    "grass": material("grass", GRASS, 1.0),
    "white": material("white", WHITE, 0.8),
}


def box(name, size, loc, mat, rot_z=0.0):
    """Axis-aligned box given by (x, y, z) size, centred on loc in x/y and sitting on loc.z."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(loc[0], loc[1], loc[2] + size[2] / 2))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (size[0], size[1], size[2])
    ob.rotation_euler = (0, 0, rot_z)
    ob.data.materials.append(MATS[mat])
    bpy.ops.object.shade_flat()
    return ob


def roof(name, length, width, height, ridge, loc, mat):
    """Pitched roof as a prism: two slopes meeting a ridge running along +x."""
    hl, hw = length / 2, width / 2
    verts = [
        (-hl, -hw, 0),
        (hl, -hw, 0),
        (hl, hw, 0),
        (-hl, hw, 0),
        (-hl, 0, ridge),
        (hl, 0, ridge),
    ]
    faces = [(0, 1, 5, 4), (3, 2, 5, 4)[::-1], (0, 4, 3), (1, 2, 5)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    ob = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(ob)
    ob.location = (loc[0], loc[1], loc[2] + height)
    ob.data.materials.append(MATS[mat])
    return ob


# --- ground, platform and track ------------------------------------------------------------------
box("ground", (2.0, 2.0, 0.04), (0, 0, -0.04), "grass")
box("ballast", (2.0, 0.58, 0.05), (0, 0.6, -0.02), "ballast")
for side in (-0.16, 0.16):
    box(f"rail{side}", (2.0, 0.04, 0.045), (0, 0.6 + side, 0.03), "rail")
for i in range(13):
    box(f"sleeper{i}", (0.075, 0.42, 0.028), (-0.95 + i * 0.16, 0.6, 0.0), "timber")

# platform: a raised slab with a pale coping along the track edge
box("platform", (1.45, 0.6, 0.095), (-0.05, 0.06, 0.0), "limestone")
box("coping", (1.45, 0.06, 0.105), (-0.05, 0.33, 0.0), "trim")

# --- station building ----------------------------------------------------------------------------
HALL_L, HALL_W, HALL_H = 0.86, 0.44, P_WALL
hall_x, hall_y = -0.12, -0.16
box("hall", (HALL_L, HALL_W, HALL_H), (hall_x, hall_y, 0.095), "limestone")
# string course: a pale band where wall meets eaves, the cue that reads as masonry
box("course", (HALL_L + 0.02, HALL_W + 0.02, 0.025), (hall_x, hall_y, 0.095 + HALL_H - 0.03), "trim")
box("plinth", (HALL_L + 0.04, HALL_W + 0.04, 0.04), (hall_x, hall_y, 0.095), "trim")
roof("hall_roof", HALL_L + P_OVERHANG * 0.8, HALL_W + P_OVERHANG, 0.095 + HALL_H, P_RIDGE, (hall_x, hall_y, 0), "slate")

# clock gable at the west end
GABLE = 0.56
box("gable", (0.26, 0.3, GABLE), (hall_x - 0.42, hall_y, 0.095), "limestone")
roof("gable_roof", 0.32, 0.36, 0.095 + GABLE, 0.14, (hall_x - 0.42, hall_y, 0), "slate")
box("clock", (0.02, 0.11, 0.11), (hall_x - 0.555, hall_y, 0.42), "white")

# chimney
box("chimney", (0.075, 0.075, 0.22), (hall_x + 0.3, hall_y - 0.1, 0.42), "limestone")
box("chimney_cap", (0.095, 0.095, 0.03), (hall_x + 0.3, hall_y - 0.1, 0.64), "trim")

# windows and door on the platform face
for i, wx in enumerate((-0.3, -0.1, 0.1, 0.3)):
    box(f"win_frame{i}", (0.115, 0.015, 0.165), (hall_x + wx, hall_y + HALL_W / 2, 0.095 + HALL_H * 0.33), "trim")
    box(f"win{i}", (0.085, 0.02, 0.13), (hall_x + wx, hall_y + HALL_W / 2 + 0.005, 0.095 + HALL_H * 0.38), "amber")
box("door_frame", (0.13, 0.015, 0.25), (hall_x + 0.46, hall_y + HALL_W / 2, 0.095), "trim")
box("door", (0.1, 0.02, 0.22), (hall_x + 0.46, hall_y + HALL_W / 2 + 0.005, 0.095), "timber")

# --- canopy over the platform --------------------------------------------------------------------
CANOPY_Z = 0.44
box("canopy", (1.2, 0.46, 0.025), (-0.05, 0.14, CANOPY_Z), "slate")
box("canopy_edge", (1.2, 0.03, 0.05), (-0.05, 0.36, CANOPY_Z - 0.04), "trim")
for i, cx in enumerate((-0.56, -0.19, 0.19, 0.56)):
    box(f"post{i}", (0.028, 0.028, CANOPY_Z - 0.095), (cx, 0.33, 0.095), "iron")
    box(f"bracket{i}", (0.09, 0.02, 0.02), (cx + 0.04, 0.33, CANOPY_Z - 0.06), "iron")

# --- platform furniture --------------------------------------------------------------------------
box("bench", (0.24, 0.08, 0.025), (0.36, 0.0, 0.16), "timber")
box("bench_back", (0.24, 0.02, 0.08), (0.36, -0.035, 0.185), "timber")
for i, lx in enumerate((-0.45, 0.5)):
    box(f"lamp{i}", (0.024, 0.024, 0.24), (lx, 0.28, 0.095), "iron")
    box(f"lamp_head{i}", (0.06, 0.06, 0.055), (lx, 0.28, 0.335), "amber")

box("board", (0.26, 0.018, 0.08), (0.05, 0.27, 0.23), "white")
box("board_post", (0.018, 0.018, 0.14), (0.05, 0.27, 0.095), "timber")

# --- light: one key from screen upper-left, sky fill, no hard rim -------------------------------
sun_data = bpy.data.lights.new("key", type="SUN")
sun_data.energy = 3.4
sun_data.angle = math.radians(6)  # slightly soft shadow edge
sun_data.color = (1.0, 0.96, 0.88)
sun = bpy.data.objects.new("key", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(P_ELEV), 0, math.radians(P_SUN))

world = bpy.data.worlds.new("sky")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = srgb(150, 178, 190)  # cool sky fill, so shadows are not black
bg.inputs[1].default_value = P_FILL
scene.world = world

# --- camera: docs/mcp-setup.md section 6.3 --------------------------------------------------------
render_px = int(PX_PER_TILE * TILES_ACROSS)
cam_data = bpy.data.cameras.new("iso")
cam_data.type = "ORTHO"
cam_data.ortho_scale = render_px * math.sqrt(2) / PX_PER_TILE
cam = bpy.data.objects.new("iso", cam_data)
scene.collection.objects.link(cam)
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
cam.location = (12, -12, 9.8)
scene.camera = cam

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 160
scene.cycles.use_denoising = True
scene.render.resolution_x = render_px
scene.render.resolution_y = render_px
scene.render.film_transparent = True
scene.render.filepath = OUT
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Standard"  # keep the palette exactly as authored

print(f"render {render_px}px, {PX_PER_TILE}px per tile, ortho {cam_data.ortho_scale:.4f}")
bpy.ops.render.render(write_still=True)
print("wrote", OUT)
