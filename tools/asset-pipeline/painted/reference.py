"""Reference-first input boundary. No runtime content is a geometry input."""
import copy
from pathlib import Path
import sys

# Appended, not prepended: tools/asset-pipeline also holds the ComfyUI pipeline's run.py.
if str(Path(__file__).resolve().parent.parent) not in sys.path:
    sys.path.append(str(Path(__file__).resolve().parent.parent))
from filehash import digest  # noqa: E402


def rail_half_m(gauge, tile=6.235064799811727):
    """Owner-approved 2026-10-08: standard 0.24 tile, narrow 0.16 tile."""
    if gauge not in ('standard', 'narrow'):
        raise ValueError('Gauge must be standard or narrow')
    return tile * (.08 if gauge == 'narrow' else .12)


def sha(path):
    """Line-ending independent SHA-256 (../filehash.py)."""
    return digest(path)


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
