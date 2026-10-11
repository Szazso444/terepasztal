"""Render a reconstruction in a fresh headless Blender, never the user's live scene."""
import bpy, sys, math, json
from pathlib import Path
import numpy as np
from mathutils import Vector, Matrix
sys.path.insert(0,'G:/DEV/Terepasztal/files')
import blender_stage as stage

root=Path('G:/DEV/Terepasztal/poc/rocket-original-v1')
obj=stage.import_mesh(str(root/'raw.glb'))
V,N,nv,nf=stage.mesh_arrays(obj,20000)
angles,score=stage.manhattan_align(N,[-65,20],[-25,25])
R=stage.compose(*angles)
Vr=V@R.T
ext=Vr.max(0)-Vr.min(0)
if ext[1]>ext[0]: R=stage.rz(math.pi/2)@R
Vr=V@R.T
# Rocket-specific orientation cue: its tallest chimney is at the nose.
# Still expose diagnostics; this cue is not a generic locomotive rule.
top=Vr[Vr[:,2]>Vr[:,2].max()-0.10*np.ptp(Vr[:,2])]
chimney_flip=bool(np.mean(top[:,0])<(Vr[:,0].min()+Vr[:,0].max())/2)
if chimney_flip: R=stage.rz(math.pi)@R
if '--flip' in sys.argv: R=stage.rz(math.pi)@R
Vr=V@R.T
lo,hi=Vr.min(0),Vr.max(0)
s=1/(hi[0]-lo[0]) # uniform one-tile normalization, matching game's small rigid body
centre=np.array([(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,lo[2]])
M=stage.to4(R*s)
M.translation=Vector(-centre*s)
base=M@obj.matrix_world
obj.matrix_world=base
dims=(hi-lo)*s
# Keep the generated colour texture; remove extra physical relighting of painted highlights.
for mat in bpy.data.materials:
    if not mat.use_nodes: continue
    nodes=mat.node_tree.nodes
    principled=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
    output=next((n for n in nodes if n.type=='OUTPUT_MATERIAL'),None)
    if not principled or not output: continue
    emission=nodes.new('ShaderNodeEmission')
    color=principled.inputs.get('Base Color')
    if color and color.is_linked: mat.node_tree.links.new(color.links[0].from_socket,emission.inputs['Color'])
    elif color: emission.inputs['Color'].default_value=color.default_value
    mat.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
sc=bpy.context.scene
sc.render.engine='CYCLES'
sc.cycles.samples=1
sc.cycles.use_denoising=False
sc.render.film_transparent=True
sc.render.image_settings.file_format='PNG'
sc.render.image_settings.color_mode='RGBA'
sc.view_settings.view_transform='Standard'
sc.view_settings.look='None'
sc.render.resolution_percentage=100
cam=stage.make_camera('poc_camera')
sc.camera=cam
(root/'renders').mkdir(exist_ok=True)
def view(name,yaw_deg,elev_deg,azimuth_deg,scale=1.85,res=512):
    obj.matrix_world=Matrix.Rotation(math.radians(yaw_deg),4,'Z')@base
    cam.rotation_euler=(math.radians(90-elev_deg),0,math.radians(azimuth_deg))
    bpy.context.view_layer.update()
    rot=cam.matrix_world.to_3x3()
    back=rot.col[2]
    cam.location=Vector((0,0,float(dims[2])/2))+back*10
    cam.data.ortho_scale=scale
    sc.render.resolution_x=sc.render.resolution_y=res
    sc.render.filepath=str(root/'renders'/f'{name}.png')
    bpy.ops.render.render(write_still=True)
view('side',0,0,0,1.5)
view('front',0,0,90,1.5)
view('top',0,90,0,1.5)
# Source camera: 35 degrees around from a side view, elevated 25 degrees.
view('source-camera-35-25',0,25,35,1.65,1024)
# Export fixed resolution, fixed rail-plane anchor and exact per-facing rotations.
# 4 physical texels/logical pixel; tile diagonal width 64 -> 256 texels.
k=64/math.sqrt(2)
res=384
scale=res/(k*4)
anchor=[res/2,res*0.72]
frames={}
drawn=[f for f in range(48) if f <= ((12-f)%48)]
for f in drawn:
    obj.matrix_world=Matrix.Rotation(math.radians(-f*7.5),4,'Z')@base
    cam.rotation_euler=(math.radians(60),0,math.radians(45))
    bpy.context.view_layer.update()
    rot=cam.matrix_world.to_3x3()
    cam.location=rot.col[1]*((anchor[1]-res/2)/(k*4))+rot.col[2]*10
    cam.data.ortho_scale=scale
    sc.render.resolution_x=sc.render.resolution_y=res
    filename=f'game-f{f}.png'
    sc.render.filepath=str(root/'renders'/filename)
    bpy.ops.render.render(write_still=True)
    frames[str(f)]={'file':'renders/'+filename,'ax':anchor[0],'ay':anchor[1],'resolution':4,'yawDegrees':-f*7.5}
meta={'source':'original.png','alignmentAnglesDegrees':angles,'alignmentScore':score,'alignmentThreshold':0.70,'alignmentPass':score>=0.70,'chimneyBasedFlip':chimney_flip,'vertices':nv,'faces':nf,'dimensionsTiles':dims.tolist(),'uniformScale':s,'sourceCamera':{'azimuthFromSide':35,'elevation':25},'gameCamera':{'azimuth':45,'elevation':30},'logicalTile':[64,32],'railCentresTiles':[-0.16,0.16],'railGaugeTiles':0.32,'runtimeHumanHeightPixels':11,'frames':frames,'status':'experimental reconstruction; wheel tread gauge, ground contact, front direction and appearance require visual review','metricScale':'No metre calibration asserted. Game supplies tile lengths and pixel heights, not a global metres-per-tile value.'}
(root/'render-metadata.json').write_text(json.dumps(meta,indent=2),encoding='utf8')
bpy.ops.wm.save_as_mainfile(filepath=str(root/'rocket-poc.blend'))
print('POC_COMPLETE '+json.dumps({k:meta[k] for k in ('alignmentScore','alignmentPass','dimensionsTiles','vertices','faces')}),flush=True)
