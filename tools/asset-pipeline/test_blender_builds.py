"""Blender checks of the hand-built method: the C-50 and the SW1 v4 rebuild from develop to the
values backed up from the author's PC, and the SW1 sample renders twice with identical pixels.

They need Blender 5.2.x: a Python that imports bpy 5.2.x (the cloud), or BLENDER=<blender
executable> (the author's PC). Without either, each check is skipped and says why.

    <python with bpy> -m unittest discover -s tools/asset-pipeline -p 'test_blender_*.py' -v
    BLENDER=<path to blender> python -m unittest discover -s tools/asset-pipeline -p 'test_blender_*.py' -v

Everything is built in temporary folders; nothing in the repository is overwritten. On a CPU-only
machine the builds and the replay take about a minute each and the SW1 sample 42 CPU minutes (EEVEE
on Mesa's software OpenGL, 105 minutes on a busy shared machine); with a GPU it takes a few minutes.
Leave the sample out with `-k rebuilds_to -k replay_matches`.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
C50 = REPO / 'assets/source/c50-handbuilt-2026-10-07'
SW1 = REPO / 'assets/source/sw1-picture-v4-2026-10-08'
TOLERANCE = 1e-6
if str(HERE) not in sys.path:
    sys.path.append(str(HERE))
import blender_runner  # noqa: E402

try:
    BLENDER = blender_runner.resolve(os.environ.get('BLENDER') or None)
    SKIP = None
except blender_runner.BlenderUnavailable as unavailable:
    BLENDER, SKIP = None, f'Blender checks skipped. {unavailable}'
    print(SKIP, file=sys.stderr)


def handbuilt():
    spec = importlib.util.spec_from_file_location('handbuilt_run', HERE / 'handbuilt/run.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def model_report(blends, folder):
    out = Path(folder) / 'model-report.json'
    BLENDER.run(HERE / 'handbuilt/model_report.py', [out, *blends], log=Path(folder) / 'model-report.log')
    return json.loads(out.read_text(encoding='utf-8'))


@unittest.skipIf(SKIP, SKIP)
class Rebuilds(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='handbuilt-check-'))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def assertClose(self, actual, expected, where=''):
        """Same structure; numbers within TOLERANCE, everything else equal."""
        if isinstance(expected, dict):
            self.assertEqual(sorted(actual), sorted(expected), where)
            for key in expected:
                self.assertClose(actual[key], expected[key], f'{where}.{key}')
        elif isinstance(expected, list):
            self.assertEqual(len(actual), len(expected), where)
            for i, (a, e) in enumerate(zip(actual, expected)):
                self.assertClose(a, e, f'{where}[{i}]')
        elif isinstance(expected, float) and not isinstance(expected, bool):
            self.assertAlmostEqual(actual, expected, delta=TOLERANCE, msg=where)
        else:
            self.assertEqual(actual, expected, where)

    def assertSameModels(self, built, committed):
        """Mesh and wheel pivot counts equal, evaluated bounding boxes within TOLERANCE."""
        report = model_report([*built, *committed], self.tmp)
        for new, old in zip(built, committed):
            a, b = report[str(new)], report[str(old)]
            for key in ['meshes', 'pivots', 'objects']:
                self.assertEqual(a[key], b[key], f'{Path(new).name} {key}')
            self.assertClose(a['min'] + a['max'], b['min'] + b['max'], f'{Path(new).name} bounds')
        return report

    def test_c50_rebuilds_to_the_backed_up_validation(self):
        out = self.tmp / 'c50'
        BLENDER.run(C50 / 'build.py', ['--out', out, '--resolution-percent', '10', '--samples', '1'],
                    log=self.tmp / 'c50-build.log')
        built = json.loads((out / 'validation.json').read_text(encoding='utf-8'))
        backed_up = json.loads((C50 / 'validation.json').read_text(encoding='utf-8'))
        self.assertClose(built, backed_up, 'validation')
        self.assertEqual((built['mesh_objects'], built['wheel_pivots']), (286, 4))
        for name in ['c50-handbuilt.blend', 'c50-handbuilt.glb', 'front.png', 'rear.png', 'side.png',
                     'front-end.png', 'rear-end.png', 'top.png']:
            self.assertTrue((out / name).is_file(), name)
        report = self.assertSameModels([out / 'c50-handbuilt.blend'], [C50 / 'c50-handbuilt.blend'])
        self.assertEqual(report[str(out / 'c50-handbuilt.blend')]['pivots'], 4)

    def test_sw1_rebuilds_to_the_backed_up_calibration(self):
        project = self.tmp / 'sw1'
        shutil.copytree(SW1, project, ignore=shutil.ignore_patterns('model', 'sample', 'production', '.verification'))
        handbuilt().execute('build', project / 'project.json', BLENDER)
        built, committed = project / 'model', SW1 / 'model'
        read = lambda folder, name: json.loads((folder / name).read_text(encoding='utf-8'))  # noqa: E731
        self.assertClose(read(built, 'calibration.json'), read(committed, 'calibration.json'), 'calibration')
        self.assertClose(read(built, 'validation.json'), read(committed, 'validation.json'), 'validation')
        new, old = read(built, 'candidate.json'), read(committed, 'candidate.json')
        for part in new['parts'] + old['parts']:
            part.pop('source_sha256')  # .blend bytes differ between machines; the geometry is compared below
        new['reference'].pop('prepared_sources'), old['reference'].pop('prepared_sources')
        self.assertClose(new, old, 'candidate')
        names = [p['name'] + '.blend' for p in old['parts']]
        report = self.assertSameModels([built / n for n in names], [committed / n for n in names])
        replay = read(SW1, 'construction-repeat.json')['parts']
        for name in names:
            counts = report[str(built / name)]
            self.assertEqual(counts['meshes'], replay[name]['meshes'], name)
            self.assertEqual(counts['pivots'], 0 if name == 'body.blend' else 4, name)

    def test_sw1_replay_matches_the_committed_model(self):
        project = self.tmp / 'sw1'
        shutil.copytree(SW1, project, ignore=shutil.ignore_patterns('sample', 'production', '.verification'))
        handbuilt().execute('verify', project / 'project.json', BLENDER)
        result = json.loads((project / 'construction-repeat.json').read_text(encoding='utf-8'))
        self.assertTrue(result['calibration_match'])
        for name, part in result['parts'].items():
            self.assertTrue(part['match'], name)
            self.assertLessEqual(part['max_difference'], TOLERANCE, name)

    def test_sw1_sample_renders_twice_with_identical_pixels(self):
        project = self.tmp / 'sw1'
        shutil.copytree(SW1, project, ignore=shutil.ignore_patterns('sample', 'production', '.verification'))
        handbuilt().execute('sample', project / 'project.json', BLENDER)
        [report] = list((project / 'sample/sw1').glob('*/report.json'))
        result = json.loads(report.read_text(encoding='utf-8'))
        self.assertTrue(result['repeat_pixel_match'])
        self.assertFalse(result['complete'])
        self.assertEqual([p['part'] for p in result['parts']], ['body', 'body-t0', 'body-t1'])
        # Four headings; the body adds a window-light frame per heading, each truck two wheel phases.
        self.assertEqual([p['frames'] for p in result['parts']], [8, 8, 8])


if __name__ == '__main__':
    unittest.main()
