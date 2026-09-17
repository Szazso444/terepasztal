/**
 * A broadleaf tree, drawn rather than rendered.
 *
 *   node art-src/draw/broadleaf.mjs out.png [seed] [variant]
 *
 * Two things make this kind of tree read, and a rendered volume loses both. The canopy is a
 * mosaic of small leaf blocks on a coarse grid, with daylight in the gaps, so its edge is ragged
 * at the scale of a leaf cluster rather than smooth at the scale of a sphere. And the branches
 * are real: the trunk divides, divides again, and the limbs show through the gaps, which is what
 * tells the eye it is a tree and not a lollipop.
 *
 * Light is from the upper left, as everywhere else in this project. It is applied as choice of
 * block colour by position, not as a gradient -- the boards shade in steps and so does this.
 */
import { Buf, Rng } from './pixels.mjs';

const BARK = {
  lit: [158, 124, 86],
  mid: [116, 86, 56],
  dark: [78, 56, 36],
  deep: [52, 37, 24],
};
const LEAF = [
  [176, 196, 92], // sunlit
  [124, 158, 68],
  [86, 124, 56],
  [56, 92, 48], // shaded
  [40, 68, 40], // deepest, for the underside of the canopy
];
const OUTLINE = [34, 30, 24];
const BLOCK = 4; // the leaf grid: the chunk everything in the canopy is built from

/** variant -> canopy radius and squash, how many times the bole divides, how dense the crown is */
const VARIANTS = [
  { r: 124, squash: 0.76, levels: 4, clumps: 165, trunk: 92, clump: 0.1 },
  { r: 138, squash: 0.72, levels: 4, clumps: 195, trunk: 100, clump: 0.095 },
  { r: 112, squash: 0.82, levels: 3, clumps: 140, trunk: 84, clump: 0.11 },
];

/** Grow a branch and its children, collecting the segments and the tips foliage hangs from. */
function grow(rng, x, y, angle, len, thick, depth, out) {
  const x1 = x + Math.cos(angle) * len;
  const y1 = y + Math.sin(angle) * len;
  out.segments.push({ x0: x, y0: y, x1, y1, r0: thick, r1: thick * 0.62, depth });
  if (depth <= 0 || thick < 2.2) {
    out.tips.push({ x: x1, y: y1 });
    return;
  }
  // two or three children: a tree that always forks in two reads as a diagram
  const kids = rng.f() < 0.35 ? 3 : 2;
  for (let i = 0; i < kids; i++) {
    const spread = rng.r(0.34, 0.78) * (i % 2 === 0 ? -1 : 1);
    // each child leans back toward vertical, which is what stops the crown splaying flat
    const a = angle + spread * (0.6 + 0.4 * rng.f()) - (angle + Math.PI / 2) * 0.06;
    grow(rng, x1, y1, a, len * rng.r(0.62, 0.8), thick * rng.r(0.56, 0.7), depth - 1, out);
  }
}

/** The root flare: short tapers spreading from the bole, which is how a big tree meets the ground. */
function roots(buf, rng, cx, base, thick) {
  for (let i = 0; i < 7; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const reach = thick * rng.r(1.1, 2.4);
    const drop = rng.r(6, 16);
    buf.taper(
      cx + side * thick * 0.3,
      base - rng.r(10, 26),
      cx + side * reach,
      base + drop * 0.2,
      thick * rng.r(0.3, 0.5),
      1.6,
      rng.f() < 0.4 ? BARK.dark : BARK.mid,
    );
  }
}

/**
 * One leaf clump: blocks on the coarse grid, shaded twice over.
 *
 * The tree's own light decides which band a clump sits in, and the clump's own geometry decides
 * where in that band each block falls. Shading only globally makes the canopy one smooth gradient
 * of dots -- a dither screen, not foliage. Shading only locally makes every clump identical. Both
 * together is what gives the boards a canopy of distinguishable clumps that still agree about
 * where the sun is.
 */
function cluster(buf, rng, cx, cy, r, canopy) {
  const g = BLOCK;
  const nx = (cx - canopy.cx) / canopy.r;
  const ny = (cy - canopy.cy) / (canopy.r * canopy.squash);
  const global = -(nx * 0.5 + ny * 0.95);
  for (let y = Math.floor((cy - r - g) / g) * g; y <= cy + r + g; y += g)
    for (let x = Math.floor((cx - r - g) / g) * g; x <= cx + r + g; x += g) {
      const dx = (x + g / 2 - cx) / r;
      const dy = (y + g / 2 - cy) / (r * 0.86);
      const d = dx * dx + dy * dy;
      if (d > 1.0) continue;
      if (d > 0.62 && rng.f() > 0.72) continue; // a ragged rim, so the clump is not a disc
      // the clump's own roundness, plus where the clump sits in the tree
      const local = -(dx * 0.45 + dy * 0.85);
      const light = global * 0.66 + local * 0.72 + rng.r(-0.16, 0.16);
      const c =
        light > 0.78
          ? LEAF[0]
          : light > 0.3
            ? LEAF[1]
            : light > -0.12
              ? LEAF[2]
              : light > -0.62
                ? LEAF[3]
                : LEAF[4];
      for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) buf.set(x + i, y + j, c);
    }
}

export function broadleaf(seed = 1, variant = 0) {
  const v = VARIANTS[variant % VARIANTS.length];
  const rng = new Rng(seed);
  const W = Math.ceil(v.r * 2.5);
  const H = Math.ceil(v.r * 1.9 + v.trunk);
  const buf = new Buf(W, H);
  const cx = W / 2;
  const base = H - 4;

  // the skeleton: a bole that divides, and divides again
  const out = { segments: [], tips: [] };
  const boleTop = base - v.trunk;
  const thick = v.r * 0.165;
  out.segments.push({
    x0: cx,
    y0: base,
    x1: cx + rng.r(-5, 5),
    y1: boleTop,
    r0: thick,
    r1: thick * 0.72,
    depth: 99,
  });
  const kids = 3;
  for (let i = 0; i < kids; i++) {
    const a = -Math.PI / 2 + (i - (kids - 1) / 2) * rng.r(0.5, 0.72);
    grow(rng, cx, boleTop, a, v.r * rng.r(0.42, 0.55), thick * 0.72, v.levels, out);
  }

  // Keep the limbs inside the crown. A twig that ends past the foliage reads as a broken branch,
  // and the eye finds it immediately; the reference's limbs all die inside the leaves.
  const inside = (x, y, m = 0.82) => {
    const nx = (x - cx) / (v.r * m);
    const ny = (y - (boleTop - v.r * 0.42)) / (v.r * v.squash * m);
    return nx * nx + ny * ny <= 1 || y > boleTop;
  };
  out.segments = out.segments.filter((s2) => s2.depth === 99 || inside(s2.x1, s2.y1));
  out.tips = out.tips.filter((t) => inside(t.x, t.y));

  roots(buf, rng, cx, base, thick);
  // thick to thin, so a branch never paints over the bole it came from
  for (const s of [...out.segments].sort((a, b) => b.r0 - a.r0)) {
    const c = s.r0 > thick * 0.5 ? BARK.mid : s.r0 > thick * 0.25 ? BARK.dark : BARK.deep;
    buf.taper(s.x0, s.y0, s.x1, s.y1, s.r0, s.r1, c);
    // a lit edge up the left of the heavier limbs, which is the whole of the bark's modelling
    if (s.r0 > thick * 0.4)
      buf.taper(
        s.x0 - s.r0 * 0.45,
        s.y0,
        s.x1 - s.r1 * 0.45,
        s.y1,
        s.r0 * 0.3,
        s.r1 * 0.3,
        BARK.lit,
      );
  }

  // the canopy, hung off the tips and off the upper limbs so it is a mass and not a row of balls
  // low enough that the crown wraps the upper limbs rather than sitting above them
  const canopy = { cx, cy: boleTop - v.r * 0.42, r: v.r, squash: v.squash };
  // The crown is a mass the branches reach into, not a hat balanced on them. Hanging clumps off
  // the tips alone leaves the middle empty and the outline flat, so the canopy volume is filled:
  // points sampled through the ellipsoid, biased outward because that is where the leaves are,
  // plus one on every tip so no limb ends in nothing.
  const hangs = out.tips.map((t) => ({ x: t.x, y: t.y }));
  for (let i = 0; i < v.clumps; i++) {
    const a = rng.r(0, Math.PI * 2);
    const rad = Math.sqrt(rng.r(0.05, 1)) ** 0.72; // outward-biased, but the middle still fills
    hangs.push({
      x: canopy.cx + Math.cos(a) * rad * v.r,
      y: canopy.cy + Math.sin(a) * rad * v.r * v.squash,
    });
  }
  // dark to light, so a sunlit clump always sits in front of a shaded one
  hangs.sort((a, b) => b.y - a.y);
  for (const t of hangs) {
    cluster(buf, rng, t.x, t.y, v.r * v.clump * rng.r(0.75, 1.25), canopy);
  }

  buf.outline(OUTLINE);
  return buf.trim(1);
}

if (process.argv[1]?.endsWith('broadleaf.mjs')) {
  const [, , out, seed = '1', variant = '0'] = process.argv;
  if (!out) {
    console.error('usage: node art-src/draw/broadleaf.mjs <out.png> [seed] [variant]');
    process.exit(2);
  }
  const b = broadleaf(Number(seed), Number(variant));
  console.log(b.write(out), `${b.w}x${b.h}`);
}
