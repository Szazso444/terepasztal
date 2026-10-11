import bpy,json,hashlib
from pathlib import Path
r=Path(__file__).resolve().parent;old=r.parent/'revision-v2'
for id in ['rocket','general']:
 m=json.loads((old/f'{id}.json').read_text());out=r/'models'/id;out.mkdir(parents=True,exist_ok=True)
 for part in m['parts']:
  bpy.ops.wm.open_mainfile(filepath=part['source']);scene=bpy.context.scene;scene.frame_set(1)
  meshes=[o for o in scene.objects if o.type=='MESH']
  xs=[v.co.x for o in meshes if not o.hide_render for v in o.data.vertices];length=max(xs)-min(xs)
  if id=='general':
   changed=[]
   for mat in bpy.data.materials:
    if '_tyre' in mat.name:
     bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.055,.060,.065,1);changed.append(mat.name)
   assert changed,'No tyre materials found'
   print(id,part['name'],'dark-grey tyre materials',len(changed))
  else:
   axle_x=[1.1944444444444442,-1.1745370370370372]
   drop=(.61+.7175)*.1
   for o in meshes:
    if o.name.startswith('wheels_engine_'):
     for v in o.data.vertices:
      x=min(axle_x,key=lambda a:abs(v.co.x-a));v.co.x=x+(v.co.x-x)*.8;v.co.z*=.8
    else:
     for v in o.data.vertices:v.co.z-=drop
   part['wheel']['radius']*=.8
   for anchors in part.get('effects',{}).values():
    for point in anchors:point[2]-=drop
   xs=[v.co.x for o in meshes if not o.hide_render for v in o.data.vertices]
   part['length_tiles']*= (max(xs)-min(xs))/length
   print('rocket diameter factor 0.8; body lowered',drop,'without changing metres-to-pixels scale')
  p=out/(part['name']+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(p));part['source']=str(p);part['source_sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
 (r/f'{id}.json').write_text(json.dumps(m,indent=2))
