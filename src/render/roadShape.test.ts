/**
 * The roads' centre line (#329, roadShape.ts): which piece a tile's sides make, the sides the
 * renderer reads against the simulation's, and the shape the painter measures its distance to.
 * The invariants are the joins: wherever two road tiles share an edge their centre lines meet
 * there at one point and at right angles, whatever their pieces and positions.
 */
import { describe, expect, it } from 'vitest';
import { DIRS, DIR_DX, DIR_DY, opposite, type Dir } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { roadLinks, Roads } from '../sim/roads';
import type { Door } from '../sim/doors';
import { forAll } from '../testing/property';
import { TrackGraph } from '../world/track';
import {
  CROSSING_SHORT,
  ROAD_HALF,
  ROAD_RADIUS_MAX,
  ROAD_RADIUS_MIN,
  ROAD_REACH,
  ROAD_ROTATIONS,
  ROAD_WANDER,
  ROAD_WIDTH,
  doorSides,
  edgeOffset,
  roadArms,
  roadCode,
  roadPath,
  roadPiece,
  roadShape,
  roadSides,
  shapeDistance,
  type RoadKind,
  type RoadShape,
} from './roadShape';

const EPS = 1e-9;
/** The number of sides in a mask. */
const count = (m: number) => DIRS.filter((d) => m & (1 << d)).length;

describe('the piece a road tile makes of its sides', () => {
  it('has arms exactly on the sides, for each of the 16 masks', () => {
    const kinds = new Map<RoadKind, number[]>();
    for (let mask = 0; mask < 16; mask++) {
      const piece = roadPiece(mask);
      expect(roadArms(piece), `mask ${mask}`).toBe(mask);
      expect(piece.rot, `mask ${mask}`).toBeGreaterThanOrEqual(0);
      expect(piece.rot, `mask ${mask}`).toBeLessThan(ROAD_ROTATIONS[piece.kind]);
      kinds.set(piece.kind, [...(kinds.get(piece.kind) ?? []), mask]);
    }
    expect(kinds.get('lone')).toEqual([0]);
    expect(kinds.get('end')!.map(count)).toEqual([1, 1, 1, 1]);
    expect(kinds.get('straight')).toEqual([0b0101, 0b1010]);
    expect(kinds.get('curve')!.sort((a, b) => a - b)).toEqual([0b0011, 0b0110, 0b1001, 0b1100]);
    expect(kinds.get('tee')!.map(count)).toEqual([3, 3, 3, 3]);
    expect(kinds.get('cross')).toEqual([15]);
    // every piece in every rotation is the piece of its own arms
    for (const [kind, n] of Object.entries(ROAD_ROTATIONS))
      for (let rot = 0; rot < n; rot++) {
        const piece = { kind: kind as RoadKind, rot };
        expect(roadPiece(roadArms(piece))).toEqual(piece);
      }
  });

  it('makes a lone tile a round patch in the middle, the road wide across', () => {
    const lone = roadShape(roadCode(0, 0), 3, 7);
    expect(lone.piece.kind).toBe('lone');
    for (let a = 0; a < 2 * Math.PI; a += 0.1)
      for (const r of [0, 0.05, ROAD_HALF, 0.3]) {
        const u = r * Math.cos(a),
          v = r * Math.sin(a);
        expect(shapeDistance(lone, u, v)).toBeCloseTo(r, 12);
      }
    expect(2 * ROAD_HALF).toBe(ROAD_WIDTH);
  });
});

/** Doors round a random road layout: street and platform doors, from tiles beside the roads. */
function layout(rng: Rng) {
  const w = rng.int(3, 9),
    h = rng.int(3, 9);
  const roads = new Roads(new TrackGraph(w, h));
  for (let n = rng.int(0, w * h); n > 0; n--) roads.add(rng.int(0, w - 1), rng.int(0, h - 1));
  const doors: Door[] = [];
  for (let n = rng.int(0, 12); n > 0; n--) {
    const side = rng.pick(DIRS),
      tile = { x: rng.int(-1, w), y: rng.int(-1, h) };
    doors.push({
      kind: rng.chance(0.75) ? 'street' : 'platform',
      tile,
      side,
      reach: { x: tile.x + DIR_DX[side], y: tile.y + DIR_DY[side] },
    });
  }
  return { w, h, tiles: roads.toJSON(), doors };
}

describe('the sides the renderer reads', () => {
  it('are the sides the simulation joins, the street doors included (roadLinks)', () => {
    let doorArms = 0;
    forAll(layout, ({ w, h, tiles, doors }) => {
      const roads = new Roads(new TrackGraph(w, h));
      roads.load(tiles);
      // the renderer gets the street doors only, as the builder lists them (setCity)
      const street = doors
        .filter((d) => d.kind === 'street')
        .map(({ tile, side }) => ({ tile, side }));
      for (let y = -1; y <= h; y++)
        for (let x = -1; x <= w; x++) {
          const sides = roadSides((rx, ry) => roads.has(rx, ry), street, x, y),
            links = roadLinks(roads, doors, x, y);
          expect(sides, `${x},${y}`).toBe(links.sides);
          if (roads.has(x, y)) expect(doorSides(street, x, y) & sides).toBe(links.doors);
          if (links.doors) doorArms++;
        }
    });
    expect(doorArms).toBeGreaterThan(30);
  });

  it('give a road at a street door an arm toward it, on each of the four sides', () => {
    for (const side of DIRS) {
      // the door's tile at (2, 2), its reach across `side`; a lone road there points at the door
      const door = { tile: { x: 2, y: 2 }, side },
        rx = 2 + DIR_DX[side],
        ry = 2 + DIR_DY[side],
        at = (x: number, y: number) => x === rx && y === ry;
      const sides = roadSides(at, [door], rx, ry);
      expect(sides, `door facing ${side}`).toBe(1 << opposite(side));
      const toward = opposite(side) as Dir,
        shape = roadShape(roadCode(sides, doorSides([door], rx, ry)), rx + 40, ry - 9);
      expect(shape.piece).toEqual({ kind: 'end', rot: toward });
      // its arm meets the door's edge in the middle, square to it
      expect(shape.offsets[toward]).toBe(0);
      const edge = [DIR_DX[toward] * 0.5, DIR_DY[toward] * 0.5] as const;
      expect(shapeDistance(shape, edge[0], edge[1])).toBeLessThan(1e-9);
      // and the road beside the door joins it on that side, as before
      const beside = roadSides(
        (x, y) => at(x, y) || (x === rx - DIR_DY[side] && y === ry + DIR_DX[side]),
        [door],
        rx,
        ry,
      );
      expect(beside & (1 << toward)).toBeTruthy();
    }
  });
});

/** Where each arm of a shape's centre line crosses its edge, and the line's direction there. */
function crossings(shape: RoadShape) {
  const out = new Map<number, { at: [number, number]; dir: [number, number] }>();
  for (const line of roadPath(shape, 4000))
    for (const [end, next] of [
      [line[0], line[1]],
      [line[line.length - 1], line[line.length - 2]],
    ])
      for (const d of DIRS) {
        const along = end[0] * DIR_DX[d] + end[1] * DIR_DY[d];
        if (Math.abs(along - 0.5) > EPS) continue;
        const dx = end[0] - next[0],
          dy = end[1] - next[1],
          l = Math.hypot(dx, dy);
        if (l > 0) out.set(d, { at: [end[0], end[1]], dir: [dx / l, dy / l] });
      }
  return out;
}

/** A random code for a road tile with an arm through side `d`, and whether it is a crossing. */
function codeWith(rng: Rng, d: Dir, crossing: boolean) {
  const sides = (rng.int(0, 15) | (1 << d)) & 15;
  if (crossing) return roadCode(sides, 0, DIR_DX[d] ? 'x' : 'y');
  return roadCode(sides, rng.chance(0.2) ? rng.int(0, 15) & ~(1 << d) : 0);
}

describe('the centre line of a road tile', () => {
  it('meets the centre line of the road tile beside it at one point on their edge, square to it', () => {
    let joins = 0;
    forAll(
      (rng) => {
        const d = rng.pick(DIRS),
          a = rng.chance(0.15),
          b = !a && rng.chance(0.15);
        return {
          wx: rng.int(-300, 300),
          wy: rng.int(-300, 300),
          d,
          a: codeWith(rng, d, a),
          b: codeWith(rng, opposite(d), b),
          crossing: a || b,
        };
      },
      ({ wx, wy, d, a, b, crossing }) => {
        // a level crossing's road runs through the middle of its edges: the tile beside it meets
        // it there (the renderer pins that side of both)
        const pin = (code: number, side: Dir) => (crossing ? code | (1 << (side + 4)) : code);
        const near = roadShape(pin(a, d), wx, wy),
          far = roadShape(pin(b, opposite(d)), wx + DIR_DX[d], wy + DIR_DY[d]);
        const p = crossings(near).get(d),
          q = crossings(far).get(opposite(d));
        expect(p, 'the near tile crosses the edge').toBeDefined();
        expect(q, 'the far tile crosses the edge').toBeDefined();
        // one point: the far tile's edge point is the near tile's, a tile over
        expect(q!.at[0] + DIR_DX[d]).toBeCloseTo(p!.at[0], 9);
        expect(q!.at[1] + DIR_DY[d]).toBeCloseTo(p!.at[1], 9);
        // both square to the edge, running out through it
        expect(p!.dir[0]).toBeCloseTo(DIR_DX[d], 3);
        expect(p!.dir[1]).toBeCloseTo(DIR_DY[d], 3);
        expect(q!.dir[0]).toBeCloseTo(-DIR_DX[d], 3);
        expect(q!.dir[1]).toBeCloseTo(-DIR_DY[d], 3);
        // and the distance the painter reads agrees on the edge, across the road's reach
        for (let s = -ROAD_REACH; s <= ROAD_REACH; s += 0.01) {
          const eu = DIR_DX[d] * 0.5 + (DIR_DX[d] ? 0 : p!.at[0] + s),
            ev = DIR_DY[d] * 0.5 + (DIR_DY[d] ? 0 : p!.at[1] + s);
          expect(shapeDistance(far, eu - DIR_DX[d], ev - DIR_DY[d]), `at ${s}`).toBeCloseTo(
            shapeDistance(near, eu, ev),
            9,
          );
        }
        joins++;
      },
      { seeds: Array.from({ length: 400 }, (_, i) => i + 1) },
    );
    expect(joins).toBe(400);
  });

  it("keeps a straight within ROAD_WANDER of its tile's axis", () => {
    let wandered = 0,
      most = 0;
    for (let wy = -40; wy < 40; wy += 3)
      for (let wx = -40; wx < 40; wx++)
        for (const sides of [0b0101, 0b1010]) {
          const shape = roadShape(roadCode(sides, 0), wx, wy);
          for (const line of roadPath(shape))
            for (const [u, v] of line) {
              const lateral = Math.abs(sides === 0b0101 ? u : v);
              most = Math.max(most, lateral);
              if (lateral > ROAD_WANDER / 2) wandered++;
            }
        }
    expect(ROAD_WANDER).toBe(0.1);
    expect(most).toBeLessThanOrEqual(ROAD_WANDER + EPS);
    // it does wander
    expect(wandered).toBeGreaterThan(1000);
  });

  it('turns on a radius between 0.23 and 0.43 tile, cut only to the room between its arms', () => {
    expect([ROAD_RADIUS_MIN, ROAD_RADIUS_MAX]).toEqual([0.23, 0.43]);
    let cut = 0,
      low = 0,
      high = 0,
      off = 0;
    for (let wy = -30; wy < 30; wy++)
      for (let wx = -30; wx < 30; wx++)
        for (let rot = 0; rot < 4; rot++) {
          const sides = (1 << rot) | (1 << ((rot + 1) % 4)),
            shape = roadShape(roadCode(sides, 0), wx, wy),
            a = rot,
            b = (rot + 1) % 4,
            // the arms' corner, and its room to each edge along the arm
            kx = DIR_DX[a] ? shape.offsets[b] : shape.offsets[a],
            ky = DIR_DX[a] ? shape.offsets[a] : shape.offsets[b],
            room = Math.min(
              0.5 - kx * DIR_DX[a] - ky * DIR_DY[a],
              0.5 - kx * DIR_DX[b] - ky * DIR_DY[b],
            );
          expect(shape.piece.kind).toBe('curve');
          expect(shape.radius).toBeGreaterThanOrEqual(ROAD_RADIUS_MIN);
          expect(shape.radius).toBeLessThanOrEqual(Math.min(ROAD_RADIUS_MAX, room) + EPS);
          // cut to the room only where the range does not fit, and never below 0.4 then
          if (shape.radius < room - EPS) expect(shape.radius).toBeLessThanOrEqual(ROAD_RADIUS_MAX);
          else {
            cut++;
            expect(shape.radius).toBeGreaterThanOrEqual(0.4 - EPS);
          }
          if (shape.radius < 0.27) low++;
          if (shape.radius > 0.38) high++;
          // the turn is a circle of that radius: every point of the arc is that far from a centre
          const arc = roadPath(shape)[1],
            [cx, cy] = [
              kx + shape.radius * (DIR_DX[a] + DIR_DX[b]),
              ky + shape.radius * (DIR_DY[a] + DIR_DY[b]),
            ];
          for (const [u, v] of arc)
            off = Math.max(off, Math.abs(Math.hypot(u - cx, v - cy) - shape.radius));
        }
    expect(off).toBeLessThan(1e-9);
    // the radius varies from tile to tile over the whole range
    expect(low).toBeGreaterThan(500);
    expect(high).toBeGreaterThan(500);
    expect(cut).toBeLessThan(low);
  });

  it('changes where a straight run crosses its edges along the run', () => {
    let runs = 0;
    for (let row = -60; row < 60; row += 7)
      for (let start = -60; start < 60; start += 13)
        for (const alongX of [true, false]) {
          const offsets = new Set<number>();
          for (let i = 1; i < 8; i++) {
            // the shared edge between tiles i - 1 and i of the run
            const a = alongX ? start + i - 1 : row,
              b = alongX ? row : start + i - 1,
              shape = roadShape(roadCode(alongX ? 0b1010 : 0b0101, 0), a, b);
            offsets.add(Math.round(shape.offsets[alongX ? 1 : 2] * 1e9));
            expect(shape.offsets[alongX ? 1 : 2]).toBe(
              edgeOffset(alongX ? a + 0.5 : a, alongX ? b : b + 0.5, alongX),
            );
          }
          expect(offsets.size, `run from ${start} on ${row}`).toBeGreaterThan(1);
          runs++;
        }
    expect(runs).toBeGreaterThan(100);
  });

  it('runs straight through the middle of a level crossing, square to its track', () => {
    let off = 0;
    for (let wy = -10; wy < 10; wy++)
      for (let wx = -10; wx < 10; wx++)
        for (const axis of ['x', 'y'] as const)
          for (let sides = 0; sides < 16; sides++) {
            // any pinned sides: a crossing's road meets both its edges in the middle anyway
            const shape = roadShape(roadCode(sides, (wx * 7 + wy) & 15, axis), wx, wy),
              across = axis === 'x' ? [1, 3] : [0, 2];
            expect(shape.crossing).toBe(axis);
            expect(shape.piece).toEqual({ kind: 'straight', rot: axis === 'x' ? 1 : 0 });
            for (const d of across) {
              expect(shape.offsets[d]).toBe(0);
              // out to the edge toward a road, short of it toward none
              expect(shape.ends[d]).toBe(sides & (1 << d) ? 0.5 : CROSSING_SHORT);
            }
            for (const line of roadPath(shape))
              for (const [u, v] of line) off = Math.max(off, Math.abs(axis === 'x' ? v : u));
          }
    expect(off).toBeLessThan(1e-12);
    // a short arm's round end, ragged edge and all, stays on its tile
    expect(CROSSING_SHORT + ROAD_REACH).toBeCloseTo(0.5, 12);
  });

  it('stops an end in the middle of its tile in a round end', () => {
    let off = 0;
    for (let wy = -6; wy < 6; wy++)
      for (let wx = -6; wx < 6; wx++)
        for (const d of DIRS) {
          const shape = roadShape(roadCode(1 << d, 0), wx, wy),
            [line] = roadPath(shape),
            ends = [line[0], line[line.length - 1]];
          expect(shape.piece).toEqual({ kind: 'end', rot: d });
          // one end on its edge, the other in the middle
          expect(ends.some(([u, v]) => Math.abs(u * DIR_DX[d] + v * DIR_DY[d] - 0.5) < EPS)).toBe(
            true,
          );
          expect(ends.some(([u, v]) => Math.hypot(u, v) < EPS)).toBe(true);
          // past the middle, away from its edge, the road is a half disc round the middle
          for (let a = 0; a < Math.PI; a += 0.05)
            for (const r of [0.02, 0.1, ROAD_HALF, 0.2]) {
              const cx = -DIR_DX[d],
                cy = -DIR_DY[d],
                // a direction in the far half: along -d, turned up to 90 degrees either way
                t = a - Math.PI / 2,
                u = r * (cx * Math.cos(t) - cy * Math.sin(t)),
                v = r * (cx * Math.sin(t) + cy * Math.cos(t));
              off = Math.max(off, Math.abs(shapeDistance(shape, u, v) - r));
            }
        }
    expect(off).toBeLessThan(1e-9);
  });
});
