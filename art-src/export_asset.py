"""Export one asset program to a glTF binary, for the runtime 3D renderer (route 3).

    python3 art-src/export_asset.py <module.py> <out.glb>

Same kit, same programs as the sprite bake: this proves both renderers draw from one library.
Only the mesh objects are exported — no camera, no light — because the 3D scene supplies its own,
matching the kit's rig. glTF converts the kit's Z-up geometry to its Y-up convention on the way
out, so the three.js side is a standard Y-up scene.
"""

import importlib.util
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kit as kitmod  # noqa: E402

import bpy  # noqa: E402

MODULE = sys.argv[1]
OUT = sys.argv[2]


def load_module(path):
    spec = importlib.util.spec_from_file_location("asset", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


k = kitmod.Kit()
load_module(MODULE).build(k)
for o in bpy.data.objects:
    o.select_set(o.type == "MESH")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
)
print("EXPORT " + OUT)
