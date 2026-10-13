import { describe, expect, it } from 'vitest';
import { Container, Rectangle, Texture, TextureSource, type Sprite } from 'pixi.js';
import type { FrameInfo } from '../engine/atlas';
import { depthKey } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll } from '../testing/property';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap, type PropInstance, type PropKind } from '../world/tiles';
import { buildRelief, reliefHeight } from './terrainRelief';
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

/** The shipped terraces over a map with a hill and a mountain in it. */
function terraces() {
  const map = emptyMap(388, 24, 24);
  for (let y = 5; y < 19; y++)
    for (let x = 5; x < 19; x++)
      map.terrain[y * 24 + x] =
        x > 9 && x < 14 && y > 9 && y < 14 ? Terrain.Mountain : Terrain.Hill;
  const relief = buildRelief(map, new Set());
  return { map, ground: ((x, y) => -reliefHeight(map, relief, x, y)) as GroundAt };
}

describe('walkerGround', () => {
  it('is the ground itself wherever the ground has no jump, as the painted terraces have none', () => {
    const { ground } = terraces();
    forAll(
      (rng) => ({ x: rng.range(2, 21), y: rng.range(2, 21) }),
      ({ x, y }) => {
        expect(walkerGround(ground, x, y)).toBeCloseTo(ground(x, y), 2);
      },
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

describe('walkerDepth', () => {
  const COVER = [...GROUND_COVER];

  it('draws a walker over the ground cover of the tile it stands on, wherever on the tile', () => {
    forAll(
      (rng) => ({
        kind: COVER[rng.int(0, COVER.length - 1)],
        tile: { x: rng.int(0, W - 1), y: rng.int(0, H - 1) },
        at: { x: rng.range(-0.5, 0.4999), y: rng.range(-0.5, 0.4999) },
        offset: { x: rng.range(-0.1, 0.1), y: rng.range(-0.1, 0.1) },
      }),
      ({ kind, tile, at, offset }) => {
        const map = emptyMap(1, W, H),
          cover: PropInstance = { kind, variant: 0, ox: offset.x, oy: offset.y };
        map.props.set(tile.y * W + tile.x, [cover]);
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
    const STANDING: PropKind[] = ['tree', 'pine', 'rock', 'bush', 'flowers', 'boulder', 'reeds'];
    forAll(
      (rng) => ({
        kind: STANDING[rng.int(0, STANDING.length - 1)],
        tile: { x: rng.int(0, W - 1), y: rng.int(0, H - 1) },
        at: { x: rng.range(-0.5, 0.4999), y: rng.range(-0.5, 0.4999) },
      }),
      ({ kind, tile, at }) => {
        const map = emptyMap(1, W, H);
        map.props.set(tile.y * W + tile.x, [{ kind, variant: 0, ox: 0.2, oy: 0.2 }]);
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
});
