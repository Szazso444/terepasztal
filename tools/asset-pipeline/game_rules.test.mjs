import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DRAWN_FACINGS,
  DRAWN_WIDTH,
  FACINGS,
  SIZE_LEN,
  facingAngle,
  vehicleSpec,
} from '../../src/sim/body';

// The pipeline renders in Python; game_rules.py is its copy of the game's rules. These tests fail
// when body.ts changes and the copy does not.
const dir = fileURLToPath(new URL('.', import.meta.url));
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const PLANS = ['rigid', 'tender', 'garratt', 'meyer'];
let py;

beforeAll(() => {
  const script = `
import json, game_rules as g
parts = {}
for size, plans in g.PLANS.items():
    for plan in plans:
        parts[f"{size}/{plan}"] = g.plan_parts(plan, size)
print(json.dumps({"width": g.DRAWN_WIDTH, "facings": g.FACINGS, "drawn": g.drawn_facings(), "dirs": g.directions("game"),
                  "sizes": g.SIZE_TILES, "plans": g.PLANS, "parts": parts}))
`;
  py = JSON.parse(execFileSync(python, ['-c', script], { cwd: dir, encoding: 'utf8' }));
});

describe('game_rules.py', () => {
  it('renders exactly the drawn facings', () => {
    expect(py.facings).toBe(FACINGS);
    expect(py.drawn).toEqual([...DRAWN_FACINGS].sort((a, b) => a - b));
  });

  it('turns each facing to the Blender yaw of its tile heading', () => {
    // tile +tx is Blender +X and tile +ty is Blender -Y, so a tile angle a is a yaw of -a
    for (const [yaw, f] of py.dirs) {
      const a = facingAngle(f);
      expect(Math.cos((yaw * Math.PI) / 180)).toBeCloseTo(Math.cos(a), 9);
      expect(Math.sin((yaw * Math.PI) / 180)).toBeCloseTo(-Math.sin(a), 9);
    }
  });

  it('draws rolling stock as wide as the generators do', () => {
    expect(py.width).toBe(DRAWN_WIDTH);
  });

  it('knows the body sizes', () => {
    for (const [tiles, size] of Object.entries(py.sizes)) expect(SIZE_LEN[size]).toBe(+tiles);
    expect(Object.keys(py.sizes)).toHaveLength(Object.keys(SIZE_LEN).length);
  });

  it('allows a plan at a size exactly when the game draws it', () => {
    for (const [tiles, size] of Object.entries(py.sizes))
      for (const plan of PLANS)
        expect(py.plans[tiles].includes(plan)).toBe(vehicleSpec({ size, plan }).plan === plan);
  });

  it('cuts every plan into the segments the game poses', () => {
    for (const [key, parts] of Object.entries(py.parts)) {
      const [tiles, plan] = key.split('/');
      const spec = vehicleSpec({ size: py.sizes[tiles], plan });
      expect(parts.map(([part, L]) => [part, L])).toEqual(spec.segments.map((s) => [s.part, s.L]));
      // a part is rendered when it is the first segment of its kind; later ones reuse its sprite
      const firsts = spec.segments.map(
        (s, i) => spec.segments.findIndex((t) => t.part === s.part) === i,
      );
      expect(parts.map(([, , rendered]) => rendered)).toEqual(firsts);
    }
  });
});
