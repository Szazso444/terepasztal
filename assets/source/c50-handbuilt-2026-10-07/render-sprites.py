"""Render the accepted editable C-50 into complete, aligned game frames."""
import bpy, math, json, sys, hashlib, struct
from pathlib import Path
from mathutils import Matrix, Vector
ROOT=Path(__file__).parent
sys.path.insert(0,str(ROOT.parents[2]/'tools/asset-pipeline'))
import running_gear as gear
import blender_stage as stage
cfg=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text())
source=ROOT/'c50-handbuilt.blend'
bpy.ops.wm.open_mainfile(filepath=str(source))
scene=bpy.context.scene
job=json.loads(Path('G:/DEV/Terepasztal/pipeline-out-std/jobs/c50.json').read_text())
tile=job['grid']['tile_m']
meshes=[o for o in scene.objects if o.type=='MESH']
points=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
scale=.8239*tile/(max(p.x for p in points)-min(p.x for p in points))
root=bpy.data.objects.new('Game heading',None);scene.collection.objects.link(root)
for o in list(scene.objects):
    if o.type in ['MESH','EMPTY'] and o!=root and o.parent is None:
        m=o.matrix_world.copy();o.parent=root;o.matrix_world=m
root.scale=(scale,)*3
wheel_pivots=[o for o in scene.objects if o.name.startswith('Wheel pivot')]
assert len(wheel_pivots)==4
# Keep the accepted sculpted paint materials; use a camera-relative studio rig.
# This supplies contact shading and bevel highlights missing from flat emission.
# Matte painted surfaces, warm contact shadows and subtle broad paint variation.
for material in bpy.data.materials:
    if not material.use_nodes: continue
    nodes=material.node_tree.nodes; links=material.node_tree.links
    bsdf=nodes.get('Principled BSDF')
    if bsdf is None: continue
    base=tuple(bsdf.inputs['Base Color'].default_value)
    bsdf.inputs['Roughness'].default_value=.78
    bsdf.inputs['Metallic'].default_value=min(bsdf.inputs['Metallic'].default_value,.18)
    bsdf.inputs['Specular IOR Level'].default_value=.22
    bsdf.inputs['Emission Strength'].default_value=0
    noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=7
    noise.inputs['Detail'].default_value=2;noise.inputs['Roughness'].default_value=.6
    ramp=nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color=tuple(v*.78 for v in base[:3])+(1,)
    ramp.color_ramp.elements[1].color=base
    links.new(noise.outputs['Fac'],ramp.inputs['Fac'])
    ao=nodes.new('ShaderNodeAmbientOcclusion');ao.inputs['Distance'].default_value=.28
    tint=nodes.new('ShaderNodeMixRGB');tint.blend_type='MULTIPLY';tint.inputs[0].default_value=.48
    links.new(ramp.outputs['Color'],tint.inputs[1]);links.new(ao.outputs['Color'],tint.inputs[2])
    links.new(tint.outputs[0],bsdf.inputs['Base Color'])
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
scene.render.engine=cfg.get('engine','CYCLES');scene.cycles.samples=8;scene.cycles.use_denoising=cfg.get('denoise',True)
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='CUDA';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='CUDA'
scene.cycles.device='GPU'
scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100
scene.render.film_transparent=True
camera=scene.camera;camera.data.type='ORTHO'
camera.rotation_euler=(math.radians(60),0,math.radians(45));bpy.context.view_layer.update()
camera.location=camera.matrix_world.to_3x3().col[2]*20
camera.data.clip_start=.1;camera.data.clip_end=100
radius=max(p.length for p in points)*scale
assert 20-radius>camera.data.clip_start and 20+radius<camera.data.clip_end
camera.data.ortho_scale=256/(64/(tile*math.sqrt(2))*4)
axes=camera.matrix_world.to_3x3()
for obj,local in zip([o for o in scene.objects if o.type=='LIGHT'],[(-4,5,6),(4,2,5),(0,6,-4)]):
    obj.data.energy *= [1.0,.38,.28][list(o for o in scene.objects if o.type=='LIGHT').index(obj)]
    obj.data.color=(1.0,.91,.77)
    obj.location=axes@Vector(local)+Vector((0,0,1.2))
    obj.rotation_euler=(Vector((0,0,1.2))-obj.location).to_track_quat('-Z','Y').to_euler()
out=Path(cfg['output']);out.mkdir(parents=True,exist_ok=True)
frames=[]
for f in cfg.get('facings',list(range(96))):
    root.rotation_euler.z=-math.tau*f/96
    for phase in cfg.get('phases',list(range(8))):
        # Five equally-spaced disc recesses: one repeated cycle spans 72 degrees.
        for pivot in wheel_pivots:pivot.rotation_euler.y=phase*math.tau/40
        name=f'loco_c50_body_w{phase}_f{f}.png';frames.append(name)
        existing=out/name
        if cfg.get('resume') and existing.exists() and struct.unpack('>II',existing.read_bytes()[16:24])==(512,512):
            continue
        scene.render.filepath=str(out/name);bpy.ops.render.render(write_still=True)
    print(f'[handbuilt] {f}/95',flush=True)
meta={'id':'c50','kind':'handbuilt','source_unchanged':True,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
 'shading':'matte-warm-ao-v1','engine':scene.render.engine,'camera_depth_checked':True,
 'facings':96,'phases':8,'wheel_cycle_tiles':math.tau*.43*scale/tile/5,'uniform_scale':scale,
 'resolution':4,'supersample':2,'anchor':{'ax':128,'ay':128},'frames':frames,
 'fit_effects':{'smoke':[{'part':'body','along':1.18*scale/tile,'up':2.42*scale*64/(tile*math.sqrt(2))*math.cos(math.pi/6)}],
 'lamps':[{'part':'body','along':2.30*scale/tile,'across':y*scale/tile,'up':1.91*scale*64/(tile*math.sqrt(2))*math.cos(math.pi/6)} for y in [-.63,.63]]}}
(out/cfg.get('metadata','meta.json')).write_text(json.dumps(meta,indent=2))
