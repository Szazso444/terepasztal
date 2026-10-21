"""Which Blender a step runs on: no real Blender needed, the executable and bpy are faked.

    python -m unittest discover -s tools/asset-pipeline -p test_blender_runner.py -v
"""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.append(str(HERE))
import blender_runner as runner  # noqa: E402

VERSION_521 = """Blender 5.2.1 LTS
\tbuild date: 2026-09-30
\tbuild hash: 9e2066aef7ef
\tbuild branch: blender-v5.2-release
\tbuild platform: Windows
"""

# Stands in for blender.exe: answers --version, and runs `--python <script> -- <args>`.
FAKE_BLENDER = '''#!{python}
import runpy, sys
if sys.argv[1:] == ['--version']:
    print({version!r}, end='')
    raise SystemExit(0)
args = sys.argv[1:]
script = args[args.index('--python') + 1]
sys.argv = [script] + args[args.index('--'):]
runpy.run_path(script, run_name='__main__')
'''

# Writes what the script saw, prints to stdout, and fails when asked to.
PROBE = '''import json, sys
from pathlib import Path
args = sys.argv[sys.argv.index('--') + 1:]
Path(args[0]).write_text(json.dumps(sys.argv))
print('probe output')
if 'fail' in args:
    raise RuntimeError('probe failed on purpose')
if 'exit0' in args:
    raise SystemExit(0)
'''


def fake_bpy(version, label, calls=None):
    module = types.ModuleType('bpy')
    module.app = types.SimpleNamespace(version=version, version_string=label, build_hash=b'9e2066aef7ef')
    reset = (lambda: calls.append('factory reset')) if calls is not None else (lambda: None)
    module.ops = types.SimpleNamespace(wm=types.SimpleNamespace(read_factory_settings=reset))
    return module


class Versions(unittest.TestCase):
    def test_reads_release_and_build_from_blender_version_output(self):
        self.assertEqual(runner.parse_version(VERSION_521), ('5.2.1 LTS', (5, 2, 1), '9e2066aef7ef'))
        self.assertEqual(runner.parse_version('Blender 5.2\n')[:2], ('5.2', (5, 2, 0)))

    def test_other_releases_stop_with_a_message_naming_the_version(self):
        for label, numbers in [('4.2.3 LTS', (4, 2, 3)), ('5.1.0', (5, 1, 0)), ('5.3.0 Alpha', (5, 3, 0))]:
            with self.assertRaises(runner.BlenderUnavailable) as caught:
                runner.check_version(numbers, label, 'blender.exe')
            self.assertIn(f'Blender {label}', str(caught.exception))
            self.assertIn('5.2.x', str(caught.exception))
        runner.check_version((5, 2, 9), '5.2.9', 'blender.exe')

    def test_unreadable_version_output_stops(self):
        with self.assertRaises(runner.BlenderUnavailable):
            runner.parse_version('not blender at all')

    def test_executable_and_bpy_of_one_release_share_an_identity(self):
        exe = runner.Blender('5.2.1 LTS', (5, 2, 1), '9e2066aef7ef', 'blender.exe')
        module = runner.Blender('5.2.1 LTS', (5, 2, 1), '9e2066aef7ef')
        self.assertEqual(exe.identity, module.identity)
        self.assertNotEqual(exe.identity, runner.Blender('5.2.1 LTS', (5, 2, 1), 'other').identity)


class BpyModule(unittest.TestCase):
    def test_without_blender_or_bpy_the_message_says_how_to_get_one(self):
        with mock.patch.object(importlib.util, 'find_spec', return_value=None):
            with self.assertRaises(runner.BlenderUnavailable) as caught:
                runner.resolve(None)
        message = str(caught.exception)
        self.assertIn('cannot import bpy', message)
        self.assertIn('--blender', message)
        self.assertIn('bpy==5.2.1', message)

    def test_bpy_of_another_release_is_refused_by_name(self):
        with mock.patch.object(importlib.util, 'find_spec', return_value=object()), \
                mock.patch.dict(sys.modules, {'bpy': fake_bpy((5, 1, 0), '5.1.0')}):
            with self.assertRaises(runner.BlenderUnavailable) as caught:
                runner.resolve(None)
        self.assertIn('Blender 5.1.0', str(caught.exception))

    def test_bpy_52_runs_the_step_in_this_process_after_a_factory_reset(self):
        calls = []
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(importlib.util, 'find_spec', return_value=object()), \
                mock.patch.dict(sys.modules, {'bpy': fake_bpy((5, 2, 1), '5.2.1 LTS', calls)}):
            blender = runner.resolve(None)
            self.assertIsNone(blender.executable)
            root = Path(tmp)
            (root / 'probe.py').write_text(PROBE)
            argv = list(sys.argv)
            blender.run(root / 'probe.py', [root / 'seen.json', 'x'], log=root / 'step.log')
            self.assertEqual(sys.argv, argv)
            self.assertEqual(calls, ['factory reset'])
            seen = __import__('json').loads((root / 'seen.json').read_text())
            self.assertEqual(seen, [str((root / 'probe.py').resolve()), '--', str(root / 'seen.json'), 'x'])
            self.assertIn('probe output', (root / 'step.log').read_text())
            blender.run(root / 'probe.py', [root / 'seen.json', 'exit0'], log=root / 'step.log')
            with self.assertRaisesRegex(runner.BlenderStepFailed, 'probe failed on purpose'):
                blender.run(root / 'probe.py', [root / 'seen.json', 'fail'], log=root / 'step.log')
            self.assertEqual(sys.argv, argv)
            self.assertIn('RuntimeError', (root / 'step.log').read_text())


@unittest.skipIf(os.name == 'nt', 'the fake Blender executable is a POSIX script')
class Executable(unittest.TestCase):
    def fake(self, root, version):
        path = root / 'blender'
        path.write_text(FAKE_BLENDER.format(python=sys.executable, version=version))
        path.chmod(0o755)
        return path

    def test_missing_executable_stops(self):
        with self.assertRaisesRegex(runner.BlenderUnavailable, 'No Blender executable'):
            runner.resolve('/nonexistent/blender-5.2/blender')

    def test_executable_of_another_release_is_refused_by_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            exe = self.fake(Path(tmp), 'Blender 4.2.3 LTS\n\tbuild hash: abc\n')
            with self.assertRaises(runner.BlenderUnavailable) as caught:
                runner.resolve(str(exe))
            self.assertIn('Blender 4.2.3 LTS', str(caught.exception))

    def test_executable_52_runs_the_step_as_a_background_process(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            blender = runner.resolve(str(self.fake(root, VERSION_521)))
            self.assertEqual(blender.identity, 'Blender 5.2.1 LTS build 9e2066aef7ef')
            (root / 'probe.py').write_text(PROBE)
            blender.run(root / 'probe.py', [root / 'seen.json', 'x'], log=root / 'step.log')
            seen = __import__('json').loads((root / 'seen.json').read_text())
            self.assertEqual(seen[1:], ['--', str(root / 'seen.json'), 'x'])
            self.assertIn('probe output', (root / 'step.log').read_text())
            with self.assertRaisesRegex(runner.BlenderStepFailed, 'exited 1'):
                blender.run(root / 'probe.py', [root / 'seen.json', 'fail'], log=root / 'step.log')


if __name__ == '__main__':
    unittest.main()
