import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../../../src/engine/rng';
import { forAll, SEEDS, shrinkArray } from '../../../src/testing/property';

// Properties of handbuilt/run.py, the hand-built method's recipe boundary: project paths are
// relative with forward slashes and stay inside the project, and a build never reaches Blender
// with inputs that differ from the recipe lock. The module is Python: each property's cases run
// in one Python process, the oracles are here.
const dir = fileURLToPath(new URL('.', import.meta.url));
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

/** Runs `code` with `input` as JSON on stdin; the code writes its answer to the file OUT, its first argument. */
function py(code, input) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'handbuilt-test-'));
  const out = path.join(tmp, 'out.json');
  try {
    const run = spawnSync(python, ['-c', code, out], {
      cwd: dir,
      input: JSON.stringify(input),
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    });
    if (run.error) throw run.error;
    if (run.status !== 0)
      throw new Error(`Python exited ${run.status}:\n${run.stderr.slice(-4000)}`);
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The seeds' cases in one Python run; a case forAll asks for later (shrinking) runs alone. */
function batch(code, gen, seeds = SEEDS) {
  const cases = seeds.map((seed) => gen(new Rng(seed)));
  const results = py(code, cases);
  const known = new Map(cases.map((c, i) => [JSON.stringify(c), results[i]]));
  return (c) => {
    const key = JSON.stringify(c);
    if (!known.has(key)) known.set(key, py(code, [c])[0]);
    return known.get(key);
  };
}

const PRELUDE = `
import importlib.util, json, shutil, sys, tempfile
OUT = sys.argv[1]
from pathlib import Path
from unittest import mock
cases = json.loads(sys.stdin.buffer.read().decode('utf-8'))
def done(results):
    with open(OUT, 'w', encoding='utf-8') as out:
        json.dump(results, out)
def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
`;

// ---- Project paths ------------------------------------------------------------------------------

// Path pieces: names, dots, a space, non-ASCII, drive letters, a colon, backslashes, home markers.
// A drive and a separator are joined at run time: shipped files hold no literal drive path
// (handbuilt-method.test.mjs).
const drive = (letter, separator) => `${letter}:${separator}`;
const SEGMENTS = [
  'a',
  'B',
  'model',
  '01.png',
  '.',
  '..',
  '..',
  '',
  ' ',
  'é',
  'C:',
  'z:',
  'x:y',
  'a\\b',
  '..\\..',
  `${drive('C', '\\')}DEV`,
  '~',
  '%USERPROFILE%',
];
const PREFIXES = [
  '',
  '',
  '',
  '',
  '/',
  '//',
  drive('C', ''),
  drive('C', '/'),
  drive('d', '\\'),
  '\\\\server\\share\\',
  '\\',
  './',
];

const projectPath = (rng) =>
  rng.pick(PREFIXES) + Array.from({ length: rng.int(0, 4) }, () => rng.pick(SEGMENTS)).join('/');

/** The oracle: one relative path on Windows and on POSIX, written with forward slashes. */
const portable = (name) =>
  name !== '' &&
  !name.includes('\\') &&
  !path.posix.isAbsolute(name) &&
  path.win32.parse(name).root === '';

function* shrinkName(name) {
  for (let i = 0; i < name.length; i++) yield name.slice(0, i) + name.slice(i + 1);
}

describe('handbuilt/run.py: project paths', () => {
  it('accepts exactly the paths that are relative on Windows and POSIX and use forward slashes, and keeps them inside the project', () => {
    const run = batch(
      `${PRELUDE}
cli = load('run.py', 'handbuilt_run')
root = Path(tempfile.mkdtemp()).resolve()
results = []
for name in cases:
    result = {'root': str(root)}
    try:
        cli.relative(name)
        result['relative'] = None
    except ValueError as error:
        result['relative'] = str(error)
    try:
        result['local'] = str(cli.local(root, name))
    except ValueError as error:
        result['local'], result['error'] = None, str(error)
    results.append(result)
shutil.rmtree(root)
done(results)`,
      projectPath,
    );
    forAll(
      projectPath,
      (name) => {
        const r = run(name);
        expect(r.relative === null, `relative(${JSON.stringify(name)})`).toBe(portable(name));
        if (!portable(name)) {
          expect(r.local, 'a refused path is refused by local too').toBeNull();
          return;
        }
        // Inside the project: the path a lexical walk from the project folder ends at, or below it.
        const target = path.resolve(r.root, name);
        if (target === r.root || target.startsWith(r.root + path.sep)) {
          expect(r.local).toBe(target);
        } else {
          expect(r.local, `${name} leaves the project`).toBeNull();
          expect(r.error).toContain('within their project');
        }
      },
      { shrink: shrinkName },
    );
  }, 60_000);
});

// ---- The recipe lock ----------------------------------------------------------------------------

// The SW1 v4 project and the pipeline it is locked to, copied to a scratch folder; one edited
// input per case, restored after it. `build` runs with Blender replaced by a sentinel, so reaching
// it means the lock accepted the inputs. Unchanged means equal bytes for a picture and equal once
// CRLF is read as LF for a text file: what the lock must accept on either checkout.
const LOCK = `${PRELUDE}
HERE = Path.cwd()
SW1 = HERE.parent.parent.parent / 'assets/source/sw1-picture-v4-2026-10-08'
tmp = Path(tempfile.mkdtemp()).resolve()
pipeline = tmp / 'pipeline'
(pipeline / 'handbuilt').mkdir(parents=True)
for name in ['blender_runner.py', 'filehash.py']:
    shutil.copy2(HERE.parent / name, pipeline / name)
for name in ['run.py', 'build_stage.py']:
    shutil.copy2(HERE / name, pipeline / 'handbuilt' / name)
project = tmp / 'sw1'
shutil.copytree(SW1, project, ignore=shutil.ignore_patterns('model', 'sample', 'production', '.verification'))
cli = load(pipeline / 'handbuilt/run.py', 'handbuilt_copy')
lock = project / 'recipe-lock.json'
files = {name: pipeline / 'handbuilt' / name.split('/')[1] if name.startswith('pipeline/') else project / name
         for name in json.loads(lock.read_text(encoding='utf-8'))['inputs']}

class Reached(Exception):
    pass

def attempt(command):
    with mock.patch.object(cli.blender_runner, 'resolve', side_effect=Reached):
        try:
            cli.execute(command, project / 'project.json')
            return 'done'
        except Reached:
            return 'blender'
        except Exception as error:
            return f'{type(error).__name__}: {error}'

def apply(data, edits):
    for edit in edits:
        at, op = int(edit['at'] * (len(data) + 1)), edit['op']
        if op == 'insert':
            data = data[:at] + bytes([edit['byte']]) + data[at:]
        elif op in ('delete', 'replace') and data:
            at = min(at, len(data) - 1)
            data = data[:at] + (bytes([edit['byte']]) if op == 'replace' else b'') + data[at + 1:]
        elif op == 'crlf':
            data = data.replace(b'\\r\\n', b'\\n').replace(b'\\n', b'\\r\\n')
        elif op == 'lf':
            data = data.replace(b'\\r\\n', b'\\n')
        elif op == 'crBeforeLf':
            i = data.find(b'\\n', at)
            if i > 0 and data[i - 1:i] != b'\\r':
                data = data[:i] + b'\\r' + data[i:]
    return data

results = []
lock_bytes = lock.read_bytes()
for c in cases:
    if c == 'INPUTS':
        results.append(sorted(files))
        continue
    target = files[c['input']]
    original = target.read_bytes()
    edited = apply(original, c['edits'])
    target.write_bytes(edited)
    try:
        build = attempt('build')
        relock = attempt('lock')
        rebuild = attempt('build') if relock == 'done' else None
    finally:
        target.write_bytes(original)
        lock.write_bytes(lock_bytes)
    if target.suffix.lower() == '.png':
        unchanged = edited == original
    else:
        unchanged = edited.replace(b'\\r\\n', b'\\n') == original.replace(b'\\r\\n', b'\\n')
    results.append({'build': build, 'relock': relock, 'rebuild': rebuild, 'unchanged': unchanged,
                    'bytesChanged': edited != original})
shutil.rmtree(tmp)
done(results)`;

const OPS = ['insert', 'delete', 'replace', 'crlf', 'lf', 'crBeforeLf'];
const LINE_ENDS = ['crlf', 'lf', 'crBeforeLf'];
const BYTES = [0x0a, 0x0d, 0x20, 0x22, 0x30, 0x61, 0x7b, 0x00, 0xc3, 0xff];

describe('handbuilt/run.py: the recipe lock', () => {
  const [inputs] = py(LOCK, ['INPUTS']);

  it('locks the SW1 v4 to its project files and the pipeline that builds it', () => {
    expect(inputs).toEqual(
      expect.arrayContaining([
        'project.json',
        'build.py',
        'observations.json',
        'references/01.png',
        'pipeline/run.py',
        'pipeline/build_stage.py',
      ]),
    );
    const [pristine] = py(LOCK, [{ input: 'project.json', edits: [] }]);
    expect(pristine.build, 'the committed lock holds for the committed inputs').toBe('blender');
  }, 60_000);

  it('never reaches Blender with an input that differs from the lock, and a relock accepts it', () => {
    // An edit only to line ends is no change: a CRLF checkout of the same commit must build.
    const gen = (rng) => {
      const ops = rng.chance(0.4) ? LINE_ENDS : OPS;
      return {
        input: rng.pick(inputs),
        edits: Array.from({ length: rng.int(1, 3) }, () => ({
          op: rng.pick(ops),
          at: Math.floor(rng.next() * 1000) / 1000,
          byte: rng.pick(BYTES),
        })),
      };
    };
    const run = batch(LOCK, gen);
    const outcomes = SEEDS.map((seed) => run(gen(new Rng(seed))));
    // Both kinds of case occur, so neither half of the property holds by default.
    expect(outcomes.filter((r) => r.unchanged && r.bytesChanged).length).toBeGreaterThan(10);
    expect(outcomes.filter((r) => !r.unchanged).length).toBeGreaterThan(30);
    forAll(
      gen,
      (c) => {
        const r = run(c);
        expect(r.build === 'blender', `build after the edit: ${r.build}`).toBe(r.unchanged);
        if (r.unchanged) expect(r.relock).toBe('done');
        if (r.relock === 'done') expect(r.rebuild, 'build after relocking').toBe('blender');
      },
      { shrink: (c) => [...shrinkArray(c.edits)].map((edits) => ({ ...c, edits })) },
    );
  }, 120_000);
});
