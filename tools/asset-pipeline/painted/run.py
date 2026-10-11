"""Reproducible approved-model -> painted sprites -> bounded atlas bundles.

No generative stage and no writes to the game checkout. See README.md.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw
from reference import validate_reference

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def effect_points(part, kind):
    """Accept reconstruction's headlamps without falling back to generic lights."""
    effects = part.get('effects', {})
    if kind == 'lamps':
        return effects.get('lamps', effects.get('headlamps', []))
    return effects.get(kind, [])


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def load_manifest(path):
    path = Path(path).resolve()
    spec = json.loads(path.read_text(encoding='utf-8'))
    if spec.get('schema') != 1 or not re.fullmatch('[a-z0-9_]+', spec.get('id', '')):
        raise ValueError('Invalid manifest schema/id')
    profile_path = (path.parent / spec['profile']).resolve()
    profile = json.loads(profile_path.read_text())
    if profile['schema'] != 1 or profile['facings'] != 96 or profile['phases'] != 8:
        raise ValueError('Expected 96 headings and 8 wheel phases for this runtime contract')
    if not spec['parts']:
        raise ValueError('At least one prepared model part is required')
    validate_reference(spec.get('reference'), path.parent, spec['parts'])
    names, prefixes = set(), set()
    for part in spec['parts']:
        if not re.fullmatch(r'[a-z0-9_]+(?:-t[0-9]+)?', part['name']):
            raise ValueError('Part name must be a body part or its numbered truck')
        if part['name'] in names or part['frame_prefix'] in prefixes:
            raise ValueError('Duplicate part name/frame ownership')
        names.add(part['name']); prefixes.add(part['frame_prefix'])
        expected = f"loco_{spec['id']}_{part['name']}"
        if part['frame_prefix'] != expected and not re.fullmatch(r'bogie_[a-z0-9_]+', part['frame_prefix']):
            raise ValueError(f'Invalid runtime frame prefix: {part["frame_prefix"]}')
        source = (path.parent / part['source']).resolve()
        if source.suffix != '.blend' or not source.is_file():
            raise ValueError(f'Missing prepared blend: {source}')
        if digest(source) != part['source_sha256']:
            raise ValueError(f'Source hash changed: {source}; review it before updating the manifest')
        part['source'] = str(source)
        if part.get('window_mask'):
            mask = (path.parent / part['window_mask']['path']).resolve()
            if not mask.is_file() or digest(mask) != part['window_mask']['sha256']:
                raise ValueError('Window mask hash changed')
            part['window_mask']['path'] = str(mask)
        if not math.isfinite(part['length_tiles']) or part['length_tiles'] <= 0:
            raise ValueError('length_tiles must be positive')
        if type(part['canvas']) != int or not 64 <= part['canvas'] <= 2048:
            raise ValueError('canvas must be an integer from 64 to 2048')
        wheel = part.get('wheel')
        if wheel:
            if wheel['mode'] not in {'pivots', 'timeline'} or wheel['radius'] <= 0 or type(wheel['symmetry']) != int or wheel['symmetry'] < 1:
                raise ValueError('Invalid wheel animation contract')
            if wheel['mode'] == 'pivots' and (not wheel['prefix'] or wheel['count'] < 1):
                raise ValueError('Specify wheel pivot prefix and count')
            if wheel['mode'] == 'timeline' and wheel['period_frames'] <= 0:
                raise ValueError('Timeline wheel cycle needs positive period_frames')
            if part['frame_prefix'].startswith('bogie_'):
                raise ValueError('Animated separate bogie frames need a runtime adapter; use static bogies or integrated wheels')
    return spec, profile


def signature(spec, profile, blender):
    version = subprocess.check_output([blender, '--version'], text=True)
    data = {'manifest': spec, 'profile': profile, 'blender': version,
            'renderer': digest(HERE / 'render.py'), 'runner': digest(__file__),
            'reference_validator': digest(HERE / 'reference.py'),
            'packer': digest(HERE.parent.parent / 'pack-atlas.mjs')}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest(), data


def cached(out, key):
    path = out / 'receipt.json'
    if not path.exists():
        return False
    receipt = json.loads(path.read_text())
    return receipt['key'] == key and bool(receipt['files']) and all(
        (out / name).is_file() and digest(out / name) == sha for name, sha in receipt['files'].items())


def blender_render(blender, job, directory):
    job['output'] = str(directory.resolve())
    path = directory.parent / (directory.name + '-job.json')
    write(path, job)
    with path.with_suffix('.log').open('w', encoding='utf-8') as log:
        subprocess.run([blender, '-b', '--factory-startup', '--python-exit-code', '1',
                        '--python', str(HERE / 'render.py'), '--', str(path)], stdout=log,
                       stderr=subprocess.STDOUT, check=True)
    return json.loads((directory / 'meta.json').read_text())


def pack(frames, destination, resolution):
    """Deterministic shelf packing with both dimensions capped at 4096."""
    items = []
    for path in sorted(frames.glob('*.png')):
        with Image.open(path) as image:
            box = image.getbbox()
            items.append((path, box, image.width / 2, image.height / 2))
    items.sort(key=lambda item: (-(item[1][3] - item[1][1]), item[0].name))
    pages, table, shared = [], {}, {}
    sheet = Image.new('RGBA', (4096, 4096))
    x = y = 2; height = 0; used_x = used_y = 1

    def flush():
        index = len(pages) + 1
        name = f'rolling-painted-{index}'
        sheet.crop((0, 0, used_x, used_y)).save(destination / (name + '.png'))
        write(destination / (name + '.json'), {'resolution': resolution, 'partial': True, 'frames': table})
        pages.append(name)

    destination.mkdir(parents=True, exist_ok=True)
    for path, box, ax, ay in items:
        w, h = box[2] - box[0], box[3] - box[1]
        with Image.open(path) as image:
            crop = image.crop(box)
        identity = (w, h, ax - box[0], ay - box[1], hashlib.sha256(crop.tobytes()).digest())
        if identity in shared:
            table['rolling/' + path.stem] = shared[identity]
            continue
        if max(w, h) > 4092:
            raise ValueError('A frame exceeds the atlas page limit')
        if x + w + 2 > 4096:
            x = 2; y += height + 2; height = 0
        if y + h + 2 > 4096:
            flush(); table = {}; shared = {}; sheet = Image.new('RGBA', (4096, 4096))
            x = y = 2; height = 0; used_x = used_y = 1
        sheet.paste(crop, (x, y))
        table['rolling/' + path.stem] = {'x': x, 'y': y, 'w': w, 'h': h, 'ax': ax - box[0], 'ay': ay - box[1]}
        shared[identity] = table['rolling/' + path.stem]
        x += w + 2; height = max(height, h)
        used_x = max(used_x, x); used_y = max(used_y, y + h + 2)
    if table:
        flush()
    return pages


def build(manifest, blender, out, force=False, verify=False, sample=False):
    spec, profile = load_manifest(manifest)
    key, inputs = signature(spec, profile, blender)
    # Sample runs are isolated and never eligible for installation.
    key = hashlib.sha256((key + str(sample)).encode()).hexdigest()
    out = Path(out).resolve() / spec['id'] / key[:16]
    if cached(out, key) and not force and not verify:
        print(f'{spec["id"]}: verified cache {out}', flush=True)
        return out
    work = Path(tempfile.mkdtemp(prefix='painted-', dir=out.parent if out.parent.exists() else None))
    try:
        frames = work / 'frames'; frames.mkdir()
        fit = {'spriteFacings': profile['facings'], 'wheels': {}, 'smoke': [], 'lamps': []}
        reports = []
        for part in spec['parts']:
            print(f'{spec["id"]}/{part["name"]}: rendering', flush=True)
            count = 48 if part['frame_prefix'].startswith('bogie_') else profile['facings']
            facings = [0, count // 4, count // 2, 3 * count // 4] if sample else list(range(count))
            job = {'profile': profile, 'part': part, 'facings': facings, 'heading_count': count,
                   'phases': [0, 3] if sample else list(range(profile['phases']))}
            raw = work / part['name']
            meta = blender_render(blender, job, raw)
            if verify:
                repeat = work / (part['name'] + '-repeat')
                other = blender_render(blender, job, repeat)
                if meta != other:
                    raise ValueError('Repeat render metadata differs')
                for name in meta['frames']:
                    with Image.open(raw / name) as a, Image.open(repeat / name) as b:
                        if a.mode != b.mode or a.size != b.size or a.tobytes() != b.tobytes():
                            raise ValueError(f'Repeat render pixel mismatch: {name}')
            bounds = {}
            for name in meta['frames']:
                with Image.open(raw / name) as image:
                    image = image.convert('RGBA').resize((part['canvas'],) * 2, Image.Resampling.BOX)
                    box = image.getbbox()
                    if not box or min(box[:2]) <= 1 or max(box[2:]) >= part['canvas'] - 1:
                        raise ValueError(f'Empty/clipped sprite: {name}; increase canvas or correct model origin')
                    if '_lit_f' in name:
                        # Additive pane overlay; discard the opaque black occluders.
                        import numpy as np
                        pixels = np.asarray(image).copy()
                        level = pixels[:, :, :3].max(axis=2).astype('float32') / 255
                        pixels[:, :, 3] = (pixels[:, :, 3] * level).astype('uint8')
                        pixels[:, :, :3] = (255, 211, 137)
                        image = Image.fromarray(pixels)
                        if not image.getbbox():
                            continue
                        image.save(frames / name)
                        continue
                    image.save(frames / name)
                    facing = int(Path(name).stem.rsplit('_f', 1)[1])
                    bounds.setdefault(facing, []).append(box)
                    if '_w0_' in name:
                        image.save(frames / name.replace('_w0_', '_'))
            drift = max(max(max(b[i] for b in boxes) - min(b[i] for b in boxes) for i in range(4)) for boxes in bounds.values())
            if drift > part.get('max_phase_bounds_drift', 0):
                raise ValueError(f'Wheel phase silhouette drifts by {drift}px: {part["name"]}')
            if part.get('wheel'):
                fit['wheels'][part['name']] = {'phases': profile['phases'], 'cycle': meta['cycle'], 'integrated': True}
            for kind in ['smoke', 'lamps']:
                for x, y, z in effect_points(part, kind):
                    effect = {'part': part['name'], 'along': x * meta['scale'] / profile['tile_m'],
                              'up': z * meta['scale'] * profile['tile_px'] / (profile['tile_m'] * math.sqrt(2)) * math.cos(math.pi / 6)}
                    if kind == 'lamps':
                        effect['across'] = y * meta['scale'] / profile['tile_m']
                    fit[kind].append(effect)
            reports.append({'part': part['name'], 'scale': meta['scale'], 'phase_bounds_drift_px': drift, 'frames': len(meta['frames'])})
        pages = pack(frames, work / 'atlas', profile['resolution'])
        write(work / 'fit-patch.json', {spec['id']: fit})
        write(work / 'inputs.json', inputs)
        write(work / 'report.json', {'id': spec['id'], 'complete': not sample, 'repeat_pixel_match': verify,
                                   'profile': profile['id'], 'pages': pages, 'parts': reports})
        images = sorted(frames.glob('*_f*.png'))
        # One phase per heading for bounded visual QA sheets.
        images = [p for p in images if '_w' not in p.stem]
        for start in range(0, len(images), 24):
            sheet = Image.new('RGB', (800, 1200), '#26382e'); draw = ImageDraw.Draw(sheet)
            for i, path in enumerate(images[start:start + 24]):
                with Image.open(path) as image:
                    image = image.crop(image.getbbox()); image.thumbnail((180, 170))
                    x, y = i % 4 * 200, i // 4 * 200
                    sheet.paste(image, (x + (200 - image.width) // 2, y + 25), image)
                    draw.text((x + 3, y + 4), path.stem, fill='white')
            sheet.save(work / f'preview-{start // 24 + 1}.png')
        # Jobs/logs contain temporary paths and are diagnostic, not reproducible outputs.
        outputs = list((work / 'atlas').glob('*')) + list(frames.glob('*.png')) + [work / 'fit-patch.json', work / 'report.json', work / 'inputs.json']
        write(work / 'receipt.json', {'key': key, 'files': {str(p.relative_to(work)): digest(p) for p in outputs}})
        current_spec, current_profile = load_manifest(manifest)
        current_key, _ = signature(current_spec, current_profile, blender)
        current_key = hashlib.sha256((current_key + str(sample)).encode()).hexdigest()
        if current_key != key:
            raise ValueError('Inputs or pipeline changed during rendering; rerun with one frozen revision')
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists():
            # Only replace this pipeline's content-addressed output directory.
            if not (out / 'receipt.json').exists():
                raise ValueError(f'Unowned output directory: {out}')
            if out.resolve().parent != out.parent.resolve() or out.name != key[:16]:
                raise ValueError('Refusing to replace an output outside its asset directory')
            shutil.rmtree(out)
        shutil.move(str(work), str(out))
        print(f'{spec["id"]}: completed {out}', flush=True)
        return out
    except Exception:
        print(f'Failed run retained for diagnosis: {work}', flush=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifests', nargs='+', type=Path)
    parser.add_argument('--blender', required=True)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--verify-repeat', action='store_true', help='Render twice in fresh Blender processes; require identical pixels')
    parser.add_argument('--sample', action='store_true', help='4 headings x 2 wheel phases; non-installable smoke test')
    args = parser.parse_args()
    for manifest in args.manifests:
        build(manifest, args.blender, args.out, args.force, args.verify_repeat, args.sample)


if __name__ == '__main__':
    main()
