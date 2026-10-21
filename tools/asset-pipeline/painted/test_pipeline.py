"""Fast boundary tests; actual Blender repeatability is tested by --verify-repeat. No Blender needed.

    cd tools/asset-pipeline/painted && python -m unittest test_pipeline -v

Atlas packing tests need Pillow and are skipped, with the reason, without it.
"""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from run import cached, digest, load_manifest, pack, signature, write, effect_points
from install import install, check_atlas_capacity
from reference import validate_reference, rail_half_m
import blender_runner

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
HAS_PILLOW = importlib.util.find_spec('PIL') is not None
NEEDS_PILLOW = 'Pillow is not installed: atlas packing reads and writes PNGs with it'


def reference_fixture(root, parts):
    picture = root / 'reference.png'; picture.write_bytes(b'picture')
    workbook = root / 'reference.xlsx'; workbook.write_bytes(b'workbook')
    return {'schema': 1, 'authority': 'workbook-pictures-and-owner-notes',
            'workbook': {'path': str(workbook), 'sha256': digest(workbook)},
            'sheet': 'Locomotives', 'row': 1, 'guidelines': 'Two wheels, green cab',
            'pictures': [{'path': str(picture), 'sha256': digest(picture)}],
            'prepared_sources': {p['name']: p['source_sha256'] for p in parts}}


def lock_fixture(path):
    spec = json.loads(path.read_text())
    spec['reference'] = reference_fixture(path.parent, spec['parts'])
    write(path, spec)


class PipelineTests(unittest.TestCase):
    def test_reconstructed_headlamps_reach_runtime_without_duplicates(self):
        points = [[1, .2, 3], [1, -.2, 3]]
        self.assertEqual(effect_points({'effects': {'headlamps': points}}, 'lamps'), points)
        self.assertEqual(effect_points({'effects': {'headlamps': points, 'lamps': []}}, 'lamps'), [])
        self.assertEqual(effect_points({}, 'lamps'), [])

    def test_wheel_gauge_matches_the_two_track_classes(self):
        tile = 6.235064799811727
        self.assertAlmostEqual(2 * rail_half_m('standard') / tile, .24)
        self.assertAlmostEqual(2 * rail_half_m('narrow') / tile, .16)
        with self.assertRaises(ValueError):
            rail_half_m('unknown')

    def test_install_rejects_a_fleet_larger_than_the_target_loader_supports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root / 'src/engine/atlas.ts'
            source.parent.mkdir(parents=True)
            source.write_text('json.pages! <= 16')
            with self.assertRaisesRegex(ValueError, 'installation needs 17'):
                check_atlas_capacity(root, 17)
            source.write_text('json.pages! <= 128')
            check_atlas_capacity(root, 17)

    def test_reference_lock_rejects_absent_changed_or_unbound_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            parts = [{'name': 'body', 'source_sha256': 'reviewed-model'}]
            ref = reference_fixture(root, parts)
            validate_reference(ref, root, parts)
            with self.assertRaisesRegex(ValueError, 'locked picture reference'):
                validate_reference(None, root, parts)
            with self.assertRaisesRegex(ValueError, 'not bound'):
                validate_reference(ref, root, [{'name': 'body', 'source_sha256': 'old-game-model'}])
            (root / 'reference.png').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'missing or changed'):
                validate_reference(ref, root, parts)

    def test_source_change_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'model.blend'; source.write_bytes(b'approved')
            write(root / 'style.json', {'schema': 1, 'facings': 96, 'phases': 8})
            write(root / 'asset.json', {'schema': 1, 'id': 'example', 'profile': 'style.json', 'parts': [
                {'name': 'body', 'frame_prefix': 'loco_example_body', 'source': 'model.blend',
                 'source_sha256': digest(source), 'canvas': 256, 'length_tiles': 1}]})
            lock_fixture(root / 'asset.json')
            load_manifest(root / 'asset.json')
            source.write_bytes(b'edited')
            with self.assertRaisesRegex(ValueError, 'Source hash changed'):
                load_manifest(root / 'asset.json')

    def test_owned_truck_and_window_mask_are_validated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root / 'model.blend'; source.write_bytes(b'approved')
            mask = root / 'mask.png'; mask.write_bytes(b'approved mask')
            write(root / 'style.json', {'schema': 1, 'facings': 96, 'phases': 8})
            write(root / 'asset.json', {'schema': 1, 'id': 'example', 'profile': 'style.json', 'parts': [
                {'name': 'body-t0', 'frame_prefix': 'loco_example_body-t0', 'source': 'model.blend',
                 'source_sha256': digest(source), 'canvas': 256, 'length_tiles': 1,
                 'window_mask': {'path': 'mask.png', 'sha256': digest(mask)}}]})
            lock_fixture(root / 'asset.json')
            spec, _ = load_manifest(root / 'asset.json')
            self.assertEqual(spec['parts'][0]['window_mask']['path'], str(mask.resolve()))
            mask.write_bytes(b'unreviewed change')
            with self.assertRaisesRegex(ValueError, 'Window mask hash changed'):
                load_manifest(root / 'asset.json')

    @unittest.skipUnless(HAS_PILLOW, NEEDS_PILLOW)
    def test_identical_frames_share_pixels_without_sharing_different_anchors(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); frames = root / 'frames'; frames.mkdir()
            im = Image.new('RGBA', (64, 64)); im.paste((10, 40, 80, 255), (10, 20, 30, 40))
            im.save(frames / 'body_f0.png'); im.save(frames / 'body_w0_f0.png')
            other = Image.new('RGBA', (64, 64)); other.paste(im.crop(im.getbbox()), (15, 20)); other.save(frames / 'other_f0.png')
            pages = pack(frames, root / 'atlas', 2)
            table = json.loads((root / 'atlas' / (pages[0] + '.json')).read_text())['frames']
            self.assertEqual(table['rolling/body_f0'], table['rolling/body_w0_f0'])
            self.assertNotEqual(table['rolling/body_f0']['ax'], table['rolling/other_f0']['ax'])

    @unittest.skipUnless(HAS_PILLOW, NEEDS_PILLOW)
    def test_pack_preserves_pixels_anchors_and_bounds_across_pages(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); frames = root / 'frames'; frames.mkdir()
            # Three tall sprites force a second page without excessive fixture data.
            for i in range(3):
                im = Image.new('RGBA', (2200, 2200))
                im.paste((30 + i, 90, 120, 200), (100, 200, 2150, 2100))
                im.save(frames / f'f{i}.png')
            pages = pack(frames, root / 'atlas', 4)
            self.assertGreater(len(pages), 1)
            for page in pages:
                with Image.open(root / 'atlas' / (page + '.png')) as atlas:
                    self.assertLessEqual(max(atlas.size), 4096)
                    data = json.loads((root / 'atlas' / (page + '.json')).read_text())
                    for key, f in data['frames'].items():
                        self.assertEqual((f['ax'], f['ay']), (1000, 900))
                        image = Image.open(frames / (key.removeprefix('rolling/') + '.png'))
                        crop = atlas.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
                        self.assertEqual(crop.tobytes(), image.crop(image.getbbox()).tobytes())

    def test_receipt_and_install_preserve_other_assets_and_reuse_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); bundle = root / 'bundle'; game = root / 'game'
            write(bundle / 'inputs.json', {'manifest': {'id': 'example', 'parts': [{'frame_prefix': 'loco_example_body'}]}})
            write(bundle / 'report.json', {'complete': True, 'pages': ['rolling-painted-1']})
            write(bundle / 'fit-patch.json', {'example': {'spriteFacings': 96, 'wheels': {}}})
            write(bundle / 'atlas/rolling-painted-1.json', {'frames': {'rolling/loco_example_body_f0': {}}})
            (bundle / 'atlas/rolling-painted-1.png').write_bytes(b'new')
            files = {str(p.relative_to(bundle)): digest(p) for p in bundle.rglob('*') if p.is_file()}
            write(bundle / 'receipt.json', {'key': 'key', 'files': files})
            self.assertTrue(cached(bundle, 'key')); self.assertFalse(cached(bundle, 'different-inputs'))
            write(game / 'public/assets/rolling.json', {'frames': {'rolling/loco_other_body_f0': {}, 'rolling/loco_example_body_f0': {}}})
            (game / 'public/assets/rolling.png').write_bytes(b'untouched')
            write(game / 'src/data/locoFit.json', {'example': {'tiles': 1}, 'other': {'tiles': 2}})
            (game / 'src/render').mkdir(parents=True)
            (game / 'src/render/trainRenderer.ts').write_text('spriteFacings integrated')
            (game / 'scratchpad').mkdir()
            original = (game / 'public/assets/rolling.json').read_bytes()
            install(bundle, game)
            self.assertEqual(original, (game / 'public/assets/rolling.json').read_bytes())
            install(bundle, game, True); install(bundle, game, True)
            first = json.loads((game / 'public/assets/rolling.json').read_text())
            self.assertEqual(first['pages'], 2)
            self.assertEqual(list(first['frames']), ['rolling/loco_other_body_f0'])
            self.assertEqual((game / 'public/assets/rolling.png').read_bytes(), b'untouched')
            fit = json.loads((game / 'src/data/locoFit.json').read_text())
            self.assertEqual(fit['other'], {'tiles': 2}); self.assertEqual(fit['example']['tiles'], 1)
            write(bundle / 'report.json', {'complete': False, 'pages': ['rolling-painted-1']})
            files['report.json'] = digest(bundle / 'report.json')
            write(bundle / 'receipt.json', {'key': 'key', 'files': files})
            with self.assertRaisesRegex(ValueError, 'Sample bundles'):
                install(bundle, game, True)
            (bundle / 'atlas/rolling-painted-1.png').write_bytes(b'corrupted')
            self.assertFalse(cached(bundle, 'key'))
            with self.assertRaisesRegex(ValueError, 'modified'):
                install(bundle, game, True)


class ShippedManifests(unittest.TestCase):
    """The C-50 and SW1 v4 manifests on develop read against the files committed beside them."""

    def test_c50_manifest_is_locked_to_the_committed_model_and_picture(self):
        spec, profile = load_manifest(HERE / 'manifests/c50.json')
        self.assertEqual(profile['id'], 'c50-lighter-v2')
        self.assertEqual([p['frame_prefix'] for p in spec['parts']], ['loco_c50_body'])
        self.assertEqual(spec['parts'][0]['wheel']['count'], 4)
        reference = validate_reference(spec['reference'], HERE / 'manifests')
        self.assertTrue(reference['pictures'][0]['path'].endswith('c50-reference-v2.png'))

    def test_sw1_candidate_is_locked_to_its_committed_parts(self):
        model = REPO / 'assets/source/sw1-picture-v4-2026-10-08/model'
        spec, profile = load_manifest(model / 'candidate.json')
        self.assertEqual(profile['id'], 'c50-lighter-v2')
        self.assertEqual([p['name'] for p in spec['parts']], ['body', 'body-t0', 'body-t1'])
        self.assertEqual([p.get('wheel', {}).get('count') for p in spec['parts']], [None, 4, 4])

    def test_manifest_paths_resolve_from_the_manifest_not_the_machine(self):
        for path in [HERE / 'manifests/c50.json', REPO / 'assets/source/sw1-picture-v4-2026-10-08/model/candidate.json']:
            text = json.loads(path.read_text(encoding='utf-8'))
            paths = [text['profile']] + [p['source'] for p in text['parts']]
            paths += [p['path'] for p in text['reference']['pictures']] + [text['reference']['observations']['path']]
            for name in paths:
                self.assertFalse(Path(name).is_absolute() or ':' in name or '\\' in name, f'{path.name}: {name}')

    def test_render_cache_key_follows_the_blender_release_not_how_it_is_reached(self):
        spec, profile = load_manifest(HERE / 'manifests/c50.json')
        exe = blender_runner.Blender('5.2.1 LTS', (5, 2, 1), '9e2066aef7ef', 'blender.exe')
        module = blender_runner.Blender('5.2.1 LTS', (5, 2, 1), '9e2066aef7ef')
        other = blender_runner.Blender('5.2.2 LTS', (5, 2, 2), 'aaaaaaaaaaaa')
        self.assertEqual(signature(spec, profile, exe)[0], signature(spec, profile, module)[0])
        self.assertNotEqual(signature(spec, profile, exe)[0], signature(spec, profile, other)[0])


if __name__ == '__main__':
    unittest.main()
