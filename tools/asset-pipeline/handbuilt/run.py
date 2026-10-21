"""PNG reference package -> authored C50-method recipe -> reproducible sprites.

Image interpretation is explicit authoring, not an automatic image-to-CAD model.
No game checkout, old mesh, fit or gear table is an input to this entry point.
Blender steps go through ../blender_runner.py: `--blender <exe>` runs a Blender 5.2.x
executable, no `--blender` runs the bpy 5.2.x module of the Python running this file.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import shutil
import sys

HERE = Path(__file__).resolve().parent
PAINTED = HERE.parent / 'painted'
# Appended, not prepended: tools/asset-pipeline also holds the ComfyUI pipeline's run.py.
if str(HERE.parent) not in sys.path:
    sys.path.append(str(HERE.parent))
import blender_runner  # noqa: E402
from filehash import digest  # noqa: E402

PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
# Pipeline outputs a project folder may hold: rebuilt from the lock, too large to commit.
PROJECT_GITIGNORE = 'sample/\nproduction/\n.verification/\n*.log\n'


def sha(path):
    """Line-ending independent SHA-256 (../filehash.py), so a lock holds on every checkout."""
    return digest(path)


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def relative(name):
    """A project path is relative with forward slashes, so one project works on every machine."""
    if not isinstance(name, str) or not name:
        raise ValueError('Project paths must be non-empty strings')
    if '\\' in name:
        raise ValueError(f'Use forward slashes in project paths: {name}')
    if PureWindowsPath(name).drive or PurePosixPath(name).is_absolute():
        raise ValueError(f'Project paths must be relative to the project: {name}')
    return name


def local(root, name):
    path = (root / relative(name)).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Recipe inputs/outputs must remain within their project')
    return path


def initialize(asset_id, images, out):
    from PIL import Image

    if not re.fullmatch('[a-z0-9_]+', asset_id):
        raise ValueError('Use a lowercase asset id')
    root = out.resolve()
    root.mkdir(parents=True, exist_ok=False)
    (root / 'references').mkdir()
    pictures = []
    for index, source in enumerate(images):
        target = root / 'references' / f'{index + 1:02}.png'
        with Image.open(source) as im:
            im.convert('RGBA').save(target)
        pictures.append({'id': f'view{index + 1}', 'path': target.relative_to(root).as_posix(),
                         'sha256': sha(target), 'original_name': Path(source).name,
                         'original_sha256': sha(source)})
    shutil.copy2(HERE / 'c50_primitives.py', root / 'c50_primitives.py')
    shutil.copy2(PAINTED / 'profiles/c50-lighter-v2.json', root / 'style.json')
    shutil.copy2(HERE / 'recipe_template.py', root / 'build.py')
    (root / '.gitignore').write_text(PROJECT_GITIGNORE, encoding='utf-8')
    write(root / 'observations.json', {'schema': 1, 'observed': [], 'inferred': [],
          'omitted': [], 'guidelines': 'Use only these pictures for shape and livery.'})
    write(root / 'project.json', {'schema': 1, 'id': asset_id, 'recipe': 'build.py',
          'helpers': 'c50_primitives.py', 'profile': 'style.json',
          'observations': 'observations.json', 'pictures': pictures,
          'gauge': 'standard', 'output': 'model'})
    print(root / 'project.json')


def load(path):
    path = Path(path)
    root = path.resolve().parent
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('schema') != 1 or not re.fullmatch('[a-z0-9_]+', data.get('id', '')):
        raise ValueError('Invalid project schema/id')
    allowed = {'schema', 'id', 'recipe', 'helpers', 'profile', 'observations', 'pictures', 'gauge', 'output'}
    if set(data) - allowed or data.get('gauge') not in ('standard', 'narrow'):
        raise ValueError('Use reference-project inputs; runtime calibration is not an input')
    if not data.get('pictures'):
        raise ValueError('At least one reference picture is required')
    for p in data['pictures']:
        file = local(root, p['path'])
        if file.suffix.lower() != '.png' or sha(file) != p['sha256']:
            raise ValueError('Reference PNG changed; explicitly review and update its hash')
        with file.open('rb') as handle:
            if handle.read(len(PNG_SIGNATURE)) != PNG_SIGNATURE:
                raise ValueError('Reference must contain PNG data')
    notes = json.loads(local(root, data['observations']).read_text(encoding='utf-8'))
    if not notes.get('observed') or not notes.get('guidelines'):
        raise ValueError('Author image observations before building a model')
    ids = {p['id'] for p in data['pictures']}
    for item in notes['observed']:
        if item.get('picture') not in ids or not item.get('detail') or len(item.get('region', [])) != 4:
            raise ValueError('Observed details require a source image and normalized bounding box')
        x0, y0, x1, y1 = item['region']
        if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
            raise ValueError('Evidence bounds must fit the reference image')
    for key in ['recipe', 'helpers', 'profile', 'observations', 'output']:
        local(root, data[key])
    if 'UNAUTHORED_RECIPE' in local(root, data['recipe']).read_text(encoding='utf-8'):
        raise ValueError('The new locomotive still needs a picture-authored recipe')
    return root, data, notes


def fingerprint(path, root, data):
    names = [Path(path).name] + [data[k] for k in ['recipe', 'helpers', 'profile', 'observations']]
    names += [p['path'] for p in data['pictures']]
    inputs = {name: sha(local(root, name)) for name in names}
    # Lock construction code as well as pictures. Renderer has its own full receipt.
    inputs['pipeline/run.py'] = sha(__file__)
    inputs['pipeline/build_stage.py'] = sha(HERE / 'build_stage.py')
    return {'schema': 1, 'inputs': inputs}


def build_key(current, blender):
    """Construction cache key: the locked inputs and the Blender release that built them."""
    return hashlib.sha256(json.dumps([current, blender.identity], sort_keys=True).encode()).hexdigest()


def painted_renderer():
    sys.path.insert(0, str(PAINTED))
    spec = importlib.util.spec_from_file_location('painted_runner', PAINTED / 'run.py')
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    return renderer


def execute(command, path, blender=None):
    path = Path(path).resolve()
    root, data, notes = load(path)
    current = fingerprint(path, root, data)
    lock = root / 'recipe-lock.json'
    if command == 'lock':
        write(lock, current)
        print('Locked picture-authored recipe:', data['id'])
        return
    if not lock.exists() or json.loads(lock.read_text(encoding='utf-8')) != current:
        raise ValueError('Recipe inputs changed. Inspect them, then run lock explicitly.')
    blender = blender_runner.resolve(blender)
    print(f'{data["id"]}: {blender}', flush=True)
    output = local(root, data['output'])
    if command == 'verify':
        if not (output / 'candidate.json').is_file():
            raise ValueError('Nothing to verify: build the model first')
        blender.run(HERE / 'verify_construction.py', [path], log=root / '.verification' / 'verify.log')
        print(f'{data["id"]}: construction replay matches {output}', flush=True)
        return
    key = build_key(current, blender)
    receipt = output / 'build-receipt.json'
    previous = json.loads(receipt.read_text(encoding='utf-8')) if receipt.exists() else {}
    valid = previous.get('key') == key and bool(previous.get('files')) and all(
        local(output, n).is_file() and sha(local(output, n)) == h for n, h in previous.get('files', {}).items())
    if not valid:
        output.mkdir(parents=True, exist_ok=True)
        blender.run(HERE / 'build_stage.py', [path], log=output / 'build.log')
        if fingerprint(path, root, data) != current:
            raise ValueError('Source changed during build; discard this run and rerun frozen inputs')
        manifest = json.loads((output / 'candidate.json').read_text(encoding='utf-8'))
        names = ['candidate.json', 'calibration.json'] + [p['name'] + '.blend' for p in manifest['parts']]
        write(receipt, {'key': key, 'files': {n: sha(output / n) for n in names}})
        print('Built', data['id'], flush=True)
    else:
        print('Verified construction cache', data['id'], flush=True)
    manifest = json.loads((output / 'candidate.json').read_text(encoding='utf-8'))
    if manifest['id'] != data['id']:
        raise ValueError('Recipe emitted a different locomotive id')
    expected = {(str(local(root, p['path'])), p['sha256']) for p in data['pictures']}
    actual = {(str((output / p['path']).resolve()), p['sha256']) for p in manifest['reference']['pictures']}
    if actual != expected or manifest['reference'].get('authority') != 'png-pictures-and-owner-notes':
        raise ValueError('Recipe geometry is not bound to the project PNGs')
    # Validate source/reference binding even for build-only or cache hits.
    renderer = painted_renderer()
    renderer.load_manifest(output / 'candidate.json')
    if command == 'build':
        return
    stages = ['sample', 'production'] if command == 'all' else [command]
    for stage in stages:
        renderer.build(output / 'candidate.json', blender, root / stage,
                       sample=stage == 'sample', verify=stage == 'sample')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('command', choices=['init', 'lock', 'build', 'verify', 'sample', 'production', 'all'])
    p.add_argument('project', nargs='?', type=Path)
    p.add_argument('--id')
    p.add_argument('--images', nargs='+', type=Path)
    p.add_argument('--out', type=Path)
    p.add_argument('--blender', help='Blender 5.2.x executable; omitted: the bpy module of this Python')
    a = p.parse_args()
    if a.command == 'init':
        if not (a.id and a.images and a.out):
            p.error('init requires --id --images --out')
        initialize(a.id, a.images, a.out)
    else:
        if not a.project:
            p.error('Specify the project.json')
        execute(a.command, a.project, a.blender)


if __name__ == '__main__':
    main()
