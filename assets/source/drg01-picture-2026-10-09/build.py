"""Build a picture-authored DRG01 Pacific and tender using frozen C50 primitives."""
import bpy, math, json, hashlib, ast
from pathlib import Path
from mathutils import Vector

ROOT = OUTPUT
TILE = 6.235064799811727
ROOT.mkdir(parents=True, exist_ok=True)

# c50_primitives.py includes the accepted C50 example scene after its helper
# definitions. Extract only its frozen primitive functions; never execute or
# import that other locomotive's geometry.
helper_path = PROJECT_ROOT / PROJECT['helpers']
helper_tree = ast.parse(helper_path.read_text(encoding='utf-8'))
primitive_names = {'mat', 'finish', 'box', 'cyl', 'rod'}
primitive_nodes = [n for n in helper_tree.body if isinstance(n, ast.FunctionDef) and n.name in primitive_names]
exec(compile(ast.Module(body=primitive_nodes, type_ignores=[]), str(helper_path), 'exec'), globals())

def reset_part():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    globals()['all_meshes'] = []
    globals()['body'] = mat('Boiler and tender charcoal', (.025,.030,.036), 0, .54)
    globals()['body_edge'] = mat('Raised charcoal edges', (.050,.058,.065), .08, .52)
    globals()['red'] = mat('Red cast frame and wheels', (.46,.025,.020), .08, .52)
    globals()['red_edge'] = mat('Raised red running gear', (.60,.036,.026), .06, .48)
    globals()['dark'] = mat('Recess graphite', (.009,.012,.015), .04, .68)
    globals()['steel'] = mat('Dark wheel tread', (.065,.074,.080), .22, .44)
    globals()['metal'] = mat('Warm brass and copper', (.50,.31,.105), .22, .42)
    globals()['cream'] = mat('Warm cream boiler bands', (.78,.64,.39), .04, .56)
    globals()['glass_rear'] = mat('Dark rear cab glazing', (.012,.023,.026), 0, .32)
    globals()['glass_front'] = mat('Blue green forward cab glazing', (.035,.17,.17), .02, .28)
    globals()['glass_spectacle'] = mat('Blue green spectacle glazing', (.035,.15,.16), .02, .28)
    globals()['lamp_glass'] = mat('Ivory headlamp lenses', (.90,.72,.35), .03, .25)
    globals()['coal'] = mat('Coal load', (.018,.020,.021), .02, .82)

def saved(name, prefix, canvas=512):
    scene=bpy.context.scene
    bpy.context.view_layer.update()
    deps=bpy.context.evaluated_depsgraph_get()
    pts=[o.matrix_world@Vector(c) for o in scene.objects if o.type=='MESH' and not o.hide_render for c in o.evaluated_get(deps).bound_box]
    span=max(p.x for p in pts)-min(p.x for p in pts)
    path=ROOT/f'{name}.blend'
    # The renderer opens each part as a normal Blender scene; save a self-
    # contained project file rather than a linkable library container.
    bpy.ops.wm.save_as_mainfile(filepath=str(path), check_existing=False)
    return {'name':name,'source':str(path),'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'frame_prefix':prefix,'length_tiles':span/TILE,'canvas':canvas,'effects':{}}

def curve_cycle(obj, data_path, index, values):
    for frame, value in values:
        if data_path == 'rotation_euler': obj.rotation_euler[index]=value
        elif data_path == 'location': obj.location[index]=value
        obj.keyframe_insert(data_path=data_path, index=index, frame=frame)

def parenting_keep_world(pieces, parent):
    bpy.context.view_layer.update()
    for ob in pieces:
        world=ob.matrix_world.copy()
        ob.parent=parent
        ob.matrix_world=world

def engine_body():
    reset_part()
    # The frame and boiler are straight along X. The engine is a new primitive
    # arrangement: none of its body contours or parts are borrowed from a mesh.
    box('Continuous red main frame',(0,0,.90),(10.72,2.25,.32),red,.07)
    box('Running board',(0,0,1.20),(10.45,2.47,.12),body_edge,.045)
    for s in [-1,1]:
        box('Straight red frame side',(0,s*1.06,.84),(10.50,.16,.35),red_edge,.045)
        box('Cream running board edge',(0,s*1.225,1.23),(10.2,.025,.045),cream,.006)
    # Cab at the rear of the engine, with two observed panes and curved roof.
    box('Cab body',(-3.93,0,2.72),(2.25,2.30,2.66),body,.10)
    box('Cab rear wall',(-5.03,0,2.68),(.12,2.22,2.40),body_edge,.028)
    for s in [-1,1]:
        y=s*1.17
        # Painted inset glass remains an explicit material for the night mask.
        box('Rear dark cab window gasket',(-4.58,y,3.28),(.54,.045,.71),dark,.035)
        box('Rear dark cab glazing',(-4.58,y+s*.029,3.28),(.43,.018,.60),glass_rear,.025)
        box('Forward teal cab window gasket',(-3.83,y,3.28),(.61,.045,.71),dark,.035)
        box('Forward teal cab glazing',(-3.83,y+s*.029,3.28),(.49,.018,.60),glass_front,.025)
        box('Cab lower side panel',(-3.95,y,1.92),(2.05,.035,.10),cream,.008)
    # One narrow spectacle pane on the forward cab end.
    box('Spectacle outer gasket',(-2.795,0,3.35),(.045,.45,.73),dark,.04)
    box('Narrow cab spectacle glazing',(-2.765,0,3.35),(.018,.34,.61),glass_spectacle,.025)
    # Barrel roof is a constant curved cross-section, with straight end rails.
    verts=[]; n=24
    for x in [-5.12,-2.76]:
        for i in range(n+1):
            y=-1.22+2.44*i/n
            verts.append((x,y,4.13+.22*(1-(y/1.22)**2)))
    faces=[(i,i+1,n+2+i,n+1+i) for i in range(n)]
    me=bpy.data.meshes.new('Curved cab roof mesh');me.from_pydata(verts,[],faces);me.update()
    ob=bpy.data.objects.new('Curved cab roof',me);bpy.context.collection.objects.link(ob);finish(ob,ob.name,body_edge,.025)
    for x in [-4.67,-3.48]:
        box('Low cab roof hatch',(x,0,4.35),(.48,.57,.13),body_edge,.045)

    # Boiler, smokebox, bands and front door. Boiler axis and running-board
    # edges remain parallel; no perspective warp is applied.
    cyl('Long boiler barrel',(.62,0,2.77),.90,7.00,body,'X',64)
    cyl('Boiler rear saddle',(-2.70,0,2.77),.94,.18,body_edge,'X',64)
    cyl('Smokebox outer barrel',(4.24,0,2.77),.99,1.43,body_edge,'X',64)
    cyl('Smokebox front rim',(4.97,0,2.77),.91,.11,metal,'X',64)
    cyl('Smokebox door',(5.04,0,2.77),.84,.12,body,'X',64)
    cyl('Smokebox inner plate',(5.112,0,2.77),.66,.015,body_edge,'X',64)
    cyl('Smokebox latch',(5.15,0,2.77),.075,.07,metal,'X',32)
    for x in [-2.42,-1.02,.45,1.88,3.35]:
        cyl('Narrow cream boiler band',(x,0,2.77),.914,.075,cream,'X',64)
    # Chimney with a visibly open, copper-rimmed mouth.
    cyl('Chimney base',(3.60,0,3.62),.34,.15,body_edge)
    cyl('Chimney shaft',(3.60,0,3.91),.235,.48,body)
    cyl('Chimney copper lip',(3.60,0,4.17),.30,.09,metal)
    cyl('Chimney dark opening',(3.60,0,4.218),.225,.018,dark)
    # Two low domes and sparse brass plumbing match visible references.
    cyl('Steam dome base',(.58,0,3.65),.43,.16,body_edge)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1, location=(.58,0,3.98))
    ob=bpy.context.object;ob.scale=(.39,.39,.40);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);finish(ob,'Rounded steam dome',body)
    cyl('Steam dome cap',(.58,0,4.38),.15,.07,metal)
    cyl('Sand dome base',(-1.28,0,3.58),.34,.14,body_edge)
    cyl('Sand dome',( -1.28,0,3.81),.27,.40,body)
    cyl('Sand dome cap',(-1.28,0,4.02),.13,.06,metal)
    for s in [-1,1]:
        y=s*1.02
        rod('Straight boiler handrail',(-2.35,y,2.98),(4.25,y,2.98),.032,metal)
        for x in [-2.14,-.65,.92,2.45,3.92]:
            rod('Handrail stanchion',(x,y,2.90),(x,y,3.15),.025,metal)
        rod('Lower boiler pipe',(-2.08,s*.98,2.08),(3.70,s*.98,2.08),.035,metal)
    # Front cylinder assemblies sit above the corrected rearward-shifted lead
    # truck, below the forward boiler and behind the buffer beam.
    for s in [-1,1]:
        box('Steam cylinder block',(3.22,s*.92,1.62),(1.33,.55,.90),body_edge,.16)
        cyl('Cylinder end cover',(3.22,s*1.205,1.63),.31,.035,body,'Y',48)
        rod('Piston rod',(3.80,s*1.27,1.61),(4.56,s*1.27,1.61),.055,steel)
    # Front pilot and coupling equipment.
    box('Red front buffer beam',(5.22,0,.94),(.25,2.55,.68),red,.06)
    box('Black pilot plate',(4.76,0,.72),(.96,2.30,.16),body_edge,.04)
    for s in [-1,1]:
        cyl('Buffer housing',(5.38,s*.91,.99),.22,.31,body_edge,'X',40)
        cyl('Buffer silver face',(5.56,s*.91,.99),.17,.08,steel,'X',40)
        # Lens centres are exactly the coordinates carried in effects.lamps.
        cyl('Headlamp housing',(5.345,s*.60,1.35),.20,.22,body_edge,'X',48)
        cyl('Headlamp brass rim',(5.465,s*.60,1.35),.162,.04,metal,'X',48)
        cyl('Headlamp glass lens',(5.49,s*.60,1.35),.128,.02,lamp_glass,'X',48)
    box('Coupler shank',(5.53,0,.72),(.57,.22,.20),steel,.035)
    box('Coupler head',(5.85,0,.72),(.28,.36,.27),steel,.055)

    # Three coupled, relatively modest red drivers, with independent axle
    # pivots and visible eight-spoke wheels. All diameters are authored from
    # this source composition (owner requested ~25% smaller than old model).
    wheel_r=.62; wheel_z=.68; driver_x=[-.32,1.18,2.68]; wheel_pivots=[]
    for x in driver_x:
        cyl('Driver axle',(x,0,wheel_z),.105,2.25,steel,'Y',32)
        for s in [-1,1]:
            y=s*1.12
            pivot=bpy.data.objects.new('Driver wheel pivot',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,y,wheel_z);wheel_pivots.append(pivot)
            before=set(all_meshes)
            pieces=[cyl('Dark driver tyre',(x,y,wheel_z),wheel_r,.17,steel,'Y',64),
                    cyl('Red driver plate',(x,y+s*.095,wheel_z),wheel_r*.82,.035,red_edge,'Y',64),
                    cyl('Driver hub',(x,y+s*.125,wheel_z),.15,.07,red,'Y',48),
                    cyl('Brass crank pin',(x+.26,y+s*.17,wheel_z),.075,.045,metal,'Y',32)]
            for j in range(8):
                a=j*math.tau/8
                pieces.append(rod('Driver spoke',(x,y+s*.13,wheel_z),(x+wheel_r*.75*math.sin(a),y+s*.13,wheel_z+wheel_r*.75*math.cos(a)),.034,red_edge))
            parenting_keep_world(pieces,pivot)
    # Red side frames and a pair of long connecting rods. The carriers follow
    # the common crank phase; their keyframed circular motion is part of the
    # same authored 8-phase wheel timeline.
    rod_carriers=[]
    for s in [-1,1]:
        box('Rigid driver frame',(1.17,s*.96,.95),(4.35,.16,.34),red,.055)
        carrier=bpy.data.objects.new('Coupling rod phase carrier',None);bpy.context.collection.objects.link(carrier)
        carrier.location=(1.18,s*1.30,wheel_z);rod_carriers.append(carrier)
        piece=box('Long coupling rod',(1.18,s*1.30,wheel_z+.02),(3.30,.075,.075),steel,.032)
        parenting_keep_world([piece],carrier)
        for i,x in enumerate(driver_x):
            cyl('Driver crank boss',(x,s*1.30,wheel_z),.095,.05,metal,'Y',32)
        curve_cycle(carrier,'location',0,[(f,1.18+.26*math.sin((f-1)*math.tau/8)) for f in range(1,10)])
        curve_cycle(carrier,'location',2,[(f,wheel_z+.26*math.cos((f-1)*math.tau/8)) for f in range(1,10)])
    for pivot in wheel_pivots:
        curve_cycle(pivot,'rotation_euler',1,[(f,(f-1)*math.tau/8) for f in range(1,10)])
    # Actual body glazing/lamp coordinates are retained in manifest below.
    scene=bpy.context.scene;scene.frame_set(1)
    part=saved('engine','loco_drg01_engine',512)
    part['wheel']={'mode':'timeline','start':1,'period_frames':8,'radius':wheel_r,'symmetry':1}
    part['window_materials']=['Dark rear cab glazing','Blue green forward cab glazing','Blue green spectacle glazing']
    part['effects']={'lamps':[[5.49,-.60,1.35],[5.49,.60,1.35]]}
    return part, [{'part':'engine','tiles':[part['length_tiles'],1],'gear':[],'axles':[{'x_m':x,'d_m':wheel_r*2} for x in driver_x]}]

def engine_truck(name, wheel_positions, radius, center, truck_index, canvas=256):
    reset_part()
    width=2.05
    # Independent complete truck frames, axleboxes, axles and rotating wheel
    # pivots; no runtime bogie model is used as geometry.
    span=max(wheel_positions)-min(wheel_positions)+radius*2
    for s in [-1,1]:
        y=s*.98
        box('Truck side beam',(0,y,.48),(span,.17,.22),red_edge,.075)
        box('Truck upper frame',(0,y,.70),(span*.70,.16,.13),body_edge,.04)
    for x in wheel_positions:
        cyl('Truck axle',(x,0,radius),.075,2.00,steel,'Y',32)
        for s in [-1,1]:
            y=s*.99
            pivot=bpy.data.objects.new('Truck wheel pivot',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,y,radius)
            pieces=[cyl('Truck dark tyre',(x,y,radius),radius,.14,steel,'Y',56),
                    cyl('Truck red wheel disc',(x,y+s*.08,radius),radius*.78,.025,red_edge,'Y',48),
                    cyl('Truck hub',(x,y+s*.105,radius),.11,.04,metal,'Y',32)]
            for j in range(6):
                a=j*math.tau/6
                pieces.append(rod('Truck spoke',(x,y+s*.10,radius),(x+radius*.72*math.sin(a),y+s*.10,radius+radius*.72*math.cos(a)),.023,red_edge))
            parenting_keep_world(pieces,pivot)
    p=saved(name,f'loco_drg01_{name}',canvas)
    p['wheel']={'mode':'pivots','prefix':'Truck wheel pivot','count':2*len(wheel_positions),'radius':radius,'symmetry':6}
    p['max_phase_bounds_drift']=1
    return p, {'part':name,'tiles':None,'gear':[{'truck':truck_index,'centre_m':center,'model_off_m':0}],'axles':[{'x_m':x,'d_m':radius*2} for x in wheel_positions]}

def tender_body():
    reset_part()
    # The tender shell is a separate picture-authored charcoal body; axle trucks
    # are independently animated parts beneath it.
    box('Tender underframe',(0,0,.86),(6.18,2.33,.34),red,.06)
    box('Tender charcoal tank',(0,0,2.12),(5.90,2.18,2.38),body,.11)
    for s in [-1,1]:
        box('Tender lower red sill',(0,s*1.11,.79),(6.05,.12,.27),red_edge,.035)
        box('Tender fine cream line',(0,s*1.102,1.02),(5.85,.025,.045),cream,.008)
    box('Raised coal bunker',(0,0,3.57),(5.24,1.88,.65),body_edge,.08)
    # Coal lumps are intentionally modest repeated primitives, contained by
    # the observed open bunker rim rather than a guessed solid mound.
    for ix in range(11):
        for iy in range(4):
            x=-2.30+ix*.46+(.12 if iy%2 else 0)
            y=-.67+iy*.43
            z=3.93+.07*((ix*7+iy*3)%4)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=1,location=(x,y,z))
            o=bpy.context.object;o.scale=(.21,.18,.12);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);finish(o,'Individual coal lump',coal)
    for x in [-2.83,2.83]:
        box('Tender end step',(x,0,.51),(.32,2.12,.13),red,.025)
    p=saved('tender','loco_drg01_tender',512)
    return p, {'part':'tender','tiles':[p['length_tiles'],1],'gear':[],'axles':[]}

def tender_truck(name, center, truck_index):
    reset_part(); wheel_r=.34; wheel_positions=[-.43,.43]
    for s in [-1,1]:
        y=s*.98
        box('Tender truck longitudinal frame',(0,y,.48),(1.42,.16,.20),red_edge,.07)
        box('Tender truck cross bolster',(0,0,.70),(.33,1.80,.14),body_edge,.035)
    for x in wheel_positions:
        cyl('Tender axle',(x,0,wheel_r),.07,2.00,steel,'Y',32)
        for s in [-1,1]:
            y=s*.99
            pivot=bpy.data.objects.new('Truck wheel pivot',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,y,wheel_r)
            pieces=[cyl('Tender truck dark tyre',(x,y,wheel_r),wheel_r,.14,steel,'Y',56),
                    cyl('Tender red wheel disc',(x,y+s*.08,wheel_r),wheel_r*.77,.025,red_edge,'Y',48),
                    cyl('Tender hub',(x,y+s*.105,wheel_r),.09,.04,metal,'Y',32)]
            for j in range(6):
                a=j*math.tau/6
                pieces.append(rod('Tender truck spoke',(x,y+s*.10,wheel_r),(x+wheel_r*.72*math.sin(a),y+s*.10,wheel_r+wheel_r*.72*math.cos(a)),.018,red_edge))
            parenting_keep_world(pieces,pivot)
    p=saved(name,f'loco_drg01_{name}',256)
    p['wheel']={'mode':'pivots','prefix':'Truck wheel pivot','count':4,'radius':wheel_r,'symmetry':6}
    p['max_phase_bounds_drift']=1
    return p, {'part':name,'tiles':None,'gear':[{'truck':truck_index,'centre_m':center,'model_off_m':0}],'axles':[{'x_m':x,'d_m':wheel_r*2} for x in wheel_positions]}

parts=[]; calibration=[]
engine, cal=engine_body();parts.append(engine);calibration.extend(cal)
# Truck centres are explicit picture-authored placements relative to the
# engine's visual centre. Leading bogie sits rearward under the cylinders.
for idx,(name,wheels,radius,center) in enumerate([
    ('engine-t0',[ -.34,.34],.31,3.63),
    ('engine-t1',[0],.30,-2.43)]):
    p,c=engine_truck(name,wheels,radius,center,idx);parts.append(p);calibration.append(c)
tender,c=tender_body();parts.append(tender);calibration.append(c)
for idx,(name,center) in enumerate([('tender-t0',1.30),('tender-t1',-1.30)]):
    p,c=tender_truck(name,center,idx);parts.append(p);calibration.append(c)

reference={'schema':1,'authority':'png-pictures-and-owner-notes',
    'pictures':[dict(p,path=str(PROJECT_ROOT/p['path'])) for p in PROJECT['pictures']],
    'observations':{'path':str(PROJECT_ROOT/PROJECT['observations']),
        'sha256':hashlib.sha256((PROJECT_ROOT/PROJECT['observations']).read_bytes()).hexdigest()},
    'guidelines':'Workbook v9 Locomotives row 25 and owner notes, interpreted only through the locked PNG references; no reconstructed/game model or fit/gear-table geometry.',
    'prepared_sources':{p['name']:p['source_sha256'] for p in parts}}
manifest={'schema':1,'id':PROJECT['id'],'profile':str(PROJECT_ROOT/PROJECT['profile']),
    'parts':parts,'reference':reference}
(ROOT/'candidate.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
(ROOT/'calibration.json').write_text(json.dumps(calibration,indent=2)+'\n',encoding='utf-8')
validation={'id':'drg01','geometry_source':'locked PNG images and picture-authored observations only',
    'model_parts':[p['name'] for p in parts],'body_axes_parallel':True,
    'driver_axles':3,'driver_wheel_radius':.62,'driver_wheel_animation':'8-phase authored rods and rotating wheels',
    'engine_trucks':2,'engine_leading_axles':2,'engine_trailing_axles':1,'tender_axles':4,'tender_trucks':2,
    'derived_length_tiles':{p['name']:p['length_tiles'] for p in parts},
    'leading_truck_centre':3.63,'lamp_lens_centres':[[5.49,-.60,1.35],[5.49,.60,1.35]],
    'window_materials':['Dark rear cab glazing','Blue green forward cab glazing','Blue green spectacle glazing'],
    'primitive_helper_sha256':hashlib.sha256(helper_path.read_bytes()).hexdigest(),
    'notes':'Leading truck placement follows owner annotated correction. Wheel sizing is newly authored to image scale; previous-model dimensions were not reused.'}
(ROOT/'validation.json').write_text(json.dumps(validation,indent=2)+'\n',encoding='utf-8')
print('Saved picture-authored DRG01 engine, four complete trucks, and tender.')
