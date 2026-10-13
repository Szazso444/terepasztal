import { describe, expect, it } from 'vitest';
import { Container, Rectangle, Texture, TextureSource, type Sprite } from 'pixi.js';
import golden from '../art/atlasFrames.golden.json';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { depthKey } from '../engine/iso';
import type { Rng } from '../engine/rng';
import type { PeopleSim, Person } from '../sim/people';
import { forAll } from '../testing/property';
import { PROP_KINDS } from '../world/chunks';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap, type PropInstance, type PropKind } from '../world/tiles';
import { PERSON_PX } from './assetScale';
import { PeopleRenderer } from './peopleRenderer';
import { GROUND_COVER } from './walkerGround';
import { WorldRenderer } from './worldRenderer';

const W = 12,
  H = 12;

const SOURCE = new TextureSource({ width: 256, height: 256 });
/** A frame `w` x `h` world px, anchored as the atlas anchors it; its pixels are never read. */
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

/** A walker frame's size and anchor (people/walker_*: 6 x 12, feet at 11). */
const WALKER_FRAME = frame(6, 12, 11 / 12);
/** An atlas with every key, each a walker frame. */
const ATLAS = { has: () => true, get: () => WALKER_FRAME } as unknown as AtlasRegistry;

/** One walker out of doors at (x, y). */
function walker(x: number, y: number, state: Person['state'] = 'walk'): Person {
  return {
    id: 1,
    x,
    y,
    home: 'house',
    outfit: 0,
    profession: 'passenger',
    carrying: false,
    state,
    timer: 0,
    path: [],
    step: 0,
    transient: false,
    stationId: null,
  };
}

/** The part of PeopleSim the renderer reads: its people and its map. */
const people = (map: GameMap, persons: Person[]) => ({ map, persons }) as unknown as PeopleSim;

/**
 * A world renderer with only what drawing a prop and reading the ground touch: the map, the
 * object layer, flat ground unless `failed` (the per-tile ground the game falls back to when its
 * landscape painter fails), and an atlas whose prop frames have the size of a wheat field.
 */
function world(map: GameMap, objects: Container, flattened = new Set<number>()) {
  const w = Object.create(WorldRenderer.prototype) as WorldRenderer;
  Object.assign(w, {
    atlas: { has: () => true, get: () => frame(54, 30, 0.55) },
    map,
    objects,
    flattened,
    landscape: { failed: true },
    propTint: 0xffffff,
  });
  return w as unknown as {
    propSprite(x: number, y: number, p: PropInstance): Sprite;
    elevationOf(x: number, y: number): number;
  };
}

const COVER = [...GROUND_COVER];
const STANDING = PROP_KINDS.filter((k) => !GROUND_COVER.has(k));
const anyProp = (rng: Rng, kinds: readonly PropKind[]): PropInstance => ({
  kind: rng.pick(kinds),
  variant: rng.int(0, 2),
  ox: rng.range(-0.4, 0.4),
  oy: rng.range(-0.4, 0.4),
});

describe('PeopleRenderer', () => {
  it('draws a walker on a ground-cover tile over the cover, in the shared object layer', () => {
    forAll(
      (rng) => ({
        cover: anyProp(rng, COVER),
        tile: { x: rng.int(0, W - 1), y: rng.int(0, H - 1) },
        at: { x: rng.range(-0.5, 0.4999), y: rng.range(-0.5, 0.4999) },
        state: rng.pick<Person['state']>(['walk', 'idle', 'gather', 'waiting', 'return']),
      }),
      ({ cover, tile, at, state }) => {
        const map = emptyMap(1, W, H),
          objects = new Container();
        objects.sortableChildren = true;
        map.props.set(tile.y * W + tile.x, [cover]);
        const drawer = new PeopleRenderer(ATLAS, objects, () => 0);
        drawer.update(people(map, [walker(tile.x + at.x, tile.y + at.y, state)]), 0);
        const [person] = objects.children;
        // the cover is built after the walker, as a field rebuilt under a standing walker is, so
        // a tie in the sort would leave the field on top
        const field = world(map, objects).propSprite(tile.x, tile.y, cover);
        objects.sortChildren();
        expect(objects.children.indexOf(person)).toBeGreaterThan(objects.children.indexOf(field));
      },
    );
  });

  it('sorts a walker by its feet where its tile has only standing props, as before', () => {
    forAll(
      (rng) => ({
        props: Array.from({ length: rng.int(0, 3) }, () => anyProp(rng, STANDING)),
        tile: { x: rng.int(0, W - 1), y: rng.int(0, H - 1) },
        at: { x: rng.range(-0.5, 0.4999), y: rng.range(-0.5, 0.4999) },
      }),
      ({ props, tile, at }) => {
        const map = emptyMap(1, W, H),
          objects = new Container(),
          x = tile.x + at.x,
          y = tile.y + at.y;
        if (props.length) map.props.set(tile.y * W + tile.x, props);
        new PeopleRenderer(ATLAS, objects, () => 0).update(people(map, [walker(x, y)]), 0);
        expect(objects.children[0].zIndex).toBe(depthKey(x, y, 16));
      },
    );
  });

  it('moves a walker crossing tiles on the per-tile ground at most a pixel a short step', () => {
    forAll(
      (rng) => {
        const terrain = Array.from({ length: W * H }, () =>
            rng.pick([Terrain.Grass, Terrain.Hill, Terrain.Mountain]),
          ),
          // diagonal half the time: the walkers step in eight directions, through tile corners
          angle = rng.chance(0.5)
            ? rng.pick([1, 3, 5, 7]) * (Math.PI / 4)
            : rng.range(0, 2 * Math.PI);
        return { terrain, from: { x: rng.range(3, W - 4), y: rng.range(3, H - 4) }, angle };
      },
      ({ terrain, from, angle }) => {
        const map = emptyMap(1, W, H),
          layer = new Container();
        map.terrain.set(terrain);
        const ground = world(map, new Container()),
          drawer = new PeopleRenderer(ATLAS, layer, (x, y) => ground.elevationOf(x, y)),
          person = walker(from.x, from.y),
          sim = people(map, [person]);
        let last: number | undefined,
          worst = { jump: 0, at: from };
        // steps of 0.002 tiles: a pop is a whole level (10 px) in one step, a climb a fraction
        for (let i = 0; i < 1000; i++) {
          person.x = from.x + Math.cos(angle) * 0.002 * i;
          person.y = from.y + Math.sin(angle) * 0.002 * i;
          drawer.update(sim, 1 / 60);
          const y = layer.children[0].position.y;
          if (last !== undefined && Math.abs(y - last) > worst.jump)
            worst = { jump: Math.abs(y - last), at: { x: person.x, y: person.y } };
          last = y;
        }
        expect(worst.jump, `at ${JSON.stringify(worst.at)}`).toBeLessThanOrEqual(1);
      },
      { format: ({ from, angle }) => JSON.stringify({ from, angle }) },
    );
  });
});

describe('the size of a walker', () => {
  /** A renderer whose atlas gives every walker key the frame `f`, and the one sprite it draws. */
  function drawn(f: FrameInfo, state: Person['state'] = 'walk') {
    const layer = new Container(),
      map = emptyMap(1, W, H),
      atlas = { has: () => true, get: () => f } as unknown as AtlasRegistry;
    new PeopleRenderer(atlas, layer, () => 0).update(people(map, [walker(5.3, 6.7, state)]), 0);
    return layer.children[0] as Sprite;
  }

  it('is PERSON_PX tall whatever the frame measures in world pixels', () => {
    forAll(
      (rng) => ({
        w: rng.int(3, 40),
        h: rng.int(6, 40),
        state: rng.pick<Person['state']>(['walk', 'idle', 'gather', 'waiting', 'return']),
      }),
      ({ w, h, state }) => {
        const s = drawn(frame(w, h, (h - 1) / h), state);
        expect(s.height).toBeCloseTo(PERSON_PX, 9);
        // the picture keeps its proportions
        expect(s.width / s.height).toBeCloseTo(w / h, 9);
      },
    );
  });

  it('keeps the feet where they were as the frame changes size', () => {
    forAll(
      (rng) => ({ h: rng.int(6, 40), other: rng.int(6, 40) }),
      ({ h, other }) => {
        const a = drawn(frame(6, h, (h - 1) / h)),
          b = drawn(frame(6, other, (other - 1) / other));
        expect(b.position.x).toBe(a.position.x);
        expect(b.position.y).toBe(a.position.y);
        // the sprite is anchored at its feet, so the scale grows or shrinks it from there
        expect(a.anchor.y).toBeCloseTo((h - 1) / h, 9);
      },
    );
  });

  it("draws today's generated figures 9 px tall", () => {
    const sizes = golden.people as Record<string, string>;
    const walkers = Object.entries(sizes).filter(([key]) => key.startsWith('people/walker_'));
    // four outfits, two frames each
    expect(walkers).toHaveLength(8);
    for (const [key, spec] of walkers) {
      const [, w, h, , ay] = /^(\d+)x(\d+)@(\d+),(\d+)$/.exec(spec)!.map(Number);
      const s = drawn(frame(w, h, ay / h));
      expect(s.height, key).toBeCloseTo(9, 9);
      expect(s.scale.y, key).toBeCloseTo(9 / h, 9);
    }
  });
});
