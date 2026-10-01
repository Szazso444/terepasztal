import { Container, Graphics, MeshSimple, Texture, type TextureSource } from 'pixi.js';
import { tileToWorld } from '../engine/iso';

/**
 * Procedural bridges wearing the illustrated kit's surfaces (tools/bridge-surfaces.mjs): every
 * part is a box or wall built from flat faces, each face a small mesh whose texture repeats at a
 * fixed world scale, so piers of any length keep their courses and planks instead of stretching.
 * Faces are lit by orientation like the kit (top light, +y face mid, +x face dark).
 */
export interface BridgeSurfaces {
  stoneTop: Texture;
  stoneWall: Texture;
  woodTop: Texture;
  woodGrain: Texture;
}
export interface BridgeTile {
  x: number;
  y: number;
  material: 'wood' | 'stone';
  /** 1 along x, 0 along y, null a pad under a curve or switch. */
  axis: 0 | 1 | null;
  /** Rail level in world px (the deck's top). */
  deck: number;
  water: boolean;
  /** Ground height under a point, world px up. */
  ground: (tx: number, ty: number) => number;
}

/** World px one repeat of each surface covers (u, v). */
const SCALE = {
  stoneTop: [1, 1], // tile units: one set of flags per tile
  woodTop: [1, 1],
  stoneWall: [7.5, 15],
  woodGrain: [4, 24],
} as const;
/** World px along a tile edge. */
const EDGE = Math.hypot(32, 16);
const LIGHT = { top: 0xffffff, left: 0xdedad2, right: 0xaaa49a } as const;
const DECK = 4;
const WATERLINE = -26;

type Surface = keyof BridgeSurfaces;
type P = { x: number; y: number };
/** Faces collected by surface and light, then turned into one mesh each. */
class Batch {
  private groups = new Map<string, { verts: number[]; uvs: number[]; idx: number[] }>();
  quad(surface: Surface, light: keyof typeof LIGHT, p: P[], uv: [number, number][]) {
    const key = `${surface}:${light}`;
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = { verts: [], uvs: [], idx: [] }));
    const base = g.verts.length / 2;
    for (let i = 0; i < 4; i++) {
      g.verts.push(p[i].x, p[i].y);
      g.uvs.push(uv[i][0], uv[i][1]);
    }
    g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(into: Container, surfaces: BridgeSurfaces) {
    for (const [key, g] of this.groups) {
      const [surface, light] = key.split(':') as [Surface, keyof typeof LIGHT];
      const mesh = new MeshSimple({
        texture: surfaces[surface],
        vertices: new Float32Array(g.verts),
        uvs: new Float32Array(g.uvs),
        indices: new Uint32Array(g.idx),
      });
      mesh.tint = LIGHT[light];
      into.addChild(mesh);
    }
    this.groups.clear();
  }
}

/** Tile offset (tx, ty) at height z (world px up) to world px. */
function screen(tx: number, ty: number, z: number): P {
  const p = tileToWorld(tx, ty);
  return { x: p.x, y: p.y - z };
}

/**
 * A box over [x0, x1] x [y0, y1] (tile units) from z0 to z1: the top and the two faces the
 * camera sees. `side`/`top` pick the surfaces; `grainAlong` turns a timber face's grain to run
 * along the box's long edge.
 */
function box(
  b: Batch,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  side: Surface,
  top: Surface | null,
  grainAlong = false,
) {
  if (z1 - z0 < 0.05) return;
  const [su, sv] = SCALE[side];
  const face = (ax: number, ay: number, bx: number, by: number, light: 'left' | 'right') => {
    const run = Math.hypot(bx - ax, by - ay) * EDGE;
    // u runs along the face, v down from its top; timber beams turn the grain along u.
    const u1 = grainAlong ? run / sv : run / su,
      v0 = grainAlong ? 0 : -z1 / sv,
      v1 = grainAlong ? 0 : -z0 / sv,
      w0 = grainAlong ? -z1 / su : 0,
      w1 = grainAlong ? -z0 / su : 0;
    const p = [screen(ax, ay, z1), screen(bx, by, z1), screen(bx, by, z0), screen(ax, ay, z0)];
    b.quad(
      side,
      light,
      p,
      grainAlong
        ? [
            [w0, 0],
            [w0, u1],
            [w1, u1],
            [w1, 0],
          ]
        : [
            [0, v0],
            [u1, v0],
            [u1, v1],
            [0, v1],
          ],
    );
  };
  face(x0, y1, x1, y1, 'left');
  face(x1, y1, x1, y0, 'right');
  if (top) {
    const [tu, tv] = SCALE[top];
    const surf = (tx: number, ty: number): [number, number] =>
      top === 'stoneTop' || top === 'woodTop'
        ? [tx / tu, ty / tv]
        : [(tx * EDGE) / tu, (ty * EDGE) / tv];
    b.quad(
      top,
      'top',
      [screen(x0, y0, z1), screen(x1, y0, z1), screen(x1, y1, z1), screen(x0, y1, z1)],
      [surf(x0, y0), surf(x1, y0), surf(x1, y1), surf(x0, y1)],
    );
  }
}

/** Tile-local (along, across) to tile offsets for a span's axis. */
const along = (axis: 0 | 1, l: number, w: number) => (axis === 1 ? { x: l, y: w } : { x: w, y: l });
/** A box in span coordinates: [l0, l1] along, [w0, w1] across. */
function spanBox(
  b: Batch,
  t: BridgeTile,
  l0: number,
  l1: number,
  w0: number,
  w1: number,
  z0: number,
  z1: number,
  side: Surface,
  top: Surface | null,
  grainAlong = false,
) {
  const a = along(t.axis ?? 1, l0, w0),
    c = along(t.axis ?? 1, l1, w1);
  box(
    b,
    t.x + Math.min(a.x, c.x),
    t.x + Math.max(a.x, c.x),
    t.y + Math.min(a.y, c.y),
    t.y + Math.max(a.y, c.y),
    z0,
    z1,
    side,
    top,
    grainAlong,
  );
}

/**
 * A wall in the vertical plane across = w of a span, from z0 up to z1, with one round arch per
 * tile opening from the waterline (stone viaduct). Only its lit face is drawn.
 */
function archWall(b: Batch, t: BridgeTile, w: number, z0: number, z1: number) {
  const axis = t.axis ?? 1,
    [su, sv] = SCALE.stoneWall,
    open = 0.36,
    rise = Math.max(4, Math.min(z1 - z0 - 5, 0.9 * open * EDGE)),
    steps = 24;
  const bottom = (l: number) =>
    Math.abs(l) < open ? z0 + rise * Math.sqrt(1 - (l / open) ** 2) : z0;
  for (let i = 0; i < steps; i++) {
    const la = -0.5 + i / steps,
      lb = la + 1 / steps,
      a = along(axis, la, w),
      c = along(axis, lb, w),
      za = bottom(la),
      zb = bottom(lb);
    // u along the wall in world px from the tile's own start, so neighbours continue the courses.
    const ua = ((la + 0.5 + (axis === 1 ? t.x : t.y)) * EDGE) / su,
      ub = ((lb + 0.5 + (axis === 1 ? t.x : t.y)) * EDGE) / su;
    b.quad(
      'stoneWall',
      axis === 1 ? 'left' : 'right',
      [
        screen(t.x + a.x, t.y + a.y, z1),
        screen(t.x + c.x, t.y + c.y, z1),
        screen(t.x + c.x, t.y + c.y, zb),
        screen(t.x + a.x, t.y + a.y, za),
      ],
      [
        [ua, -z1 / sv],
        [ub, -z1 / sv],
        [ub, -zb / sv],
        [ua, -za / sv],
      ],
    );
  }
}

/** Water hides the feet of whatever stands in it: a fade to the water colour below the surface. */
function waterFade(g: Graphics, t: BridgeTile, parts: { l: number; w: number; half: number }[]) {
  for (const { l, w, half } of parts) {
    const axis = t.axis ?? 1,
      a = along(axis, l - half, w),
      c = along(axis, l + half, w);
    for (let k = 0; k < 6; k++) {
      const z = WATERLINE + 12 - k * 2,
        p = screen(t.x + a.x, t.y + a.y, z),
        q = screen(t.x + c.x, t.y + c.y, z),
        p2 = screen(t.x + a.x, t.y + a.y, z - 2),
        q2 = screen(t.x + c.x, t.y + c.y, z - 2);
      g.poly([p.x, p.y, q.x, q.y, q2.x, q2.y, p2.x, p2.y]).fill({
        color: 0x2d6f80,
        alpha: 0.15 + k * 0.15,
      });
    }
  }
}

/**
 * Everything of one bridge tile below the trains (`under`: supports, deck, far parapet) and in
 * front of them (`near`: the near parapet or railing).
 */
export function bridgeTileMeshes(t: BridgeTile, surfaces: BridgeSurfaces) {
  const under = new Container(),
    near = new Container(),
    b = new Batch(),
    stone = t.material === 'stone',
    top: Surface = stone ? 'stoneTop' : 'woodTop',
    side: Surface = stone ? 'stoneWall' : 'woodGrain',
    underside = t.deck - DECK;
  if (t.axis === null) {
    // A pad under a curve or switch: a pier or post at each corner, cut to the ground.
    for (const [cx, cy] of [
      [-0.34, -0.34],
      [0.34, -0.34],
      [-0.34, 0.34],
      [0.34, 0.34],
    ]) {
      const h = stone ? 0.09 : 0.045,
        g = t.water ? WATERLINE : t.ground(t.x + cx, t.y + cy);
      box(b, t.x + cx - h, t.x + cx + h, t.y + cy - h, t.y + cy + h, g, underside, side, top);
    }
    box(b, t.x - 0.47, t.x + 0.47, t.y - 0.47, t.y + 0.47, underside, t.deck, side, top);
    b.build(under, surfaces);
    return { under, near };
  }
  const fade = new Graphics();
  if (t.water && stone) {
    // A viaduct: an arched wall under each long edge, far one first.
    for (const w of [-0.3, 0.3]) archWall(b, t, w, WATERLINE, underside);
  } else if (t.water) {
    // A trestle standing in the water, its feet fading below the surface.
    trestle(b, t, () => WATERLINE);
    waterFade(
      fade,
      t,
      [-0.26, 0.26].flatMap((w) => [-0.4, 0.4].map((l) => ({ l, w: w + 0.045, half: 0.045 }))),
    );
  } else if (stone) {
    // Over land: a pier at each end of the tile across the deck's width, cut to the ground.
    for (const l of [-0.38, 0.38]) {
      const o = along(t.axis, l, 0),
        g = t.ground(t.x + o.x, t.y + o.y);
      spanBox(b, t, l - 0.07, l + 0.07, -0.3, 0.3, g, underside, side, top);
    }
  } else trestle(b, t, (tx, ty) => t.ground(tx, ty));
  // The deck slab and the far parapet.
  spanBox(b, t, -0.5, 0.5, -0.36, 0.36, underside, t.deck, side, top, !stone);
  parapet(b, t, -0.33);
  b.build(under, surfaces);
  under.addChild(fade);
  parapet(b, t, 0.33);
  b.build(near, surfaces);
  return { under, near };
}

/** Four posts and an X brace on each post line along the span, cut to `foot`. */
function trestle(b: Batch, t: BridgeTile, foot: (tx: number, ty: number) => number) {
  const axis = t.axis!,
    underside = t.deck - DECK,
    post = 0.045;
  for (const w of [-0.26, 0.26]) {
    const feet = [-0.4, 0.4].map((l) => {
      const o = along(axis, l, w);
      return foot(t.x + o.x, t.y + o.y);
    });
    for (const [i, l] of [-0.4, 0.4].entries())
      spanBox(
        b,
        t,
        l - post,
        l + post,
        w - post,
        w + post,
        feet[i],
        underside,
        'woodGrain',
        'woodTop',
      );
    const lo = Math.max(...feet);
    if (underside - lo <= 5) continue;
    // Braces on the near face of the post line, one rising each way.
    for (const [za, zb] of [
      [lo + 1, underside - 1],
      [underside - 1, lo + 1],
    ]) {
      const a = along(axis, -0.4, w + post + 0.005),
        c = along(axis, 0.4, w + post + 0.005),
        d = 1.6;
      b.quad(
        'woodGrain',
        axis === 1 ? 'left' : 'right',
        [
          screen(t.x + a.x, t.y + a.y, za + d),
          screen(t.x + c.x, t.y + c.y, zb + d),
          screen(t.x + c.x, t.y + c.y, zb - d),
          screen(t.x + a.x, t.y + a.y, za - d),
        ],
        [
          [0, 0],
          [0, 1.4],
          [0.4, 1.4],
          [0.4, 0],
        ],
      );
    }
    // A cap beam across the post tops carries the deck.
    spanBox(
      b,
      t,
      -0.46,
      0.46,
      w - post,
      w + post,
      underside - 2.5,
      underside,
      'woodGrain',
      'woodTop',
      true,
    );
  }
}

/** Stone: a low coursed wall with a flagged coping. Timber: a post at the upper tile end and two rails. */
function parapet(b: Batch, t: BridgeTile, w: number) {
  if (t.material === 'stone') {
    spanBox(b, t, -0.5, 0.5, w - 0.03, w + 0.03, t.deck, t.deck + 4, 'stoneWall', 'stoneTop');
    return;
  }
  spanBox(b, t, -0.5, -0.43, w - 0.035, w + 0.035, t.deck, t.deck + 8, 'woodGrain', 'woodTop');
  for (const z of [3, 7])
    spanBox(
      b,
      t,
      -0.5,
      0.5,
      w - 0.02,
      w + 0.02,
      t.deck + z - 1.2,
      t.deck + z,
      'woodGrain',
      'woodTop',
      true,
    );
}

/** Repeat addressing and smooth minification for the surfaces. */
export function prepareSurface(source: TextureSource) {
  source.addressMode = 'repeat';
  source.scaleMode = 'linear';
  source.autoGenerateMipmaps = true;
  source.updateMipmaps();
}
