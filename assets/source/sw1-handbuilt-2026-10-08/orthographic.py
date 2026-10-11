import bpy,math
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parent;bpy.ops.wm.open_mainfile(filepath=str(R/'body.blend'));s=bpy.context.scene
s.render.engine='BLENDER_EEVEE';s.render.resolution_x=1000;s.render.resolution_y=550;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.film_transparent=True;s.view_settings.view_transform='AgX'
s.world=bpy.data.worlds.new('Review world');s.world.color=(.20,.20,.20)
for pos,energy in [((0,-8,12),1500),((4,5,8),1000)]:
 l=bpy.data.lights.new('Review softbox','AREA');l.energy=energy;l.size=8;l.use_shadow=False;o=bpy.data.objects.new(l.name,l);s.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,2))-o.location).to_track_quat('-Z','Y').to_euler()
c=bpy.data.cameras.new('Orthographic');c.type='ORTHO';c.ortho_scale=11;o=bpy.data.objects.new(c.name,c);s.collection.objects.link(o);s.camera=o
for name,pos,target in [('top',(0,0,18),(0,0,0)),('side',(0,-18,2),(0,0,2)),('front',(18,0,2),(0,0,2)),('rear',(-18,0,2),(0,0,2))]:
 o.location=pos;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(R/f'{name}.png');bpy.ops.render.render(write_still=True)
print('Top, side and both ends reviewed from orthographic cameras')
