"""Review checkpoint: untouched GLBs and whole-model rigid alignment only.

blender -b --factory-startup --python-exit-code 1 -P render_originals.py -- config.json
This separate review path cannot export or replace game atlases. It never calls the
legacy deformation, texture projection, symmetry, gauge, cutting or wheel stages.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import blender_stage as stage


def mesh_digest(meshes):
    digest = hashlib.sha256()
    for obj in meshes:
        for collection, name, size, dtype in (
            (obj.data.vertices, 'co', 3, np.float32),
            (obj.data.loops, 'vertex_index', 1, np.int32),
            (obj.data.polygons, 'normal', 3, np.float32),
        ):
            values = np.empty(len(collection) * size, dtype=dtype)
            collection.foreach_get(name, values)
            digest.update(values.tobytes())
        for uv in obj.data.uv_layers:
            values = np.empty(len(uv.data) * 2, np.float32)
            uv.data.foreach_get('uv', values)
            digest.update(values.tobytes())
    return digest.hexdigest()


def main(config):
    root = Path(config['output'])
    root.mkdir(parents=True, exist_ok=True)
    for engine_id in config['ids']:
        src = Path(config['raw']) / f'{engine_id}.glb'
        source_hash = hashlib.sha256(src.read_bytes()).hexdigest()
        job = json.loads((Path(config['jobs']) / f'{engine_id}.json').read_text())
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(src))
        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        if not meshes:
            raise RuntimeError(f'No meshes: {src}')
        original = {o: o.matrix_world.copy() for o in meshes}
        # Detaching parents preserves the imported world pose; no vertex or normal edits.
        for obj, matrix in original.items():
            obj.parent = None
            obj.matrix_world = matrix
        before = mesh_digest(meshes)
        arrays = [stage.mesh_arrays(o, job['align']['sample_faces']) for o in meshes]
        points = np.concatenate([a[0] for a in arrays])
        normals = np.concatenate([a[1] for a in arrays])
        (yaw, pitch, roll), score = stage.manhattan_align(
            normals, job['align']['pitch_range'], job['align']['roll_range'])
        if score < job['align']['min_score']:
            raise RuntimeError(f'Uncertain rigid orientation for {engine_id}: {score}')
        rotation = stage.compose(yaw, pitch, roll)
        ext = np.ptp(points @ rotation.T, axis=0)
        candidates = [(abs((yaw + 90*k + 180) % 360 - 180), k) for k in range(4)
                      if ((ext[0] >= ext[1]) if k % 2 == 0 else (ext[1] >= ext[0]))]
        rotation = stage.rz(math.radians(90 * min(candidates)[1])) @ rotation
        # A candidate, not a silently accepted correction: one global orientation
        # fitted to original surface normals, without the old warped-mesh offsets.
        aligned = points @ rotation.T
        height = float(np.ptp(aligned[:, 2]))
        scale = float(job['asset']['height_m']) / height
        center = (aligned.min(0) + aligned.max(0)) / 2
        center[2] = aligned[:, 2].min()
        rigid = Matrix.Translation(Vector((-center * scale).tolist())) @ Matrix.Scale(scale, 4) @ Matrix(rotation.tolist()).to_4x4()
        singular_values = np.linalg.svd(np.array(rigid)[:3, :3], compute_uv=False)
        assert np.allclose(singular_values, scale, rtol=1e-6)
        report = {'id': engine_id, 'source_sha256': source_hash,
                  'mesh_sha256': before, 'orientation_score': score,
                  'rotation_degrees': {'yaw': yaw, 'pitch': pitch, 'roll': roll},
                  'uniform_scale': scale, 'rigid_matrix': [list(r) for r in rigid],
                  'material_policy': 'Original imported materials, unchanged; neutral scene lighting.',
                  'candidate_limit': 'Whole-model normal-based alignment only; wheel stance and nose direction need owner review.',
                  'renders': []}
        settings = dict(job['render'], samples=16)
        stage.setup_render(settings, 900, 620)
        stage.add_sun(settings)
        camera = stage.make_camera('review_game_camera')
        camera.rotation_euler = (math.radians(60), 0, math.radians(45))
        bpy.context.scene.camera = camera
        bpy.context.view_layer.update()
        axes = camera.matrix_world.to_3x3()
        right, up, back = axes.col[0], axes.col[1], axes.col[2]
        for mode, base in [('raw', Matrix.Identity(4)), ('rigid', rigid)]:
            # Camera framing is held constant across views; raw uses no model scale.
            base_points = points @ np.array(base)[:3, :3].T + np.array(base)[:3, 3]
            pivot = (base_points.min(0) + base_points.max(0)) / 2
            corners = []
            views = config.get('headings', [0, 45, 135, 225])
            for degrees in views:
                rotated = (base_points - pivot) @ stage.rz(math.radians(-degrees)).T
                corners.append(rotated)
            # The projected shape need not be centred on the 3D box centre.
            # Symmetric extents avoid clipping a projecting buffer or tender corner.
            max_w = 2 * max(np.abs(p @ np.array(right)).max() for p in corners)
            max_h = 2 * max(np.abs(p @ np.array(up)).max() for p in corners)
            camera.data.ortho_scale = max(float(max_w), float(max_h)*900/620)*1.12
            camera.location = Vector(pivot.tolist()) + back * 1000
            for degrees in views:
                turn = Matrix.Translation(Vector(pivot.tolist())) @ Matrix.Rotation(math.radians(-degrees), 4, 'Z') @ Matrix.Translation(Vector((-pivot).tolist()))
                for obj, imported in original.items():
                    obj.matrix_world = turn @ base @ imported
                target = root / f'{engine_id}-{mode}-{degrees:03d}.png'
                stage.render_to(target)
                report['renders'].append({'mode': mode, 'heading': degrees, 'file': target.name})
        assert before == mesh_digest(meshes), 'The review path modified the mesh'
        assert hashlib.sha256(src.read_bytes()).hexdigest() == source_hash
        report['mesh_unchanged'] = True
        (root / f'{engine_id}.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(f'[originals] {engine_id}: geometry and source verified unchanged', flush=True)


if __name__ == '__main__':
    main(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8')))
