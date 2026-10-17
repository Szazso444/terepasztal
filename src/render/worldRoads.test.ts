/**
 * Roads as the world renderer draws them (#329): what it hands the painter to repaint when a road
 * is laid or lifted, when the track or the street doors under and round it change, and when a save
 * hands it every road; the level-crossing deck it lays over track, in its own layer; and the
 * nature it hides under a road and shows again when the road goes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Mesh, Rectangle, Sprite, Texture, TextureSource } from 'pixi.js';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { Dir } from '../engine/iso';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain, type GameMap, type PropInstance } from '../world/tiles';
import { makePiece, pieceFrame, type TrackPiece } from '../world/track';
import { railLevel, type RailBed } from '../world/railProfile';
import { Landscape } from './landscape';
import { roadCode } from './roadShape';
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
