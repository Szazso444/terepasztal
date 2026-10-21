"""Reference boundaries: never silently adopt changed art or runtime geometry. No Blender needed.

    python -m unittest discover -s tools/asset-pipeline/handbuilt -p 'test_*.py' -v

Tests that create pictures need Pillow and are skipped, with the reason, without it.
"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
SW1 = REPO / 'assets/source/sw1-picture-v4-2026-10-08'
spec = importlib.util.spec_from_file_location('handbuilt_cli', HERE / 'run.py')
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
blender_runner = sys.modules['blender_runner']
HAS_PILLOW = importlib.util.find_spec('PIL') is not None


def copy_project(source, target):
    """A project as a checkout holds it, without build outputs."""
    shutil.copytree(source, target, ignore=shutil.ignore_patterns('*.blend', 'sample', 'production', '.verification'))
    return target / 'project.json'


@unittest.skipUnless(HAS_PILLOW, 'Pillow is not installed: init converts pictures with it')
class RecipeBoundary(unittest.TestCase):
    def setUp(self):
        from PIL import Image

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.png = self.base / 'reference.png'
        Image.new('RGB', (8, 8), 'red').save(self.png)
        self.root = self.base / 'asset'
        with contextlib.redirect_stdout(io.StringIO()):
            cli.initialize('example', [self.png], self.root)
        self.path = self.root / 'project.json'
        (self.root / 'build.py').write_text('# Reference-authored recipe\n')
        cli.write(self.root / 'observations.json', {'observed': [{'picture': 'view1', 'region': [0, 0, 1, 1], 'detail': 'One red rectangular shell'}], 'inferred': [], 'omitted': [], 'guidelines': 'Only this PNG'})

    def test_input_png_is_copied_and_locked(self):
        root, data, _ = cli.load(self.path)
        self.assertEqual(data['pictures'][0]['path'], 'references/01.png')
        self.assertEqual(cli.sha(root / data['pictures'][0]['path']), data['pictures'][0]['sha256'])
        self.assertIn('sample/', (self.root / '.gitignore').read_text())

    def test_changed_reference_is_rejected(self):
        from PIL import Image

        Image.new('RGB', (8, 8), 'blue').save(self.root / 'references/01.png')
        with self.assertRaisesRegex(ValueError, 'Reference PNG changed'):
            cli.load(self.path)

    def test_reference_must_hold_png_data(self):
        picture = self.root / 'references/01.png'
        picture.write_bytes(b'not a png')
        data = json.loads(self.path.read_text())
        data['pictures'][0]['sha256'] = cli.sha(picture)
        cli.write(self.path, data)
        with self.assertRaisesRegex(ValueError, 'PNG data'):
            cli.load(self.path)

    def test_runtime_geometry_is_not_a_project_input(self):
        data = json.loads(self.path.read_text())
        data['game_fit'] = 'src/data/locoFit.json'
        cli.write(self.path, data)
        with self.assertRaisesRegex(ValueError, 'runtime calibration'):
            cli.load(self.path)

    def test_reference_evidence_must_name_a_picture(self):
        p = self.root / 'observations.json'
        data = json.loads(p.read_text())
        data['observed'][0]['picture'] = 'not-a-view'
        cli.write(p, data)
        with self.assertRaisesRegex(ValueError, 'Observed details'):
            cli.load(self.path)

    def test_no_output_can_escape_project(self):
        data = json.loads(self.path.read_text())
        data['output'] = '../outside'
        cli.write(self.path, data)
        with self.assertRaisesRegex(ValueError, 'within their project'):
            cli.load(self.path)

    def test_changed_geometry_invalidates_recipe_lock(self):
        root, data, _ = cli.load(self.path)
        before = cli.fingerprint(self.path, root, data)
        (root / 'build.py').write_text('# altered authored proportions\n')
        self.assertNotEqual(before, cli.fingerprint(self.path, root, data))

    def test_uninterpreted_png_cannot_emit_a_guessed_model(self):
        (self.root / 'build.py').write_text('UNAUTHORED_RECIPE')
        with self.assertRaisesRegex(ValueError, 'picture-authored recipe'):
            cli.load(self.path)


class ProjectPaths(unittest.TestCase):
    def test_project_paths_are_relative_with_forward_slashes(self):
        self.assertEqual(cli.relative('references/01.png'), 'references/01.png')
        drive = 'C:'  # joined at run time: shipped files hold no literal drive path (handbuilt-method.test.mjs)
        for name in ['references\\01.png', drive + '/Users/someone/01.png', drive + '\\DEV\\01.png',
                     '/home/someone/01.png', '']:
            with self.assertRaises(ValueError, msg=name):
                cli.relative(name)

    def test_local_paths_stay_inside_the_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(cli.local(root, 'model'), (root / 'model').resolve())
            with self.assertRaisesRegex(ValueError, 'within their project'):
                cli.local(root, 'model/../../outside')


class ShippedSw1Project(unittest.TestCase):
    """The SW1 v4 recipe on develop: locked at the current pipeline, the same on every checkout."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = copy_project(SW1, Path(self.tmp.name) / 'sw1')

    def test_recipe_lock_is_current(self):
        root, data, _ = cli.load(self.path)
        lock = json.loads((root / 'recipe-lock.json').read_text(encoding='utf-8'))
        self.assertEqual(cli.fingerprint(self.path, root, data), lock,
                         'Inputs or handbuilt/run.py changed: rebuild, check, then run `run.py lock` on the SW1 v4')

    def test_lock_holds_on_a_crlf_checkout(self):
        root, data, _ = cli.load(self.path)
        before = cli.fingerprint(self.path, root, data)
        for name in ['project.json', 'build.py', 'c50_primitives.py', 'style.json', 'observations.json']:
            file = root / name
            file.write_bytes(file.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))
        self.assertEqual(cli.fingerprint(self.path, root, data), before)

    def test_build_refuses_changed_inputs_before_looking_for_blender(self):
        (self.path.parent / 'build.py').write_text('# altered\n', encoding='utf-8')
        with mock.patch.object(blender_runner, 'resolve', side_effect=AssertionError('resolved Blender')):
            with self.assertRaisesRegex(ValueError, 'Recipe inputs changed'):
                cli.execute('build', self.path)

    def test_build_without_blender_names_what_it_needs(self):
        with mock.patch.object(importlib.util, 'find_spec', return_value=None):
            with self.assertRaises(blender_runner.BlenderUnavailable) as caught:
                cli.execute('build', self.path)
        self.assertIn('--blender', str(caught.exception))
        self.assertIn('5.2', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
