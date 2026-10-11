"""DRG01 tender rebuilt from workbook row25, replacing failed raw rear reconstruction."""
import bpy,math,json,hashlib,random
from pathlib import Path
R=Path(__file__).resolve().parent;P=R/'prepared/drg01';M=json.loads((P/'candidate.json').read_text());cal=json.loads((P/'calibration.json').read_text())
def mat(name,c):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*c,1);return m
def box(name,loc,size,m):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);be=o.modifiers.new('Manufactured edges','BEVEL');be.width=.025;be.segments=2;o.modifiers.new('Normals','WEIGHTED_NORMAL');return o
def cyl(name,loc,r,d,m):
 bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=r,depth=d,location=loc,rotation=(math.pi/2,0,0));o=bpy.context.object;o.name=name;o.data.materials.append(m);return o
def finish(name,wheel=None):
 scene=bpy.context.scene;path=P/(name+'.blend');bpy.data.libraries.write(str(path),{scene},fake_user=True,compress=True)
 p=next(p for p in M['parts'] if p['name']==name);p['source_sha256']=hashlib.sha256(path.read_bytes()).hexdigest();p.pop('window_mask',None);p['effects']={};p['canvas']=256
 pts=[o.matrix_world@v.co for o in scene.objects if o.type=='MESH' for v in o.data.vertices];p['length_tiles']=(max(v.x for v in pts)-min(v.x for v in pts))/6.235064799811727
 if wheel:p['wheel']=wheel
 else:p.pop('wheel',None)
 M['reference']['prepared_sources'][name]=p['source_sha256']
bpy.ops.wm.read_factory_settings(use_empty=True)
black=mat('Tender black paint',(.019,.025,.028));edge=mat('Panel highlights',(.033,.041,.044));red=mat('Red chassis',(.38,.027,.016));coal=mat('Coal',(.009,.012,.014));steel=mat('Grey metal',(.09,.10,.11));gold=mat('Handrails',(.36,.28,.12))
box('Long red frame',(0,0,.86),(6.15,2.6,.23),red);box('Water tank',(0,0,1.66),(5.85,2.56,1.42),black)
box('Coal floor',(.1,0,2.42),(5.3,2.35,.15),black)
for y in [-1.27,1.27]:
 box('Coal bunker side',(0,y,2.66),(5.85,.12,.65),black)
 box('Top rim',(0,y,3.0),(5.9,.16,.09),edge)
 for x in [-2.7,-1.35,0,1.35,2.7]:box('Panel vertical seam',(x,y*1.012,1.80),(.04,.04,1.25),edge)
 for x in [-2.8,2.8]:
  box('End handrail',(x,y*1.04,1.78),(.055,.055,1.65),gold)
  for z in [.38,.65,.92]:box('Steps',(x,y*1.15,z),(.5,.35,.06),steel)
for x in [-2.9,2.9]:box('Bunker end',(x,0,2.64),(.12,2.55,.68),black)
random.seed(25)
for _ in range(125):
 x=random.uniform(-2.7,2.65);y=random.uniform(-1.12,1.12);z=2.53+.15*(1-abs(y))
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=random.uniform(.12,.24),location=(x,y,z));o=bpy.context.object;o.scale=(1.35,1,.7);o.data.materials.append(coal if _%3 else edge)
for x in [-3.16,3.16]:
 for y in [-.92,.92]:box('Buffer',(x,y,.95),(.22,.32,.30),black)
finish('tender')
# New two-axle bogies: clean frames, dark tread, red spokes. No old truck mesh fragments.
for ti,centre in [(0,-1.65),(1,1.65)]:
 bpy.ops.wm.read_factory_settings(use_empty=True);red=mat('Red running gear',(.38,.027,.016));tread=mat('Dark steel tread',(.045,.051,.058));steel=mat('Axlebox steel',(.08,.085,.09))
 for y in [-.42,.42]:box('Bogie sideframe',(0,y,.62),(2.1,.14,.22),red)
 for axle,x in enumerate([-.65,.65]):
  cyl('Axle',(x,0,.5),.10,1.0,steel)
  for side in [-1,1]:
   pivot=bpy.data.objects.new(f'Wheelpivot{axle}_{side}',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,side*.499,.5);bpy.context.view_layer.update()
   wheel=cyl('Dark tyre',(x,side*.499,.5),.5,.14,tread);wheel.parent=pivot;wheel.matrix_parent_inverse=pivot.matrix_world.inverted()
   hub=cyl('Red hub',(x,side*.585,.5),.13,.06,red);hub.parent=pivot;hub.matrix_parent_inverse=pivot.matrix_world.inverted()
   for k in range(9):
    ang=k*math.tau/9;sp=box('Red spoke',(x+math.sin(ang)*.27,side*.59,.5+math.cos(ang)*.27),(.055,.035,.42),red);sp.rotation_euler.y=ang;sp.parent=pivot;sp.matrix_parent_inverse=pivot.matrix_world.inverted()
 finish(f'tender-t{ti}',{'mode':'pivots','prefix':'Wheelpivot','count':4,'radius':.5,'symmetry':9})
 c=next(q for q in cal if q['part']==f'tender-t{ti}');c.update(axles=[{'x_m':-.65,'d_m':1},{'x_m':.65,'d_m':1}],gear=[{'truck':ti,'centre_m':centre,'model_off_m':0,'d_m':[1,1],'wheel_scale':1,'frame':'outside'}])
M['reference']['guidelines']+='; DRG01 tender freshly handbuilt from row25: rectangular black coal/water bunker, red frame, four axles. Original raw tender was distorted; no game mesh used.'
(P/'candidate.json').write_text(json.dumps(M,indent=2)+'\n');(P/'calibration.json').write_text(json.dumps(cal,indent=2)+'\n')
print('Reference tender rebuilt')
