"""Install a verified sprite bundle into a compatible game checkout.

Default is a plan only. --apply performs the explicit installation with backup.
"""
import argparse
import json
from pathlib import Path
import shutil
import tempfile
import re

from run import cached, write


def check_atlas_capacity(game, count):
    source = Path(game) / 'src/engine/atlas.ts'
    match = re.search(r'json\.pages!\s*<=\s*(\d+)', source.read_text()) if source.exists() else None
    capacity = int(match.group(1)) if match else 16
    if count > capacity:
        raise ValueError(f'Target atlas loader supports {capacity} pages, but this installation needs {count}; update its page limit first')


def install(bundle, game, apply=False):
    bundle, game = Path(bundle).resolve(), Path(game).resolve()
    receipt = json.loads((bundle / 'receipt.json').read_text())
    if not cached(bundle, receipt['key']):
        raise ValueError('Bundle is incomplete or modified')
    report = json.loads((bundle / 'report.json').read_text())
    if not report['complete']:
        raise ValueError('Sample bundles cannot be installed')
    inputs = json.loads((bundle / 'inputs.json').read_text())
    spec = inputs['manifest']
    fit_path = game / 'src/data/locoFit.json'
    fits = json.loads(fit_path.read_text())
    if spec['id'] not in fits:
        raise ValueError('Calibrate vehicle fit/body plan in the target game first')
    renderer = (game / 'src/render/trainRenderer.ts').read_text()
    if 'spriteFacings' not in renderer or 'integrated' not in renderer:
        raise ValueError('Target runtime lacks dense headings/integrated wheel support')
    assets = game / 'public/assets'
    first = json.loads((assets / 'rolling.json').read_text())
    count = first.get('pages', 1)
    existing = []
    owned = ['rolling/' + p['frame_prefix'] + '_' for p in spec['parts']]
    for i in range(1, count + 1):
        name = 'rolling' if i == 1 else f'rolling-{i}'
        path = assets / f'{name}.json'
        data = json.loads(path.read_text())
        # Remove only keys owned by the incoming parts, never another locomotive.
        data['frames'] = {k: v for k, v in data['frames'].items() if not any(k.startswith(p) for p in owned)}
        existing.append((name, data))
    # Reuse empty non-primary pages, so reruns do not grow the page count.
    slots = [i + 1 for i, (_, d) in enumerate(existing) if i > 0 and not d['frames']]
    allocation = []
    for page in report['pages']:
        slot = slots.pop(0) if slots else count + 1
        count = max(count, slot)
        allocation.append((page, f'rolling-{slot}'))
    plan = {'asset': spec['id'], 'game': str(game), 'pages': allocation,
            'owned_prefixes': owned, 'total_pages': count}
    check_atlas_capacity(game, count)
    if not apply:
        return plan
    backup = Path(tempfile.mkdtemp(prefix='painted-install-', dir=game / 'scratchpad'))
    originals = {}
    writes = {}
    for name, data in existing:
        writes[assets / f'{name}.json'] = (json.dumps(data, indent=2) + '\n').encode()
    for source, target in allocation:
        writes[assets / f'{target}.json'] = (bundle / 'atlas' / f'{source}.json').read_bytes()
        writes[assets / f'{target}.png'] = (bundle / 'atlas' / f'{source}.png').read_bytes()
    first = json.loads(writes[assets / 'rolling.json'])
    first['pages'] = count
    writes[assets / 'rolling.json'] = (json.dumps(first, indent=2) + '\n').encode()
    patch = json.loads((bundle / 'fit-patch.json').read_text())[spec['id']]
    fits[spec['id']].update(patch)
    writes[fit_path] = (json.dumps(fits, indent=2) + '\n').encode()
    for path in writes:
        originals[path] = path.read_bytes() if path.exists() else None
        if path.exists():
            target = backup / path.relative_to(game)
            target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(path, target)
    write(backup / 'plan.json', plan)
    try:
        for path, data in writes.items():
            temporary = path.with_suffix(path.suffix + '.painted-tmp')
            temporary.write_bytes(data); temporary.replace(path)
    except Exception:
        for path, data in originals.items():
            if data is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(data)
        raise
    plan['backup'] = str(backup)
    return plan


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--game', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(install(args.bundle, args.game, args.apply), indent=2))
