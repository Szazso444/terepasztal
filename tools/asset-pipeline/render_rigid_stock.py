"""Render a reviewed rigid transform of an original GLB, without mesh edits.

Blender entry point. The checkpoint supplies the reviewed orientation; one uniform
scale fits the existing longitudinal footprint. Original wheels stay in the body.
Produces raw frames and metadata; export_rigid_stock.py handles game delivery.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).parent))
import blender_stage as stage
import source_texture
import running_gear
from render_originals import mesh_digest


def main(cfg):
    checkpoint = json.loads(Path(cfg['checkpoint']).read_text())
    src = Path(cfg['glb'])
    source_hash = hashlib.sha256(src.read_bytes()).hexdigest()
    assert source_hash == checkpoint['source_sha256'], 'Original GLB changed'
    job = json.loads(Path(cfg['job']).read_text())
    out = Path(cfg['output'])
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(src))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    imported = {o: o.matrix_world.copy() for o in meshes}
    for obj, matrix in imported.items():
        obj.parent = None
        obj.matrix_world = matrix
    before = mesh_digest(meshes)
    style_report = None
    if cfg.get('style') == 'source-painted':
        # Only the original conditioning view has a direct geometric correspondence.
        # Hidden surfaces keep their own details, with a learned colour transfer;
        # never project a separately generated rear cabin onto the hood.
        if len(meshes) != 1:
            raise RuntimeError('Source-painted pilot requires one textured mesh')
        obj = meshes[0]
        source_cfg = dict(job['source_cfg'], hidden='transfer')
        view = source_texture.fit_view(stage.surface_points(obj, 3000000),
                                       job['source']['image'], job['source']['mask'], source_cfg)
        style_report = source_texture.reproject(obj, view, out / 'source-colour.png',
                                                source_cfg, mirror=None, extras=())
        running_gear.repaint(obj, stage.painted_shading(job['grid'], job['render']))
    rigid = Matrix(checkpoint['rigid_matrix'])
    points = np.concatenate([stage.mesh_arrays(o, job['align']['sample_faces'])[0] for o in meshes])
    transformed = points @ np.array(rigid)[:3, :3].T + np.array(rigid)[:3, 3]
    target = cfg['length_tiles'] * job['grid']['tile_m']
    rigid = Matrix.Scale(target / float(np.ptp(transformed[:, 0])), 4) @ rigid
    scales = np.linalg.svd(np.array(rigid)[:3, :3], compute_uv=False)
    assert np.allclose(scales, scales[0], rtol=1e-6), 'Nonuniform scale'
    resolution, supersample, canvas = 4, 2, 256
    settings = dict(job['render'], samples=16)
    stage.setup_render(settings, canvas * supersample, canvas * supersample)
    stage.add_sun(settings)
    camera = stage.make_camera('rigid_stock_camera')
    camera.rotation_euler = (math.radians(60), 0, math.radians(45))
    bpy.context.scene.camera = camera
    bpy.context.view_layer.update()
    k = 64 / (job['grid']['tile_m'] * math.sqrt(2)) * resolution
    camera.data.ortho_scale = canvas / k
    camera.location = camera.matrix_world.to_3x3().col[2] * 1000
    frames = []
    for f in range(48):
        turn = Matrix.Rotation(-2 * math.pi * f / 48, 4, 'Z')
        for obj, matrix in imported.items():
            obj.matrix_world = turn @ rigid @ matrix
        name = f'loco_{cfg["id"]}_body_f{f}.png'
        stage.render_to(out / name)
        frames.append(name)
    assert before == mesh_digest(meshes), 'Mesh or UVs changed'
    assert source_hash == hashlib.sha256(src.read_bytes()).hexdigest()
    meta = dict(id=cfg['id'], source_sha256=source_hash, mesh_sha256=before,
                mesh_unchanged=True, rigid_matrix=[list(r) for r in rigid],
                resolution=resolution, supersample=supersample,
                anchor={'ax': canvas / 2, 'ay': canvas / 2}, frames=frames,
                style=cfg.get('style', 'original'), style_report=style_report,
                policy='Original mesh and UVs. Whole-object rigid transform and uniform scale only. '
                       'Source-painted style uses the conditioning image on visible surfaces, colour transfer '
                       'on hidden surfaces and painted shading; original mode preserves imported materials.')
    (out / 'meta.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8')))
