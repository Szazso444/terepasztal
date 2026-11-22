import { describe, it, expect } from 'vitest';
import { depthKey } from '../engine/iso';
import {
  footprintIndices,
  isLampPixel,
  lampMask,
  landmarkDepth,
  landmarkPlacement,
  treatmentOf,
  wornPixels,
} from './landmarkDraw';
import { LANDMARK_STAGES } from '../sim/landmarks';
import { tileToWorld } from '../engine/iso';
import { forAll } from '../testing/property';

const footprints: [number, number][] = [
  [1, 1],
  [3, 3],
  [3, 2],
  [2, 1],
];

describe('landmark depth', () => {
  for (const [w, d] of footprints) {
    it(`${w}x${d}: behind a train in front of its footprint, in front of one behind it`, () => {
      const x = 20,
        y = 30,
        key = landmarkDepth(x, y, w, d),
        train = 15;
      // a train on the tile past the front corner, and one level with each side's far end
      expect(depthKey(x + w, y + d - 1, train)).toBeGreaterThan(key);
      expect(depthKey(x + w - 1, y + d, train)).toBeGreaterThan(key);
      // a train on the tile before the back corner, and beside its back row
      expect(depthKey(x - 1, y, train)).toBeLessThan(key);
      expect(depthKey(x, y - 1, train)).toBeLessThan(key);
      expect(depthKey(x + w - 2, y + d - 2, train + 0.5)).toBeLessThan(key);
    });
  }

  it('anchors the picture on the footprint centre', () => {
    forAll(
      (r) => ({ x: r.int(0, 100), y: r.int(0, 100), fp: footprints[r.int(0, 3)] }),
      ({ x, y, fp: [w, d] }) => {
        const p = landmarkPlacement(x, y, w, d),
          at = tileToWorld(p.front.x, p.front.y),
          want = tileToWorld(x + (w - 1) / 2, y + (d - 1) / 2);
        expect(at.x + p.dx).toBeCloseTo(want.x, 6);
        expect(at.y + p.dy).toBeCloseTo(want.y, 6);
      },
    );
  });
});

describe('landmark treatments', () => {
  it('draws everything but a hidden landmark, marks spotted, wears salvaged, lights restored', () => {
    const t = Object.fromEntries(LANDMARK_STAGES.map((s) => [s, treatmentOf(s)]));
    expect(t.hidden.picture).toBe(false);
    for (const s of LANDMARK_STAGES.filter((s) => s !== 'hidden')) expect(t[s].picture).toBe(true);
    expect(LANDMARK_STAGES.filter((s) => t[s].marker)).toEqual(['spotted']);
    expect(LANDMARK_STAGES.filter((s) => t[s].worn)).toEqual(['salvaged']);
    expect(LANDMARK_STAGES.filter((s) => t[s].lit)).toEqual(['restored']);
  });

  it('lists the footprint tiles', () => {
    expect(footprintIndices(2, 3, 2, 2, 10)).toEqual([32, 33, 42, 43]);
  });

  it('lights lamp yellow, not roofs or leaves', () => {
    expect(isLampPixel(250, 200, 90, 255)).toBe(true);
    expect(isLampPixel(200, 90, 50, 255)).toBe(false);
    expect(isLampPixel(250, 200, 90, 0)).toBe(false);
    const mask = lampMask(new Uint8ClampedArray([250, 200, 90, 255, 60, 70, 90, 255]));
    expect([...mask]).toEqual([255, 187, 91, 255, 0, 0, 0, 0]);
  });

  it('darkens and desaturates, keeping alpha', () => {
    const out = wornPixels(new Uint8ClampedArray([200, 100, 50, 200]));
    expect(out[3]).toBe(200);
    expect(Math.max(...out.slice(0, 3))).toBeLessThan(200);
    expect(out[0] - out[2]).toBeLessThan(150);
  });
});
