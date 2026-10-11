"""Rebuild the three-axle BM-50 from the supplied painted reference."""
import bpy, math, json, hashlib
from pathlib import Path
from mathutils import Vector

OUT=Path(__file__).parent/'models/bm50';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
def material(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True
    m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color,1)
    return m
red=material('Vermilion chassis',(.65,.035,.008));gray=material('Warm grey bonnet',(.46,.48,.49))
dark=material('Graphite',(.018,.021,.023));steel=material('Wheel tyres',(.22,.24,.25))
yellow=material('Safety yellow',(.94,.53,.015));glass=material('Painted glass',(.025,.11,.14))
def box(name,xyz,size,mat,bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz);o=bpy.context.object;o.name=name
    o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(mat)
    if bevel:
        b=o.modifiers.new('Soft manufactured edges','BEVEL');b.width=bevel;b.segments=3
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o
def cyl(name,xyz,r,depth,mat,axis='Y'):
    bpy.ops.mesh.primitive_cylinder_add(vertices=40,radius=r,depth=depth,location=xyz);o=bpy.context.object;o.name=name
    if axis=='Y':o.rotation_euler.x=math.pi/2
    if axis=='X':o.rotation_euler.y=math.pi/2
    o.data.materials.append(mat)
    b=o.modifiers.new('Rounded rim','BEVEL');b.width=.009;b.segments=2
    return o
box('Straight chassis',(0,0,.64),(4.6,1.65,.3),red)
box('Central spine',(0,0,.40),(4.1,.65,.25),dark)
box('Bonnet',(.43,0,1.31),(3.62,1.31,1.17),gray,.16)
for side in [-1,1]:
    y=side*.671
    for x in [-.88,-.04,.80,1.64]:
        box('Panel seam',(x,y,1.33),(.026,.012,.89),dark,.003)
        box('Panel handle',(x+.13,y+side*.025,1.25),(.05,.035,.14),steel,.012)
    for x in [-.72,-.53,-.34,.95,1.14,1.33]:
        for z in [1.23,1.32,1.41,1.5]:box('Cooling slot',(x,y+side*.009,z),(.12,.018,.032),dark,.007)
    for x in [-1.72,-.95,0,.95,1.8]:
        box('Chassis access hatch',(x,side*.838,.62),(.34,.02,.12),dark,.008)
    for x in [-1.6,-.125,1.35]:
        box('Axlebox support',(x,side*.81,.40),(.43,.19,.38),red,.025)
        box('Axlebox cap',(x,side*.918,.4),(.2,.04,.18),steel)
    box('Rear step',(-2,side*.92,.35),(.4,.27,.075),yellow,.012)
box('Driver floor',(-1.75,0,.86),(.81,1.38,.12),dark)
box('Driver seat',(-1.78,0,1.17),(.39,.64,.12),dark,.05)
box('Seat back',(-2.02,0,1.39),(.11,.64,.54),dark,.05)
box('Rear red screen',(-2.21,0,1.45),(.12,1.32,1.03),red,.045)
box('Rear window',(-2.277,0,1.64),(.018,1.09,.40),glass,.018)
for side in [-1,1]:
    box('Open driver side rail',(-1.94,side*.72,1.2),(.68,.09,.72),red,.025)
    box('Side opening',(-1.85,side*.775,1.36),(.37,.015,.33),dark,.01)
for x in [-.75,.2,1.14]:
    box('Bonnet cover',(x,0,1.911),(.39,.55,.045),gray)
    cyl('Cover bolt',(x,.13,1.946),.027,.016,steel,'Z')
box('Front radiator',(2.247,0,1.34),(.035,.95,.78),dark,.055)
for y in [-.39,-.26,-.13,0,.13,.26,.39]:box('Radiator vertical slat',(2.274,y,1.34),(.018,.025,.68),yellow,.005)
for z in [1.08,1.24,1.40,1.56]:box('Radiator crossbar',(2.288,0,z),(.018,.87,.019),yellow,.004)
for sign in [-1,1]:
    box('Safety beam',(sign*2.36,0,.55),(.2,1.72,.25),yellow)
    for y in [-.64,-.32,0,.32,.64]:
        o=box('Black warning stripe',(sign*2.466,y,.55),(.015,.115,.25),dark,.002);o.rotation_euler.x=.4
    box('Coupling block',(sign*2.52,0,.44),(.26,.31,.20),dark)
for x in [-1.6,-.125,1.35]:
    cyl('Axle',(x,0,.29),.055,1.24,steel)
    for side in [-1,1]:
        pivot=bpy.data.objects.new('Wheel pivot',None);bpy.context.collection.objects.link(pivot);pivot.location=(x,side*.62,.29)
        wheels=[cyl('Tyre',(x,side*.62,.29),.29,.14,steel),cyl('Wheel centre',(x,side*.7,.29),.238,.025,dark)]
        for i in range(5):
            a=i*math.tau/5;wheels.append(cyl('Wheel recess',(x+.16*math.sin(a),side*.718,.29+.16*math.cos(a)),.027,.01,steel))
        for o in wheels:
            matrix=o.matrix_world.copy();o.parent=pivot;o.matrix_world=matrix

for side in [-1,1]:
    for x in [-1.0,-.20,.70,1.62]:
        cyl('Bonnet porthole rim',(x,side*.673,1.52),.068,.021,steel)
        cyl('Bonnet porthole',(x,side*.69,1.52),.050,.014,dark)
cyl('Headlamp rim',(2.22,0,1.83),.15,.18,steel,'X')
cyl('Headlamp glass',(2.318,0,1.83),.113,.018,gray,'X')

path=OUT/'body.blend';bpy.ops.wm.save_as_mainfile(filepath=str(path))
source_hash=hashlib.sha256(path.read_bytes()).hexdigest()
manifest={'schema':1,'id':'bm50','profile':str((Path(__file__).parents[3]/'tools/asset-pipeline/painted/profiles/c50-approved-v1.json').resolve()),
 'parts':[{'name':'body','source':str(path.resolve()),'source_sha256':source_hash,'frame_prefix':'loco_bm50_body','length_tiles':.6996,'canvas':256,
 'wheel':{'mode':'pivots','prefix':'Wheel pivot','count':6,'radius':.29,'symmetry':5},'effects':{}}]}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
(OUT/'geometry.json').write_text(json.dumps({'reference':'G:/DEV/Terepasztal/locomotive-wheels-bogies-v8.xlsx / Locomotives row 6','axles':3,'straight_parallel_chassis':True,'status':'new reference-built candidate'},indent=2))
