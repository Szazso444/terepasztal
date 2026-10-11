"""Blender entry point: -- reference-spec.json (never a game calibration job)."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reference import build_job, validate_reference
from prepare_existing import main

if __name__ == '__main__':
    if '--historical-image-reconstruction' not in sys.argv:
        raise SystemExit('Owner workflow changed 2026-10-08: build fresh geometry by the handbuilt C-50 method. This image-reconstruction entry point is historical; explicit --historical-image-reconstruction is required for reproducing old work only.')
    path = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
    config = json.loads(path.read_text(encoding='utf-8'))
    # An explicitly authored front direction takes precedence over an older
    # image-space nose annotation (Mk48 runs short-hood first in the workbook).
    if config.get('geometry', {}).get('yaw_offset_deg') is not None:
        config.get('projection', {}).pop('nose_px', None)
    job = build_job(config, path.parent)
    main({'output': str((path.parent / config['output']).resolve()),
          'reference': validate_reference(config['reference'], path.parent)}, reference_job=job)
