import bpy,json
from pathlib import Path
R=Path(__file__).resolve().parent
m=json.loads((R/'prepared/m62/candidate.json').read_text());bpy.ops.wm.open_mainfile(filepath=m['parts'][0]['source'])
for o in bpy.context.scene.objects:
 if o.type!='MESH':continue
 for slot in o.material_slots:
  for n in slot.material.node_tree.nodes:
   if n.type=='TEX_IMAGE' and n.image:
    n.image.save_render(str(R/'m62-colour-uv.png'));print(n.image.name,list(n.image.size));raise SystemExit(0)
