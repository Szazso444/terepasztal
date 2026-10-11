exec(open(r'C:\Users\Zso\terepasztal-playtest\scratchpad\models\handover-review\surface-audit.py').read().split('for mode,ambient,light')[0])
from mathutils import Vector
mat=gear.shaded_material('painted',stage.painted_shading(job['grid'],job['render']),image=image)
for o in objs:
 for slot in o.material_slots:slot.material=mat
 o.matrix_world=rigid@original[o]
cam.rotation_euler=(math.pi/2,0,0);cam.location=Vector((0,-100,1.35));cam.data.ortho_scale=6.2
bpy.context.scene.render.resolution_x=1240;bpy.context.scene.render.resolution_y=700
stage.render_to(root/'surface-audit/side.png')
