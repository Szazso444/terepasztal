import { PAL } from '../art/palette';
import { hash2 } from '../engine/rng';

/**
 * Wheat fields (#444, the wheat of the art demo v7 the author approved on 2026-10-14): each field
 * is one patch with a warped, feathered border across its tiles, its stalks 2.6 to 3.5 px tall,
 * shorter and ragged toward its edge, darker on the front they turn to the camera, and up to
 * 1.8 px taller along the foot of a building on its W or S side (screen NW or SW), where it runs
 * up to the building.
 *
 * A field stays one prop sprite per tile in the depth-sorted object layer; this module computes
 * the picture each tile's sprite shows. The field is a height field over the tile's ground plane,
 * painted as the demo's painter painted it: column by column, from the front to the back, every
 * ground point standing as high as its stalks. Each ground point belongs to the one field tile
 * nearest it, and each texel to the tile of the point it shows, so neighbouring tiles divide the
 * field between them texel by texel. A tile's picture also carries a skirt of its neighbours'
 * opaque texels round its own, so the pictures still meet where the view filters them.
 *
 * Everything is a function of the tiles round the field tile (`FieldSite`) and the variants'
 * pictures, never of the order the tiles are built in. All of it is worked out on world
 * coordinates (map plus origin): the noise, so a map that grows keeps its fields, and the points
 * and texel rows, so a ground point comes out the same whichever tile's picture it is read for.
 * Pure: no Pixi, no DOM, plain RGBA arrays.
 */

/** Texels per world px of a field's picture, the landscape painter's SHARP_SCALE. */
export const FIELD_RES = 2;
/** How far round a field tile its picture reads the map (tiles, along either axis). */
export const SITE_RADIUS = 3;
const SIDE = 2 * SITE_RADIUS + 1;

/** What a tile round a field tile is, as the field reads it (`FieldCell.kind`). */
export const CELL_OPEN = 0;
export const CELL_FIELD = 1;
export const CELL_BLOCKED = 2;
/** A building's footprint tile (`FieldCell.run`): a field on its W (-x) side runs up to it. */
export const RUN_W = 1;
/** ... and one on its S (+y) side. */
export const RUN_S = 2;

/** One tile round a field tile. */
export interface FieldCell {
  /**
   * CELL_FIELD where a wheat field is drawn; CELL_BLOCKED for track, a road, paving, water,
   * anything standing there, a building's footprint and off the map; CELL_OPEN for open land
   */
  kind: number;
  /** the field's variant (0 to 2), for CELL_FIELD */
  variant: number;
  /** the tile's ground level (world/elevation.ts `levelAt`); a field reaches no other level */
  level: number;
  /** RUN_W and RUN_S, for a building's footprint tile whose W or S side a field may run up to */
  run: number;
}

/** The tiles round one field tile, (2 SITE_RADIUS + 1)² of them, row by row from its far corner. */
export interface FieldSite {
  /** the field tile in world tile coordinates (map plus origin) */
  x: number;
  y: number;
  kind: Uint8Array;
  variant: Uint8Array;
  level: Int16Array;
  run: Uint8Array;
}

/** Read the site of the field tile at world tile (x, y); `cell` answers in world coordinates too. */
export function readSite(x: number, y: number, cell: (x: number, y: number) => FieldCell) {
  const n = SIDE * SIDE,
    site: FieldSite = {
      x,
      y,
      kind: new Uint8Array(n),
      variant: new Uint8Array(n),
      level: new Int16Array(n),
      run: new Uint8Array(n),
    };
  for (let dy = -SITE_RADIUS; dy <= SITE_RADIUS; dy++)
    for (let dx = -SITE_RADIUS; dx <= SITE_RADIUS; dx++) {
      const k = (dy + SITE_RADIUS) * SIDE + dx + SITE_RADIUS,
        c = cell(x + dx, y + dy);
      site.kind[k] = c.kind;
      site.variant[k] = c.kind === CELL_FIELD ? c.variant : 0;
      site.level[k] = c.level;
      site.run[k] = c.kind === CELL_BLOCKED ? c.run : 0;
    }
  return site;
}

/** Everything a site's picture depends on, as text: equal keys give equal pictures. */
export function siteKey(site: FieldSite) {
  const { x, y, kind, variant, level, run } = site;
  return `${x},${y}|${kind.join('')}|${variant.join('')}|${level.join(',')}|${run.join('')}`;
}

/** A variant's picture: its atlas frame's texels, RGBA. */
export interface FieldFrame {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  /** texels per world px (the atlas's `resolution`) */
  density: number;
  /** the tile's centre on the ground, in texels from the frame's top-left */
  anchorX: number;
  anchorY: number;
}

/** A field tile's picture, RGBA with straight alpha, `FIELD_RES` texels per world px. */
export interface FieldPicture {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  /** world px from the tile's centre on its ground to the picture's top-left, multiples of 4 */
  left: number;
  top: number;
  /** per texel 1 where it shows the tile's own field, 0 in its skirt and where it is clear */
  own: Uint8Array;
}

// The shape, as the demo's `fieldAt` has it.
/** The border's warp: ±0.29 tile at frequency 3.1 and ±0.11 at frequency 10. */
const WARP_FREQ = 3.1,
  WARP = 0.58,
  FINE_FREQ = 10,
  FINE = 0.22;
/** The most the warp moves a point along either axis (tiles). */
const WARP_MAX = WARP / 2 + FINE / 2;
/** A tile's patch: half-size toward a field neighbour (or a building it runs up to), elsewhere. */
const HALF_JOINED = 0.62,
  HALF_OPEN = 0.42,
  CORNER = 0.16;
/** Cover is 1 - smoothstep((d + EDGE_IN) / EDGE_BAND); nothing past d = EDGE_OUT. */
const EDGE_IN = 0.06,
  EDGE_BAND = 0.13,
  EDGE_OUT = 0.07;
/**
 * Toward a blocked tile the field ends inside its own: its border 0.31 to 0.43 tile from the
 * centre, so its feather is gone by the tile's edge (0.43 + EDGE_OUT = 0.5).
 */
const BLOCK_EDGE = 0.43,
  BLOCK_WOBBLE = 0.12;
/** Toward a building it runs up to, 0.12 tile past the shared edge, give or take 0.04. */
const RUNUP_EDGE = HALF_JOINED,
  RUNUP_WOBBLE = 0.08;
/** The variant's picture is mirrored back from this far off the tile's centre. */
const MIRROR = 0.36;
/** The finished pictures' top surface stands this far over the ground (world px). */
const LIFT = 2.5;

// The stalks, as the demo's `paintColumn` has them.
const STALK = 2.6,
  SWELL = 0.9,
  SWELL_FREQ = 2.7,
  TALL = 1.8;

/** The box every picture is painted in before it is cropped: world px from the tile's centre. */
const BOX_LEFT = -72,
  BOX_TOP = -44,
  BOX_W = 144,
  BOX_H = 84;
/**
 * The skirt of neighbours' opaque texels round a picture's own (texels), and how far past its own
 * field it reaches (tiles): 2 world px, which covers what the view's filter and its mipmaps read
 * round a texel down to zoom 0.5.
 */
const SKIRT = 4,
  SKIRT_REACH = 0.1;
/** Pictures are cropped to whole multiples of this many world px, so each lands on a pixel. */
const GRID = 4;
/** March steps per tile along a column (one texel row on level ground). */
const STEPS = 16 * FIELD_RES;

/** Seeds of the fields' noise. */
const SEED_WARP_X = 4441,
  SEED_WARP_Y = 4442,
  SEED_FINE_X = 4443,
  SEED_FINE_Y = 4444,
  SEED_SWELL = 4445,
  SEED_RAGGED = 4446,
  SEED_RAGGED_FINE = 4447,
  SEED_STREAK = 4448,
  SEED_STREAK_DARK = 4449;

/** The 3 x 3 cells round a cell of a site, as offsets. */
const AROUND = [-SIDE - 1, -SIDE, -SIDE + 1, -1, 0, 1, SIDE - 1, SIDE, SIDE + 1];

const sstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The game's own value noise (terrainMaterials.ts `surfaceNoise`), the same numbers to the bit,
 * keeping the four lattice values of the last cell it read: a field reads its noise at points a
 * fraction of a cell apart, so most reads skip the hashing.
 */
export class LatticeNoise {
  private ix = NaN;
  private iy = NaN;
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;
  constructor(readonly seed: number) {}
  at(x: number, y: number) {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    if (ix !== this.ix || iy !== this.iy) {
      this.ix = ix;
      this.iy = iy;
      this.a = hash2(ix, iy, this.seed);
      this.b = hash2(ix + 1, iy, this.seed);
      this.c = hash2(ix, iy + 1, this.seed);
      this.d = hash2(ix + 1, iy + 1, this.seed);
    }
    const fx = x - ix,
      fy = y - iy,
      u = fx * fx * (3 - 2 * fx),
      v = fy * fy * (3 - 2 * fy),
      { a, b, c, d } = this;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
}

/** A field tile a point can belong to, round the tile whose picture is painted. */
interface Candidate {
  /** its cell in the site */
  id: number;
  /** world tile coordinates of its centre */
  x: number;
  y: number;
  variant: number;
  /** its patch's half-size toward +x, -x, +y, -y */
  hxp: number;
  hxn: number;
  hyp: number;
  hyn: number;
  /**
   * Where the field must end toward its blocked neighbours, six numbers each: the neighbour's
   * direction (sx, sy), the edge along x and along y, and whether each is a run-up (wobbling
   * about its edge) rather than a block (only ever inward).
   */
  limits: number[];
  /** the building tiles (world tile coordinates, x and y each) its stalks stand taller along */
  tall: number[];
}

/**
 * The field round one field tile: which tile each ground point belongs to, how much of it is
 * covered and how tall its stalks stand, and the tile's picture.
 */
export class FieldModel {
  private readonly cands: (Candidate | null)[];
  /** Per cell of the site, whether a field tile lies in the 3 x 3 round it. */
  private readonly near: Uint8Array;
  /** The tile whose picture this is. */
  readonly self: Candidate;
  /** How far its own field can reach from its centre toward +x, -x, +y, -y (tiles). */
  readonly reach: [number, number, number, number];
  /** How far in front of a point stalks can stand that hide it (tiles). */
  readonly hide: number;
  /** The last point read (`read`): the tile it belongs to (or null), its distance and stalks. */
  owner: Candidate | null = null;
  distance = Infinity;
  cover = 0;
  height = 0;
  private readonly warpX = new LatticeNoise(SEED_WARP_X);
  private readonly warpY = new LatticeNoise(SEED_WARP_Y);
  private readonly fineX = new LatticeNoise(SEED_FINE_X);
  private readonly fineY = new LatticeNoise(SEED_FINE_Y);
  private readonly swell = new LatticeNoise(SEED_SWELL);
  private readonly ragged = new LatticeNoise(SEED_RAGGED);
  private readonly raggedFine = new LatticeNoise(SEED_RAGGED_FINE);

  constructor(readonly site: FieldSite) {
    const R = SITE_RADIUS,
      at = (dx: number, dy: number) => (dy + R) * SIDE + dx + R,
      level = site.level[at(0, 0)];
    this.cands = new Array<Candidate | null>(SIDE * SIDE).fill(null);
    // a field at another level is no field to this one: neither joins nor reaches the other
    const isField = (dx: number, dy: number) =>
      site.kind[at(dx, dy)] === CELL_FIELD && site.level[at(dx, dy)] === level;
    const blocked = (dx: number, dy: number) =>
      site.kind[at(dx, dy)] === CELL_BLOCKED || site.level[at(dx, dy)] !== level;
    let tallest = STALK + SWELL;
    for (let dy = -R + 1; dy <= R - 1; dy++)
      for (let dx = -R + 1; dx <= R - 1; dx++) {
        if (!isField(dx, dy)) continue;
        const runX = !!(site.run[at(dx + 1, dy)] & RUN_W) && blocked(dx + 1, dy),
          runY = !!(site.run[at(dx, dy - 1)] & RUN_S) && blocked(dx, dy - 1),
          limits: number[] = [],
          tall: number[] = [];
        for (let sy = -1; sy <= 1; sy++)
          for (let sx = -1; sx <= 1; sx++) {
            if ((!sx && !sy) || !blocked(dx + sx, dy + sy)) continue;
            // a building it runs up to, and the strip along that building's foot past the corner
            // where the next tile along is a footprint tile too
            const k = at(dx + sx, dy + sy),
              upX = sx === 1 && runX && !!(site.run[k] & RUN_W),
              upY = sy === -1 && runY && !!(site.run[k] & RUN_S);
            limits.push(
              sx,
              sy,
              upX ? RUNUP_EDGE : BLOCK_EDGE,
              upY ? RUNUP_EDGE : BLOCK_EDGE,
              upX ? 1 : 0,
              upY ? 1 : 0,
            );
          }
        if (runX) tall.push(site.x + dx + 1, site.y + dy);
        if (runY) tall.push(site.x + dx, site.y + dy - 1);
        if (tall.length) tallest = STALK + SWELL + TALL;
        this.cands[at(dx, dy)] = {
          id: at(dx, dy),
          x: site.x + dx,
          y: site.y + dy,
          variant: site.variant[at(dx, dy)],
          hxp: isField(dx + 1, dy) || runX ? HALF_JOINED : HALF_OPEN,
          hxn: isField(dx - 1, dy) ? HALF_JOINED : HALF_OPEN,
          hyp: isField(dx, dy + 1) ? HALF_JOINED : HALF_OPEN,
          hyn: isField(dx, dy - 1) || runY ? HALF_JOINED : HALF_OPEN,
          limits,
          tall,
        };
      }
    const self = this.cands[at(0, 0)];
    if (!self) throw new Error('A field site must be a field tile');
    this.near = new Uint8Array(SIDE * SIDE);
    for (let dy = -R + 1; dy <= R - 1; dy++)
      for (let dx = -R + 1; dx <= R - 1; dx++)
        for (let sy = -1; sy <= 1; sy++)
          for (let sx = -1; sx <= 1; sx++)
            if (this.cands[at(dx + sx, dy + sy)]) this.near[at(dx, dy)] = 1;
    this.self = self;
    this.hide = (tallest + 1.5) / 16;
    // its own field reaches its patch's half-size, warped and feathered; toward a blocked tile no
    // further than the tile's edge, toward a building it runs up to its limit
    const side = (half: number, dx: number, dy: number, run: boolean) =>
      (run
        ? RUNUP_EDGE + RUNUP_WOBBLE / 2 + EDGE_OUT
        : blocked(dx, dy)
          ? 0.5
          : half + WARP_MAX + EDGE_OUT) + SKIRT_REACH;
    const runX = !!(site.run[at(1, 0)] & RUN_W) && blocked(1, 0),
      runY = !!(site.run[at(0, -1)] & RUN_S) && blocked(0, -1);
    this.reach = [
      side(self.hxp, 1, 0, runX),
      side(self.hxn, -1, 0, false),
      side(self.hyp, 0, 1, false),
      side(self.hyn, 0, -1, runY),
    ];
  }

  /** The tile the last point read belongs to, as [dx, dy] from this site's tile; null for none. */
  ownerOffset(): [number, number] | null {
    return this.owner ? [this.owner.x - this.site.x, this.owner.y - this.site.y] : null;
  }

  /**
   * Read the field at world tile point (x, y), within 1.5 tiles of this site's tile along either
   * axis: `owner`, `distance` (the demo's d, negative inside), `cover` and `height` (world px).
   */
  read(x: number, y: number) {
    this.owner = null;
    this.distance = Infinity;
    this.cover = 0;
    this.height = 0;
    const x0 = this.site.x - SITE_RADIUS,
      y0 = this.site.y - SITE_RADIUS,
      at = (Math.round(y) - y0) * SIDE + Math.round(x) - x0;
    if (!this.near[at]) return;
    const cands = this.cands,
      fx = this.fineX.at(x * FINE_FREQ, y * FINE_FREQ),
      fy = this.fineY.at(x * FINE_FREQ, y * FINE_FREQ),
      mx = x + (this.warpX.at(x * WARP_FREQ, y * WARP_FREQ) - 0.5) * WARP + (fx - 0.5) * FINE,
      my = y + (this.warpY.at(x * WARP_FREQ, y * WARP_FREQ) - 0.5) * WARP + (fy - 0.5) * FINE,
      // the tile the warped point lies on first: most often its own tile is the nearest, and the
      // others need not be measured once they cannot beat it (the warp keeps it within the 3 x 3)
      first = (Math.round(my) - y0) * SIDE + Math.round(mx) - x0;
    let best = Infinity,
      owner: Candidate | null = null;
    for (let q = -1; q < 9; q++) {
      const k = q < 0 ? first : at + AROUND[q];
      if (q >= 0 && k === first) continue;
      const c = cands[k];
      if (!c) continue;
      const ex = mx - c.x,
        ey = my - c.y,
        ax = ex < 0 ? -ex : ex,
        ay = ey < 0 ? -ey : ey;
      // no nearer than its largest patch allows: it cannot beat the best so far
      if ((ax > ay ? ax : ay) - HALF_JOINED >= best) continue;
      const qx = ax - (ex > 0 ? c.hxp : c.hxn) + CORNER,
        qy = ay - (ey > 0 ? c.hyp : c.hyn) + CORNER;
      let d = (qx > 0 && qy > 0 ? Math.sqrt(qx * qx + qy * qy) : qx > qy ? qx : qy) - CORNER;
      // where it must end short of a blocked neighbour (measured on the ground, unwarped)
      const L = c.limits;
      if (L.length) {
        const lx = x - c.x,
          ly = y - c.y;
        for (let i = 0; i < L.length; i += 6) {
          const sx = L[i],
            sy = L[i + 1],
            cx = sx * lx - L[i + 2] + (L[i + 4] ? (fx - 0.5) * RUNUP_WOBBLE : fx * BLOCK_WOBBLE),
            cy = sy * ly - L[i + 3] + (L[i + 5] ? (fy - 0.5) * RUNUP_WOBBLE : fy * BLOCK_WOBBLE),
            lim = !sx ? cy : !sy ? cx : cx < cy ? cx : cy;
          if (lim > d) d = lim;
        }
      }
      if (d < best) {
        best = d;
        owner = c;
      }
    }
    if (!owner || best > EDGE_OUT) return;
    this.owner = owner;
    this.distance = best;
    const cover = 1 - sstep((best + EDGE_IN) / EDGE_BAND);
    if (cover <= 0) return;
    this.cover = cover;
    // up to 1.8 px taller along the foot of a building it runs up to
    let tall = 0;
    const T = owner.tall;
    for (let k = 0; k < T.length; k += 2) {
      const e = Math.max(Math.abs(x - T[k]), Math.abs(y - T[k + 1])) - 0.34;
      if (e < 0.5) tall = Math.max(tall, 1 - sstep((e - 0.05) / 0.4));
    }
    // shorter stalk by stalk toward the edge: a ragged edge, not a cut-off wall
    let stand = 1;
    if (cover < 1) {
      const sn = this.ragged.at(x * 23, y * 23) * 0.6 + this.raggedFine.at(x * 9, y * 9) * 0.4;
      stand = sstep((cover - 0.08 - 0.4 * sn * (1 - cover)) / 0.55);
    }
    if (stand > 0)
      this.height =
        (STALK + SWELL * this.swell.at(x * SWELL_FREQ, y * SWELL_FREQ) + TALL * tall) * stand;
  }

  /** A candidate by its cell in the site. */
  candidate(id: number) {
    return this.cands[id];
  }

  /**
   * This tile's picture, its field coloured from its variant's picture (`frames[variant]`) and its
   * skirt from its neighbours'. Null where its own variant's picture is missing.
   */
  picture(frames: readonly (FieldFrame | null | undefined)[]): FieldPicture | null {
    const job = this.job(frames);
    while (!job.run(() => true));
    return job.result;
  }

  /** The same picture, painted a little at a time (`FieldJob.run`). */
  job(frames: readonly (FieldFrame | null | undefined)[]) {
    return new FieldJob(this, frames);
  }
}

/** What a picture is painted in before it is cropped, kept for the next picture. */
interface Scratch {
  owner: Int16Array;
  step: Int32Array;
  height: Float64Array;
  cover: Float32Array;
  face: Float32Array;
  depth: Float32Array;
  own: Uint8Array;
  across: Uint8Array;
  near: Uint8Array;
  data: Uint8ClampedArray;
}
const W = BOX_W * FIELD_RES,
  H = BOX_H * FIELD_RES;
const spare: Scratch[] = [];
function scratch(): Scratch {
  const s = spare.pop();
  if (s) return s;
  const n = W * H;
  return {
    owner: new Int16Array(n),
    step: new Int32Array(n),
    height: new Float64Array(n),
    cover: new Float32Array(n),
    face: new Float32Array(n),
    depth: new Float32Array(n),
    own: new Uint8Array(n),
    across: new Uint8Array(n),
    near: new Uint8Array(n),
    data: new Uint8ClampedArray(n * 4),
  };
}

/**
 * One tile's picture, painted a little at a time (`run`), so a frame can stop when its time is
 * spent: column by column its field, then its skirt along rows and down columns, then row by row
 * its colours.
 */
export class FieldJob {
  /** The picture once done: null where it cannot be built. */
  result: FieldPicture | null = null;
  done = false;
  private s: Scratch | null = null;
  /** The step it is at (march, across, down, colour) and the column or row within it. */
  private phase = 0;
  private at = 0;
  /** The box of its own texels (x0, y0, x1, y1), then of the texels painted. */
  private own = [W, H, -1, -1];
  private bounds = [W, H, -1, -1];
  private readonly streak = new LatticeNoise(SEED_STREAK);
  private readonly streakDark = new LatticeNoise(SEED_STREAK_DARK);
  private readonly rgba = [0, 0, 0, 0];

  constructor(
    readonly model: FieldModel,
    readonly frames: readonly (FieldFrame | null | undefined)[],
  ) {
    if (!frames[model.self.variant]) this.finish(null);
  }

  /** Paint on while `more()` says so; true once the picture is done. */
  run(more: () => boolean): boolean {
    if (this.done) return true;
    if (!this.s) {
      this.s = scratch();
      this.s.owner.fill(-1);
      this.s.own.fill(0);
      this.s.across.fill(0);
      this.s.near.fill(0);
      this.s.data.fill(0);
    }
    const [x0, y0, x1, y1] = this.own,
      // the skirt and the colours reach SKIRT texels round its own
      c0 = Math.max(0, x0 - SKIRT),
      c1 = Math.min(W - 1, x1 + SKIRT),
      r0 = Math.max(0, y0 - SKIRT),
      r1 = Math.min(H - 1, y1 + SKIRT);
    for (;;) {
      if (this.phase === 0) {
        if (this.at >= W) {
          if (this.own[2] < 0) {
            this.finish(null);
            return true;
          }
          this.phase = 1;
          this.at = 0;
          return this.run(more);
        }
        this.paintColumn(this.at++);
      } else if (this.phase === 1) {
        if (this.at > y1 - y0) this.next();
        else this.across(y0 + this.at++, c0, c1);
      } else if (this.phase === 2) {
        if (this.at > c1 - c0) this.next();
        else this.down(c0 + this.at++, r0, r1);
      } else if (this.phase === 3) {
        if (this.at > r1 - r0) {
          this.finish(this.crop());
          return true;
        }
        this.colourRow(r0 + this.at++, c0, c1);
      }
      if (!more()) return false;
    }
  }
  private next() {
    this.phase++;
    this.at = 0;
  }

  /** Give the scratch back without a picture (the job is not wanted any more). */
  cancel() {
    if (!this.done) this.finish(null);
  }

  private finish(result: FieldPicture | null) {
    this.result = result;
    this.done = true;
    if (this.s) spare.push(this.s);
    this.s = null;
  }

  /** World px of the tile's centre. */
  private get cx() {
    return (this.model.site.x - this.model.site.y) * 32;
  }
  private get cy() {
    return (this.model.site.x + this.model.site.y) * 16;
  }

  /**
   * One column, front to back: each ground point stands its stalks' height over the ground and
   * fills the rows from its top down to what is drawn in front of it already.
   */
  private paintColumn(c: number) {
    const m = this.model,
      s = this.s!,
      { x: X, y: Y } = m.site,
      [rxp, rxn, ryp, ryn] = m.reach,
      wx = this.cx + BOX_LEFT + (c + 0.5) / FIELD_RES,
      d = wx / 32,
      ld = d - (X - Y),
      // the stretch of the column where this tile's own field can lie (u, v from its centre)
      lo = Math.max(-2 * rxn - ld, -2 * ryn + ld),
      hi = Math.min(2 * rxp - ld, 2 * ryp + ld);
    if (lo > hi) return;
    // rows are counted on the world's texel grid, the same for every tile's picture
    const row0 = (this.cy + BOX_TOP) * FIELD_RES,
      kHi = Math.floor((X + Y + hi + m.hide) * STEPS),
      kLo = Math.ceil((X + Y + lo - 0.15) * STEPS);
    let ymin = Infinity,
      prev = 0;
    for (let k = kHi; k >= kLo; k--) {
      const sk = k / STEPS,
        tx = (sk + d) / 2,
        ty = (sk - d) / 2;
      m.read(tx, ty);
      const zf = m.height,
        rise = zf - prev;
      prev = zf;
      const row = Math.floor((16 * sk - zf) * FIELD_RES) - row0;
      if (ymin === Infinity) ymin = row + 1;
      if (row >= ymin) continue;
      const owner = m.owner;
      if (owner && m.cover > 0) {
        // the front of the field where it rises toward the camera: its stalks in the shade of
        // their own heads, darker toward the ground
        const face = rise > 0.02 && ymin - row > 1 ? sstep(rise / 0.5) : 0,
          to = Math.min(H, ymin);
        if (owner === m.self && row < to) {
          const o = this.own;
          if (c < o[0]) o[0] = c;
          if (c > o[2]) o[2] = c;
          if (Math.max(0, row) < o[1]) o[1] = Math.max(0, row);
          if (to - 1 > o[3]) o[3] = to - 1;
        }
        for (let r = Math.max(0, row); r < to; r++) {
          const t = r * W + c;
          if (owner === m.self) s.own[t] = 1;
          s.owner[t] = owner.id;
          s.step[t] = k;
          s.height[t] = zf;
          s.cover[t] = m.cover;
          s.face[t] = face;
          s.depth[t] = face ? (r - row) / (ymin - row) : 0;
        }
      }
      ymin = row;
    }
  }

  /** The skirt along row r (columns c0 to c1): the texels within SKIRT of its own along it. */
  private across(r: number, c0: number, c1: number) {
    const s = this.s!,
      o = r * W;
    let last = -Infinity;
    for (let c = c0; c <= c1; c++) {
      if (s.own[o + c]) last = c;
      if (c - last <= SKIRT) s.across[o + c] = 1;
    }
    last = Infinity;
    for (let c = c1; c >= c0; c--) {
      if (s.own[o + c]) last = c;
      if (last - c <= SKIRT) s.across[o + c] = 1;
    }
  }
  /** The skirt down column c (rows r0 to r1): within SKIRT of the row pass's texels down it. */
  private down(c: number, r0: number, r1: number) {
    const s = this.s!;
    let last = -Infinity;
    for (let r = r0; r <= r1; r++) {
      if (s.across[r * W + c]) last = r;
      if (r - last <= SKIRT) s.near[r * W + c] = 1;
    }
    last = Infinity;
    for (let r = r1; r >= r0; r--) {
      if (s.across[r * W + c]) last = r;
      if (last - r <= SKIRT) s.near[r * W + c] = 1;
    }
  }

  /** The colours of one row (columns c0 to c1): its own texels and its skirt's opaque ones. */
  private colourRow(r: number, c0: number, c1: number) {
    const s = this.s!,
      m = this.model,
      rgba = this.rgba,
      b = this.bounds;
    for (let c = c0; c <= c1; c++) {
      const t = r * W + c,
        id = s.owner[t];
      if (id < 0 || !(s.own[t] || (s.near[t] && s.cover[t] >= 1))) continue;
      const cand = m.candidate(id)!,
        f = this.frames[cand.variant];
      if (!f) {
        s.own[t] = 0;
        continue;
      }
      const wx = this.cx + BOX_LEFT + (c + 0.5) / FIELD_RES,
        sk = s.step[t] / STEPS,
        d = wx / 32,
        // the point's top, in world px: where its streak is read
        wy = 16 * sk - s.height[t];
      this.shade(
        f,
        (sk + d) / 2 - cand.x,
        (sk - d) / 2 - cand.y,
        wx,
        wy,
        s.cover[t],
        s.face[t],
        s.depth[t],
      );
      // the skirt only repeats opaque texels: it never doubles a translucent one
      if (!s.own[t] && rgba[3] < 255) continue;
      if (!rgba[3]) {
        s.own[t] = 0;
        continue;
      }
      const o = t * 4;
      s.data[o] = rgba[0];
      s.data[o + 1] = rgba[1];
      s.data[o + 2] = rgba[2];
      s.data[o + 3] = rgba[3];
      if (c < b[0]) b[0] = c;
      if (c > b[2]) b[2] = c;
      if (r < b[1]) b[1] = r;
      if (r > b[3]) b[3] = r;
    }
  }

  /**
   * One texel's colour into `rgba`: the variant's picture at (a, b) tiles from its tile's centre,
   * mirrored back from MIRROR, with the stalks' short vertical streaks (read at world px wx, wy),
   * the front's shade (`face`, `depth` down from its top), alpha `cover`, under the caps.
   */
  private shade(
    f: FieldFrame,
    a: number,
    b: number,
    wx: number,
    wy: number,
    cover: number,
    face: number,
    depth: number,
  ) {
    const out = this.rgba;
    a = a > MIRROR ? 2 * MIRROR - a : a < -MIRROR ? -2 * MIRROR - a : a;
    b = b > MIRROR ? 2 * MIRROR - b : b < -MIRROR ? -2 * MIRROR - b : b;
    sample(
      f,
      f.anchorX + (a - b) * 32 * f.density,
      f.anchorY + ((a + b) * 16 - LIFT) * f.density,
      out,
    );
    if (!out[3]) return;
    const st =
      0.8 +
      0.42 * this.streak.at(wx * 1.45, wy * 0.36) -
      0.12 * sstep((this.streakDark.at(wx * 0.9, wy * 0.22) - 0.62) / 0.1);
    let r = out[0] * st,
      g = out[1] * st,
      bl = out[2] * st * 0.96;
    if (face > 0) {
      const k = 1 - face * (0.18 + 0.3 * depth);
      r *= k * (1 - 0.06 * face);
      g *= k * (1 - 0.1 * face);
      bl *= k * (1 - 0.22 * face);
    }
    capColour(r, g, bl, out);
    out[3] = Math.round(cover * out[3]);
  }

  /** The painted texels, cropped to whole GRID world px. */
  private crop(): FieldPicture | null {
    const s = this.s!,
      [bx0, by0, bx1, by1] = this.bounds;
    if (bx1 < 0) return null;
    const g = GRID * FIELD_RES,
      x0 = Math.floor(bx0 / g) * g,
      y0 = Math.floor(by0 / g) * g,
      x1 = Math.min(W, Math.ceil((bx1 + 1) / g) * g),
      y1 = Math.min(H, Math.ceil((by1 + 1) / g) * g),
      w = x1 - x0,
      h = y1 - y0,
      data = new Uint8ClampedArray(w * h * 4),
      own = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) {
      const from = (y0 + r) * W;
      data.set(s.data.subarray((from + x0) * 4, (from + x1) * 4), r * w * 4);
      own.set(s.own.subarray(from + x0, from + x1), r * w);
    }
    return {
      data,
      width: w,
      height: h,
      left: BOX_LEFT + x0 / FIELD_RES,
      top: BOX_TOP + y0 / FIELD_RES,
      own,
    };
  }
}

/** The picture of the field tile at the middle of `site`; null without its variant's picture. */
export function fieldPicture(site: FieldSite, frames: readonly (FieldFrame | null | undefined)[]) {
  return new FieldModel(site).picture(frames);
}

/**
 * The frame's colour round texel point (x, y): the mean of the texels a texel of the picture
 * covers (density / FIELD_RES across), weighted by their alpha, and their mean alpha.
 */
function sample(f: FieldFrame, x: number, y: number, out: number[]) {
  const k = Math.max(1, Math.round(f.density / FIELD_RES)),
    x0 = Math.floor(x - k / 2 + 0.5),
    y0 = Math.floor(y - k / 2 + 0.5);
  let r = 0,
    g = 0,
    b = 0,
    a = 0;
  for (let j = y0; j < y0 + k; j++)
    for (let i = x0; i < x0 + k; i++) {
      if (i < 0 || j < 0 || i >= f.width || j >= f.height) continue;
      const o = (j * f.width + i) * 4,
        w = f.data[o + 3];
      r += f.data[o] * w;
      g += f.data[o + 1] * w;
      b += f.data[o + 2] * w;
      a += w;
    }
  if (!a) {
    out[0] = out[1] = out[2] = out[3] = 0;
    return;
  }
  out[0] = r / a;
  out[1] = g / a;
  out[2] = b / a;
  out[3] = a / (k * k);
}

/** The cursor white, and where a colour over it ends up at most (tools/atlas-cap.mjs). */
const WHITE = PAL.white,
  WHITE_CAP = WHITE.map((c) => c - 1);
/** What "as strong as the selection amber" means (hue in degrees), and where it is toned to. */
const AMBER = { hueFrom: 25, hueTo: 50, saturation: 0.62, value: 0.85 },
  AMBER_TONE = { saturation: 0.6, value: 0.88 };

/** Hue (degrees), saturation and value of a colour in 0..255. */
export function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b),
    d = max - Math.min(r, g, b);
  return [hue(r, g, b), d === 0 ? 0 : d / max, max / 255];
}
/** The hue of a colour in 0..255, in degrees (0 for a grey). */
function hue(r: number, g: number, b: number) {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b,
    d = max - (r < g ? (r < b ? r : b) : g < b ? g : b);
  if (d === 0) return 0;
  return (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
}
/** Whether a colour is at or over the cursor white in all three channels. */
export function overWhite(r: number, g: number, b: number) {
  return r >= WHITE[0] && g >= WHITE[1] && b >= WHITE[2];
}
/** Whether a colour is as strong as the selection amber. */
export function amberStrong(r: number, g: number, b: number) {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b,
    min = r < g ? (r < b ? r : b) : g < b ? g : b;
  if (max < AMBER.value * 255 || max - min < AMBER.saturation * max) return false;
  const h = hue(r, g, b);
  return h >= AMBER.hueFrom && h <= AMBER.hueTo;
}

/**
 * A colour brought under the caps every atlas texel keeps (docs/art-direction/README.md section
 * 1, tools/atlas-cap.mjs steps 3 and 4), rounded into out[0..2]: one at or over the cursor white
 * scaled under it, one as strong as the selection amber toned to its saturation and value, both
 * keeping their hue.
 */
function capColour(r: number, g: number, b: number, out: number[]) {
  r = Math.min(255, Math.round(r));
  g = Math.min(255, Math.round(g));
  b = Math.min(255, Math.round(b));
  if (overWhite(r, g, b)) {
    const f = Math.min(WHITE_CAP[0] / r, WHITE_CAP[1] / g, WHITE_CAP[2] / b);
    r = Math.min(WHITE_CAP[0], Math.round(r * f));
    g = Math.min(WHITE_CAP[1], Math.round(g * f));
    b = Math.min(WHITE_CAP[2], Math.round(b * f));
  }
  if (amberStrong(r, g, b)) {
    const max = Math.max(r, g, b),
      h = hue(r, g, b) / 60,
      sat = Math.min((max - Math.min(r, g, b)) / max, AMBER_TONE.saturation),
      val = Math.min(max / 255, AMBER_TONE.value),
      ch = (m: number) => {
        const k = (m + h) % 6;
        return Math.round(255 * val * (1 - sat * Math.max(0, Math.min(1, k, 4 - k))));
      };
    r = ch(5);
    g = ch(3);
    b = ch(1);
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
}
