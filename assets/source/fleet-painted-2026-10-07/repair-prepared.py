"""Targeted, repeatable geometry repairs on isolated prepared candidates."""
import bpy,json,hashlib,sys,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).parent
sys.path.insert(0,str(ROOT.parents[2]/'tools/asset-pipeline/painted'))
from prepare_existing import principled
import running_gear
import numpy as np
ids=sys.argv[sys.argv.index('--')+1:]
def box(name,xyz,size,color):
 m=bpy.data.materials.new(name+' paint');m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color,1)
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 b=o.modifiers.new('Soft manufactured edges','BEVEL');b.width=.035;b.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o
for id in ids:
 path=ROOT/'prepared'/id/'candidate.json';manifest=json.loads(path.read_text());changes=[]
 for part in manifest['parts']:
  source=Path(part['source']);bpy.ops.wm.open_mainfile(filepath=str(source));scene=bpy.context.scene
  if any(o.name.startswith('Fleet repair') for o in scene.objects):continue
  scene.frame_set(1);bpy.context.view_layer.update()
  points=[o.matrix_world@Vector(c) for o in scene.objects if o.type=='MESH' and not o.hide_render for c in o.bound_box]
  lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)];L=hi[0]-lo[0];W=hi[1]-lo[1]
  if part['name']=='body' and id=='deltic':
   box('Fleet repair fuel tank',(0,0,.64),(L*.29,W*.65,.78),(.025,.029,.025))
   for x in [-L*.09,L*.09]:box('Fuel tank strap',(x,0,.61),(.085,W*.68,.86),(.07,.075,.067))
   changes.append('Closed central underbody fuel tank and straps between the two three-axle bogies')
  if part['name']=='body' and id in ['kando_v40','gg1']:
   length=L*(.85 if id=='kando_v40' else .57)
   box('Fleet repair lower body',(0,0,1.25),(length,W*.83,.52),(.026,.063,.028))
   for side in [-1,1]:box('Lower sill lining',(0,side*W*.422,1.49),(length,.035,.04),(.50,.45,.21))
   changes.append('Closed missing lower body band above the running gear')
  if id=='dda40x' and part['name']=='body':
   h=max(1,hi[2]-1.3);z=1.3+h/2
   for i in range(7):box('Fleet repair bellows', (lo[0]-.20+i*.065,0,z),(.055,W*.78-(i%2)*.1,h-(i%2)*.08),(.017,.019,.022))
   changes.append('Accordion bellows at the body/rear hinge')
  if id=='ice1' and part['name']=='body':
   box('Fleet repair underfloor',(0,0,.77),(L*.42,W*.60,.46),(.033,.036,.036))
   changes.append('Filled the missing equipment section between bogies')
  if id=='mav375' and part['name']=='engine':
   for o in list(scene.objects):
    if o.name.startswith('wheels_engine'):bpy.data.objects.remove(o,do_unlink=True)
   xs=[-3.0,-1.85,-.35,1.15];ds=[.68,1.12,1.12,1.12]
   colors={k:np.array(v)/255 for k,v in {'tyre':[160,162,166],'wheel':[44,46,50],'hub':[70,72,76],'frame':[30,32,34],'detail':[46,49,49],'rod':[176,170,156]}.items()}
   for phase in range(8):
    spec={'scale':1,'x_scale':1,'turn':phase*math.tau/8,'axles':[{'x':x,'d_f':d,'spokes':10 if i==0 else 12,'driver':i>0,'turn':1} for i,(x,d) in enumerate(zip(xs,ds))],
          'rods':{'crank':.19,'crank_deg':-40}}
    obj=running_gear.bogie('Fleet repair wheels '+str(phase),spec,6.235064799811727,colors,{'light_world':(0,0,1),'ambient':1,'light':0})
    for slot in obj.material_slots:slot.material=principled(slot.material)
    for frame in range(1,10):obj.hide_render=(frame-1)%8!=phase;obj.keyframe_insert(data_path='hide_render',frame=frame)
   part['wheel']['radius']=.56
   changes.append('Three 1.12m drivers with non-overlapping spacing, linked rods and a .68m trailing wheel')
   (ROOT/'prepared'/id/'axle-repair.json').write_text(json.dumps({'x_m':xs,'diameters_m':ds},indent=2))
  if changes:
   scene.frame_set(1);bpy.context.view_layer.update();source=source.with_name(source.stem+'-repaired.blend')
   bpy.ops.wm.save_as_mainfile(filepath=str(source));part['source']=str(source.resolve());part['source_sha256']=hashlib.sha256(source.read_bytes()).hexdigest()
   points=[o.matrix_world@Vector(c) for o in scene.objects if o.type=='MESH' and not o.hide_render for c in o.bound_box]
   part['length_tiles']=(max(p.x for p in points)-min(p.x for p in points))/6.235064799811727
  if 'headlamps' in part.get('effects',{}):part['effects']['lamps']=part['effects'].pop('headlamps')
 manifest['repairs']=changes;path.write_text(json.dumps(manifest,indent=2));print(id,changes,flush=True)
