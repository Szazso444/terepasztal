"""Reference-built GMAM: two four-driver engine units and central boiler."""
import bpy, math, json, hashlib, random
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).parent/'handbuilt/gmam';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(name,col):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*col,1);return m
green=mat('Dark olive green paint',(.075,.13,.045));black=mat('Graphite',(.018,.021,.022));gold=mat('Cream lining',(.63,.57,.29));steel=mat('Steel',(.31,.32,.30));glass=mat('Painted blue glazing',(.022,.074,.09));bronze=mat('Copper pipes',(.34,.16,.055))
def box(name,loc,size,m,bevel=.035):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if bevel:b=o.modifiers.new('Soft edges','BEVEL');b.width=bevel;b.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o
def cyl(name,loc,r,d,m,axis='Z',vertices=48):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=d,location=loc);o=bpy.context.object;o.name=name
 if axis=='X':o.rotation_euler.y=math.pi/2
 if axis=='Y':o.rotation_euler.x=math.pi/2
 o.data.materials.append(m)
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 b=o.modifiers.new('Rim bevel','BEVEL');b.width=.015;b.segments=2
 return o
def rail(name,a,b,r,m):
 mid=(Vector(a)+Vector(b))*.5;o=cyl(name,mid,r,(Vector(b)-Vector(a)).length,m);o.rotation_euler=(Vector(b)-Vector(a)).to_track_quat('Z','Y').to_euler();return o
def linebox(name,x,z,l,h,y):
 for zz in [z-h/2,z+h/2]:box(name,(x,y,zz),(l,.018,.025),gold,.005)
 for xx in [x-l/2,x+l/2]:box(name,(xx,y,z),(.025,.018,h),gold,.005)
def save(name,length,wheel,effects):
 p=OUT/(name+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(p));d={'name':name,'source':str(p.resolve()),'source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'frame_prefix':'loco_gmam_'+name,'length_tiles':length,'canvas':512,'effects':effects}
 if wheel:d['wheel']={'mode':'timeline','start':1,'period_frames':8,'radius':.52,'symmetry':1};d['max_phase_bounds_drift']=2
 return d
box('Straight engine frame',(0,0,.97),(5.6,2.55,.23),black)
box('Coal bunker',(.77,0,2.05),(3.48,2.26,1.90),green,.08)
box('Coal inset',(.77,0,3.03),(3.18,2.03,.10),black)
rng=random.Random(47)
for i in range(70):
 x=.77+rng.uniform(-1.47,1.47);y=rng.uniform(-.88,.88);z=3.11+rng.uniform(-.015,.065)
 o=box('Coal',(x,y,z),(rng.uniform(.13,.24),rng.uniform(.12,.23),.11),black,.035);o.rotation_euler.z=rng.random()*math.tau
box('Cab',(-1.92,0,2.42),(1.52,2.24,2.65),green,.055)
box('Cab roof',(-1.92,0,3.82),(1.70,2.5,.16),black,.10)
for side in [-1,1]:
 y=side*1.139
 box('Side window',(-1.83,y,3.09),(.69,.028,.75),black)
 box('Window glass',(-1.83,y+side*.02,3.09),(.56,.02,.63),glass)
 linebox('Window lining',-1.83,3.09,.72,.78,y+side*.035)
 linebox('Cab lining',-1.92,2.39,1.32,2.29,y+side*.04)
 linebox('Bunker lining',.77,2.04,3.10,1.49,side*1.144)
 for xx in [-.34,.78,1.90]:
  box('Bunker panel seam',(xx,side*1.151,2.05),(.024,.018,1.34),black,.004)
 for xx in [-.59,-.18,.23,.64,1.05,1.46,1.87,2.24]:
  for zz in [1.35,2.72]:cyl('Bunker rivet',(xx,side*1.16,zz),.025,.025,steel,'Y',12)
 linebox('Cab lower door',-1.9,1.92,.94,1.00,side*1.16)
 rail('Cab handle',(-1.5,side*1.21,2.28),(-1.5,side*1.21,2.55),.024,bronze)
 for i in range(5):box('Cab vent',(-2.0,side*1.17,1.60+i*.085),(.46,.025,.035),black,.004)
 rail('Handrail',(-2.54,side*1.26,1.15),(-2.54,side*1.26,3.51),.025,bronze)
 box('Cab step',(-2.45,side*1.36,.72),(.4,.42,.12),black)
for x in [-2.69,-1.15]:
 for y in [-.52,.52]:
  box('End window',(x,y,3.12),(.025,.64,.70),black)
  box('End glass',(x+( -.017 if x< -2 else .017),y,3.12),(.02,.53,.60),glass)
box('Front buffer',(2.91,0,.87),(.21,2.75,.27),bronze)
for y in [-.85,.85]:cyl('Buffer',(3.10,y,.89),.17,.24,black,'X')
cyl('Headlight housing',(2.54,0,2.65),.23,.25,black,'X');cyl('Lamp glass',(2.68,0,2.65),.17,.025,gold,'X')
for y in [-1,-.75,-.5,-.25,0,.25,.5,.75,1]:rail('Pilot slat',(2.92,y,.69),(3.18,y,.20),.04,black)
axles=[-1.62,-.54,.54,1.62];pivots=[]
for x in axles:
 cyl('Axle',(x,0,.52),.065,2.05,steel,'Y')
 for side in [-1,1]:
  p=bpy.data.objects.new('Driver pivot',None);bpy.context.collection.objects.link(p);p.location=(x,side*1.02,.52);pivots.append(p)
  children=[cyl('Tyre',(x,side*1.02,.52),.52,.16,steel,'Y'),cyl('Wheel inset',(x,side*1.108,.52),.45,.015,black,'Y'),cyl('Hub',(x,side*1.135,.52),.12,.06,steel,'Y')]
  for i in range(12):
   a=i*math.tau/12;children.append(rail('Spoke',(x+.10*math.cos(a),side*1.124,.52+.10*math.sin(a)),(x+.44*math.cos(a),side*1.124,.52+.44*math.sin(a)),.025,steel))
  for o in children:matrix=o.matrix_world.copy();o.parent=p;o.matrix_world=matrix
for x in [-2.55,2.55]:
 for side in [-1,1]:
  cyl('Small plain tyre',(x,side*1.02,.29),.29,.14,steel,'Y');cyl('Small wheel',(x,side*1.098,.29),.23,.025,black,'Y')
rods=[]
for side in [-1,1]:
 rods.append(box('Coupling rod',(0,side*1.23,.52),(3.55,.09,.09),steel,.025))
 for x in axles:
  rods.append(cyl('Crank pin',(x,side*1.25,.52),.07,.10,bronze,'Y'))
for frame in range(1,10):
 a=(frame-1)*math.tau/8
 for p in pivots:p.rotation_euler.y=a;p.keyframe_insert(data_path='rotation_euler',frame=frame)
 for i,o in enumerate(rods):
  base_x=0 if i%5==0 else axles[i%5-1]
  o.location.x=base_x+.18*math.cos(a);o.location.z=.52-.18*math.sin(a);o.keyframe_insert(data_path='location',frame=frame)
bpy.context.scene.frame_set(1)
parts=[save('engine',.95,True,{'lamps':[[2.68,0,2.65]]})]
for o in list(bpy.context.scene.objects):bpy.data.objects.remove(o,do_unlink=True)
box('Boiler cradle',(0,0,1.14),(7.75,1.5,.25),black)
cyl('Boiler',(0,0,2.29),.91,7.30,green,'X')
for x in [-3.5,-2.1,-.7,.7,2.1,3.5]:cyl('Boiler band',(x,0,2.29),.926,.055,gold,'X')
for side in [-1,1]:
 rail('Boiler handrail',(-3.5,side*.91,2.66),(3.5,side*.91,2.66),.032,bronze)
 box('Cradle side beam',(0,side*.84,1.2),(7.7,.2,.37),black)
for side in [-1,1]:
 rail('Steam pipe',(-3.35,side*.83,1.84),(3.3,side*.83,1.84),.055,bronze)
 for x in [-2.85,-1.45,0,1.45,2.85]:
  rail('Handrail bracket',(x,side*.75,2.64),(x,side*.98,2.64),.03,steel)
 for x in [-1.8,1.15]:
  cyl('Valve wheel',(x,side*.94,1.84),.13,.045,gold,'Y',24)
  rail('Feed pipe',(x,side*.80,1.1),(x,side*.80,1.81),.047,bronze)
cyl('Smokebox',(2.85,0,2.29),.919,1.4,black,'X')
cyl('Steam dome',(-.3,0,3.22),.38,.70,green)
for x in [-2.5,1.65]:
 cyl('Valve pedestal',(x,0,3.22),.18,.28,black)
 cyl('Valve cap',(x,0,3.41),.25,.08,bronze)
cyl('Chimney',(2.72,0,3.52),.23,1.22,black);cyl('Chimney rim',(2.72,0,4.14),.29,.07,bronze)
cyl('Dark chimney opening',(2.72,0,4.182),.225,.014,black)
for x in [-2.3,1.65]:
 for y in [-.43,.43]:cyl('Underframe reservoir',(x,y,.75),.24,1.2,black,'X')
parts.append(save('cradle',1.25,False,{'smoke':[[2.72,0,4.19]]}))
manifest={'schema':1,'id':'gmam','profile':str((Path(__file__).parents[3]/'tools/asset-pipeline/painted/profiles/c50-approved-v1.json').resolve()),'parts':parts}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
(OUT/'geometry.json').write_text(json.dumps({'reference':'assets/source/base-v1/loco-gmam.png','parts':'mirrored engine units with central boiler','drivers_per_engine':4,'status':'reference-built candidate'},indent=2))
