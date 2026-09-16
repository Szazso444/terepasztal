"""Render one asset program in an isolated Blender process, and print its anchor.

    python3 art-src/render_asset.py <module.py> <out.png> [px_per_tile]

The module must define `build(kit)`. This script owns the scene reset, the camera, the light and
the render, so the asset program only describes geometry. One asset per process is the reset
boundary: `bpy` imports once per process, and this keeps a crash in one asset from touching the
next. The anchor printed on the last line is where the world origin projects, in render pixels
before the packer trims — the point the game pins to the tile.
"""

import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kit as kitmod  # noqa: E402  (after sys.path is set)

from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
from mathutils import Vector  # noqa: E402

MODULE = sys.argv[1]
OUT = sys.argv[2]
PX_PER_TILE = int(sys.argv[3]) if len(sys.argv) > 3 else 64
# the frame is a fixed multiple of the tile so a whole asset fits with margin for its shadow
RENDER_PX = PX_PER_TILE * 4


def load_module(path):
    spec = importlib.util.spec_from_file_location("asset", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


k = kitmod.Kit()
load_module(MODULE).build(k)
k.light()
cam = k.camera(PX_PER_TILE, RENDER_PX)
k.render(OUT, RENDER_PX)

ndc = world_to_camera_view(k.scene, cam, Vector((0.0, 0.0, 0.0)))
anchor = {"ax": round(ndc.x * RENDER_PX, 2), "ay": round((1.0 - ndc.y) * RENDER_PX, 2)}
print("ANCHOR " + json.dumps(anchor))
