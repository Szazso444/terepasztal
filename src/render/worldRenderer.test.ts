import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Container,
  Graphics,
  Mesh,
  Rectangle,
  Sprite,
  Texture,
  TextureSource,
  type FillInstruction,
} from 'pixi.js';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { Dir, ELEV_PX, depthKey, tileToWorld } from '../engine/iso';
import { harvestBreakdown } from '../sim/stations';
import { SEEDS, forAll, shrinkArray } from '../testing/property';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain, type GameMap, type PropInstance } from '../world/tiles';
import {
  TRACK_ITEMS,
  TRACK_KINDS,
  isUnitKind,
  makePiece,
  pieceFrame,
  rotationCount,
  type TrackPiece,
} from '../world/track';
import { structureScale, TREE_SCALE } from './assetScale';
import { litTiles } from './harvestHighlight';
import { Landscape, type PainterPool } from './landscape';
import { buildRelief, groundAllows } from './terrainRelief';
import { underPaintedWater } from './terrainMaterials';
import { WATERLINE } from './bridgeMeshes';
import { WorldRenderer } from './worldRenderer';

const SOURCE = new TextureSource({ width: 1024, height: 1024 });

/** A frame `w` x `h` world px across, at `resolution` texels per px; its pixels are never read. */
function frame(w: number, h: number, resolution = 1): FrameInfo {
  return {
    image: undefined as never,
    texture: new Texture({
      source: SOURCE,
      frame: new Rectangle(0, 0, w * resolution, h * resolution),
      orig: new Rectangle(0, 0, w, h),
    }),
    anchorX: 0.5,
    anchorY: 0.9,
    w,
    h,
  };
}

const FRAMES: Record<string, FrameInfo> = {
  'structures/water_tower': frame(40, 60),
  'structures/water_tower_r2': frame(40, 60),
  'structures/power_line': frame(16, 40),
  'structures/depot_r1': frame(90, 70),
  'structures/station_1': frame(50, 42.25, 4),
  'structures/station_1_r1': frame(60, 55),
  'structures/townhouse_s1': frame(40, 50),
  'structures/townhouse_s1_r3': frame(40, 50),
  'terrain/ghost_ok': frame(64, 32),
  'props/oak_2': frame(20, 30),
};

/** What a ground fit hands out in these tests, one set per picture and scale, as surfaces cache. */
const FIT_TEXTURES = new Map<
  string,
  { foot: Texture; shadow: Texture; feet: { x: number; y: number; right: boolean }[] }
>();
function fitTextures(key: string, scale: number) {
  const id = `${key}|${scale}`;
  if (!FIT_TEXTURES.has(id))
    FIT_TEXTURES.set(id, {
      foot: new Texture({ source: SOURCE, frame: new Rectangle(0, 0, 4, 4) }),
      shadow: new Texture({ source: SOURCE, frame: new Rectangle(0, 0, 8, 4) }),
      feet: Array.from({ length: 41 }, (_, i) => i - 20).map((x) => ({
        x,
        y: 10 - Math.abs(x) / 2,
        right: x > 0,
      })),
    });
  return FIT_TEXTURES.get(id)!;
}

/**
 * The copies of their atlas frames that buildings are drawn from, one per frame as surfaces cache
 * them, with the frame each was copied from. surfaceAssets.test.ts pins that a copy holds its
 * frame's own texels.
 */
const PICTURES = new Map<string, { texture: Texture; from: FrameInfo }>();
function pictureOf(key: string, f: FrameInfo) {
  if (!PICTURES.has(key))
    PICTURES.set(key, {
      texture: new Texture({
        source: SOURCE,
        frame: new Rectangle(0, 0, f.texture.frame.width, f.texture.frame.height),
        orig: new Rectangle(0, 0, f.w, f.h),
      }),
      from: f,
    });
  return PICTURES.get(key)!.texture;
}

/**
 * A world renderer with only what placing a structure touches: the atlas above, a one-tile map,
 * its two layers, and surfaces that hand back textures without reading pixels (Node has no
 * canvas), the pictures from `PICTURES`. `families` records the window-light family each building
 * was lit with; `fits` the picture and scale each ground fit was asked for.
 */
function renderer() {
  const objects = new Container(),
    contactGround = new Container(),
    families: string[] = [],
    fits: string[] = [],
    weeds: { texture: Texture; items: number }[] = [];
  const world = Object.create(WorldRenderer.prototype) as WorldRenderer;
  Object.assign(world, {
    atlas: { has: (k: string) => k in FRAMES, get: (k: string) => FRAMES[k] },
    map: { w: 1, h: 1, originX: 0, originY: 0, terrain: [0], biome: [0] },
    objects,
    contactGround,
    city: new Set(),
    propTint: 0xffffff,
    structures: new Map(),
    structureAnchors: new Map(),
    windowLights: new Map(),
    groundFits: new Map(),
    surfaces: {
      picture: pictureOf,
      window: (_key: string, _f: FrameInfo, _procedural: boolean, family: string) => {
        families.push(family);
        return Texture.EMPTY;
      },
      groundFit: (key: string, _f: FrameInfo, scale: number) => {
        fits.push(`${key}|${scale}`);
        const t = fitTextures(key, scale);
        return {
          foot: { texture: t.foot, anchorX: 0.5, anchorY: 0.8 },
          shadow: { texture: t.shadow, anchorX: 0.3, anchorY: 0.2 },
          feet: t.feet,
        };
      },
      weeds: (items: readonly unknown[], ground: string) => {
        if (!items.length || ground === 'none') return null;
        const texture = new Texture({ source: SOURCE, frame: new Rectangle(0, 0, 6, 3) });
        weeds.push({ texture, items: items.length });
        return { texture, anchorX: 0.5, anchorY: 0.5 };
      },
    },
    landscape: { setCity: () => {}, invalidate: () => {} },
    texturedParts: new Map(),
    groundSprites: [],
    elevationOf: () => 0,
    refreshScatter: () => {},
  });
  const lights = () => objects.children.filter((c) => c.label === 'emissive').length;
  return {
    world,
    objects,
    contactGround,
    lights,
    patches: () => contactGround.children.length,
    families,
    fits,
    weeds,
  };
}

describe('a structure sprite switching frames', () => {
  it('takes its new frame size, lights and ground shadow, never the frame before', () => {
    const { world, lights, patches, families } = renderer();
    const s = world.setStructure('decor:0,0', 0, 0, 'structures/water_tower');
    expect(s.scale.x).toBeCloseTo(0.7, 9);
    expect([lights(), patches()]).toEqual([1, 1]);
    // the same sprite shows a frame with no scale reference: scale 1, no lights, no shadow
    expect(world.setStructure('decor:0,0', 0, 0, 'structures/power_line')).toBe(s);
    expect([s.scale.x, s.scale.y]).toEqual([1, 1]);
    expect([lights(), patches()]).toEqual([0, 0]);
    // and back to a building, turned this time: its unturned frame's size and lights
    world.setStructure('decor:0,0', 0, 0, 'structures/water_tower_r2');
    expect(s.scale.x).toBeCloseTo(0.7, 9);
    expect([lights(), patches()]).toEqual([1, 1]);
    expect(families.at(-1)).toBe('water_tower');
    world.setStructure('decor:0,0', 0, 0, 'structures/depot_r1');
    expect(s.scale.x).toBe(1);
    expect([lights(), patches()]).toEqual([0, 0]);
  });

  it('lights a turned house with its unturned family', () => {
    const { world, families } = renderer();
    const s = world.setStructure('decor:0,0', 0, 0, 'structures/townhouse_s1_r3');
    expect(s.scale.x).toBeCloseTo(structureScale('structures/townhouse_s1'), 9);
    expect(families).toEqual(['townhouse']);
  });

  it('measures each picture by its own door: illustrated by height, generated by reference', () => {
    const { world } = renderer();
    const s = world.setStructure('station:1', 0, 0, 'structures/station_1');
    expect(s.scale.x).toBeCloseTo(structureScale('structures/station_1', 42.25), 9);
    // the turn is a generated picture, so its door is the generator's reference door
    world.setStructure('station:1', 0, 0, 'structures/station_1_r1');
    expect(s.scale.x).toBeCloseTo(structureScale('structures/station_1'), 9);
  });
});

type FitParts = { shadow: Sprite; foot: Sprite; weeds: Sprite };
const fitsOf = (world: WorldRenderer) =>
  (world as unknown as { groundFits: Map<string, FitParts> }).groundFits;

describe('a building fitted to the ground', () => {
  const BUILDINGS = [
    'structures/water_tower',
    'structures/water_tower_r2',
    'structures/station_1',
    'structures/station_1_r1',
    'structures/townhouse_s1',
    'structures/townhouse_s1_r3',
  ];

  it("shows its own atlas frame's copy at the frame's size, whatever it showed before", () => {
    const { world } = renderer();
    for (const frame of [...BUILDINGS, 'structures/power_line', ...[...BUILDINGS].reverse()]) {
      const s = world.setStructure('station:1', 0, 0, frame),
        f = FRAMES[frame];
      if (frame === 'structures/power_line') {
        // no building: the atlas frame itself, as any other sprite
        expect(s.texture, frame).toBe(f.texture);
        continue;
      }
      expect(s.texture, frame).toBe(PICTURES.get(frame)?.texture);
      expect(PICTURES.get(frame)!.from, frame).toBe(f);
      // the copy changes no size: the sprite is the frame's world size at the building's scale
      expect(s.width, frame).toBeCloseTo(f.w * s.scale.x, 9);
      expect(s.height, frame).toBeCloseTo(f.h * s.scale.y, 9);
      expect([s.anchor.x, s.anchor.y], frame).toEqual([f.anchorX, f.anchorY]);
    }
  });

  it('casts its shadow on the ground and draws its foot and weeds in its own depth', () => {
    const { world, objects, contactGround } = renderer();
    const s = world.setStructure('decor:0,0', 0, 0, 'structures/townhouse_s1', 20, 3, 5),
      fit = fitsOf(world).get('decor:0,0')!;
    expect(fit.shadow.parent).toBe(contactGround);
    expect([fit.foot.parent, fit.weeds.parent]).toEqual([objects, objects]);
    expect(fit.weeds.tint).toBe(0xffffff);
    // right after the picture, before anything a depth step in front (a wheat field, a train)
    for (const part of [fit.foot, fit.weeds]) {
      expect(part.zIndex).toBeGreaterThan(s.zIndex);
      expect(part.zIndex).toBeLessThan(depthKey(1, 0, 10));
      expect(part.zIndex).toBeLessThan(depthKey(0, 0, 21));
    }
    expect(fit.foot.zIndex).toBeLessThan(fit.weeds.zIndex);
    expect(fit.weeds.visible).toBe(true);
  });

  it('grows no weeds on paving, grows them again when the paving goes, and frees each set', () => {
    const { world, weeds } = renderer();
    world.setStructure('decor:0,0', 0, 0, 'structures/townhouse_s1');
    const sprite = fitsOf(world).get('decor:0,0')!.weeds,
      shown = () => (sprite.visible ? sprite.texture : null);
    expect(weeds.length).toBe(1);
    expect(weeds[0].items).toBeGreaterThan(0);
    expect(shown()).toBe(weeds[0].texture);
    // the same building on the same ground keeps its weeds
    world.setStructure('decor:0,0', 0, 0, 'structures/townhouse_s1');
    expect(weeds.length).toBe(1);
    world.setCity(new Set([0]));
    expect(shown()).toBeNull();
    expect(weeds[0].texture.destroyed).toBe(true);
    world.setStructure('decor:0,0', 0, 0, 'structures/townhouse_s1_r3');
    expect(shown()).toBeNull();
    world.setStructure('decor:0,0', 0, 0, 'structures/townhouse_s1');
    world.setCity(new Set());
    expect(weeds.length).toBe(2);
    expect(shown()).toBe(weeds[1].texture);
    world.removeStructure('decor:0,0');
    expect(weeds[1].texture.destroyed).toBe(true);
  });

  it('moves, turns, scales and goes with its building', () => {
    const { world, objects, contactGround, fits } = renderer();
    const check = (frame: string) => {
      const s = world.getStructure('decor:0,0')!,
        fit = fitsOf(world).get('decor:0,0')!,
        t = fitTextures(frame, s.scale.x);
      expect(fits.at(-1)).toBe(`${frame}|${s.scale.x}`);
      expect([fit.shadow.texture, fit.foot.texture]).toEqual([t.shadow, t.foot]);
      for (const part of [fit.shadow, fit.foot, fit.weeds])
        expect([part.x, part.y], frame).toEqual([s.x, s.y]);
      expect([fit.foot.scale.x, fit.foot.scale.y]).toEqual([s.scale.x, s.scale.y]);
      expect(contactGround.children).toEqual([fit.shadow]);
    };
    world.setStructure('decor:0,0', 0, 0, 'structures/townhouse_s1', 20, 3, 5);
    check('structures/townhouse_s1');
    const first = fitsOf(world).get('decor:0,0')!;
    // turned, moved and grown into another building: the same parts follow
    world.setStructure('decor:0,0', 0, 0, 'structures/townhouse_s1_r3', 20, -4, 2);
    check('structures/townhouse_s1_r3');
    world.setStructure('decor:0,0', 0, 0, 'structures/water_tower', 20, 0, 0);
    check('structures/water_tower');
    expect(fitsOf(world).get('decor:0,0')).toBe(first);
    // a frame that is no building has no ground fit
    world.setStructure('decor:0,0', 0, 0, 'structures/power_line', 14);
    expect(fitsOf(world).has('decor:0,0')).toBe(false);
    expect([first.shadow, first.foot, first.weeds].every((p) => p.destroyed)).toBe(true);
    expect(contactGround.children).toEqual([]);
    world.setStructure('decor:0,0', 0, 0, 'structures/station_1');
    check('structures/station_1');
    const last = fitsOf(world).get('decor:0,0')!;
    world.removeStructure('decor:0,0');
    expect(fitsOf(world).size).toBe(0);
    expect([last.shadow, last.foot, last.weeds].every((p) => p.destroyed)).toBe(true);
    expect([contactGround.children.length, objects.children.length]).toEqual([0, 0]);
  });

  it("draws its shadow and weeds at the size they were made for, its foot at the picture's, each on its own anchor", () => {
    const { world } = renderer();
    for (const frame of BUILDINGS) {
      const s = world.setStructure('decor:0,0', 0, 0, frame),
        fit = fitsOf(world).get('decor:0,0')!;
      // the shadow and weeds are world px at the building's scale already; the foot is the picture's
      expect([fit.shadow.scale.x, fit.shadow.scale.y], frame).toEqual([1, 1]);
      expect([fit.weeds.scale.x, fit.weeds.scale.y], frame).toEqual([1, 1]);
      expect([fit.foot.scale.x, fit.foot.scale.y], frame).toEqual([s.scale.x, s.scale.y]);
      // the anchors the surfaces mock hands out for the shadow, the foot and the weeds
      expect([fit.shadow.anchor.x, fit.shadow.anchor.y], frame).toEqual([0.3, 0.2]);
      expect([fit.foot.anchor.x, fit.foot.anchor.y], frame).toEqual([0.5, 0.8]);
      expect([fit.weeds.anchor.x, fit.weeds.anchor.y], frame).toEqual([0.5, 0.5]);
    }
    // the scales differ between these frames, so the checks above are not all at scale 1
    const scales = new Set(BUILDINGS.map((f) => world.setStructure('decor:0,0', 0, 0, f).scale.x));
    expect(scales.size).toBeGreaterThan(1);
  });

  it('shows no cast shadow for a picture with its own baked in, and no foot or weeds where it has no foot', () => {
    const { world } = renderer(),
      surfaces = (world as unknown as { surfaces: { groundFit: (...a: never[]) => unknown } })
        .surfaces,
      fitted = surfaces.groundFit;
    // as surfaces answer: station_1_r1 has its shadow baked in, water_tower_r2 stands on no foot
    surfaces.groundFit = ((key: string, f: FrameInfo, scale: number) => {
      const art = (fitted as (k: string, f: FrameInfo, s: number) => Record<string, unknown>)(
        key,
        f,
        scale,
      );
      if (key === 'structures/station_1_r1') return { ...art, shadow: null };
      if (key === 'structures/water_tower_r2') return { foot: null, shadow: null, feet: [] };
      return art;
    }) as never;
    const shown = () => {
      const fit = fitsOf(world).get('decor:0,0')!;
      return [fit.shadow.visible, fit.foot.visible, fit.weeds.visible];
    };
    world.setStructure('decor:0,0', 0, 0, 'structures/station_1');
    expect(shown()).toEqual([true, true, true]);
    world.setStructure('decor:0,0', 0, 0, 'structures/station_1_r1');
    expect(shown()).toEqual([false, true, true]);
    world.setStructure('decor:0,0', 0, 0, 'structures/water_tower_r2');
    expect(shown()).toEqual([false, false, false]);
    // turned back, all of it shows again
    world.setStructure('decor:0,0', 0, 0, 'structures/station_1');
    expect(shown()).toEqual([true, true, true]);
  });

  it("grows the same weeds on the same world tile, wherever the map's origin lies", () => {
    /** The weeds and pebbles a building on local tile (x, y) grows, with the map's origin. */
    const grown = (originX: number, originY: number, x: number, y: number) => {
      const { world } = renderer(),
        surfaces = (
          world as unknown as {
            surfaces: { weeds: (items: readonly unknown[], ground: string) => unknown };
          }
        ).surfaces,
        draw = surfaces.weeds,
        items: unknown[][] = [];
      surfaces.weeds = (it, ground) => {
        items.push([...it]);
        return draw(it, ground);
      };
      Object.assign(world, {
        map: { w: 8, h: 8, originX, originY, terrain: Array(64).fill(0), biome: Array(64).fill(0) },
      });
      world.setStructure('decor:b', x, y, 'structures/townhouse_s1');
      return items;
    };
    const here = grown(0, 0, 3, 4);
    expect(here.length).toBe(1);
    expect(here[0].length).toBeGreaterThan(0);
    // world tile (3, 4) again, on a map that has grown so its origin is elsewhere
    expect(grown(-2, 1, 5, 3)).toEqual(here);
    expect(grown(3, 4, 0, 0)).toEqual(here);
    // the next tile grows its own
    expect(grown(0, 0, 4, 4)).not.toEqual(here);
  });

  it('follows its building when the ground under it is repainted to another height', () => {
    const { world } = renderer();
    let lift = 0;
    // what animate touches besides the buildings: a landscape that has just been repainted
    Object.assign(world, {
      elevationOf: () => -lift,
      landscape: {
        flush: () => true,
        active: false,
        ready: true,
        root: { visible: false },
        isPainted: () => false,
      },
      refreshSummits: () => {},
      harvest: { refresh: () => {} },
      trackSprites: new Map(),
      scatterSprites: new Map(),
      propSprites: new Map(),
      ground: { visible: true },
      view: null,
      waterClock: 0,
      rippleRefresh: 0,
      waterPhase: 0,
      waterSprites: [],
    });
    const s = world.setStructure('decor:0,0', 0, 0, 'structures/townhouse_s1', 20, 3, 5),
      fit = fitsOf(world).get('decor:0,0')!,
      p = tileToWorld(0, 0);
    for (lift of [13, -7, 0, 20]) {
      world.animate(0);
      expect([s.x, s.y], `lifted ${lift}`).toEqual([p.x + 5, p.y - lift + 3]);
      for (const part of [fit.shadow, fit.foot, fit.weeds])
        expect([part.x, part.y], `lifted ${lift}`).toEqual([s.x, s.y]);
      expect([fit.foot.scale.x, fit.foot.scale.y]).toEqual([s.scale.x, s.scale.y]);
      expect(fit.foot.zIndex).toBeGreaterThan(s.zIndex);
      expect(fit.weeds.zIndex).toBeGreaterThan(fit.foot.zIndex);
    }
  });

  it('leaves the shadow, shade and weeds of another building with the same picture whole when one goes', () => {
    const { world } = renderer();
    world.setStructure('decor:a', 0, 0, 'structures/townhouse_s1');
    world.setStructure('decor:b', 0, 0, 'structures/townhouse_s1');
    const a = fitsOf(world).get('decor:a')!,
      b = fitsOf(world).get('decor:b')!,
      shown = (fit: FitParts) => [fit.shadow.texture, fit.foot.texture, fit.weeds.texture],
      aWeeds = a.weeds.texture,
      bShows = shown(b);
    // the shadow and shade are the picture's, shared; the weeds are each building's own
    expect([a.shadow.texture, a.foot.texture]).toEqual(bShows.slice(0, 2));
    expect(aWeeds).not.toBe(bShows[2]);
    world.removeStructure('decor:a');
    expect(aWeeds.destroyed, "the gone building's own weeds").toBe(true);
    expect(shown(b)).toEqual(bShows);
    expect(bShows.map((t) => t.destroyed)).toEqual([false, false, false]);
    // and when the other turns into a frame that is no building, the picture's layers still stand
    world.setStructure('decor:a', 0, 0, 'structures/townhouse_s1');
    const again = shown(fitsOf(world).get('decor:a')!);
    world.setStructure('decor:b', 0, 0, 'structures/power_line', 14);
    expect(bShows[2].destroyed).toBe(true);
    expect(again.map((t) => t.destroyed)).toEqual([false, false, false]);
  });

  it('draws every building of one frame from the one copy, which outlives each of them', () => {
    const { world } = renderer();
    for (const frame of BUILDINGS) {
      const a = world.setStructure('decor:a', 0, 0, frame),
        b = world.setStructure('decor:b', 0, 0, frame),
        copy = PICTURES.get(frame)!.texture,
        shown = (s: Sprite, at: string) => {
          expect(s.texture, `${frame} ${at}`).toBe(copy);
          expect(copy.destroyed, `${frame} ${at}`).toBe(false);
        };
      shown(a, 'shown twice');
      shown(b, 'shown twice');
      world.removeStructure('decor:a');
      shown(b, 'when the other goes');
      // the other shows a frame that is no building, then goes too; the next shows the copy again
      world.setStructure('decor:b', 0, 0, 'structures/power_line', 14);
      expect(copy.destroyed, `${frame} when the other shows no building`).toBe(false);
      world.removeStructure('decor:b');
      shown(world.setStructure('decor:c', 0, 0, frame), 'when both have gone');
      world.removeStructure('decor:c');
    }
  });
});

describe('a ghost sprite switching frames', () => {
  it('takes each new frame size', () => {
    const { world } = renderer();
    const g = new Sprite();
    const steps: [string, number][] = [
      ['structures/water_tower', 0.7],
      ['structures/water_tower_r2', 0.7],
      ['terrain/ghost_ok', 1],
      ['structures/water_tower_r2', 0.7],
      ['props/oak_2', TREE_SCALE],
      ['structures/depot_r1', 1],
    ];
    for (const [key, scale] of steps) {
      world.setSpriteFrame(g, key);
      expect(g.scale.x, key).toBeCloseTo(scale, 9);
      expect(g.scale.y, key).toBeCloseTo(scale, 9);
    }
  });
});

/** A paint worker that hears everything and answers nothing. */
const quietWorker = () => ({
  onmessage: null,
  onerror: null,
  postMessage: () => {},
  terminate: () => {},
});
type Quiet = ReturnType<typeof quietWorker>;

/** A world renderer with only what the building rules ask of it: a landscape and its map. */
function groundOf(map: ReturnType<typeof emptyMap>, painters: PainterPool) {
  const landscape = new Landscape(map, new Set(), new Map(), painters);
  const world = Object.create(WorldRenderer.prototype) as WorldRenderer;
  Object.assign(world, { landscape, map });
  return { world, landscape };
}
/** Workers that loaded their sheet: painting, and active from the first flush. */
function working(map: ReturnType<typeof emptyMap>) {
  const spawned: Quiet[] = [];
  const g = groundOf(map, {
    size: 2,
    spawn: () => {
      const w = quietWorker();
      spawned.push(w);
      return w as unknown as Worker;
    },
    sheet: () => 'test://terrain-surfaces.png',
  });
  (spawned[0].onmessage as unknown as (e: { data: object }) => void)?.({ data: { loaded: true } });
  g.landscape.flush();
  expect(g.landscape.active).toBe(true);
  return g;
}
/** Workers that cannot start, twice: the landscape is off for the session. */
function failed(map: ReturnType<typeof emptyMap>) {
  const g = groundOf(map, {
    size: 2,
    spawn: () => {
      throw new Error('Worker is not defined');
    },
    sheet: () => 'test://terrain-surfaces.png',
  });
  expect(g.landscape.failed).toBe(true);
  return g;
}
/** A 32 x 32 map of hills with a mountain in them, as terrainRelief.test.ts walks. */
function hills() {
  const m = emptyMap(7412, 32, 32);
  for (let y = 3; y < 29; y++)
    for (let x = 3; x < 29; x++)
      m.terrain[y * 32 + x] = x > 7 && x < 25 && y > 7 && y < 25 ? Terrain.Mountain : Terrain.Hill;
  return m;
}

describe('the building rules on slopes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('answer alike while the painter works and after it has failed, as the relief says', () => {
    const map = hills(),
      relief = buildRelief(map, new Set(), undefined, new Map());
    const ok = working(hills()).world,
      lost = failed(hills()).world;
    let refused = 0,
      allowed = 0;
    // every tile and the ring just outside the map, for both needs
    for (let y = -1; y <= map.h; y++)
      for (let x = -1; x <= map.w; x++)
        for (const need of ['straight', 'level'] as const) {
          const expected = groundAllows(map, relief, x, y, need);
          expect(ok.groundAllows(x, y, need), `working, ${need} at ${x},${y}`).toBe(expected);
          expect(lost.groundAllows(x, y, need), `failed, ${need} at ${x},${y}`).toBe(expected);
          if (expected) allowed++;
          else refused++;
        }
    expect(refused).toBeGreaterThan(0);
    expect(allowed).toBeGreaterThan(0);
    // a bank is refused level ground and a tile outside the map is refused outright
    expect(lost.groundAllows(3, 3, 'level')).toBe(false);
    expect(lost.groundAllows(-1, 0, 'straight')).toBe(false);
  });

  it('follow the terrain changed after the failure, as they do while the painter works', () => {
    const grow = (world: WorldRenderer, landscape: Landscape, map: ReturnType<typeof emptyMap>) => {
      const before = world.groundAllows(14, 16, 'level');
      for (let y = 14; y < 19; y++)
        for (let x = 14; x < 19; x++) {
          map.terrain[y * map.w + x] = Terrain.Hill;
          landscape.invalidate(x, y);
        }
      return [before, world.groundAllows(14, 16, 'level'), world.groundAllows(16, 16, 'level')];
    };
    const flat = () => emptyMap(7412, 32, 32);
    const [a, b] = [flat(), flat()];
    const ok = working(a),
      lost = failed(b);
    // open ground first, then the hill's foot is a bank and its top is level again
    expect(grow(ok.world, ok.landscape, a)).toEqual([true, false, true]);
    expect(grow(lost.world, lost.landscape, b)).toEqual([true, false, true]);
  });
});

/** An atlas with every frame, all one tile in size: enough for a whole world renderer to build. */
const ANY_FRAME = frame(64, 32);
const EVERY_FRAME = { has: () => true, get: () => ANY_FRAME } as unknown as AtlasRegistry;

/**
 * A whole world renderer over `map`, built as the game builds it. Its paint workers cannot start
 * under Node, so its landscape is off and the per-tile ground and its elevations stand in.
 */
function wholeWorld(map: GameMap) {
  return new WorldRenderer(EVERY_FRAME, map, new RegionState(map));
}

const selecting = (x: number, y: number, id: string) => ({
  tool: { kind: 'none' },
  rot: 0,
  selected: { x, y, def: { id } },
});

/** The centre of each shape the harvest layer holds, as `x,y`, sorted. */
function centres(layer: Graphics): string[] {
  const out: string[] = [];
  for (const ins of layer.context.instructions)
    for (const { shape } of (ins as FillInstruction).data.path.shapePath.shapePrimitives) {
      const pts = (shape as { points?: number[] }).points ?? [];
      let x = 0;
      let y = 0;
      for (let i = 0; i < pts.length; i += 2) {
        x += pts[i];
        y += pts[i + 1];
      }
      out.push(point(x / (pts.length / 2), y / (pts.length / 2)));
    }
  return out.sort();
}

/** A point as text, to a millionth of a pixel: a relief's heights need not be whole. */
const point = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`;

/** Where the world puts the top face of each tile a `defId` on (x, y) counts, as `centres` reads. */
function grounds(world: WorldRenderer, x: number, y: number, defId: string): string[] {
  return litTiles(harvestBreakdown(world.map, x, y, defId, 1, 'spring'))
    .map((t) => world.surfacePoint(t.x, t.y))
    .map((p) => point(p.x, p.y))
    .sort();
}

describe('the harvest highlight in a whole world', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('lies over the ground, the track and the ground lights, and right under the objects', () => {
    const world = wholeWorld(emptyMap(1, 6, 6));
    const at = (c: Container) => world.root.getChildIndex(c);
    const layer = at(world.harvest.layer);
    const under = [world.border, world.landscape.root, world.ground, world.platforms, world.track];
    for (const c of [...under, world.lights]) expect(at(c)).toBeLessThan(layer);
    expect(at(world.objects)).toBe(layer + 1);
    for (const c of [world.fog, world.overlay]) expect(at(c)).toBeGreaterThan(layer);
    // one Graphics, with nothing hung under it
    expect(world.harvest.layer).toBeInstanceOf(Graphics);
    expect(world.harvest.layer.children).toHaveLength(0);
  });

  it("draws each lit tile on the world's own top face, raised ground and water included", () => {
    // hills around a quarry, and a pond around a pump
    const map = hills();
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) map.terrain[y * map.w + x] = Terrain.Water;
    const sites = [
      [5, 5, 'quarry'],
      [1, 1, 'pump'],
      [27, 4, 'quarry'],
    ] as const;
    for (const painting of [false, true]) {
      const world = wholeWorld(map);
      // a landscape that paints puts the ground on its relief rather than on per-tile steps
      if (painting) Object.assign(world, { landscape: working(map).landscape });
      let raised = 0;
      for (const [x, y, id] of sites) {
        const at = `${id} at ${x},${y}, ${painting ? 'painting' : 'off'}`;
        world.harvest.follow(null, selecting(x, y, id), 'spring');
        const want = grounds(world, x, y, id);
        expect(want.length, at).toBeGreaterThan(0);
        expect(centres(world.harvest.layer), at).toEqual(want);
        for (const t of litTiles(harvestBreakdown(map, x, y, id, 1, 'spring')))
          if (world.surfacePoint(t.x, t.y).y !== tileToWorld(t.x, t.y).y) raised++;
      }
      expect(raised, painting ? 'painting' : 'off').toBeGreaterThan(0);
    }
  });

  it('follows the relief on the frames its landscape says it moved, and on no others', () => {
    forAll(
      (rng) => Array.from({ length: rng.int(1, 40) }, () => rng.chance(0.25)),
      (moves) => {
        const world = wholeWorld(emptyMap(1, 9, 9));
        world.animate(0); // the landscape says once that it is off
        let step = 0;
        vi.spyOn(world, 'elevationOf').mockImplementation(
          (x, y) => -((x + 2 * y + step) % 3) * ELEV_PX,
        );
        const flush = vi.spyOn(world.landscape, 'flush');
        const clears = vi.spyOn(world.harvest.layer, 'clear');
        // nothing lit: a moving relief draws nothing
        flush.mockReturnValue(true);
        world.animate(1 / 60);
        expect(clears).not.toHaveBeenCalled();
        world.harvest.follow(null, selecting(4, 4, 'farm'), 'spring');
        let draws = 1;
        moves.forEach((moved, f) => {
          if (moved) step++;
          flush.mockReturnValue(moved);
          world.animate(1 / 60);
          if (moved) draws++;
          expect(clears.mock.calls.length, `frame ${f}`).toBe(draws);
          expect(centres(world.harvest.layer), `frame ${f}`).toEqual(grounds(world, 4, 4, 'farm'));
        });
      },
      // a whole world per case: twelve seeds, some 240 frames, keep it well inside the default limit
      { seeds: SEEDS.slice(0, 12), shrink: (moves) => shrinkArray(moves) },
    );
  });
});

/** Prop pictures for the fields below: a field covers its tile, a tree stands on it. */
const WHEAT = frame(64, 32);
const OAK = frame(20, 30);
const PROP_ATLAS = {
  has: (k: string) => !k.startsWith('props/') || k === 'props/wheat_0' || k === 'props/oak_0',
  get: (k: string) => (k === 'props/wheat_0' ? WHEAT : k === 'props/oak_0' ? OAK : ANY_FRAME),
} as unknown as AtlasRegistry;

const TILE = { x: 2, y: 2 };
const ID = TILE.y * 6 + TILE.x;
const field = (): PropInstance => ({ kind: 'wheat', variant: 0, ox: 0, oy: 0 });
const oak = (ox: number, oy: number): PropInstance => ({ kind: 'oak', variant: 0, ox, oy });

/** A 6 x 6 world whose tile (2, 2) holds `props`, built as the game builds it. */
function propWorld(props: PropInstance[], atlas = PROP_ATLAS, fill = Terrain.Grass) {
  const map = emptyMap(1, 6, 6, fill);
  map.props.set(ID, props);
  return new WorldRenderer(atlas, map, new RegionState(map));
}

/** The sprites of one picture the world draws now: neither hidden nor destroyed. */
function drawn(world: WorldRenderer, texture: Texture): Sprite[] {
  return world.objects.children.filter(
    (c): c is Sprite =>
      c instanceof Sprite && !c.destroyed && c.texture === texture && c.visible && c.renderable,
  );
}
const fieldsDrawn = (world: WorldRenderer) => drawn(world, WHEAT.texture);
const oaksDrawn = (world: WorldRenderer) => drawn(world, OAK.texture);

/** Lay a piece as the game does (onTrackChanged): displace the props, then show the piece. */
function lay(world: WorldRenderer, p: TrackPiece) {
  world.displaceProps(TILE.x, TILE.y, p.unit ? [] : (p.links as [number, number][]));
  world.setTrack(TILE.x, TILE.y, pieceFrame(p));
}
/** A member of a multi-tile piece, as the track graph stores one. */
const member = (p: TrackPiece): TrackPiece => ({
  ...p,
  unit: { ax: TILE.x, ay: TILE.y, member: 0 },
});

/** Where a prop at offset (ox, oy) in the tile is drawn: position and depth key. */
function placed(world: WorldRenderer, ox: number, oy: number) {
  const p = tileToWorld(TILE.x + ox, TILE.y + oy);
  return {
    x: Math.round(p.x),
    y: Math.round(p.y + world.elevationOf(TILE.x + ox, TILE.y + oy)),
    z: depthKey(TILE.x + ox, TILE.y + oy, 10),
  };
}
const whereIs = (s: Sprite) => ({ x: s.x, y: s.y, z: s.zIndex });

/** Every kind of track a tile can carry, and what the world does to a tree beside it. */
const TRACK: { name: string; piece: TrackPiece; trees: 'along y' | 'along x' | 'cleared' }[] = [
  { name: 'straight along y', piece: makePiece('straight', 0), trees: 'along y' },
  { name: 'straight along x', piece: makePiece('straight', 1), trees: 'along x' },
  { name: 'high speed straight', piece: makePiece('straight', 0, 'high_speed'), trees: 'along y' },
  { name: 'narrow straight', piece: makePiece('straight', 1, 'narrow'), trees: 'along x' },
  { name: 'bridge', piece: makePiece('bridge', 0), trees: 'along y' },
  { name: 'transition', piece: makePiece('transition', 1), trees: 'along x' },
  { name: 'regular curve', piece: member(makePiece('curve', 0)), trees: 'cleared' },
  { name: 'narrow curve', piece: makePiece('curve', 2, 'narrow'), trees: 'cleared' },
  { name: 'regular switch', piece: member(makePiece('switch', 1)), trees: 'cleared' },
  { name: 'narrow switch', piece: makePiece('switch', 5, 'narrow'), trees: 'cleared' },
  { name: 'crossing', piece: makePiece('crossing', 0), trees: 'cleared' },
];

describe('a wheat field under track', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('is drawn whole, at offset 0, where there is no track', () => {
    const world = propWorld([field()]);
    expect(fieldsDrawn(world).map(whereIs)).toEqual([placed(world, 0, 0)]);
  });

  for (const { name, piece, trees } of TRACK) {
    it(`is not drawn on a ${name}, but stays in the map; a tree is displaced as before`, () => {
      // the tree's offsets exercise both clamps and both signs
      const world = propWorld([field(), oak(-0.2, 0.35)]);
      expect(fieldsDrawn(world)).toHaveLength(1);
      expect(oaksDrawn(world).map(whereIs)).toEqual([placed(world, -0.2, 0.35)]);
      lay(world, piece);
      const [wheat, ...rest] = world.map.props.get(ID) ?? [];
      expect(wheat, 'the field is still in the map data').toEqual(field());
      expect(fieldsDrawn(world)).toHaveLength(0);
      if (trees === 'cleared') {
        // curves, switches and crossings need the whole tile
        expect(rest).toEqual([]);
        expect(oaksDrawn(world)).toHaveLength(0);
      } else {
        // beside the rails: 0.4 tile out across them, the other offset kept within 0.3
        const beside = trees === 'along y' ? oak(-0.4, 0.3) : oak(-0.2, 0.4);
        expect(rest).toEqual([beside]);
        expect(oaksDrawn(world).map(whereIs)).toEqual([placed(world, beside.ox, beside.oy)]);
      }
      // retiled from the map data (a terrain edit, a repair), the field is still under the track
      world.retile(TILE.x, TILE.y);
      expect(fieldsDrawn(world)).toHaveLength(0);
    });

    it(`is drawn again at offset 0 when the ${name} is removed`, () => {
      const world = propWorld([field(), oak(0.1, -0.1)]);
      lay(world, piece);
      world.setTrack(TILE.x, TILE.y, null);
      expect(fieldsDrawn(world).map(whereIs)).toEqual([placed(world, 0, 0)]);
      expect(world.map.props.get(ID)?.[0]).toEqual(field());
    });
  }

  it('is hidden as soon as displaceProps runs, before the piece itself is shown', () => {
    for (const { name, piece } of TRACK) {
      const world = propWorld([field()]);
      world.displaceProps(TILE.x, TILE.y, piece.unit ? [] : (piece.links as [number, number][]));
      expect(fieldsDrawn(world), name).toHaveLength(0);
    }
  });

  it('is put back at offset 0 where a save kept it pushed aside', () => {
    const world = propWorld([{ kind: 'wheat', variant: 0, ox: 0.4, oy: -0.1 }]);
    lay(world, makePiece('straight', 0));
    expect(fieldsDrawn(world)).toHaveLength(0);
    world.setTrack(TILE.x, TILE.y, null);
    expect(world.map.props.get(ID)).toEqual([field()]);
    expect(fieldsDrawn(world).map(whereIs)).toEqual([placed(world, 0, 0)]);
  });

  it('follows the track and the ground through any order of laying, removing and flattening', () => {
    type Op = 'straight' | 'curve' | 'remove' | 'retile' | 'flatten' | 'level';
    const OPS: Op[] = ['straight', 'curve', 'remove', 'retile', 'flatten', 'level'];
    forAll(
      (rng) => Array.from({ length: rng.int(1, 14) }, () => rng.pick(OPS)),
      (ops) => {
        const world = propWorld([field(), oak(0.2, 0.1)]);
        let railed = false,
          flat = false,
          tree = true;
        ops.forEach((op, n) => {
          if (op === 'straight') lay(world, makePiece('straight', 0));
          if (op === 'curve') lay(world, makePiece('curve', 1, 'narrow'));
          if (op === 'straight' || op === 'curve') railed = true;
          if (op === 'curve') tree = false;
          if (op === 'remove') {
            world.setTrack(TILE.x, TILE.y, null);
            railed = false;
          }
          if (op === 'retile') world.retile(TILE.x, TILE.y);
          if (op === 'flatten' || op === 'level') {
            world.setFlattened(TILE.x, TILE.y, op === 'flatten');
            flat = op === 'flatten';
          }
          const at = `after ${ops.slice(0, n + 1).join(', ')}`;
          expect(fieldsDrawn(world).length, `field ${at}`).toBe(!railed && !flat ? 1 : 0);
          expect(oaksDrawn(world).length, `tree ${at}`).toBe(tree && !flat ? 1 : 0);
          expect(world.map.props.get(ID)?.[0], `field data ${at}`).toEqual(field());
        });
      },
      { seeds: SEEDS.slice(0, 40), shrink: (ops) => shrinkArray(ops) },
    );
  });
});

/** The track a wheat field sits under, one by one: every item the builder offers, at every turn. */
const EVERY_PIECE: TrackPiece[] = [
  ...TRACK_ITEMS,
  // the bridge is laid by the builder rather than offered as an item, in every class
  ...(['regular', 'high_speed', 'narrow'] as const).map((cls) => ({
    kind: 'bridge' as const,
    cls,
  })),
].flatMap((item) =>
  Array.from({ length: rotationCount(item.kind) }, (_, rot) => {
    const piece = makePiece(item.kind, rot, item.cls, 'cls2' in item ? item.cls2 : undefined);
    // a curve or switch wider than one tile is stored as one member piece per tile
    return isUnitKind(item.kind, item.cls) ? member(piece) : piece;
  }),
);

/**
 * How a piece lies on its tile: a single link through it, north to south (along y) or east to
 * west (along x), or otherwise (curves, switches, crossings, every multi-tile member).
 */
function alongOf(piece: TrackPiece): 'y' | 'x' | null {
  if (piece.unit || piece.links.length !== 1) return null;
  const [a, b] = [...piece.links[0]].sort();
  return a === Dir.N && b === Dir.S ? 'y' : a === Dir.E && b === Dir.W ? 'x' : null;
}

/**
 * The oracle: a tile's props once `piece` is laid on it. A field is kept as it is, put back at
 * offset 0. Every other prop is moved 0.4 tile to the side of a straight line (the other offset
 * kept within 0.3, a prop at offset 0 going to the positive side) and cleared by anything else:
 * the rule before fields were cut, kept for coal, oil, trees, bushes and rocks.
 */
function afterLaying(props: PropInstance[], piece: TrackPiece): PropInstance[] {
  const along = alongOf(piece);
  const side = (v: number) => (v >= 0 ? 0.4 : -0.4);
  const within = (v: number) => Math.max(-0.3, Math.min(0.3, v));
  return props.flatMap((p): PropInstance[] => {
    if (p.kind === 'wheat') return [{ ...p, ox: 0, oy: 0 }];
    if (along === 'y') return [{ ...p, ox: side(p.ox), oy: within(p.oy) }];
    if (along === 'x') return [{ ...p, ox: within(p.ox), oy: side(p.oy) }];
    return [];
  });
}

/**
 * One picture per prop kind, so each kind's sprites can be told apart; `rock` has none, which
 * leaves a tile's sprites one short of its props (the world skips a prop it has no picture for).
 */
const MIXED = ['wheat', 'oak', 'bush', 'coal', 'oil', 'rock'] as const;
const MIXED_FRAMES = new Map<string, FrameInfo>(
  MIXED.filter((k) => k !== 'rock').map((k) => [k, frame(k === 'wheat' ? 64 : 20, 30)]),
);
const MIXED_WHEAT = MIXED_FRAMES.get('wheat')!;
const MIXED_ATLAS = {
  has: (k: string) => !k.startsWith('props/') || MIXED_FRAMES.has(k.slice(6, -2)),
  get: (k: string) => (k.startsWith('props/') && MIXED_FRAMES.get(k.slice(6, -2))) || ANY_FRAME,
} as unknown as AtlasRegistry;

const prop = (kind: (typeof MIXED)[number], ox: number, oy: number): PropInstance => ({
  kind,
  variant: 0,
  ox,
  oy,
});
const byText = (a: unknown, b: unknown) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
/** Every live sprite of one picture, hidden or not. */
const existing = (world: WorldRenderer, texture: Texture) =>
  world.objects.children.filter(
    (c): c is Sprite => c instanceof Sprite && !c.destroyed && c.texture === texture,
  );

/**
 * Lay `piece` on a tile holding `props`, then retile it, then take the piece away, and check at
 * each step that the map holds what `afterLaying` says and that each kind is drawn where the
 * props put it: a field only while the tile has no track, every other kind as the oracle says.
 */
function checkMixedTile(props: PropInstance[], piece: TrackPiece) {
  const world = propWorld(
    props.map((p) => ({ ...p })),
    MIXED_ATLAS,
  );
  const after = afterLaying(props, piece);
  const sees = (stage: string, inMap: PropInstance[], railed: boolean) => {
    expect(world.map.props.get(ID) ?? [], `${stage}: the map data`).toEqual(inMap);
    for (const [kind, f] of MIXED_FRAMES) {
      const want = inMap.filter((p) => p.kind === kind && !(railed && kind === 'wheat'));
      expect(drawn(world, f.texture).map(whereIs).sort(byText), `${stage}: ${kind} drawn`).toEqual(
        want.map((p) => placed(world, p.ox, p.oy)).sort(byText),
      );
    }
    // a tile is never left with a second, stale picture of its field
    expect(existing(world, MIXED_WHEAT.texture), `${stage}: field sprites`).toHaveLength(
      inMap.filter((p) => p.kind === 'wheat').length,
    );
  };
  sees('before the track', props, false);
  lay(world, piece);
  sees('with the track', after, true);
  world.retile(TILE.x, TILE.y);
  sees('retiled under the track', after, true);
  world.setTrack(TILE.x, TILE.y, null);
  sees('with the track gone', after, false);
}

/** A piece as text, for a failure message. */
const named = ({ kind, cls, cls2, rot, unit }: TrackPiece) =>
  `${kind} ${cls}${cls2 ? `/${cls2}` : ''} rot ${rot}${unit ? ' (member)' : ''}`;

describe('a tile of mixed props under track', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('has a case for every kind of track the graph holds', () => {
    // fails when a track kind is added without being run through the tests below
    expect([...new Set(EVERY_PIECE.map((p) => p.kind))].sort()).toEqual([...TRACK_KINDS].sort());
    expect(new Set(EVERY_PIECE.map(alongOf))).toEqual(new Set(['y', 'x', null]));
  });

  it('cuts the field and moves or clears the rest as before, under every piece at every turn', () => {
    // a rock (no picture) first and a field pushed aside in the middle: sprites and props do not
    // line up by index, and the offsets sit on both sides of 0 and of the clamp
    const props = [
      prop('rock', 0.1, 0.1),
      prop('oak', -0.2, 0.35),
      prop('wheat', 0.4, -0.1),
      prop('coal', 0, 0),
      prop('oil', 0.3, -0.3),
      prop('bush', -0.05, 0.05),
    ];
    for (const piece of EVERY_PIECE)
      try {
        checkMixedTile(props, piece);
      } catch (error) {
        throw new Error(`${named(piece)}: ${String(error)}`, { cause: error });
      }
  });

  it('does so for any mix of props and any piece', () => {
    const OFFSETS = [-0.42, -0.3, -0.2, -0.05, 0, 0.05, 0.3, 0.35, 0.42];
    forAll(
      (rng) => ({
        piece: rng.pick(EVERY_PIECE),
        props: Array.from({ length: rng.int(1, 5) }, () =>
          prop(rng.pick(MIXED), rng.pick(OFFSETS), rng.pick(OFFSETS)),
        ),
      }),
      ({ piece, props }) => {
        checkMixedTile(props, piece);
      },
      {
        seeds: SEEDS.slice(0, 60),
        shrink: ({ piece, props }) =>
          [...shrinkArray(props)].filter((p) => p.length > 0).map((p) => ({ piece, props: p })),
        format: ({ piece, props }) => `${named(piece)} over ${JSON.stringify(props)}`,
      },
    );
  });

  it('cuts only the field when displaceProps runs, before the piece itself is shown', () => {
    for (const piece of EVERY_PIECE) {
      const props = [prop('oak', 0.2, -0.2), prop('wheat', 0, 0), prop('coal', -0.1, 0.1)];
      const after = afterLaying(props, piece);
      const world = propWorld(
        props.map((p) => ({ ...p })),
        MIXED_ATLAS,
      );
      world.displaceProps(TILE.x, TILE.y, piece.unit ? [] : (piece.links as [number, number][]));
      const at = named(piece);
      expect(drawn(world, MIXED_WHEAT.texture), `${at}: field`).toHaveLength(0);
      for (const kind of ['oak', 'coal']) {
        const want = after.filter((p) => p.kind === kind);
        expect(
          drawn(world, MIXED_FRAMES.get(kind)!.texture).map(whereIs),
          `${at}: ${kind} drawn`,
        ).toEqual(want.map((p) => placed(world, p.ox, p.oy)));
      }
    }
  });

  it('is cut by a piece shown alone, where the game never displaces props', () => {
    // game.ts displaces props only on forest and grass; on sand the oak stays where it stands
    const world = propWorld([field(), oak(0.2, 0.1)], PROP_ATLAS, Terrain.Sand);
    world.setTrack(TILE.x, TILE.y, pieceFrame(makePiece('straight', 0)));
    expect(fieldsDrawn(world)).toHaveLength(0);
    expect(oaksDrawn(world).map(whereIs)).toEqual([placed(world, 0.2, 0.1)]);
    // another picture on the same tile (a piece replaced) leaves the field cut
    world.setTrack(TILE.x, TILE.y, pieceFrame(makePiece('curve', 1, 'narrow')));
    expect(fieldsDrawn(world)).toHaveLength(0);
    world.setTrack(TILE.x, TILE.y, null);
    expect(fieldsDrawn(world).map(whereIs)).toEqual([placed(world, 0, 0)]);
    expect(oaksDrawn(world).map(whereIs)).toEqual([placed(world, 0.2, 0.1)]);
  });

  it('stays cut under a piece the world bends into a mesh along its rail, and shows when it goes', () => {
    const map = emptyMap(1, 6, 6);
    map.props.set(ID, [field()]);
    const world = new WorldRenderer(PROP_ATLAS, map, new RegionState(map));
    // a painting landscape (the track follows the rail profile only then) and a climbing rail
    Object.assign(world, { landscape: working(map).landscape });
    world.setRailBeds(
      new Map([[ID, { axis: 'y', flat: false, spans: [{ from: 0, to: 5, a: 0, b: 2 }] }]]),
    );
    lay(world, makePiece('straight', 0));
    const meshes = () => world.track.children.filter((c) => c instanceof Mesh && !c.destroyed);
    expect(meshes(), 'the piece is drawn as a mesh').toHaveLength(1);
    expect(fieldsDrawn(world)).toHaveLength(0);
    world.retile(TILE.x, TILE.y);
    expect(fieldsDrawn(world)).toHaveLength(0);
    world.setTrack(TILE.x, TILE.y, null);
    expect(meshes()).toHaveLength(0);
    expect(fieldsDrawn(world).map(whereIs)).toEqual([placed(world, 0, 0)]);
  });

  it('is cut when it is put on the map under track and the tile is retiled', () => {
    // a tile with track and no props: nothing to displace, nothing drawn
    const world = propWorld([]);
    world.map.props.delete(ID);
    lay(world, makePiece('straight', 0));
    expect(fieldsDrawn(world)).toHaveLength(0);
    world.map.props.set(ID, [field()]);
    world.retile(TILE.x, TILE.y);
    expect(fieldsDrawn(world)).toHaveLength(0);
    world.setTrack(TILE.x, TILE.y, null);
    expect(fieldsDrawn(world).map(whereIs)).toEqual([placed(world, 0, 0)]);
  });

  it('leaves the fields of the tiles around it alone', () => {
    const map = emptyMap(1, 6, 6);
    for (const [x, y] of [
      [1, 2],
      [3, 2],
      [2, 1],
      [2, 3],
      [2, 2],
    ])
      map.props.set(y * 6 + x, [field()]);
    const world = new WorldRenderer(PROP_ATLAS, map, new RegionState(map));
    expect(fieldsDrawn(world)).toHaveLength(5);
    lay(world, makePiece('straight', 0));
    expect(fieldsDrawn(world)).toHaveLength(4);
    world.setTrack(TILE.x, TILE.y, null);
    expect(fieldsDrawn(world)).toHaveLength(5);
  });
});

describe('textured bridges over the painted water', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  /**
   * A whole world with two rivers along y, at x = 10, 11 and x = 24, 25, its landscape painting
   * and the bridge surfaces loaded, and a stone bridge over each river at y = 6.
   */
  function bridged() {
    const map = emptyMap(4242, 32, 32);
    for (let y = 0; y < 32; y++)
      for (const x of [10, 11, 24, 25]) map.terrain[y * 32 + x] = Terrain.Water;
    const world = wholeWorld(map),
      white = Texture.WHITE;
    Object.assign(world, {
      landscape: working(map).landscape,
      bridgeSurfaces: { stoneTop: white, stoneWall: white, woodTop: white, woodGrain: white },
    });
    const tiles = [10, 11, 24, 25].map((x) => ({
      x,
      y: 6,
      material: 'stone' as const,
      axis: 1 as const,
      open: [false, true, false, true],
      water: true,
      level: 1,
    }));
    world.setTexturedBridges(tiles);
    /** Each bridge tile's parts under the trains, by tile. */
    const parts = () =>
      new Map(
        [...(world['texturedParts'] as Map<number, { under: Container }>)].map(([k, p]) => [
          k,
          p.under,
        ]),
      );
    return { map, world, tiles, parts };
  }
  const at = (x: number) => 6 * 32 + x;

  it('keep their meshes while the water painted round them stays as it is', () => {
    const { world, tiles, parts } = bridged(),
      first = parts();
    expect(first.size).toBe(4);
    world.setTexturedBridges(tiles);
    world.animate(1 / 60);
    for (const [k, under] of parts()) expect(under, `tile ${k}`).toBe(first.get(k));
  });

  it("are drawn again when a town paves a bank in their water's reach, and only those", () => {
    const { world, parts } = bridged(),
      first = parts();
    // A town's paving on the near bank of the first river, beside its bridge.
    world.setCity(new Set([7 * 32 + 12]));
    world.animate(1 / 60);
    const second = parts();
    for (const x of [10, 11]) expect(second.get(at(x)), `x ${x}`).not.toBe(first.get(at(x)));
    for (const x of [24, 25]) expect(second.get(at(x)), `x ${x}`).toBe(first.get(at(x)));
  });

  it('are drawn again when the terrain round them turns to water, and only those', () => {
    const { map, world, parts } = bridged(),
      first = parts();
    // The second river widens in front of its bridge.
    map.terrain[7 * 32 + 26] = Terrain.Water;
    world.retile(26, 7);
    world.animate(1 / 60);
    const second = parts();
    for (const x of [10, 11]) expect(second.get(at(x)), `x ${x}`).toBe(first.get(at(x)));
    expect(second.get(at(25))).not.toBe(first.get(at(25)));
  });

  type Edit = { kind: 'pave' | 'water' | 'fail'; x: number; y: number };
  /** One bridge tile of the fixture's four: a stone or timber span, or a pad, at some level. */
  type Kind = { material: 'stone' | 'wood'; pad: boolean; level: number };
  // a whole world per case and a fresh drawing after each edit: some 2 s alone
  it('match a fresh drawing after any paving, terrain edit or landscape failure', () => {
    // The cache's own invariant: whatever happens round the bridges, each tile's meshes after
    // the next frame are the ones drawing it from scratch gives. The four bridge tiles are spans
    // or pads of either material at any level; edits land on and round both rivers, in the
    // bridges' reach and out of it; the landscape may fail on the way.
    const signature = (world: WorldRenderer) =>
      new Map(
        [...(world['texturedParts'] as Map<number, { under: Container; near: Container }>)].map(
          ([k, p]) => [
            k,
            [p.under, p.near]
              .flatMap((c) => c.children)
              .map((m) =>
                m instanceof Mesh
                  ? `${m.label} ${Array.from(m.geometry.positions).join(',')}`
                  : `${m.label}:${(m as Graphics).context?.instructions.length}`,
              ),
          ],
        ),
      );
    forAll(
      (rng) => ({
        kinds: Array.from({ length: 4 }, (): Kind => ({
          material: rng.pick(['stone', 'wood'] as const),
          pad: rng.chance(0.3),
          level: rng.int(1, 3),
        })),
        edits: Array.from({ length: rng.int(1, 6) }, (): Edit => {
          const kind = rng.chance(0.1) ? 'fail' : rng.chance(0.5) ? 'pave' : 'water';
          // Mostly on the rivers and their banks, beside and in front of the bridges. Paving a
          // bank takes the sliver of river painted over its edge, which no ground sample sees.
          return {
            kind,
            x: rng.chance(0.6)
              ? rng.pick(kind === 'pave' ? [9, 12, 23, 26] : [9, 10, 11, 12, 23, 24, 25, 26])
              : rng.int(7, 28),
            y: rng.chance(0.6) ? rng.int(5, 8) : rng.int(3, 10),
          };
        }),
      }),
      ({ kinds, edits }) => {
        const { map, world, tiles: spans } = bridged(),
          city = new Set<number>(),
          tiles = spans.map((t, i) => ({
            ...t,
            material: kinds[i].material,
            axis: kinds[i].pad ? null : t.axis,
            level: kinds[i].level,
          }));
        world.setTexturedBridges(tiles);
        edits.forEach((e, step) => {
          const k = e.y * 32 + e.x;
          if (e.kind === 'fail') Object.assign(world, { landscape: failed(map).landscape });
          else if (e.kind === 'pave') {
            if (!city.delete(k)) city.add(k);
            world.setCity(new Set(city));
          } else {
            map.terrain[k] = map.terrain[k] === Terrain.Water ? Terrain.Grass : Terrain.Water;
            world.retile(e.x, e.y);
          }
          world.animate(1 / 60);
          const kept = signature(world);
          // drawn from scratch: every tile's cached parts dropped first
          (world['texturedParts'] as Map<number, unknown>).clear();
          world.setTexturedBridges(tiles);
          expect(kept, `after edit ${step + 1}`).toEqual(signature(world));
        });
      },
      {
        seeds: SEEDS.slice(0, 12),
        shrink: function* (c) {
          for (const edits of shrinkArray(c.edits)) yield { ...c, edits };
        },
      },
    );
  }, 60_000);

  // a whole world per case: under a second alone
  it("cut to the painter's own waterline, paving included, or per tile once it has failed", () => {
    // The ground the world cuts its bridges to is the waterline exactly where the landscape
    // paints water alone (underPaintedWater, the rule its painter shares), a town's paving
    // included; with the landscape failed, exactly on the water tiles the per-tile ground shows.
    forAll(
      (rng) => ({
        paved: Array.from({ length: rng.int(0, 8) }, () => rng.int(4, 9) * 32 + rng.int(8, 27)),
        points: Array.from({ length: 200 }, () => [rng.range(8, 28), rng.range(4, 10)]),
      }),
      ({ paved, points }) => {
        const { map, world } = bridged(),
          city = new Set(paved),
          ground = (x: number, y: number) =>
            (world['bridgeGround'] as (x: number, y: number) => number).call(world, x, y);
        world.setCity(new Set(city));
        for (const [x, y] of points)
          expect(ground(x, y), `painted at ${x},${y}`).toBe(
            underPaintedWater(map, x, y, (k) => city.has(k)) ? WATERLINE : -world.elevationOf(x, y),
          );
        Object.assign(world, { landscape: failed(map).landscape });
        for (const [x, y] of points)
          expect(ground(x, y), `per tile at ${x},${y}`).toBe(
            map.terrain[Math.round(y) * 32 + Math.round(x)] === Terrain.Water
              ? WATERLINE
              : -world.elevationOf(x, y),
          );
      },
      {
        seeds: SEEDS.slice(0, 20),
        shrink: function* (c) {
          for (const points of shrinkArray(c.points)) if (points.length) yield { ...c, points };
          for (const paved of shrinkArray(c.paved)) yield { ...c, paved };
        },
      },
    );
  }, 20_000);
});
