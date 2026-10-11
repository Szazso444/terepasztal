"""Internal scene exporter for prepare_reference.py.

The historical command accepting game-calibrated jobs is deliberately disabled.
Original GLBs, textures and game files are never edited during preparation.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import blender_stage as stage


def principled(material):
    """Recover the colour input, without the legacy baked lighting multiplier."""
    if not material or not material.use_nodes:
        raise ValueError('Expected a node paint material')
    image = next((n.image for n in material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)
    rgb = next((tuple(n.outputs[0].default_value) for n in material.node_tree.nodes if n.type == 'RGB'), None)
    bsdf = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if rgb is None:
        rgb = tuple(bsdf.inputs['Base Color'].default_value) if bsdf else (.025, .025, .03, 1)
    result = bpy.data.materials.new(material.name + ' / prepared paint')
    result.use_nodes = True
    p = result.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = rgb
    p.inputs['Roughness'].default_value = .78
    if image:
        image.pack()
        texture = result.node_tree.nodes.new('ShaderNodeTexImage'); texture.image = image
        result.node_tree.links.new(texture.outputs['Color'], p.inputs['Base Color'])
    return result


def main(config, *, reference_job=None):
    if reference_job is None:
        raise ValueError('Legacy game-calibrated jobs are disabled. Use prepare_reference.py with workbook picture references.')
    output = Path(config['output']).resolve(); output.mkdir(parents=True, exist_ok=True)
    job = reference_job
    identity = job['asset']['id']
    job['render']['debug_views'] = False
    job['render']['engine'] = 'BLENDER_EEVEE'
    for key in ['sprites_raw_dir', 'debug_dir']:
        job[key] = str(output / key); Path(job[key]).mkdir(exist_ok=True)
    job['meta_path'] = str(output / 'unused-legacy-meta.json')
    if job.get('source'):
        job['source']['texture'] = str(output / 'prepared-texture.png')
    local_job = output / 'preparation-job.json'
    local_job.write_text(json.dumps(job, indent=2))
    # The stage builds geometry; intercept before any sprite render or export.
    old_cycle = stage.wheel_cycle
    def eight_phases(*args, **kwargs):
        _, total, share, cycle = old_cycle(*args, **kwargs)
        return 8, total, share, cycle
    stage.wheel_cycle = eight_phases
    old_bogie = stage.running_gear.bogie
    def recorded_bogie(name, spec, *args, **kwargs):
        obj = old_bogie(name, spec, *args, **kwargs)
        obj['painted_axles'] = json.dumps([
            {'x_m': a['x'] * spec.get('x_scale', 1) + spec.get('offset_m', 0),
             'd_m': a.get('d_f', a.get('d', 0) * spec.get('scale', 1))}
            for a in spec.get('axles', [])])
        return obj
    stage.running_gear.bogie = recorded_bogie

    def capture(job, renders, *unused):
        (output / 'calibration.json').write_text(json.dumps([
            {**{key: rd.get(key) for key in ['part', 'tiles', 'footprint_m', 'gear']},
             'axles': json.loads(rd['wheels']['objs'][0].get('painted_axles', '[]')) if rd.get('wheels') else []}
            for rd in renders], indent=2), encoding='utf-8')
        if config.get('masks_only'):
            (output / 'calibration.json').write_text(json.dumps([
                {**{key: rd.get(key) for key in ['part', 'tiles', 'footprint_m', 'gear']},
                 'axles': json.loads(rd['wheels']['objs'][0].get('painted_axles', '[]')) if rd.get('wheels') else []}
                for rd in renders], indent=2), encoding='utf-8')
            manifest_path = output / 'candidate.json'
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            by_name = {p['name']: p for p in manifest['parts']}
            for rd in renders:
                if not rd.get('lit'):
                    continue
                image = next(n.image for n in rd['lit'].node_tree.nodes if n.type == 'TEX_IMAGE')
                path = output / 'window-mask.png'
                image.save_render(str(path))
                part = by_name[rd['part'] or 'body']
                part['window_mask'] = {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
            raise SystemExit(0)
        parts = []
        for rd in renders:
            name = rd['part'] or 'body'
            scene = bpy.data.scenes.new(f'Prepared {identity} {name}')
            objects = [(rd['ob'], rd['M'], None)] + [(o, m, None) for o, m in rd.get('extras', [])]
            wheel = rd.get('wheels')
            if wheel:
                objects += [(o, Matrix.Identity(4), phase) for phase, o in enumerate(wheel['objs'])]
            materials = {}
            for index, (source, matrix, phase) in enumerate(objects):
                obj = source.copy(); obj.data = source.data.copy()
                obj.animation_data_clear(); obj.parent = None
                obj.matrix_world = matrix.copy(); obj.hide_render = False; obj.hide_viewport = False
                scene.collection.objects.link(obj)
                # Bake the calibrated matrix into the mesh; all parts retain their
                # own ground/attachment origin and the same metres-to-pixels scale.
                obj.data.transform(obj.matrix_world); obj.matrix_world = Matrix.Identity(4)
                for slot in obj.material_slots:
                    if slot.material not in materials:
                        materials[slot.material] = principled(slot.material)
                    slot.material = materials[slot.material]
                if phase is not None:
                    for frame in range(1, 10):
                        obj.hide_render = (frame - 1) % 8 != phase
                        obj.keyframe_insert(data_path='hide_render', frame=frame)
                    obj.hide_render = phase != 0
            scene.frame_set(1)
            path = output / f'{name}.blend'
            bpy.data.libraries.write(str(path), {scene}, fake_user=True, compress=True)
            # Report dimensions separately from the runtime footprint. No new
            # fitting/deformation is introduced by the common sprite renderer.
            xs = [v.co.x for o in scene.objects if o.type == 'MESH' and not o.hide_render for v in o.data.vertices]
            length = max(xs) - min(xs)
            part = {'name': name, 'source': str(path), 'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    'frame_prefix': f'loco_{identity}_{name}', 'length_tiles': length / job['grid']['tile_m'],
                    'canvas': 512, 'effects': rd.get('anchors') or {}}
            if wheel:
                part['wheel'] = {'mode': 'timeline', 'start': 1, 'period_frames': 8,
                                 'radius': wheel['cycle_m'] / math.tau, 'symmetry': 1}
                part['max_phase_bounds_drift'] = 2
            if rd.get('lit'):
                image = next(n.image for n in rd['lit'].node_tree.nodes if n.type == 'TEX_IMAGE')
                mask_path = output / f'{name}-window-mask.png'
                image.save_render(str(mask_path))
                part['window_mask'] = {'path': str(mask_path), 'sha256': hashlib.sha256(mask_path.read_bytes()).hexdigest()}
            parts.append(part)
        manifest = {'schema': 1, 'id': identity,
                    'profile': str(HERE / 'profiles/fleet-reference-v2.json'), 'parts': parts,
                    'reference': {**config['reference'], 'prepared_sources': {p['name']: p['source_sha256'] for p in parts}}}
        (output / 'candidate.json').write_text(json.dumps(manifest, indent=2))
        (output / 'provenance.json').write_text(json.dumps({'status': 'candidate, needs visual geometry review',
            'reference': config['reference'], 'preparation_job_sha256': hashlib.sha256(local_job.read_bytes()).hexdigest(),
            'glb': job['glb'], 'glb_sha256': hashlib.sha256(Path(job['glb']).read_bytes()).hexdigest()}, indent=2))
        print(f'Prepared {identity}: {len(parts)} candidate parts', flush=True)
        raise SystemExit(0)

    stage.render_sets = capture
    np.random.seed(0)
    sys.argv = ['prepare_existing.py', '--', str(local_job)]
    stage.main()


if __name__ == '__main__':
    main(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text()))
