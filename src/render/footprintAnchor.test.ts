import { describe, expect, it } from 'vitest';
import { tileToWorld } from '../engine/iso';
import {
  footprintAnchor,
  footprintCentre,
  footprintReachRadius,
  footprintTileList,
} from './footprintAnchor';

/** Every footprint shape the game has, as width x depth along x and y. */
const SPANS = [
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [2, 3],
  [3, 3],
] as const;

describe('where a picture stands on its footprint', () => {
  it('sorts with the tile nearest the camera, the one furthest along both axes', () => {
    for (const [w, h] of SPANS) {
      const a = footprintAnchor(10, 20, w, h);
      expect({ x: a.x, y: a.y }, `${w}x${h}`).toEqual({ x: 10 + w - 1, y: 20 + h - 1 });
    }
  });

  it("puts the picture's ground anchor on the footprint's centre, whatever its shape", () => {
    for (const [w, h] of SPANS) {
      const a = footprintAnchor(10, 20, w, h);
      const at = tileToWorld(a.x, a.y);
      const centre = tileToWorld(10 + (w - 1) / 2, 20 + (h - 1) / 2);
      expect(at.x + a.dx, `${w}x${h} x`).toBeCloseTo(centre.x, 9);
      expect(at.y + a.dy, `${w}x${h} y`).toBeCloseTo(centre.y, 9);
    }
  });

  it('adds no offset to a one-tile building, so it stands on its tile as before', () => {
    const a = footprintAnchor(4, 7, 1, 1);
    expect(a).toEqual({ x: 4, y: 7, dx: 0, dy: 0 });
    expect(Object.is(a.dx, -0) || Object.is(a.dy, -0)).toBe(false);
  });

  it('matches the offsets the depot and the long station were placed with', () => {
    // a two-tile shed along x: half a tile back along x; a 2 x 2 depot: half a tile each way
    expect(footprintAnchor(3, 5, 2, 1)).toEqual({ x: 4, y: 5, dx: -16, dy: -8 });
    expect(footprintAnchor(3, 5, 1, 2)).toEqual({ x: 3, y: 6, dx: 16, dy: -8 });
    expect(footprintAnchor(3, 5, 2, 2)).toEqual({ x: 4, y: 6, dx: 0, dy: -16 });
  });

  it('turns with the rotation: a quarter turn swaps the width and the depth', () => {
    for (const [w, h] of SPANS) {
      const r0 = footprintAnchor(5, 5, w, h);
      const r1 = footprintAnchor(5, 5, h, w);
      // the same footprint mirrored across the diagonal: x and y swap, the offset mirrors
      expect({ x: r1.x, y: r1.y }).toEqual({ x: 5 + h - 1, y: 5 + w - 1 });
      expect(r1.dx).toBeCloseTo(-r0.dx, 9);
      expect(r1.dy).toBeCloseTo(r0.dy, 9);
    }
  });

  it('keeps a half turn in the same place: rot and rot + 2 cover the same tiles', () => {
    expect(footprintAnchor(5, 5, 3, 2)).toEqual(footprintAnchor(5, 5, 3, 2));
    expect(footprintCentre(5, 5, 3, 2)).toEqual({ x: 6, y: 5.5 });
    expect(footprintCentre(5, 5, 2, 3)).toEqual({ x: 5.5, y: 6 });
  });
});

describe('the footprint as tiles', () => {
  it('lists w x h tiles from the corner', () => {
    expect(footprintTileList(3, 4, 2, 1)).toEqual([
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ]);
    expect(footprintTileList(3, 4, 3, 2)).toHaveLength(6);
  });
});

describe('the reach round a footprint', () => {
  it('is the radius itself for one tile and grows by the footprint half-width', () => {
    expect(footprintReachRadius(1, 1, 7)).toBe(7);
    expect(footprintReachRadius(2, 1, 7)).toBe(7.5);
    expect(footprintReachRadius(1, 2, 7)).toBe(7.5);
    expect(footprintReachRadius(3, 2, 7)).toBe(8);
  });
});
