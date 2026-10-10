import { Container, Graphics, MeshSimple, type Texture, type TextureSource } from 'pixi.js';
import { TILE_H, tileToWorld } from '../engine/iso';
import {
  deckAtOffset,
  spanPoint,
  type BridgePlan,
  type BridgeSite,
  type Rect,
} from './bridgeLayout';

/**
 * Procedural bridges wearing the illustrated kit's surfaces (tools/bridge-surfaces.mjs): every
 * part is a box or wall built from flat faces, each face a small mesh whose texture repeats at a
 * fixed world scale and is addressed in map coordinates, so courses, flags and planks run on
 * across tile seams and piers of any length keep their courses instead of stretching. Faces are
 * lit by orientation like the kit (top light, +y face mid, +x face dark). Which parts a tile has
 * comes from bridgeLayout.ts; every face below the deck is cut to the ground under it, and to
 * ground in front of it that hides it (Painter.horizon).
 */
export interface BridgeSurfaces {
  stoneTop: Texture;
  stoneWall: Texture;
  woodTop: Texture;
  woodGrain: Texture;
}
export interface BridgeTile extends BridgeSite {
  water: boolean;
  /** Upgrade level: each level above the first adds a pilaster or post to every parapet. */
  level: number;
  /** Ground height under a map point, world px up; over water, the waterline. */
  ground: (tx: number, ty: number) => number;
}

/** World px the waterline sits under a deck at level 0; supports in water reach down to it. */
export const WATERLINE = -26;
/** Deck slab thickness, world px. */
export const DECK = 5;
/** World px one repeat of each surface covers (u, v); the top surfaces repeat once per tile. */
const SCALE = {
  stoneTop: [1, 1],
  woodTop: [1, 1],
  stoneWall: [7.5, 15],
  woodGrain: [4, 24],
} as const;
/** World px along a tile edge. */
const EDGE = Math.hypot(32, 16);
const LIGHT = { top: 0xffffff, left: 0xdedad2, right: 0xaaa49a } as const;
/** Faces are split this often (tile units) so they follow the deck's grade and the ground. */
const STEP = 0.25;
/**
 * How far ahead (tile units along both axes) and how finely ground in front is looked for
 * (Painter.horizon): far enough for a bank to hide a support reaching 48 px below it.
 */
const SIGHT = 1.5,
  SIGHT_STEP = 1 / 32;

type Surface = keyof BridgeSurfaces;
type Light = keyof typeof LIGHT;
type P = { x: number; y: number };
/** Height in world px up at a map point. */
type Z = (x: number, y: number) => number;

/** Map point (tx, ty) at height z (world px up) to world px. */
function screen(tx: number, ty: number, z: number): P {
  const p = tileToWorld(tx, ty);
  return { x: p.x, y: p.y - z };
}

/**
 * Faces collected per surface and light, one small mesh each. `flush` ends a solid: solids are
 * flushed far to near, so a nearer one always paints over a farther one.
 */
class Painter {
  private groups = new Map<string, { verts: number[]; uvs: number[]; idx: number[] }>();
  /** Where flushed solids go. */
  target = new Container();
  /** The part being drawn; meshes are labelled `<part>:<surface>:<light>`. */
  part: 'support' | 'deck' | 'parapet' = 'support';
  constructor(
    readonly t: BridgeTile,
    private surfaces: BridgeSurfaces,
  ) {}
  quad(surface: Surface, light: Light, p: P[], uv: (readonly [number, number])[]) {
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
  flush() {
    for (const [key, g] of this.groups) {
      const [surface, light] = key.split(':') as [Surface, Light];
      const mesh = new MeshSimple({
        texture: this.surfaces[surface],
        vertices: new Float32Array(g.verts),
        uvs: new Float32Array(g.uvs),
        indices: new Uint32Array(g.idx),
      });
      mesh.tint = LIGHT[light];
      mesh.label = `${this.part}:${key}`;
      this.target.addChild(mesh);
    }
    this.groups.clear();
  }
  /** The ground under a map point, read just inside this tile when the point is on its edge. */
  ground(x: number, y: number) {
    const t = this.t,
      e = 1e-3;
    return t.ground(x - Math.sign(x - t.x) * e, y - Math.sign(y - t.y) * e);
  }
  /**
   * The height below which a point of this tile is hidden: the ground under it, or ground in
   * front of it. The camera looks from +x +y, and a line of sight climbs TILE_H world px for
   * each tile it comes forward along both axes, so ground `d` tiles ahead that stands more than
   * `d * TILE_H` px above the point covers it. Faces are cut here: piers end on the ground, a
   * deck's end is buried in the bank it meets, and a support at a span's near end goes into the
   * bank in front of it instead of hanging over it.
   */
  horizon(x: number, y: number) {
    const t = this.t,
      e = 1e-3,
      look = (d: number) => {
        if (d <= SIGHT) h = Math.max(h, t.ground(x + d, y + d) - d * TILE_H);
      };
    let h = this.ground(x, y);
    for (let i = 1; i <= SIGHT / SIGHT_STEP; i++) look(i * SIGHT_STEP);
    // Just past every tile edge the sight crosses too, where water may give way to a bank: a
    // face on a near edge meets the ground beyond it exactly.
    for (const c of [x, y])
      for (let d = Math.ceil(c - 0.5 - 1e-6) + 0.5 - c; d <= SIGHT; d++) look(Math.max(0, d) + e);
    return h;
  }
}

/** An upright edge of a wall: map point, distance along the wall (px), top and bottom. */
type Upright = { x: number; y: number; s: number; top: number; bottom: number };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * The quad of a wall between two uprights. An upright whose bottom is not below its top is
 * buried there (in the ground or the bank in front): the quad then ends where the wall's height
 * runs out between them, so nothing of it shows over the ground that hides it.
 */
function strip(
  p: Painter,
  surface: Surface,
  light: Light,
  a: Upright,
  b: Upright,
  uv: (s: number, z: number) => [number, number],
) {
  const ha = a.top - a.bottom,
    hb = b.top - b.bottom;
  if (ha < 0.05 && hb < 0.05) return;
  if (ha <= 0 || hb <= 0) {
    const k = ha / (ha - hb),
      top = lerp(a.top, b.top, k),
      cut = { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), s: lerp(a.s, b.s, k), top, bottom: top };
    if (ha <= 0) a = cut;
    else b = cut;
  }
  p.quad(
    surface,
    light,
    [
      screen(a.x, a.y, a.top),
      screen(b.x, b.y, b.top),
      screen(b.x, b.y, b.bottom),
      screen(a.x, a.y, a.bottom),
    ],
    [uv(a.s, a.top), uv(b.s, b.top), uv(b.s, b.bottom), uv(a.s, a.bottom)],
  );
}

/**
 * A vertical face from map point a to b, between `top` and `bottom` (cut to the ground and to
 * the ground in front, Painter.horizon), split so both edges follow their heights. `along` turns
 * timber grain to run along the face.
 */
function face(
  p: Painter,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  top: Z,
  bottom: Z,
  surface: Surface,
  light: Light,
  along = false,
) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP - 1e-6)),
    [su, sv] = SCALE[surface],
    alongX = ay === by,
    pts = Array.from({ length: n + 1 }, (_, i): Upright => {
      const x = ax + ((bx - ax) * i) / n,
        y = ay + ((by - ay) * i) / n;
      return {
        x,
        y,
        s: (alongX ? x : y) * EDGE,
        top: top(x, y),
        bottom: Math.max(bottom(x, y), p.horizon(x, y)),
      };
    }),
    uv = (s: number, z: number) =>
      (along ? [-z / su, s / sv] : [s / su, -z / sv]) as [number, number];
  for (let i = 0; i < n; i++) strip(p, surface, light, pts[i], pts[i + 1], uv);
}

/** A flat-sided box over `r` (tile offsets) from `bottom` to `top`: its top and the two faces the camera sees. */
function prism(
  p: Painter,
  r: Rect,
  top: Z,
  bottom: Z,
  side: Surface,
  cap: Surface | null,
  along = false,
) {
  const t = p.t,
    x0 = t.x + r.x0,
    x1 = t.x + r.x1,
    y0 = t.y + r.y0,
    y1 = t.y + r.y1;
  face(p, x0, y1, x1, y1, top, bottom, side, 'left', along);
  face(p, x1, y1, x1, y0, top, bottom, side, 'right', along);
  if (!cap) return;
  // The top, split along the span so it follows the deck's grade; planks run along the span.
  const nx = t.axis === 1 ? Math.max(1, Math.ceil((r.x1 - r.x0) / STEP - 1e-6)) : 1,
    ny = t.axis === 0 ? Math.max(1, Math.ceil((r.y1 - r.y0) / STEP - 1e-6)) : 1,
    swap = cap === 'woodTop' && t.axis === 0,
    uv = (x: number, y: number) => (swap ? [y, x] : [x, y]) as [number, number];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const xa = x0 + ((x1 - x0) * i) / nx,
        xb = x0 + ((x1 - x0) * (i + 1)) / nx,
        ya = y0 + ((y1 - y0) * j) / ny,
        yb = y0 + ((y1 - y0) * (j + 1)) / ny;
      p.quad(
        cap,
        'top',
        [
          screen(xa, ya, top(xa, ya)),
          screen(xb, ya, top(xb, ya)),
          screen(xb, yb, top(xb, yb)),
          screen(xa, yb, top(xa, yb)),
        ],
        [uv(xa, ya), uv(xb, ya), uv(xb, yb), uv(xa, yb)],
      );
    }
}

/**
 * Everything of one bridge tile below the trains (`under`: supports, deck, far parapets) and in
 * front of them (`near`: the parapets on its +x and +y edges).
 */
export function bridgeTileMeshes(t: BridgeTile, plan: BridgePlan, surfaces: BridgeSurfaces) {
  const under = new Container(),
    near = new Container(),
    p = new Painter(t, surfaces),
    stone = t.material === 'stone',
    top: Surface = stone ? 'stoneTop' : 'woodTop',
    side: Surface = stone ? 'stoneWall' : 'woodGrain',
    deck: Z = (x, y) => deckAtOffset(t, x - t.x, y - t.y),
    underside: Z = (x, y) => deck(x, y) - DECK,
    floor: Z = () => -Infinity,
    feet: { x: number; y: number; half: number }[] = [];
  // Supports, far ones first. Their tops are under the deck, which always covers them.
  const supports: { depth: number; draw: () => void }[] = [];
  for (const r of plan.piers)
    supports.push({
      depth: t.x + t.y + (r.x0 + r.x1 + r.y0 + r.y1) / 2,
      draw: () => {
        prism(p, r, underside, floor, side, null);
        feet.push({ x: t.x + (r.x0 + r.x1) / 2, y: t.y + r.y1, half: (r.x1 - r.x0) / 2 });
      },
    });
  for (const w of plan.arches)
    supports.push({ depth: t.x + t.y + w, draw: () => archWall(p, w, underside) });
  for (const w of plan.trestles)
    supports.push({ depth: t.x + t.y + w, draw: () => trestle(p, w, underside, feet) });
  supports.sort((a, b) => a.depth - b.depth);
  p.target = under;
  for (const s of supports) {
    s.draw();
    p.flush();
  }
  if (t.water && feet.length) under.addChild(waterFade(p, feet));
  // The deck slab, then the far parapets on it.
  p.part = 'deck';
  prism(p, plan.deck, deck, underside, side, top, !stone);
  p.flush();
  p.part = 'parapet';
  for (const r of plan.parapets.filter((r) => !r.near)) parapet(p, r, deck);
  p.target = near;
  for (const r of plan.parapets.filter((r) => r.near)) parapet(p, r, deck);
  under.cullable = near.cullable = true;
  return { under, near };
}

/**
 * A wall in the vertical plane `w` across a span, from the ground (the waterline) up to the
 * deck's underside, with one round arch per tile. Only its lit face is drawn.
 */
function archWall(p: Painter, w: number, underside: Z) {
  const t = p.t,
    axis = t.axis!,
    [su, sv] = SCALE.stoneWall,
    open = 0.36,
    steps = 24,
    // The arch springs from the ground under the wall; the ground in front may hide more of it.
    upright = (l: number): Upright => {
      const o = spanPoint(axis, l, w),
        x = t.x + o.x,
        y = t.y + o.y,
        z1 = underside(x, y),
        z0 = p.ground(x, y),
        rise = Math.max(4, Math.min(z1 - z0 - 5, 0.9 * open * EDGE)),
        arch = Math.abs(l) < open ? z0 + rise * Math.sqrt(1 - (l / open) ** 2) : z0;
      // s along the wall in map coordinates, so neighbours continue the courses.
      return {
        x,
        y,
        s: (axis === 1 ? x : y) * EDGE,
        top: z1,
        bottom: Math.max(arch, p.horizon(x, y)),
      };
    },
    uv = (s: number, z: number) => [s / su, -z / sv] as [number, number];
  let a = upright(-0.5);
  for (let i = 1; i <= steps; i++) {
    const b = upright(-0.5 + i / steps);
    strip(p, 'stoneWall', axis === 1 ? 'left' : 'right', a, b, uv);
    a = b;
  }
}

/** A timber bent along a span at across `w`: a post at each end, an X brace and a cap beam. */
function trestle(
  p: Painter,
  w: number,
  underside: Z,
  feet: { x: number; y: number; half: number }[],
) {
  const t = p.t,
    axis = t.axis!,
    post = 0.045,
    floor: Z = () => -Infinity,
    at = (l: number, across: number) => {
      const o = spanPoint(axis, l, across);
      return { x: t.x + o.x, y: t.y + o.y };
    },
    box = (l0: number, l1: number, w0: number, w1: number): Rect => {
      const a = spanPoint(axis, l0, w0),
        b = spanPoint(axis, l1, w1);
      return {
        x0: Math.min(a.x, b.x),
        x1: Math.max(a.x, b.x),
        y0: Math.min(a.y, b.y),
        y1: Math.max(a.y, b.y),
      };
    };
  const ends = [-0.4, 0.4].map((l) => {
    const c = at(l, w);
    // Where the post comes out of the ground (or the bank in front): the braces start above it.
    return { l, ...c, foot: p.horizon(c.x, c.y), head: underside(c.x, c.y) };
  });
  for (const e of ends) {
    prism(p, box(e.l - post, e.l + post, w - post, w + post), underside, floor, 'woodGrain', null);
    p.flush();
    feet.push({ x: e.x, y: e.y + post, half: post });
  }
  const lo = Math.max(...ends.map((e) => e.foot)),
    hi = Math.min(...ends.map((e) => e.head));
  if (hi - lo > 5) {
    // Braces on the near face of the post line, one rising each way, from the higher foot.
    const a = at(-0.4, w + post + 0.005),
      c = at(0.4, w + post + 0.005),
      d = 1.6;
    for (const [za, zb] of [
      [lo + d, hi - 1],
      [hi - 1, lo + d],
    ])
      p.quad(
        'woodGrain',
        axis === 1 ? 'left' : 'right',
        [
          screen(a.x, a.y, za + d),
          screen(c.x, c.y, zb + d),
          screen(c.x, c.y, zb - d),
          screen(a.x, a.y, za - d),
        ],
        [
          [0, 0],
          [0, 1.4],
          [0.4, 1.4],
          [0.4, 0],
        ],
      );
    p.flush();
  }
  // A cap beam along the post tops carries the deck.
  prism(
    p,
    box(-0.46, 0.46, w - post, w + post),
    underside,
    (x, y) => underside(x, y) - 2.5,
    'woodGrain',
    null,
    true,
  );
}

/**
 * Stone: a low coursed wall with a flagged coping. Timber: a post at the wall's start and two
 * rails. Upgraded bridges add a pilaster (stone) or post (timber) per level above the first.
 */
function parapet(p: Painter, r: Rect, deck: Z) {
  const t = p.t,
    lift =
      (h: number): Z =>
      (x, y) =>
        deck(x, y) + h,
    longX = r.x1 - r.x0 >= r.y1 - r.y0,
    sub = (a: number, b: number): Rect => (longX ? { ...r, x0: a, x1: b } : { ...r, y0: a, y1: b }),
    [s0, s1] = longX ? [r.x0, r.x1] : [r.y0, r.y1],
    mid = (s0 + s1) / 2;
  if (t.material === 'stone') {
    prism(p, r, lift(5), deck, 'stoneWall', 'stoneTop');
    p.flush();
  } else {
    // The rails first: the thicker post stands in front of them where they meet.
    const inset: Rect = longX
      ? { ...r, y0: r.y0 + 0.01, y1: r.y1 - 0.01 }
      : { ...r, x0: r.x0 + 0.01, x1: r.x1 - 0.01 };
    for (const z of [3, 7]) {
      prism(p, inset, lift(z), lift(z - 1.2), 'woodGrain', 'woodTop', true);
      p.flush();
    }
    prism(p, sub(s0, Math.min(s1, s0 + 0.07)), lift(8), deck, 'woodGrain', 'woodTop');
    p.flush();
  }
  for (let k = 0; k < t.level - 1; k++) {
    const c = Math.max(s0 + 0.05, Math.min(s1 - 0.05, mid + (k - (t.level - 2) / 2) * 0.28)),
      q = sub(c - 0.05, c + 0.05),
      pilaster = longX
        ? { ...q, y0: q.y0 - 0.015, y1: q.y1 + 0.015 }
        : { ...q, x0: q.x0 - 0.015, x1: q.x1 + 0.015 },
      stone = t.material === 'stone';
    prism(
      p,
      pilaster,
      lift(stone ? 9 : 12),
      deck,
      stone ? 'stoneWall' : 'woodGrain',
      stone ? 'stoneTop' : 'woodTop',
    );
    p.flush();
  }
}

/**
 * Water hides the feet of whatever stands in it: a fade to the water colour below the surface.
 * A foot on land, or hidden by the bank in front of it, has none.
 */
function waterFade(p: Painter, feet: { x: number; y: number; half: number }[]) {
  const g = new Graphics();
  for (const f of feet) {
    if (p.horizon(f.x, f.y) > WATERLINE + 0.5) continue;
    for (let k = 0; k < 6; k++) {
      const z = WATERLINE + 12 - k * 2,
        a = screen(f.x - f.half, f.y, z),
        b = screen(f.x + f.half, f.y, z),
        c = screen(f.x + f.half, f.y - 2 * f.half, z),
        a2 = screen(f.x - f.half, f.y, z - 2),
        b2 = screen(f.x + f.half, f.y, z - 2),
        c2 = screen(f.x + f.half, f.y - 2 * f.half, z - 2);
      g.poly([a.x, a.y, b.x, b.y, c.x, c.y, c2.x, c2.y, b2.x, b2.y, a2.x, a2.y]).fill({
        color: 0x2d6f80,
        alpha: 0.15 + k * 0.15,
      });
    }
  }
  return g;
}

/** Destroys a tile's parts with their meshes' own geometry (the surfaces are shared and stay). */
export function destroyBridgeParts(c: Container) {
  for (const m of c.children) if (m instanceof MeshSimple) m.geometry.destroy();
  c.destroy({ children: true });
}

/** Repeat addressing and smooth minification for the surfaces. */
export function prepareSurface(source: TextureSource) {
  source.addressMode = 'repeat';
  source.scaleMode = 'linear';
  source.autoGenerateMipmaps = true;
  source.updateMipmaps();
}
