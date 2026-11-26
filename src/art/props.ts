import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { HALF_W, HALF_H } from '../engine/iso';
import { hash2 } from '../engine/rng';
import { field, fieldRow } from './industry';
import { PAL, shade, type RGB } from './palette';
import { PixelBuf } from './pixels';
import { lightX } from './view';

/**
 * Natural props. Silhouette first, then two or three canopy masses, then material detail in
 * broad clusters under one upper-left light. Every sprite keeps a 1px margin for the contour
 * and three rows below the anchor for a soft ground shadow that touches the trunk base.
 */

const SHADOW_ROWS = 3;
const SHADOW: RGB = [30, 40, 30];

/** Ellipse filled in three lighting bands with 2x2 cluster noise; upper-left is lit. */
function mass(
  b: PixelBuf,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  shades: RGB[],
  seed: number,
  contrast = 1,
) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const l = -(nx * 0.45 + ny * 0.75) * contrast;
      const n = (hash2(x >> 1, y >> 1, seed) - 0.5) * 0.5;
      const v = l + n;
      const c = v > 0.4 ? shades[3] : v > 0.05 ? shades[1] : v > -0.35 ? shades[0] : shades[2];
      b.set(x, y, c);
    }
}

/** Soft ground shadow ellipse drawn after the contour so it is never outlined. */
function groundShadow(b: PixelBuf, cx: number, cy: number, rx: number, alpha = 64) {
  const ry = Math.max(1.5, rx * 0.45);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1 || b.alpha(x, y) > 0) continue;
      b.set(x, y, SHADOW, Math.round(alpha * (1 - d * 0.6)));
    }
}

/** Trunk with a lit left edge and a dark right edge; `w` is the width in pixels. */
function trunk(b: PixelBuf, x0: number, yTop: number, w: number, h: number, base = PAL.trunk) {
  b.rect(x0, yTop, w, h, base);
  b.rect(x0, yTop, 1, h, shade(base, 1.18));
  if (w > 2) b.rect(x0 + w - 1, yTop, 1, h, shade(base, 0.72));
  if (w > 3) b.rect(x0 + w - 2, yTop, 1, h, shade(base, 0.9));
}

// --- broadleaf trees ---------------------------------------------------------------------------

/** Round broadleaf: two or three connected canopy masses on a short trunk. */
function roundTree(seed: number, v: number): PixelBuf {
  const w = 24 + v * 3;
  const h = 32 + v * 4 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = Math.floor(w / 2);
  const trunkH = 9 + v;
  trunk(b, cx - 1, base - trunkH, 3, trunkH + 1);
  // main crown, then a lower side mass and a small lit top mass
  const cr = w / 2 - 1;
  mass(b, cx, base - trunkH - cr * 0.7, cr, cr * 0.72, PAL.leaf, seed);
  const side = hash2(seed, 1, 2) > 0.5 ? 1 : -1;
  mass(
    b,
    cx + side * cr * 0.45,
    base - trunkH - cr * 0.35,
    cr * 0.62,
    cr * 0.5,
    PAL.leaf,
    seed + 1,
  );
  mass(
    b,
    cx - side * cr * 0.2,
    base - trunkH - cr * 1.15,
    cr * 0.55,
    cr * 0.42,
    PAL.leaf,
    seed + 2,
  );
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, cr * 0.8);
  return b;
}

/** Oak: wider and heavier than the round tree; strong branching and a low spreading crown. */
function oakTree(seed: number, v: number): PixelBuf {
  const w = 34 + v * 2;
  const h = 38 + v * 2 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = w / 2;
  const OAK: RGB[] = [
    [74, 112, 58],
    [92, 132, 68],
    [54, 86, 46],
    [114, 154, 82],
  ];
  const trunkW = 5;
  const trunkH = 12;
  trunk(b, Math.floor(cx - trunkW / 2), base - trunkH, trunkW, trunkH + 1);
  // root flare and two visible boughs leaving the trunk
  b.set(Math.floor(cx - trunkW / 2) - 1, base, PAL.trunkDark);
  b.set(Math.floor(cx + trunkW / 2), base, shade(PAL.trunk, 0.85));
  b.line(cx, base - trunkH + 1, cx - 8, base - trunkH - 6, PAL.trunkDark);
  b.line(cx + 1, base - trunkH + 1, cx + 8, base - trunkH - 5, shade(PAL.trunk, 0.9));
  // low wide crown built from three overlapping masses, a heavier dark one at the bottom
  const cr = w / 2 - 1;
  mass(b, cx, base - trunkH - 9, cr, 9, OAK, seed, 0.9);
  mass(b, cx - cr * 0.35, base - trunkH - 15, cr * 0.62, 8, OAK, seed + 1);
  mass(b, cx + cr * 0.32, base - trunkH - 14, cr * 0.6, 7.5, OAK, seed + 2);
  mass(b, cx + (hash2(seed, 3, 1) - 0.5) * 6, base - trunkH - 20, cr * 0.5, 6, OAK, seed + 3);
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, cr * 0.85, 70);
  return b;
}

/** Birch: slender pale trunk with sparing dark breaks, airy uneven canopy of small masses. */
function birchTree(seed: number, v: number): PixelBuf {
  const w = 22;
  const h = 38 + v * 2 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = Math.floor(w / 2);
  const BARK: RGB = [224, 220, 206];
  const BAND: RGB = [72, 68, 60];
  const LEAF: RGB[] = [
    [124, 164, 82],
    [146, 184, 96],
    [98, 134, 68],
    [172, 204, 116],
  ];
  const trunkH = 17;
  b.rect(cx - 1, base - trunkH, 2, trunkH + 1, BARK);
  b.rect(cx, base - trunkH, 1, trunkH + 1, shade(BARK, 0.84));
  for (let y = base - trunkH + 2; y < base - 1; y += 4)
    if (hash2(y, seed, 4) > 0.45) b.set(cx - 1 + (hash2(y, seed, 5) > 0.5 ? 1 : 0), y, BAND);
  // airy canopy: five or six small masses with gaps, lighter towards the top-left
  const blobs = 5 + v;
  for (let i = 0; i < blobs; i++) {
    const t = i / (blobs - 1);
    const bx = cx + (hash2(i, seed, 1) - 0.5) * 12;
    const by = base - trunkH - 2 - t * 13 + (hash2(i, seed, 2) - 0.5) * 3;
    const r = 3.5 + hash2(i, seed, 3) * 2.5;
    mass(b, bx, by, r, r * 0.8, LEAF, seed + i, 0.8);
  }
  b.outline(PAL.outline, 170);
  groundShadow(b, cx, base + 1, 5, 50);
  return b;
}

// --- waterside trees ---------------------------------------------------------------------------

/**
 * The waterside trees' frames, w x h at the anchor (ax, ay), in world px: the packed paintings'
 * (`props/mangrove_N`, `props/willow_N` in public/assets/props.json, listed in
 * docs/art-direction/frame-inventory.json), so a fallback stands where its painting does. A
 * mangrove's anchor is the middle of its ring of root tips, at the waterline; a willow's is its
 * trunk foot, with the three shadow rows under it that every other tree has. `spread` is how far
 * a mangrove's roots reach across.
 */
const MANGROVES = [
  { w: 27, h: 22, ax: 14, ay: 20, spread: 14 },
  { w: 36, h: 29, ax: 18, ay: 25, spread: 20 },
  { w: 49, h: 34, ax: 25, ay: 31, spread: 29 },
];
const WILLOWS = [
  { w: 35, h: 31, ax: 17 },
  { w: 43, h: 36, ax: 22 },
  { w: 49, h: 40, ax: 25 },
];

/**
 * The nature set's fallbacks (#653). Each kind's frames, [w, h, ax, ay] in world px, are the packed
 * paintings' (assets/source/nature-2026-11-01), so a fallback stands where its painting does; the
 * painting is what the game shows, and a fallback is only the kind's crown or clump in its colours.
 * `crown` is the share of the frame's height its crown fills from the top.
 */
const NATURE_TREES: Record<string, { frames: number[][]; crown: number; bark: RGB; leaf: RGB[] }> =
  {
    beech: {
      frames: [
        [33, 23, 18, 23],
        [39, 28, 18, 28],
        [49, 34, 23, 33],
      ],
      crown: 0.88,
      bark: [122, 118, 108],
      leaf: [
        [60, 86, 58],
        [76, 104, 68],
        [44, 66, 48],
        [98, 124, 80],
      ],
    },
    poplar: {
      frames: [
        [12, 30, 6, 29],
        [16, 36, 7, 36],
        [17, 43, 8, 43],
      ],
      crown: 0.9,
      bark: [104, 92, 72],
      leaf: [
        [78, 112, 62],
        [98, 134, 72],
        [58, 88, 52],
        [128, 156, 86],
      ],
    },
    apple: {
      frames: [
        [19, 18, 9, 17],
        [27, 22, 13, 21],
        [30, 26, 15, 25],
      ],
      crown: 0.77,
      bark: [96, 76, 56],
      leaf: [
        [92, 122, 72],
        [120, 142, 88],
        [68, 96, 58],
        [216, 196, 186],
      ],
    },
    maple: {
      frames: [
        [26, 23, 12, 23],
        [34, 29, 17, 28],
        [39, 34, 19, 33],
      ],
      crown: 0.81,
      bark: [92, 74, 58],
      leaf: [
        [142, 76, 44],
        [168, 96, 52],
        [106, 58, 40],
        [190, 124, 66],
      ],
    },
    larch: {
      frames: [
        [18, 23, 9, 23],
        [20, 28, 10, 28],
        [27, 34, 13, 33],
      ],
      crown: 0.9,
      bark: [98, 80, 62],
      leaf: [
        [132, 138, 66],
        [156, 158, 80],
        [100, 110, 58],
        [180, 176, 98],
      ],
    },
    acacia: {
      frames: [
        [36, 18, 19, 17],
        [42, 22, 20, 21],
        [60, 26, 32, 25],
      ],
      crown: 0.44,
      bark: [108, 92, 72],
      leaf: [
        [120, 124, 78],
        [142, 142, 90],
        [94, 100, 66],
        [166, 162, 108],
      ],
    },
  };
const NATURE_GROUND: Record<string, { frames: number[][]; leaf: RGB[] }> = {
  stump: {
    frames: [
      [11, 8, 5, 7],
      [11, 8, 5, 7],
    ],
    leaf: [
      [120, 88, 58],
      [196, 164, 120],
      [88, 64, 44],
      [216, 188, 146],
    ],
  },
  log: {
    frames: [
      [15, 8, 7, 6],
      [13, 8, 6, 6],
    ],
    leaf: [
      [108, 84, 58],
      [104, 116, 62],
      [76, 60, 44],
      [128, 136, 74],
    ],
  },
  fern: {
    frames: [
      [17, 10, 8, 8],
      [16, 10, 7, 10],
    ],
    leaf: [
      [58, 92, 54],
      [76, 112, 62],
      [42, 70, 46],
      [98, 132, 72],
    ],
  },
  mushrooms: {
    frames: [
      [8, 6, 4, 6],
      [8, 6, 4, 6],
    ],
    leaf: [
      [160, 74, 58],
      [212, 196, 164],
      [118, 56, 48],
      [226, 212, 182],
    ],
  },
  heather: {
    frames: [
      [17, 8, 8, 8],
      [17, 8, 8, 8],
    ],
    leaf: [
      [122, 92, 128],
      [146, 112, 148],
      [92, 96, 84],
      [168, 134, 164],
    ],
  },
  dryshrub: {
    frames: [
      [17, 12, 9, 12],
      [23, 12, 10, 12],
    ],
    leaf: [
      [122, 104, 78],
      [142, 124, 92],
      [92, 78, 60],
      [132, 136, 88],
    ],
  },
};

/** A nature tree's fallback: a trunk up from its foot into its crown. */
function natureTree(kind: string, seed: number, v: number): PixelBuf {
  const { frames, crown, bark, leaf } = NATURE_TREES[kind];
  const [w, h, ax, ay] = frames[v];
  const b = new PixelBuf(w, h);
  const under = h * crown;
  trunk(b, ax - 1, Math.round(under / 2), 2, Math.min(ay, h - 1) - Math.round(under / 2) + 1, bark);
  mass(b, w / 2, (under + 1) / 2, w / 2 - 1, (under - 1) / 2, leaf, seed);
  b.outline(PAL.outline, 150);
  return b;
}

/** A nature ground piece's fallback: one low clump in its colours. */
function natureGround(kind: string, seed: number, v: number): PixelBuf {
  const { frames, leaf } = NATURE_GROUND[kind];
  const [w, h] = frames[v];
  const b = new PixelBuf(w, h);
  mass(b, w / 2, h / 2, w / 2 - 1, h / 2 - 1, leaf, seed);
  b.outline(PAL.outline, 150);
  return b;
}

/** A point `t` of the way along the quadratic curve from `a` over `c` to `b`. */
function curve(a: [number, number], c: [number, number], b: [number, number], t: number) {
  const u = 1 - t;
  return [
    u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
    u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
  ];
}

/**
 * Mangrove: a dark evergreen crown, wider than it is tall, on a short stem that splits into
 * arched prop roots. The roots end in dark wet tips on a flat ring around the anchor, where the
 * waterline is; no water is drawn, the tile's own water shows through between them. The old
 * variant also lets thin aerial roots hang from its crown.
 */
function mangroveTree(seed: number, v: number): PixelBuf {
  const { w, h, ax, ay, spread } = MANGROVES[v];
  const b = new PixelBuf(w, h);
  const LEAF: RGB[] = [
    [52, 86, 62],
    [66, 102, 72],
    [40, 66, 50],
    [86, 122, 86],
  ];
  const ROOT: RGB = [116, 96, 74];
  const WET: RGB = [52, 46, 40];
  // the frame's rows under the anchor row, the contour's included: the front tips stop over them
  const below = h - 1 - ay;
  const rx = spread / 2;
  const top = 1;
  const crownBottom = top + (ay - top) * 0.56;
  const stemBase = top + (ay - top) * 0.7;
  // the middle of the columns 1 to w - 2, which the crown spans inside its 1 px contour margin
  const cx = w / 2;

  // prop roots, the back ones first and darker, each arching out from the stem to its tip
  const n = 7 + v * 2;
  const tips = Array.from({ length: n }, (_, i) => {
    const t = Math.PI + ((i + 0.5) / n) * Math.PI * 2 + (hash2(i, seed, 1) - 0.5) * 0.3;
    const sin = Math.sin(t);
    return {
      x: ax + rx * Math.cos(t),
      y: ay + (sin > 0 ? Math.max(0, below - 1) : Math.max(1, rx * 0.28)) * sin,
      back: sin < 0,
    };
  }).sort((p, q) => Number(q.back) - Number(p.back) || p.y - q.y);
  for (const tip of tips) {
    const from: [number, number] = [ax + (tip.x - ax) * 0.12, stemBase];
    const knee: [number, number] = [
      ax + (tip.x - ax) * 0.9,
      stemBase - 1.5 - Math.abs(tip.x - ax) * 0.18,
    ];
    const lit = tip.x < ax;
    const tone = tip.back ? 0.72 : lit ? 1.12 : 0.86;
    const steps = Math.ceil(Math.hypot(tip.x - ax, tip.y - stemBase) * 2.5);
    for (let s = 0; s <= steps; s++) {
      const [x, y] = curve(from, knee, [tip.x, tip.y], s / steps);
      b.set(x, y, s > steps - 3 ? WET : shade(ROOT, tone));
    }
  }
  // the stem, lit on its left
  trunk(
    b,
    Math.round(ax) - 1,
    Math.floor(crownBottom) - 1,
    3,
    Math.ceil(stemBase - crownBottom) + 2,
  );
  // a low wide crown: a dark underside the width of the frame, and leafy lobes along its top,
  // each lit from the upper left; the middle one is the crown's top
  const crownH = crownBottom - top;
  const half = (w - 2) / 2;
  mass(
    b,
    cx,
    top + crownH * 0.66,
    half,
    crownH * 0.36,
    LEAF.map((c) => shade(c, 0.9)),
    seed,
  );
  const lobes = 4 + v;
  for (let i = 0; i < lobes; i++) {
    const t = (i + 0.5) / lobes - 0.5;
    const middle = i === Math.floor(lobes / 2);
    const lr = half * (0.34 - Math.abs(t) * 0.18);
    const lry = crownH * (middle ? 0.36 : 0.3 - Math.abs(t) * 0.1);
    const ly = middle ? top + lry : top + crownH * (0.4 + Math.abs(t) * 0.5) + hash2(i, seed, 2);
    mass(b, cx + t * 2 * half * 0.78, ly, lr, lry, LEAF, seed + 1 + i, 1.1);
  }
  // aerial roots hanging from the old crown
  if (v === 2)
    for (let i = 0; i < 4; i++) {
      const x = Math.round(cx + (i - 1.5) * (w - 2) * 0.17 + (hash2(i, seed, 5) - 0.5) * 2);
      const from = Math.ceil(top + crownH * 0.95);
      for (let y = from; y < from + 3 + Math.floor(hash2(i, seed, 6) * 3); y++)
        if (!b.alpha(x, y)) b.set(x, y, shade(ROOT, 0.78));
    }
  b.outline(PAL.outline, 190);
  // a faint shade on the water under the root ring, inside the frame
  for (let y = Math.floor(ay - 1); y <= ay + Math.max(0, below - 1); y++)
    for (let x = Math.ceil(ax - rx); x <= Math.floor(ax + rx); x++) {
      const nx = (x + 0.5 - ax) / (rx + 0.5);
      const ny = (y + 0.5 - ay) / 1.8;
      const d = nx * nx + ny * ny;
      if (d <= 1 && b.alpha(x, y) === 0) b.set(x, y, SHADOW, Math.round(44 * (1 - d * 0.6)));
    }
  return b;
}

/**
 * Weeping willow: a short forked trunk under a dome of leaves, and from the dome's rim curtains of
 * hanging silvery-olive strands down toward the bank, parted in the middle so the trunk shows. The
 * strands catch the light on the left and fall into shade on the right and toward their hems.
 */
function willowTree(seed: number, v: number): PixelBuf {
  const { w, h, ax } = WILLOWS[v];
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const LEAF: RGB[] = [
    [112, 132, 82],
    [130, 150, 94],
    [88, 106, 66],
    [154, 170, 112],
  ];
  const BARK: RGB = [104, 86, 64];
  const top = 1;
  const tall = base - top;
  const cx = (w - 1) / 2;
  const rx = (w - 2) / 2;
  // trunk and the fork of its two boughs
  const trunkW = 3 + (v > 0 ? 1 : 0);
  const trunkTop = base - Math.round(tall * 0.45);
  trunk(b, Math.round(ax - trunkW / 2), trunkTop, trunkW, base - trunkTop + 1, BARK);
  b.set(Math.round(ax - trunkW / 2) - 1, base, PAL.trunkDark);
  b.line(ax, trunkTop + 1, ax - 3 - v, trunkTop - 3 - v, shade(BARK, 1.1));
  b.line(ax + 1, trunkTop + 1, ax + 4 + v, trunkTop - 2 - v, shade(BARK, 0.8));
  // the curtains first: strands in locks of two or three columns, each hanging from under the
  // crown's rim to its own ragged hem, shorter toward the sides so the outline droops round, and
  // parted over the trunk
  const rimY = top + tall * 0.3;
  for (let x = 1; x <= w - 2; x++) {
    const nx = (x + 0.5 - cx) / rx;
    if (Math.abs(nx) > 1) continue;
    const lock = Math.floor((x + Math.floor(hash2(seed, 4, 1) * 3)) / 3);
    // a gap between two locks now and then, so the curtain reads as strands
    if (x % 3 === 0 && x > 1 && x < w - 2 && hash2(lock, seed, 7) < 0.45) continue;
    const from = Math.round(rimY + tall * 0.12 * nx * nx);
    const parted = Math.abs(x + 0.5 - ax) < trunkW + 1;
    const hem = parted
      ? trunkTop - 1 - Math.floor(hash2(x, seed, 8) * 3)
      : base -
        2 -
        Math.round(nx ** 4 * tall * 0.3) -
        Math.floor(hash2(lock, seed, 8) * 4) -
        (x % 3 === 1 ? 0 : Math.floor(hash2(x, seed, 10) * 2));
    // a lock is lit on the left of the tree and shaded on the right, darker toward its hem
    const lit = -lightX() * nx * 0.55 + 0.15 + (hash2(lock, seed, 11) - 0.5) * 0.3;
    for (let y = from; y <= hem; y++) {
      const down = (y - from) / Math.max(1, hem - from);
      const l = lit - down * 0.75 + (x % 3 === 0 ? -0.12 : 0);
      b.set(x, y, l > 0.35 ? LEAF[3] : l > 0 ? LEAF[1] : l > -0.4 ? LEAF[0] : LEAF[2]);
    }
  }
  // the crown over them: a dome of lobes, the middle one its top
  const domeRy = tall * 0.2;
  mass(b, cx, rimY - domeRy * 0.2, rx * 0.92, domeRy, LEAF, seed, 0.8);
  const lobes = 3 + v;
  for (let i = 0; i < lobes; i++) {
    const t = (i + 0.5) / lobes - 0.5;
    const middle = i === Math.floor(lobes / 2);
    const lry = domeRy * (middle ? 0.75 : 0.62);
    const ly = middle ? top + lry : top + lry + Math.abs(t) * domeRy * 1.6 + hash2(i, seed, 3);
    mass(b, cx + t * 2 * rx * 0.72, ly, rx * (0.36 - Math.abs(t) * 0.12), lry, LEAF, seed + 1 + i);
  }
  b.outline(PAL.outline, 180);
  groundShadow(b, ax, base + 1, Math.min(rx * 0.55, 9), 58);
  return b;
}

// --- conifers ----------------------------------------------------------------------------------

/** One conifer tier: a triangle with lit left side and dark right, cluster noise. */
function tier(
  b: PixelBuf,
  cx: number,
  yTop: number,
  yBot: number,
  halfW: number,
  shades: RGB[],
  seed: number,
  snow = 0,
) {
  for (let y = Math.floor(yTop); y < Math.floor(yBot); y++) {
    const f = (y - yTop) / (yBot - yTop);
    const hw = halfW * f;
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      const side = (x - cx) / Math.max(1, hw);
      const n = (hash2(x >> 1, y >> 1, seed) - 0.5) * 0.5;
      const v = -side * 0.5 + n + (f > 0.85 ? -0.3 : 0);
      let c = v > 0.35 ? shades[3] : v > 0 ? shades[1] : v > -0.4 ? shades[0] : shades[2];
      if (snow > 0 && f > 0.78 && hash2(x, y, seed + 30) < snow) c = side > 0.3 ? SNOW_SHADE : SNOW;
      b.set(x, y, c);
    }
  }
}
const SNOW: RGB = [230, 236, 234];
const SNOW_SHADE: RGB = [186, 200, 204];

/** Pine: open tiered canopy with the trunk visible between the groups. */
function pineTree(seed: number, v: number): PixelBuf {
  const w = 20 + v * 2;
  const h = 40 + v * 6 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = Math.floor(w / 2);
  const top = 2;
  trunk(b, cx - 1, top + 4, 3, base - top - 3);
  const tiers = 3;
  const span = base - 8 - top;
  for (let t = 0; t < tiers; t++) {
    const yTop = top + (t / tiers) * span;
    const yBot = yTop + span / tiers - 3; // gap below each tier shows the trunk
    const halfW = ((w / 2 - 1) * (t + 1.6)) / (tiers + 0.6);
    tier(b, cx, yTop, yBot, halfW, PAL.pine, seed + t);
  }
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, 5, 50);
  return b;
}

/** Spruce: denser tapered cone with darker lower layers; a cosmetic dusting of snow. */
function spruceTree(seed: number, v: number): PixelBuf {
  const w = 18;
  const h = 44 + v * 4 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = Math.floor(w / 2);
  const SPRUCE: RGB[] = [
    [44, 84, 72],
    [56, 100, 84],
    [32, 62, 56],
    [74, 122, 100],
  ];
  trunk(b, cx - 1, base - 8, 3, 9, PAL.trunkDark);
  const tiers = 5;
  const span = base - 10;
  for (let t = 0; t < tiers; t++) {
    const yTop = 1 + (t / tiers) * span * 0.92;
    const yBot = yTop + span / tiers + 3;
    const halfW = ((w / 2 - 1) * (t + 1.3)) / (tiers + 0.3);
    const dark = SPRUCE.map((c) => shade(c, 1 - t * 0.05));
    tier(b, cx, yTop, Math.min(base - 6, yBot), halfW, dark, seed + t, t < 2 ? 0.55 : 0.2);
  }
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, 4.5, 50);
  return b;
}

// --- desert ------------------------------------------------------------------------------------

/** Palm: bent trunk with a small fan of readable fronds. */
function palmTree(seed: number, v: number): PixelBuf {
  const w = 28;
  const h = 36 + v * 2 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const lean = v === 0 ? 1 : -1;
  const baseX = Math.floor(w / 2) - lean * 4;
  const topX = Math.floor(w / 2) + lean * 3;
  const topY = 11;
  for (let y = base; y >= topY; y--) {
    const t = (base - y) / (base - topY);
    const ctrlX = baseX + (topX - baseX) * 0.15;
    const x = (1 - t) * (1 - t) * baseX + 2 * (1 - t) * t * ctrlX + t * t * topX;
    const xi = Math.round(x);
    const ring = y % 3 === 0;
    b.set(xi - 1, y, ring ? PAL.trunkDark : shade(PAL.trunk, 1.1));
    b.set(xi, y, ring ? shade(PAL.trunk, 0.8) : PAL.trunk);
    if (t < 0.5) b.set(xi + 1, y, PAL.trunkDark);
  }
  const FROND: RGB[] = [
    [86, 132, 66],
    [110, 158, 80],
    [64, 104, 54],
    [138, 180, 96],
  ];
  const fronds = 6;
  for (let i = 0; i < fronds; i++) {
    const a =
      -Math.PI * 1.05 + (i / (fronds - 1)) * Math.PI * 1.1 + (hash2(i, seed, 2) - 0.5) * 0.2;
    const len = 10 + hash2(i, seed, 3) * 3;
    let px = topX;
    let py = topY;
    for (let k = 0; k < len; k++) {
      const f = k / len;
      const dx = Math.cos(a) * (1 - f * 0.35);
      const dy = Math.sin(a) * (1 - f) + f * 1.3;
      px += dx;
      py += dy;
      const xi = Math.round(px);
      const yi = Math.round(py);
      const lit = dx < 0 || f < 0.3;
      b.set(xi, yi, lit ? FROND[3] : FROND[1]);
      b.set(xi, yi + 1, f < 0.6 ? FROND[0] : FROND[2]);
      if (k % 3 === 1 && k > 1) b.set(xi, yi + 2, FROND[2]);
    }
  }
  b.rect(topX - 1, topY - 1, 3, 3, FROND[2]);
  b.set(topX, topY - 1, FROND[3]);
  b.set(topX - 1, topY + 2, PAL.trunkDark);
  b.set(topX + 1, topY + 2, PAL.trunk);
  b.outline(PAL.outline, 190);
  groundShadow(b, baseX, base + 1, 5, 50);
  return b;
}

/** Saguaro: ribbed column with one or two arms, few highlights. */
function cactus(seed: number, v: number): PixelBuf {
  const w = 12;
  const h = 22 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const CACTUS: RGB[] = [
    [80, 128, 72],
    [98, 148, 84],
    [60, 100, 58],
  ];
  const cx = 5;
  const top = 3 + v;
  for (let y = top; y <= base; y++)
    for (let x = cx - 1; x <= cx + 1; x++)
      b.set(x, y, x === cx - 1 ? CACTUS[1] : x === cx + 1 ? CACTUS[2] : CACTUS[0]);
  b.set(cx, top - 1, CACTUS[1]);
  for (let y = top + 1; y < base; y += 3) b.set(cx, y, shade(CACTUS[0], 0.9));
  const arms = v === 2 ? 2 : 1;
  const armSide = hash2(seed, 1, 2) > 0.5 ? 1 : -1;
  for (let a = 0; a < arms; a++) {
    const side = a === 0 ? armSide : -armSide;
    const ay = 10 + a * 3 + Math.floor(hash2(seed, a, 3) * 2);
    const ax = cx + side * 3;
    b.rect(Math.min(cx, ax), ay, 4, 2, CACTUS[0]);
    b.rect(ax - (side > 0 ? 0 : 1), ay - 4 - a, 2, 6 + a, CACTUS[0]);
    b.rect(ax - (side > 0 ? 0 : 1), ay - 4 - a, 1, 6 + a, CACTUS[side > 0 ? 1 : 2]);
    b.set(ax, ay - 5 - a, CACTUS[1]);
  }
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, 3, 50);
  return b;
}

/** Dead tree: bare branching silhouette in silvered wood, no foliage. */
function deadTree(seed: number, v: number): PixelBuf {
  const w = 22;
  const h = 34 + v * 2 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = Math.floor(w / 2);
  const DEAD: RGB = [148, 134, 116];
  const DEAD_DARK: RGB = [104, 92, 78];
  const lean = v === 0 ? 1 : -1;
  for (let y = base; y >= 8; y--) {
    const t = (base - y) / (base - 8);
    const x = cx + Math.round(lean * t * 2);
    const wd = t < 0.35 ? 3 : t < 0.7 ? 2 : 1;
    b.rect(x - Math.floor(wd / 2), y, wd, 1, DEAD);
    b.set(x - Math.floor(wd / 2), y, shade(DEAD, 1.1));
    if (wd > 1) b.set(x - Math.floor(wd / 2) + wd - 1, y, DEAD_DARK);
  }
  const branches = 4;
  for (let i = 0; i < branches; i++) {
    const sy = 9 + Math.floor(hash2(i, seed, 1) * 14);
    const t = (base - sy) / (base - 8);
    const sx = cx + Math.round(lean * t * 2);
    const dir = i % 2 === 0 ? -1 : 1;
    const len = 4 + Math.floor(hash2(i, seed, 2) * 5);
    const ex = sx + dir * len;
    const ey = sy - 3 - Math.floor(hash2(i, seed, 3) * 4);
    b.line(sx, sy, ex, ey, DEAD);
    const mx = Math.round((sx + ex) / 2);
    const my = Math.round((sy + ey) / 2);
    b.line(mx, my, mx + dir * 2, my - 3, DEAD_DARK);
    b.line(ex, ey, ex + dir, ey - 3, DEAD_DARK);
  }
  b.line(cx + lean * 2, 8, cx + lean * 3, 3, DEAD);
  b.line(cx + lean * 2, 8, cx, 4, DEAD_DARK);
  b.outline(PAL.outline, 190);
  groundShadow(b, cx, base + 1, 4, 45);
  return b;
}

// --- low plants --------------------------------------------------------------------------------

/** Bush: low two- or three-lobed cluster, shorter than a wagon body. */
function bush(seed: number, v: number): PixelBuf {
  const w = 16;
  const h = 11 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const tint = v === 1 ? 1.1 : v === 2 ? 0.92 : 1;
  const s = PAL.leaf.map((c) => shade(c, tint));
  if (v === 2) {
    mass(b, 5, base - 3, 4.5, 3.5, s, seed);
    mass(b, 10, base - 4, 4.5, 4, s, seed + 1);
  } else {
    mass(b, 8, base - 3.5, 6.5, 4, s, seed);
    mass(b, 5, base - 5.5, 3.5, 3, s, seed + 2);
    if (v === 1) mass(b, 11, base - 5, 3, 2.5, s, seed + 3);
  }
  b.outline(PAL.outline, 160);
  groundShadow(b, 8, base + 1, 6, 40);
  return b;
}

/** Flower patch: a tuft with blooms concentrated in one small cluster; four colour variants. */
function flowers(seed: number, colour: number): PixelBuf {
  const w = 16;
  const h = 9 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const FLOWER: [RGB, RGB][] = [
    [
      [212, 92, 80],
      [236, 132, 112],
    ], // red
    [
      [224, 184, 72],
      [244, 214, 116],
    ], // yellow
    [
      [222, 220, 206],
      [244, 242, 232],
    ], // white
    [
      [156, 112, 184],
      [190, 150, 214],
    ], // lilac
  ];
  const [dark, light] = FLOWER[colour];
  const tuft = PAL.grass.map((c) => shade(c, 1.1));
  mass(b, 8, base - 2, 6.5, 2.5, tuft, seed, 0.4);
  for (let i = 0; i < 5; i++) {
    const x = 2 + Math.floor(hash2(i, seed, 1) * 12);
    const hgt = 1 + Math.floor(hash2(i, seed, 2) * 2);
    for (let k = 0; k < hgt; k++) b.set(x, base - 3 - k, PAL.grass[3]);
  }
  // blooms cluster around one centre
  const ccx = 5 + Math.floor(hash2(seed, colour, 6) * 6);
  const n = 3 + Math.floor(hash2(seed, colour, 3) * 2);
  for (let i = 0; i < n; i++) {
    const x = ccx + Math.round((hash2(i, seed, 4) - 0.5) * 6);
    const y = 2 + Math.floor(hash2(i, seed, 5) * 3);
    b.set(x, y + 2, PAL.grass[2]);
    b.set(x, y, light);
    b.set(x + 1, y, dark);
    b.set(x, y + 1, dark);
    b.set(x + 1, y + 1, shade(dark, 0.8));
  }
  b.outline(PAL.outline, 120);
  return b;
}

/** Reeds: sparse upright stems standing in a grounded wet base. */
function reeds(seed: number, v: number): PixelBuf {
  const w = 12;
  const h = 19 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const REED: RGB[] = [
    [104, 132, 62],
    [124, 150, 72],
    [84, 108, 50],
  ];
  const CATTAIL: RGB = [112, 76, 46];
  const WET: RGB[] = [
    [84, 130, 130],
    [98, 144, 142],
    [70, 112, 116],
    [110, 156, 152],
  ];
  // wet base: a small pool the stems stand in
  mass(b, 6, base - 1, 5.5, 2, WET, seed + 9, 0.3);
  const stalks = 4;
  for (let i = 0; i < stalks; i++) {
    const bx = 2 + Math.floor((i / (stalks - 1)) * 8);
    const top = 1 + Math.floor(hash2(i, seed, 1) * 6);
    const lean = Math.round((hash2(i, seed, 2) - 0.5) * 3);
    const c = REED[i % 3];
    b.line(bx, base - 1, bx + lean, top, c);
    if ((i + v) % 2 === 0 && top < 7) {
      b.rect(bx + lean, top, 1, 4, CATTAIL);
      b.set(bx + lean, top - 1, shade(REED[1], 1.1));
      b.set(bx + lean, top + 4, shade(CATTAIL, 0.75));
    }
  }
  b.line(3, base - 2, 1, base - 7, REED[2]);
  b.line(8, base - 2, 10, base - 6, REED[0]);
  b.outline(PAL.outline, 150);
  return b;
}

// --- stone and minerals ------------------------------------------------------------------------

/** Small low stone: a flat-topped lump, lit from the upper left. */
function smallRock(seed: number, v: number): PixelBuf {
  const w = 14 + v * 4;
  const h = 9 + v * 2 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const cx = w / 2;
  const ry = (base - 1) / 2;
  mass(b, cx, base - ry, w / 2 - 1, ry, PAL.rock, seed, 1.2);
  // flat lit top and a dark underside
  for (let x = Math.floor(cx - w * 0.3); x <= Math.ceil(cx); x++)
    if (b.alpha(x, Math.round(base - ry * 1.4))) b.set(x, Math.round(base - ry * 1.4), PAL.rock[3]);
  for (let x = 0; x < w; x++)
    for (let y = base - 1; y <= base; y++) if (b.alpha(x, y)) b.set(x, y, shade(PAL.rock[2], 0.85));
  b.outline(PAL.outline, 180);
  groundShadow(b, cx, base + 1, w / 2 - 2, 45);
  return b;
}

/** Boulder: larger angular mass built from two or three faceted blocks. */
function boulder(seed: number, v: number): PixelBuf {
  const w = 22;
  const h = 15 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const LIT = PAL.rock[3];
  const MID = PAL.rock[1];
  const DARK = PAL.rock[2];
  const DEEP = shade(PAL.rock[2], 0.78);
  // faceted block: left face lit, right face dark, top lightest; a jagged top edge
  const blocks: [number, number, number, number][] =
    v === 0
      ? [
          [2, 5, 12, 10],
          [11, 3, 9, 12],
        ]
      : v === 1
        ? [
            [1, 6, 9, 9],
            [8, 2, 10, 13],
            [16, 7, 5, 8],
          ]
        : [
            [1, 4, 13, 11],
            [12, 6, 9, 9],
          ];
  for (const [x0, y0, bw, bh] of blocks) {
    const split = x0 + Math.floor(bw * 0.55);
    for (let y = y0; y < y0 + bh; y++)
      for (let x = x0; x < x0 + bw; x++) {
        const notch = y === y0 && hash2(x, seed, 3) > 0.6;
        if (notch) continue;
        const top = y < y0 + 2;
        const n = hash2(x >> 1, y >> 1, seed + x0);
        const c = top ? LIT : x < split ? (n > 0.7 ? LIT : MID) : n > 0.7 ? DARK : DEEP;
        b.set(x, y + (base - 14), c);
      }
    // crack along the facet edge
    for (let y = y0 + 2; y < y0 + bh - 1; y += 2) b.set(split, y + (base - 14), DEEP);
  }
  b.outline(PAL.outline, 190);
  groundShadow(b, w / 2, base + 1, 9, 55);
  return b;
}

/** Coal seam: dark stratified outcrop with a few glints, unlike ordinary grey rock. */
function coalSeam(seed: number, v: number): PixelBuf {
  const w = 20;
  const h = 10 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const c: RGB[] = [
    [52, 50, 54],
    [70, 68, 74],
    [34, 32, 36],
    [88, 86, 94],
  ];
  mass(b, w / 2, base - 4, w / 2 - 1 - (v % 2), 4, c, seed, 1.1);
  if (v === 2) mass(b, w / 2 + 5, base - 4.5, 4, 3, c, seed + 1, 1.1);
  // strata: dark bands every third row, lit ledge on top
  for (let y = 0; y <= base; y++)
    for (let x = 0; x < w; x++) {
      if (!b.alpha(x, y)) continue;
      if ((y + v) % 3 === 0) b.set(x, y, shade(b.get(x, y)!, 0.78));
      else if (y === base - 7 || (y === base - 6 && x > 8)) b.set(x, y, c[3]);
    }
  b.set(5, base - 4, [124, 122, 134]);
  b.set(12 + v, base - 2, [124, 122, 134]);
  b.outline(PAL.outline, 190);
  groundShadow(b, w / 2, base + 1, 8, 50);
  return b;
}

/** Oil seep: a small dark pool with a restrained sheen and a bubble, no rainbow. */
function oilSeep(seed: number, v: number): PixelBuf {
  const w = 22;
  const h = 9 + SHADOW_ROWS;
  const b = new PixelBuf(w, h);
  const base = h - 1 - SHADOW_ROWS;
  const c: RGB[] = [
    [42, 36, 38],
    [56, 48, 50],
    [28, 24, 26],
    [70, 62, 66],
  ];
  mass(b, w / 2, base - 3, w / 2 - 1, 3, c, seed, 0.4);
  if (v > 0) mass(b, w / 2 - 6 + v * 4, base - 5 + v, 3, 1.5, c, seed + 2, 0.4);
  // muddy rim on the lit side, sheen streak, one bubble
  for (let x = 2; x < w - 2; x++)
    if (b.alpha(x, base - 6) && !b.alpha(x, base - 7)) b.set(x, base - 6, [96, 82, 62]);
  b.rect(6, base - 3, 3, 1, [104, 96, 110]);
  b.set(13 + v, base - 2, [104, 96, 110]);
  b.set(15, base - 4, [84, 76, 84]);
  b.outline(PAL.outline, 170);
  return b;
}

// --- wheat fields ------------------------------------------------------------------------------

/**
 * Canvas of a wheat patch. The anchor is the tile centre, not a base row: the patch is one whole
 * tile of ground cover, the diamond of 64x32 px (rows 0.42 tile from the centre, an irregular
 * edge to 0.46 at most), and the stalks stand over it, so there is room above the centre for them.
 */
const WHEAT_W = 64;
const WHEAT_H = 48;
const WHEAT_CX = 32;
const WHEAT_CY = 30;
/** Stalks stand 2.6 to 3.5 px over the ground, in slow swells, a little lower at the edge. */
const STALK_MIN = 2.6;
const STALK_SWELL = 0.9;

/** Smooth value noise on a lattice `cell` tile units wide, in [0, 1). */
function swell(tx: number, ty: number, cell: number, seed: number): number {
  const x = tx / cell;
  const y = ty / cell;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Where one variant's patch sits and how far it reaches, in tile units: centre x, y, length x, y. */
const WHEAT_SHAPES: [number, number, number, number][] = [
  [0, 0, 0.84, 0.84],
  [0.015, -0.015, 0.82, 0.82],
  [-0.01, 0.01, 0.84, 0.82],
];

/**
 * A wheat field: a low raised patch of one tile, golden rows standing a little over the ground
 * with the light from the upper left, and a darker front and side rim where the stalks end.
 * Footprint and rows are the farm's (`field`, `fieldRow`), so a field and a farm's own plot read
 * as the same crop. Variant 0 is ripe all over, 1 is still green toward its upper-right end
 * (the rows' far end), 2 has a few flattened patches laid down in it and a ragged lower-left
 * corner.
 */
function wheatField(seed: number, v: number): PixelBuf {
  const b = new PixelBuf(WHEAT_W, WHEAT_H);
  const [sx, sy, lx, ly] = WHEAT_SHAPES[v];
  const footprint = field(sx, sy, lx, ly, 1, seed);
  // flattened patches of variant 2: tile x, y and radius
  const laid: [number, number, number][] =
    v === 2
      ? [
          [0.1, 0.06, 0.14],
          [-0.2, -0.1, 0.1],
          [0.2, -0.26, 0.09],
        ]
      : [];
  const n = WHEAT_W * WHEAT_H;
  const tileX = new Float32Array(n);
  const tileY = new Float32Array(n);
  const inside = new Uint8Array(n);
  for (let gy = 0; gy < WHEAT_H; gy++)
    for (let gx = 0; gx < WHEAT_W; gx++) {
      const px = (gx + 0.5 - WHEAT_CX) / HALF_W;
      const py = (gy + 0.5 - WHEAT_CY) / HALF_H;
      const tx = (px + py) / 2;
      const ty = (py - px) / 2;
      const i = gy * WHEAT_W + gx;
      tileX[i] = tx;
      tileY[i] = ty;
      if (!footprint(tx, ty, gx, gy)) continue;
      // the ragged corner: the left corner of the diamond crumbles away
      if (v === 2 && ty - tx > 0.62 + 0.12 * hash2(gx >> 1, gy >> 1, seed + 6)) continue;
      inside[i] = 1;
    }
  // The farm's edge is ragged to the pixel; one pass of a majority filter takes the stray pixels
  // and chips off it, which would stand as thin dark drips, and keeps its irregular outline.
  const ragged = inside.slice();
  for (let gy = 0; gy < WHEAT_H; gy++)
    for (let gx = 0; gx < WHEAT_W; gx++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = gx + dx;
          const y = gy + dy;
          if (x >= 0 && y >= 0 && x < WHEAT_W && y < WHEAT_H) k += ragged[y * WHEAT_W + x];
        }
      inside[gy * WHEAT_W + gx] = k >= 5 ? 1 : 0;
    }
  // How much of the 5x5 around a ground pixel is field. The stalks stand shorter where it is less,
  // so a stray pixel at the edge is a low ear and the edge a ragged shoulder, not a wall of drips.
  const cover = new Float32Array(n);
  for (let gy = 0; gy < WHEAT_H; gy++)
    for (let gx = 0; gx < WHEAT_W; gx++) {
      let k = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = gx + dx;
          const y = gy + dy;
          if (x >= 0 && y >= 0 && x < WHEAT_W && y < WHEAT_H) k += inside[y * WHEAT_W + x];
        }
      cover[gy * WHEAT_W + gx] = k / 25;
    }

  // Back to front, each ground pixel stands a stalk-high column: its head on top, its front
  // below it. A nearer pixel covers the front of the one behind, so the fronts that stay are the
  // ones at the field's lower edges, and where the stalks step down.
  for (let gy = 0; gy < WHEAT_H; gy++)
    for (let gx = 0; gx < WHEAT_W; gx++) {
      const i = gy * WHEAT_W + gx;
      if (!inside[i]) continue;
      const tx = tileX[i];
      const ty = tileY[i];
      const flat = laid.some(([lx0, ly0, r]) => Math.hypot(tx - lx0, ty - ly0) < r);
      const row = fieldRow(gx, gy);
      const gap = row > 3 && !flat;
      const shoulder = Math.max(0, Math.min(1, (cover[i] - 0.15) / 0.4));
      let height =
        (STALK_MIN + STALK_SWELL * swell(tx, ty, 0.37, seed + 7)) *
        shoulder *
        shoulder *
        (3 - 2 * shoulder);
      if (flat) height *= 0.4;
      // the furrows lie lower than the ridges
      if (gap) height *= 0.6;
      const rise = Math.max(1, Math.round(height));

      // the crop's shades: ripe gold, green toward the far end of variant 1
      const greenness =
        v === 1
          ? Math.max(0, Math.min(1, (-0.04 - ty) / 0.26 + (swell(tx, ty, 0.2, seed + 8) - 0.5)))
          : 0;
      const crop = hash2(gx >> 1, gy >> 1, seed + 9) < greenness ? PAL.wheatGreen : PAL.wheat;
      // light from the upper left, then clusters of heads a little lighter or darker
      const light = -((gx - WHEAT_CX) / 32) * 0.28 - ((gy - WHEAT_CY) / 16) * 0.4;
      const tone = (swell(tx, ty, 0.16, seed + 4) - 0.5) * 0.6 + light * 0.6;
      // a ridge is lit along its upper edge and shaded along its lower; between two ridges the
      // furrow shows its earth in the shade of the stalks
      const level = flat ? tone + 0.5 : tone + (row === 0 ? 1 : row === 3 ? -1 : 0);
      const head: RGB = gap
        ? shade(PAL.furrow, tone > 0.15 ? 1.12 : 0.96)
        : level >= 1.15
          ? crop[3]
          : level >= 0.45
            ? crop[1]
            : level >= -0.55
              ? crop[0]
              : crop[2];

      // the stalks' front, in the shade of their own heads and darker toward the ground; the
      // lower-left front takes the light, the lower-right one is turned away from it
      const stalk = gap ? PAL.furrow : crop[0];
      const turned = gx >= WHEAT_CX;
      const top = Math.round(gy - rise);
      for (let y = top; y <= gy; y++) {
        const d = y - top;
        if (d === 0) {
          b.set(gx, y, head);
          continue;
        }
        const f = (turned ? [0.7, 0.58, 0.46] : [0.82, 0.68, 0.56])[Math.min(2, d - 1)];
        b.set(gx, y, [stalk[0] * f, stalk[1] * f * 0.97, stalk[2] * f * 0.88]);
      }
    }
  b.outline(PAL.outline, 150);
  return b;
}

export function generatePropsAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  // anchor: horizontal centre, on the row just above the shadow rows
  const add = (name: string, p: PixelBuf, ax?: number) =>
    ab.add(name, p.toImageData(), ax ?? Math.floor(p.w / 2), p.h - 1 - SHADOW_ROWS);
  for (let v = 0; v < 3; v++) {
    add(`props/tree_${v}`, roundTree(10 + v, v));
    add(`props/pine_${v}`, pineTree(20 + v, v));
    add(`props/rock_${v}`, smallRock(30 + v, v));
    add(`props/birch_${v}`, birchTree(50 + v, v));
    add(`props/spruce_${v}`, spruceTree(60 + v, v));
    add(`props/oak_${v}`, oakTree(70 + v, v));
    add(`props/cactus_${v}`, cactus(90 + v, v), 5);
    add(`props/bush_${v}`, bush(40 + v, v));
    add(`props/boulder_${v}`, boulder(130 + v, v));
    add(`props/coal_${v}`, coalSeam(140 + v, v));
    add(`props/oil_${v}`, oilSeep(150 + v, v));
  }
  for (let v = 0; v < 2; v++) {
    add(`props/palm_${v}`, palmTree(80 + v, v), Math.floor(28 / 2) - (v === 0 ? 1 : -1) * 4);
    add(`props/deadtree_${v}`, deadTree(100 + v, v));
    add(`props/reeds_${v}`, reeds(120 + v, v));
  }
  for (let v = 0; v < 4; v++) add(`props/flowers_${v}`, flowers(110 + v, v));
  // the waterside trees take the anchors of their paintings
  for (let v = 0; v < 3; v++) {
    const m = MANGROVES[v];
    ab.add(`props/mangrove_${v}`, mangroveTree(170 + v, v).toImageData(), m.ax, m.ay);
    add(`props/willow_${v}`, willowTree(180 + v, v), WILLOWS[v].ax);
  }
  // the nature set too
  Object.keys(NATURE_TREES).forEach((kind, k) =>
    NATURE_TREES[kind].frames.forEach(([, , ax, ay], v) =>
      ab.add(`props/${kind}_${v}`, natureTree(kind, 190 + k * 3 + v, v).toImageData(), ax, ay),
    ),
  );
  Object.keys(NATURE_GROUND).forEach((kind, k) =>
    NATURE_GROUND[kind].frames.forEach(([, , ax, ay], v) =>
      ab.add(`props/${kind}_${v}`, natureGround(kind, 210 + k * 2 + v, v).toImageData(), ax, ay),
    ),
  );
  // a wheat field is anchored on the tile centre, which the patch is drawn around
  for (let v = 0; v < 3; v++)
    ab.add(`props/wheat_${v}`, wheatField(160 + v, v).toImageData(), WHEAT_CX, WHEAT_CY);
  return ab.build(512);
}
