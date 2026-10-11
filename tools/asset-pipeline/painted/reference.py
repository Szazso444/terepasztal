"""Reference-first input boundary. No runtime content is a geometry input."""
import copy
import hashlib
import json
from pathlib import Path


def rail_half_m(gauge, tile=6.235064799811727):
    """Owner-approved 2026-10-08: standard 0.24 tile, narrow 0.16 tile."""
    if gauge not in ('standard', 'narrow'):
        raise ValueError('Gauge must be standard or narrow')
    return tile * (.08 if gauge == 'narrow' else .12)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def checked_file(record, base):
    path = (Path(base) / record['path']).resolve()
    if not path.is_file() or sha(path) != record['sha256']:
        raise ValueError(f'Reference input missing or changed: {path}')
    return str(path)


def validate_reference(reference, base, parts=None):
    if not reference or reference.get('schema') != 1:
        raise ValueError('A locked picture reference is required; legacy game jobs are not geometry sources')
    result = copy.deepcopy(reference)
    authority = result.get('authority')
    if authority == 'workbook-pictures-and-owner-notes':
        result['workbook']['path'] = checked_file(result['workbook'], base)
        if not result.get('sheet') or not isinstance(result.get('row'), int) or result['row'] < 1:
            raise ValueError('Specify workbook sheet and row')
    elif authority == 'png-pictures-and-owner-notes':
        result['observations']['path'] = checked_file(result['observations'], base)
        if any(Path(p['path']).suffix.lower() != '.png' for p in result.get('pictures', [])):
            raise ValueError('PNG-only recipes require locked PNG pictures')
    else:
        raise ValueError('Geometry authority must be locked pictures and owner notes')
    if not result.get('pictures') or not result.get('guidelines'):
        raise ValueError('Reference pictures and appearance guidelines are required')
    for record in result['pictures']:
        record['path'] = checked_file(record, base)
    if parts is not None:
        reviewed = result.get('prepared_sources', {})
        if reviewed != {p['name']: p['source_sha256'] for p in parts}:
            raise ValueError('Prepared geometry is not bound to this reference; review the changed model')
    return result


def build_job(config, base):
    """Construct from a reference specification, never overlay a legacy job.

    Camera projection annotations can be carried over after checking the source
    picture. Dimensions, splits and running gear must be authored from references.
    The allowlist prevents old fit/gear settings being inherited accidentally.
    """
    allowed = {'schema', 'id', 'reference', 'reconstruction', 'geometry', 'projection', 'output'}
    if set(config) - allowed or config.get('schema') != 1:
        raise ValueError('Use a reference preparation spec, not a legacy job or runtime fit')
    validate_reference(config['reference'], base)
    rec = config['reconstruction']
    if rec.get('kind') != 'image-reconstruction' or not rec.get('picture_match_review'):
        raise ValueError('Raw reconstruction needs a reviewed match to the workbook picture')
    glb = checked_file(rec['model'], base)
    if Path(glb).suffix.lower() != '.glb' or 'models_raw' not in Path(glb).parts:
        raise ValueError('Only original models_raw GLBs may enter reference preparation')
    source = checked_file(rec['conditioning_image'], base)
    mask = checked_file(rec['conditioning_mask'], base)
    g = config['geometry']
    if set(g) - {'length_m', 'width_m', 'height_m', 'plan', 'parts', 'gear', 'notes', 'yaw_offset_deg', 'gauge'}:
        raise ValueError('Unsupported geometry setting; deformation and game fitting are forbidden')
    if not g.get('notes') or not g.get('parts') or len(g['parts']) != len(g['gear']):
        raise ValueError('Reference-authored dimensions, part layout and running gear are required')
    for axis in ('length_m', 'width_m', 'height_m'):
        if not isinstance(g.get(axis), (int, float)) or g[axis] <= 0:
            raise ValueError('Positive reference dimensions are required')
    projection = config.get('projection', {})
    if set(projection) - {'annot', 'nose_px', 'views'}:
        raise ValueError('Only image-space annotations may be reused from previous jobs')
    locked_pictures = {str((Path(base) / p['path']).resolve()) for p in config['reference']['pictures']}
    views = [str((Path(base) / p).resolve()) for p in projection.get('views', [])]
    if any(p not in locked_pictures for p in views):
        raise ValueError('Every supplementary colour view must be hash-locked with the reference pictures')
    tile = 6.235064799811727
    return {
        'asset': {'id': config['id'], 'category': 'vehicle', 'image': source,
                  'size_tiles': g['length_m'] / tile, 'length_m': g['length_m'],
                  'width_m': g['width_m'], 'height_m': g['height_m'], 'align': 'auto',
                  'game_frame': '', 'yaw_offset_deg': g.get('yaw_offset_deg'),
                  'plan': g.get('plan'), 'split_m': [], 'clip_below_m': [],
                  'anchor_offset_m': 0, 'length_factor': None},
        'glb': glb,
        'grid': {'metre': 'human', 'human_px': 11, 'human_m': 1.75, 'tile_m': tile,
                 'tile_px': 64, 'elevation_deg': 30, 'azimuth_deg': 45},
        'render': {'engine': 'BLENDER_EEVEE', 'resolution': 2, 'shading': 'painted',
                   'ambient_level': .8, 'light_level': .4, 'light_cam': [-.5,.7,.5],
                   'samples': 32, 'supersample': 2, 'pad_px': 4, 'shadow': False,
                   'ambient': .6, 'sun_azimuth_deg': -100, 'sun_elevation_deg': 45, 'sun_strength': 3,
                   'force_dielectric': True, 'debug_views': False},
        'align': {'enabled': True, 'pitch_range': [-65,20], 'roll_range': [-25,25],
                  'sample_faces': 20000, 'min_score': .7},
        'class_cfg': {'dirs': 'game', 'coupler_gap_m': .4, 'compress_range': [.35,2],
                      'stretch_max': 1.25, 'shadow': False, 'width_follows_length': False,
                      'max_dim_error': .2},
        'landmarks': {'symmetric': False, **({'nose_px': projection['nose_px']} if 'nose_px' in projection else {})},
        'gear_parts': copy.deepcopy(g['parts']), 'gear_info': copy.deepcopy(g['gear']),
        'fit': {'standard': True, 'stance': 'support', 'stance_mode': 'turn', 'reference_axles': True,
                'length_m': g['length_m'], 'height_m': g['height_m'],
                'rail_half_m': rail_half_m(g.get('gauge', 'standard'), tile), 'deperspective': 0, 'gauge_warp': False, 'box_body': False},
        'annot': copy.deepcopy(projection.get('annot', {})),
        'source': {'image': source, 'mask': mask},
        'source_cfg': {'enabled': True, 'min_iou': .8, 'mask_erode_px': 3,
                       'depth_tol': .012, 'facing_ramp': [.12,.4]},
        'views': views, 'parts': {},
    }
