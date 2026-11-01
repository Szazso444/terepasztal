import { Container, Graphics, Rectangle, Sprite, type Mesh, type Texture } from 'pixi.js';
import { OPEN_CROWN, OPEN_SPRING, OPEN_W } from '../art/tunnelArt';
import { depthKey, DIR_DX, DIR_DY, HALF_H, HALF_W, tileToWorld } from '../engine/iso';
import type { Portal } from '../sim/underground';
import {
  blankPortalArt,
  CUT_WALL,
  planePoint,
  type FaceFit,
  type Picture,
  type PortalArt,
  type Pt,
} from './tunnelPortalArt';
import { FACE_DIR, type DugView } from './tunnelGlass';

/*
 * The portals in the ordinary view. A face on +x or +y looks at the camera: a picture cut to the
 * ground as it stands, the real rail seen through the opening, and over it the dark of the tunnel.
 * A car in front of such a portal keeps its own colours and has one hard mask: the opening, plus
 * everything on the open side of the plane. A face on -x or -y looks away and has no picture: the
 * hill stands between the camera and the rail, so the mask is the line of the hill's top. A car
 * inside with nothing at a portal is hidden, as a depot hides a train.
 *
 * Every mask is a Graphics, a stencil: its edge stays hard at any zoom, it needs no texture, and a
 * masked sprite costs two extra draws rather than a pass of its own. Masks live in a holder that is
 * never built, so one no car uses draws nothing.
 */

/** How far from a portal's plane a car carries a mask, tiles. */
const REACH = 4.5;
/** The tiles of real track seen through an opening, the portal's own first, going dark. */
const THROAT_TINTS = [0xb4b4b4, 0x707070, 0x383838];
/** Half the width of a portal's face, and the step its height is read at, tiles. */
const SPAN = 0.6,
  STEP = 0.04;
/** How far from the rail the side of a car meets the plane of a portal, tiles. */
const CAR_SIDE = 0.2;
/** Past this far inside a car has nothing left outside: the opening alone shows it. */
const DEEP = 2;
/** How far in front of its plane a car stays under the dark; a longer one till its end is out. */
const UNDER_DARK = 0.9;
/** How much of the depth step a car in the throat takes per tile, keeping the near car on top. */
const THROAT_DEPTH = 0.04;
/** The world px a mask reaches, which is past any sprite near its portal. */
const MASK_REACH = 400;
/** The columns of the hill's line, world px apart, and how far they run. */
const HILL_COLUMN = 4,
  HILL_OUT = 8,
  HILL_IN = 3;
/** The tiles of a cutting the hill's line cuts: the last one's sleepers reach 7.3, inside the line. */
const HILL_RAILS = 7;
/** The tallest car, px over the rail, and how far inside the hill's line has cleared it, tiles. */
const CAR_TOP = 56,
  INTO_THE_HILL = 0.6;
/** The walk toward the camera: past this even the highest level stands under the view, tiles. */
const HILL_WALK = 5,
  HILL_STEP = 0.25;
/** How far an edit moves the ground around it, tiles: as far as a paint follows one (landscape.ts). */
const LEAN = 6;

/** How high the arch stands `u` tiles from the middle of the opening, px over the rail. */
function archHeight(u: number) {
  return OPEN_SPRING + Math.sqrt(Math.max(0, 1 - (u / OPEN_W) ** 2)) * (OPEN_CROWN - OPEN_SPRING);
}

/**
 * The outline of the opening, on the plane, standing on the ground in front of it: `ground(u)` is
 * how high that stands, px over the rail. The floor never rises past the arch, or the outline
 * would cross itself.
 */
export function openingOutline(ground: (u: number) => number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = Math.PI * (1 - i / 24);
    points.push(
      planePoint(Math.cos(t) * OPEN_W, OPEN_SPRING + Math.sin(t) * (OPEN_CROWN - OPEN_SPRING)),
    );
  }
  for (let u = OPEN_W; u >= -OPEN_W - 1e-6; u -= STEP)
    points.push(planePoint(u, Math.min(archHeight(u) - 1, Math.max(0, ground(u)))));
  return points;
}

/** A portal's plane: its middle in tile coordinates, the step out, the step along it. */
function planeOf(p: Portal) {
  const d = FACE_DIR[p.face],
    dx = DIR_DX[d],
    dy = DIR_DY[d];
  return { x: p.x + dx / 2, y: p.y + dy / 2, dx, dy, ax: dx ? 0 : 1, ay: dx ? 1 : 0 };
}

/** What the portals read of the world round them. */
export interface PortalHost {
  /** The depth-sorted layer they and the trains stand in. */
  readonly layer: Container;
  under(): DugView;
  /** Is the Drill's glass on? Then a portal is only an outline, and no car is masked. */
  glass(): boolean;
  /** World px of one level. */
  levelPx(): number;
  /** Height of the surface at a point of a tile, world px up, on the ground as it stands now. */
  lift(x: number, y: number): number;
  /** The picture of the rail on (x, y), and the mesh that stands for it on a climbing line. */
  rail(x: number, y: number): Sprite | undefined;
  railMesh(x: number, y: number): Mesh | undefined;
  /** No rail lies on (x, y): a car left there stands where a car without track stands. */
  bare(x: number, y: number): boolean;
}

/** How the ground stands round a portal, px over its rail: `inside` tiles behind its plane. */
function groundBy(host: PortalHost, p: Portal) {
  const plane = planeOf(p),
    floor = p.floor * host.levelPx();
  return (u: number, inside: number) =>
    host.lift(
      plane.x + plane.ax * u - plane.dx * inside,
      plane.y + plane.ay * u - plane.dy * inside,
    ) - floor;
}

/** How the ground stands round a face on +x or +y, now. */
export function fitFace(host: PortalHost, p: Portal): FaceFit {
  const ground = groundBy(host, p),
    { dx, dy } = planeOf(p),
    base = (u: number) => Math.max(0, ground(u, -0.1)),
    us: number[] = [],
    ds: number[] = [],
    bases: number[] = [],
    top: number[] = [],
    wall: number[] = [];
  for (let u = -SPAN; u <= SPAN + 1e-6; u += STEP) {
    us.push(u);
    const b = base(u),
      // the face reaches the ground behind it, and always clears the arch
      arch = Math.abs(u) < OPEN_W + 0.2 ? OPEN_CROWN + 7 - Math.abs(u) * 6 : 0;
    bases.push(b);
    top.push(Math.max(b, ground(u, 0.3) + 1, arch));
  }
  // a cut with no rail on it yet is not carved: only a laid one is a cutting to wall
  let run = 0;
  const under = host.under();
  for (let i = 1; ; i++) {
    const x = p.x + dx * i,
      y = p.y + dy * i;
    if (!under.isCut(x, y) || !host.rail(x, y)) break;
    run++;
  }
  for (let d = 0; d >= -run - 1e-6; d -= STEP) {
    ds.push(d);
    wall.push(Math.max(0, ground(-CUT_WALL - 0.12, d), ground(-CUT_WALL - 0.3, d)));
  }
  return {
    mirror: p.face === 'S',
    bricks: (p.x * 7 + p.y * 13) & 3,
    us,
    base: bases,
    top,
    run,
    ds,
    wall,
    opening: openingOutline(base),
  };
}

/**
 * The line of the hill between the camera and a rail going in on a face on -x or -y: world px from
 * the portal's plane, the part of the screen a car shows in, as a closed outline. Each column of
 * the screen starts where the line of the rail passes under it, out in the cutting or on in the
 * mountain, and walks toward the camera: the highest the ground stands on the screen is the hill's
 * top there, and all under it is behind the hill. A column where nothing stands higher than the
 * rail hides nothing.
 */
export function hillLine(host: PortalHost, p: Portal): Pt[] {
  const plane = planeOf(p),
    floor = p.floor * host.levelPx(),
    // the screen's x of one tile out of the face: W runs left, N runs right
    screen = plane.dx ? -HALF_W : HALF_W,
    columns: Pt[] = [];
  for (let s = -HILL_IN; s <= HILL_OUT; s += HILL_COLUMN / HALF_W) {
    const x0 = plane.x + plane.dx * s,
      y0 = plane.y + plane.dy * s,
      rail = (x0 + y0 - plane.x - plane.y) * HALF_H,
      at = (t: number) => rail + 2 * t * HALF_H - (host.lift(x0 + t, y0 + t) - floor);
    let topmost = at(0);
    for (let t = HILL_STEP; t <= HILL_WALK; t += HILL_STEP) topmost = Math.min(topmost, at(t));
    // in the mountain a roof stands under the ground, though the cover may be lower than a car
    if (s < 0) topmost = Math.min(topmost, rail - CAR_TOP * Math.min(1, -s / INTO_THE_HILL));
    columns.push({ x: s * screen, y: topmost < rail - 1 ? topmost : MASK_REACH });
  }
  const [first] = columns,
    last = columns[columns.length - 1];
  return [...columns, { x: last.x, y: -MASK_REACH }, { x: first.x, y: -MASK_REACH }];
}

/** The tiles round `p` an edit reaches it from: `out` tiles out, the walk toward the camera. */
function tilesRead(p: Portal, out: number, walk: number) {
  const { dx, dy } = planeOf(p),
    ax = p.x + dx * out,
    ay = p.y + dy * out,
    bx = p.x - dx * HILL_IN,
    by = p.y - dy * HILL_IN;
  return {
    x0: Math.min(ax, bx) - 1 - LEAN,
    y0: Math.min(ay, by) - 1 - LEAN,
    x1: Math.max(ax, bx) + 1 + LEAN + walk,
    y1: Math.max(ay, by) + 1 + LEAN + walk,
  };
}

/** A portal as it stands in the layer. */
interface Standing {
  portal: Portal;
  /** the ground and rail it was made for: nothing is made again while this stands */
  fit: string;
  /** the tiles an edit reaches it from */
  reads: ReturnType<typeof tilesRead>;
  /** the plane: tile coordinates, the step out */
  x: number;
  y: number;
  dx: number;
  dy: number;
  back: Sprite | null;
  lip: Sprite | null;
  rail: Container | null;
  /** the pictures' own textures, made for this portal alone */
  textures: Texture[];
  /** the back's depth; a car near it never sorts below this + 2 */
  depth: number;
  /** what a car shows through, with a part outside and all inside */
  outer: Graphics;
  inner: Graphics | null;
}

/** A tile's key in `lanes`; the tiles round the map's edge stay apart from the rest. */
const laneKey = (x: number, y: number) => (y + 8) * 65536 + x + 8;

/** The portals by the layer the cars stand in, so the trains find them (as `surfaceVersions`). */
export const layerPortals = new WeakMap<Container, TunnelPortals>();

export class TunnelPortals {
  /** How the pictures are made: on a canvas in the game, stand-ins where there is no canvas. */
  art: PortalArt = blankPortalArt;
  /** How many pictures were made, for a test or a measure. */
  built = 0;
  private readonly standing = new Map<string, Standing>();
  /** The portal whose rail runs through each tile, the nearest of them where two lanes meet. */
  private readonly lanes = new Map<number, Standing>();
  /** Rails in a cutting on a face that looks away: the hill's line cuts them. */
  private cutRails: { rail: Container; mask: Graphics }[] = [];
  /** Never built: the masks stand here, for their transforms. */
  private readonly masks = new Container();
  /** Masks of portals taken down: a car may hold one until it is next dressed, so none is freed. */
  private readonly spare: Graphics[] = [];
  /** The store or the ground as a whole changed: every portal looks again. */
  private stale = true;
  /** Portals an edit reached: only these look again. */
  private readonly touched = new Set<Standing>();

  constructor(private readonly host: PortalHost) {
    this.masks.includeInBuild = false;
    this.masks.measurable = false;
    this.masks.zIndex = -1e9;
    host.layer.addChild(this.masks);
  }

  /** Something every portal is made from changed: `update` looks at them all again. */
  mark() {
    this.stale = true;
  }
  /** The ground or the rail on (x, y) changed: `update` looks again at the portals it reaches. */
  touch(x: number, y: number) {
    for (const s of this.standing.values()) {
      const { x0, y0, x1, y1 } = s.reads;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) this.touched.add(s);
    }
  }
  /** Called every frame, after the relief has settled: a comparison unless something changed. */
  update() {
    if (this.stale) this.refresh();
    else if (this.touched.size) {
      for (const s of this.touched) this.fit(s.portal);
      this.touched.clear();
      this.settle();
    }
  }

  /**
   * Bring all the portals up to the store and the ground: one whose ground or rail changed is cut
   * again, and one that went is taken down. A portal nothing touched costs a look at its ground.
   */
  refresh() {
    this.stale = false;
    this.touched.clear();
    const gone = new Set(this.standing.keys());
    for (const p of this.host.under().portals()) gone.delete(this.fit(p));
    for (const key of gone) {
      this.takeDown(this.standing.get(key)!);
      this.standing.delete(key);
    }
    this.settle();
  }
  /** Cut `p` again if what it is made from changed. Returns its key. */
  private fit(p: Portal) {
    const { host } = this,
      key = `${p.x},${p.y},${p.face}`,
      front = p.face === 'E' || p.face === 'S',
      fit = front ? fitFace(host, p) : null,
      hill = fit ? null : hillLine(host, p),
      fingerprint = JSON.stringify([fit ?? hill, front ? this.throatPrint(p) : 0]),
      old = this.standing.get(key);
    if (old?.fit === fingerprint) return key;
    if (old) this.takeDown(old);
    this.standing.set(key, this.put(p, fingerprint, fit, hill));
    return key;
  }
  /** What the portals hold of the world, after one of them looked again. */
  private settle() {
    this.layLanes();
    this.cutTheRails();
    this.showAll();
  }
  /** What the throat of `p` copies: a rail that changed there changes this. */
  private throatPrint(p: Portal) {
    const { dx, dy } = planeOf(p);
    return THROAT_TINTS.map((_, i) => {
      const r = this.host.rail(p.x - dx * i, p.y - dy * i);
      return r ? [r.texture.uid, r.x, r.y] : 0;
    });
  }
  private put(p: Portal, fit: string, face: FaceFit | null, hill: Pt[] | null): Standing {
    const { host } = this,
      plane = planeOf(p),
      w = tileToWorld(plane.x, plane.y),
      at = { x: w.x, y: w.y - p.floor * host.levelPx() },
      depth = depthKey(p.x + plane.dx, p.y + plane.dy, -1),
      shown: Standing = {
        portal: p,
        fit,
        reads: face ? tilesRead(p, face.run + 1, 0) : tilesRead(p, HILL_OUT, HILL_WALK),
        ...plane,
        back: null,
        lip: null,
        rail: null,
        textures: [],
        depth,
        outer: this.mask(at),
        inner: null,
      };
    if (!face) {
      shown.outer.poly(hill!).fill(0xffffff);
      return shown;
    }
    this.built++;
    const flip = face.mirror ? -1 : 1,
      opening = face.opening.map((q) => ({ x: q.x * flip, y: q.y })),
      line = planePoint(CAR_SIDE, 0).x * flip;
    shown.outer.poly(opening).fill(0xffffff);
    shown.outer
      .rect(
        face.mirror ? -MASK_REACH : line,
        -MASK_REACH,
        MASK_REACH + (face.mirror ? line : -line),
        2 * MASK_REACH,
      )
      .fill(0xffffff);
    shown.inner = this.mask(at).poly(opening).fill(0xffffff);
    const back = this.art.back(face),
      dark = this.art.dark(face);
    shown.textures.push(back.texture, dark.texture);
    shown.back = this.picture(back, at, depth);
    shown.rail = this.throat(p, shown.inner, depth + 1);
    const xs = opening.map((q) => at.x + q.x),
      ys = opening.map((q) => at.y + q.y),
      x = Math.min(...xs),
      y = Math.min(...ys);
    // the throat shows only through the opening, so that is its whole area for the chunk cull
    shown.rail.cullArea = new Rectangle(x, y, Math.max(...xs) - x, Math.max(...ys) - y);
    shown.lip = this.picture(dark, at, depth + 4);
    return shown;
  }
  private mask(at: Pt) {
    const g = this.spare.pop() ?? this.masks.addChild(new Graphics());
    g.position.set(at.x, at.y);
    return g;
  }
  private picture(p: Picture, at: Pt, depth: number) {
    const s = new Sprite(p.texture);
    s.position.set(at.x + p.x, at.y + p.y);
    s.scale.set(p.scale);
    s.zIndex = depth;
    s.cullable = true;
    this.host.layer.addChild(s);
    return s;
  }
  /** Copies of the real track on the tiles behind the plane, seen through the opening. */
  private throat(p: Portal, mask: Graphics, depth: number) {
    const { dx, dy } = planeOf(p),
      copies = new Container();
    copies.zIndex = depth;
    copies.cullable = true;
    // from the far end: a piece overlaps the one behind it
    for (let i = THROAT_TINTS.length - 1; i >= 0; i--) {
      const t = this.host.rail(p.x - dx * i, p.y - dy * i);
      if (!t) continue;
      const c = new Sprite(t.texture);
      c.anchor.copyFrom(t.anchor);
      c.position.copyFrom(t.position);
      c.scale.copyFrom(t.scale);
      c.skew.copyFrom(t.skew);
      c.tint = THROAT_TINTS[i];
      copies.addChild(c);
    }
    copies.mask = mask;
    this.host.layer.addChild(copies);
    return copies;
  }
  private takeDown(s: Standing) {
    if (s.rail) s.rail.mask = null;
    s.back?.destroy();
    s.lip?.destroy();
    s.rail?.destroy({ children: true });
    for (const t of s.textures) t.destroy(true);
    if (s.inner) this.spare.push(s.inner.clear());
    this.spare.push(s.outer.clear());
  }
  /** Each portal claims the tiles its rail runs through, within reach of its plane. */
  private layLanes() {
    const { lanes } = this,
      under = this.host.under(),
      reach = Math.ceil(REACH) + 1,
      claim = (s: Standing, x: number, y: number) => {
        const key = laneKey(x, y),
          other = lanes.get(key);
        if (!other || off(s, x, y) < off(other, x, y)) lanes.set(key, s);
      },
      off = (s: Standing, x: number, y: number) => Math.hypot(s.x - x, s.y - y);
    lanes.clear();
    for (const s of this.standing.values()) {
      const { x, y } = s.portal;
      for (let i = 1; i <= reach; i++) claim(s, x + s.dx * i, y + s.dy * i);
      for (let i = 0; i <= reach; i++) {
        // inside, a rail may turn right behind the portal, so the lane is three wide at first
        for (let a = i <= 1 ? -1 : 0; a <= (i <= 1 ? 1 : 0); a++) {
          const tx = x - s.dx * i + (s.dx ? 0 : a),
            ty = y - s.dy * i + (s.dx ? a : 0);
          if (under.floorAt(tx, ty) !== undefined) claim(s, tx, ty);
        }
      }
    }
  }
  /** The hill's line cuts the rails of a cutting on a face that looks away. */
  private cutTheRails() {
    const { host } = this,
      under = host.under();
    for (const { rail } of this.cutRails) if (!rail.destroyed) rail.mask = null;
    this.cutRails = [];
    for (const s of this.standing.values()) {
      if (s.back) continue;
      for (let i = 1; i <= HILL_RAILS; i++) {
        const x = s.portal.x + s.dx * i,
          y = s.portal.y + s.dy * i;
        if (!under.isCut(x, y)) break;
        for (const rail of [host.rail(x, y), host.railMesh(x, y)])
          if (rail) this.cutRails.push({ rail, mask: s.outer });
      }
    }
  }
  /** Give the pictures' textures back, with the world. */
  destroy() {
    for (const s of this.standing.values()) for (const t of s.textures) t.destroy(true);
    this.standing.clear();
  }
  /** Show the portals for the view: in the glass they are outlines only (tunnelGlass.ts). */
  showAll() {
    const on = this.host.glass();
    for (const s of this.standing.values())
      for (const part of [s.back, s.lip, s.rail]) if (part) part.visible = !on;
    for (const { rail, mask } of this.cutRails) if (!rail.destroyed) rail.mask = on ? null : mask;
  }

  /**
   * Is (x, y) under a mountain, in the view where nothing shows there? A dug tile whose track was
   * taken away has no car in it: a train left there stands in plain sight, as on the surface.
   */
  inside(x: number, y: number) {
    if (this.host.glass()) return false;
    const tx = Math.floor(x + 0.5),
      ty = Math.floor(y + 0.5);
    return this.host.under().floorAt(tx, ty) !== undefined && !this.host.bare(tx, ty);
  }

  /**
   * Called for every sprite of a car, once it is posed at (x, y): what of it shows, and where it
   * sorts near a portal. Only a car on a portal's own rail and within reach of it is masked: a
   * train passing a portal on another line takes no part in it. A picture `half` tiles long each
   * way from (x, y), along the heading `angle`, is taken by its ends: it is under the dark while one
   * end is behind the plane, and only with both behind it has nothing left outside.
   */
  dress(s: Container, x: number, y: number, half = 0, angle = 0) {
    const tx = Math.floor(x + 0.5),
      ty = Math.floor(y + 0.5);
    if (
      this.host.glass() ||
      (this.host.under().floorAt(tx, ty) !== undefined && this.host.bare(tx, ty))
    ) {
      if (s.mask) s.mask = null;
      return;
    }
    const near = this.lanes.get(laneKey(tx, ty));
    if (!near || Math.hypot(near.x - x, near.y - y) >= REACH) {
      if (s.mask) s.mask = null;
      if (this.inside(x, y)) s.visible = false;
      return;
    }
    // tiles out of the plane, less than 0 is inside; how far the ends reach from there; tiles off
    // the portal's axis. The masks cut a car where it crosses the plane on that axis, so one all
    // behind the plane and off the axis has no part left for the side outside the opening
    const along = (x - near.x) * near.dx + (y - near.y) * near.dy,
      ends = half * Math.abs(Math.cos(angle) * near.dx + Math.sin(angle) * near.dy),
      across = Math.abs((x - near.x) * near.dy + (y - near.y) * near.dx),
      deep = along < -DEEP || (along + ends < 0 && across > CAR_SIDE);
    if (!near.inner) {
      // a face that looks away: nothing of a car this far in stands above the hill
      if (deep) {
        if (s.mask) s.mask = null;
        s.visible = false;
      } else s.mask = near.outer;
      return;
    }
    s.mask = deep ? near.inner : near.outer;
    // the portal picture is the back of the scene: a car over it is never under it, whatever its
    // own depth says; going in, it stands over the picture and the rail and under the dark, the
    // nearer of two cars on top
    const over = near.depth + 2;
    s.zIndex =
      along < Math.max(UNDER_DARK, ends)
        ? over + (along + REACH) * THROAT_DEPTH
        : Math.max(s.zIndex, over);
  }
}
