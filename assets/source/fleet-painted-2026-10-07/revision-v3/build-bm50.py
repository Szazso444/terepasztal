"""BM-50 rebuilt from v8 workbook row6 front/rear pictures, not previous mesh."""
import bpy,math,json,hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'models/bm50';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(name,h):
 rgb=[int(h[i:i+2],16)/255 for i in [0,2,4]];rgb=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
 m=bpy.data.materials.new(name);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*rgb,1);return m
red=mat('Vermilion red side plates','cc3920');rededge=mat('Red panel edges','e4512d');reddark=mat('Inset red','9a2c1c')
silver=mat('Silver-grey hood sides','a2aeb5');roof=mat('Silver top panels','bdc6cc');edge=mat('Silver rounded shoulders','adb9c1')
seam=mat('Dark metal panel seams','66747b');black=mat('Dark grille recess and holes','242b2e');rubber=mat('Seat cushions','343b3c')
yellow=mat('Yellow safety grilles','f3bf15');yellowedge=mat('Yellow upper edges','ffdb39');steel=mat('Axlebox metal','858f95');tread=mat('Dark steel treads','4c555b');lamp=mat('Headlamp lens','e6e8da')
def box(name,loc,size,m,bevel=.015):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if bevel:
  b=o.modifiers.new('Small manufactured edge','BEVEL');b.width=bevel;b.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o

def cyl(name,loc,r,d,m,axis='Z',verts=32):
 bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=d,location=loc);o=bpy.context.object;o.name=name
 if axis=='X':o.rotation_euler.y=math.pi/2
 if axis=='Y':o.rotation_euler.x=math.pi/2
 o.data.materials.append(m)
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 return o

def beam(name,a,b,r,m):
 delta=Vector(b)-Vector(a);o=cyl(name,(Vector(a)+Vector(b))*.5,r,delta.length,m);o.rotation_euler=delta.to_track_quat('Z','Y').to_euler();return o

# The tall red apron hides all but the three wheels' lower arcs.
box('Main lower frame',(0,0,.52),(4.75,1.56,.55),red,.045)
box('Black underframe spine',(0,0,.28),(4.55,.66,.30),black)
for side in [-1,1]:
 box('Tall red side apron',(0,side*.795,.66),(4.75,.10,.78),red,.022)
 box('Red apron top lip',(0,side*.851,1.045),(4.7,.032,.035),rededge,.008)
 for x in [-1.72,-.87,0,.87,1.73]:
  box('Lower panel vertical joint',(x,side*.853,.65),(.014,.010,.71),reddark,.002)
  for z in [.33,.99]:cyl('Panel bolt',(x,side*.864,z),.018,.012,steel,'Y',12)
 for x in [-1.17,.16,1.40]:
  box('Square axle service plate',(x,side*.86,.45),(.41,.028,.36),rededge,.015)
  cyl('Circular axlebox rim',(x,side*.882,.445),.145,.026,seam,'Y')
  cyl('Axlebox cover',(x,side*.902,.445),.119,.018,steel,'Y')
  cyl('Axlebox centre screw',(x+.042,side*.916,.41),.02,.014,seam,'Y',12)
 for x in [-1.55,-.54,.67,1.89]:
  box('Rectangular service opening',(x,side*.859,.46),(.17,.012,.14),black,.002)
  box('Opening upper edge',(x,side*.87,.535),(.18,.014,.022),reddark,.003)
 for x in [-1.51,-1.02,-.45,.07,.63,1.16,1.81]:
  cyl('Small round frame opening',(x,side*.859,.79),.034,.012,black,'Y',20)

# Bonnet cross-section: vertical sides and a broad curved shoulder; no tall box.
profile=[(-.79,1.055),(-.79,1.53),(-.755,1.68),(-.65,1.82),(-.47,1.89),(.47,1.89),(.65,1.82),(.755,1.68),(.79,1.53),(.79,1.055)]
verts=[]
for x in [-1.46,2.31]:
 for y,z in profile:verts.append((x-(.10*(z-1.05)/.84 if x>0 else 0),y,z))
n=len(profile);faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
mesh=bpy.data.meshes.new('Rounded bonnet mesh');mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('Wide low rounded bonnet',mesh);bpy.context.collection.objects.link(o)
for m in [silver,roof,edge]:mesh.materials.append(m)
for p in mesh.polygons:
 p.material_index=1 if p.center.z>1.86 else (2 if p.center.z>1.56 else 0)
 b=None
# Follow the cross-section with thin seam strips.
for x in [-.57,.48,1.48]:
 for i in range(n-1):
  y,z=profile[i];yy,zz=profile[i+1];beam('Bonnet panel seam',(x,y*1.004,z+.004),(x,yy*1.004,zz+.004),.006,seam)
 for side in [-1,1]:
  for z in [1.12,1.57,1.74]:cyl('Bonnet seam screw',(x,side*(.80 if z<1.57 else .714),z),.014,.013,steel,'Y',12)
for side in [-1,1]:
 for x in [-1.22,-.46,.35,1.12,1.90]:
  cyl('Porthole metal rim',(x,side*.798,1.29),.060,.018,seam,'Y')
  cyl('Black round porthole',(x,side*.809,1.29),.046,.016,black,'Y')
 for x in [-1.03,-.80,-.22,.02,.70,.94]:
  for z in [1.37,1.445,1.52,1.595]:
   box('Louvre dark opening',(x,side*.794,z),(.17,.016,.042),black,.004)
   blade=box('Louvre folded silver blade',(x,side*.809,z+.019),(.18,.038,.023),edge,.005);blade.rotation_euler.x=side*.16
 # Rivets along the long lower rim.
 for j in range(19):cyl('Lower bonnet screw',(-1.39+j*.19,side*.804,1.082),.012,.010,steel,'Y',10)
box('Rear roof inspection hatch',(-.98,0,1.914),(.63,.77,.035),seam,.035)
box('Hatch silver face',(-.98,0,1.938),(.60,.74,.025),roof,.03)
for x in [-1.20,-.76]:
 for y in [-.29,.29]:cyl('Hatch corner bolt',(x,y,1.96),.019,.015,steel)
for x in [.29,1.30]:
 cyl('Fuel cap seat',(x,0,1.919),.105,.022,seam);cyl('Fuel cap',(x,0,1.962),.092,.065,roof)
 beam('Cap handle',(x-.05,0,2.0),(x+.05,0,2.0),.009,seam)
# Front slatted radiator with rounded top, silver shell and yellow horizontals.
box('Front radiator dark opening',(2.292,0,1.40),(.022,.85,.64),black,.11)
for z,width in [(1.16,.80),(1.28,.81),(1.40,.79),(1.52,.72),(1.64,.58)]:box('Yellow radiator bar',(2.312,0,z),(.043,width,.045),yellow,.008)
box('Radiator centre divider',(2.337,0,1.41),(.036,.055,.62),silver,.01)
cyl('Lamp cylindrical shell',(2.165,0,1.873),.146,.23,seam,'X');cyl('Chrome lamp ring',(2.292,0,1.873),.14,.03,roof,'X');cyl('Pale headlamp lens',(2.312,0,1.873),.107,.014,lamp,'X')
# Open rear driving position. The reference has no glass cab or rear window.
box('Driver footwell',(-1.91,0,1.035),(.88,1.44,.065),reddark)
box('Seat support',(-2.0,0,1.14),(.40,.60,.22),black)
box('Seat cushion',(-1.99,0,1.29),(.49,.67,.17),rubber,.045)
box('Seat back cushion',(-2.205,0,1.48),(.14,.67,.49),rubber,.045)
for y in [-.23,0,.23]:box('Seat stitching',(-1.978,y,1.379),(.39,.008,.006),seam,.001)
for z in [1.36,1.57]:box('Back cushion stitching',(-2.124,0,z),(.006,.60,.008),seam,.001)
box('Rear red end panel',(-2.37,0,1.28),(.10,1.50,.53),red)
box('Rear silver top rail',(-2.375,0,1.65),(.12,1.56,.08),roof,.025)
for side in [-1,1]:
 box('Rear silver upright',(-2.365,side*.70,1.43),(.13,.115,.48),silver,.02)
 box('Driver side red short wall',(-1.98,side*.80,1.095),(.80,.10,.12),rededge)
beam('Gear lever',(-1.57,.41,1.07),(-1.65,.41,1.49),.017,steel);cyl('Lever knob',(-1.65,.41,1.51),.042,.075,black)
# Yellow buffers are slatted rectangular blocks at both ends, not hazard stripes.
for sign in [-1,1]:
 x=sign*2.50
 for y in [-.73,.73]:box('Yellow bumper vertical',(x,y,.55),(.20,.15,.75),yellow,.035)
 for z in [.23,.43,.67,.87]:box('Yellow bumper slat',(x,0,z),(.20,1.55,.11),yellow,.025)
 box('Yellow bumper top edge',(x,0,.94),(.21,1.56,.05),yellowedge,.015)
 for z in [.335,.55,.775]:
  box('Dark slot between yellow buffer bars',(x+sign*.112,0,z),(.015,1.23,.075),black,.012)
 for y in [-.75,.75]:
  cyl('Buffer bolt',(x+sign*.11,y,.67),.024,.018,steel,'X',12)
 box('Central coupling aperture',(x+sign*.105,0,.57),(.012,.30,.12),black,.004)
# Three driven wheelsets, mostly hidden by the high red apron.
axles=[-1.17,.16,1.40]
for x in axles:
 cyl('Axle',(x,0,.275),.05,1.25,tread,'Y')
 for side in [-1,1]:
  pivot=bpy.data.objects.new('Wheel pivot',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,side*.62,.275)
  parts=[cyl('Dark tyre',(x,side*.62,.275),.275,.12,tread,'Y'),cyl('Dark wheel disc',(x,side*.687,.275),.225,.020,black,'Y')]
  for i in range(5):
   a=i*math.tau/5;parts.append(cyl('Wheel rotation boss',(x+.155*math.sin(a),side*.702,.275+.155*math.cos(a)),.024,.012,steel,'Y',16))
  for o in parts:matrix=o.matrix_world.copy();o.parent=pivot;o.matrix_world=matrix
p=OUT/'body.blend';bpy.ops.wm.save_as_mainfile(filepath=str(p))
manifest={'schema':1,'id':'bm50','profile':str((ROOT.parents[3]/'tools/asset-pipeline/painted/profiles/bm50-reference-v3.json').resolve()),'parts':[{'name':'body','source':str(p),'source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'frame_prefix':'loco_bm50_body','length_tiles':.6996,'canvas':256,'wheel':{'mode':'pivots','prefix':'Wheel pivot','count':6,'radius':.275,'symmetry':5},'effects':{'lamps':[[2.32,0,1.873]]}}]}
(ROOT/'bm50.json').write_text(json.dumps(manifest,indent=2))
(OUT/'geometry.json').write_text(json.dumps({'reference':'locomotive-wheels-bogies-v8.xlsx: Locomotives row6 front AND rear','axle_x':axles,'wheel_radius':.275,'red_apron_z':[.27,1.05],'bonnet_z':[1.055,1.89],'bonnet_width':1.58,'open_driving_position':True,'source':'new geometry, not previous BM50 mesh'},indent=2))
