"""Handbuild MÁV 375 tank locomotive from its workbook picture, with C50 helpers."""
import bpy, math, json, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=OUTPUT; TILE=6.235064799811727
exec((PROJECT_ROOT/PROJECT['helpers']).read_text(encoding='utf-8'),globals())
ROOT.mkdir(parents=True,exist_ok=True)
# Frozen C50 palette/material construction; colours follow the workbook art.
body=mat('Reference charcoal locomotive paint',(.038,.043,.047))
edge=mat('Raised charcoal trim',(.052,.056,.059),.10,.42)
dark=mat('Deep graphite recesses',(.012,.015,.017),.05,.5)
steel=mat('Dark steel wheel treads',(.105,.12,.13),.28,.34)
framepaint=mat('Graphite running gear',(.045,.052,.056),.12,.42)
roofpaint=mat('Cab roof charcoal',(.022,.027,.032),.05,.5)
brass=mat('Muted warm brass',(.50,.31,.12),.22,.36)
bronze=mat('Dark bronze pipework',(.30,.20,.095),.24,.4)
gold=mat('Brass wheel pins',(.62,.40,.17),.25,.32)
glass=mat('Opaque smoky blue glass',(.018,.066,.092),.04,.4)
lightglass=mat('Pale warm lamp lenses',(.83,.76,.54),.05,.25)
interior=mat('Cab interior',(.018,.019,.018))
# Body proportions derive from the visible 9.4m nose-to-rear span and component ratios.
# Axes are straight/parallel; body rests on z=0. Boiler/roof rise to about 3.7m.
# Frame and running plate.
box('Straight running plate',(0,0,1.08),(8.65,2.55,.22),body,.035)
box('Running plate top',(0,0,1.205),(8.56,2.48,.045),edge,.012)
for s in [-1,1]:
 box('Longitudinal frame beam',(0,s*1.13,.88),(8.50,.18,.35),framepaint,.035)
 box('Continuous gold running plate pinstripe',(0,s*1.278,1.19),(8.48,.025,.035),brass,.006)
 # narrow side valance above wheels, interrupted lightly by steps
 box('Side valance',(0,s*1.12,.82),(7.95,.12,.20),body,.025)
# End buffer beams, buffers, drawgear and front footplate.
for end in [-1,1]:
 x=end*4.24
 box('Buffer beam',(x,0,.88),(.24,2.60,.62),body,.035)
 box('Buffer beam brass rule',(x+end*.126,0,1.18),(.018,2.38,.025),brass,.006)
 box('Drawgear mount',(x+end*.19,0,.65),(.34,.38,.26),framepaint,.035)
 rod('Coupler shank',(x+end*.20,0,.62),(x+end*.49,0,.62),.07,steel)
 box('Coupler head',(x+end*.51,0,.62),(.20,.36,.19),steel,.035)
 for s in [-1,1]:
  cyl('Buffer base',(x+end*.13,s*.98,.98),.18,.16,framepaint,'X')
  cyl('Buffer cap',(x+end*.23,s*.98,.98),.145,.08,steel,'X')
# Exactly three driving wheel stations (six side wheels), with no pilot or fourth axle.
axles=[-2.12,-.70,.72];R=.62
wheel_pivots=[]
for x in axles:
 cyl('Transverse driving axle',(x,0,R),.105,2.05,framepaint,'Y')
 box('Axle guard',(x,0,.90),(.40,1.75,.18),dark,.025)
 for s in [-1,1]:
  y=s*1.06
  pivot=bpy.data.objects.new('Driving wheel pivot',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,y,R);wheel_pivots.append(pivot)
  bpy.ops.mesh.primitive_torus_add(major_segments=64,minor_segments=12,major_radius=R*.92,minor_radius=.055,location=(x,y,R),rotation=(math.pi/2,0,0));finish(bpy.context.object,'Dark steel tyre ring',steel)
  bpy.ops.mesh.primitive_torus_add(major_segments=64,minor_segments=10,major_radius=R*.88,minor_radius=.028,location=(x,y+s*.09,R),rotation=(math.pi/2,0,0));finish(bpy.context.object,'Outer wheel rim',edge)
  pieces=[cyl('Axle boss',(x,y+s*.112,R),.145,.075,brass,'Y',40),
          cyl('Axle cap',(x,y+s*.157,R),.073,.028,steel,'Y',32)]
  # Ten tapered-looking dark spokes are represented as fine radial steel rods.
  for j in range(10):
   a=j*math.tau/10
   pieces.append(rod('Wheel spoke',(x+.13*math.sin(a),y+s*.115,R+.13*math.cos(a)),
                     (x+.455*math.sin(a),y+s*.115,R+.455*math.cos(a)),.026,edge))
  # visible crank pin placed eccentrically; rotates with the wheel.
  pieces.append(cyl('Brass crank pin',(x,y+s*.145,R+.34),.067,.045,gold,'Y',24))
  bpy.context.view_layer.update()
  for o in pieces:
   matrix=o.matrix_world.copy();o.parent=pivot;o.matrix_world=matrix
# Coupling rods animate with all three wheels. Equal crank radii and phase keep rods straight.
rod_objects=[]
for s in [-1,1]:
 y=s*1.33
 coupling=box('Continuous three-axle coupling rod',(sum(axles)/2,y,R+.34),(axles[-1]-axles[0],.075,.075),brass,.028)
 rod_objects.append(coupling)

# Timeline: a full wheel revolution in eight phase steps, with the side rods following the crank height.
scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=9
for phase in range(9):
 frame=1+phase;angle=math.tau*phase/8
 for pivot in wheel_pivots:
  pivot.rotation_euler.y=angle;pivot.keyframe_insert(data_path='rotation_euler',index=1,frame=frame)
 for ob in rod_objects:
  ob.location.z=R+.34*math.cos(angle)
  ob.keyframe_insert(data_path='location',index=2,frame=frame)
# Phases sample the eight explicitly authored poses at integer frame values.
# Cab is rearward, with a simple open side entrance and two oval side panes.
# Two sidewall panels leave a rectangular dark access opening; a far side oval remains visible.
CAB_X=-3.34;CAB_LEN=2.55;CAB_W=2.18;CAB_Z=2.52
for s in [-1,1]:
 y=s*1.075
 # Side wall lower/upper and front/rear posts frame a no-glass access opening.
 box('Cab side lower panel',(CAB_X,y,1.92),(CAB_LEN,.10,.66),body,.025)
 box('Cab side upper panel',(CAB_X,y,3.15),(CAB_LEN,.10,.42),body,.025)
 for x in [-4.58,-2.10]:box('Cab side end stile',(x,y,CAB_Z),(.13,.11,1.55),body,.018)
 # Two oval glazed side windows, with fine warm rims, vertically elongated.
 for x,z,rx,rz in [(-3.94,2.85,.20,.36),(-3.27,2.84,.17,.33)]:
  frame=cyl('Oval brass cab window rim',(x,y+s*.063,z),1,.055,brass,'Y',48);frame.scale=(rx,rz,1)
  pane=cyl('Opaque cab side glass',(x,y+s*.098,z),1,.025,glass,'Y',48);pane.scale=(rx*.82,rz*.84,1)
 # Rectangular open cab doorway, no glazing. Dark interior sits behind it.
 box('Cab dark doorway recess',(-2.83,y+s*.068,2.55),(.40,.035,.88),interior,.025)
 rod('Cab doorway forward grab rail',(-2.56,y+s*.12,2.08),(-2.56,y+s*.12,3.03),.025,brass)
 rod('Cab doorway rear grab rail',(-3.08,y+s*.12,2.08),(-3.08,y+s*.12,3.03),.025,brass)
 # Warm pinstripe follows the lower side panel.
 box('Cab lower brass line',(CAB_X,y+s*.065,1.58),(CAB_LEN,.025,.032),brass,.005)
# Cab front wall, at the +X side; one arched spectacle pane.
front_x=CAB_X+CAB_LEN/2
box('Cab front wall',(front_x,0,2.65),(.12,CAB_W,1.63),body,.035)
# One central arched spectacle window on the forward cab wall.
box('Cab front spectacle surround',(front_x+.075,0,3.02),(.055,.76,.78),brass,.14)
box('Cab front spectacle glass',(front_x+.11,0,3.02),(.035,.62,.66),glass,.12)
# Roof and open coal bunker at rear. Bunker is explicitly tied to visible silhouette.
box('Cab roof',(CAB_X,0,3.57),(CAB_LEN+.28,2.34,.16),roofpaint,.06)
for s in [-1,1]:box('Cab roof side pinstripe',(CAB_X,s*1.15,3.66),(CAB_LEN+.22,.025,.025),brass,.006)
for end in [-1,1]:box('Cab roof end pinstripe',(CAB_X+end*(CAB_LEN+.22)/2,0,3.66),(.025,2.30,.025),brass,.006)
# rear open bunker rim and restrained coal lumps, all visible in the workbook drawing.
box('Rear coal bunker floor',(-4.05,0,3.78),(.78,1.42,.12),framepaint,.025)
for s in [-1,1]:box('Coal bunker side wall',(-4.05,s*.70,3.91),(.84,.08,.34),body,.02)
for x,y,z,scale in [(-4.30,-.43,3.98,.18),(-4.05,-.12,4.01,.20),(-3.88,.20,4.00,.17),(-4.22,.45,4.03,.16),(-3.92,-.48,4.02,.14)]:
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=scale,location=(x,y,z));finish(bpy.context.object,'Visible coal lump',dark)
# Cylindrical boiler, with smooth rounded volume along X.
boiler_center=(.42,0,2.37);boiler_len=4.85;boiler_r=.78
cyl('Boiler barrel',(-.02,0,2.37),boiler_r,4.85,body,'X',64)
# raised bands ring the boiler at visible intervals.
for x in [-1.48,-.60,.34,1.28,2.04]:
 cyl('Boiler brass band',(x,0,2.37),boiler_r+.018,.055,brass,'X',64)
# Smokebox and circular nose closure.
cyl('Smokebox barrel',(2.47,0,2.38),.82,1.06,body,'X',64)
cyl('Smokebox front ring',(3.03,0,2.38),.835,.10,edge,'X',64)
cyl('Smokebox circular door',(3.09,0,2.38),.765,.06,body,'X',64)
cyl('Smokebox door raised rim',(3.13,0,2.38),.69,.03,brass,'X',64)
cyl('Smokebox door inset',(3.15,0,2.38),.62,.025,body,'X',64)
# Fine door fasteners, centered locking handle.
for j in range(12):
 a=j*math.tau/12;y=.63*math.sin(a);z=2.38+.63*math.cos(a)
 cyl('Smokebox door bolt',(3.17,y,z),.025,.025,brass,'X',16)
rod('Smokebox central latch',(3.19,-.16,2.38),(3.19,.16,2.38),.035,brass)
# Chimney on front barrel, tall and visibly open.
cyl('Chimney foot',(2.10,0,3.10),.24,.16,edge)
cyl('Tall chimney shaft',(2.10,0,3.42),.145,.58,body)
cyl('Chimney cap flare',(2.10,0,3.73),.23,.13,edge)
cyl('Dark open chimney mouth',(2.10,0,3.802),.16,.012,dark)
# Two domes, with restrained flanges and tops.
for name,x,z,r,h in [('Steam dome',-.14,3.12,.39,.74),('Sand dome',1.04,3.00,.27,.48)]:
 cyl(name+' flange',(x,0,z-.10),r*1.18,.08,brass)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=20,radius=1,location=(x,0,z))
 ob=bpy.context.object;ob.scale=(r,r,h/2);finish(ob,name,body)
 cyl(name+' crown',(x,0,z+h*.40),r*.20,.055,brass)
# Boiler piping and handrails, straight/parallel and mirrored only as image evidence supports.
for s in [-1,1]:
 y=s*.72
 rod('Long brass handrail',(-1.36,y,2.58),(2.45,y,2.58),.024,brass)
 for x in [-1.16,-.05,1.18,2.24]:rod('Handrail stanchion',(x,y,2.53),(x,y,2.77),.021,brass)
 # lower thin pipe follows boiler flank
 rod('Lower boiler pipe',(-1.28,s*.69,2.00),(2.45,s*.69,2.00),.025,bronze)
# Side cylinders at the nose over the forward wheel area, image shows two dark blocks.
for s in [-1,1]:
 box('Steam cylinder casing',(2.18,s*.78,1.38),(.88,.48,.70),framepaint,.12)
 box('Cylinder cap',(2.63,s*.78,1.38),(.10,.50,.56),edge,.08)
# Rear-side stepped footplate covers the partly hidden rear driving wheel sector.
for s in [-1,1]:
 box('Cab access step upper',(-3.25,s*1.32,1.26),(.70,.28,.10),framepaint,.025)
 box('Cab access step lower',(-3.30,s*1.36,.79),(.62,.26,.10),framepaint,.025)
 for x in [-3.55,-3.05]:rod('Step support',(x,s*1.25,.82),(x,s*1.25,1.38),.026,bronze)
# Front and buffer beam lamps. Coordinates are actual authored lens centres.
lamp_centres=[]
for y in [-.78,.78]:
 cyl('Front buffer lamp housing',(3.92,y,1.07),.17,.18,bronze,'X')
 cyl('Front buffer lamp rim',(4.02,y,1.07),.14,.045,brass,'X')
 cyl('Front buffer lamp lens',(4.05,y,1.07),.105,.025,lightglass,'X')
 lamp_centres.append([4.064,y,1.07])
# The picture shows one small lamp mounted high at the smokebox shoulder.
cyl('Smokebox shoulder lamp base',(3.02,-.67,3.00),.12,.12,bronze,'Y')
cyl('Smokebox shoulder lamp housing',(3.02,-.76,3.00),.12,.20,brass,'Y')
cyl('Smokebox shoulder lens',(3.02,-.875,3.00),.078,.022,lightglass,'Y')
lamp_centres.append([3.02,-.89,3.00])
# Keep all the authored primitives for reproducibility, then save one renderable body.
bpy.context.view_layer.update();scene=bpy.context.scene
meshes=[o for o in scene.objects if o.type=='MESH']
points=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
length=max(p.x for p in points)-min(p.x for p in points)
path=ROOT/'body.blend';bpy.data.libraries.write(str(path),{scene},fake_user=True,compress=True)
part={'name':'body','source':str(path),'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
      'frame_prefix':'loco_mav375_body','length_tiles':length/TILE,'canvas':512,'effects':{'lamps':lamp_centres},
      'window_materials':['Opaque cab side glass','Cab front spectacle glass'],
      'wheel':{'mode':'timeline','start':1,'period_frames':8,'radius':R,'symmetry':1},
      'animation_start':1,'max_phase_bounds_drift':5}
reference={'schema':1,'authority':'png-pictures-and-owner-notes','pictures':[dict(p,path=str(PROJECT_ROOT/p['path'])) for p in PROJECT['pictures']],
 'observations':{'path':str(PROJECT_ROOT/PROJECT['observations']),'sha256':hashlib.sha256((PROJECT_ROOT/PROJECT['observations']).read_bytes()).hexdigest()},
 'guidelines':'Only the locked workbook PNG supplies shape and colour. Three coupled axles, no leading/fourth axle. No imported game geometry or fit data.'}
reference['prepared_sources']={'body':part['source_sha256']}
(ROOT/'candidate.json').write_text(json.dumps({'schema':1,'id':'mav375','profile':str(PROJECT_ROOT/PROJECT['profile']),'parts':[part],'reference':reference},indent=2)+'\n')
cal=[{'part':'body','tiles':[part['length_tiles'],1],'gear':[],'axles':[{'x_m':x,'d_m':2*R} for x in axles]}]
(ROOT/'calibration.json').write_text(json.dumps(cal,indent=2)+'\n')
(ROOT/'validation.json').write_text(json.dumps({'shape_authority':'locked workbook picture PNG','three_axles':axles,'wheel_diameter_m':2*R,'wheel_pivots':len(wheel_pivots),'wheel_phase':'authored 8-step cyclic timeline with coupled side rods','longitudinal_axes_parallel':True,'lamp_lens_centres':lamp_centres,'window_materials':['Opaque cab side glass','Cab front spectacle glass'],'cast_shadow':False,'omitted_fourth_or_leading_axle':True},indent=2)+'\n')
print(json.dumps({'part_length_tiles':part['length_tiles'],'body_span_m':length,'axles':axles,'wheel_pivots':len(wheel_pivots),'lamps':lamp_centres}))







