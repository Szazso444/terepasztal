import {
  BufferImageSource,
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  Sprite,
  Texture,
} from 'pixi.js';
import type { AtlasRegistry } from '../engine/atlas';
import { DIR_DX, DIR_DY, tileToWorld } from '../engine/iso';
import { OPEN_CROWN, OPEN_SPRING, OPEN_W, TILE_FRAMES, WALL_H } from '../art/tunnelArt';
import type { Face, Portal, Underground } from '../sim/underground';
import { TUNNEL_COVER } from '../sim/underground';
import { MAX_LEVEL } from '../world/elevation';

/*
 * The Drill's view: while it is on, every mountain on the map is glass. A pale sheet follows the
 * surface of every tile above level 0, with a line where one level meets another; over it, on the
 * rail's own bed, each dug tile is a room with a floor and walls along its closed sides. All of it
 * lies under the track and everything that stands, so the rails, the trains and the signals draw
 * over it without being sorted, and the rails shown are the real ones. Only what stands between
 * the camera and a rail (a room's near walls, a portal's arch, the Drill's preview) lies over the
 * track, in `TunnelGlass.over`, and that is still under the trains.
 */

/** What the glass reads of the Drill's work: `Underground`, and nothing that changes it. */
export type DugView = Pick<Underground, 'version' | 'floorAt' | 'isCut' | 'hasPortal' | 'portals'>;
/** A map the Drill has not been on. */
export const NOTHING_DUG: DugView = {
  version: 0,
  floorAt: () => undefined,
  isCut: () => false,
  hasPortal: () => false,
  portals: () => [],
};

/** Colour of the glass, and of the lines on it and the grid at the Drill's floor. */
const GLASS_COLOUR = 0x9fd2f4,
  LINE_COLOUR = 0xdff1ff;
const LINE_ALPHA = 0.42,
  GRID_ALPHA = 0.16;
/** Half the thickness of a line, in world px. */
const LINE_HALF = 0.4;
/** A room's near walls, and the lines along the top of its walls. */
const EDGE_COLOUR = 0xeaf6ff,
  PANE_ALPHA = 0.1,
  BACK_EDGE_ALPHA = 0.8,
  NEAR_EDGE_ALPHA = 0.55;
/** How opaque the glass is on a tile at `level`. */
export function glassAlpha(level: number) {
  return 0.13 + 0.015 * level;
}

/** The rows of tiles one rebuild covers (`viewTileRows`). */
export interface TileRows {
  y0: number;
  y1: number;
  x0(y: number): number;
  x1(y: number): number;
}
/** What the sheet reads of the ground. */
export interface SheetRead {
  level(x: number, y: number): number;
  cut(x: number, y: number): boolean;
  /** False on a tile no one has seen yet: nothing is drawn there. */
  shown(x: number, y: number): boolean;
  /** Height of the surface at a point of a tile, world px up. */
  lift(x: number, y: number): number;
}
export interface GlassSheet {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** tiles and quads of glass, and short lengths of line */
  tiles: number;
  quads: number;
  lines: number;
}

/** The strip the sheet is coloured from: one texel per level, then the line, then the grid. */
const LINE_TEXEL = MAX_LEVEL + 1,
  GRID_TEXEL = MAX_LEVEL + 2,
  STRIP_W = MAX_LEVEL + 3;
const texelU = (texel: number) => (texel + 0.5) / STRIP_W;

function stripTexture() {
  const pixels = new Uint8Array(STRIP_W * 4),
    put = (texel: number, colour: number, alpha: number) => {
      const c = [colour >> 16, (colour >> 8) & 0xff, colour & 0xff];
      // premultiplied, as the source says
      pixels.set(
        [...c, 255].map((v) => Math.round(v * alpha)),
        texel * 4,
      );
    };
  for (let level = 0; level <= MAX_LEVEL; level++) put(level, GLASS_COLOUR, glassAlpha(level));
  put(LINE_TEXEL, LINE_COLOUR, LINE_ALPHA);
  put(GRID_TEXEL, LINE_COLOUR, GRID_ALPHA);
  return new Texture({
    source: new BufferImageSource({
      resource: pixels,
      width: STRIP_W,
      height: 1,
      format: 'rgba8unorm',
      scaleMode: 'nearest',
      alphaMode: 'premultiplied-alpha',
      autoGarbageCollect: false,
    }),
  });
}

/** The sides of a tile: its face, the step to the neighbour, the two corners of the shared edge. */
const SIDES = [
  { face: 'E', dx: 1, dy: 0, a: [0.5, -0.5], b: [0.5, 0.5] },
  { face: 'S', dx: 0, dy: 1, a: [0.5, 0.5], b: [-0.5, 0.5] },
  { face: 'W', dx: -1, dy: 0, a: [-0.5, 0.5], b: [-0.5, -0.5] },
  { face: 'N', dx: 0, dy: -1, a: [-0.5, -0.5], b: [0.5, -0.5] },
] as const;

/**
 * The glass over the tiles of `rows`, as one mesh: four quads per tile, so the sheet bends with the
 * banks inside it and no bank stays out of the glass, a line of two lengths along each edge where
 * the level changes, and the grid of what the Drill can reach at its floor.
 */
export function glassSheet(rows: TileRows, read: SheetRead): GlassSheet {
  const glass = (x: number, y: number) =>
    read.level(x, y) > 0 && !read.cut(x, y) && read.shown(x, y);
  // measured first: this runs over the whole map when all of it is in view
  let tiles = 0,
    lines = 0,
    grid = 0;
  for (let y = rows.y0; y <= rows.y1; y++)
    for (let x = rows.x0(y), end = rows.x1(y); x <= end; x++) {
      if (!glass(x, y)) continue;
      tiles++;
      const l = read.level(x, y);
      for (const s of SIDES) if (read.level(x + s.dx, y + s.dy) !== l) lines += 2;
      if (l >= TUNNEL_COVER) grid += 2 + floorEdges(read, x, y);
    }
  const verts = tiles * 9 + (lines + grid) * 4,
    positions = new Float32Array(verts * 2),
    uvs = new Float32Array(verts * 2),
    indices = new Uint32Array((tiles * 4 + lines + grid) * 6);
  let v = 0,
    n = 0;
  const vertex = (px: number, py: number, u: number) => {
      positions[v * 2] = px;
      positions[v * 2 + 1] = py;
      uvs[v * 2] = u;
      uvs[v * 2 + 1] = 0.5;
      return v++;
    },
    quad = (a: number, b: number, c: number, d: number) => {
      indices.set([a, b, c, a, c, d], n);
      n += 6;
    },
    point = (x: number, y: number, z: number) => {
      const p = tileToWorld(x, y);
      return { x: p.x, y: p.y - z };
    },
    surface = (x: number, y: number) => point(x, y, read.lift(x, y)),
    // a length of line, as thick up and down as the line it is part of
    length = (a: { x: number; y: number }, b: { x: number; y: number }, u: number) =>
      quad(
        vertex(a.x, a.y - LINE_HALF, u),
        vertex(b.x, b.y - LINE_HALF, u),
        vertex(b.x, b.y + LINE_HALF, u),
        vertex(a.x, a.y + LINE_HALF, u),
      );
  for (let y = rows.y0; y <= rows.y1; y++)
    for (let x = rows.x0(y), end = rows.x1(y); x <= end; x++) {
      if (!glass(x, y)) continue;
      const l = read.level(x, y),
        u = texelU(l),
        first = v;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const p = surface(x + i / 2, y + j / 2);
          vertex(p.x, p.y, u);
        }
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++) {
          const a = first + j * 3 + i;
          quad(a, a + 1, a + 4, a + 3);
        }
    }
  // the lines go over all the glass
  const lineU = texelU(LINE_TEXEL),
    gridU = texelU(GRID_TEXEL);
  for (let y = rows.y0; y <= rows.y1; y++)
    for (let x = rows.x0(y), end = rows.x1(y); x <= end; x++) {
      if (!glass(x, y)) continue;
      const l = read.level(x, y);
      for (const s of SIDES) {
        if (read.level(x + s.dx, y + s.dy) === l) continue;
        const a = surface(x + s.a[0], y + s.a[1]),
          b = surface(x + s.b[0], y + s.b[1]),
          mid = surface(x + (s.a[0] + s.b[0]) / 2, y + (s.a[1] + s.b[1]) / 2);
        length(a, mid, lineU);
        length(mid, b, lineU);
      }
      if (l < TUNNEL_COVER) continue;
      // each tile lines its back edges, and a front edge where no tile of the grid does
      const c = SIDES.map((s) => point(x + s.a[0], y + s.a[1], 0));
      length(c[2], c[3], gridU);
      length(c[3], c[0], gridU);
      if (read.level(x + 1, y) < TUNNEL_COVER) length(c[0], c[1], gridU);
      if (read.level(x, y + 1) < TUNNEL_COVER) length(c[1], c[2], gridU);
    }
  return { positions, uvs, indices, tiles, quads: tiles * 4, lines };
}
/** The front edges of tile (x, y) that the grid draws: no tile of the grid lies beyond them. */
function floorEdges(read: SheetRead, x: number, y: number) {
  return (
    (read.level(x + 1, y) < TUNNEL_COVER ? 1 : 0) + (read.level(x, y + 1) < TUNNEL_COVER ? 1 : 0)
  );
}

/** A dug tile: where it is and the level of its floor. */
export interface DugTile {
  x: number;
  y: number;
  floor: number;
}
/** One picture of a room, on tile (x, y) at the level `floor`. */
export interface RoomPart extends DugTile {
  frame: string;
  alpha: number;
}
/** Is the side of a dug tile toward `face` open: its room goes on there, or a portal opens it? */
function openSide(view: DugView, t: DugTile, face: Face) {
  const d = FACE_DIR[face];
  return (
    view.floorAt(t.x + DIR_DX[d], t.y + DIR_DY[d]) === t.floor || view.hasPortal(t.x, t.y, face)
  );
}
/** The direction a portal's face looks in. */
export const FACE_DIR: Record<Face, number> = { N: 0, E: 1, S: 2, W: 3 };
/** How much of the room behind a wall shows through it. */
const WALL_ALPHA = 0.75;

/**
 * The pictures of the rooms on `tiles`: first every floor and the shade its back walls cast, then,
 * from the back to the front, the walls on its closed back sides and the lit lip of the floor on
 * its closed front sides. A side is closed unless the room goes on there or a portal opens it, so
 * a cutting beside a tile with no portal on that side stays a wall, as no rail passes there.
 */
export function roomParts(tiles: readonly DugTile[], view: DugView): RoomPart[] {
  const sorted = [...tiles].sort((a, b) => a.floor - b.floor || a.x + a.y - (b.x + b.y)),
    parts: RoomPart[] = [],
    put = (t: DugTile, frame: string, alpha = 1) => parts.push({ ...t, frame, alpha }),
    pick = (list: readonly string[], n: number) => list[n % list.length];
  for (const t of sorted) {
    put(t, pick(TILE_FRAMES.floor, t.x * 7 + t.y * 13));
    if (!openSide(view, t, 'N')) put(t, TILE_FRAMES.shadeN);
    if (!openSide(view, t, 'W')) put(t, TILE_FRAMES.shadeW);
  }
  for (const t of sorted) {
    if (!openSide(view, t, 'N')) put(t, pick(TILE_FRAMES.wallN, t.x + t.y), WALL_ALPHA);
    if (!openSide(view, t, 'W')) put(t, pick(TILE_FRAMES.wallW, t.x + t.y), WALL_ALPHA);
    if (!openSide(view, t, 'S')) put(t, TILE_FRAMES.rimS);
    if (!openSide(view, t, 'E')) put(t, TILE_FRAMES.rimE);
  }
  return parts;
}

/** One closed side of a dug tile: its edge, in tile coordinates, at the level `floor`. */
export interface WallSide {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  floor: number;
  /** on the camera's side of its room: a pane the room is seen through */
  near: boolean;
}
/**
 * What makes the walls read as walls: a side for each closed edge, and a post where a run of wall
 * ends or turns, as a point in tile coordinates. A tile's side joins the tile's beside it, along
 * the edge, when that one is dug at the same floor and closed on the same face.
 */
export function roomWalls(tiles: readonly DugTile[], view: DugView) {
  const sides: WallSide[] = [],
    posts: { x: number; y: number; floor: number }[] = [];
  for (const t of tiles)
    for (const s of SIDES) {
      if (openSide(view, t, s.face)) continue;
      const ax = t.x + s.a[0],
        ay = t.y + s.a[1],
        bx = t.x + s.b[0],
        by = t.y + s.b[1];
      sides.push({ ax, ay, bx, by, floor: t.floor, near: s.face === 'E' || s.face === 'S' });
      // the tile beside this one past each end of the edge
      const ends = [
        { x: ax, y: ay, nx: t.x + s.a[0] * 2 - s.dx, ny: t.y + s.a[1] * 2 - s.dy },
        { x: bx, y: by, nx: t.x + s.b[0] * 2 - s.dx, ny: t.y + s.b[1] * 2 - s.dy },
      ];
      for (const e of ends) {
        const next = { x: e.nx, y: e.ny, floor: t.floor };
        if (view.floorAt(e.nx, e.ny) !== t.floor || openSide(view, next, s.face))
          posts.push({ x: e.x, y: e.y, floor: t.floor });
      }
    }
  return { sides, posts };
}

/** Points of a portal's arch along the tile edge it opens through, from jamb to jamb. */
export function portalOutline(p: Portal, levelPx: number) {
  const d = FACE_DIR[p.face],
    cx = p.x + DIR_DX[d] / 2,
    cy = p.y + DIR_DY[d] / 2,
    // across the opening: along the tile edge
    ex = DIR_DY[d] === 0 ? 0 : 1,
    ey = DIR_DY[d] === 0 ? 1 : 0,
    at = (t: number, z: number) => {
      const q = tileToWorld(cx + ex * t, cy + ey * t);
      return { x: q.x, y: q.y - p.floor * levelPx - z };
    },
    points = [at(-OPEN_W, 0)];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI * (1 - i / 16);
    points.push(at(Math.cos(a) * OPEN_W, OPEN_SPRING + Math.sin(a) * (OPEN_CROWN - OPEN_SPRING)));
  }
  points.push(at(OPEN_W, 0));
  return points;
}

/** What the layer reads of the world round it. */
export interface GlassHost extends SheetRead {
  readonly atlas: AtlasRegistry;
  under(): DugView;
  /** World px of one level. */
  levelPx(): number;
  /** Changes when a level or the tiles shown do; a repaint that moves no level leaves it. */
  ground(): number;
  /** The rows of tiles whose surface can show in a view. */
  rows(view: ViewRect): TileRows;
}
export type ViewRect = { x: number; y: number; w: number; h: number };

/** How much more than the view a rebuild covers, as a share of the view on each side. */
const VIEW_MARGIN = 0.5;
const holds = (a: ViewRect, b: ViewRect) =>
  b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

/**
 * The one layer of the glass. It is rebuilt only when something it was made from changes: the dug
 * tiles (`Underground.version`, as a dig that moves no ground says nothing else), the surface, or
 * a view that has left the tiles it holds. A rebuild holds half a view more on each side, so a pan
 * does not rebuild every frame; holding the tiles in view keeps a rebuild small when zoomed in.
 */
export class TunnelGlass {
  /** The sheet and the rooms: under the track. */
  readonly root = new Container();
  /** What stands in front of a rail: over the track and under the objects. */
  readonly over = new Container();
  /** How many times the layer was built and the preview drawn, for a test or a measure. */
  rebuilds = 0;
  previews = 0;
  private readonly strip = stripTexture();
  private sheet: Mesh | null = null;
  private readonly rooms = new Container();
  private readonly walls = new Graphics();
  private readonly outlines = new Graphics();
  private readonly preview = new Graphics();
  private on = false;
  private held: ViewRect | null = null;
  private version = -1;
  private surface = -1;
  /** The tiles the preview shows, as x and y. */
  private previewed: readonly number[] = [];

  constructor(private readonly host: GlassHost) {
    this.root.visible = this.over.visible = false;
    this.root.addChild(this.rooms);
    this.over.addChild(this.walls, this.preview, this.outlines);
    this.root.on('destroyed', () => this.strip.destroy(true));
  }

  /** Turn it on or off. Off, it holds nothing. */
  show(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.root.visible = this.over.visible = on;
    if (!on) this.clear();
  }
  private clear() {
    const geometry = this.sheet?.geometry;
    this.sheet?.destroy();
    geometry?.destroy(true);
    this.sheet = null;
    for (const c of this.rooms.removeChildren()) c.destroy();
    this.walls.clear();
    this.outlines.clear();
    this.preview.clear();
    this.previewed = [];
    this.held = null;
  }
  /** What the Drill is about to take, at its floor. The same tiles again draw nothing. */
  setPreview(tiles: readonly { x: number; y: number }[]) {
    const held = tiles.flatMap((t) => [t.x, t.y]);
    if (held.length === this.previewed.length && held.every((v, i) => v === this.previewed[i]))
      return;
    this.previewed = held;
    this.previews++;
    const g = this.preview.clear();
    for (const { x, y } of tiles) {
      const c = SIDES.map((s) => tileToWorld(x + s.a[0], y + s.a[1]));
      g.poly(c)
        .fill({ color: 0xffa23c, alpha: 0.75 })
        .stroke({ color: 0xffe0b0, alpha: 0.9, width: 0.8 });
    }
  }
  /** Called every frame: costs a few comparisons unless the layer is out of date. */
  update(view: ViewRect | null) {
    if (!this.on) return;
    const under = this.host.under(),
      ground = this.host.ground();
    if (
      this.held &&
      under.version === this.version &&
      ground === this.surface &&
      (!view || holds(this.held, view))
    )
      return;
    this.version = under.version;
    this.surface = ground;
    this.rebuild(view ?? { x: -1e7, y: -1e7, w: 2e7, h: 2e7 });
  }
  private rebuild(view: ViewRect) {
    this.rebuilds++;
    const { host } = this,
      mx = view.w * VIEW_MARGIN,
      my = view.h * VIEW_MARGIN;
    this.held = { x: view.x - mx, y: view.y - my, w: view.w + 2 * mx, h: view.h + 2 * my };
    const rows = host.rows(this.held),
      made = glassSheet(rows, host),
      geometry = new MeshGeometry({
        positions: made.positions,
        uvs: made.uvs,
        indices: made.indices,
      });
    if (this.sheet) {
      const old = this.sheet.geometry;
      this.sheet.geometry = geometry;
      old.destroy(true);
    } else {
      this.sheet = new Mesh({ geometry, texture: this.strip });
      this.root.addChildAt(this.sheet, 0);
    }
    this.buildRooms(rows);
    this.buildOutlines();
  }
  private buildRooms(rows: TileRows) {
    const { host } = this,
      under = host.under(),
      tiles: DugTile[] = [];
    for (let y = rows.y0; y <= rows.y1; y++)
      for (let x = rows.x0(y), end = rows.x1(y); x <= end; x++) {
        const floor = under.floorAt(x, y);
        if (floor !== undefined) tiles.push({ x, y, floor });
      }
    for (const c of this.rooms.removeChildren()) c.destroy();
    const step = host.levelPx();
    for (const part of roomParts(tiles, under)) {
      const f = host.atlas.get(part.frame),
        p = tileToWorld(part.x, part.y),
        s = new Sprite(f.texture);
      s.anchor.set(f.anchorX, f.anchorY);
      s.position.set(p.x, p.y - part.floor * step);
      s.alpha = part.alpha;
      this.rooms.addChild(s);
    }
    this.buildWalls(tiles);
  }
  private buildWalls(tiles: readonly DugTile[]) {
    const g = this.walls.clear(),
      step = this.host.levelPx(),
      { sides, posts } = roomWalls(tiles, this.host.under()),
      at = (x: number, y: number, floor: number, z: number) => {
        const p = tileToWorld(x, y);
        return { x: p.x, y: p.y - floor * step - z };
      },
      near = sides.filter((s) => s.near),
      top = (s: WallSide) => {
        const a = at(s.ax, s.ay, s.floor, WALL_H),
          b = at(s.bx, s.by, s.floor, WALL_H);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      };
    for (const s of near)
      g.poly([
        at(s.ax, s.ay, s.floor, 0),
        at(s.bx, s.by, s.floor, 0),
        at(s.bx, s.by, s.floor, WALL_H),
        at(s.ax, s.ay, s.floor, WALL_H),
      ]);
    if (near.length) g.fill({ color: GLASS_COLOUR, alpha: PANE_ALPHA });
    if (!sides.length) return;
    // a line a world px wide falls between the screen's pixels when zoomed out, so each is also
    // drawn a screen pixel wide
    for (const pixelLine of [false, true]) {
      for (const s of sides) if (!s.near) top(s);
      for (const p of posts) {
        const a = at(p.x, p.y, p.floor, 0),
          b = at(p.x, p.y, p.floor, WALL_H);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ color: EDGE_COLOUR, alpha: BACK_EDGE_ALPHA, width: 1, pixelLine });
      for (const s of near) top(s);
      if (near.length)
        g.stroke({ color: EDGE_COLOUR, alpha: NEAR_EDGE_ALPHA, width: 1, pixelLine });
    }
  }
  private buildOutlines() {
    const g = this.outlines.clear(),
      { host } = this,
      levelPx = host.levelPx();
    for (const p of host.under().portals())
      g.poly(portalOutline(p, levelPx)).stroke({ color: 0xffd76a, alpha: 0.95, width: 1.6 });
  }
}
