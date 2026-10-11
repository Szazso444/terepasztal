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
// vertex coordinate within TOLERANCE (1e-6), calibration numbers within it too. The script needs
// bpy at import, so its pure functions (compare, close, TOLERANCE) are read out of its syntax
// tree and run without Blender; the oracles are here.
const dir = fileURLToPath(new URL('.', import.meta.url));
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const TOLERANCE = 1e-6;
const NAN = '__nan__';

/** Runs `code` with `input` as JSON on stdin; the code writes its answer to the file OUT, its first argument. */
function py(code, input) {
  const tmp = mkdtempSync(join(tmpdir(), 'verify-test-'));
  const out = join(tmp, 'out.json');
  try {
    const run = spawnSync(python, ['-c', code, out], {
      cwd: dir,
      input: JSON.stringify(input, (_key, v) => (Number.isNaN(v) ? NAN : v)),
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

// The script's top-level TOLERANCE, compare and close, without the bpy import and the replay.
const PRELUDE = `
import ast, hashlib, json, math, sys
OUT = sys.argv[1]
from pathlib import Path
tree = ast.parse(Path('verify_construction.py').read_text(encoding='utf-8'))
wanted = {'TOLERANCE', 'compare', 'close'}
nodes = [n for n in tree.body
         if (isinstance(n, ast.FunctionDef) and n.name in wanted)
         or (isinstance(n, ast.Assign) and any(getattr(t, 'id', None) in wanted for t in n.targets))]
found = {n.name if isinstance(n, ast.FunctionDef) else n.targets[0].id for n in nodes}
if found != wanted:
    raise SystemExit(f'verify_construction.py no longer defines {sorted(wanted - found)} at top level')
script = {'hashlib': hashlib, 'json': json}
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'verify_construction.py', 'exec'), script)
def decode(value):
    if value == ${JSON.stringify(NAN)}:
        return math.nan
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

// Coordinate differences around the tolerance, and changes to everything that must be equal.
const DELTAS = [0, 1e-9, 3e-7, 9.9e-7, 1e-6, 1.01e-6, 2e-6, 1e-3, 0.5];
const KINDS = ['shift', 'shift', 'shift', 'nan', 'rename', 'parent', 'face', 'smooth', 'colour'];
const MORE = ['dropVertex', 'dropRecord', 'empty'];

/** Applies one change to a copy of `records`, the replay; returns the copy. */
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
  changes: Array.from({ length: rng.int(0, 2) }, () => ({
    kind: rng.pick(rng.chance(0.8) ? KINDS : MORE),
    at: rng.next(),
    at2: rng.next(),
    sign: rng.pick([1, -1]),
    delta: rng.pick(DELTAS),
  })),
});
const replayOf = (c) => c.changes.reduce(change, c.records);

/** The oracle: everything but coordinates equal, and every coordinate pair within TOLERANCE. */
function matches(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    const keys = Object.keys(x).sort();
    if (JSON.stringify(keys) !== JSON.stringify(Object.keys(y).sort())) return false;
    for (const key of keys) {
      if (key === 'matrix' || key === 'vertices') continue;
      if (JSON.stringify(x[key]) !== JSON.stringify(y[key])) return false;
    }
    if ((x.vertices ?? []).length !== (y.vertices ?? []).length) return false;
    const p = [x.matrix, ...(x.vertices ?? [])].flat();
    const q = [y.matrix, ...(y.vertices ?? [])].flat();
    return p.length === q.length && p.every((v, k) => Math.abs(v - q[k]) <= TOLERANCE);
  });
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

describe('verify_construction: does a replay match the model', () => {
  it('matches exactly when all but coordinates are equal and every coordinate is within 1e-6', () => {
    const run = batch(
      `${PRELUDE}
results = []
for c in cases:
    worst = script['compare'](c['a'], c['b'])
    match = worst is not None and worst <= script['TOLERANCE']
    results.append({'match': match, 'worst': None if worst is None else repr(worst)})
done(results)`,
      (rng) => withReplay(modelCase(rng)),
    );
    forAll(
      (rng) => withReplay(modelCase(rng)),
      (c) => {
        const r = run(c);
        expect(r.match, `compare gave ${r.worst}`).toBe(matches(c.a, c.b));
      },
      { shrink: (c) => [...shrinkModel(c)].map(withReplay) },
    );
  }, 60_000);
});

/** The case as compare gets it: the committed model's records and the replay's. */
function withReplay(c) {
  const { records, changes } = c;
  return { records, changes, a: records, b: replayOf({ records, changes }) };
}

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

/** Applies one change to a copy of a calibration: a number moved, a count, a key or a string. */
function recalibrate(value, m) {
  const b = structuredClone(value);
  const part = b[Math.floor(m.at * b.length)];
  if (m.kind === 'shift') part.tiles[0] += m.sign * m.delta;
  else if (m.kind === 'axle' && part.axles.length) part.axles[0].x_m += m.sign * m.delta;
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
      const a = calibration(rng);
      const changes = Array.from({ length: rng.int(0, 2) }, () => ({
        kind: rng.pick(['shift', 'shift', 'axle', 'count', 'key', 'string', 'drop']),
        at: rng.next(),
        sign: rng.pick([1, -1]),
        delta: rng.pick(DELTAS),
      }));
      return { a, changes, b: changes.reduce(recalibrate, a) };
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
