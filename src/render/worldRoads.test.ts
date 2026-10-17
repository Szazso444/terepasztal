/**
 * Roads as the world renderer draws them (#329): what it hands the painter to repaint when a road
 * is laid or lifted, when the track or the street doors under and round it change, and when a save
 * hands it every road; the level-crossing deck it lays over track, in its own layer; and the
 * nature it hides under a road and shows again when the road goes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Mesh, Rectangle, Sprite, Texture, TextureSource } from 'pixi.js';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { DIRS, DIR_DX, DIR_DY, Dir, opposite } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { crossable } from '../sim/roads';
import { forAll, shrinkArray } from '../testing/property';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain, type GameMap, type PropInstance, type PropKind } from '../world/tiles';
import { makePiece, pieceFrame, type TrackPiece } from '../world/track';
import { railLevel, type RailBed } from '../world/railProfile';
import { Landscape } from './landscape';
import { RoadPaint } from './roadPaint';
import {
  ROAD_CROSSING_X,
  ROAD_CROSSING_Y,
  ROAD_PINNED_SHIFT,
  roadCode,
  roadPath,
  roadShape,
  type RoadShape,
} from './roadShape';
import type { PavingDoor } from './townPaving';
import { WorldRenderer } from './worldRenderer';

const SOURCE = new TextureSource({ width: 1024, height: 1024 });
/** One frame per key, a tile in size, made when first asked for: a sprite shows which by texture. */
const FRAMES = new Map<string, FrameInfo>();
function frameOf(key: string): FrameInfo {
  let f = FRAMES.get(key);
  if (!f) {
    f = {
      image: undefined as never,
      texture: new Texture({
        source: SOURCE,
        frame: new Rectangle(0, 0, 64 * 4, 44 * 4),
        orig: new Rectangle(0, 0, 64, 44),
      }),
      anchorX: 0.5,
      anchorY: 20 / 44,
      w: 64,
      h: 44,
    };
    FRAMES.set(key, f);
  }
  return f;
}
const ATLAS = { has: () => true, get: frameOf } as unknown as AtlasRegistry;

/** A quiet paint worker: the landscape paints (it has not failed) and nothing comes back. */
const quietWorker = () => ({ onmessage: null, onerror: null, postMessage() {}, terminate() {} });

interface World {
  world: WorldRenderer;
  map: GameMap;
  /** the road tiles the game has, as `roadAt` reads them */
  roads: Set<number>;
  /** each call to the landscape's `repaint` since the last `take`, as `x,y` */
  take(): string[];
  /** the codes the painter was last handed, by tile */
  codes(): Map<number, number>;
  lay(x: number, y: number): void;
  lift(x: number, y: number): void;
}

/**
 * A whole world renderer on a `size` square grass map, its roads wired as the game wires them
 * (`roadAt`, `roadChanged`), with a landscape that paints (quiet workers) and records the tiles
 * it is told to repaint and the roads it is handed.
 */
function roadWorld(size = 8, fill = Terrain.Grass): World {
  const map = emptyMap(4, size, size, fill, 17, -6);
  const world = new WorldRenderer(ATLAS, map, new RegionState(map));
  const landscape = new Landscape(map, new Set(), new Map(), {
    size: 1,
    spawn: () => quietWorker() as unknown as Worker,
    sheet: () => 'test://terrain-surfaces.png',
  });
  expect(landscape.failed).toBe(false);
  Object.assign(world, { landscape });
  const repaints: string[] = [];
  let handed: readonly number[] = [];
  vi.spyOn(landscape, 'repaint').mockImplementation((x, y) => void repaints.push(`${x},${y}`));
  vi.spyOn(landscape, 'setRoads').mockImplementation((list) => void (handed = list));
  const roads = new Set<number>();
  world.roadAt = (x, y) => roads.has(y * size + x);
  return {
    world,
    map,
    roads,
    take: () => repaints.splice(0).sort(),
    codes: () => {
      const out = new Map<number, number>();
      for (let i = 0; i < handed.length; i += 2) out.set(handed[i], handed[i + 1]);
      return out;
    },
    lay: (x, y) => {
      roads.add(y * size + x);
      world.roadChanged(x, y);
    },
    lift: (x, y) => {
      roads.delete(y * size + x);
      world.roadChanged(x, y);
    },
  };
}
const sorted = (tiles: [number, number][]) => tiles.map(([x, y]) => `${x},${y}`).sort();

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('a road laid or lifted', () => {
  it('repaints its tile and its four neighbours, and hands the painter the roads with their codes', () => {
    const w = roadWorld();
    w.lay(3, 3);
    expect(w.take()).toEqual(
      sorted([
        [3, 3],
        [2, 3],
        [4, 3],
        [3, 2],
        [3, 4],
      ]),
    );
    expect(w.codes()).toEqual(new Map([[27, roadCode(0, 0)]]));
    w.lay(4, 3);
    expect(w.take()).toEqual(
      sorted([
        [4, 3],
        [3, 3],
        [5, 3],
        [4, 2],
        [4, 4],
      ]),
    );
    expect(w.codes()).toEqual(
      new Map([
        [27, roadCode(1 << Dir.E, 0)],
        [28, roadCode(1 << Dir.W, 0)],
      ]),
    );
    // at the map's edge only the neighbours on the map
    w.lay(0, 0);
    expect(w.take()).toEqual(
      sorted([
        [0, 0],
        [1, 0],
        [0, 1],
      ]),
    );
    // and lifted again: the same tiles, the road gone from the hand-off
    w.lift(3, 3);
    expect(w.take()).toEqual(
      sorted([
        [3, 3],
        [2, 3],
        [4, 3],
        [3, 2],
        [3, 4],
      ]),
    );
    expect([...w.codes().keys()].sort()).toEqual([0, 28]);
    expect(w.codes().get(28)).toBe(roadCode(0, 0));
  });

  it('keeps the yards following the road (the door paths run on to it)', () => {
    const w = roadWorld();
    const refresh = vi.spyOn(
      w.world as unknown as { refreshYards(f: unknown): void },
      'refreshYards',
    );
    w.lay(2, 2);
    expect(refresh).toHaveBeenCalled();
  });
});

describe('the track under a road', () => {
  it('repaints the road tiles whose crossing or sides it changes, and no others', () => {
    const w = roadWorld();
    // a road along x over three tiles, and a lone road two tiles off
    for (const x of [2, 3, 4]) w.lay(x, 3);
    w.lay(6, 6);
    w.take();
    // a regular straight along y under the middle: a level crossing, which its neighbours meet in
    // the middle
    w.world.setTrack(3, 3, pieceFrame(makePiece('straight', 0)));
    expect(w.take()).toEqual(
      sorted([
        [3, 3],
        [2, 3],
        [4, 3],
      ]),
    );
    const codes = w.codes();
    expect(codes.get(27)).toBe(roadCode((1 << Dir.E) | (1 << Dir.W), 0, 'x'));
    expect(codes.get(26)).toBe(roadCode(1 << Dir.E, 1 << Dir.E));
    expect(codes.get(28)).toBe(roadCode(1 << Dir.W, 1 << Dir.W));
    // the same piece again changes nothing
    w.world.setTrack(3, 3, pieceFrame(makePiece('straight', 0)));
    expect(w.take()).toEqual([]);
    // track on a tile with no road repaints no road
    w.world.setTrack(5, 5, pieceFrame(makePiece('straight', 1)));
    expect(w.take()).toEqual([]);
    // high-speed track is no crossing: back to a plain road
    w.world.setTrack(3, 3, pieceFrame(makePiece('straight', 0, 'high_speed')));
    expect(w.take()).toEqual(
      sorted([
        [3, 3],
        [2, 3],
        [4, 3],
      ]),
    );
    expect(w.codes().get(27)).toBe(roadCode((1 << Dir.E) | (1 << Dir.W), 0));
    // narrow track is, and taking it up again is not
    w.world.setTrack(3, 3, pieceFrame(makePiece('straight', 0, 'narrow')));
    expect(w.take()).toEqual(
      sorted([
        [3, 3],
        [2, 3],
        [4, 3],
      ]),
    );
    w.world.setTrack(3, 3, null);
    expect(w.take()).toEqual(
      sorted([
        [3, 3],
        [2, 3],
        [4, 3],
      ]),
    );
    expect(w.codes().get(26)).toBe(roadCode(1 << Dir.E, 0));
  });
});

describe('the street doors round a road', () => {
  it('repaint the road tile a door is added to or taken from, and only that', () => {
    const w = roadWorld();
    for (const x of [2, 3, 4]) w.lay(x, 3);
    w.take();
    // a house on 3, 2 whose street door faces S, on to the middle road tile
    const door = { tile: { x: 3, y: 2 }, side: Dir.S };
    w.world.setCity(new Set(), [door]);
    expect(w.take()).toEqual(sorted([[3, 3]]));
    // an arm toward the door, met in the middle
    expect(w.codes().get(27)).toBe(
      roadCode((1 << Dir.E) | (1 << Dir.W) | (1 << Dir.N), 1 << Dir.N),
    );
    w.world.setCity(new Set(), [door]);
    expect(w.take()).toEqual([]);
    // a door whose reach holds no road changes no road
    w.world.setCity(new Set(), [door, { tile: { x: 6, y: 6 }, side: Dir.E }]);
    expect(w.take()).toEqual([]);
    w.world.setCity(new Set(), []);
    expect(w.take()).toEqual(sorted([[3, 3]]));
  });
});

describe('the roads a save hands over', () => {
  it('paint every road tile, and repaint where a road known before is gone', () => {
    const w = roadWorld();
    w.lay(1, 1);
    w.take();
    w.world.setRoads([
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 6, y: 1 },
    ]);
    expect(w.take()).toEqual(
      sorted([
        [1, 1],
        [3, 3],
        [4, 3],
        [6, 1],
      ]),
    );
    expect([...w.codes().keys()].sort((a, b) => a - b)).toEqual([14, 27, 28]);
    expect(w.codes().get(27)).toBe(roadCode(1 << Dir.E, 0));
  });
});

/** The deck sprites drawn now, and the frame each shows. */
function decks(world: WorldRenderer) {
  return world.crossings.children.filter(
    (c): c is Sprite => c instanceof Sprite && !c.destroyed && c.visible,
  );
}
const showing = (s: Sprite) => [...FRAMES].find(([, f]) => f.texture === s.texture)?.[0];
const trackSprite = (world: WorldRenderer) =>
  world.track.children.find((c): c is Sprite => c instanceof Sprite && !c.destroyed)!;

describe('the level-crossing deck', () => {
  it('lies in its own layer over the track, under the lights, the harvest highlight and objects', () => {
    const { world } = roadWorld();
    const at = (c: Container) => world.root.getChildIndex(c);
    expect(at(world.track)).toBeLessThan(at(world.crossings));
    expect(at(world.crossings)).toBeLessThan(at(world.lights));
    expect(at(world.lights)).toBeLessThan(at(world.harvest.layer));
    expect(at(world.harvest.layer)).toBeLessThan(at(world.objects));
    // the game puts the night overlay in at the harvest layer's index: over the decks
    const night = new Container();
    world.root.addChildAt(night, at(world.harvest.layer));
    expect(at(world.crossings)).toBeLessThan(at(night));
    expect(at(night)).toBeLessThan(at(world.harvest.layer));
  });

  const PIECES: { name: string; piece: TrackPiece; deck: string | null }[] = [
    { name: 'regular along y', piece: makePiece('straight', 0), deck: 'regular_0' },
    { name: 'regular along x', piece: makePiece('straight', 1), deck: 'regular_1' },
    { name: 'narrow along y', piece: makePiece('straight', 0, 'narrow'), deck: 'narrow_0' },
    { name: 'narrow along x', piece: makePiece('straight', 1, 'narrow'), deck: 'narrow_1' },
    { name: 'high speed', piece: makePiece('straight', 0, 'high_speed'), deck: null },
    { name: 'narrow curve', piece: makePiece('curve', 1, 'narrow'), deck: null },
    { name: 'transition', piece: makePiece('transition', 0), deck: null },
    { name: 'bridge', piece: makePiece('bridge', 0), deck: null },
    { name: 'crossing', piece: makePiece('crossing', 0), deck: null },
    {
      name: 'regular curve member',
      piece: { ...makePiece('curve', 0), unit: { ax: 3, ay: 3, member: 1 } },
      deck: null,
    },
  ];

  for (const { name, piece, deck } of PIECES)
    it(`is ${deck ? 'laid' : 'not laid'} over ${name} track, the road laid before or after it`, () => {
      for (const roadFirst of [true, false]) {
        const w = roadWorld();
        if (roadFirst) w.lay(3, 3);
        w.world.setTrack(3, 3, pieceFrame(piece));
        if (!roadFirst) w.lay(3, 3);
        const shown = decks(w.world);
        if (!deck) {
          expect(shown).toHaveLength(0);
          continue;
        }
        expect(shown.map(showing)).toEqual([`track/level_crossing_${deck}`]);
        // where the track piece is, anchored as it is, tinted as it is
        const s = shown[0],
          t = trackSprite(w.world);
        expect([s.x, s.y, s.anchor.x, s.anchor.y]).toEqual([t.x, t.y, t.anchor.x, t.anchor.y]);
        expect(s.tint).toBe(t.tint);
      }
    });

  it('goes when the road goes, and when the track goes, and none lies over track with no road', () => {
    const w = roadWorld();
    w.world.setTrack(3, 3, pieceFrame(makePiece('straight', 0)));
    expect(decks(w.world)).toHaveLength(0);
    w.lay(3, 3);
    expect(decks(w.world)).toHaveLength(1);
    w.lift(3, 3);
    expect(decks(w.world)).toHaveLength(0);
    w.lay(3, 3);
    const deck = decks(w.world)[0];
    w.world.setTrack(3, 3, null);
    expect(decks(w.world)).toHaveLength(0);
    expect(deck.destroyed).toBe(true);
    // a save's roads lay theirs, and take them up
    w.world.setTrack(3, 3, pieceFrame(makePiece('straight', 1, 'narrow')));
    w.world.setRoads([{ x: 3, y: 3 }]);
    expect(decks(w.world).map(showing)).toEqual(['track/level_crossing_narrow_1']);
    w.world.setRoads([]);
    expect(decks(w.world)).toHaveLength(0);
  });

  it("takes the track piece's tint: a path highlight and the night", () => {
    const w = roadWorld();
    w.lay(3, 3);
    w.world.setTrack(3, 3, pieceFrame(makePiece('straight', 0)));
    const deck = decks(w.world)[0],
      track = trackSprite(w.world);
    w.world.setTrackTint(3, 3, 0x7cd7e8);
    expect([deck.tint, track.tint]).toEqual([0x7cd7e8, 0x7cd7e8]);
    w.world.setTrackTint(3, 3, 0xffffff);
    w.world.setTrackNight(0.8);
    expect(deck.tint).toBe(track.tint);
    expect(deck.tint).not.toBe(0xffffff);
  });

  it('follows the rail profile on a climbing straight as the track piece does, re-seated with it', () => {
    const w = roadWorld();
    w.lay(3, 3);
    w.world.setTrack(3, 3, pieceFrame(makePiece('straight', 0)));
    const climb = (b: number): RailBed => ({
      axis: 'y',
      flat: false,
      spans: [{ from: 1, to: 6, a: 0, b }],
    });
    const meshes = (layer: Container) =>
      layer.children.filter((c): c is Mesh => c instanceof Mesh && !c.destroyed);
    for (const bed of [climb(2), climb(3)]) {
      w.world.setRailBeds(new Map([[27, bed]]));
      const [deck] = meshes(w.world.crossings),
        [track] = meshes(w.world.track);
      expect(deck, 'the deck is drawn as a mesh').toBeDefined();
      expect(decks(w.world)[0].renderable).toBe(false);
      // the deck's frame is the track's size and anchor here: every vertex lifted alike
      const d = deck.geometry.positions,
        t = track.geometry.positions;
      expect([...d]).toEqual([...t]);
      expect(deck.texture).toBe(frameOf('track/level_crossing_regular_0').texture);
      expect([deck.x, deck.y]).toEqual([track.x, track.y]);
      // and lifted to the profile: the rail climbs across the tile
      const lifts = new Set<number>();
      const uvs = deck.geometry.uvs;
      for (let i = 0; i < d.length; i += 2) {
        const py = (uvs[i + 1] - 20 / 44) * 44,
          px = (uvs[i] - 0.5) * 64;
        lifts.add(Math.round((py - d[i + 1]) * 1000));
        const level = railLevel(bed, 3 + py / 32 - px / 64);
        expect(py - d[i + 1]).toBeCloseTo(level * w.world.landscape.step, 4);
      }
      expect(lifts.size).toBeGreaterThan(3);
    }
    // level again: a flat sprite, no mesh
    w.world.setRailBeds(new Map());
    expect(meshes(w.world.crossings)).toHaveLength(0);
    expect(decks(w.world)[0].renderable).toBe(true);
  });

  it('still shows when the painter is off, standing as the track piece does, and no road is painted', () => {
    const w = roadWorld();
    // workers that cannot start: the landscape is off for the session
    const off = new Landscape(w.map, new Set(), new Map(), {
      size: 1,
      spawn: () => {
        throw new Error('Worker is not defined');
      },
      sheet: () => 'test://terrain-surfaces.png',
    });
    expect(off.failed).toBe(true);
    Object.assign(w.world, { landscape: off });
    const repaint = vi.spyOn(off, 'repaint');
    w.lay(3, 3);
    w.world.setTrack(3, 3, pieceFrame(makePiece('straight', 1, 'narrow')));
    w.world.setRoads([{ x: 3, y: 3 }]);
    expect(decks(w.world).map(showing)).toEqual(['track/level_crossing_narrow_1']);
    // on a climbing bed too it stands as a flat sprite where the track piece stands, as the
    // track piece does with the painter off
    w.world.setRailBeds(new Map([[27, { axis: 'x', flat: false, spans: [] } as RailBed]]));
    const [deck] = decks(w.world),
      t = trackSprite(w.world);
    expect(w.world.crossings.children.some((c) => c instanceof Mesh)).toBe(false);
    expect([deck.renderable, deck.x, deck.y]).toEqual([true, t.x, t.y]);
    // asked to repaint, the landscape that is off queues nothing to paint
    expect(repaint).toHaveBeenCalled();
    expect((off as unknown as { repaints: unknown[] }).repaints).toEqual([]);
  });
});

describe('nature on a road tile', () => {
  /** The prop sprites the world draws on tile (2, 2) now, by the frame each shows. */
  const drawnProps = (world: WorldRenderer) =>
    ((world as unknown as { propSprites: Map<number, Sprite[]> }).propSprites.get(2 * 6 + 2) ?? [])
      .filter((s) => !s.destroyed && s.visible)
      .map(showing)
      .sort();

  it('hides under the road but for deposits, and shows again when it goes; the map keeps it', () => {
    const w = roadWorld(6);
    const props: PropInstance[] = [
      { kind: 'oak', variant: 0, ox: 0.2, oy: 0.1 },
      { kind: 'bush', variant: 1, ox: -0.2, oy: 0 },
      { kind: 'rock', variant: 0, ox: 0, oy: 0.2 },
      { kind: 'flowers', variant: 2, ox: 0.1, oy: -0.2 },
      { kind: 'wheat', variant: 0, ox: 0, oy: 0 },
      { kind: 'coal', variant: 0, ox: -0.1, oy: -0.1 },
      { kind: 'oil', variant: 0, ox: 0.1, oy: 0.1 },
    ];
    w.map.props.set(
      2 * 6 + 2,
      props.map((p) => ({ ...p })),
    );
    w.world.rebuildProps(2, 2);
    const before = drawnProps(w.world),
      kept = JSON.stringify([...w.map.props]);
    expect(before).toHaveLength(7);
    w.lay(2, 2);
    expect(drawnProps(w.world)).toEqual(['props/coal_0', 'props/oil_0']);
    expect(JSON.stringify([...w.map.props])).toBe(kept);
    w.lift(2, 2);
    expect(drawnProps(w.world)).toEqual(before);
    // a tile beside the road keeps its own
    w.lay(3, 2);
    expect(drawnProps(w.world)).toEqual(before);
    // the props built again on a road tile (a terrain edit) stay hidden
    w.lay(2, 2);
    w.world.rebuildProps(2, 2);
    expect(drawnProps(w.world)).toEqual(['props/coal_0', 'props/oil_0']);
    // a save's roads hide them too, and show them when they are gone
    w.world.setRoads([]);
    expect(drawnProps(w.world)).toEqual(before);
    w.world.setRoads([{ x: 2, y: 2 }]);
    expect(drawnProps(w.world)).toEqual(['props/coal_0', 'props/oil_0']);
    expect(JSON.stringify([...w.map.props])).toBe(kept);
  });

  it('grows no scatter on a road tile while the road is there', () => {
    // grass beside forest: bushes and young trees scatter along its edge
    const w = roadWorld(12);
    for (let y = 0; y < 12; y++)
      for (let x = 6; x < 12; x++) w.map.terrain[y * 12 + x] = Terrain.Forest;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) w.world.retile(x, y);
    const scatter = (w.world as unknown as { scatterSprites: Map<number, unknown[]> })
      .scatterSprites;
    const tiles = [...scatter.keys()];
    expect(tiles.length).toBeGreaterThan(1);
    for (const k of tiles) {
      const x = k % 12,
        y = Math.floor(k / 12);
      w.lay(x, y);
      expect(scatter.has(k), `${x},${y}`).toBe(false);
      w.lift(x, y);
      expect(scatter.has(k), `${x},${y}`).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ properties (Verification)

/** The track pieces the properties lay, the four a road crosses on the level among them. */
const CHOICES: TrackPiece[] = [
  makePiece('straight', 0),
  makePiece('straight', 1),
  makePiece('straight', 0, 'narrow'),
  makePiece('straight', 1, 'narrow'),
  makePiece('straight', 1, 'high_speed'),
  makePiece('curve', 2, 'narrow'),
  makePiece('crossing', 0),
  makePiece('transition', 1),
  makePiece('bridge', 0),
  { ...makePiece('curve', 0), unit: { ax: 0, ay: 0, member: 2 } },
];
/** The four pieces a road crosses on the level. */
const CROSSABLE = CHOICES.filter(crossable);
/** Every prop kind, so a new one enters the property (the type fails while one is missing). */
const PROP_KINDS = Object.keys({
  tree: 0,
  pine: 0,
  rock: 0,
  bush: 0,
  birch: 0,
  spruce: 0,
  oak: 0,
  palm: 0,
  cactus: 0,
  deadtree: 0,
  flowers: 0,
  reeds: 0,
  boulder: 0,
  coal: 0,
  oil: 0,
  wheat: 0,
} satisfies Record<PropKind, number>) as PropKind[];
const DEPOSITS = new Set<PropKind>(['coal', 'oil']);

/** What the renderer is told, as the game tells it: the roads, the track and the street doors. */
interface Scene {
  roads: Set<number>;
  track: Map<number, TrackPiece>;
  doors: PavingDoor[];
}

/** The axis a level crossing's road runs along on tile k, square to its track; null for none. */
function crossingOf(size: number, s: Scene, k: number): 'x' | 'y' | null {
  const p = s.roads.has(k) ? s.track.get(k) : undefined;
  if (!p || !crossable(p)) return null;
  return p.links[0].includes(Dir.N) ? 'x' : 'y';
}

/**
 * The oracle: the code of every road tile worked out from scratch, from the definitions in the
 * brief (#329) and the simulation's `crossable`, not from the renderer's incremental state.
 */
function expectedCodes(size: number, s: Scene) {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size;
  const road = (x: number, y: number) => on(x, y) && s.roads.has(y * size + x);
  const out = new Map<number, number>();
  for (const k of s.roads) {
    const x = k % size,
      y = Math.floor(k / size);
    let sides = 0,
      doors = 0;
    for (const d of DIRS) if (road(x + DIR_DX[d], y + DIR_DY[d])) sides |= 1 << d;
    for (const door of s.doors)
      if (door.tile.x + DIR_DX[door.side] === x && door.tile.y + DIR_DY[door.side] === y)
        doors |= 1 << opposite(door.side);
    sides |= doors;
    let pinned = doors;
    for (const d of DIRS) {
      const nx = x + DIR_DX[d],
        ny = y + DIR_DY[d];
      if (sides & (1 << d) && on(nx, ny) && crossingOf(size, s, ny * size + nx)) pinned |= 1 << d;
    }
    out.set(k, roadCode(sides, pinned, crossingOf(size, s, k)));
  }
  return out;
}

type Op =
  | { op: 'lay' | 'lift'; x: number; y: number }
  | { op: 'track'; x: number; y: number; piece: number }
  | { op: 'doors'; doors: { x: number; y: number; side: Dir }[] }
  | { op: 'load'; tiles: [number, number][] };

const SIZE = 6;
/** Up to 30 edits on a 6 x 6 map: roads laid and lifted, track, street doors and a save's roads. */
function randomOps(rng: Rng): Op[] {
  const ops: Op[] = [];
  const tile = () => ({ x: rng.int(0, SIZE - 1), y: rng.int(0, SIZE - 1) });
  for (let n = rng.int(1, 30); n > 0; n--) {
    const r = rng.next();
    if (r < 0.4) ops.push({ op: 'lay', ...tile() });
    else if (r < 0.52) ops.push({ op: 'lift', ...tile() });
    else if (r < 0.78)
      // a crossable straight half the time, any other piece or none the rest
      ops.push({
        op: 'track',
        ...tile(),
        piece: rng.chance(0.5)
          ? CHOICES.indexOf(rng.pick(CROSSABLE))
          : rng.int(-2, CHOICES.length - 1),
      });
    else if (r < 0.9) {
      const doors: { x: number; y: number; side: Dir }[] = [];
      for (let m = rng.int(0, 5); m > 0; m--)
        doors.push({ x: rng.int(-1, SIZE), y: rng.int(-1, SIZE), side: rng.pick(DIRS) });
      ops.push({ op: 'doors', doors });
    } else {
      // a save's roads, now and then with an entry off the map, which the renderer skips
      const tiles: [number, number][] = [];
      for (let m = rng.int(0, 14); m > 0; m--)
        tiles.push([rng.int(-1, SIZE), rng.int(0, SIZE - 1)]);
      ops.push({ op: 'load', tiles });
    }
  }
  return ops;
}

/** A tile-to-code map as sorted `x,y: code` lines, for a readable failure. */
const listed = (codes: Map<number, number>) =>
  [...codes].sort(([a], [b]) => a - b).map(([k, c]) => `${k % SIZE},${Math.floor(k / SIZE)}: ${c}`);
/** How often the cases reached what the property is about, so a generator gone tame shows. */
const seen = { crossings: 0, pinned: 0, changes: 0 };
/** Smaller edits: fewer doors, fewer tiles in a save. */
function* shrinkOp(o: Op): Iterable<Op> {
  if (o.op === 'doors') for (const doors of shrinkArray(o.doors)) yield { ...o, doors };
  if (o.op === 'load') for (const tiles of shrinkArray(o.tiles)) yield { ...o, tiles };
}

/** The world renderer's own state the properties read. */
interface Inside {
  decks: Map<number, Sprite>;
  trackSprites: Map<number, Sprite>;
  propSprites: Map<number, Sprite[]>;
  scatterSprites: Map<number, unknown[]>;
}

/**
 * Runs `ops` on a fresh world, checking after each one that the roads handed to the painter are
 * the oracle's, that every tile whose road changed was repainted (and exactly the tiles each call
 * owes), that a deck lies exactly on the level crossings, over its track piece and tinted as it,
 * and that nature hides exactly on road tiles but for deposits, the map's props untouched.
 */
function runOps(ops: Op[]) {
  const w = roadWorld(SIZE);
  // forest on the east, so scatter grows along its edge; and every prop kind on three grass tiles
  for (let y = 0; y < SIZE; y++)
    for (let x = 4; x < SIZE; x++) w.map.terrain[y * SIZE + x] = Terrain.Forest;
  const propTiles = [1 * SIZE + 1, 2 * SIZE + 2, 3 * SIZE + 1];
  PROP_KINDS.forEach((kind, i) => {
    const k = propTiles[i % 3],
      list = w.map.props.get(k) ?? [];
    list.push({ kind, variant: 0, ox: 0, oy: 0 });
    w.map.props.set(k, list);
  });
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) w.world.retile(x, y);
  for (const k of propTiles) w.world.rebuildProps(k % SIZE, Math.floor(k / SIZE));
  const inside = w.world as unknown as Inside,
    kept = JSON.stringify([...w.map.props]),
    scatterAtStart = new Set(inside.scatterSprites.keys()),
    kindOf = new Map<Sprite, PropKind>();
  for (const k of propTiles)
    (inside.propSprites.get(k) ?? []).forEach((s, i) => kindOf.set(s, w.map.props.get(k)![i].kind));
  expect(kindOf.size, 'a sprite for every prop kind').toBe(PROP_KINDS.length);
  expect(scatterAtStart.size, 'scatter to hide').toBeGreaterThan(0);
  w.take();

  const scene: Scene = { roads: w.roads, track: new Map(), doors: [] };
  let before = expectedCodes(SIZE, scene);
  const at = (k: number) => `${k % SIZE},${Math.floor(k / SIZE)}`;
  const around = (x: number, y: number) =>
    [[x, y], ...DIRS.map((d) => [x + DIR_DX[d], y + DIR_DY[d]])]
      .filter(([a, b]) => a >= 0 && b >= 0 && a < SIZE && b < SIZE)
      .map(([a, b]) => `${a},${b}`);

  ops.forEach((o, step) => {
    const where = `after edit ${step}, ${JSON.stringify(o)}`;
    let owed: string[] = [];
    if (o.op === 'lay' || o.op === 'lift') {
      (o.op === 'lay' ? w.lay : w.lift)(o.x, o.y);
      owed = around(o.x, o.y);
    } else if (o.op === 'track') {
      const k = o.y * SIZE + o.x,
        piece = o.piece < 0 ? null : CHOICES[o.piece];
      if (piece) scene.track.set(k, piece);
      else scene.track.delete(k);
      w.world.setTrack(o.x, o.y, piece ? pieceFrame(piece) : null);
    } else if (o.op === 'doors') {
      scene.doors = o.doors.map(({ x, y, side }) => ({ tile: { x, y }, side }));
      w.world.setCity(new Set(), scene.doors);
    } else if (o.op === 'load') {
      const old = [...scene.roads];
      scene.roads.clear();
      for (const [x, y] of o.tiles) if (x >= 0 && x < SIZE) scene.roads.add(y * SIZE + x);
      w.world.setRoads(o.tiles.map(([x, y]) => ({ x, y })));
      owed = [...old, ...scene.roads].map(at);
    }
    const after = expectedCodes(SIZE, scene),
      repainted = w.take();
    // the painter holds the oracle's codes
    expect(listed(w.codes()), `codes ${where}`).toEqual(listed(after));
    for (const code of after.values()) {
      if (code & (ROAD_CROSSING_X | ROAD_CROSSING_Y)) seen.crossings++;
      else if (code >> ROAD_PINNED_SHIFT) seen.pinned++;
    }
    // repainted: every tile whose road changed, and those the call owes besides (a road laid or
    // lifted its tile and the four beside it, a save every road tile old and new), no other
    const changed = [...new Set([...before.keys(), ...after.keys()])]
      .filter((k) => before.get(k) !== after.get(k))
      .map(at);
    if (changed.length) seen.changes++;
    expect([...new Set(repainted)].sort(), `repainted ${where}`).toEqual(
      [...new Set([...changed, ...owed])].sort(),
    );
    before = after;

    // a deck on each level crossing and nowhere else, over its track piece and tinted as it
    let crossings = 0;
    for (let k = 0; k < SIZE * SIZE; k++) {
      const piece = scene.track.get(k),
        deck = inside.decks.get(k);
      if (crossingOf(SIZE, scene, k)) {
        crossings++;
        expect(deck && showing(deck), `deck on ${at(k)} ${where}`).toBe(
          `track/level_crossing_${piece!.cls}_${piece!.rot}`,
        );
        const t = inside.trackSprites.get(k)!;
        expect([deck!.x, deck!.y, deck!.tint], `deck seat ${where}`).toEqual([t.x, t.y, t.tint]);
      } else expect(deck, `no deck on ${at(k)} ${where}`).toBeUndefined();
    }
    const live = w.world.crossings.children.filter((c) => c instanceof Sprite && !c.destroyed);
    expect(live, `deck sprites ${where}`).toHaveLength(crossings);

    // nature: on a road tile only the deposits show, elsewhere all of it (but wheat under track);
    // scatter grows where it began and there is neither road nor track
    for (const k of propTiles)
      for (const s of inside.propSprites.get(k) ?? []) {
        const kind = kindOf.get(s)!,
          railed = scene.track.has(k) && kind === 'wheat';
        expect(s.visible, `${kind} on ${at(k)} ${where}`).toBe(
          !railed && (!scene.roads.has(k) || DEPOSITS.has(kind)),
        );
      }
    for (let k = 0; k < SIZE * SIZE; k++)
      expect(inside.scatterSprites.has(k), `scatter on ${at(k)} ${where}`).toBe(
        scatterAtStart.has(k) && !scene.roads.has(k) && !scene.track.has(k),
      );
  });
  expect(JSON.stringify([...w.map.props]), 'the map keeps its props').toBe(kept);
}

describe('the roads through any sequence of edits (property)', () => {
  // Slow: each case builds a world renderer and runs up to 30 edits, each checked whole: about
  // 2.7 s alone for the 100 seeds, so the limit is 60 s.
  it('hand the painter the codes worked out from scratch, repaint what changed, and lay decks and hide nature as the scene says', () => {
    forAll(randomOps, runOps, {
      shrink: (ops) => shrinkArray(ops, shrinkOp),
      shrinkBudget: 400,
      format: (ops) => JSON.stringify(ops),
    });
    // the 100 cases between them reach level crossings, pinned edges and changing roads
    expect(seen.crossings).toBeGreaterThan(200);
    expect(seen.pinned).toBeGreaterThan(200);
    expect(seen.changes).toBeGreaterThan(500);
  }, 60_000);
});

/**
 * A scene the simulation allows on an 8 x 8 map: roads, level crossings only where their rails
 * run on to no road (`crossingRefusal`), other track about, and street doors on tiles with no road
 * (a road never stands on a building), none whose building the rails of its crossing run into.
 */
function legalScene(rng: Rng) {
  const size = 8,
    on = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size,
    roads = new Set<number>(),
    track = new Map<number, TrackPiece>(),
    doors: PavingDoor[] = [];
  for (let n = rng.int(4, 40); n > 0; n--) roads.add(rng.int(0, size * size - 1));
  /** the tiles the rails of piece `p` on tile k run on to */
  const along = (k: number, p: TrackPiece) =>
    p.links[0].map((d) => [(k % size) + DIR_DX[d], Math.floor(k / size) + DIR_DY[d]]);
  for (let k = 0; k < size * size; k++) {
    if (!rng.chance(roads.has(k) ? 0.35 : 0.1)) continue;
    const p = roads.has(k) ? rng.pick(CROSSABLE) : rng.pick(CHOICES);
    if (roads.has(k) && along(k, p).some(([x, y]) => on(x, y) && roads.has(y * size + x))) continue;
    track.set(k, p);
  }
  for (let n = rng.int(0, 8); n > 0; n--) {
    // most face a road tile, the rest anywhere, off the map's edge too
    const side = rng.pick(DIRS),
      aim = rng.chance(0.7) && roads.size ? rng.pick([...roads]) : -1,
      tile =
        aim < 0
          ? { x: rng.int(-1, size), y: rng.int(-1, size) }
          : { x: (aim % size) - DIR_DX[side], y: Math.floor(aim / size) - DIR_DY[side] },
      rx = tile.x + DIR_DX[side],
      ry = tile.y + DIR_DY[side],
      reach = ry * size + rx,
      p = on(rx, ry) && roads.has(reach) ? track.get(reach) : undefined;
    if (on(tile.x, tile.y) && roads.has(tile.y * size + tile.x)) continue;
    if (p && along(reach, p).some(([x, y]) => x === tile.x && y === tile.y)) continue;
    doors.push({ tile, side });
  }
  // the renderer hears of them in any order
  const order = rng.shuffle<'roads' | 'track' | 'doors'>(['roads', 'track', 'doors']);
  return { size, roads: [...roads], track: [...track], doors, order };
}

/** Where each arm of a shape's centre line crosses an edge of its tile, and its way out there. */
function edgeCrossings(shape: RoadShape) {
  const out = new Map<number, { at: [number, number]; dir: [number, number] }>();
  for (const line of roadPath(shape, 2000))
    for (const [end, next] of [
      [line[0], line[1]],
      [line[line.length - 1], line[line.length - 2]],
    ])
      for (const d of DIRS) {
        if (Math.abs(end[0] * DIR_DX[d] + end[1] * DIR_DY[d] - 0.5) > 1e-9) continue;
        const dx = end[0] - next[0],
          dy = end[1] - next[1],
          l = Math.hypot(dx, dy);
        if (l > 0) out.set(d, { at: [end[0], end[1]], dir: [dx / l, dy / l] });
      }
  return out;
}

describe('the roads of a scene the simulation allows (property)', () => {
  // Slow: each case builds a world renderer and samples every centre line: about 2.8 s alone for
  // the 100 seeds, so the limit is 60 s.
  it('join at every edge two road tiles share, meet each door in the middle of its edge, and are painted whole along every centre line, with no seam at any edge', () => {
    let joins = 0,
      doorArms = 0,
      crossings = 0,
      points = 0,
      seamPoints = 0;
    forAll(
      legalScene,
      ({ size, roads, track, doors, order }) => {
        const w = roadWorld(size),
          { originX: ox, originY: oy } = w.map;
        for (const step of order)
          if (step === 'roads') {
            for (const k of roads) w.roads.add(k);
            w.world.setRoads(roads.map((k) => ({ x: k % size, y: Math.floor(k / size) })));
          } else if (step === 'track')
            for (const [k, p] of track)
              w.world.setTrack(k % size, Math.floor(k / size), pieceFrame(p));
          else w.world.setCity(new Set(), doors);
        const codes = w.codes();
        expect([...codes.keys()].sort((a, b) => a - b)).toEqual([...roads].sort((a, b) => a - b));
        const shapes = new Map<number, RoadShape>();
        for (const [k, code] of codes)
          shapes.set(k, roadShape(code, (k % size) + ox, Math.floor(k / size) + oy));
        const square = (c: { dir: [number, number] } | undefined, d: Dir, what: string) => {
          expect(c, `${what} crosses its edge`).toBeDefined();
          expect(c!.dir[0], `${what} square`).toBeCloseTo(DIR_DX[d], 3);
          expect(c!.dir[1], `${what} square`).toBeCloseTo(DIR_DY[d], 3);
        };
        for (const [k, near] of shapes) {
          const x = k % size,
            y = Math.floor(k / size),
            mine = edgeCrossings(near);
          // with the tile to the east and the tile to the south: one point, square to the edge
          for (const d of [Dir.E, Dir.S]) {
            const far = shapes.get((y + DIR_DY[d]) * size + x + DIR_DX[d]);
            if (!far || x + DIR_DX[d] >= size) continue;
            const p = mine.get(d),
              q = edgeCrossings(far).get(opposite(d)),
              what = `${x},${y} to ${d}`;
            square(p, d, `${what}, the near tile`);
            square(q, opposite(d), `${what}, the far tile`);
            expect(q!.at[0] + DIR_DX[d], what).toBeCloseTo(p!.at[0], 9);
            expect(q!.at[1] + DIR_DY[d], what).toBeCloseTo(p!.at[1], 9);
            joins++;
          }
          // toward each street door it is the reach of: to the middle of the door's edge
          for (const door of doors) {
            if (door.tile.x + DIR_DX[door.side] !== x || door.tile.y + DIR_DY[door.side] !== y)
              continue;
            const d = opposite(door.side),
              c = mine.get(d);
            square(c, d, `${x},${y} to its door`);
            expect(Math.hypot(c!.at[0] - DIR_DX[d] * 0.5, c!.at[1] - DIR_DY[d] * 0.5)).toBeLessThan(
              1e-9,
            );
            doorArms++;
          }
          // a level crossing runs straight through the middle, square to its track
          if (near.crossing) {
            const p = new Map(track).get(k)!;
            expect(near.crossing).toBe(p.links[0].includes(Dir.N) ? 'x' : 'y');
            for (const line of roadPath(near))
              for (const [u, v] of line)
                expect(Math.abs(near.crossing === 'x' ? v : u)).toBeLessThan(1e-12);
            crossings++;
          }
        }
        // the painter, handed those codes, lays the road whole along every centre line
        const list: number[] = [];
        for (const [k, code] of codes) list.push(k, code);
        const paint = new RoadPaint(size, size, ox, oy, list);
        for (const [k, shape] of shapes)
          for (const line of roadPath(shape, 24))
            for (const [u, v] of line) {
              const px = (k % size) + u,
                py = Math.floor(k / size) + v,
                tx = Math.round(px),
                ty = Math.round(py);
              if (tx < 0 || ty < 0 || tx >= size || ty >= size) continue;
              expect(paint.weigh(px, py, ty * size + tx), `${px},${py}`).toBe(1);
              points++;
            }
        // and with no seam at any edge, a door's included: the weight is the same either side
        const weight = (px: number, py: number) =>
          paint.weigh(px, py, Math.round(py) * size + Math.round(px));
        let worst = 0,
          where = '';
        const across = (a: number, b: number, at: string) => {
          if (Math.abs(a - b) > worst) [worst, where] = [Math.abs(a - b), at];
          if (a > 0 || b > 0) seamPoints++;
        };
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++)
            for (let s = -0.5; s < 0.5; s += 0.01) {
              if (x + 1 < size)
                across(
                  weight(x + 0.5 - 1e-7, y + s),
                  weight(x + 0.5 + 1e-7, y + s),
                  `east of ${x},${y} at ${s}`,
                );
              if (y + 1 < size)
                across(
                  weight(x + s, y + 0.5 - 1e-7),
                  weight(x + s, y + 0.5 + 1e-7),
                  `south of ${x},${y} at ${s}`,
                );
            }
        expect(worst, where).toBeLessThan(1e-4);
      },
      {
        format: (s) => JSON.stringify({ ...s, track: s.track.map(([k, p]) => [k, pieceFrame(p)]) }),
      },
    );
    expect(joins).toBeGreaterThan(700);
    expect(doorArms).toBeGreaterThan(120);
    expect(crossings).toBeGreaterThan(200);
    expect(points).toBeGreaterThan(40_000);
    console.log('SEEN3', seamPoints);
    expect(seamPoints).toBeGreaterThan(20_000);
  }, 60_000);
});
