/**
 * Rolling stock sprites. Every body is drawn as isometric prisms at 13 of the 24 facings (the
 * other 11 are horizontal mirrors, applied at draw time). Bodies come in three sizes: 1, 2 and
 * 3 tiles long; multi-segment plans (engine + tender, Garratt, Meyer) draw one sprite per rigid
 * segment. Medium and large bodies carry no wheels of their own: shared bogie sprites ride under
 * them, placed by the body model.
 */
import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';
import { drawPrism, drawCylinder } from './iso3d';
import {
  DRAWN_FACINGS,
  facingAngle,
  vehicleSpec,
  type BogieKind,
  type SegmentSpec,
} from '../sim/body';
import { content, type LocoDef, type WagonDef } from '../data/content';

const PAINTS: Record<string, RGB[]> = {
  iron: PAL.iron,
  rust: PAL.rust,
  black: [
    [34, 34, 38],
    [46, 46, 50],
    [26, 26, 30],
    [58, 58, 62],
  ],
  green: [
    [44, 70, 50],
    [56, 86, 60],
    [34, 54, 40],
    [70, 100, 74],
  ],
  wood: PAL.timber,
  blue: [
    [40, 62, 96],
    [52, 78, 116],
    [30, 46, 74],
    [70, 98, 138],
  ],
  red: [
    [124, 44, 40],
    [146, 56, 50],
    [96, 34, 30],
    [168, 72, 62],
  ],
  yellow: [
    [178, 140, 50],
    [200, 160, 64],
    [146, 112, 38],
    [216, 180, 90],
  ],
  brown: [
    [96, 64, 44],
    [116, 80, 56],
    [74, 48, 32],
    [136, 98, 70],
  ],
  silver: [
    [150, 156, 166],
    [172, 178, 188],
    [124, 130, 140],
    [196, 202, 212],
  ],
  orange: [
    [190, 100, 40],
    [214, 122, 52],
    [150, 78, 30],
    [232, 146, 74],
  ],
  white: [
    [206, 204, 196],
    [224, 222, 214],
    [180, 178, 170],
    [236, 234, 228],
  ],
};
const WHEELS: RGB[] = [
  [30, 30, 32],
  [44, 44, 48],
  [22, 22, 24],
];
const COAL: RGB[] = [
  [40, 40, 42],
  [52, 52, 56],
  [30, 30, 32],
];

/** Sprite canvas for a segment `L` tiles long: room for the worst facing plus height. */
function canvasFor(L: number) {
  const W = Math.ceil(L * 46) + 40;
  const H = Math.ceil(L * 23) + 58;
  return { W, H, OX: Math.floor(W / 2), OY: H - 14 };
}

/** One sprite in the making: a pixel buffer with a heading and drawing helpers in body space. */
class Frame {
  readonly b: PixelBuf;
  readonly ox: number;
  readonly oy: number;
  constructor(
    readonly L: number,
    readonly a: number,
    readonly seed: number,
  ) {
    const c = canvasFor(L);
    this.b = new PixelBuf(c.W, c.H);
    this.ox = c.OX;
    this.oy = c.OY;
  }
  /** tile-space offset of a body point: l along the heading (front = +), w across */
  along(l: number, w: number) {
    return {
      x: Math.cos(this.a) * l - Math.sin(this.a) * w,
      y: Math.sin(this.a) * l + Math.cos(this.a) * w,
    };
  }
  px(l: number, w: number, z = 0) {
    const p = this.along(l, w);
    return {
      x: Math.round(this.ox + (p.x - p.y) * 32),
      y: Math.round(this.oy + (p.x + p.y) * 16) - z,
    };
  }
  /** is the body point on the side facing the viewer? */
  visible(l: number, w: number) {
    const p = this.along(l, w);
    const c = this.along(l, 0);
    return p.x + p.y > c.x + c.y;
  }
  prism(o: {
    l: number;
    w?: number;
    len: number;
    wid: number;
    h: number;
    z0?: number;
    top: RGB[];
    side: RGB[];
    ridge?: number;
    roof?: RGB[];
    seed?: number;
  }) {
    const c = this.along(o.l, o.w ?? 0);
    drawPrism(this.b, {
      ox: this.ox,
      oy: this.oy,
      cx: c.x,
      cy: c.y,
      angle: this.a,
      len: o.len,
      wid: o.wid,
      h: o.h,
      z0: o.z0 ?? 0,
      top: o.top,
      side: o.side,
      seed: this.seed + (o.seed ?? 0),
      ridge: o.ridge,
      roof: o.roof,
    });
  }
  cyl(l: number, w: number, r: number, z0: number, h: number, side: RGB[], top: RGB, seed = 0) {
    const c = this.along(l, w);
    drawCylinder(this.b, this.ox, this.oy, c.x, c.y, r, z0, h, side, top, this.seed + seed);
  }
  dot(l: number, w: number, z: number, c: RGB, size = 2) {
    const p = this.px(l, w, z);
    this.b.rect(p.x - Math.floor(size / 2), p.y - Math.floor(size / 2), size, size, c);
  }
  /** a horizontal cylinder along the body approximated by three stacked prisms */
  boiler(l0: number, l1: number, r: number, z0: number, paint: RGB[], seed = 0) {
    const len = l1 - l0;
    const mid = (l0 + l1) / 2;
    const w = r * 2;
    this.prism({ l: mid, len, wid: w * 0.75, h: 1, z0: z0, top: paint, side: paint, seed });
    this.prism({
      l: mid,
      len,
      wid: w,
      h: r * 40,
      z0: z0 + 1,
      top: paint,
      side: paint,
      seed: seed + 1,
    });
    this.prism({
      l: mid,
      len,
      wid: w * 0.6,
      h: 3,
      z0: z0 + 1 + r * 40,
      top: paint.map((c) => shade(c, 1.15)),
      side: paint,
      seed: seed + 2,
    });
  }
  /** a cab: box with a pitched roof and amber windows on the visible walls */
  cab(
    l0: number,
    l1: number,
    wid: number,
    h: number,
    z0: number,
    paint: RGB[],
    roof: RGB[],
    windows = true,
  ) {
    const mid = (l0 + l1) / 2;
    this.prism({
      l: mid,
      len: l1 - l0,
      wid,
      h,
      z0,
      top: PAL.iron,
      side: paint,
      ridge: 3,
      roof,
      seed: 7,
    });
    if (windows) this.windows([mid], wid / 2, z0 + h - 2, 4);
  }
  /** amber windows on whichever side wall faces the viewer */
  windows(ls: number[], w: number, z: number, hgt = 3) {
    for (const l of ls) {
      for (const side of [-w, w]) {
        if (!this.visible(l, side)) continue;
        const q = this.px(l, side, z);
        this.b.rect(q.x - 1, q.y - hgt, 2, hgt, PAL.amberDark);
        this.b.set(q.x - 1, q.y - hgt, PAL.amber);
      }
    }
  }
  chimney(l: number, z0: number, h: number, r = 0.045) {
    this.cyl(l, 0, r, z0, h, [PAL.iron[2], PAL.iron[0], PAL.iron[1]], PAL.iron[0], 15);
  }
  dome(l: number, z0: number, h = 4, r = 0.05) {
    this.cyl(l, 0, r, z0, h, [PAL.brass, shade(PAL.brass, 0.8)], shade(PAL.brass, 1.1), 16);
  }
  lamp(l: number, z: number) {
    const p = this.px(l, 0, z);
    this.b.rect(p.x - 1, p.y - 1, 2, 2, PAL.amber);
  }
  pantograph(l: number, zRoof: number, wide = false) {
    const base = this.px(l, 0, zRoof);
    const top = this.px(l, 0, zRoof + 9);
    this.b.line(base.x - 2, base.y, top.x + 1, top.y, PAL.iron[3]);
    this.b.line(base.x + 2, base.y, top.x - 1, top.y, PAL.iron[3]);
    const s = wide ? 0.11 : 0.08;
    const a = this.px(l, -s, zRoof + 9);
    const c = this.px(l, s, zRoof + 9);
    this.b.line(a.x, a.y, c.x, c.y, PAL.iron[3]);
  }
  /** underframe bar for bodies whose wheels are separate bogie sprites */
  underframe(len: number, z0 = 3) {
    this.prism({ l: 0, len, wid: 0.18, h: 2, z0, top: WHEELS, side: WHEELS, seed: 3 });
    for (const end of [-len / 2, len / 2]) this.dot(end, 0, z0 + 1, PAL.iron[1], 2);
  }
  /** chassis with baked wheels for one-tile stock */
  chassis(len: number, big = false) {
    this.prism({ l: 0, len, wid: 0.2, h: 5, z0: 0, top: WHEELS, side: WHEELS, seed: 3 });
    const xs = big ? [-len * 0.3, len * 0.28] : [-len * 0.34, -len * 0.05, len * 0.24];
    for (const l of xs)
      for (const w of [-0.11, 0.11]) {
        if (!this.visible(l, w)) continue;
        const p = this.px(l, w, 2);
        const r = big && l < 0 ? 3 : 2;
        this.b.rect(p.x - r + 1, p.y - r, r * 2 - 1, r * 2, WHEELS[2]);
        this.b.set(p.x, p.y - 1, PAL.iron[3]);
      }
  }
  finish(threshold = 190) {
    this.b.outline(PAL.outline, threshold);
    return this.b;
  }
}

// ------------------------------------------------------------------ locomotive parts

type PartDrawer = (f: Frame, L: number, paint: RGB[]) => void;

const steamEarly: PartDrawer = (f, L, paint) => {
  f.chassis(L * 0.9, true);
  f.prism({ l: 0, len: L * 0.92, wid: 0.28, h: 2, z0: 5, top: PAL.iron, side: PAL.iron, seed: 1 });
  f.boiler(-0.05, L * 0.4, 0.09, 7, paint, 2);
  f.chimney(L * 0.33, 14, 13, 0.04);
  f.dome(0.1, 15, 3, 0.04);
  // open footplate with a low rail, coal bunker at the rear
  f.prism({
    l: -L * 0.3,
    len: L * 0.28,
    wid: 0.26,
    h: 4,
    z0: 7,
    top: PAL.timber,
    side: PAL.timber,
    seed: 4,
  });
  f.prism({
    l: -L * 0.42,
    len: L * 0.08,
    wid: 0.22,
    h: 7,
    z0: 7,
    top: COAL,
    side: PAL.iron,
    seed: 5,
  });
  f.lamp(L * 0.44, 12);
};

const steamTank: PartDrawer = (f, L, paint) => {
  f.chassis(L * 0.9);
  f.prism({ l: 0, len: L * 0.94, wid: 0.3, h: 2, z0: 5, top: PAL.iron, side: PAL.iron, seed: 1 });
  f.boiler(-0.12, L * 0.42, 0.1, 7, paint, 2);
  // side tanks flanking the boiler
  for (const w of [-0.12, 0.12])
    f.prism({
      l: 0.08,
      w,
      len: L * 0.42,
      wid: 0.07,
      h: 9,
      z0: 7,
      top: paint,
      side: paint,
      seed: 6,
    });
  f.prism({
    l: L * 0.4,
    len: 0.06,
    wid: 0.21,
    h: 11,
    z0: 7,
    top: PAL.iron,
    side: [PAL.iron[2], PAL.iron[0]],
    seed: 8,
  });
  f.chimney(L * 0.36, 17, 8);
  f.dome(L * 0.1, 18);
  f.cab(-L * 0.36, -L * 0.1, 0.28, 16, 7, paint, [PAL.iron[0], PAL.iron[2]]);
  f.prism({ l: -L * 0.42, len: L * 0.1, wid: 0.26, h: 9, z0: 7, top: COAL, side: paint, seed: 9 });
  f.lamp(L * 0.46, 13);
};

/** tender-plan engine: long boiler, cab at the rear end (the tender follows as its own segment) */
const steamEngine: PartDrawer = (f, L, paint) => {
  f.underframe(L * 0.96, 3);
  f.prism({ l: 0, len: L * 0.96, wid: 0.3, h: 2, z0: 5, top: PAL.iron, side: PAL.iron, seed: 1 });
  f.boiler(-L * 0.18, L * 0.44, 0.11, 7, paint, 2);
  f.prism({
    l: L * 0.43,
    len: 0.06,
    wid: 0.23,
    h: 12,
    z0: 7,
    top: PAL.iron,
    side: [PAL.iron[2], PAL.iron[0]],
    seed: 8,
  });
  f.chimney(L * 0.39, 18, 8);
  f.dome(L * 0.15, 19);
  f.dome(-L * 0.02, 19, 3, 0.04);
  f.cab(-L * 0.46, -L * 0.2, 0.3, 17, 7, paint, [PAL.iron[0], PAL.iron[2]]);
  // cylinders beside the smokebox
  for (const w of [-0.14, 0.14])
    f.prism({
      l: L * 0.3,
      w,
      len: 0.14,
      wid: 0.06,
      h: 5,
      z0: 4,
      top: PAL.iron,
      side: PAL.iron,
      seed: 11,
    });
  f.lamp(L * 0.47, 14);
};
const steamStreamEngine: PartDrawer = (f, L, paint) => {
  f.underframe(L * 0.96, 3);
  // skirted casing: low wide base, sloped nose built from stepped prisms
  f.prism({
    l: -L * 0.05,
    len: L * 0.86,
    wid: 0.32,
    h: 8,
    z0: 4,
    top: paint,
    side: paint,
    seed: 1,
  });
  f.prism({
    l: -L * 0.1,
    len: L * 0.72,
    wid: 0.24,
    h: 8,
    z0: 12,
    top: paint.map((c) => shade(c, 1.1)),
    side: paint,
    seed: 2,
  });
  f.prism({
    l: -L * 0.14,
    len: L * 0.56,
    wid: 0.16,
    h: 4,
    z0: 20,
    top: paint.map((c) => shade(c, 1.2)),
    side: paint,
    seed: 3,
  });
  f.prism({ l: L * 0.4, len: L * 0.1, wid: 0.28, h: 6, z0: 4, top: paint, side: paint, seed: 4 });
  f.prism({ l: L * 0.36, len: L * 0.1, wid: 0.2, h: 5, z0: 10, top: paint, side: paint, seed: 5 });
  // speed stripe
  for (let i = -8; i <= 8; i++) {
    const l = i * (L * 0.05);
    for (const w of [-0.16, 0.16])
      if (f.visible(l, w)) f.b.set(f.px(l, w, 11).x, f.px(l, w, 11).y, PAL.white);
  }
  f.cab(-L * 0.44, -L * 0.24, 0.3, 17, 7, paint, [PAL.iron[0], PAL.iron[2]]);
  f.chimney(L * 0.3, 24, 3, 0.04);
  f.lamp(L * 0.47, 12);
};
const tender: PartDrawer = (f, L, paint) => {
  f.underframe(L * 0.94, 3);
  f.prism({ l: 0, len: L * 0.94, wid: 0.3, h: 11, z0: 5, top: paint, side: paint, seed: 1 });
  f.prism({ l: L * 0.1, len: L * 0.6, wid: 0.22, h: 4, z0: 16, top: COAL, side: COAL, seed: 2 });
  f.prism({
    l: -L * 0.3,
    len: L * 0.3,
    wid: 0.3,
    h: 3,
    z0: 16,
    top: paint.map((c) => shade(c, 1.1)),
    side: paint,
    seed: 3,
  });
};
/** Garratt engine unit: a water tank or bunker on a powered frame */
const garrattEngine: PartDrawer = (f, L, paint) => {
  f.underframe(L * 0.96, 3);
  f.prism({ l: 0, len: L * 0.94, wid: 0.28, h: 3, z0: 5, top: PAL.iron, side: PAL.iron, seed: 1 });
  f.prism({
    l: L * 0.06,
    len: L * 0.7,
    wid: 0.28,
    h: 12,
    z0: 8,
    top: paint.map((c) => shade(c, 1.08)),
    side: paint,
    seed: 2,
  });
  for (const w of [-0.15, 0.15])
    f.prism({
      l: L * 0.34,
      w,
      len: 0.14,
      wid: 0.06,
      h: 5,
      z0: 4,
      top: PAL.iron,
      side: PAL.iron,
      seed: 3,
    });
  f.lamp(L * 0.47, 10);
};
/** Garratt cradle: boiler and cab slung high between the engine units */
const garrattCradle: PartDrawer = (f, L, paint) => {
  f.prism({ l: 0, len: L * 0.98, wid: 0.3, h: 3, z0: 9, top: PAL.iron, side: PAL.iron, seed: 1 });
  f.boiler(-L * 0.15, L * 0.46, 0.11, 12, paint, 2);
  f.prism({
    l: L * 0.46,
    len: 0.05,
    wid: 0.23,
    h: 12,
    z0: 12,
    top: PAL.iron,
    side: [PAL.iron[2], PAL.iron[0]],
    seed: 8,
  });
  f.chimney(L * 0.42, 23, 6);
  f.dome(L * 0.12, 24);
  f.cab(-L * 0.46, -L * 0.18, 0.3, 17, 12, paint, [PAL.iron[0], PAL.iron[2]]);
};
/** Meyer frame: one long boiler and cab on two swivelling engine units */
const meyerFrame: PartDrawer = (f, L, paint) => {
  f.prism({ l: 0, len: L * 0.98, wid: 0.3, h: 3, z0: 6, top: PAL.iron, side: PAL.iron, seed: 1 });
  f.boiler(-L * 0.14, L * 0.44, 0.12, 9, paint, 2);
  f.prism({
    l: L * 0.45,
    len: 0.06,
    wid: 0.25,
    h: 13,
    z0: 9,
    top: PAL.iron,
    side: [PAL.iron[2], PAL.iron[0]],
    seed: 8,
  });
  f.chimney(L * 0.41, 21, 8);
  f.dome(L * 0.2, 22);
  f.dome(L * 0.02, 22, 3, 0.04);
  f.cab(-L * 0.3, -L * 0.16, 0.32, 18, 9, paint, [PAL.iron[0], PAL.iron[2]]);
  // bunker behind the cab
  f.prism({ l: -L * 0.4, len: L * 0.18, wid: 0.3, h: 12, z0: 9, top: COAL, side: paint, seed: 9 });
  f.lamp(L * 0.48, 16);
};
const dieselSwitcher: PartDrawer = (f, L, paint) => {
  f.chassis(L * 0.9);
  f.prism({ l: 0, len: L * 0.94, wid: 0.3, h: 3, z0: 5, top: PAL.iron, side: PAL.iron, seed: 1 });
  f.prism({
    l: L * 0.1,
    len: L * 0.56,
    wid: 0.22,
    h: 9,
    z0: 8,
    top: paint.map((c) => shade(c, 1.1)),
    side: paint,
    seed: 2,
  });
  f.cab(-L * 0.4, -L * 0.18, 0.3, 15, 8, paint, [PAL.iron[0], PAL.iron[2]]);
  f.cyl(L * 0.2, 0, 0.035, 17, 3, PAL.iron, PAL.iron[0], 4);
  f.lamp(L * 0.45, 13);
};
const dieselCab: PartDrawer = (f, L, paint) => {
  f.underframe(L * 0.96, 3);
  f.prism({
    l: -L * 0.06,
    len: L * 0.84,
    wid: 0.3,
    h: 14,
    z0: 5,
    top: PAL.iron,
    side: paint,
    seed: 1,
  });
  // rounded nose: stepped prisms
  f.prism({ l: L * 0.4, len: L * 0.12, wid: 0.28, h: 9, z0: 5, top: paint, side: paint, seed: 2 });
  f.prism({
    l: L * 0.36,
    len: L * 0.12,
    wid: 0.24,
    h: 5,
    z0: 14,
    top: paint,
    side: paint,
    seed: 3,
  });
  f.prism({
    l: -L * 0.02,
    len: L * 0.7,
    wid: 0.22,
    h: 3,
    z0: 19,
    top: paint.map((c) => shade(c, 1.15)),
    side: paint,
    seed: 4,
  });
  // cab windows near the nose and a side stripe
  f.windows([L * 0.28], 0.15, 18, 4);
  for (let i = -7; i <= 6; i++) {
    const l = i * (L * 0.055);
    for (const w of [-0.155, 0.155])
      if (f.visible(l, w)) f.b.set(f.px(l, w, 12).x, f.px(l, w, 12).y, PAL.white);
  }
  // roof fans
  for (const l of [-L * 0.25, -L * 0.1, L * 0.05])
    f.cyl(l, 0, 0.035, 22, 1, PAL.iron, PAL.iron[3], 5);
  f.lamp(L * 0.47, 12);
};
const dieselHood: PartDrawer = (f, L, paint) => {
  f.underframe(L * 0.96, 3);
  f.prism({ l: 0, len: L * 0.96, wid: 0.32, h: 3, z0: 5, top: PAL.iron, side: PAL.iron, seed: 1 });
  // long hood, cab, short hood
  f.prism({
    l: L * 0.06,
    len: L * 0.62,
    wid: 0.22,
    h: 12,
    z0: 8,
    top: paint.map((c) => shade(c, 1.1)),
    side: paint,
    seed: 2,
  });
  f.cab(-L * 0.36, -L * 0.24, 0.3, 15, 8, paint, [PAL.iron[0], PAL.iron[2]]);
  f.prism({
    l: -L * 0.43,
    len: L * 0.12,
    wid: 0.22,
    h: 9,
    z0: 8,
    top: paint,
    side: paint,
    seed: 3,
  });
  for (const l of [L * 0.2, L * 0.02, -L * 0.14])
    f.cyl(l, 0, 0.035, 20, 1, PAL.iron, PAL.iron[3], 5);
  // exhaust stack
  f.cyl(L * 0.3, 0, 0.03, 20, 3, PAL.iron, PAL.iron[0], 6);
  for (const w of [-0.16, 0.16])
    if (f.visible(0, w)) f.b.set(f.px(L * 0.36, w, 10).x, f.px(L * 0.36, w, 10).y, PAL.amber);
  f.lamp(L * 0.47, 11);
  f.lamp(-L * 0.48, 11);
};
const electricBox: PartDrawer = (f, L, paint) => {
  if (L <= 1.01) f.chassis(L * 0.9);
  else f.underframe(L * 0.96, 3);
  f.prism({ l: 0, len: L * 0.92, wid: 0.3, h: 14, z0: 5, top: PAL.iron, side: paint, seed: 1 });
  f.prism({
    l: 0,
    len: L * 0.8,
    wid: 0.22,
    h: 3,
    z0: 19,
    top: paint.map((c) => shade(c, 1.15)),
    side: paint,
    seed: 2,
  });
  f.windows([L * 0.36, -L * 0.36], 0.15, 18, 4);
  for (let i = -6; i <= 6; i++) {
    const l = i * (L * 0.06);
    for (const w of [-0.155, 0.155])
      if (f.visible(l, w)) f.b.set(f.px(l, w, 11).x, f.px(l, w, 11).y, PAL.amber);
  }
  if (L > 1.01) {
    f.pantograph(L * 0.22, 22);
    f.pantograph(-L * 0.22, 22);
  } else f.pantograph(0, 22);
  f.lamp(L * 0.46, 12);
  f.lamp(-L * 0.46, 12);
};
const crocNose: PartDrawer = (f, L, paint) => {
  f.underframe(L * 0.96, 3);
  f.prism({ l: 0, len: L * 0.96, wid: 0.28, h: 3, z0: 5, top: PAL.iron, side: PAL.iron, seed: 1 });
  f.prism({
    l: L * 0.02,
    len: L * 0.86,
    wid: 0.22,
    h: 9,
    z0: 8,
    top: paint.map((c) => shade(c, 1.1)),
    side: paint,
    seed: 2,
  });
  for (const w of [-0.14, 0.14])
    f.prism({
      l: L * 0.1,
      w,
      len: L * 0.5,
      wid: 0.05,
      h: 3,
      z0: 6,
      top: PAL.iron,
      side: PAL.iron,
      seed: 3,
    });
  f.lamp(L * 0.47, 12);
};
const crocCentre: PartDrawer = (f, L, paint) => {
  f.prism({ l: 0, len: L * 0.98, wid: 0.3, h: 3, z0: 5, top: PAL.iron, side: PAL.iron, seed: 1 });
  f.prism({ l: 0, len: L * 0.9, wid: 0.3, h: 15, z0: 8, top: PAL.iron, side: paint, seed: 2 });
  f.prism({
    l: 0,
    len: L * 0.8,
    wid: 0.22,
    h: 3,
    z0: 23,
    top: paint.map((c) => shade(c, 1.15)),
    side: paint,
    seed: 3,
  });
  f.windows([L * 0.3, 0, -L * 0.3], 0.15, 21, 4);
  f.pantograph(L * 0.22, 26);
  f.pantograph(-L * 0.22, 26);
};
const electricHs: PartDrawer = (f, L, paint) => {
  f.underframe(L * 0.96, 3);
  // low skirted body with a long sloped nose
  f.prism({
    l: -L * 0.08,
    len: L * 0.8,
    wid: 0.3,
    h: 12,
    z0: 4,
    top: PAL.iron,
    side: paint,
    seed: 1,
  });
  f.prism({ l: L * 0.36, len: L * 0.12, wid: 0.28, h: 6, z0: 4, top: paint, side: paint, seed: 2 });
  f.prism({ l: L * 0.44, len: L * 0.08, wid: 0.24, h: 3, z0: 4, top: paint, side: paint, seed: 3 });
  f.prism({ l: L * 0.3, len: L * 0.12, wid: 0.24, h: 5, z0: 10, top: paint, side: paint, seed: 4 });
  f.prism({
    l: -L * 0.1,
    len: L * 0.7,
    wid: 0.22,
    h: 3,
    z0: 16,
    top: paint.map((c) => shade(c, 1.15)),
    side: paint,
    seed: 5,
  });
  f.windows([L * 0.24], 0.14, 15, 3);
  for (let i = -7; i <= 5; i++) {
    const l = i * (L * 0.055);
    for (const w of [-0.155, 0.155])
      if (f.visible(l, w)) f.b.set(f.px(l, w, 9).x, f.px(l, w, 9).y, PAL.white);
  }
  f.pantograph(-L * 0.2, 19, true);
  f.lamp(L * 0.48, 8);
};

/** Which drawer draws which body and part. `body` names are the roster's; parts come from the plan. */
function locoDrawer(body: string, part: string): PartDrawer {
  if (part === 'tender') return tender;
  if (part === 'cradle') return body === 'electric_crocodile' ? crocCentre : garrattCradle;
  if (part === 'engine' && body === 'electric_crocodile') return crocNose;
  if (part === 'engine' && body === 'steam_streamlined') return steamStreamEngine;
  if (part === 'engine' && body.startsWith('steam'))
    return body === 'steam_garratt' ? garrattEngine : steamEngine;
  if (part === 'frame') return meyerFrame;
  switch (body) {
    case 'steam_early':
      return steamEarly;
    case 'steam_std':
      return steamTank;
    case 'steam_streamlined':
      return steamStreamEngine;
    case 'diesel_switcher':
      return dieselSwitcher;
    case 'diesel_cab':
      return dieselCab;
    case 'diesel_hood':
      return dieselHood;
    case 'electric_box':
      return electricBox;
    case 'electric_hs':
      return electricHs;
    case 'electric_crocodile':
      return crocCentre;
    default:
      return steamTank;
  }
}

// ------------------------------------------------------------------ wagons

function wagonBody(body: string, L: number, paint: RGB[], f: Frame, service?: string) {
  if (L <= 1.01) f.chassis(L * 0.9);
  else f.underframe(L * 0.96, 3);
  const len = L * 0.9;
  switch (body) {
    case 'box':
      f.prism({
        l: 0,
        len,
        wid: 0.28,
        h: 13,
        z0: 5,
        top: PAL.iron,
        side: paint,
        ridge: 3,
        roof: [PAL.iron[0], PAL.iron[2], PAL.iron[1]],
        seed: 41,
      });
      // door
      for (const w of [-0.145, 0.145])
        if (f.visible(0, w)) {
          const p = f.px(0, w, 12);
          f.b.rect(p.x - 2, p.y - 6, 4, 7, shade(paint[2], 0.85));
        }
      break;
    case 'van':
      f.prism({
        l: L * 0.08,
        len: len * 0.7,
        wid: 0.28,
        h: 13,
        z0: 5,
        top: PAL.iron,
        side: paint,
        ridge: 3,
        roof: [PAL.iron[0], PAL.iron[2], PAL.iron[1]],
        seed: 41,
      });
      f.prism({
        l: -L * 0.36,
        len: len * 0.22,
        wid: 0.28,
        h: 3,
        z0: 5,
        top: PAL.timber,
        side: PAL.timber,
        seed: 42,
      });
      f.windows([L * 0.08], 0.14, 15, 3);
      f.lamp(-L * 0.46, 9);
      break;
    case 'hopper':
      f.prism({
        l: 0,
        len,
        wid: 0.28,
        h: 10,
        z0: 5,
        top: [PAL.iron[2], PAL.iron[0]],
        side: paint,
        seed: 42,
      });
      f.prism({
        l: 0,
        len,
        wid: 0.28,
        h: 1,
        z0: 15,
        top: paint.map((c) => shade(c, 1.2)),
        side: paint,
        seed: 43,
      });
      if (service === 'coal')
        f.prism({ l: 0, len: len * 0.8, wid: 0.2, h: 3, z0: 15, top: COAL, side: COAL, seed: 44 });
      break;
    case 'cart':
      // service cart: low body with the load it carries for the engine
      f.prism({
        l: 0,
        len,
        wid: 0.26,
        h: 8,
        z0: 5,
        top: [PAL.iron[2], PAL.iron[0]],
        side: paint,
        seed: 42,
      });
      if (service === 'coal')
        f.prism({ l: 0, len: len * 0.8, wid: 0.2, h: 4, z0: 13, top: COAL, side: COAL, seed: 44 });
      else if (service === 'fuel') {
        f.prism({
          l: 0,
          len: len * 0.8,
          wid: 0.18,
          h: 7,
          z0: 12,
          top: paint,
          side: paint,
          seed: 45,
        });
        for (const w of [-0.1, 0.1])
          if (f.visible(0, w)) {
            const p = f.px(0, w, 15);
            f.b.rect(p.x - 3, p.y - 1, 6, 2, PAL.amber);
          }
      } else {
        for (const l of [-len * 0.28, 0, len * 0.28])
          f.prism({
            l,
            len: len * 0.2,
            wid: 0.2,
            h: 6,
            z0: 13,
            top: [PAL.cyan, PAL.cyanDark],
            side: [PAL.cyanDark, PAL.cyan],
            seed: 46,
          });
      }
      break;
    case 'flat':
      f.prism({
        l: 0,
        len: L * 0.94,
        wid: 0.28,
        h: 3,
        z0: 5,
        top: paint.map((c) => shade(c, 1.1)),
        side: paint,
        seed: 44,
      });
      for (const l of [-len * 0.4, 0, len * 0.4])
        for (const w of [-0.13, 0.13]) {
          const p = f.px(l, w, 8);
          f.b.rect(p.x, p.y - 4, 1, 5, PAL.iron[2]);
        }
      break;
    case 'tank':
      f.prism({ l: 0, len: L * 0.8, wid: 0.2, h: 9, z0: 6, top: paint, side: paint, seed: 45 });
      f.prism({
        l: 0,
        len: L * 0.8,
        wid: 0.13,
        h: 3,
        z0: 15,
        top: paint.map((c) => shade(c, 1.2)),
        side: paint,
        seed: 46,
      });
      f.cyl(0, 0, 0.04, 18, 3, [PAL.iron[1], PAL.iron[2]], PAL.iron[3], 47);
      break;
    case 'coach':
      f.prism({ l: 0, len, wid: 0.28, h: 13, z0: 5, top: PAL.iron, side: paint, seed: 48 });
      f.prism({
        l: 0,
        len: len * 0.94,
        wid: 0.22,
        h: 3,
        z0: 18,
        top: paint.map((c) => shade(c, 1.15)),
        side: paint,
        seed: 49,
      });
      {
        const ws: number[] = [];
        const n = Math.round(len / 0.16);
        for (let i = 0; i < n; i++) ws.push(-len / 2 + (len / n) * (i + 0.5));
        f.windows(ws, 0.145, 16, 4);
      }
      break;
  }
}

// ------------------------------------------------------------------ overlays and bogies

function load(kind: string, f: Frame) {
  const grey: RGB[] = [
    [200, 200, 200],
    [230, 230, 230],
    [170, 170, 170],
  ];
  switch (kind) {
    case 'heap':
      f.prism({ l: 0, len: 0.76, wid: 0.2, h: 3, z0: 15, top: grey, side: grey, seed: 51 });
      f.prism({ l: 0, len: 0.5, wid: 0.12, h: 3, z0: 18, top: grey, side: grey, seed: 52 });
      break;
    case 'crates':
      for (const l of [-0.28, 0, 0.28])
        f.prism({ l, len: 0.18, wid: 0.18, h: 6, z0: 8, top: grey, side: grey, seed: 53 });
      break;
    case 'bales':
      for (const l of [-0.3, -0.1, 0.1, 0.3]) {
        f.prism({
          l,
          len: 0.14,
          wid: 0.2,
          h: 5,
          z0: 8,
          top: grey,
          side: grey.map((c) => shade(c, 0.85)),
          seed: 55,
        });
        const q = f.px(l, 0.1, 10);
        f.b.set(q.x, q.y, [120, 120, 120]);
      }
      break;
    case 'logs':
      for (const w of [-0.08, 0.02, 0.1])
        f.prism({
          l: 0,
          w,
          len: 0.8,
          wid: 0.07,
          h: 4,
          z0: w === 0.02 ? 12 : 8,
          top: grey,
          side: grey,
          seed: 54,
        });
      break;
  }
  f.b.outline(PAL.outline, 120);
  return f.b;
}

function bogie(kind: BogieKind, f: Frame) {
  const len = kind === 'bogie' ? 0.3 : kind === 'bogie3' ? 0.44 : 0.7;
  f.prism({ l: 0, len, wid: 0.2, h: 3, z0: 1, top: WHEELS, side: WHEELS, seed: 61 });
  // axles: two, three, or the engine unit's three coupled wheels
  const xs =
    kind === 'bogie' ? [-0.09, 0.09] : kind === 'bogie3' ? [-0.15, 0, 0.15] : [-0.22, 0, 0.22];
  for (const l of xs)
    for (const w of [-0.11, 0.11]) {
      if (!f.visible(l, w)) continue;
      const p = f.px(l, w, 2);
      f.b.rect(p.x - 1, p.y - 2, 3, 4, WHEELS[2]);
      f.b.set(p.x, p.y - 1, PAL.iron[3]);
    }
  if (kind === 'engine_unit') {
    for (const w of [-0.14, 0.14])
      f.prism({
        l: 0.2,
        w,
        len: 0.14,
        wid: 0.05,
        h: 4,
        z0: 2,
        top: PAL.iron,
        side: PAL.iron,
        seed: 62,
      });
  }
  f.b.outline(PAL.outline, 190);
  return f.b;
}

// ------------------------------------------------------------------ atlas

function paintOf(name: string): RGB[] {
  return PAINTS[name] ?? PAINTS.iron;
}

/** Every body/size/paint combination the roster uses, plus an iron fallback per body and size. */
function locoVariants(): { body: string; size: string; paint: string; def: LocoDef }[] {
  const seen = new Map<string, { body: string; size: string; paint: string; def: LocoDef }>();
  for (const d of content.locomotives) {
    const size = d.size ?? 'small';
    for (const paint of [d.paint, 'iron']) {
      const key = `${d.body}|${size}|${paint}`;
      if (!seen.has(key)) seen.set(key, { body: d.body, size, paint, def: { ...d, paint } });
    }
  }
  return [...seen.values()];
}
function wagonVariants(): { body: string; size: string; paint: string; def: WagonDef }[] {
  const seen = new Map<string, { body: string; size: string; paint: string; def: WagonDef }>();
  for (const d of content.wagons) {
    const size = d.size ?? 'small';
    for (const paint of [d.paint, 'iron']) {
      const key = `${d.body}|${size}|${paint}|${d.service ?? ''}`;
      if (!seen.has(key)) seen.set(key, { body: d.body, size, paint, def: { ...d, paint } });
    }
  }
  // the renderer's last-resort frame
  if (!seen.has('flat|small|wood|'))
    seen.set('flat|small|wood|', {
      body: 'flat',
      size: 'small',
      paint: 'wood',
      def: { ...content.wagons[0], body: 'flat', paint: 'wood', size: 'small' },
    });
  return [...seen.values()];
}

/** Locomotive bodies: one atlas group of their own (with 48 facings they no longer fit beside the wagons). */
export function generateRollingAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  const facings = [...DRAWN_FACINGS].sort((a, b) => a - b);
  for (const v of locoVariants()) {
    const spec = vehicleSpec(v.def);
    const parts = new Map<string, SegmentSpec>();
    for (const s of spec.segments) if (!parts.has(s.part)) parts.set(s.part, s);
    for (const [part, seg] of parts)
      for (const fi of facings) {
        const f = new Frame(seg.L, facingAngle(fi), 100 + fi);
        locoDrawer(v.body, part)(f, seg.L, paintOf(v.paint));
        ab.add(
          `rolling/loco_${v.body}_${v.size}_${v.paint}_${part}_f${fi}`,
          f.finish().toImageData(),
          f.ox,
          f.oy,
        );
      }
  }
  return ab.build(4096);
}

/** Wagons, cargo overlays and bogies. */
export function generateWagonAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  const facings = [...DRAWN_FACINGS].sort((a, b) => a - b);
  for (const v of wagonVariants()) {
    const spec = vehicleSpec(v.def);
    for (const fi of facings) {
      const f = new Frame(spec.L, facingAngle(fi), 300 + fi);
      wagonBody(v.body, spec.L, paintOf(v.paint), f, v.def.service);
      ab.add(
        `rolling/wagon_${v.body}_${v.size}_${v.paint}_f${fi}`,
        f.finish().toImageData(),
        f.ox,
        f.oy,
      );
    }
  }
  for (const fi of facings) {
    for (const k of ['heap', 'crates', 'logs', 'bales']) {
      const f = new Frame(1, facingAngle(fi), 500 + fi);
      ab.add(`rolling/load_${k}_f${fi}`, load(k, f).toImageData(), f.ox, f.oy);
    }
    for (const k of ['bogie', 'bogie3', 'engine_unit'] as const) {
      const f = new Frame(1, facingAngle(fi), 600 + fi);
      ab.add(`rolling/${k}_f${fi}`, bogie(k, f).toImageData(), f.ox, f.oy);
    }
  }
  return ab.build(4096);
}
