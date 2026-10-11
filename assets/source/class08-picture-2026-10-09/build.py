"""Fresh, picture-authored BR Class 08 shunter, in the frozen C50 method."""
import bpy, math, json, hashlib
from pathlib import Path
from mathutils import Vector

ROOT=OUTPUT
TILE=6.235064799811727
ROOT.mkdir(parents=True,exist_ok=True)
exec((PROJECT_ROOT/PROJECT['helpers']).read_text(),globals())

body=mat('Class 08 dark green paint',(.055,.155,.085))
bodylight=mat('Raised green edges',(.075,.19,.105))
edge=mat('Deep green seams',(.025,.075,.045))
dark=mat('Radiator and recesses',(.012,.021,.019))
glass=mat('Opaque blue grey cab glazing',(.055,.12,.14),.04,.38)
cream=mat('Warm cream piping and window trim',(.78,.66,.43),.10,.40)
roofmat=mat('Cab roof slate grey',(.105,.125,.12),.12,.48)
steel=mat('Wheel tyre and machined rims',(.38,.40,.37),.24,.43)
wheel_dark=mat('Dark wheel discs and spokes',(.045,.055,.052),.10,.48)
bronze=mat('Brown buffer beam and crank pins',(.39,.13,.055),.16,.48)
boltmat=mat('Dark iron fittings',(.12,.14,.13),.30,.48)
lamp=mat('Warm lamp glass',(.92,.71,.35),.04,.32)

# The locomotive points down +X. Longitudinal shell, deck and rail edges are
# built on zero-yaw axes so their edges stay parallel to the rails.
deck=box('Straight full length running plate',(0,0,.96),(7.35,2.12,.20),body,.035)
box('Dark underframe sill',(0,0,.79),(7.25,1.70,.22),dark,.025)
for side in [-1,1]:
    box('Continuous side frame',(.0,side*.79,.77),(7.25,.18,.28),bodylight,.045)
    box('Cream hood side piping',(.72,side*.846,2.38),(4.40,.025,.055),cream,.008)

# Hood is one long constant-width block with rounded shoulders and a separate
# straight roof plate. Panel divisions and vents follow the pictured side.
# Six-sided cross section gives the hood the chamfered shoulders in the picture;
# the profile extrudes unchanged along X so the roof edge stays rail-parallel.
x0,x1=-1.655,3.295
profile=[(-.88,1.09),(.88,1.09),(.88,2.53),(.72,2.84),(-.72,2.84),(-.88,2.53)]
verts=[(x,y,z) for x in [x0,x1] for y,z in profile]
faces=[tuple(range(6)),tuple(range(6,12))]
for i in range(6):faces.append((i,(i+1)%6,(i+1)%6+6,i+6))
me=bpy.data.meshes.new('Chamfered hood cross-section');me.from_pydata(verts,[],faces);me.update()
hood=bpy.data.objects.new('Long chamfer-shouldered engine hood',me);bpy.context.collection.objects.link(hood);finish(hood,hood.name,body,.035)
for side in [-1,1]:
    for x,w in [(-.88,.72),(.12,.78),(1.08,.78),(2.04,.74)]:
        box('Panel shadow seam',(x,side*.889,1.94),(w+.04,.025,1.38),edge,.035)
        box('Individual green access panel',(x,side*.907,1.94),(w, .025,1.33),body,.03)
        # Short handles sit below the cream side piping.
        box('Small cream panel latch',(x+w*.34,side*.93,2.10),(.045,.026,.20),cream,.012)
    for x in [-.88,2.04]:
        box('Large full-panel louvre recess',(x,side*.93,1.96),(.65,.026,1.02),dark,.025)
        for i in range(10):
            box('Horizontal pressed louvre',(x,side*.951,1.50+i*.10),(.59,.025,.038),bodylight,.012)
    # End-corner ladders descend below the deck instead of floating halfway up
    # the hood side; each has three short treads and a long outer grab rail.
    for x in [-3.34,3.23]:
        for z in [.20,.49,.78]:
            box('Low end-corner step tread',(x,side*1.03,z),(.36,.28,.07),roofmat,.018)
        rod('End-corner ladder grab rail',(x,side*1.18,.20),(x,side*1.18,1.14),.026,cream)

# Tall rear cab: flat side walls, separate picture-framed opaque panes and a
# gently crowned roof. No unpictured rear interior is asserted.
cab=box('Rear cab shell',(-2.57,0,2.11),(2.05,2.02,2.36),body,.075)
for side in [-1,1]:
    y=side*1.025
    box('Cab side door seam',(-2.55,y,1.96),(.66,.025,1.65),edge,.025)
    for x,w in [(-3.22,.30),(-2.53,.66),(-1.98,.27)]:
        z=2.76 if w>.5 else 2.75
        box('Cab window dark gasket',(x,y+side*.025,z),(w+.09,.035,.78),edge,.035)
        box('Cream window surround',(x,y+side*.048,z),(w+.04,.018,.72),cream,.022)
        box('Opaque cab glass',(x,y+side*.061,z),(w,.014,.67),glass,.018)
    box('Cab lower side stripe',(-2.57,y+side*.03,1.18),(1.86,.025,.07),bodylight,.008)
    rod('Cab door handle',(-2.28,y+side*.075,1.91),(-2.15,y+side*.075,1.91),.017,cream)

# Curved cross-section sheet roof: its long edges remain parallel to X.
verts=[]; n=24
for x in [-3.64,-1.50]:
    for layer in [0,1]:
        for i in range(n+1):
            y=-1.12+2.24*i/n
            z=3.29 if layer==0 else 3.39+.20*(1-(y/1.12)**2)
            verts.append((x,y,z))
faces=[]
for layer in [0,1]:
    off=layer*(n+1)
    for i in range(n):faces.append((off+i,off+i+1,2*(n+1)+off+i+1,2*(n+1)+off+i))
for end in [0,1]:
    off=end*2*(n+1)
    for i in range(n):faces.append((off+i,off+i+1,off+n+2+i,off+n+1+i))
for i in [0,n]:faces.append((i,n+1+i,3*(n+1)+i,2*(n+1)+i))
me=bpy.data.meshes.new('Class 08 cab roof section');me.from_pydata(verts,[],faces);me.update()
roof=bpy.data.objects.new('Slate grey curved cab roof',me);bpy.context.collection.objects.link(roof);finish(roof,roof.name,roofmat)
for poly in roof.data.polygons:poly.use_smooth=False
box('Cab roof hatch',(-2.58,0,3.53),(.54,.46,.10),roofmat,.045)

# Three panes on the rear cab end, present in the paired reverse-end picture.
for y,w in [(-.63,.33),(0,.58),(.63,.33)]:
    box('Rear cab end gasket',(-3.603,y,2.72),(.035,w+.09,.66),edge,.03)
    box('Rear cab end cream frame',(-3.626,y,2.72),(.018,w+.04,.61),cream,.018)
    box('Rear cab end opaque glass',(-3.64,y,2.72),(.014,w,.55),glass,.015)
cyl('Rear cab lamp housing',(-3.63,0,3.20),.080,.10,edge,'X')
cyl('Rear cab lamp cream rim',(-3.70,0,3.20),.061,.035,cream,'X')
cyl('Rear cab lamp lens',(-3.724,0,3.20),.043,.018,lamp,'X')

# Three low roof covers and one short orange exhaust are visible on the hood.
for x in [-.58,.63,1.82]:
    box('Flat rectangular hood roof cover',(x,0,2.90),(.68,.72,.11),bodylight,.04)
cyl('Exhaust stack foot',(-.46,-.22,2.89),.20,.10,boltmat)
cyl('Short orange exhaust stack',(-.46,-.22,3.12),.125,.33,bronze)
cyl('Exhaust dark mouth',(-.46,-.22,3.292),.080,.012,dark)

# Nose radiator and trim, at the +X end. Lamp coordinates below are the actual
# centres of the authored lens geometry, not inferred generic front offsets.
box('Front radiator dark inset',(3.335,0,1.96),(.045,1.05,1.42),dark,.035)
for y in [-.57,.57]:box('Radiator vertical border',(3.37,y,1.96),(.065,.055,1.50),bodylight,.012)
for i in range(13):
    box('Radiator horizontal slat',(3.38,0,1.34+i*.103),(.055,.96,.045),boltmat,.012)
box('Nose cream upper edge',(3.37,0,2.78),(.055,1.12,.065),cream,.012)
# Three front lamps match the large upper lamp and two small low lamps.
for y,z,r in [(0,2.96,.13),(-.62,1.27,.08),(.62,1.27,.08)]:
    cyl('Front lamp housing',(3.37,y,z),r+.055,.12,edge,'X')
    cyl('Front lamp cream rim',(3.445,y,z),r+.035,.035,cream,'X')
    cyl('Front lamp lens',(3.469,y,z),r,.018,lamp,'X')
for side in [-1,1]:
    rod('Nose corner grab rail',(3.28,side*.89,1.04),(3.28,side*.89,2.65),.026,cream)
    rod('Nose upper grab rail',(3.28,side*.89,2.65),(3.02,side*.89,2.76),.026,cream)

# Brown buffer beams, round buffers and hanging couplers on both ends.
for end in [-1,1]:
    x=end*3.84
    box('Brown end buffer beam',(x,0,.86),(.20,2.12,.48),bronze,.035)
    for side in [-1,1]:
        cyl('Round buffer body',(x+end*.10,side*.78,.98),.205,.22,bronze,'X')
        cyl('Dark buffer face',(x+end*.22,side*.78,.98),.165,.045,boltmat,'X')
    box('Coupler mount',(x+end*.19,0,.77),(.34,.34,.22),boltmat,.025)
    rod('Hanging coupler shank',(x+end*.25,0,.77),(x+end*.33,0,.47),.065,boltmat)
    torus=bpy.ops.mesh.primitive_torus_add(major_radius=.13,minor_radius=.035,major_segments=24,minor_segments=8,location=(x+end*.34,0,.37),rotation=(math.pi/2,0,0))
    finish(bpy.context.object,'Hanging coupler loop',boltmat)

# Full 0-6-0 coupled running gear. The pivots, tyres, rims, spokes and crankpins
# are all authored geometry; wheel hubs lie at +/- the standard rail half-gauge.
wheel_x=[-1.30,-.13,1.04]
wheel_z=.57
wheel_r=.57
half_gauge=.12*TILE
pivots=[]
for side in [-1,1]:
    y=side*half_gauge
    box('Continuous inner frame plate',(-.13,side*.62,.75),(3.64,.22,.36),dark,.055)
    for x in wheel_x:
        pivot=bpy.data.objects.new('Class 08 wheel pivot',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,y,wheel_z);pivots.append(pivot)
        pieces=[]
        pieces.append(cyl('Wheel dark tyre',(x,y,wheel_z),wheel_r,.15,steel,'Y',64))
        pieces.append(cyl('Wheel pale outer rim',(x,y+side*.082,wheel_z),wheel_r*.88,.025,cream,'Y',64))
        pieces.append(cyl('Dark wheel centre',(x,y+side*.101,wheel_z),wheel_r*.77,.030,wheel_dark,'Y',64))
        for i in range(8):
            a=i*math.tau/8
            pieces.append(rod('Spoked driving wheel',(x+wheel_r*.12*math.sin(a),y+side*.122,wheel_z+wheel_r*.12*math.cos(a)),(x+wheel_r*.72*math.sin(a),y+side*.122,wheel_z+wheel_r*.72*math.cos(a)),.045,steel))
        # Offset crank pin rotates with the wheel and carries the side rod.
        pieces.append(cyl('Warm crank pin',(x+wheel_r*.29,y+side*.155,wheel_z),.105,.075,bronze,'Y'))
        pieces.append(cyl('Wheel axle cap',(x,y+side*.17,wheel_z),.10,.05,bodylight,'Y'))
        for obj in pieces:
            world=obj.matrix_world.copy();obj.parent=pivot;obj.matrix_world=world

# Each connecting bar is carried by a translating empty. All three cranks share
# a picture-consistent phase, so the bar remains straight while its ends orbit.
rod_carriers=[]
for side in [-1,1]:
    y=side*(half_gauge+.17)
    carrier=bpy.data.objects.new('Coupling rod orbit carrier',None);bpy.context.collection.objects.link(carrier)
    carrier.location=(wheel_x[0]+wheel_r*.29,y,wheel_z);rod_carriers.append(carrier)
    bar=box('Warm three axle coupling rod',((wheel_x[0]+wheel_x[-1])*.5+wheel_r*.29,y,wheel_z),(wheel_x[-1]-wheel_x[0]+.18,.085,.10),bronze,.035)
    bosses=[]
    for x in [wheel_x[0],wheel_x[-1]]:
        bosses.append(cyl('Coupling rod end boss',(x+wheel_r*.29,y,wheel_z),.12,.095,bronze,'Y'))
    for obj in [bar,*bosses]:
        world=obj.matrix_world.copy();obj.parent=carrier;obj.matrix_world=world

# Cyclic authored animation: equal axle rotation plus the matching circular
# translation of each side rod. Nine keyed endpoints cover eight exact phases.
for frame in range(1,10):
    theta=math.tau*(frame-1)/8
    for pivot in pivots:
        pivot.rotation_euler.y=theta
        pivot.keyframe_insert(data_path='rotation_euler',index=1,frame=frame)
    for carrier,side in zip(rod_carriers,[-1,1]):
        carrier.location=(wheel_x[0]+wheel_r*.29*math.cos(theta),side*(half_gauge+.17),wheel_z-wheel_r*.29*math.sin(theta))
        carrier.keyframe_insert(data_path='location',frame=frame)
for obj in [*pivots,*rod_carriers]:
    action=obj.animation_data.action
    # Blender 5.2 stores animation channels in layered actions; defaults are
    # smooth bezier keys, which keep the rod's eight sampled orbit positions
    # moving continuously through the render phases.

# Keep a concise construction receipt alongside the immutable candidate files.
bpy.context.view_layer.update()
deps=bpy.context.evaluated_depsgraph_get()
pts=[o.matrix_world@Vector(c) for o in bpy.context.scene.objects if o.type=='MESH' for c in o.evaluated_get(deps).bound_box]
span=max(p.x for p in pts)-min(p.x for p in pts)
blend=ROOT/'body.blend';bpy.data.libraries.write(str(blend),{bpy.context.scene},fake_user=True,compress=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
part={'name':'body','source':str(blend),'source_sha256':sha(blend),'frame_prefix':'loco_class08_body','length_tiles':span/TILE,'canvas':512,'effects':{'lamps':[[3.469,0,2.96],[3.469,-.62,1.27],[3.469,.62,1.27],[-3.724,0,3.20]]},'window_materials':['Opaque blue grey cab glazing'],'wheel':{'mode':'timeline','start':1,'period_frames':8,'radius':wheel_r,'symmetry':1},'max_phase_bounds_drift':1}
observations=PROJECT_ROOT/PROJECT['observations']
reference={'schema':1,'authority':'png-pictures-and-owner-notes','pictures':[dict(p,path=str(PROJECT_ROOT/p['path'])) for p in PROJECT['pictures']],'observations':{'path':str(observations),'sha256':sha(observations)},'guidelines':'Only the locked PNG references and recorded observations determine appearance. Fresh C50-helper geometry; no in-game model or runtime fit/gear table used.'}
reference['prepared_sources']={'body':part['source_sha256']}
(ROOT/'candidate.json').write_text(json.dumps({'schema':1,'id':PROJECT['id'],'profile':str(PROJECT_ROOT/PROJECT['profile']),'parts':[part],'reference':reference},indent=2)+'\n')
(ROOT/'calibration.json').write_text(json.dumps([{'part':'body','tiles':[part['length_tiles'],1],'gear':[],'axles':[{'x_m':x,'d_m':wheel_r*2} for x in wheel_x]}],indent=2)+'\n')
(ROOT/'validation.json').write_text(json.dumps({'source_geometry':'Fresh editable primitives authored from the locked PNGs','world_axes':'+X locomotive front; Y wheel axles; Z up','wheel_centres_x_m':wheel_x,'wheel_centres_y_m':[-half_gauge,half_gauge],'wheel_radius_m':wheel_r,'wheel_count':len(pivots),'rod_carriers':len(rod_carriers),'body_edges_parallel_to_X':True,'lamp_lens_centres':part['effects']['lamps'],'length_tiles_from_authored_geometry':part['length_tiles'],'assumptions':'Scale/axle spacing are proportional inferences, not prototype measurements.'},indent=2)+'\n')
print(f'Class 08 authored body saved; {len(pivots)} moving wheel pivots, two moving coupling rods; {part["length_tiles"]:.3f} tiles')
