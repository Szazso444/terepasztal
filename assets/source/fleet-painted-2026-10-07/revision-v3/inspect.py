import bpy,json
from pathlib import Path
r=Path('C:/Users/Zso/terepasztal-local/assets/source/fleet-painted-2026-10-07')
for id in ['rocket','general']:
 m=json.loads((r/'revision-v2'/f'{id}.json').read_text())
 for p in m['parts']:
  bpy.ops.wm.open_mainfile(filepath=p['source'])
  print('MODEL',id,p['name'])
  for o in bpy.context.scene.objects:
   if o.type=='MESH':print('OBJECT',o.name,'vertices',len(o.data.vertices),'animated',bool(o.animation_data),'props',dict(o.items()))
  for mat in bpy.data.materials:
   if mat.use_nodes:
    b=mat.node_tree.nodes.get('Principled BSDF')
    print('MATERIAL',mat.name,'rgb',list(b.inputs['Base Color'].default_value) if b else None)
