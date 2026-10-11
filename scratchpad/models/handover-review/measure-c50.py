import sys,json
from pathlib import Path
import bpy,numpy as np
sys.path.insert(0,r'C:\Users\Zso\terepasztal-local\tools\asset-pipeline')
import blender_stage as stage
root=Path(r'C:\Users\Zso\terepasztal-playtest\scratchpad\models\handover-review')
meta=json.loads((root/'painted-c50/raw/meta.json').read_text());M=np.array(meta['rigid_matrix'])
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=r'G:\DEV\Terepasztal\pipeline-out\models_raw\c50.glb')
o=next(o for o in bpy.context.scene.objects if o.type=='MESH');p=stage.mesh_arrays(o,9999999)[0];q=p@M[:3,:3].T+M[:3,3]
print('BOUNDS',q.min(0).tolist(),q.max(0).tolist())
for x in np.arange(-2.5,2.5,.25):
 a=q[(q[:,0]>=x)&(q[:,0]<x+.25)]
 if len(a):print('X',round(x,2),'height',round(float(np.percentile(a[:,2],99)),3),'width_by_z',[(z, np.round(np.percentile(a[(a[:,2]>z)&(a[:,2]<z+.15),1],[2,98]),3).tolist()) for z in [.3,.5,.7,.9,1.2,1.5,1.8,2.1] if sum((a[:,2]>z)&(a[:,2]<z+.15))>10])
