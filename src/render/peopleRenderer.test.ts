import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Container, Rectangle, Texture, TextureSource, type Sprite } from 'pixi.js';
import golden from '../art/atlasFrames.golden.json';
import { generatePeopleAtlas } from '../art/people';
import { AtlasRegistry, type AtlasImage, type FrameInfo } from '../engine/atlas';
import { depthKey, tileToWorld } from '../engine/iso';
import { Rng } from '../engine/rng';
import { PROFESSIONS, type PeopleSim, type Person } from '../sim/people';
import { forAll, SEEDS } from '../testing/property';
import { PROP_KINDS } from '../world/chunks';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap, type PropInstance, type PropKind } from '../world/tiles';
import { PERSON_PX } from './assetScale';
import { PeopleRenderer, STEP_TILES } from './peopleRenderer';
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
/** The old walker's keys, which an atlas without a profession's frames falls back to. */
const isOldWalker = (key: string) => key.startsWith('people/walker_');
/** An atlas with the old walker's keys, each a walker frame. */
const ATLAS = { has: isOldWalker, get: () => WALKER_FRAME } as unknown as AtlasRegistry;

/** An atlas of the keys `has` allows, each its own 9 px frame, with the key each texture is for. */
function keyedAtlas(has: (key: string) => boolean) {
  const frames = new Map<string, FrameInfo>(),
    keys = new Map<Texture, string>(),
    get = (key: string) => {
      let f = frames.get(key);
      if (!f) {
        f = frame(5, 9, 8 / 9);
        frames.set(key, f);
        keys.set(f.texture, key);
      }
      return f;
    };
  return {
    atlas: { has, get } as unknown as AtlasRegistry,
    keyOf: (s: Sprite) => keys.get(s.texture),
  };
}

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
      atlas = { has: isOldWalker, get: () => f } as unknown as AtlasRegistry;
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

  it('stays PERSON_PX tall as the one sprite changes to a frame of another height', () => {
    forAll(
      (rng) => ({
        heights: [rng.int(6, 40), rng.int(6, 40)],
        // the steps a walker takes, then rests, then takes again
        states: Array.from({ length: 6 }, () => rng.pick(['walk', 'idle', 'return'] as const)),
      }),
      ({ heights, states }) => {
        const frames = heights.map((h) => frame(6, h, (h - 1) / h)),
          // the old walker has two frames, and a step of STEP_TILES goes to the other one
          atlas = {
            has: isOldWalker,
            get: (key: string) => frames[key.endsWith('_f1') ? 1 : 0],
          } as unknown as AtlasRegistry,
          layer = new Container(),
          drawer = new PeopleRenderer(atlas, layer, () => 0),
          person = walker(5.3, 6.7);
        for (const state of states) {
          person.state = state;
          if (state !== 'idle') person.x += STEP_TILES;
          drawer.update(people(emptyMap(1, W, H), [person]), 0.2);
          const s = layer.children[0] as Sprite;
          expect(layer.children).toHaveLength(1);
          expect(s.height).toBeCloseTo(PERSON_PX, 9);
        }
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

describe('the steps of a walker', () => {
  const STEP = 'people/passenger_front_walk_f';
  const every = (key: string) => key.startsWith('people/') && !isOldWalker(key);

  /** A drawer of one walker over an atlas of every profession's frames, and its one sprite. */
  function walking(person: Person, has: (key: string) => boolean = every) {
    const { atlas, keyOf } = keyedAtlas(has),
      layer = new Container(),
      drawer = new PeopleRenderer(atlas, layer, () => 0),
      sim = people(emptyMap(1, W, H), [person]);
    return {
      /** Draws a frame and says what the walker shows. */
      draw() {
        drawer.update(sim);
        const s = layer.children[0] as Sprite;
        return { key: keyOf(s), mirrored: s.scale.x < 0, sprite: s };
      },
    };
  }

  /** The frame a walker shows at each of `n` steps of `by` tiles along x. */
  function framesAlong(by: number, n: number) {
    const person = walker(1, 5),
      seen = walking(person),
      frames: number[] = [];
    for (let i = 0; i < n; i++) {
      person.x = 1 + by * i;
      frames.push(Number(seen.draw().key!.slice(-1)));
    }
    return frames;
  }

  it('walks through its four poses, one every STEP_TILES', () => {
    const quarter = STEP_TILES / 4;
    const frames = framesAlong(quarter, 40);
    // the sum drifts by a rounding error at each pose's edge: read the middle of each pose
    expect(frames.filter((_, i) => i % 4 === 2)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
  });

  it('keeps its frame while it stands, whatever the time', () => {
    forAll(
      (rng) => ({
        walked: rng.range(0, 1),
        state: rng.pick<Person['state']>(['idle', 'waiting', 'walk', 'gather']),
      }),
      ({ walked, state }) => {
        const person = walker(1, 5),
          seen = walking(person);
        seen.draw();
        person.x += walked;
        const stopped = seen.draw().key;
        person.state = state;
        for (let i = 0; i < 20; i++) expect(seen.draw().key).toBe(stopped);
      },
    );
  });

  it('takes as many frames over a tile at 1x as at 3x', () => {
    // 0.2 tiles a second drawn 60 times a second: game speed 3 is three times the ground a frame
    const perFrame = 0.2 / 60,
      at1x = framesAlong(perFrame, 300),
      at3x = framesAlong(perFrame * 3, 100),
      changes = (frames: number[]) => frames.filter((f, i) => i > 0 && f !== frames[i - 1]).length;
    expect(changes(at1x)).toBe(Math.floor((299 * perFrame) / STEP_TILES));
    expect(changes(at3x)).toBe(changes(at1x));
    // and the same frame stands on the same spot of ground at both speeds
    at3x.forEach((f, i) => expect(f).toBe(at1x[i * 3]));
  });

  it('counts a walker put somewhere else as no step', () => {
    const person = walker(1, 5),
      seen = walking(person);
    seen.draw();
    person.x += STEP_TILES + 0.001;
    const before = seen.draw().key;
    person.x += 3.01;
    expect(seen.draw().key).toBe(before);
  });

  // the tile axes on the screen: +x down right, +y down left, -x up left, -y up right
  it.each([
    [1, 0, 'front', false],
    [0, 1, 'front', true],
    [-1, 0, 'back', true],
    [0, -1, 'back', false],
  ])('walking along (%i, %i) shows the %s, mirrored: %s', (dx, dy, view, mirrored) => {
    const person = walker(5, 5),
      seen = walking(person);
    seen.draw();
    for (let i = 1; i <= 4; i++) {
      person.x = 5 + dx * 0.1 * i;
      person.y = 5 + dy * 0.1 * i;
      seen.draw();
    }
    const now = seen.draw();
    expect(now.key).toContain(`passenger_${view}_walk_f`);
    expect(now.mirrored).toBe(mirrored);
    // mirrored about the feet, at its size
    expect(now.sprite.height).toBeCloseTo(9, 9);
    expect(now.sprite.scale.y).toBe(1);
  });

  it('keeps the way it faced when it stops', () => {
    const person = walker(5, 5),
      seen = walking(person);
    seen.draw();
    person.x -= 0.3;
    const walked = seen.draw();
    for (let i = 0; i < 5; i++) {
      const stood = seen.draw();
      expect([stood.key, stood.mirrored]).toEqual([walked.key, true]);
    }
  });

  it.each(PROFESSIONS)('draws a %s from its own frames', (profession) => {
    const seen = walking({ ...walker(5, 5), profession });
    expect(seen.draw().key).toBe(`people/${profession}_front_walk_f0`);
  });

  it('draws the carry frames while it carries', () => {
    const seen = walking({ ...walker(5, 5), profession: 'lumberjack', carrying: true });
    expect(seen.draw().key).toBe('people/lumberjack_front_carry_f0');
  });

  it('walks on its walk frames while it carries where it has no carry frames', () => {
    const seen = walking(
      { ...walker(5, 5), carrying: true },
      (key) => every(key) && !key.includes('_carry_'),
    );
    expect(seen.draw().key).toBe(`${STEP}0`);
  });

  it('shows the old walker, by its outfit, where the atlas has no frames of its profession', () => {
    const person = { ...walker(5, 5), outfit: 2 },
      seen = walking(person, isOldWalker);
    expect(seen.draw().key).toBe('people/walker_2_f0');
    person.x += STEP_TILES;
    expect(seen.draw().key).toBe('people/walker_2_f1');
  });
});

describe('a walker drawn from the atlas registry', () => {
  /** Node has no ImageData: enough of it for the atlas packer to keep its pixels. */
  class FakeImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
      this.width = typeof a === 'number' ? a : b;
      this.height = typeof a === 'number' ? b : (c ?? a.length / 4 / b);
      this.data = typeof a === 'number' ? new Uint8ClampedArray(a * b * 4) : a;
    }
  }
  beforeAll(() => {
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: () => {} }),
      }),
    });
    // no atlas file is served, so the group is built by its generator, as with no people.json
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })));
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const STATES: Person['state'][] = ['walk', 'idle', 'gather', 'waiting', 'return'];

  /** A registry that has loaded `generate` as its people group, the way the game loads it. */
  async function loaded(generate: () => AtlasImage) {
    const atlas = new AtlasRegistry(new Set());
    await atlas.load([{ name: 'people', generate }]);
    return atlas;
  }

  /** The sprites a PeopleRenderer over `atlas` draws for `persons`, in their order. */
  function drawnFrom(atlas: AtlasRegistry, persons: Person[]) {
    const layer = new Container();
    new PeopleRenderer(atlas, layer, () => 0).update(people(emptyMap(1, W, H), persons));
    return layer.children as Sprite[];
  }

  /**
   * A people group whose walkers are `w` x `h` world px, the feet one pixel above the bottom, drawn
   * at `resolution` texels per world pixel: a frame table in texels, as a packer writes it.
   */
  function figures(w: number, h: number, resolution: number): () => AtlasImage {
    const def = {
      x: 0,
      y: 0,
      w: w * resolution,
      h: h * resolution,
      ax: (w * resolution) / 2,
      ay: (h - 1) * resolution,
    };
    return () => ({
      image: { width: 256, height: 256 } as HTMLCanvasElement,
      resolution,
      frames: Object.fromEntries(
        [0, 1, 2, 3].flatMap((outfit) =>
          [0, 1].map((step) => [`people/walker_${outfit}_f${step}`, def]),
        ),
      ),
    });
  }

  it("draws today's generated figures 9 px tall, each outfit in each step, by its own frame", async () => {
    const atlas = await loaded(generatePeopleAtlas);
    for (const step of [0, 1]) {
      const crowd = [0, 1, 2, 3].map((outfit) => ({ ...walker(5.3, 6.7), id: outfit + 1, outfit })),
        layer = new Container(),
        drawer = new PeopleRenderer(atlas, layer, () => 0),
        sim = people(emptyMap(1, W, H), crowd);
      drawer.update(sim);
      // a pose further on is the old walker's other frame
      for (const person of crowd) person.x += step * STEP_TILES;
      drawer.update(sim);
      const sprites = layer.children as Sprite[];
      expect(sprites).toHaveLength(4);
      sprites.forEach((s, outfit) => {
        const key = `people/walker_${outfit}_f${step}`,
          f = atlas.get(key);
        expect(s.texture, key).toBe(f.texture);
        expect(s.height, key).toBeCloseTo(PERSON_PX, 9);
        expect(s.width / s.height, key).toBeCloseTo(f.w / f.h, 9);
      });
    }
  });

  it('is PERSON_PX tall from an atlas of any resolution, on the same spot', async () => {
    const at = tileToWorld(5.3, 6.7);
    const reference = drawnFrom(await loaded(figures(6, 12, 1)), [walker(5.3, 6.7)])[0];
    expect([reference.position.x, reference.position.y]).toEqual([
      Math.round(at.x),
      Math.round(at.y),
    ]);
    for (const seed of SEEDS) {
      const rng = new Rng(seed),
        c = {
          w: rng.int(3, 24),
          h: rng.int(6, 40),
          resolution: rng.pick([1, 2, 3, 4, 6, 8]),
          outfit: rng.int(0, 3),
          state: rng.pick(STATES),
        },
        where = `seed ${seed}: ${JSON.stringify(c)}`;
      const [s] = drawnFrom(await loaded(figures(c.w, c.h, c.resolution)), [
        { ...walker(5.3, 6.7, c.state), outfit: c.outfit },
      ]);
      expect(s, where).toBeDefined();
      // a figure of any resolution is 9 px tall in the world, in the proportions of its picture
      expect(s.height, where).toBeCloseTo(PERSON_PX, 9);
      expect(s.width, where).toBeCloseTo((PERSON_PX * c.w) / c.h, 9);
      // and stands where the 6 x 12 figure at resolution 1 does
      expect([s.position.x, s.position.y], where).toEqual([
        reference.position.x,
        reference.position.y,
      ]);
      // the feet are the anchor, one world pixel above the picture's bottom
      expect(s.anchor.y, where).toBeCloseTo((c.h - 1) / c.h, 9);
    }
  });

  it('draws a figure exported at 18 and at 36 texels as 9 px, as one drawn at 9', async () => {
    // a 4 x 9 px figure: 9, 18 and 36 texels tall at resolution 1, 2 and 4
    for (const resolution of [1, 2, 4]) {
      const [s] = drawnFrom(await loaded(figures(4, 9, resolution)), [walker(5.3, 6.7)]);
      expect(s.height, `${9 * resolution} texels at resolution ${resolution}`).toBeCloseTo(
        PERSON_PX,
        9,
      );
    }
  });
});
