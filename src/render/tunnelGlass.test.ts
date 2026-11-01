import { describe, expect, it, vi } from 'vitest';
import {
  Rectangle,
  Sprite,
  Texture,
  TextureSource,
  type Container,
  type Graphics,
  type Mesh,
} from 'pixi.js';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import { tileToWorld } from '../engine/iso';
import { emptyMap } from '../world/mapgen';
import type { RailBed } from '../world/railProfile';
import { RegionState } from '../world/regions';
import { Terrain, type GameMap } from '../world/tiles';
import { Underground } from '../sim/underground';
import { TILE_FRAMES } from '../art/tunnelArt';
import {
  glassAlpha,
  glassSheet,
  portalOutline,
  roomParts,
  roomWalls,
  type DugView,
} from './tunnelGlass';
import { WorldRenderer } from './worldRenderer';

const SOURCE = new TextureSource({ width: 256, height: 256 });
const ANY: FrameInfo = {
  image: undefined as never,
  texture: new Texture({ source: SOURCE, frame: new Rectangle(0, 0, 64, 32) }),
  anchorX: 0.5,
  anchorY: 0.9,
  w: 64,
  h: 32,
};
const ATLAS = { has: () => true, get: () => ANY } as unknown as AtlasRegistry;

/** Every tile of a `w` x `h` map, as rows. */
const allRows = (w: number, h: number) => ({
  y0: 0,
  y1: h - 1,
  x0: () => 0,
  x1: () => w - 1,
});
/** A sheet read over the levels `rows` of text, one digit a tile. */
const sheetRead = (rows: string[], cuts: string[] = []) => ({
  level: (x: number, y: number) => Number(rows[y]?.[x] ?? 0),
  cut: (x: number, y: number) => cuts.includes(`${x},${y}`),
  shown: () => true,
  lift: (x: number, y: number) => x + y,
});

describe('the glass over the mountains', () => {
  it('every tile above level 0 outside a cut gets four quads', () => {
    const sheet = glassSheet(allRows(3, 3), sheetRead(['000', '012', '033'], ['1,2']));
    // (1,1), (2,1), (2,2): four quads each, and neither the level 0 tiles nor the cut at (1,2)
    expect(sheet.quads).toBe(12);
    expect(sheet.tiles).toBe(3);
  });
  it('covers no tile the player has not found yet', () => {
    const read = { ...sheetRead(['11', '11']), shown: (x: number) => x === 0 };
    expect(glassSheet(allRows(2, 2), read).quads).toBe(8);
  });
  it('follows the surface: a tile centre stands where the ground lifts it', () => {
    const read = { ...sheetRead(['000', '050', '000']), lift: () => 40 };
    const { positions } = glassSheet(allRows(3, 3), read),
      c = tileToWorld(1, 1);
    const ys = [];
    for (let i = 0; i < positions.length; i += 2)
      if (Math.abs(positions[i] - c.x) < 1e-3) ys.push(positions[i + 1]);
    expect(ys).toContain(c.y - 40);
  });
  it('lines the edges between levels, and no edge inside one level', () => {
    expect(glassSheet(allRows(3, 1), sheetRead(['222'])).lines).toBeGreaterThan(0);
    const flat = glassSheet(allRows(3, 3), sheetRead(['222', '222', '222']));
    const walled = glassSheet(allRows(3, 3), sheetRead(['222', '232', '222']));
    expect(walled.lines).toBeGreaterThan(flat.lines);
  });
  it('thickens with the level, and stays thin enough to see through at the top', () => {
    expect(glassAlpha(0)).toBeCloseTo(0.13);
    expect(glassAlpha(16)).toBeCloseTo(0.37);
  });
});

/** A dug view over a list of `x,y` tiles at floor 0, with the portals and cuts given. */
const dugView = (
  tiles: string[],
  portals: { x: number; y: number; face: 'N' | 'E' | 'S' | 'W'; floor: number }[] = [],
  cuts: string[] = [],
): DugView => ({
  version: 0,
  isCut: (x, y) => cuts.includes(`${x},${y}`),
  floorAt: (x, y) => (tiles.includes(`${x},${y}`) ? 0 : undefined),
  portals: () => portals,
  hasPortal: (x, y, face) => portals.some((p) => p.x === x && p.y === y && p.face === face),
});
const frames = (parts: ReturnType<typeof roomParts>, x: number, y: number) =>
  parts.filter((p) => p.x === x && p.y === y).map((p) => p.frame);
const isWall = (f: string) => TILE_FRAMES.wallN.includes(f) || TILE_FRAMES.wallW.includes(f);

describe('the rooms the Drill dug', () => {
  it('walls stand only on a dug tile`s closed sides', () => {
    const tiles = [
      { x: 2, y: 2, floor: 0 },
      { x: 3, y: 2, floor: 0 },
    ];
    const parts = roomParts(tiles, dugView(['2,2', '3,2']));
    // the corridor runs along x: both have a wall on N, only the first on W, none between them
    expect(frames(parts, 2, 2).filter(isWall)).toHaveLength(2);
    expect(frames(parts, 3, 2).filter(isWall)).toHaveLength(1);
    expect(frames(parts, 3, 2).filter((f) => TILE_FRAMES.wallN.includes(f))).toHaveLength(1);
    // on the camera side a closed edge has a lit lip
    expect(frames(parts, 2, 2)).toContain(TILE_FRAMES.rimS);
    expect(frames(parts, 2, 2)).not.toContain(TILE_FRAMES.rimE);
    expect(frames(parts, 3, 2)).toContain(TILE_FRAMES.rimE);
  });
  it('a portal opens its side; a cut beside a tile with no portal on that side is a wall', () => {
    const tiles = [{ x: 2, y: 2, floor: 0 }];
    const closed = roomParts(tiles, dugView(['2,2'], [], ['2,1', '1,2']));
    expect(frames(closed, 2, 2).filter(isWall)).toHaveLength(2);
    const open = roomParts(tiles, dugView(['2,2'], [{ x: 2, y: 2, face: 'N', floor: 0 }], ['2,1']));
    expect(frames(open, 2, 2).filter((f) => TILE_FRAMES.wallN.includes(f))).toHaveLength(0);
    expect(frames(open, 2, 2).filter((f) => TILE_FRAMES.wallW.includes(f))).toHaveLength(1);
  });
  it('draws from the floor up, back to front', () => {
    const tiles = [
      { x: 5, y: 5, floor: 0 },
      { x: 1, y: 1, floor: 0 },
    ];
    const parts = roomParts(tiles, dugView(['5,5', '1,1']));
    const firstWall = parts.findIndex((p) => isWall(p.frame)),
      lastFloor = parts.map((p) => TILE_FRAMES.floor.includes(p.frame)).lastIndexOf(true);
    expect(lastFloor).toBeLessThan(firstWall);
    const walls = parts.filter((p) => isWall(p.frame));
    expect(walls[0].x).toBe(1);
    expect(walls[walls.length - 1].x).toBe(5);
  });
  it('a corridor has a run of wall down each long side and a post only where a run ends', () => {
    const tiles = [
      { x: 2, y: 2, floor: 0 },
      { x: 3, y: 2, floor: 0 },
      { x: 4, y: 2, floor: 0 },
    ];
    const view = dugView(
      ['2,2', '3,2', '4,2'],
      [
        { x: 2, y: 2, face: 'W', floor: 0 },
        { x: 4, y: 2, face: 'E', floor: 0 },
      ],
    );
    const { sides, posts } = roomWalls(tiles, view);
    // three tiles long, closed along N and S, both ends open through a portal
    expect(sides.filter((s) => s.near)).toHaveLength(3);
    expect(sides.filter((s) => !s.near)).toHaveLength(3);
    expect(posts).toHaveLength(4);
    expect(new Set(posts.map((p) => p.x))).toEqual(new Set([1.5, 4.5]));
  });
  it('outlines a portal on the tile edge it opens through, standing on the rail', () => {
    const step = 10,
      out = portalOutline({ x: 4, y: 4, face: 'E', floor: 2 }, step),
      edge = tileToWorld(4.5, 4);
    // the foot of the arch: half a tile either way along the edge, at the rail
    const foot = out[0];
    expect(foot.y + (foot.y - out[out.length - 1].y) / -2).toBeCloseTo(edge.y - 2 * step);
    expect((out[0].x + out[out.length - 1].x) / 2).toBeCloseTo(edge.x);
    expect(Math.min(...out.map((p) => p.y))).toBeLessThan(edge.y - 2 * step - 20);
  });
  it('turns a portal arch with its face', () => {
    const across = portalOutline({ x: 4, y: 4, face: 'S', floor: 0 }, 10),
      foot = (t: number) => tileToWorld(4 + t, 4.5);
    expect(across[0].x).toBeCloseTo(foot(-0.46).x);
    expect(across[across.length - 1].x).toBeCloseTo(foot(0.46).x);
  });
});

/** A whole world renderer over `map`; under Node its landscape is off and the tiles stand in. */
const world = (map: GameMap) => new WorldRenderer(ATLAS, map, new RegionState(map));
/** A level map with one block of mountain from (2, 2) to (8, 8). */
function mountainMap() {
  const map = emptyMap(3, 24, 24, Terrain.Grass);
  for (let y = 2; y <= 8; y++)
    for (let x = 2; x <= 8; x++) map.terrain[y * 24 + x] = Terrain.Mountain;
  return map;
}
const VIEW = { x: -300, y: -100, w: 600, h: 400 };
type Inside = {
  view: typeof VIEW;
  glass: {
    rebuilds: number;
    previews: number;
    root: Container;
    over: unknown;
    sheet: Mesh | null;
    rooms: Container;
    walls: Graphics;
  } | null;
  propSprites: Map<number, Sprite[]>;
  scatterSprites: Map<number, { s: Sprite; ox: number; oy: number }[]>;
  summitSprites: Map<number, Sprite>;
};
const inside = (w: WorldRenderer) => w as unknown as Inside;

describe('WorldRenderer.setGlass', () => {
  it('hides what stands on raised tiles while the glass is on, and only there', () => {
    const map = mountainMap();
    map.props.set(4 * 24 + 4, [{ kind: 'oak', variant: 0, ox: 0, oy: 0 }]);
    map.props.set(15 * 24 + 15, [{ kind: 'oak', variant: 0, ox: 0, oy: 0 }]);
    const w = world(map),
      high = inside(w).propSprites.get(4 * 24 + 4)![0],
      low = inside(w).propSprites.get(15 * 24 + 15)![0];
    w.setGlass(true);
    expect(high.renderable).toBe(false);
    expect(low.renderable).toBe(true);
    // what comes up while the glass is on, as a raise does, stays out of it
    w.rebuildProps(4, 4);
    expect(inside(w).propSprites.get(4 * 24 + 4)![0].renderable).toBe(false);
    w.setGlass(false);
    expect(inside(w).propSprites.get(4 * 24 + 4)![0].renderable).toBe(true);
    expect(low.renderable).toBe(true);
  });
  it('rebuilds when the dug tiles change, even with no ground moved, and not every frame', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h);
    w.underground = u;
    inside(w).view = VIEW;
    w.setGlass(true);
    w.animate(0.016);
    const rebuilds = () => inside(w).glass!.rebuilds,
      first = rebuilds();
    for (let i = 0; i < 5; i++) w.animate(0.016);
    expect(rebuilds()).toBe(first);
    u.dig(4, 4, 0);
    w.animate(0.016);
    expect(rebuilds()).toBe(first + 1);
    w.animate(0.016);
    expect(rebuilds()).toBe(first + 1);
  });
  it('rebuilds when the view leaves what the layer holds, not for a small pan', () => {
    const map = mountainMap(),
      w = world(map);
    inside(w).view = VIEW;
    w.setGlass(true);
    w.animate(0.016);
    const rebuilds = () => inside(w).glass!.rebuilds,
      first = rebuilds();
    inside(w).view = { ...VIEW, x: VIEW.x + 40 };
    w.animate(0.016);
    expect(rebuilds()).toBe(first);
    inside(w).view = { ...VIEW, x: VIEW.x + 5000 };
    w.animate(0.016);
    expect(rebuilds()).toBe(first + 1);
  });
  it('a preview redraws no sheet', () => {
    const map = mountainMap(),
      w = world(map);
    inside(w).view = VIEW;
    w.setGlass(true);
    w.animate(0.016);
    const first = inside(w).glass!.rebuilds;
    w.setGlass(true, [{ x: 4, y: 4 }]);
    w.animate(0.016);
    expect(inside(w).glass!.rebuilds).toBe(first);
  });
  it('off, it leaves nothing drawn and rebuilds nothing', () => {
    const map = mountainMap(),
      w = world(map);
    inside(w).view = VIEW;
    w.setGlass(true);
    w.animate(0.016);
    w.setGlass(false);
    const first = inside(w).glass!.rebuilds;
    inside(w).view = { ...VIEW, x: VIEW.x + 5000 };
    w.animate(0.016);
    expect(inside(w).glass!.rebuilds).toBe(first);
  });
  it('an unchanged preview draws nothing, and a new one does', () => {
    const map = mountainMap(),
      w = world(map);
    w.setGlass(true, [{ x: 4, y: 4 }]);
    const first = inside(w).glass!.previews;
    w.setGlass(true, [{ x: 4, y: 4 }]);
    expect(inside(w).glass!.previews).toBe(first);
    w.setGlass(true, [{ x: 4, y: 5 }]);
    expect(inside(w).glass!.previews).toBe(first + 1);
    w.setGlass(true, []);
    expect(inside(w).glass!.previews).toBe(first + 2);
  });
  it('off and on again, the same preview is drawn again', () => {
    const map = mountainMap(),
      w = world(map);
    w.setGlass(true, [{ x: 4, y: 4 }]);
    w.setGlass(false);
    const first = inside(w).glass!.previews;
    w.setGlass(true, [{ x: 4, y: 4 }]);
    expect(inside(w).glass!.previews).toBe(first + 1);
  });
  it('peaks and scatter on raised tiles hide with it and come back without it', () => {
    const map = mountainMap(),
      w = world(map),
      peak = new Sprite(),
      high = new Sprite(),
      low = new Sprite();
    inside(w).summitSprites.set(4 * 24 + 4, peak);
    inside(w).scatterSprites.set(5 * 24 + 5, [{ s: high, ox: 0, oy: 0 }]);
    inside(w).scatterSprites.set(15 * 24 + 15, [{ s: low, ox: 0, oy: 0 }]);
    w.setGlass(true);
    expect(peak.renderable).toBe(false);
    expect(high.renderable).toBe(false);
    expect(low.renderable).toBe(true);
    w.setGlass(false);
    expect(peak.renderable).toBe(true);
    expect(high.renderable).toBe(true);
  });
  it('off, the sheet, rooms and walls are gone and the geometry is destroyed', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h);
    u.dig(4, 4, 0);
    w.underground = u;
    inside(w).view = VIEW;
    w.setGlass(true);
    w.animate(0.016);
    const glass = inside(w).glass!,
      sheet = glass.sheet!,
      destroyed = vi.fn();
    sheet.geometry.on('destroy', destroyed);
    expect(glass.rooms.children.length).toBeGreaterThan(0);
    expect(glass.walls.context.instructions.length).toBeGreaterThan(0);
    w.setGlass(false);
    expect(sheet.destroyed).toBe(true);
    expect(destroyed).toHaveBeenCalledOnce();
    expect(glass.sheet).toBeNull();
    expect(glass.root.children).not.toContain(sheet);
    expect(glass.rooms.children).toHaveLength(0);
    expect(glass.walls.context.instructions).toHaveLength(0);
  });
  it('a rebuild gives the old geometry back', () => {
    const map = mountainMap(),
      w = world(map);
    inside(w).view = VIEW;
    w.setGlass(true);
    w.animate(0.016);
    const destroyed = vi.fn();
    inside(w).glass!.sheet!.geometry.on('destroy', destroyed);
    inside(w).view = { ...VIEW, x: VIEW.x + 5000 };
    w.animate(0.016);
    expect(destroyed).toHaveBeenCalledOnce();
  });
  it('follows a level that moves, and neither paving nor a rail edit', () => {
    const map = mountainMap(),
      w = world(map);
    inside(w).view = VIEW;
    w.setGlass(true);
    w.animate(0.016);
    const rebuilds = () => inside(w).glass!.rebuilds,
      first = rebuilds();
    w.setCity(new Set([15 * 24 + 15]));
    w.setRailBeds(new Map([[3 * 24 + 3, { axis: 'x', spans: [], flat: true } as RailBed]]));
    w.retile(3, 3);
    w.animate(0.016);
    expect(rebuilds()).toBe(first);
    map.terrain[12 * 24 + 12] = Terrain.Mountain;
    w.retile(12, 12);
    w.animate(0.016);
    expect(rebuilds()).toBe(first + 1);
  });
  it('sits under the track and the objects, so trains and rails draw over it', () => {
    const w = world(mountainMap());
    w.setGlass(true);
    const at = (c: unknown) => w.root.getChildIndex(c as never);
    expect(at((inside(w).glass!.root as { parent: unknown }).parent)).toBeLessThan(at(w.track));
    expect(at(w.track)).toBeLessThan(at(w.objects));
    // what stands in front of a rail lies over the track, and under the trains
    const over = at((inside(w).glass!.over as { parent: unknown }).parent);
    expect(over).toBeGreaterThan(at(w.track));
    expect(over).toBeLessThan(at(w.objects));
  });
});

describe('what stands inside the mountain', () => {
  it('a signal on a dug tile stands at its bed, and shows only in the glass', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h);
    u.dig(4, 4, 0);
    w.underground = u;
    const s = w.setStructure('decor:4,4', 4, 4, 'structures/semaphore', 12, -3, 2),
      p = tileToWorld(4, 4);
    expect(s.position.x).toBe(p.x + 2);
    expect(s.position.y).toBe(p.y - 3);
    expect(s.renderable).toBe(false);
    w.setGlass(true);
    expect(s.renderable).toBe(true);
    w.setGlass(false);
    expect(s.renderable).toBe(false);
  });
  it('catenary follows it, and a notice over the same tile stays on the surface', () => {
    const map = mountainMap(),
      w = world(map),
      u = new Underground(map.w, map.h);
    u.dig(4, 4, 0);
    w.underground = u;
    const p = tileToWorld(4, 4),
      wire = w.setStructure('supply:4,4', 4, 4, 'structures/supply_catenary_ns', 13),
      note = w.setStructure('notice:1', 4, 4, 'structures/note', 46, -58);
    expect(wire.position.y).toBe(p.y);
    expect(note.position.y).toBe(p.y + w.elevationOf(4, 4) - 58);
    expect(note.renderable).toBe(true);
  });
  it('on open ground a structure stands where it always stood', () => {
    const map = mountainMap(),
      w = world(map),
      s = w.setStructure('decor:4,4', 4, 4, 'structures/semaphore', 12, -3, 2),
      p = tileToWorld(4, 4);
    expect(s.position.y).toBe(p.y + w.elevationOf(4, 4) - 3);
    expect(s.renderable).toBe(true);
  });
});
