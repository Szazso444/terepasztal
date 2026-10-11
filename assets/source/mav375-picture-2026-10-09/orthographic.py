import bpy, math
from pathlib import Path
from mathutils import Vector
root=Path(r'C:/Users/Zso/terepasztal-local/assets/source/mav375-picture-2026-10-09')
model=root/'model/body.blend'; out=root/'orthos';out.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(model));s=bpy.context.scene
for o in list(s.objects):
 if o.type in {'CAMERA','LIGHT'}:bpy.data.objects.remove(o,do_unlink=True)
s.render.engine='BLENDER_EEVEE';s.render.resolution_x=1000;s.render.resolution_y=600;s.render.resolution_percentage=100;s.render.film_transparent=True
s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast'
s.world=bpy.data.worlds.new('Orthographic review');s.world.color=(.07,.07,.07)
camdata=bpy.data.cameras.new('Review camera');camdata.type='ORTHO';camdata.ortho_scale=11
cam=bpy.data.objects.new('Review camera',camdata);s.collection.objects.link(cam);s.camera=cam
for loc,power,size in [((-3,-5,8),1400,6),((5,-3,5),400,4),((0,6,4),500,5)]:
 d=bpy.data.lights.new('review light','AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new('review light',d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,2))-o.location).to_track_quat('-Z','Y').to_euler()
def render(name,eye,target,scale,ratio=1.6):
 cam.location=Vector(eye);cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=scale
 s.render.resolution_x=1000;s.render.resolution_y=int(1000/ratio);s.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
render('side',(0,-18,2),(0,0,2),10,1.3)
render('top',(0,-15,20),(0,0,1),11,1.1)
render('front',(18,0,2),(0,0,2),5,1.0)
render('rear',(-18,0,2),(0,0,2),5,1.0)
