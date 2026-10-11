"""Export the isolated C-50 pilots as the fifth rolling atlas page.

Keeps the first four atlas images byte-for-byte, with a backup of their metadata.
No legacy wheel or window overlay is compatible with these complete-body frames.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys

from PIL import Image


def main(raw, game):
    meta = json.loads((raw / 'meta.json').read_text())
    assert meta['id'] == 'c50'
    corrected = 'authorized_corrections' in meta or meta.get('kind') == 'handbuilt'
    if corrected:
        assert meta['source_unchanged']
        if meta.get('kind') == 'handbuilt':
            assert meta['camera_depth_checked'] and meta['uniform_scale'] > 0
        else:
            assert meta['authorized_corrections']['deck_width_factor'] == 1.4
        assert meta['facings'] == 96 and meta['phases'] == 8
        assert len(meta['frames']) == 96 * 8
    else:
        assert meta['mesh_unchanged'] and len(meta['frames']) == 48
    frames = raw.parent / 'frames'
    frames.mkdir(exist_ok=True)
    for name in meta['frames']:
        im = Image.open(raw / name).convert('RGBA')
        im = im.resize((im.width // meta['supersample'], im.height // meta['supersample']), Image.Resampling.BOX)
        box = im.getbbox()
        assert box and min(box[:2]) > 1 and box[2] < im.width - 1 and box[3] < im.height - 1, name
        im.save(frames / name)
    if corrected:
        for f in range(96):
            shutil.copy2(frames / f'loco_c50_body_w0_f{f}.png', frames / f'loco_c50_body_f{f}.png')
    (frames / 'atlas.json').write_text(json.dumps({
        'resolution': meta['resolution'], 'partial': True, 'anchor': meta['anchor'],
    }), encoding='utf-8')
    assets = game / 'public/assets'
    backup = raw.parent / 'before-metadata'
    backup.mkdir(exist_ok=True)
    for name in ['rolling.json', 'rolling-2.json', 'rolling-3.json', 'rolling-4.json']:
        src = assets / name
        if not (backup / name).exists():
            shutil.copy2(src, backup / name)
    fit_path = game / 'src/data/locoFit.json'
    if not (backup / 'locoFit.json').exists():
        shutil.copy2(fit_path, backup / 'locoFit.json')
    subprocess.run(['node', 'tools/pack-atlas.mjs', 'rolling-5', '--src', str(frames),
                    '--out', str(assets), '--prefix', 'rolling/', '--max', '4096'], cwd=game, check=True)
    with Image.open(assets / 'rolling-5.png') as atlas_image:
        assert max(atlas_image.size) <= 4096, 'Atlas exceeds the page size contract'
    # The demo checkout's older packer does not propagate resolution metadata.
    page_path = assets / 'rolling-5.json'
    page = json.loads(page_path.read_text())
    page['resolution'] = meta['resolution']
    page_path.write_text(json.dumps(page, indent=2) + '\n', encoding='utf-8')
    for name in ['rolling.json', 'rolling-2.json', 'rolling-3.json', 'rolling-4.json']:
        path = assets / name
        data = json.loads(path.read_text())
        data['frames'] = {k: v for k, v in data['frames'].items() if not k.startswith('rolling/loco_c50_')}
        if name == 'rolling.json':
            data['pages'] = 5
        path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    fits = json.loads(fit_path.read_text())
    if meta.get('kind') == 'handbuilt':
        for key in ('smoke', 'lamps'):
            fits['c50'][key] = meta['fit_effects'][key]
    if corrected:
        fits['c50']['spriteFacings'] = 96
        fits['c50']['wheels'] = {'body': {'phases': 8, 'cycle': meta['wheel_cycle_tiles'], 'integrated': True}}
    else:
        fits['c50'].pop('wheels', None)
        fits['c50'].pop('spriteFacings', None)
    fit_path.write_text(json.dumps(fits, indent=2) + '\n', encoding='utf-8')
    print('Exported C-50: ' + ('96 headings with 8 integrated wheel phases.' if corrected else '48 original headings.'))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
