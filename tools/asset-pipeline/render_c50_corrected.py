"""Owner-requested C-50 part widths and integrated rotating wheels.

The imported source is never overwritten. This derived model explicitly changes
part widths, unlike the unmodified rigid inspection path. Each exported image is
one complete render, so body and animated wheels cannot be misregistered layers.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import blender_stage as stage
import running_gear as gear
from render_originals import mesh_digest
from c50_proportions import correct_widths


def wheel_ring(name, x, side, materials):
    # Original wheel centres/radii measured in the aligned side view. Only the
    # annulus rotates; the red axlebox and central hub remain fixed to the chassis.
    verts, faces, colors = [], [], []
    n, yc = 64, side*.57
    radii=[.11,.29,.36,.43]
    for yy in [yc-side*.065, yc+side*.065]:
        for radius in radii:
            for i in range(n):
                a=2*math.pi*i/n
                verts.append((radius*math.cos(a), yy-yc, radius*math.sin(a)))
    for i in range(n):
        j=(i+1)%n
        for plane in [0,4*n]:
            for band in range(3):
                a=plane+band*n;b=a+n
                faces.append((a+i,a+j,b+j,b+i))
                colors.append((1 if i%16 < 5 else 0) if band==0 else (3 if band==1 else 2))
        faces.append((3*n+i,3*n+j,7*n+j,7*n+i));colors.append(2)
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    for mat in materials:mesh.materials.append(mat)
    for poly,index in zip(mesh.polygons,colors):poly.material_index=index
    obj.location=(x,yc,.475)
    return obj


def main(cfg):
    out=Path(cfg['output']);out.mkdir(parents=True,exist_ok=True)
    pilot=json.loads(Path(cfg['pilot_meta']).read_text())
    src=Path(cfg['glb']);source_hash=hashlib.sha256(src.read_bytes()).hexdigest()
    assert source_hash == pilot['source_sha256']
    job=json.loads(Path(cfg['job']).read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(src))
    objs=[o for o in bpy.context.scene.objects if o.type=='MESH']
    assert len(objs)==1
    obj=objs[0];before=mesh_digest(objs)
    assert before==pilot['mesh_sha256']
    world=Matrix(pilot['rigid_matrix'])@obj.matrix_world
    p=np.array([world@v.co for v in obj.data.vertices])
    corrected, report=correct_widths(p)
    # Bake the reviewed whole-model transform into this derived mesh only.
    obj.parent=None;obj.matrix_world=Matrix.Identity(4)
    obj.data.vertices.foreach_set('co',corrected.astype(np.float32).ravel());obj.data.update()
    # Remove the old lower wheel faces once. Rebuild round rings and fixed
    # axleboxes at the measured centres; retain the floor and widened deck.
    bm=bmesh.new();bm.from_mesh(obj.data)
    remove=[]
    for face in bm.faces:
        c=face.calc_center_median();x,y,z=c
        radial=min(math.hypot(x-xc,z-.475) for xc in [-.915,.535])
        if radial < .47 and abs(y)>.34 and z<.715:
            remove.append(face)
    bmesh.ops.delete(bm,geom=remove,context='FACES');bm.to_mesh(obj.data);bm.free();obj.data.update()
    shading=stage.painted_shading(job['grid'],job['render'])
    texture=bpy.data.images.load(str(Path(cfg['texture'])))
    mat=gear.shaded_material('accepted_source_paint',shading,image=texture)
    for slot in obj.material_slots:slot.material=mat
    mats=[gear.shaded_material('wheel_face',shading,color=(.19,.20,.19)),
          gear.shaded_material('wheel_radial_highlight',shading,color=(.39,.40,.37)),
          gear.shaded_material('wheel_tread',shading,color=(.14,.15,.14)),
          gear.shaded_material('wheel_rim',shading,color=(.62,.63,.59))]
    wheels=[wheel_ring(f'wheel_{i}_{side}',x,side,mats) for i,x in enumerate([-.915,.535]) for side in [-1,1]]
    wheel_locations={o:o.location.copy() for o in wheels}
    fixed=[]
    axle_mat=gear.shaded_material('stationary_axlebox',shading,color=(.78,.075,.025))
    for x in [-.915,.535]:
        for side in [-1,1]:
            bpy.ops.mesh.primitive_cube_add(size=1,location=(x,side*.66,.475))
            axle=bpy.context.object;axle.name='stationary_axlebox';axle.scale=(.21,.10,.21)
            bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
            axle.data.materials.append(axle_mat)
            bevel=axle.modifiers.new('edge_highlight','BEVEL');bevel.width=.018;bevel.segments=2
            fixed.append((axle,axle.matrix_world.copy()))
    resolution,supersample,canvas=4,2,256
    stage.setup_render(dict(job['render'],samples=8,engine=cfg.get('engine','CYCLES')),canvas*supersample,canvas*supersample)
    camera=stage.make_camera('game_camera');camera.rotation_euler=(math.radians(60),0,math.radians(45))
    bpy.context.scene.camera=camera;bpy.context.view_layer.update()
    k=64/(job['grid']['tile_m']*math.sqrt(2))*resolution
    camera.data.ortho_scale=canvas/k;camera.location=camera.matrix_world.to_3x3().col[2]*1000
    frames=[]
    facings=cfg.get('facings',list(range(96)))
    phases=cfg.get('phases',list(range(8)))
    for f in facings:
        turn=Matrix.Rotation(-2*math.pi*f/96,4,'Z');obj.matrix_world=turn
        for ob,matrix in fixed:ob.matrix_world=turn@matrix
        for phase in phases:
            for wheel,location in wheel_locations.items():
                wheel.matrix_world=turn@Matrix.Translation(location)@Matrix.Rotation(phase*math.pi/16,4,'Y')
            name=f'loco_c50_body_w{phase}_f{f}.png'
            if not (cfg.get('resume') and (out/name).exists()):
                stage.render_to(out/name)
            frames.append(name)
        print(f'[corrected] facing {f}/95 complete',flush=True)
    assert source_hash==hashlib.sha256(src.read_bytes()).hexdigest()
    meta=dict(id='c50',source_sha256=source_hash,mesh_sha256=before,
              derived_mesh_sha256=mesh_digest([obj]),mesh_unchanged=False,source_unchanged=True,
              authorized_corrections=report,facings=96,phases=8,wheel_radius_m=.43,
              wheel_cycle_tiles=2*math.pi*.43/job['grid']['tile_m']/4,
              resolution=resolution,supersample=supersample,anchor={'ax':128,'ay':128},frames=frames)
    (out/cfg.get('metadata','meta.json')).write_text(json.dumps(meta,indent=2),encoding='utf-8')
    if cfg.get('save_blend'):
        bpy.ops.wm.save_as_mainfile(filepath=str(out.parent/'c50-corrected.blend'))


if __name__=='__main__':
    main(json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf-8')))
