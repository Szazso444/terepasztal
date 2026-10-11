import bpy,json,sys
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
R=Path(__file__).resolve().parent;result={}
for id in ['mav375','class08','sw1','drg01','m62']:
 m=json.loads((R/'prepared'/id/'candidate.json').read_text());result[id]=[]
 for p in m['parts']:
  bpy.ops.wm.open_mainfile(filepath=p['source']);bpy.context.scene.frame_set(1)
  meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and not o.hide_render]
  record={'part':p['name']}
  if '-t' not in p['name']:
   bodies=[o for o in meshes if not o.name.startswith(id+'_')];verts=[];faces=[]
   for o in bodies:
    offset=len(verts);verts.extend(o.matrix_world@v.co for v in o.data.vertices);faces.extend([offset+i for i in f.vertices] for f in o.data.polygons)
   bvh=BVHTree.FromPolygons(verts,faces)
   record['lamp_surface_distances_m']=[round(bvh.find_nearest(Vector(q))[3],4) for q in p.get('effects',{}).get('headlamps',[])]
   if id=='sw1':
    kd=KDTree(len(verts))
    for i,v in enumerate(verts):kd.insert(v,i)
    kd.balance();error=max(kd.find(Vector((v.x,-v.y,v.z)))[2] for v in verts)
    record['mirror_max_error_m']=error;assert error<.003
   if id in ['class08','drg01'] and p['name']!='tender':
    pts=np.array([list(v) for v in verts]);cross=[]
    a,b=(-1.4,2.5) if id=='class08' else (-2.5,3.5)
    for x in np.linspace(a,b,24):
     band=pts[(abs(pts[:,0]-x)<.12)&(pts[:,2]>2)&(pts[:,2]<3.2)]
     if len(band)>10:cross.append((x,sum(np.percentile(band[:,1],[8,92]))/2))
    slope,intercept=np.polyfit(*np.array(cross).T,1);record['residual_centreline_deg']=float(np.degrees(np.arctan(slope)));record['centre_y_m']=float(intercept)
  if id=='m62' and '-t' in p['name']:
   names=[o.name for o in meshes];record['crossmembers']=len([n for n in names if n.startswith('Bogie end crossmember')]);assert record['crossmembers']==2
  result[id].append(record)
(R/'geometry-qa.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
