"""Owner corrections in isolated reference models, preserving raw reconstructions."""
from pathlib import Path
import bpy,bmesh,json,math,hashlib,sys
from mathutils import Vector,Matrix
import numpy as np
R=Path(__file__).resolve().parent;REPO=R.parents[3];TILE=6.235064799811727
sys.path.insert(0,str(REPO/'tools/asset-pipeline/painted'))
from prepare_existing import principled
helper=(R.parent/'batch4-wheel-v3/rebuild-gear.py').read_text().split('for id in ids:')[0]
scope={'__file__':str(R/'gear-builder.py')};exec(helper,scope)
add_gear=scope['add_gear'];audit={}

def save(p,m):
 scene=bpy.context.scene;scene.frame_set(1);bpy.context.view_layer.update()
 pts=[o.matrix_world@v.co for o in scene.objects if o.type=='MESH' and not o.hide_render for v in o.data.vertices]
 p['length_tiles']=(max(v.x for v in pts)-min(v.x for v in pts))/TILE
 bpy.data.libraries.write(p['source'],{scene},fake_user=True,compress=True)
 p['source_sha256']=hashlib.sha256(Path(p['source']).read_bytes()).hexdigest()
 m['reference']['prepared_sources'][p['name']]=p['source_sha256']

def box(name,centre,size):
 bpy.ops.mesh.primitive_cube_add(size=1,location=centre);o=bpy.context.object;o.name=name
 o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 mat=bpy.data.materials.get('Bogie steel')
 if not mat:
  mat=bpy.data.materials.new('Bogie steel');mat.diffuse_color=(.13,.15,.15,1);mat.use_nodes=True
  mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.13,.15,.15,1)
 o.data.materials.append(mat)

for id in ['mav375','class08','sw1','drg01','m62']:
 P=R/'prepared'/id;mp=P/'candidate.json';m=json.loads(mp.read_text());cal=json.loads((P/'calibration.json').read_text());sp=R/'specs'/f'{id}.json';spec=json.loads(sp.read_text());audit[id]=[]
 if id=='mav375':
  g=spec['geometry']['gear'][0];g['rigid']=g['rigid'][1:];g['rigid_f']=g['rigid_f'][1:]
  w=g['wheels']['rigid'];w['d']=w['d'][1:];w['spokes']=w['spokes'][1:];w['drivers']=[0,1,2]
 if id=='drg01':
  for g in spec['geometry']['gear']:
   for w in ([g['wheels']['rigid']] if 'rigid' in g['wheels'] else [])+g['wheels'].get('trucks',[]):w['d']=w['d']*.75
  g=spec['geometry']['gear'][0];g['trucks'][1]=[v-.0583 for v in g['trucks'][1]];g['trucks_f'][1]=[g['from']+v*(g['to']-g['from']) for v in g['trucks'][1]]
 for p in m['parts']:
  bpy.ops.wm.open_mainfile(filepath=p['source']);scene=bpy.context.scene;scene.frame_set(1)
  if scene.get('detail_v4'):raise ValueError('Already corrected')
  truck='-t' in p['name'];bc=next(c for c in cal if c['part']==p['name'])
  bodyname=p['name'].split('-t')[0];idx=[a[0] for a in spec['geometry']['parts']].index(bodyname);g=spec['geometry']['gear'][idx]
  meshes=[o for o in scene.objects if o.type=='MESH' and not o.name.startswith(id+'_')]
  if not truck and id in ['class08','sw1','drg01'] and p['name']!='tender':
   pts=np.array([list(o.matrix_world@v.co) for o in meshes for v in o.data.vertices]);cross=[]
   a,b=(-1.4,2.5) if id=='class08' else (-2.5,3.5) if id=='drg01' else (.1,2.3)
   for x in np.linspace(a,b,24):
    band=pts[(abs(pts[:,0]-x)<.12)&(pts[:,2]>2)&(pts[:,2]<3.2)]
    if len(band)>10:cross.append((x,sum(np.percentile(band[:,1],[8,92]))/2))
   slope,intercept=np.polyfit(*np.array(cross).T,1)
   angle=-math.atan(slope);rot=Matrix.Rotation(angle,4,'Z')
   def transform(co):
    co=rot@co;co.y-=intercept
    if id=='sw1':co.y*=1.18
    return co
   for o in meshes:
    mat=o.matrix_world.copy();inv=mat.inverted()
    for v in o.data.vertices:v.co=inv@transform(mat@v.co)
    if id=='sw1':
     # Retain the photographed half with its UVs; mirror it around the chassis centre.
     bm=bmesh.new();bm.from_mesh(o.data)
     bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,0),plane_no=(0,1,0),clear_outer=True,clear_inner=False)
     bm.to_mesh(o.data);bm.free()
     mod=o.modifiers.new('Reference bilateral symmetry','MIRROR');mod.use_axis[0]=False;mod.use_axis[1]=True;mod.use_clip=True;mod.merge_threshold=.002
     bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
   for points in p.get('effects',{}).values():
    for i,point in enumerate(points):points[i]=list(transform(Vector(point)))
   if id=='sw1':
    for point in p.get('effects',{}).get('headlamps',[]):point[1]=0
   audit[id].append({'body':p['name'],'yaw_correction_deg':math.degrees(angle),'centre_shift_y_m':float(-intercept),'bilateral_symmetry':id=='sw1','body_width_factor':1.18 if id=='sw1' else 1})
  if id in ['mav375','drg01']:
   for o in list(scene.objects):
    if o.name.startswith(id+'_'):bpy.data.objects.remove(o,do_unlink=True)
   if truck:
    ti=int(p['name'].split('-t')[1]);ref=g['wheels']['trucks'][ti]
    xs=[a['x_m'] for a in bc['axles']]
    if id=='drg01' and p['name']=='engine-t1':bc['gear'][0]['centre_m']-=.70
    p['wheel']=add_gear(id+'_'+p['name'],xs,ref,outside=ref.get('frame')=='outside')
    for a in bc['axles']:a['d_m']=ref['d']
   elif g['rigid']:
    if id=='mav375':bc['axles']=bc['axles'][1:]
    xs=[a['x_m'] for a in bc['axles']];ref=g['wheels']['rigid']
    p['wheel']=add_gear(id+'_'+p['name'],xs,ref)
    for i,a in enumerate(bc['axles']):a['d_m']=ref['d'][i] if isinstance(ref['d'],list) else ref['d']
   audit[id].append({'part':p['name'],'axles':bc['axles'],'pivot':(bc.get('gear') or [{}])[0].get('centre_m')})
  if id=='m62' and truck:
   xs=[a['x_m'] for a in bc['axles']];x0=min(xs)-.34;x1=max(xs)+.34
   for x in [x0,x1]:box('Bogie end crossmember',(x,0,.68),(.18,1.72,.24))
   for y in [-.53,.53]:box('Bogie longitudinal frame',((x0+x1)/2,y,.84),(x1-x0,.15,.20))
   box('Bogie centre bolster',(0,0,.92),(.52,1.62,.20))
   for x in xs:box('Traction motor',(x,0,.48),(.46,.72,.36))
   audit[id].append({'part':p['name'],'full_bogie_frame':True,'end_crossmembers':[x0,x1]})
  scene['detail_v4']=True;save(p,m)
 m['reference']['guidelines']+='; Owner 2026-10-08: accurate lamp/window origins; MAV375 remove nonexistent rearmost axle; Class08/DRG01 align body axis; SW1 widen and symmetrize hood; DRG01 all wheel diameters -25%, leading bogie pivot 0.70m rearward; M62 complete bogie frames with both ends.'
 mp.write_text(json.dumps(m,indent=2)+'\n');(P/'calibration.json').write_text(json.dumps(cal,indent=2)+'\n');sp.write_text(json.dumps(spec,indent=2)+'\n')
(R/'correction-audit.json').write_text(json.dumps(audit,indent=2)+'\n');print('Five model corrections saved')
