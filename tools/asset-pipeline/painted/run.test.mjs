import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../../../src/engine/rng';
import { forAll, SEEDS, shrinkArray } from '../../../src/testing/property';

// Properties of painted/run.py, the renderer's cache: a bundle is reused only while its receipt
// holds for every file it lists, and the render key follows the Blender release and build, not
// how that Blender is reached. The module is Python: each property's cases run in one Python
// process, the oracles are here.
const dir = fileURLToPath(new URL('.', import.meta.url));
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

/** Runs `code` with `input` as JSON on stdin; the code writes its answer to the file OUT, its first argument. */
function py(code, input) {
  const tmp = mkdtempSync(join(tmpdir(), 'painted-test-'));
  const out = join(tmp, 'out.json');
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
import base64, importlib.util, json, sys, tempfile
OUT = sys.argv[1]
from pathlib import Path
spec = importlib.util.spec_from_file_location('painted_run', 'run.py')
painted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(painted)
cases = json.loads(sys.stdin.buffer.read().decode('utf-8'))
def done(results):
    with open(OUT, 'w', encoding='utf-8') as out:
        json.dump(results, out)
`;

// ---- The receipt --------------------------------------------------------------------------------

const NAMES = [
  'atlas/rolling-painted-1.png',
  'atlas/rolling-painted-1.json',
  'frames/loco_c50_body_f0.png',
  'fit-patch.json',
  'report.json',
  'inputs.json',
];
const ALPHABET = ['a', '{', '"', ' ', '\n', '\n', '\r\n', '\0', 'é'];
const KINDS = ['none', 'none', 'edit', 'lineEnds', 'delete', 'extra', 'key', 'empty', 'noReceipt'];
const bytesOf = (parts) => Buffer.from(parts.join(''), 'utf8');
const toCrlf = (b) => Buffer.from(b.toString('latin1').replace(/\r?\n/g, '\r\n'), 'latin1');
const crlfAsLf = (b) => Buffer.from(b.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

/** A bundle, its receipt as build writes it, and one later change to the bundle or the receipt. */
function bundleCase(rng) {
  const names = rng.shuffle([...NAMES]).slice(0, rng.int(1, 4));
  return {
    files: names.map((name) => ({
      name,
      parts: Array.from({ length: rng.int(0, 12) }, () => rng.pick(ALPHABET)),
    })),
    kind: rng.pick(KINDS),
    which: rng.next(),
    at: rng.next(),
  };
}

/** The bundle before and after the change, as bytes; `null` after: the file was deleted. */
function bundleFiles(c) {
  const target = Math.floor(c.which * c.files.length);
  return c.files.map((f, i) => {
    const before = bytesOf(f.parts);
    let after = before;
    if (i === target && c.kind === 'delete') after = null;
    if (i === target && c.kind === 'lineEnds') after = toCrlf(before);
    if (i === target && c.kind === 'edit') {
      const at = Math.floor(c.at * (before.length + 1));
      after = Buffer.concat([before.subarray(0, at), Buffer.from('x'), before.subarray(at)]);
    }
    return { name: f.name, before, after };
  });
}

/** The oracle: reused exactly when the receipt is there, keyed alike, lists files, and they hold. */
function reusable(c) {
  if (['key', 'empty', 'noReceipt'].includes(c.kind)) return false;
  return bundleFiles(c).every(
    ({ name, before, after }) =>
      after !== null &&
      (name.endsWith('.json') ? crlfAsLf(after).equals(crlfAsLf(before)) : after.equals(before)),
  );
}

describe('painted/run.py: the render cache', () => {
  it('reuses a bundle exactly while its receipt holds for every file it lists', () => {
    // A text file whose line ends alone changed still holds: the same bundle on a CRLF checkout.
    const input = (c) => ({
      files: bundleFiles(c).map((f) => ({
        name: f.name,
        before: f.before.toString('base64'),
        after: f.after && f.after.toString('base64'),
      })),
      kind: c.kind,
    });
    const run = batch(
      `${PRELUDE}
results = []
for c in cases:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / 'bundle'
        for f in c['files']:
            (out / f['name']).parent.mkdir(parents=True, exist_ok=True)
            (out / f['name']).write_bytes(base64.b64decode(f['before']))
        listed = {} if c['kind'] == 'empty' else {f['name']: painted.digest(out / f['name']) for f in c['files']}
        painted.write(out / 'receipt.json', {'key': 'key', 'files': listed})
        for f in c['files']:
            if f['after'] is None:
                (out / f['name']).unlink()
            else:
                (out / f['name']).write_bytes(base64.b64decode(f['after']))
        if c['kind'] == 'extra':
            (out / 'atlas' / 'unlisted.png').parent.mkdir(parents=True, exist_ok=True)
            (out / 'atlas' / 'unlisted.png').write_bytes(b'not in the receipt')
        if c['kind'] == 'noReceipt':
            (out / 'receipt.json').unlink()
        results.append(painted.cached(out, 'other key' if c['kind'] == 'key' else 'key'))
done(results)`,
      (rng) => input(bundleCase(rng)),
    );
    const cases = SEEDS.map((seed) => bundleCase(new Rng(seed)));
    expect(cases.filter(reusable).length, 'some bundles are reusable').toBeGreaterThan(20);
    forAll(
      bundleCase,
      (c) => {
        expect(run(input(c)), c.kind).toBe(reusable(c));
      },
      {
        shrink: (c) =>
          [...shrinkArray(c.files)]
            .filter((files) => files.length)
            .map((files) => ({ ...c, files })),
      },
    );
  }, 60_000);

  it('keys a render by the Blender release and build, whether an executable or the bpy module', () => {
    const BLENDERS = [
      { label: '5.2.1 LTS', build: '9e2066aef7ef' },
      { label: '5.2.1 LTS', build: 'aaaaaaaaaaaa' },
      { label: '5.2.0', build: '9e2066aef7ef' },
      { label: '5.2.2 LTS', build: '0123456789ab' },
    ];
    const EXECUTABLES = [null, 'blender.exe', '/opt/blender-5.2.1/blender'];
    const blender = (rng) => ({ ...rng.pick(BLENDERS), executable: rng.pick(EXECUTABLES) });
    const gen = (rng) => [blender(rng), blender(rng)];
    const run = batch(
      `${PRELUDE}
manifest, profile = painted.load_manifest('manifests/c50.json')
def key(b):
    numbers = [int(n) for n in b['label'].split()[0].split('.')]
    return painted.signature(manifest, profile, painted.blender_runner.Blender(b['label'], numbers, b['build'], b['executable']))[0]
done([key(a) == key(b) for a, b in cases])`,
      gen,
    );
    forAll(gen, ([a, b]) => {
      expect(run([a, b])).toBe(a.label === b.label && a.build === b.build);
    });
  }, 60_000);
});
