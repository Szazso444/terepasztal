import bpy, math
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'orthos';OUT.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'model'/'body.blend'))
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=1000;scene.render.resolution_y=600
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.view_settings.view_transform='AgX'
scene.world=bpy.data.worlds.new('Orthographic review world');scene.world.color=(.09,.09,.09)
for name,pos,power,size in [('Key',(-1,-7,10),1350,7),('Fill',(6,5,7),900,6)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.use_shadow=False
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=pos
    obj.rotation_euler=(Vector((0,0,1.8))-obj.location).to_track_quat('-Z','Y').to_euler()
camera_data=bpy.data.cameras.new('Orthographic review camera');camera_data.type='ORTHO';camera_data.ortho_scale=9.8
camera=bpy.data.objects.new('Orthographic review camera',camera_data);scene.collection.objects.link(camera);scene.camera=camera
for name,pos,target,scale in [
    ('side',(0,-18,2),(0,0,2),9.8),
    ('top',(0,0,18),(0,0,0),9.0),
    ('nose',(18,0,2),(0,0,2),5.8),
    ('cab_end',(-18,0,2),(0,0,2),5.8),
    ('three_quarter',(13,-16,11),(0,0,1.8),11.5),
]:
    camera.data.ortho_scale=scale;camera.location=pos
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(OUT/f'{name}.png');bpy.ops.render.render(write_still=True)
print('Rendered five orthographic and comparison views:',OUT)
