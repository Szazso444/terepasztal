import sys,json,math
from pathlib import Path
import bpy
from mathutils import Matrix
sys.path.insert(0,r'C:\Users\Zso\terepasztal-local\tools\asset-pipeline')
import blender_stage as stage
import running_gear as gear
from render_originals import mesh_digest
root=Path(r'C:\Users\Zso\terepasztal-playtest\scratchpad\models\handover-review')
out=root/'surface-audit';out.mkdir(exist_ok=True)
meta=json.loads((root/'painted-c50/raw/meta.json').read_text())
job=json.loads(Path(r'G:\DEV\Terepasztal\pipeline-out-std\jobs\c50.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r'G:\DEV\Terepasztal\pipeline-out\models_raw\c50.glb')
objs=[o for o in bpy.context.scene.objects if o.type=='MESH']
original={o:o.matrix_world.copy() for o in objs}
for o,m in original.items():o.parent=None;o.matrix_world=m
before=mesh_digest(objs)
image=bpy.data.images.load(str(root/'painted-c50/raw/source-colour.png'))
settings=dict(job['render'],samples=16);stage.setup_render(settings,768,768)
cam=stage.make_camera('audit');cam.rotation_euler=(math.radians(60),0,math.radians(45));bpy.context.scene.camera=cam;bpy.context.view_layer.update()
cam.location=cam.matrix_world.to_3x3().col[2]*1000;cam.data.ortho_scale=10
rigid=Matrix(meta['rigid_matrix'])
for mode,ambient,light in [('painted',0.8,0.4),('flat',1.0,0.0),('clay',0.45,0.65)]:
 shading=stage.painted_shading(job['grid'],dict(job['render'],ambient_level=ambient,light_level=light))
 mat=gear.shaded_material(mode,shading,color=(0.65,0.65,0.65) if mode=='clay' else None,image=None if mode=='clay' else image)
 for o in objs:
  for slot in o.material_slots:slot.material=mat
 for f in [0,24]:
  for o,m in original.items():o.matrix_world=Matrix.Rotation(-math.pi*2*f/48,4,'Z')@rigid@m
  stage.render_to(out/f'{mode}-{f}.png')
assert before==mesh_digest(objs)
(out/'report.json').write_text(json.dumps({'mesh_unchanged':True,'mesh_sha256':before,'modes':['painted','flat','clay'],'facings':[0,24]},indent=2))
