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

