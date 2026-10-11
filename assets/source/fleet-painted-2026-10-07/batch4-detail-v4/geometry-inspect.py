import bpy,json,sys,math
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parent
out={}
for id in ['class08','sw1','drg01']:
 m=json.loads((R/'prepared'/id/'candidate.json').read_text());out[id]={}
 for p in m['parts']:
  if '-t' in p['name']:continue
  bpy.ops.wm.open_mainfile(filepath=p['source']);bpy.context.scene.frame_set(1)
  meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and not o.hide_render and '_w' not in o.name]
  pts=np.array([list(o.matrix_world@v.co) for o in meshes for v in o.data.vertices]);lo,hi=pts.min(0),pts.max(0)
  slices=[]
  for x in np.linspace(lo[0]+.15*(hi[0]-lo[0]),hi[0]-.15*(hi[0]-lo[0]),12):
   band=pts[(abs(pts[:,0]-x)<.12)&(pts[:,2]>lo[2]+.45*(hi[2]-lo[2]))]
   if len(band):slices.append([round(float(x),3),*[round(float(v),3) for v in np.percentile(band[:,1],[5,50,95])]])
  out[id][p['name']]={'bounds':[lo.tolist(),hi.tolist()],'meshes':[(o.name,len(o.data.vertices)) for o in meshes],'upper_cross_sections_x_y5_y50_y95':slices}
(R/'geometry-inspect.json').write_text(json.dumps(out,indent=2))
print(json.dumps(out))
