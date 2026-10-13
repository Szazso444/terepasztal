import { describe, expect, it } from 'vitest';
import { Container, Rectangle, Texture, TextureSource, type Sprite } from 'pixi.js';
import type { FrameInfo } from '../engine/atlas';
import { depthKey, ELEV_PX } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray } from '../testing/property';
import { PROP_KINDS } from '../world/chunks';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap, type PropInstance, type PropKind } from '../world/tiles';
import { buildRelief, DEFAULT_RELIEF, reliefHeight, type ReliefStyle } from './terrainRelief';
import {
  EDGE_RAMP,
  GROUND_COVER,
  WALKER_LAYER,
  walkerDepth,
  walkerGround,
  type GroundAt,
} from './walkerGround';
import { WorldRenderer } from './worldRenderer';

const W = 12,
  H = 12,
  LEVEL_PX = 10;

/** Per-tile levels 0..2 at random: ground that jumps at every tile edge where they differ. */
function steppedGround(rng: Rng): { levels: number[]; ground: GroundAt } {
  const levels = Array.from({ length: W * H }, () => rng.int(0, 2));
  const level = (x: number, y: number) =>
    levels[
      Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))
    ];
  return { levels, ground: (x, y) => -level(x, y) * LEVEL_PX };
}

/** A walk of short steps along a random line across the map's middle. */
function walk(rng: Rng) {
  const from = { x: rng.range(2, W - 3), y: rng.range(2, H - 3) },
    angle = rng.range(0, Math.PI * 2),
    step = 0.002,
    n = 1500;
  return Array.from({ length: n }, (_, i) => ({
    x: from.x + Math.cos(angle) * step * i,
    y: from.y + Math.sin(angle) * step * i,
  }));
}

const UNEVEN = [Terrain.Grass, Terrain.Hill, Terrain.Mountain];

/**
 * The per-tile ground the game falls back to when its landscape painter fails, read through
 * WorldRenderer.elevationOf itself: grass at 0, a hill a level up unless it was flattened, a
 * mountain two, each over its whole tile, so the ground jumps at every edge between unlike tiles.
 */
function fallbackGround(
  terrain: (x: number, y: number) => Terrain,
  flat: (x: number, y: number) => boolean = () => false,
): GroundAt {
  const map = emptyMap(1, W, H),
    flattened = new Set<number>();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      map.terrain[y * W + x] = terrain(x, y);
      if (flat(x, y)) flattened.add(y * W + x);
    }
  const world = Object.create(WorldRenderer.prototype) as WorldRenderer;
  Object.assign(world, { map, flattened, landscape: { failed: true } });
  return (x, y) => world.elevationOf(x, y);
}

/** Fallback ground over a random mix of grass, hills (a quarter of them flattened) and mountains. */
function unevenGround(rng: Rng): GroundAt {
  const terrain = Array.from({ length: W * H }, () => rng.pick(UNEVEN)),
    flat = Array.from({ length: W * H }, () => rng.chance(0.25));
  return fallbackGround(
    (x, y) => terrain[y * W + x],
    (x, y) => flat[y * W + x],
  );
}

/** The tallest jump the fallback ground makes between two tiles, grass to mountain, in px. */
const MAX_JUMP = 2 * ELEV_PX;

/** The ground at the centre of each tile of the 3 x 3 block around (x, y), for a failure message. */
function around(ground: GroundAt, x: number, y: number) {
  const tx = Math.round(x),
    ty = Math.round(y);
  return [-1, 0, 1].map((dy) => [-1, 0, 1].map((dx) => ground(tx + dx, ty + dy)));
}

/** The relief styles the landscape has been painted in: the shipped terraces and both corner styles. */
const RELIEFS: ReliefStyle[] = [
  DEFAULT_RELIEF,
  { ...DEFAULT_RELIEF, shape: 'corners', maxRise: 2 },
  { step: 10, maxRise: 1, faces: false },
];

/** The painted ground (Landscape.elevation) over random hills and mountains, some tiles built on. */
function paintedGround(rng: Rng): GroundAt {
  const map = emptyMap(rng.int(1, 1 << 30), W, H),
    built = new Set<number>();
  for (let i = 0; i < W * H; i++) {
    map.terrain[i] = rng.pick(UNEVEN);
    if (rng.chance(0.15)) built.add(i);
  }
  const relief = buildRelief(map, built, rng.pick(RELIEFS));
  return (x, y) => -reliefHeight(map, relief, x, y);
}

/** Smooth rolling ground with no edges at all: three waves of up to 10 px, under one a tile. */
function rollingGround(rng: Rng): GroundAt {
  const waves = Array.from({ length: 3 }, () => ({
    a: rng.range(-10, 10),
    fx: rng.range(0, 2 * Math.PI),
    fy: rng.range(0, 2 * Math.PI),
    px: rng.range(0, 2 * Math.PI),
    py: rng.range(0, 2 * Math.PI),
  }));
  return (x, y) =>
    waves.reduce((z, w) => z + w.a * Math.sin(w.fx * x + w.px) * Math.cos(w.fy * y + w.py), 0);
}

/** How wide a ramp a case may use: the shipped one, or any other a caller may pass. */
const anyRamp = (rng: Rng) => (rng.chance(0.5) ? EDGE_RAMP : rng.range(0.05, 0.5));

describe('walkerGround', () => {
  it('is the ground itself wherever the ground has no jump: painted relief in every style, rolling ground', () => {
    forAll(
      (rng) => ({
        grounds: [paintedGround(rng), rollingGround(rng)],
        points: Array.from({ length: 60 }, () => ({
          x: rng.range(0.5, W - 1.5),
          y: rng.range(0.5, H - 1.5),
        })),
      }),
      ({ grounds, points }) => {
        for (const ground of grounds)
          for (const { x, y } of points)
            expect(
              Math.abs(walkerGround(ground, x, y) - ground(x, y)),
              `at (${x}, ${y})`,
            ).toBeLessThan(0.01);
      },
      { format: ({ points }) => `${points.length} points from ${JSON.stringify(points[0])}` },
    );
  });

  it('never pops: the height moves little between two points a short step apart', () => {
    forAll(
      (rng) => ({ ...steppedGround(rng), path: walk(rng) }),
      ({ ground, path }) => {
        let worst = 0;
        for (let i = 1; i < path.length; i++) {
          const a = walkerGround(ground, path[i - 1].x, path[i - 1].y),
            b = walkerGround(ground, path[i].x, path[i].y);
          worst = Math.max(worst, Math.abs(b - a));
        }
        // a level is 10 px; the steepest ramp climbs two of them over half a tile
        expect(worst).toBeLessThan(1);
      },
      { format: ({ path }) => JSON.stringify([path[0], path[path.length - 1]]) },
    );
  });

  it('is continuous across every edge and corner of the fallback ground, at a bounded slope', () => {
    // Points on or within a thousandth of a tile of an edge or a corner, each paired with a point
    // up to a ten-thousandth away, so many pairs straddle the seam. A pop is a whole level (10 or
    // 20 px) across any distance; the ramps climb at most 2.25 tallest jumps per ramp width, and
    // the bound allows 3.
    forAll(
      (rng) => {
        const ground = unevenGround(rng),
          ramp = anyRamp(rng);
        const pairs = Array.from({ length: 300 }, () => {
          const tx = rng.int(1, W - 2),
            ty = rng.int(1, H - 2),
            seam = rng.int(0, 2), // 0: an edge across x, 1: across y, 2: a corner
            off = () => (rng.chance(0.25) ? 0 : rng.range(-1e-3, 1e-3)),
            step = rng.range(1e-7, 1e-4),
            angle = rng.range(0, 2 * Math.PI);
          return {
            x: tx + (seam === 1 ? rng.range(-0.5, 0.5) : rng.pick([-0.5, 0.5]) + off()),
            y: ty + (seam === 0 ? rng.range(-0.5, 0.5) : rng.pick([-0.5, 0.5]) + off()),
            dx: Math.cos(angle) * step,
            dy: Math.sin(angle) * step,
          };
        });
        return { ground, ramp, pairs };
      },
      ({ ground, ramp, pairs }) => {
        const slope = (3 * MAX_JUMP) / ramp;
        for (const { x, y, dx, dy } of pairs) {
          const moved = Math.abs(
            walkerGround(ground, x + dx, y + dy, ramp) - walkerGround(ground, x, y, ramp),
          );
          expect(moved).toBeLessThanOrEqual(slope * Math.max(Math.abs(dx), Math.abs(dy)) + 1e-9);
        }
      },
      {
        shrink: (c) => [...shrinkArray(c.pairs)].map((pairs) => ({ ...c, pairs })),
        format: ({ ground, ramp, pairs }) =>
          JSON.stringify({
            ramp,
            pairs: pairs.slice(0, 2).map((p) => ({ ...p, tiles: around(ground, p.x, p.y) })),
            of: pairs.length,
          }),
      },
    );
  });

  it('stands on its own tile away from the edges and halfway between two tiles on their edge', () => {
    forAll(steppedGround, ({ levels, ground }) => {
      for (let ty = 1; ty < H - 1; ty++)
        for (let tx = 1; tx < W - 2; tx++) {
          const own = -levels[ty * W + tx] * LEVEL_PX,
            east = -levels[ty * W + tx + 1] * LEVEL_PX,
            inside = 0.5 - EDGE_RAMP;
          for (const [dx, dy] of [
            [0, 0],
            [inside, inside],
            [-inside, inside],
          ])
            expect(walkerGround(ground, tx + dx, ty + dy)).toBe(own);
          // the middle of the edge shared with the next tile along x, clear of its corners
          expect(walkerGround(ground, tx + 0.5, ty)).toBeCloseTo((own + east) / 2, 6);
        }
    });
  });

  it('stands exactly at its tile level anywhere at least the ramp from every edge', () => {
    forAll(
      (rng) => {
        const ramp = anyRamp(rng),
          inner = 0.5 - ramp;
        return {
          ground: unevenGround(rng),
          ramp,
          points: Array.from({ length: 50 }, () => ({
            x: rng.int(0, W - 1) + rng.range(-inner, inner),
            y: rng.int(0, H - 1) + rng.range(-inner, inner),
          })),
        };
      },
      ({ ground, ramp, points }) => {
        for (const { x, y } of points)
          expect(walkerGround(ground, x, y, ramp), `at (${x}, ${y})`).toBe(
            ground(Math.round(x), Math.round(y)),
          );
      },
      {
        shrink: (c) => [...shrinkArray(c.points)].map((points) => ({ ...c, points })),
        format: ({ ground, ramp, points }) =>
          JSON.stringify({
            ramp,
            points,
            tiles: points.length ? around(ground, points[0].x, points[0].y) : [],
          }),
      },
    );
  });

  it('stands halfway between two tiles anywhere on their shared edge clear of its corners, along x and along y', () => {
    forAll(
      (rng) => {
        const ramp = anyRamp(rng),
          inner = 0.5 - ramp;
        return {
          ground: unevenGround(rng),
          ramp,
          edges: Array.from({ length: 40 }, () => ({
            tx: rng.int(0, W - 2),
            ty: rng.int(0, H - 2),
            along: rng.range(-inner, inner),
            acrossY: rng.chance(0.5),
          })),
        };
      },
      ({ ground, ramp, edges }) => {
        for (const { tx, ty, along, acrossY } of edges) {
          const [x, y, other] = acrossY
            ? [tx + along, ty + 0.5, ground(tx, ty + 1)]
            : [tx + 0.5, ty + along, ground(tx + 1, ty)];
          expect(walkerGround(ground, x, y, ramp), `at (${x}, ${y})`).toBeCloseTo(
            (ground(tx, ty) + other) / 2,
            9,
          );
        }
      },
      {
        shrink: (c) => [...shrinkArray(c.edges)].map((edges) => ({ ...c, edges })),
        format: ({ ramp, edges }) => JSON.stringify({ ramp, edges }),
      },
    );
  });

  it('never stands above or below every tile within the ramp of it', () => {
    forAll(
      (rng) => {
        const ramp = anyRamp(rng);
        return {
          ground: unevenGround(rng),
          ramp,
          points: Array.from({ length: 60 }, () => ({
            x: rng.range(0.5, W - 1.5),
            y: rng.range(0.5, H - 1.5),
          })),
        };
      },
      ({ ground, ramp, points }) => {
        for (const { x, y } of points) {
          const reach: number[] = [];
          for (let ty = Math.ceil(y - 0.5 - ramp); ty <= y + 0.5 + ramp; ty++)
            for (let tx = Math.ceil(x - 0.5 - ramp); tx <= x + 0.5 + ramp; tx++)
              reach.push(ground(tx, ty));
          const z = walkerGround(ground, x, y, ramp);
          expect(z, `at (${x}, ${y}) over ${JSON.stringify(reach)}`).toBeGreaterThanOrEqual(
            Math.min(...reach) - 1e-9,
          );
          expect(z, `at (${x}, ${y}) over ${JSON.stringify(reach)}`).toBeLessThanOrEqual(
            Math.max(...reach) + 1e-9,
          );
        }
      },
      {
        shrink: (c) => [...shrinkArray(c.points)].map((points) => ({ ...c, points })),
        format: ({ ramp, points }) => JSON.stringify({ ramp, points }),
      },
    );
  });

  it('climbs steadily from one tile centre to the next where the ground changes along one axis only', () => {
    forAll(
      (rng) => {
        const line = Array.from({ length: W }, () => rng.pick(UNEVEN)),
          alongY = rng.chance(0.5);
        return {
          line,
          alongY,
          ramp: anyRamp(rng),
          from: rng.int(0, W - 2),
          across: [rng.range(0, H - 1), rng.range(0, H - 1)],
        };
      },
      ({ line, alongY, ramp, from, across }) => {
        // the ground of each column (or row) is one terrain all the way along the other axis
        const ground = fallbackGround((x, y) => line[alongY ? y : x]);
        const at = (t: number, s: number) =>
          alongY ? walkerGround(ground, s, t, ramp) : walkerGround(ground, t, s, ramp);
        const start = alongY ? ground(0, from) : ground(from, 0),
          end = alongY ? ground(0, from + 1) : ground(from + 1, 0),
          rise = Math.sign(end - start);
        let last = at(from, across[0]),
          // the steepest step back against the climb, and the most two places across differ
          back = 0,
          apart = 0;
        expect(last).toBe(start);
        for (let i = 1; i <= 400; i++) {
          const t = from + i / 400,
            z = at(t, across[0]);
          back = Math.max(back, rise === 0 ? Math.abs(z - start) : (last - z) * rise);
          apart = Math.max(apart, Math.abs(at(t, across[1]) - z));
          last = z;
        }
        expect(back).toBeLessThanOrEqual(1e-9);
        expect(apart).toBeLessThanOrEqual(1e-9);
        expect(last).toBe(end);
      },
    );
  });

  it('is the same with the map mirrored across its diagonal (x and y swapped)', () => {
    forAll(
      (rng) => ({
        ground: unevenGround(rng),
        ramp: anyRamp(rng),
        points: Array.from({ length: 60 }, () => {
          const tx = rng.int(1, W - 2),
            ty = rng.int(1, H - 2);
          // near corners half the time, where the order of the two ramps could show
          return rng.chance(0.5)
            ? {
                x: tx + rng.pick([-0.5, 0.5]) + rng.range(-0.3, 0.3),
                y: ty + rng.pick([-0.5, 0.5]) + rng.range(-0.3, 0.3),
              }
            : { x: rng.range(0.5, W - 1.5), y: rng.range(0.5, H - 1.5) };
        }),
      }),
      ({ ground, ramp, points }) => {
        const mirrored: GroundAt = (x, y) => ground(y, x);
        for (const { x, y } of points)
          expect(walkerGround(mirrored, y, x, ramp), `at (${x}, ${y})`).toBeCloseTo(
            walkerGround(ground, x, y, ramp),
            9,
          );
      },
      {
        shrink: (c) => [...shrinkArray(c.points)].map((points) => ({ ...c, points })),
        format: ({ ground, ramp, points }) =>
          JSON.stringify({
            ramp,
            points,
            tiles: points.length ? around(ground, points[0].x, points[0].y) : [],
          }),
      },
    );
  });
});

const SOURCE = new TextureSource({ width: 256, height: 256 });
/** A prop frame `w` x `h` world px, anchored as the atlas anchors it. */
function frame(w: number, h: number, anchorY: number): FrameInfo {
  return {
    image: undefined as never,
    texture: new Texture({
      source: SOURCE,
      frame: new Rectangle(0, 0, w, h),
      orig: new Rectangle(0, 0, w, h),
    }),
    anchorX: 0.5,
    anchorY,
    w,
    h,
  };
}

/** The sprite the world renderer draws a prop with, made the way it makes it. */
function propSprite(map: GameMap, x: number, y: number, p: PropInstance) {
  const world = Object.create(WorldRenderer.prototype) as WorldRenderer;
  Object.assign(world, {
    atlas: { has: () => true, get: () => frame(54, 30, 0.55) },
    map,
    objects: new Container(),
    elevationOf: () => 0,
    propTint: 0xffffff,
  });
  return (
    world as unknown as { propSprite(x: number, y: number, p: PropInstance): Sprite }
  ).propSprite(x, y, p);
}

const COVER = [...GROUND_COVER];
const STANDING = PROP_KINDS.filter((k) => !GROUND_COVER.has(k));
/** A prop at the offsets a tile's props take (PropInstance: -0.4..0.4 either way). */
const anyProp = (rng: Rng, kinds: readonly PropKind[]): PropInstance => ({
  kind: rng.pick(kinds),
  variant: rng.int(0, 2),
  ox: rng.range(-0.4, 0.4),
  oy: rng.range(-0.4, 0.4),
});

describe('walkerDepth', () => {
  it('draws a walker over the ground cover of the tile it stands on, wherever on the tile', () => {
    forAll(
      (rng) => ({
        kind: COVER[rng.int(0, COVER.length - 1)],
        tile: { x: rng.int(0, W - 1), y: rng.int(0, H - 1) },
        at: { x: rng.range(-0.5, 0.4999), y: rng.range(-0.5, 0.4999) },
        // the full range a prop's offset takes, as a field pushed aside by a track has
        offset: { x: rng.range(-0.4, 0.4), y: rng.range(-0.4, 0.4) },
        // and now and then something standing on the same tile, before or after the cover
        standing: rng.chance(0.3) ? [anyProp(rng, STANDING)] : [],
        first: rng.chance(0.5),
      }),
      ({ kind, tile, at, offset, standing, first }) => {
        const map = emptyMap(1, W, H),
          cover: PropInstance = { kind, variant: 0, ox: offset.x, oy: offset.y };
        map.props.set(tile.y * W + tile.x, first ? [cover, ...standing] : [...standing, cover]);
        const drawn = propSprite(map, tile.x, tile.y, cover),
          x = tile.x + at.x,
          y = tile.y + at.y;
        expect(walkerDepth(map, x, y)).toBeGreaterThan(drawn.zIndex);
        // lifted only just over the cover, so it passes nothing else standing nearby
        expect(walkerDepth(map, x, y)).toBeLessThanOrEqual(
          Math.max(depthKey(x, y, WALKER_LAYER), drawn.zIndex + 1),
        );
      },
    );
  });

  it('keeps the walker sorted by its feet among everything that stands up', () => {
    forAll(
      (rng) => ({
        props: Array.from({ length: rng.int(1, 3) }, () => anyProp(rng, STANDING)),
        tile: { x: rng.int(0, W - 1), y: rng.int(0, H - 1) },
        at: { x: rng.range(-0.5, 0.4999), y: rng.range(-0.5, 0.4999) },
      }),
      ({ props, tile, at }) => {
        const map = emptyMap(1, W, H);
        map.props.set(tile.y * W + tile.x, props);
        const x = tile.x + at.x,
          y = tile.y + at.y;
        expect(walkerDepth(map, x, y)).toBe(depthKey(x, y, WALKER_LAYER));
      },
    );
  });

  it('reads nothing outside the map', () => {
    const map = emptyMap(1, W, H);
    map.props.set(0, [{ kind: 'wheat', variant: 0, ox: 0, oy: 0 }]);
    // (W, -1) would share an index with a tile inside if the bounds were not checked
    expect(walkerDepth(map, W, -1)).toBe(depthKey(W, -1, WALKER_LAYER));
  });

  it('never sorts a walker under its own feet, and reads only the props of the tile it stands on', () => {
    forAll(
      (rng) => {
        const props: [number, PropInstance[]][] = [];
        for (let i = 0; i < W * H; i++)
          if (rng.chance(0.7))
            props.push([
              i,
              Array.from({ length: rng.int(1, 3) }, () =>
                anyProp(rng, rng.chance(0.5) ? COVER : PROP_KINDS),
              ),
            ]);
        // inside the map mostly, and a little way out of it on any side
        return { props, x: rng.range(-2, W + 1), y: rng.range(-2, H + 1) };
      },
      ({ props, x, y }) => {
        const full = emptyMap(1, W, H),
          own = emptyMap(1, W, H),
          tx = Math.round(x),
          ty = Math.round(y);
        for (const [i, list] of props) {
          full.props.set(i, list);
          if (tx >= 0 && ty >= 0 && tx < W && ty < H && i === ty * W + tx) own.props.set(i, list);
        }
        const depth = walkerDepth(full, x, y);
        expect(depth).toBeGreaterThanOrEqual(depthKey(x, y, WALKER_LAYER));
        // every other tile's props, covers included, leave it where its own tile puts it
        expect(depth).toBe(walkerDepth(own, x, y));
      },
      {
        format: ({ props, x, y }) => {
          const tx = Math.round(x),
            ty = Math.round(y);
          return JSON.stringify({ x, y, own: props.find(([i]) => i === ty * W + tx)?.[1] ?? null });
        },
      },
    );
  });
});
