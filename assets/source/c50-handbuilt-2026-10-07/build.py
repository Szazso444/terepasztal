"""Construct an editable C-50 directly from the approved painted reference."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector, Matrix

OUT=Path(__file__).parent
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, rgb, metallic=0, rough=.48):
    m=bpy.data.materials.new(name);m.diffuse_color=(*rgb,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*rgb,1)
    p.inputs['Metallic'].default_value=metallic;p.inputs['Roughness'].default_value=rough
    p.inputs['Emission Color'].default_value=(*rgb,1);p.inputs['Emission Strength'].default_value=.13
    return m

body=mat('Paint / charcoal blue',(.024,.030,.042));edge=mat('Raised charcoal edges',(.038,.046,.063))
red=mat('Paint / vivid vermilion',(.72,.018,.004));dark=mat('Recess / graphite',(.006,.008,.012))
steel=mat('Brushed steel',(.43,.48,.53),.65,.32);boltmat=mat('Dark steel hardware',(.14,.17,.2),.65)
glass=mat('Opaque painted blue glass',(.013,.085,.15),.05,.4)
glint=mat('Painted window reflection',(.024,.135,.21),.05,.4)
lamp=mat('Ivory lamp glass',(.86,.88,.74),.1,.22);bronze=mat('Warm exhaust steel',(.22,.16,.11),.6)
all_meshes=[]

def finish(o,name,material,bevel=0):
    o.name=name;o.data.materials.append(material);all_meshes.append(o)
    if bevel:
        mod=o.modifiers.new('Manufactured soft edges','BEVEL');mod.width=bevel;mod.segments=3
        mod=o.modifiers.new('Weighted planar normals','WEIGHTED_NORMAL');mod.keep_sharp=True
    return o

def box(name,loc,size,material,bevel=.018):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object
    o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,material,bevel)

def cyl(name,loc,r,depth,material,axis='Z',vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=loc)
    o=bpy.context.object
    if axis=='Y':o.rotation_euler[0]=math.pi/2
    if axis=='X':o.rotation_euler[1]=math.pi/2
    finish(o,name,material,.006)
    for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
    return o

def rod(name,a,b,r,material):
    mid=(Vector(a)+Vector(b))*.5;o=cyl(name,mid,r,(Vector(b)-Vector(a)).length,material)
    o.rotation_euler=(Vector(b)-Vector(a)).to_track_quat('Z','Y').to_euler();return o

def reflection(points):
    mesh=bpy.data.meshes.new('Painted reflection');mesh.from_pydata(points,[],[(0,1,2)]);mesh.update()
    o=bpy.data.objects.new('Diagonal glass reflection',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,glint)

# Constant widths on both ends; every longitudinal body/deck edge is parallel to X.
deck=box('Straight rectangular deck',(0,0,.84),(4.6,1.76,.18),red,.028)
box('Dark non-slip deck surface',(0,0,.94),(4.53,1.71,.035),boltmat,.01)
for s in [-1,1]:
    box('Long straight frame beam',(0,s*.83,.69),(4.6,.095,.2),red)
    for x in [-2.02,2.02]:box('End skirt',(x,s*.83,.43),(.56,.095,.62),red,.035)
    for x in [-2.3,2.3]:
        cyl('Skirt fastener',(x*.965,s*.885,.73),.021,.014,boltmat,'Y',16)
    box('Central step tread',(0,s*.94,.26),(.42,.27,.07),red)
    for x in [-.19,.19]:box('Step upright',(x,s*.9,.46),(.055,.08,.4),red,.008)

for x in [-2.28,2.28]:
    sign=1 if x>0 else -1
    box('End buffer beam',(x,0,.47),(.14,1.76,.72),red,.04)
    box('Coupler mount',(x+sign*.11,0,.39),(.12,.46,.34),boltmat,.04)
    box('Coupler top jaw',(x+sign*.28,0,.51),(.34,.36,.085),dark)
    box('Coupler lower jaw',(x+sign*.28,0,.27),(.34,.36,.085),dark)
    for side in [-1,1]:box('Coupler cheek',(x+sign*.34,side*.15,.39),(.16,.07,.26),boltmat)
    for y in [-.65,.65]:
        cyl('Buffer base',(x+sign*.105,y,.52),.105,.12,red,'X')
        cyl('Buffer face',(x+sign*.19,y,.52),.092,.09,dark,'X')

deck_parts=list(all_meshes)
hoods=[]
for sign in [-1,1]:
    x=sign*1.53
    hoods.append(box('Front hood' if sign>0 else 'Rear hood',(x,0,1.48),(1.35,1.37,1.04),body,.055))
    box('Hood lid',(x,0,2.015),(1.35,1.38,.065),edge,.04)
    for side in [-1,1]:
        y=side*.699
        box('Inspection panel recessed seam',(x,y,1.47),(1.30,.022,.85),dark,.025)
        box('Inspection panel',(x,y+side*.016,1.47),(1.25,.024,.80),body,.025)
        for dx in [-.48,.48]:
            for z in [1.10,1.83]:box('Panel hinge',(x+dx,y+side*.04,z),(.12,.055,.055),boltmat,.008)
        if sign>0:
            for z in [1.30,1.64]:
                box('Louvre inset',(x,y+side*.032,z),(1.03,.02,.25),dark,.012)
                for i in range(15):
                    box('Pressed vertical louvre',(x-.48+i*.068,y+side*.054,z),(.032,.035,.23),edge,.012)
        for dx in [-.57,.57]:
            for z in [1.1,1.82]:cyl('Panel screw',(x+dx,y+side*.039,z),.018,.01,steel,'Y',12)
    for dx in [-.52,.52]:
        for y in [-.43,.43]:box('Lid latch',(x+dx,y,2.059),(.11,.075,.025),boltmat,.007)
    for y in [-.63,.63]:
        cyl('Hood lamp shell',(sign*2.225,y,1.91),.113,.10,dark,'X')
        cyl('Hood lamp rim',(sign*2.285,y,1.91),.097,.024,steel,'X')
        cyl('Hood lamp glass',(sign*2.30,y,1.91),.078,.026,lamp,'X')

# A front radiator: two banks of horizontal slats with a central divider.
box('Radiator inset',(2.218,0,1.47),(.025,1.05,.79),dark,.025)
for y in [-.54,.0,.54]:box('Radiator stile',(2.244,y,1.47),(.035,.035,.81),edge,.008)
for z in [1.07,1.87]:box('Radiator border',(2.244,0,z),(.035,1.1,.035),edge,.008)
for i in range(13):box('Radiator horizontal slat',(2.246,0,1.12+i*.056),(.045,1.025,.025),boltmat,.005)

# Central cab, side doors, opaque glass. No guessed pipes on hidden side.
cab_start=len(all_meshes)
cab=box('Central cab',(0,0,1.885),(1.72,1.58,1.85),body,.06)
box('Cab roof closure',(0,0,2.82),(1.70,1.57,.13),body,.035)
for side in [-1,1]:
    y=side*.80
    box('Door seam',(-.23,y,1.86),(.96,.028,1.67),dark,.035)
    box('Door',(-.23,y+side*.02,1.86),(.90,.025,1.61),body,.03)
    for x,w,z,h in [(-.24,.63,2.29,.70),(.59,.31,2.3,.72)]:
        box('Window rubber surround',(x,y+side*.045,z),(w+.085,.035,h+.085),dark,.045)
        box('Window raised lip',(x,y+side*.065,z),(w+.035,.018,h+.035),edge,.035)
        box('Opaque window',(x,y+side*.078,z),(w,.013,h),glass,.025)
        reflection([(x-w*.43,y+side*.087,z+h*.43),(x+w*.43,y+side*.087,z+h*.43),(x-w*.43,y+side*.087,z-h*.35)])
    for z in [1.16,2.53]:box('Door hinge',(.22,y+side*.058,z),(.065,.06,.13),boltmat,.01)
    rod('Door handle',(-.55,y+side*.12,1.82),(-.34,y+side*.12,1.82),.021,steel)
    rod('Grab rail',(-.77,y+side*.13,1.33),(-.77,y+side*.13,2.44),.022,boltmat)
for sign in [-1,1]:
    x=sign*.876
    for y in [-.34,.34]:
        box('Cab end window gasket',(x,y,2.40),(.035,.61,.66),dark,.045)
        box('Cab end window frame',(x+sign*.019,y,2.40),(.02,.56,.60),edge,.035)
        box('Cab end glass',(x+sign*.031,y,2.40),(.018,.50,.55),glass,.03)
        reflection([(x+sign*.042,y-.22,2.63),(x+sign*.042,y+.22,2.63),(x+sign*.042,y-.22,2.19)])

# Barrel-curved sheet roof, longitudinally straight, modest overhang.
verts=[];n=24
for x in [-.94,.94]:
    for zoff in [0,-.075]:
        for i in range(n+1):
            y=-.89+1.78*i/n;verts.append((x,y,2.875+.09*(1-(y/.89)**2)+zoff))
faces=[]
for layer in [0,1]:
    for i in range(n):
        a=layer*(n+1)+i;b=2*(n+1)+a;faces.append((a,a+1,b+1,b))
for end in [0,1]:
    off=end*2*(n+1)
    for i in range(n):faces.append((off+i,off+i+1,off+n+2+i,off+n+1+i))
for i in [0,n]:faces.append((i,n+1+i,3*(n+1)+i,2*(n+1)+i))
mesh=bpy.data.meshes.new('Roof mesh');mesh.from_pydata(verts,[],faces);mesh.update()
roof=bpy.data.objects.new('Gently curved roof',mesh);bpy.context.collection.objects.link(roof);finish(roof,'Gently curved roof',edge,.022)
bpy.ops.object.select_all(action='DESELECT');roof.select_set(True);bpy.context.view_layer.objects.active=roof
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
for sign in [-1,1]:
    cyl('Cab upper lamp shell',(sign*.95,0,2.98),.13,.12,dark,'X')
    cyl('Cab upper lamp rim',(sign*1.025,0,2.98),.114,.025,steel,'X')
    cyl('Cab upper lamp lens',(sign*1.045,0,2.98),.093,.02,lamp,'X')
    for y in [-.76,.76]:cyl('Red marker light',(sign*.97,y,2.81),.055,.07,red,'X')

# Owner-requested modest transverse increase, uniform along each part's length.
# Running gear and both hoods retain their dimensions; no taper is introduced.
bpy.context.view_layer.update()
cab_parts=all_meshes[cab_start:]
for obj in deck_parts+cab_parts:
    obj.matrix_world=Matrix.Diagonal((1,1.08,1,1)) @ obj.matrix_world
bpy.context.view_layer.update()
assert len([o for o in cab_parts if o.name.startswith('Cab end glass')])==4

# Short hollow exhaust, on the front hood only.
cyl('Exhaust foot',(1.18,.18,2.08),.12,.08,bronze)
cyl('Exhaust collar',(1.18,.18,2.15),.085,.06,bronze)
cyl('Exhaust tube',(1.18,.18,2.28),.063,.26,bronze)
cyl('Exhaust dark opening',(1.18,.18,2.414),.047,.009,dark)

# Independent wheel pivots keep future travel-driven rotation separate from axleboxes.
pivots=[]
for x in [-1.02,1.02]:
    cyl('Axle',(x,0,.43),.075,1.40,boltmat,'Y')
    box('Underframe suspension',(x,0,.60),(.68,1.1,.18),dark)
    for side in [-1,1]:
        y=side*.69
        pivot=bpy.data.objects.new('Wheel pivot',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,y,.43);pivots.append(pivot)
        pieces=[cyl('Wheel tyre',(x,y,.43),.43,.15,steel,'Y',64),cyl('Wheel red disc',(x,y+side*.084,.43),.355,.025,red,'Y',64),cyl('Wheel raised hub',(x,y+side*.112,.43),.14,.052,red,'Y'),cyl('Wheel axle cap',(x,y+side*.144,.43),.076,.017,boltmat,'Y')]
        for i in range(5):
            a=i*math.tau/5
            pieces.append(cyl('Wheel dark recess',(x+.25*math.sin(a),y+side*.102,.43+.25*math.cos(a)),.039,.009,dark,'Y',20))
        for o in pieces:
            world=o.matrix_world.copy();bpy.context.view_layer.update();world=o.matrix_world.copy();o.parent=pivot;o.matrix_world=world

assert abs(hoods[0].dimensions.y-hoods[1].dimensions.y)<1e-6
assert all(abs(o.rotation_euler.z)<1e-6 for o in [deck,cab,*hoods])
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1100;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
scene.world=bpy.data.worlds.new('Studio world');scene.world.color=(.07,.07,.07);scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='CUDA';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='CUDA'
scene.cycles.device='GPU'
def area(name,loc,power,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1.3))-o.location).to_track_quat('-Z','Y').to_euler()
area('Soft upper left',(-3,-5,7),1050,5);area('Front fill',(5,-2,4),600,4);area('Rear fill',(0,5,5),850,5)
camera_data=bpy.data.cameras.new('Reference camera');camera_data.type='ORTHO';camera_data.ortho_scale=6.3
camera=bpy.data.objects.new('Reference camera',camera_data);bpy.context.collection.objects.link(camera);scene.camera=camera
def view(name,azimuth,elevation):
    a,e=math.radians(azimuth),math.radians(elevation);target=Vector((0,0,1.45))
    camera.location=target+Vector((math.cos(a)*math.cos(e),math.sin(a)*math.cos(e),math.sin(e)))*12
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(OUT/f'{name}.png');bpy.ops.render.render(write_still=True)
view('front',-62,22)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'c50-handbuilt.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'c50-handbuilt.glb'),export_format='GLB',export_apply=True)
for name,a,e in [('rear',118,22),('side',-90,0),('front-end',0,0),('rear-end',180,0),('top',-90,89.9)]:view(name,a,e)
(OUT/'validation.json').write_text(json.dumps({'hood_widths':[o.dimensions.y for o in hoods],'deck_width':deck.dimensions.y,'cab_width':cab.dimensions.y,'longitudinal_axes_parallel':True,'wheel_pivots':len(pivots),'mesh_objects':len(all_meshes),'source':'../c50-regenerated-2026-10-07/c50-reference-v2.png','policy':'New deterministic mesh; no Comfy geometry, source projection or width deformation.'},indent=2))
