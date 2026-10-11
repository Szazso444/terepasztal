"""Build SW1 from workbook v9 art using the accepted C50 construction helpers.
No reconstructed mesh, projection texture, width warp or game calibration input.
"""
import bpy,math,json,hashlib,copy
from pathlib import Path
from mathutils import Vector
ROOT=OUTPUT;TILE=6.235064799811727
C50=PROJECT_ROOT/PROJECT['helpers']
helpers=C50.read_text()
ROOT.mkdir(parents=True,exist_ok=True)
def setup():
 exec(helpers,globals())
 globals()['body']=mat('Reference neutral charcoal paint',(.035,.040,.043))
 globals()['edge']=mat('Reference charcoal edges',(.048,.055,.060))
 globals()['glass']=mat('Opaque painted blue glass',(.040,.085,.095),.05,.4)
 globals()['glint']=mat('Opaque painted blue glass reflection',(.068,.135,.14),.05,.4)
 globals()['fanpaint']=mat('Reference dark fan metal',(.050,.058,.062),.12)
 globals()['cream']=mat('Warm cream lining',(.78,.64,.40))
 globals()['brass']=mat('Golden handrails',(.52,.32,.10),.18)
 globals()['tyre']=mat('Dark steel wheel tread',(.07,.085,.095),.18)
 globals()['framepaint']=mat('Reference cast bogie grey',(.095,.110,.115))
def saved(name):
 scene=bpy.context.scene;bpy.context.view_layer.update()
 deps=bpy.context.evaluated_depsgraph_get()
 pts=[o.matrix_world@Vector(c) for o in scene.objects if o.type=='MESH' for c in o.evaluated_get(deps).bound_box]
 length=max(v.x for v in pts)-min(v.x for v in pts)
 path=ROOT/f'{name}.blend';bpy.data.libraries.write(str(path),{scene},fake_user=True,compress=True)
 return {'name':name,'source':str(path),'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'frame_prefix':'loco_sw1_'+name,'length_tiles':length/TILE,'canvas':512 if name=='body' else 256,'effects':{}}
setup()
# Dimensions are explicit and constant along X. The cab is wider than the hood,
# as in the workbook illustration; neither component tapers towards either end.
deck=box('Straight full-width deck',(0,0,1.09),(8.6,2.50,.20),body,.03)
box('Non-slip walkway',(0,0,1.205),(8.52,2.44,.035),boltmat,.008)
for s in [-1,1]:
 box('Cream deck edge',(0,s*1.259,1.14),(8.55,.025,.045),cream,.003)
 box('Frame longitudinal beam',(0,s*1.11,.94),(8.5,.14,.22),dark)
# Wider and lower than v3: the side face must be exposed below the walkway
# from the game camera, not hidden behind the near longitudinal frame beam.
tank=box('Underbody fuel tank',(0,0,.39),(2.10,2.10,.74),framepaint,.18)
cab=box('Reference rear cab',(-3.12,0,2.53),(2.08,2.26,2.62),body,.065)
hood=box('Constant-width long hood',(1.04,0,2.22),(6.20,1.80,1.98),body,.17)
box('Continuous hood lid',(1.04,0,3.19),(6.20,1.80,.20),edge,.09)
for x in [-.83,.37,1.57,2.77]:box('Hood cover panel join',(x,0,3.298),(.014,1.55,.012),dark,.002)
for s in [-1,1]:
 box('Cream hood stripe',(1.04,s*.907,2.89),(6.18,.018,.075),cream,.004)
 for x in [-1.43,-.23,.97,2.17,3.37]:
  box('Access panel seam',(x,s*.914,2.06),(1.12,.025,1.37),dark,.018)
  box('Individual access panel',(x,s*.932,2.06),(1.06,.028,1.31),body,.018)
  for i in range(10):box('Pressed louvre',(x,s*.953,1.76+i*.058),(.62,.024,.021),edge,.004)
  rod('Panel latch',(x+.31,s*.98,2.30),(x+.31,s*.98,2.43),.015,boltmat)
  for z in [1.57,2.64]:box('Access panel hinge',(x-.48,s*.96,z),(.055,.045,.12),edge,.008)
 for x in [-1.82,-.5,.85,2.18,3.52]:
  rod('Walkway stanchion',(x,s*1.17,1.23),(x,s*1.17,2.18),.022,brass)
  cyl('Stanchion foot',(x,s*1.17,1.23),.055,.05,brass)
 rod('Straight handrail',(-1.82,s*1.17,2.18),(3.92,s*1.17,2.18),.024,brass)
 # Two side panes, independently framed and inset like the C50.
 for x,w in [(-3.78,.25),(-2.80,.78)]:
  box('Cab window rubber',(x,s*1.143,3.22),(w+.10,.04,.78),dark,.025)
  box('Cab window cream trim',(x,s*1.167,3.22),(w+.045,.02,.72),cream,.014)
  box('Cab opaque glass',(x,s*1.184,3.22),(w,.012,.66),glass,.012)
  reflection([(x-w*.42,s*1.193,3.48),(x-w*.42,s*1.193,2.98),(x-w*.05,s*1.193,3.38)])
  if w>.5:box('Sliding window mullion',(x,s*1.199,3.22),(.025,.017,.65),steel,.002)
 box('Cab side cream stripe',(-3.12,s*1.175,1.64),(2.04,.022,.10),cream,.004)
 box('Cab door seam',(-2.80,s*1.143,2.38),(.94,.02,2.20),edge,.014)
 rod('Cab door handle',(-2.42,s*1.21,2.30),(-2.42,s*1.21,2.47),.018,brass)
 # Window sits proud of the door seam: the door must not occlude its glazing.
for y in [-.78,-.26,.26,.78]:
 top=3.80+.18*(1-(y/1.12)**2);bottom=3.19;h=top-bottom
 box('Hood-facing window surround',(-2.065,y,(top+bottom)/2),(.032,.43,h),dark,.035)
 box('Hood-facing cab glass',(-2.044,y,(top+bottom)/2),(.013,.35,h-.08),glass,.03)
 reflection([(-2.035,y-.145,bottom+.09),(-2.035,y-.145,top-.07),(-2.035,y+.035,top-.16)])
# The sole picture does not show the rear wall: retain a plain closure, no guessed windows.
# Curved roof built from a constant cross section, as on the C50.
verts=[];n=24
for x in [-4.25,-1.99]:
 for i in range(n+1):
  y=-1.23+2.46*i/n;verts.append((x,y,3.84+.22*(1-(y/1.23)**2)))
faces=[(i,i+1,n+2+i,n+1+i) for i in range(n)]
mesh=bpy.data.meshes.new('Cab roof cross section');mesh.from_pydata(verts,[],faces);mesh.update()
roof=bpy.data.objects.new('Curved cab roof',mesh);bpy.context.collection.objects.link(roof);finish(roof,roof.name,edge)
mod=roof.modifiers.new('Roof thickness','SOLIDIFY');mod.thickness=.09
# Fill the arched cab gable beneath the roof, behind the taller front panes.
v=[]
for x in [-4.16,-2.08]:
 v.extend([(x,-1.13,3.72),(x,1.13,3.72)])
 for i in range(25):
  y=1.13-2.26*i/24;v.append((x,y,3.84+.22*(1-(y/1.23)**2)))
count=27;f=[tuple(range(count-1,-1,-1)),tuple(range(count,2*count))]
f.extend((i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count))
me=bpy.data.meshes.new('Arched cab gable');me.from_pydata(v,[],f);me.update();o=bpy.data.objects.new('Arched cab gable',me);bpy.context.collection.objects.link(o);finish(o,o.name,body)
box('Front radiator recess',(4.154,0,2.16),(.025,1.57,1.32),dark,.024)
for y in [-.8,.8]:box('Radiator outer frame',(4.179,y,2.16),(.055,.05,1.41),edge,.007)
for i in range(17):box('Vertical radiator grille',(4.190,-.72+i*.09,2.16),(.045,.025,1.27),boltmat,.003)
box('Nose cream stripe',(4.185,0,2.89),(.02,1.60,.075),cream,.003)
cyl('Front lamp housing',(4.16,0,3.09),.22,.17,dark,'X')
cyl('Front lamp silver rim',(4.255,0,3.09),.19,.035,steel,'X')
cyl('Front lamp lens',(4.28,0,3.09),.155,.016,lamp,'X')
for x in [1.35,2.50]:
 cyl('Roof fan housing',(x,0,3.34),.38,.15,fanpaint)
 cyl('Fan dark recess',(x,0,3.423),.31,.015,dark)
 for j in range(8):
  a=j*math.tau/8;rod('Fan spokes',(x,0,3.44),(x+.295*math.cos(a),.295*math.sin(a),3.44),.012,fanpaint)
 cyl('Fan hub',(x,0,3.445),.095,.035,fanpaint)
for i in range(12):box('Roof ventilation slot',(-.6+i*.075,0,3.302),(.030,.65,.018),dark,.002)
for y in [-.23,0,.23]:box('Roof grille crossbar',(-.1875,y,3.315),(.90,.018,.014),edge,.002)
cyl('Exhaust collar',(-1.20,0,3.35),.145,.09,boltmat)
cyl('Exhaust pipe',(-1.20,0,3.55),.105,.35,boltmat)
cyl('Exhaust cap',(-1.20,0,3.735),.14,.04,boltmat)
cyl('Cab heater pipe',(-3.62,-.35,4.17),.11,.25,boltmat)
cyl('Cab heater opening',(-3.62,-.35,4.303),.077,.014,dark)
cyl('Bell base',(-3.15,.28,4.04),.14,.06,brass)
profile=[(.19,4.075),(.17,4.095),(.125,4.14),(.087,4.22),(.075,4.31),(.05,4.35)]
verts=[(-3.15+r*math.cos(a*math.tau/48),.28+r*math.sin(a*math.tau/48),z) for r,z in profile for a in range(48)]
faces=[(i*48+j,i*48+(j+1)%48,(i+1)*48+(j+1)%48,(i+1)*48+j) for i in range(len(profile)-1) for j in range(48)]
me=bpy.data.meshes.new('Curved bell profile');me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new('Curved flared brass bell',me);bpy.context.collection.objects.link(o);finish(o,o.name,brass)
for p in me.polygons:p.use_smooth=True
cyl('Bell flared rim',(-3.15,.28,4.075),.19,.03,brass)
cyl('Bell crown',(-3.15,.28,4.37),.065,.04,brass)
rod('Horn pipe',(3.07,0,3.39),(3.38,0,3.39),.055,brass)
bpy.ops.mesh.primitive_cone_add(vertices=48,radius1=.055,radius2=.145,depth=.18,location=(3.43,0,3.39));o=bpy.context.object;o.rotation_euler[1]=math.pi/2;finish(o,'Flared brass horn',brass,.005)
cyl('Horn dark opening',(3.525,0,3.39),.111,.012,dark,'X')
for end in [-1,1]:
 x=end*4.30
 box('End pilot plate',(x,0,.79),(.14,2.34,.73),body,.025)
 box('Coupler shank',(x+end*.25,0,.70),(.45,.22,.18),bronze,.02)
 box('Coupler head',(x+end*.48,0,.70),(.17,.34,.26),bronze,.025)
 for s in [-1,1]:
  for z in [.22,.60,.98]:box('End access step',(x-end*.24,s*1.13,z),(.46,.24,.07),boltmat,.015)
  rod('End grab rail',(x+end*.02,s*1.08,1.20),(x+end*.02,s*1.08,2.12),.024,brass)
 if end==1:rod('End cross handrail',(x+end*.02,-1.08,2.12),(x+end*.02,1.08,2.12),.024,brass)
 # Diagonal safety stripes are explicit planar geometry, not projected pixels.
 for s in [-1,1]:
  for z in ([.90,1.28] if end==1 else []):
   points=[(x+end*.073,s*.13,z),(x+end*.073,s*1.05,z-.68),(x+end*.073,s*1.05,z-.85),(x+end*.073,s*.13,z-.17)]
   # Clip the painted polygon to the flat face of the pilot plate.
   for bound,above in [(.45,True),(1.13,False)]:
    clipped=[]
    for a,b in zip(points,points[1:]+points[:1]):
     ia=a[2]>=bound if above else a[2]<=bound
     ib=b[2]>=bound if above else b[2]<=bound
     if ia:clipped.append(a)
     if ia!=ib:
      t=(bound-a[2])/(b[2]-a[2]);clipped.append(tuple(a[k]+t*(b[k]-a[k]) for k in range(3)))
    points=clipped
   if len(points)<3:continue
   me=bpy.data.meshes.new('Chevron');me.from_pydata(points,[],[tuple(range(len(points)))]);ob=bpy.data.objects.new('Pilot cream chevron',me);bpy.context.collection.objects.link(ob);finish(ob,ob.name,cream)
assert abs(hood.dimensions.y-1.8)<1e-5 and hood.rotation_euler.z==0
# The reference exposes substantial cast sideframes beneath the running board.
# Lift the sprung body 0.18m; end pilots/couplers/steps retain their ground heights.
for o in bpy.context.scene.objects:
 if o.type=='MESH' and not o.name.startswith(('End pilot plate','Coupler','End access step','Pilot cream chevron')):o.location.z+=.18
bpy.context.view_layer.update()
assert len([o for o in bpy.context.scene.objects if o.name.startswith('Hood-facing cab glass')])==4
assert tank.dimensions.y>=2.0 and tank.location.z-tank.dimensions.z/2<.25
parts=[saved('body')];parts[0]['effects']={'lamps':[[4.29,0,3.27]],'smoke':[[-1.2,0,3.94]]};parts[0]['window_materials']=['Opaque painted blue glass']
body_length=parts[0]['length_tiles'];cal=[{'part':'body','tiles':[body_length,1],'gear':[],'axles':[]}]
for ti,centre in enumerate([-2.68,2.58]):
 setup();G=(.08 if PROJECT['gauge']=='narrow' else .12)*TILE;radius=.48
 for y in [-1.10,1.10]:
  plate=box('Rounded cast sideframe',(0,y,.68),(2.72,.22,.68),framepaint,.14)
  bpy.context.view_layer.objects.active=plate
  for modifier in list(plate.modifiers):bpy.ops.object.modifier_apply(modifier=modifier.name)
  for x in [-.39,.39]:
   cutter=box('Temporary oval core',(x,y,.68),(.57,.70,.31),dark,.14)
   bpy.context.view_layer.objects.active=cutter
   for modifier in list(cutter.modifiers):bpy.ops.object.modifier_apply(modifier=modifier.name)
   bpy.context.view_layer.objects.active=plate;mod=plate.modifiers.new('Cast oval opening','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
   for z in [.79,.835]:box('Visible spring leaves',(x,y-.04 if y<0 else y+.04,z),(.44,.16,.025),boltmat,.01)
  for x in [-.90,.90]:
   box('Cast axlebox',(x,y,.53),(.43,.30,.43),framepaint,.085)
   cyl('Axlebox bearing cap',(x,y+(.16 if y>0 else -.16),.53),.14,.045,boltmat,'Y')
 for x in [-1.22,1.22]:box('Bogie end crossmember',(x,0,.76),(.18,2.15,.24),framepaint,.03)
 box('Centre bolster',(0,0,.95),(.54,2.12,.18),boltmat)
 for x in [-.90,.90]:
  cyl('Axle',(x,0,radius),.09,2.16,boltmat,'Y')
  box('Traction motor',(x,0,.53),(.48,.72,.35),dark,.05)
  for s in [-1,1]:
   y=s*G;pivot=bpy.data.objects.new('Wheel pivot',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,y,radius)
   pieces=[cyl('Dark wheel tyre',(x,y,radius),radius,.15,tyre,'Y',64),cyl('Wheel graphite disc',(x,y+s*.086,radius),.40,.025,framepaint,'Y',64),cyl('Wheel hub',(x,y+s*.108,radius),.13,.035,boltmat,'Y')]
   for j in range(5):
    a=j*math.tau/5;pieces.append(cyl('Wheel recess',(x+.27*math.sin(a),y+s*.103,radius+.27*math.cos(a)),.043,.008,dark,'Y',16))
   bpy.context.view_layer.update()
   for o in pieces:world=o.matrix_world.copy();o.parent=pivot;o.matrix_world=world
 p=saved(f'body-t{ti}');p['wheel']={'mode':'pivots','prefix':'Wheel pivot','count':4,'radius':radius,'symmetry':5};p['max_phase_bounds_drift']=1;parts.append(p)
 cal.append({'part':p['name'],'tiles':None,'gear':[{'truck':ti,'centre_m':centre,'model_off_m':0}],'axles':[{'x_m':x,'d_m':radius*2} for x in [-.90,.90]]})
reference={'schema':1,'authority':'png-pictures-and-owner-notes','pictures':[dict(p,path=str(PROJECT_ROOT/p['path'])) for p in PROJECT['pictures']], 'observations':{'path':str(PROJECT_ROOT/PROJECT['observations']),'sha256':hashlib.sha256((PROJECT_ROOT/PROJECT['observations']).read_bytes()).hexdigest()},'guidelines':'Use only the locked reference PNG. Visible features and omitted unsupported details are recorded in observations.json. C50 construction method; no game model input.'}
reference['prepared_sources']={p['name']:p['source_sha256'] for p in parts}
m={'schema':1,'id':PROJECT['id'],'profile':str(PROJECT_ROOT/PROJECT['profile']),'parts':parts,'reference':reference}
(ROOT/'candidate.json').write_text(json.dumps(m,indent=2)+'\n');(ROOT/'calibration.json').write_text(json.dumps(cal,indent=2)+'\n')
(ROOT/'validation.json').write_text(json.dumps({'method':'Same construction helpers and render profile as accepted C50','helper_source':str(C50),'helper_sha256':hashlib.sha256(C50.read_bytes()).hexdigest(),'hood_front_width':1.8,'hood_rear_width':1.8,'cab_width':2.26,'deck_width':2.5,'axes_parallel':True,'gauge_half_m':.12*TILE,'source_geometry':'Authored from workbook picture; no imported meshes'},indent=2)+'\n')
print('Handbuilt SW1 body and two complete articulated bogies saved')
