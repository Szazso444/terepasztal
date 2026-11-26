import { describe, expect, it } from 'vitest';
import { desertLanes, tumbleAt, type Lane } from './desertWind';

const RECT = { x0: 0, y0: 0, x1: 30, y1: 30 };
const EAST = { x: 1, y: 0 };
/** A desert from tile 5 to 25 both ways, with a cactus at its middle. */
const open = (x: number, y: number) =>
  x >= 5 && x <= 25 && y >= 5 && y <= 25 && Math.hypot(x - 15, y - 15) > 0.6;

describe('the lanes of a desert', () => {
  const lanes = desertLanes(open, RECT, EAST);

  it('lie on open desert, clear of what is not', () => {
    expect(lanes.length).toBeGreaterThan(10);
    for (const l of lanes)
      for (let s = 0; s <= l.length; s += 0.1) {
        const x = l.x + l.ux * s,
          y = l.y + l.uy * s;
        for (const [dx, dy] of [
          [0, 0],
          [0.2, 0],
          [-0.2, 0],
          [0, 0.2],
          [0, -0.2],
        ])
          expect(open(x + dx, y + dy), `${x},${y}`).toBe(true);
      }
  });

  it('run with the wind, whichever way it blows', () => {
    for (const wind of [EAST, { x: 0, y: 1 }, { x: Math.SQRT1_2, y: -Math.SQRT1_2 }])
      for (const l of desertLanes(open, RECT, wind)) {
        expect(l.ux * wind.x + l.uy * wind.y).toBeGreaterThan(Math.SQRT1_2);
        expect(l.length).toBeGreaterThanOrEqual(1.2);
      }
  });

  it('are none where there is no desert', () => {
    expect(desertLanes(() => false, RECT, EAST)).toEqual([]);
  });

  it('go round the cactus: a lane stops short of it', () => {
    const through = lanes.filter((l) => Math.abs(l.y - 15) < 0.3);
    for (const l of through) expect(l.x > 15 || l.x + l.length < 15).toBe(true);
  });
});

describe('a tumbleweed', () => {
  const lanes = desertLanes(open, RECT, EAST);
  const sample = (level: 'breeze' | 'windy' | 'storm', s: number) => {
    const out = [];
    for (let j = 0; j < 14; j++)
      for (let t = 0; t < 300; t += 0.37) {
        const w = tumbleAt(lanes, j, level, s, 0.5, t);
        if (w) out.push({ j, ...w });
      }
    return out;
  };

  it('never leaves the open desert', () => {
    for (const w of sample('storm', 1)) expect(open(w.x, w.y), `${w.x},${w.y}`).toBe(true);
  });

  it('is out in numbers by the wind: none in a calm, one in a breeze, many in a storm', () => {
    expect(tumbleAt(lanes, 0, 'calm', 0, 0, 5)).toBeNull();
    expect(tumbleAt(lanes, 1, 'breeze', 0.35, 0.5, 5)).toBeNull();
    expect(new Set(sample('breeze', 0.35).map((w) => w.j)).size).toBe(1);
    expect(new Set(sample('storm', 1).map((w) => w.j)).size).toBe(14);
  });

  it('stays in a small size, fades at its ends and bounces higher in a harder wind', () => {
    const storm = sample('storm', 1),
      breeze = sample('breeze', 0.35);
    for (const w of storm) {
      expect(w.radius).toBeLessThan(4.9);
      expect(w.alpha).toBeGreaterThanOrEqual(0);
      expect(w.alpha).toBeLessThanOrEqual(1);
    }
    const most = (list: { bounce: number }[]) => Math.max(...list.map((w) => w.bounce));
    expect(most(storm)).toBeGreaterThan(most(breeze));
  });

  it('is nowhere without a lane', () => {
    const none: Lane[] = [];
    expect(tumbleAt(none, 0, 'storm', 1, 0.5, 3)).toBeNull();
  });
});
