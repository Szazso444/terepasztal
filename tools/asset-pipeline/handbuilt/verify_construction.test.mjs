import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../../../src/engine/rng';
import { forAll, SEEDS, shrinkArray } from '../../../src/testing/property';

// Properties of handbuilt/verify_construction.py, which decides whether a replayed recipe built
// the same model: names, parents, topology, materials and smoothing equal, every transform and
// vertex coordinate within TOLERANCE (1e-6), calibration numbers within it too. A NaN or an
// infinity on either side is a mismatch, never a difference of 0. The script needs bpy at import,
// so its imports (bpy left out), functions and TOLERANCE are read out of its syntax tree and run
// without Blender; the oracles are here.
const dir = fileURLToPath(new URL('.', import.meta.url));
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const TOLERANCE = 1e-6;

/** JSON that keeps NaN and the infinities, as the tokens `__NaN__`, `__Infinity__`, `__-Infinity__`. */
const encode = (value) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === 'number' && !Number.isFinite(v) ? `__${v}__` : v,
  );

/** Runs `code` with `input` on stdin; the code writes its answer to the file OUT, its first argument. */
function py(code, input) {
  const tmp = mkdtempSync(join(tmpdir(), 'verify-test-'));
  const out = join(tmp, 'out.json');
  try {
    const run = spawnSync(python, ['-c', code, out], {
      cwd: dir,
      input: encode(input),
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
  const known = new Map(cases.map((c, i) => [encode(c), results[i]]));
  return (c) => {
    const key = encode(c);
    if (!known.has(key)) known.set(key, py(code, [c])[0]);
    return known.get(key);
  };
}

// The script's top-level imports but bpy, its functions and TOLERANCE, without the replay.
const PRELUDE = `
import ast, json, math, sys
OUT = sys.argv[1]
from pathlib import Path
tree = ast.parse(Path('verify_construction.py').read_text(encoding='utf-8'))
wanted = {'TOLERANCE', 'compare', 'close'}
def kept(node):
    if isinstance(node, ast.Import):
        node.names = [a for a in node.names if a.name.split('.')[0] != 'bpy']
        return bool(node.names)
    if isinstance(node, ast.ImportFrom):
        return node.level == 0 and (node.module or '').split('.')[0] != 'bpy'
    if isinstance(node, ast.FunctionDef):
        return True
    return isinstance(node, ast.Assign) and any(getattr(t, 'id', None) in wanted for t in node.targets)
nodes = [n for n in tree.body if kept(n)]
found = {n.name if isinstance(n, ast.FunctionDef) else n.targets[0].id
         for n in nodes if isinstance(n, (ast.FunctionDef, ast.Assign))}
if not wanted <= found:
    raise SystemExit(f'verify_construction.py no longer defines {sorted(wanted - found)} at top level')
script = {}
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'verify_construction.py', 'exec'), script)
NONFINITE = {'__NaN__': math.nan, '__Infinity__': math.inf, '__-Infinity__': -math.inf}
def decode(value):
    if isinstance(value, str) and value in NONFINITE:
        return NONFINITE[value]
    if isinstance(value, list):
        return [decode(v) for v in value]
    if isinstance(value, dict):
        return {k: decode(v) for k, v in value.items()}
    return value
cases = decode(json.loads(sys.stdin.buffer.read().decode('utf-8')))
def done(results):
    with open(OUT, 'w', encoding='utf-8') as out:
        json.dump(results, out)
`;

// compare's answer for each case: the match the script makes of it, and the difference it would
// write to construction-repeat.json (a finite float, None, or the repr of anything else).
const COMPARE = `${PRELUDE}
results = []
for c in cases:
    worst = script['compare'](c['a'], c['b'])
    match = worst is not None and worst <= script['TOLERANCE']
    finite = worst is None or (isinstance(worst, float) and math.isfinite(worst))
    results.append({'match': match, 'worst': worst if finite else repr(worst)})
done(results)`;

// ---- Replayed geometry --------------------------------------------------------------------------

const round = (x) => Math.round(x * 1e4) / 1e4;

/** A record as read_model writes it: an object, and for a mesh its evaluated geometry. */
function record(rng, i) {
  const mesh = rng.chance(0.7);
  const r = {
    name: `Part ${i}`,
    type: mesh ? 'MESH' : 'EMPTY',
    matrix: Array.from({ length: 16 }, () => round(rng.range(-3, 3))),
    parent: rng.chance(0.3) ? 'Wheel pivot' : null,
  };
  if (!mesh) return r;
  const n = rng.int(1, 4);
  r.vertices = Array.from({ length: n }, () => [0, 0, 0].map(() => round(rng.range(-2, 2))));
  r.faces = [Array.from({ length: n }, (_, k) => k)];
  r.face_materials = [0];
  r.smooth = [rng.chance(0.5)];
  r.materials = [
    {
      name: rng.pick(['Paint / charcoal blue', 'Brushed steel']),
      colour: [round(rng.next()), round(rng.next()), round(rng.next()), 1],
      inputs: { Roughness: round(rng.next()), Metallic: 0 },
    },
  ];
  return r;
}

// Coordinate shifts around the tolerance (half of all changes), and changes to everything that
// must be equal.
const DELTAS = [0, 1e-9, 3e-7, 9.9e-7, 1e-6, 1.01e-6, 2e-6, 1e-3, 0.5];
const KINDS = ['nan', 'inf', 'rename', 'parent', 'face', 'smooth', 'colour'];
const MORE = ['dropVertex', 'dropRecord', 'empty'];
// A NaN or an infinity goes into the replay, the committed model, or the same place in both.
const NONFINITE = ['nan', 'inf'];
const SIDES = ['replay', 'replay', 'model', 'both'];
const onModel = (m) => NONFINITE.includes(m.kind) && m.side !== 'replay';
const onReplay = (m) => !NONFINITE.includes(m.kind) || m.side !== 'model';

/** Applies one change to a copy of `records`; returns the copy. */
function change(records, m) {
  const b = structuredClone(records);
  if (!b.length) return b;
  const r = b[Math.floor(m.at * b.length)];
  const coords = [
    ...r.matrix.map((_, k) => [r.matrix, k]),
    ...(r.vertices ?? []).flatMap((v) => v.map((_, k) => [v, k])),
  ];
  const [array, k] = coords[Math.floor(m.at2 * coords.length)];
  if (m.kind === 'shift') array[k] += m.sign * m.delta;
  else if (m.kind === 'nan') array[k] = NaN;
  else if (m.kind === 'inf') array[k] = m.sign * Infinity;
  else if (m.kind === 'rename') r.name += ' 2';
  else if (m.kind === 'parent') r.parent = r.parent ? null : 'Wheel pivot';
  else if (m.kind === 'face' && r.faces) r.faces[0] = [...r.faces[0]].reverse();
  else if (m.kind === 'smooth' && r.smooth) r.smooth = [!r.smooth[0]];
  else if (m.kind === 'colour' && r.materials) r.materials[0].colour[0] += 1e-9;
  else if (m.kind === 'dropVertex' && r.vertices) r.vertices.pop();
  else if (m.kind === 'dropRecord') b.splice(b.indexOf(r), 1);
  else if (m.kind === 'empty' && r.vertices) {
    for (const key of ['vertices', 'faces', 'face_materials', 'smooth', 'materials']) delete r[key];
    r.type = 'EMPTY';
  }
  return b;
}

const modelCase = (rng) => ({
  records: Array.from({ length: rng.int(1, 3) }, (_, i) => record(rng, i)),
  changes: Array.from({ length: rng.int(0, 3) }, () => ({
    kind: rng.chance(0.5) ? 'shift' : rng.pick(rng.chance(0.8) ? KINDS : MORE),
    at: rng.next(),
    at2: rng.next(),
    sign: rng.pick([1, -1]),
    delta: rng.pick(DELTAS),
    side: rng.pick(SIDES),
  })),
});

/** The case as compare gets it: the committed model's records (a) and the replay's (b). */
function withReplay(c) {
  const { records, changes } = c;
  const a = changes.filter(onModel).reduce(change, records);
  const b = changes.filter(onReplay).reduce(change, records);
  return { records, changes, a, b };
}

/** Everything but coordinates equal: record count, keys, every other field, vertex counts. */
function sameButCoordinates(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    const keys = Object.keys(x).sort();
    if (JSON.stringify(keys) !== JSON.stringify(Object.keys(y).sort())) return false;
    for (const key of keys) {
      if (key === 'matrix' || key === 'vertices') continue;
      if (JSON.stringify(x[key]) !== JSON.stringify(y[key])) return false;
    }
    return (x.vertices ?? []).length === (y.vertices ?? []).length;
  });
}

/** A record's coordinates in compare's order: the matrix, then each vertex. */
const coordinates = (r) => [r.matrix, ...(r.vertices ?? [])].flat();

/** The oracle: everything but coordinates equal, and every coordinate pair within TOLERANCE. */
function matches(a, b) {
  if (!sameButCoordinates(a, b)) return false;
  return a.every((x, i) => {
    const p = coordinates(x);
    const q = coordinates(b[i]);
    return p.length === q.length && p.every((v, k) => Math.abs(v - q[k]) <= TOLERANCE);
  });
}

/** The oracle for the difference compare reports: the largest coordinate difference, or null
 * when anything but coordinates differs or a difference is not finite (a NaN or an infinity). */
function largestDifference(a, b) {
  if (!sameButCoordinates(a, b)) return null;
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    const p = coordinates(a[i]);
    const q = coordinates(b[i]);
    if (p.length !== q.length) return null;
    for (let k = 0; k < p.length; k++) {
      const d = Math.abs(p[k] - q[k]);
      if (!Number.isFinite(d)) return null;
      worst = Math.max(worst, d);
    }
  }
  return worst;
}

function* shrinkModel(c) {
  for (const changes of shrinkArray(c.changes)) yield { ...c, changes };
  for (const records of shrinkArray(c.records)) if (records.length) yield { ...c, records };
  for (let i = 0; i < c.records.length; i++) {
    const r = c.records[i];
    if (r.vertices && r.vertices.length > 1) {
      const fewer = { ...r, vertices: r.vertices.slice(1), faces: [r.faces[0].slice(1)] };
      yield { ...c, records: c.records.map((x, k) => (k === i ? fewer : x)) };
    }
    if (r.matrix.some((v) => v !== 0)) {
      const zero = { ...r, matrix: r.matrix.map(() => 0) };
      yield { ...c, records: c.records.map((x, k) => (k === i ? zero : x)) };
    }
  }
}

// 400 seeds, one Python run: about 50 cases each of a NaN or an infinity (on every side) and of a
// largest difference within a factor of two of the tolerance.
const MODEL_SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

describe('verify_construction: does a replay match the model', () => {
  it('matches exactly when all but coordinates are equal and every coordinate is within 1e-6', () => {
    const gen = (rng) => withReplay(modelCase(rng));
    const run = batch(COMPARE, gen, MODEL_SEEDS);
    forAll(
      gen,
      (c) => {
        expect(run(c)).toEqual({ match: matches(c.a, c.b), worst: largestDifference(c.a, c.b) });
      },
      { seeds: MODEL_SEEDS, shrink: (c) => [...shrinkModel(c)].map(withReplay) },
    );
  }, 60_000);

  it('a NaN or an infinity on either side is a mismatch with no difference reported', () => {
    // Seed 14's smallest case before 5b99ae75 (a NaN in the replay compared as 0) and its kin.
    const empty = (matrix) => [{ name: 'Part 1', type: 'EMPTY', matrix, parent: null }];
    const at5 = (v) => Array.from({ length: 16 }, (_, k) => (k === 5 ? v : 0));
    const examples = [
      ['a NaN in the replay', at5(0), at5(NaN)],
      ['a NaN in the model', at5(NaN), at5(0)],
      ['the same NaN in both', at5(NaN), at5(NaN)],
      ['an infinity in the replay', at5(0), at5(Infinity)],
      ['the same infinity in both', at5(-Infinity), at5(-Infinity)],
    ];
    const results = py(
      COMPARE,
      examples.map(([, a, b]) => ({ a: empty(a), b: empty(b) })),
    );
    examples.forEach(([name, a, b], i) => {
      expect(largestDifference(empty(a), empty(b)), name).toBe(null);
      expect(results[i], name).toEqual({ match: false, worst: null });
    });
  });
});

// ---- Calibration --------------------------------------------------------------------------------

/** A calibration.json as the SW1 writes it: per part, its tiles and axles. */
const calibration = (rng) =>
  Array.from({ length: rng.int(1, 3) }, (_, i) => ({
    part: i ? `body-t${i - 1}` : 'body',
    tiles: [round(rng.range(0.5, 3)) + 0.00005, 0.24],
    axles: Array.from({ length: rng.int(0, 2) }, () => ({
      x_m: round(rng.range(-2, 2)) + 0.00005,
    })),
    count: rng.int(0, 4),
  }));

/** Applies one change to a copy of a calibration: a number moved or not finite, a count, a key or a string. */
function recalibrate(value, m) {
  const b = structuredClone(value);
  const part = b[Math.floor(m.at * b.length)];
  if (m.kind === 'shift') part.tiles[0] += m.sign * m.delta;
  else if (m.kind === 'axle' && part.axles.length) part.axles[0].x_m += m.sign * m.delta;
  else if (m.kind === 'nan') part.tiles[0] = NaN;
  else if (m.kind === 'inf') part.tiles[0] = m.sign * Infinity;
  else if (m.kind === 'count') part.count += 1;
  else if (m.kind === 'key') part.Tiles = part.tiles;
  else if (m.kind === 'string') part.part += 'x';
  else if (m.kind === 'drop' && part.axles.length) part.axles.pop();
  return b;
}

/** The oracle: the same structure, numbers within TOLERANCE, anything else equal. */
function close(x, y) {
  if (Array.isArray(x))
    return Array.isArray(y) && x.length === y.length && x.every((v, i) => close(v, y[i]));
  if (x !== null && typeof x === 'object') {
    if (y === null || typeof y !== 'object' || Array.isArray(y)) return false;
    const keys = Object.keys(x).sort();
    if (JSON.stringify(keys) !== JSON.stringify(Object.keys(y).sort())) return false;
    return keys.every((k) => close(x[k], y[k]));
  }
  if (typeof x === 'number' || typeof y === 'number') {
    return typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) <= TOLERANCE;
  }
  return x === y;
}

describe('verify_construction: does a replayed calibration match', () => {
  it('matches exactly when the structure is equal and every number is within 1e-6', () => {
    const gen = (rng) => {
      const value = calibration(rng);
      const changes = Array.from({ length: rng.int(0, 2) }, () => ({
        kind: rng.pick(['shift', 'shift', 'axle', 'nan', 'inf', 'count', 'key', 'string', 'drop']),
        at: rng.next(),
        sign: rng.pick([1, -1]),
        delta: rng.pick(DELTAS),
        side: rng.pick(SIDES),
      }));
      const a = changes.filter(onModel).reduce(recalibrate, value);
      return { a, changes, b: changes.filter(onReplay).reduce(recalibrate, value) };
    };
    const run = batch(
      `${PRELUDE}
done([script['close'](c['a'], c['b']) for c in cases])`,
      gen,
    );
    forAll(gen, (c) => {
      expect(run(c)).toBe(close(c.a, c.b));
    });
  }, 60_000);
});
