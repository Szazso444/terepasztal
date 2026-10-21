"""Blender diagnostic: count and measure the objects of built models.

    python tools/asset-pipeline/blender_runner.py [--blender <exe>] \
        tools/asset-pipeline/handbuilt/model_report.py <report.json> <a.blend> [<b.blend> ...]

Writes {"<blend as given>": {"meshes", "pivots", "objects", "min", "max"}}: mesh objects, wheel
pivot empties, all objects, and the evaluated world bounding box of the meshes in model units.
The Blender checks compare a fresh build with the committed model through this report.
"""
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
out, blends = Path(args[0]), args[1:]
report = {}
for blend in blends:
    bpy.ops.wm.open_mainfile(filepath=str(Path(blend).resolve()))
    deps = bpy.context.evaluated_depsgraph_get()
    objects = list(bpy.context.scene.objects)
    meshes = [o for o in objects if o.type == 'MESH']
    points = [o.matrix_world @ Vector(c) for o in meshes for c in o.evaluated_get(deps).bound_box]
    report[blend] = {
        'meshes': len(meshes),
        'pivots': sum(o.type == 'EMPTY' and o.name.startswith('Wheel pivot') for o in objects),
        'objects': len(objects),
        'min': [min(p[i] for p in points) for i in range(3)] if points else None,
        'max': [max(p[i] for p in points) for i in range(3)] if points else None,
    }
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(f'Model report for {len(blends)} file(s): {out}')
