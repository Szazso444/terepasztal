"""Where a step of the hand-built method finds Blender: an executable, or the bpy module.

Every Blender step (the C-50 build, handbuilt/ and painted/) goes through `resolve`:

- `--blender <exe>`: the step runs as
  `<exe> -b --factory-startup --python-exit-code 1 --python <script> -- <args>`,
  one fresh Blender process per step. This is how the author's PC runs it.
- no `--blender`: the step runs in this Python process through `import bpy`
  (Python 3.13, `pip install bpy==5.2.1`), after a factory reset, with `sys.argv` set to
  `<script> -- <args>`. This is how the cloud runs it.

Either way the Blender must be 5.2.x, the release the accepted C-50 and SW1 were built with;
anything else stops with a message naming the version found.

Run one script by hand (the C-50 build, a diagnostic):

    python tools/asset-pipeline/blender_runner.py [--blender <exe>] [--log <file>] <script.py> [args...]
"""
import argparse
import contextlib
import importlib.util
import os
from pathlib import Path
import re
import runpy
import shutil
import subprocess
import sys
import traceback

REQUIRED = (5, 2)
REQUIRED_TEXT = '5.2.x'
INSTALL_HINT = (
    'pass --blender <path to a Blender 5.2.x executable>, or run with a Python 3.13 that can '
    'import bpy 5.2.x (pip install bpy==5.2.1)'
)


class BlenderUnavailable(SystemExit):
    """No usable Blender. Uncaught, it prints its message and exits with status 1."""


class BlenderStepFailed(RuntimeError):
    """A Blender step raised or exited non-zero. The message names its log."""


def parse_version(text):
    """`blender --version` output -> ('5.2.1 LTS', (5, 2, 1), '9e2066aef7ef')."""
    match = re.search(r'^Blender (\d+)\.(\d+)(?:\.(\d+))?([^\r\n]*)', text, re.M)
    if not match:
        raise BlenderUnavailable(f'Could not read a Blender version from: {text.strip()[:200]!r}')
    numbers = (int(match[1]), int(match[2]), int(match[3] or 0))
    label = f'{match[1]}.{match[2]}' + (f'.{match[3]}' if match[3] else '') + match[4].rstrip()
    build = re.search(r'build hash:\s*(\S+)', text)
    return label, numbers, build[1] if build else 'unknown'


def check_version(numbers, label, where):
    if tuple(numbers[:2]) != REQUIRED:
        raise BlenderUnavailable(
            f'{where} is Blender {label}; the hand-built method needs Blender {REQUIRED_TEXT}: '
            + INSTALL_HINT
        )


def _tail(log, lines=25):
    if not log or not Path(log).is_file():
        return ''
    text = Path(log).read_text(encoding='utf-8', errors='replace').splitlines()
    return '\n' + '\n'.join(text[-lines:])


@contextlib.contextmanager
def _output_to(log):
    """Send this process's stdout and stderr, Blender's C-level output included, to `log`."""
    if log is None:
        yield
        return
    Path(log).parent.mkdir(parents=True, exist_ok=True)
    sys.stdout.flush()
    sys.stderr.flush()
    saved = os.dup(1), os.dup(2)
    with open(log, 'w', encoding='utf-8') as out:
        os.dup2(out.fileno(), 1)
        os.dup2(out.fileno(), 2)
        try:
            yield
        finally:
            sys.stdout.flush()
            sys.stderr.flush()
            os.dup2(saved[0], 1)
            os.dup2(saved[1], 2)
            os.close(saved[0])
            os.close(saved[1])


class Blender:
    """A resolved Blender 5.2.x: `executable` is None for the bpy module in this process."""

    def __init__(self, label, numbers, build, executable=None):
        self.label, self.numbers, self.build, self.executable = label, tuple(numbers), build, executable

    @property
    def identity(self):
        """Release and build: the same for an executable and the bpy module of one release."""
        return f'Blender {self.label} build {self.build}'

    def __str__(self):
        where = f'executable {self.executable}' if self.executable else f'bpy module in {sys.executable}'
        return f'{self.identity} ({where})'

    def run(self, script, args=(), log=None):
        """Run `script` with `args` after `--`; raise BlenderStepFailed if it fails."""
        script = Path(script).resolve()
        args = [str(a) for a in args]
        if self.executable:
            command = [self.executable, '-b', '--factory-startup', '--python-exit-code', '1',
                       '--python', str(script), '--', *args]
            if log is None:
                code = subprocess.run(command).returncode
            else:
                Path(log).parent.mkdir(parents=True, exist_ok=True)
                with open(log, 'w', encoding='utf-8') as out:
                    code = subprocess.run(command, stdout=out, stderr=subprocess.STDOUT).returncode
            if code:
                raise BlenderStepFailed(f'{script.name} exited {code}; log: {log}' + _tail(log))
            return
        self._run_in_process(script, args, log)

    def _run_in_process(self, script, args, log):
        import bpy

        argv, failure = sys.argv, None
        sys.argv = [str(script), '--', *args]
        try:
            with _output_to(log):
                try:
                    # The same clean start as --factory-startup.
                    bpy.ops.wm.read_factory_settings()
                    runpy.run_path(str(script), run_name='__main__')
                except SystemExit as stop:
                    if stop.code not in (None, 0):
                        traceback.print_exc()
                        failure = stop
                except Exception as error:  # noqa: BLE001 - reported with the log below
                    traceback.print_exc()
                    failure = error
        finally:
            sys.argv = argv
        if failure is not None:
            # The chained traceback is the script's own; the log holds Blender's output around it.
            raise BlenderStepFailed(f'{script.name} failed: {failure}; log: {log}') from failure


def resolve(blender=None):
    """`--blender` value (or None) -> a Blender 5.2.x, or BlenderUnavailable naming what was found."""
    if isinstance(blender, Blender):
        return blender
    if blender:
        executable = shutil.which(blender) or blender
        if not Path(executable).is_file():
            raise BlenderUnavailable(f'No Blender executable at {blender}: ' + INSTALL_HINT)
        try:
            text = subprocess.run([executable, '--version'], capture_output=True, text=True,
                                  check=True).stdout
        except (OSError, subprocess.CalledProcessError) as error:
            raise BlenderUnavailable(f'Could not run {blender} --version: {error}') from error
        label, numbers, build = parse_version(text)
        check_version(numbers, label, executable)
        return Blender(label, numbers, build, str(executable))
    if importlib.util.find_spec('bpy') is None:
        raise BlenderUnavailable(f'No Blender: {sys.executable} cannot import bpy; ' + INSTALL_HINT)
    try:
        import bpy
    except ImportError as error:
        raise BlenderUnavailable(f'bpy is installed for {sys.executable} but does not import: {error}') from error
    label = bpy.app.version_string
    check_version(bpy.app.version, label, f'bpy in {sys.executable}')
    return Blender(label, bpy.app.version, bpy.app.build_hash.decode())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--blender', help='Blender 5.2.x executable; omitted: the bpy module of this Python')
    parser.add_argument('--log', type=Path, help='write the step output here instead of the console')
    parser.add_argument('script', type=Path)
    parser.add_argument('args', nargs=argparse.REMAINDER, help='passed to the script after --')
    options = parser.parse_args(argv)
    blender = resolve(options.blender)
    print(f'Running {options.script} with {blender}', flush=True)
    blender.run(options.script, options.args, options.log)


if __name__ == '__main__':
    main()
