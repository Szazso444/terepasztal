import { describe, expect, it } from 'vitest';
import { depthKey } from '../engine/iso';
import {
  BRIDGE_DEPTH,
  groundSliceKey,
  propDepthKey,
  ridingKey,
  tileColumns,
  type TileColumn,
} from './bridgeDepth';

/** Offsets a prop takes inside its tile (render/scatter.ts keeps them within 0.42). */
const OFFSETS = [-0.42, -0.2, 0, 0.2, 0.42];
/** Depth key of a train sprite on plain ground: by its position, layer 15. */
const groundTrain = (x: number, y: number) => depthKey(x, y, 15);
/** World pixel x of a tile position. */
const screenX = (x: number, y: number) => (x - y) * 32;

describe('bridge depth layers', () => {
  const X = 10,
    Y = 7,
    row = depthKey(X, Y),
    body = row + BRIDGE_DEPTH.body,
    near = row + BRIDGE_DEPTH.near;

  it('stacks deck, track, light and riders in that order, under the near parapets', () => {
    expect(row + BRIDGE_DEPTH.track).toBeGreaterThan(body);
    expect(row + BRIDGE_DEPTH.light).toBeGreaterThan(row + BRIDGE_DEPTH.track);
    // Wherever on the tiles around it a vehicle stands, its slice on this tile lies on the lit
    // deck and under the near parapet, its load included.
    for (let d = -2; d <= 2; d += 0.1) {
      expect(ridingKey(row, groundTrain(X + d, Y))).toBeGreaterThan(row + BRIDGE_DEPTH.light + 0.5);
      expect(near).toBeGreaterThan(ridingKey(row, groundTrain(X + d, Y), 16));
    }
  });

  it('draws the deck over whatever stands on the tiles behind it', () => {
    for (const [bx, by] of [
      [X, Y - 1],
      [X - 1, Y],
    ]) {
      // A train on a ground track there, anywhere along its tile.
      for (let d = -0.5; d < 0.5; d += 0.05)
        expect(body).toBeGreaterThan(groundTrain(bx + (by === Y ? 0 : d), by + (by === Y ? d : 0)));
      // Every prop, also one at the corner nearest the camera.
      for (const ox of OFFSETS)
        for (const oy of OFFSETS)
          expect(body).toBeGreaterThan(propDepthKey(bx, by, ox, oy, true, false));
      // Structures (stations, signals, wires) take layers up to 36 of their own row.
      expect(body).toBeGreaterThan(depthKey(bx, by, 36));
    }
  });

  it('draws whatever stands on the tiles in front over the near parapets and the riders', () => {
    const rider = ridingKey(row, groundTrain(X + 0.5, Y), 16);
    for (const [fx, fy] of [
      [X, Y + 1],
      [X + 1, Y],
    ]) {
      for (const ox of OFFSETS)
        for (const oy of OFFSETS) {
          expect(propDepthKey(fx, fy, ox, oy, false, false)).toBeGreaterThan(near);
          expect(propDepthKey(fx, fy, ox, oy, false, true)).toBeGreaterThan(near);
        }
      // A deck one row in front, and a train on the ground there.
      expect(depthKey(fx, fy) + BRIDGE_DEPTH.body).toBeGreaterThan(near);
      for (let d = -0.5; d < 0.5; d += 0.05)
        expect(groundTrain(fx + (fy === Y ? d : 0), fy + (fy === Y ? 0 : d))).toBeGreaterThan(
          rider,
        );
    }
  });

  it('keeps the vehicles on one tile in the order they stand in', () => {
    let last = -Infinity;
    for (let at = X - 2; at <= X + 2; at += 1.2) {
      const key = ridingKey(row, groundTrain(at, Y));
      // A vehicle further along sorts above the one behind, its wheels above that one's load.
      expect(key - 0.03).toBeGreaterThan(last + 0.1);
      last = key;
    }
  });

  it('holds the slice over a bank within the row of its tile', () => {
    for (let d = -3; d <= 3; d += 0.25) {
      const key = groundSliceKey(row, groundTrain(X + d, Y));
      expect(key).toBeGreaterThan(row - 35);
      expect(key).toBeLessThan(row + 65);
    }
    // On its own tile a vehicle sorts as it does anywhere on the ground.
    expect(groundSliceKey(row, groundTrain(X + 0.3, Y))).toBe(groundTrain(X + 0.3, Y));
  });

  it('sorts a prop between two decks behind the one and in front of the other', () => {
    for (const ox of OFFSETS)
      for (const oy of OFFSETS) {
        const key = propDepthKey(X, Y, ox, oy, true, true);
        expect(key).toBeLessThan(depthKey(X, Y + 1) + BRIDGE_DEPTH.body);
        expect(key).toBeGreaterThan(depthKey(X, Y - 1) + BRIDGE_DEPTH.near);
      }
    // Away from bridges a prop sorts by where it stands.
    expect(propDepthKey(X, Y, 0.3, -0.1, false, false)).toBe(depthKey(X + 0.3, Y - 0.1, 10));
  });
});

describe('tile columns of a train sprite', () => {
  /** The column a world pixel x falls in. */
  const columnAt = (columns: TileColumn[], x: number) =>
    columns.find((c) => x >= c.from - 1e-9 && x < c.to + 1e-9)!;
  const along = (c: TileColumn, axis: 'x' | 'y') => (axis === 'x' ? c.x : c.y);

  for (const axis of ['x', 'y'] as const) {
    const LINE = 20,
      /** Tile `i` along the track and a point (a along, c across) in tile units from its centre. */
      point = (i: number, a: number, c: number) =>
        axis === 'x' ? screenX(i + a, LINE + c) : screenX(LINE + c, i + a),
      columns = tileColumns(axis, LINE, -2000, 2000);

    it(`covers the sprite without gap or overlap, one tile per column (${axis})`, () => {
      const some = tileColumns(axis, LINE, -70.5, 101.25);
      expect(some[0].from).toBe(-70.5);
      expect(some[some.length - 1].to).toBe(101.25);
      for (let i = 1; i < some.length; i++) {
        expect(some[i].from).toBe(some[i - 1].to);
        expect(Math.abs(along(some[i], axis) - along(some[i - 1], axis))).toBe(1);
      }
      for (const c of some) expect(axis === 'x' ? c.y : c.x).toBe(LINE);
      expect(tileColumns(axis, LINE, 5, 5)).toEqual([]);
    });

    it(`puts the deck of a tile in its own column or the next one toward the camera (${axis})`, () => {
      for (const i of [3, 9, 31])
        for (let a = -0.49; a < 0.5; a += 0.07)
          for (let c = -0.49; c < 0.5; c += 0.07) {
            const column = columnAt(columns, point(i, a, c));
            expect([i, i + 1]).toContain(along(column, axis));
            // The slice there sorts above that deck, its track and the light on it.
            expect(ridingKey(depthKey(column.x, column.y), 0) - 0.03).toBeGreaterThan(
              depthKey(...((axis === 'x' ? [i, LINE] : [LINE, i]) as [number, number])) +
                BRIDGE_DEPTH.light,
            );
          }
    });

    it(`puts the near edge of a tile, and the parapet on it, in that tile's column alone (${axis})`, () => {
      for (const i of [3, 9, 31])
        for (let a = -0.49; a < 0.5; a += 0.07)
          // Screen x does not change with height: the whole parapet stands in the column.
          expect(along(columnAt(columns, point(i, a, 0.5)), axis)).toBe(i);
    });

    it(`puts the far edge of a tile in the next column, above its far parapet (${axis})`, () => {
      for (const i of [3, 9, 31])
        for (let a = -0.49; a < 0.5; a += 0.07)
          expect(along(columnAt(columns, point(i, a, -0.5)), axis)).toBe(i + 1);
    });
  }
});
