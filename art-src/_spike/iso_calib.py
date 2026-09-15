"""Headless Blender calibration: does the documented camera put one tile on exactly 64x32 px?

Run with the `bpy` PyPI module, no Blender app and no display:
    python3 iso_calib.py <render_px> <out.png> [engine]
"""

import math
import sys

import bpy

RENDER_PX = int(sys.argv[1]) if len(sys.argv) > 1 else 256
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/iso_calib.png"
ENGINE = sys.argv[3] if len(sys.argv) > 3 else None

# --- clean scene -------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --- the object under test: one tile, flat on the ground, centred on the origin -----------------
bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0))
plane = bpy.context.active_object
mat = bpy.data.materials.new("flat")
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.9, 0.85, 0.7, 1)
plane.data.materials.append(mat)

# --- camera: docs/mcp-setup.md section 6.3 ------------------------------------------------------
cam_data = bpy.data.cameras.new("iso")
cam_data.type = "ORTHO"
cam_data.ortho_scale = RENDER_PX * math.sqrt(2) / 64.0
cam = bpy.data.objects.new("iso", cam_data)
scene.collection.objects.link(cam)
cam.rotation_euler = (math.radians(60), 0.0, math.radians(45))
# distance along the view axis does not matter for an orthographic camera
cam.location = (10, -10, 8.165)
scene.camera = cam

# --- render settings ----------------------------------------------------------------------------
scene.render.resolution_x = RENDER_PX
scene.render.resolution_y = RENDER_PX
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.filepath = OUT
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"

engines = [ENGINE] if ENGINE else ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES", "BLENDER_WORKBENCH"]
used = None
for e in engines:
    if not e:
        continue
    try:
        scene.render.engine = e
        used = e
        break
    except TypeError as err:
        print(f"engine {e} unavailable: {err}")
if used == "CYCLES":
    scene.cycles.samples = 16
    scene.cycles.device = "CPU"

print(f"blender {bpy.app.version_string} engine {used} ortho_scale {cam_data.ortho_scale:.5f}")
bpy.ops.render.render(write_still=True)
print("wrote", OUT)
