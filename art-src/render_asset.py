"""Render one asset program in an isolated Blender process, and report it on stdout.

    python3 art-src/render_asset.py <module.py> <out.png> [px_per_tile] [variant]

The module must define `build(kit, variant=0)`. This script owns the scene reset, the camera, the
light and the render, so the asset program only describes geometry. One asset per process is the
reset boundary: `bpy` imports once per process, and this keeps a crash in one asset from touching
the next.

Three lines come back, because the driver finishes the frame in the game's 2D medium and needs
what only Blender knows:

    ANCHOR    where the world origin projects, in render pixels before the packer trims — the
              point the game pins to the tile
    PALETTE   each material's shade ramp as sRGB, so the banding picks the palette's own shades
              rather than a second copy here that can drift out of step with the kit
    MATERIALS the material each index in the companion `id/<out>` pass stands for, so the snap
              reads a pixel's material instead of guessing it from the lit colour
    SHADOW    the module's ground-shadow radius in render pixels, 0 for none
"""

import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kit as kitmod  # noqa: E402  (after sys.path is set)

from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
from mathutils import Vector  # noqa: E402

if sys.argv[1] == "--palette":
    # the ramps alone, for a caller that bakes frames without rendering any (tools/bake-refs.mjs)
    print("PALETTE " + json.dumps({"ramps": kitmod.PAL, "outline": kitmod.OUTLINE}))
    raise SystemExit(0)

MODULE = sys.argv[1]
OUT = sys.argv[2]
PX_PER_TILE = int(sys.argv[3]) if len(sys.argv) > 3 else 64
VARIANT = int(sys.argv[4]) if len(sys.argv) > 4 else 0
# The packer globs every PNG beside the frames, so the material pass goes in its own directory
# rather than next to the frame it belongs to.
ID_OUT = str(Path(OUT).parent / "id" / Path(OUT).name)
# the frame is a fixed multiple of the tile so a whole asset fits with margin for its shadow
RENDER_PX = PX_PER_TILE * 4


def load_module(path):
    spec = importlib.util.spec_from_file_location("asset", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mod = load_module(MODULE)
k = kitmod.Kit()
mod.build(k, VARIANT)
# FIT is the asset's fit to the sprite it replaces: (footprint, height) multipliers about the
# ground origin, so proportions are tuned without editing the geometry that describes the subject.
FIT = getattr(mod, "FIT", (1.0, 1.0))
FIT = FIT(VARIANT) if callable(FIT) else FIT
k.fit(*FIT)
k.light()
cam = k.camera(PX_PER_TILE, RENDER_PX)
k.render(OUT, RENDER_PX)

ndc = world_to_camera_view(k.scene, cam, Vector((0.0, 0.0, 0.0)))
anchor = {"ax": round(ndc.x * RENDER_PX, 2), "ay": round((1.0 - ndc.y) * RENDER_PX, 2)}
print("ANCHOR " + json.dumps(anchor))

# the shade ramps as sRGB 0-255, so the banding picks the palette's own shades rather than
# multiplying one base colour and landing between them
print("PALETTE " + json.dumps({"ramps": kitmod.PAL, "outline": kitmod.OUTLINE}))

# the material pass, beside the beauty render; it destroys the materials, so it goes last
print("MATERIALS " + json.dumps(k.id_render(ID_OUT, RENDER_PX)))

# a ground shadow is part of the game's 2D medium, not of the lighting solve: the procedural
# generators draw a soft ellipse under each prop, so the driver composites the same one here.
# The module states its footprint in tiles; one tile is PX_PER_TILE across.
# stated in the program's own units, so the fit carries it with the footprint it belongs to
shadow = getattr(mod, "SHADOW_R", 0.0)
shadow = shadow(VARIANT) if callable(shadow) else shadow
print("SHADOW " + json.dumps({"r": round(shadow * FIT[0] * PX_PER_TILE, 2)}))
